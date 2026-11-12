/**
 * Lectura completa de comprobantes electrónicos SUNAT (UBL 2.1):
 * facturas, boletas, notas de crédito y notas de débito.
 *
 * A diferencia de parseSunatInvoiceXML (que solo extrae lo necesario para
 * registrar la factura), aquí se conserva todo lo que el comprobante dice:
 * emisor, cliente, líneas de detalle, impuestos, cuotas, detracción, etc.
 * Corre en el navegador (usa DOMParser).
 */

const NS = {
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
} as const;

export type SunatDocType = 'factura' | 'boleta' | 'nota_credito' | 'nota_debito' | 'otro';

export interface SunatParty {
  name: string;
  tradeName?: string;
  documentType?: string;
  documentNumber: string;
  address?: string;
}

export interface SunatLine {
  id: string;
  quantity: number;
  unitCode: string;
  unitLabel: string;
  description: string;
  code?: string;
  /** Valor unitario sin IGV */
  unitValue: number;
  /** Precio unitario con IGV (precio de venta) */
  unitPrice: number | null;
  /** Valor de venta de la línea, sin IGV */
  lineTotal: number;
  igv: number;
  freeOfCharge: boolean;
}

export interface SunatTaxSubtotal {
  code: string;
  name: string;
  taxable: number;
  amount: number;
  percent: number | null;
}

export interface SunatInstallment {
  id: string;
  amount: number;
  dueDate: string | null;
}

export interface SunatDocument {
  docType: SunatDocType;
  docTypeLabel: string;
  id: string;
  issueDate: string;
  issueTime?: string;
  dueDate: string | null;
  currency: string;
  supplier: SunatParty;
  customer: SunatParty;
  lines: SunatLine[];
  taxSubtotals: SunatTaxSubtotal[];
  totals: {
    lineExtension: number;
    taxTotal: number;
    allowance: number;
    charge: number;
    prepaid: number;
    payable: number;
  };
  amountInWords?: string;
  notes: string[];
  orderReference?: string;
  paymentForm?: string;
  creditAmount?: number;
  installments: SunatInstallment[];
  detraction?: {
    percent: number | null;
    amount: number | null;
    account?: string;
    serviceCode?: string;
  };
  /** Comprobante al que afecta (solo notas de crédito/débito) */
  reference?: { id: string; reason?: string };
}

const ROOT_TYPES: Record<string, { type: SunatDocType; label: string }> = {
  CreditNote: { type: 'nota_credito', label: 'Nota de crédito electrónica' },
  DebitNote: { type: 'nota_debito', label: 'Nota de débito electrónica' },
};

const INVOICE_TYPE_CODES: Record<string, { type: SunatDocType; label: string }> = {
  '01': { type: 'factura', label: 'Factura electrónica' },
  '03': { type: 'boleta', label: 'Boleta de venta electrónica' },
};

const PARTY_DOC_TYPES: Record<string, string> = {
  '0': 'Doc. trib. no dom.',
  '1': 'DNI',
  '4': 'Carné de extranjería',
  '6': 'RUC',
  '7': 'Pasaporte',
  A: 'Cédula diplomática',
  '-': 'Sin documento',
};

const UNIT_LABELS: Record<string, string> = {
  NIU: 'UND',
  ZZ: 'SERV',
  KGM: 'KG',
  HUR: 'HORA',
  DAY: 'DÍA',
  MON: 'MES',
  MTR: 'M',
  MTK: 'M²',
  LTR: 'L',
  BX: 'CAJA',
  PK: 'PAQ',
  SET: 'JUEGO',
  GLL: 'GAL',
};

const TAX_LABELS: Record<string, string> = {
  '1000': 'IGV',
  '1016': 'IVAP',
  '2000': 'ISC',
  '7152': 'ICBPER',
  '9995': 'Exportación',
  '9996': 'Gratuito',
  '9997': 'Exonerado',
  '9998': 'Inafecto',
  '9999': 'Otros tributos',
};

export const CURRENCY_LABELS: Record<string, string> = {
  PEN: 'Soles',
  USD: 'Dólares americanos',
  EUR: 'Euros',
};

/**
 * Lee un archivo XML respetando la codificación declarada.
 * Los XML de SUNAT suelen venir en ISO-8859-1: leerlos como UTF-8
 * (file.text()) rompe tildes y eñes ("Operaci�n").
 */
export async function readXmlFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const head = new TextDecoder('ascii').decode(buffer.slice(0, 256));
  const declared = head.match(/encoding\s*=\s*["']([\w.:-]+)["']/i)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(declared).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

/**
 * Versión del XML para descargar: ya está decodificado a texto, así que se
 * guarda como UTF-8 y se corrige la declaración. La firma digital (C14N)
 * no depende de la codificación del archivo.
 */
export function toDownloadableXml(xml: string) {
  return xml.replace(
    /^(<\?xml[^>]*encoding\s*=\s*["'])[\w.:-]+(["'])/i,
    '$1UTF-8$2',
  );
}

export function parseSunatDocument(xml: string): SunatDocument {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('El XML tiene un formato inválido.');
  }
  const root = doc.documentElement;
  if (!root || !['Invoice', 'CreditNote', 'DebitNote'].includes(root.localName)) {
    throw new Error('El archivo no parece un comprobante electrónico SUNAT (UBL).');
  }

  const id = text(child(root, 'cbc', 'ID'));
  if (!id) throw new Error('No se encontró el número de comprobante en el XML.');

  const typeCode = text(child(root, 'cbc', 'InvoiceTypeCode'));
  const typeInfo = ROOT_TYPES[root.localName] ??
    INVOICE_TYPE_CODES[typeCode] ?? { type: 'otro' as const, label: 'Comprobante electrónico' };

  // Notas: 1000 = monto en letras; el resto se muestra como observaciones
  let amountInWords: string | undefined;
  const notes: string[] = [];
  for (const note of children(root, 'cbc', 'Note')) {
    const value = text(note);
    if (!value) continue;
    if (note.getAttribute('languageLocaleID') === '1000') {
      amountInWords = value;
    } else if (!notes.includes(value)) {
      notes.push(value);
    }
  }

  // Forma de pago, cuotas y detracción viven en cac:PaymentTerms
  let paymentForm: string | undefined;
  let creditAmount: number | undefined;
  const installments: SunatInstallment[] = [];
  let detraction: SunatDocument['detraction'];
  for (const terms of children(root, 'cac', 'PaymentTerms')) {
    const termsId = text(child(terms, 'cbc', 'ID'));
    const meansId = text(child(terms, 'cbc', 'PaymentMeansID'));
    const amount = num(child(terms, 'cbc', 'Amount'));
    if (/^detracci/i.test(termsId)) {
      detraction = {
        ...detraction,
        serviceCode: meansId || undefined,
        percent: numOrNull(child(terms, 'cbc', 'PaymentPercent')),
        amount: numOrNull(child(terms, 'cbc', 'Amount')),
      };
    } else if (/^formapago$/i.test(termsId) || /^(contado|credito|cuota)/i.test(meansId)) {
      if (/^contado$/i.test(meansId)) {
        paymentForm = 'Contado';
      } else if (/^credito$/i.test(meansId)) {
        paymentForm = 'Crédito';
        creditAmount = amount;
      } else if (/^cuota/i.test(meansId)) {
        installments.push({
          id: meansId,
          amount,
          dueDate: text(child(terms, 'cbc', 'PaymentDueDate')) || null,
        });
      }
    }
  }
  for (const means of children(root, 'cac', 'PaymentMeans')) {
    if (/^detracci/i.test(text(child(means, 'cbc', 'ID')))) {
      const account = text(path(means, 'cac:PayeeFinancialAccount', 'cbc:ID'));
      detraction = {
        percent: detraction?.percent ?? null,
        amount: detraction?.amount ?? null,
        serviceCode: detraction?.serviceCode,
        account: account || undefined,
      };
    }
  }

  const dueDate =
    installments.find((i) => i.dueDate)?.dueDate ?? (text(child(root, 'cbc', 'DueDate')) || null);

  const taxSubtotals: SunatTaxSubtotal[] = [];
  let taxTotal = 0;
  for (const tax of children(root, 'cac', 'TaxTotal')) {
    taxTotal += num(child(tax, 'cbc', 'TaxAmount'));
    for (const sub of children(tax, 'cac', 'TaxSubtotal')) {
      const category = child(sub, 'cac', 'TaxCategory');
      const scheme = category ? child(category, 'cac', 'TaxScheme') : null;
      const code = text(scheme ? child(scheme, 'cbc', 'ID') : null);
      const taxable = num(child(sub, 'cbc', 'TaxableAmount'));
      const amount = num(child(sub, 'cbc', 'TaxAmount'));
      // Muchos emisores ponen la tasa solo a nivel de línea: se deduce del total
      const derivedPercent =
        taxable > 0 && amount > 0 ? Math.round((amount / taxable) * 10000) / 100 : null;
      taxSubtotals.push({
        code,
        name: TAX_LABELS[code] ?? (text(scheme ? child(scheme, 'cbc', 'Name') : null) || code),
        taxable,
        amount,
        percent:
          numOrNull(child(sub, 'cbc', 'Percent')) ??
          numOrNull(category ? child(category, 'cbc', 'Percent') : null) ??
          derivedPercent,
      });
    }
  }

  const monetary =
    child(root, 'cac', 'LegalMonetaryTotal') ?? child(root, 'cac', 'RequestedMonetaryTotal');
  const totals = {
    lineExtension: num(monetary ? child(monetary, 'cbc', 'LineExtensionAmount') : null),
    taxTotal,
    allowance: num(monetary ? child(monetary, 'cbc', 'AllowanceTotalAmount') : null),
    charge: num(monetary ? child(monetary, 'cbc', 'ChargeTotalAmount') : null),
    prepaid: num(monetary ? child(monetary, 'cbc', 'PrepaidAmount') : null),
    payable: num(monetary ? child(monetary, 'cbc', 'PayableAmount') : null),
  };

  const lineNodes = [
    ...children(root, 'cac', 'InvoiceLine'),
    ...children(root, 'cac', 'CreditNoteLine'),
    ...children(root, 'cac', 'DebitNoteLine'),
  ];
  const lines = lineNodes.map((line, index) => parseLine(line, index));

  const customerParty = path(root, 'cac:AccountingCustomerParty', 'cac:Party');
  const customer = parseParty(customerParty);
  if (!customer.address) {
    customer.address = formatAddress(
      path(root, 'cac:BuyerCustomerParty', 'cac:Party', 'cac:PartyLegalEntity', 'cac:RegistrationAddress'),
    );
  }

  const billingRef = path(root, 'cac:BillingReference', 'cac:InvoiceDocumentReference', 'cbc:ID');
  const reason = path(root, 'cac:DiscrepancyResponse', 'cbc:Description');

  return {
    docType: typeInfo.type,
    docTypeLabel: typeInfo.label,
    id,
    issueDate: text(child(root, 'cbc', 'IssueDate')),
    issueTime: text(child(root, 'cbc', 'IssueTime')).replace(/(\.\d+)?Z?$/, '') || undefined,
    dueDate,
    currency: text(child(root, 'cbc', 'DocumentCurrencyCode')) || 'PEN',
    supplier: parseParty(path(root, 'cac:AccountingSupplierParty', 'cac:Party')),
    customer,
    lines,
    taxSubtotals,
    totals,
    amountInWords,
    notes,
    orderReference: text(path(root, 'cac:OrderReference', 'cbc:ID')) || undefined,
    paymentForm,
    creditAmount,
    installments,
    detraction,
    reference: billingRef
      ? { id: text(billingRef), reason: text(reason) || undefined }
      : undefined,
  };
}

function parseLine(line: Element, index: number): SunatLine {
  const quantityNode =
    child(line, 'cbc', 'InvoicedQuantity') ??
    child(line, 'cbc', 'CreditedQuantity') ??
    child(line, 'cbc', 'DebitedQuantity');
  const unitCode = quantityNode?.getAttribute('unitCode') ?? '';
  const item = child(line, 'cac', 'Item');
  const description = item
    ? children(item, 'cbc', 'Description').map(text).filter(Boolean).join('\n')
    : '';

  // Precio de venta (con IGV): PriceTypeCode 01. 02 = valor referencial gratuito.
  let unitPrice: number | null = null;
  const pricing = child(line, 'cac', 'PricingReference');
  if (pricing) {
    for (const alt of children(pricing, 'cac', 'AlternativeConditionPrice')) {
      if (text(child(alt, 'cbc', 'PriceTypeCode')) === '01') {
        unitPrice = numOrNull(child(alt, 'cbc', 'PriceAmount'));
      }
    }
  }

  const sellersCode = item ? text(path(item, 'cac:SellersItemIdentification', 'cbc:ID')) : '';

  return {
    id: text(child(line, 'cbc', 'ID')) || String(index + 1),
    quantity: num(quantityNode),
    unitCode,
    unitLabel: UNIT_LABELS[unitCode] ?? unitCode,
    description,
    code: sellersCode || undefined,
    unitValue: num(path(line, 'cac:Price', 'cbc:PriceAmount')),
    unitPrice,
    lineTotal: num(child(line, 'cbc', 'LineExtensionAmount')),
    igv: num(path(line, 'cac:TaxTotal', 'cbc:TaxAmount')),
    freeOfCharge: text(child(line, 'cbc', 'FreeOfChargeIndicator')) === 'true',
  };
}

function parseParty(party: Element | null): SunatParty {
  if (!party) return { name: '', documentNumber: '' };
  const idNode = path(party, 'cac:PartyIdentification', 'cbc:ID');
  const legal = child(party, 'cac', 'PartyLegalEntity');
  const legalName = text(legal ? child(legal, 'cbc', 'RegistrationName') : null);
  const tradeName = text(path(party, 'cac:PartyName', 'cbc:Name'));
  const schemeId = idNode?.getAttribute('schemeID') ?? '';
  return {
    name: legalName || tradeName,
    tradeName: tradeName && tradeName !== legalName ? tradeName : undefined,
    documentType: PARTY_DOC_TYPES[schemeId] ?? (schemeId || undefined),
    documentNumber: text(idNode),
    address: formatAddress(legal ? child(legal, 'cac', 'RegistrationAddress') : null),
  };
}

function formatAddress(address: Element | null): string | undefined {
  if (!address) return undefined;
  const line = text(path(address, 'cac:AddressLine', 'cbc:Line'));
  const parts = [
    text(child(address, 'cbc', 'District')),
    text(child(address, 'cbc', 'CityName')),
    text(child(address, 'cbc', 'CountrySubentity')),
  ].filter((part) => part && part !== '-');
  // Algunos emisores ya incluyen distrito/provincia dentro de la línea
  const extra = Array.from(new Set(parts)).filter(
    (part) => !line.toUpperCase().includes(part.toUpperCase()),
  );
  const full = [line, ...extra].filter(Boolean).join(' - ');
  return full || undefined;
}

// ---------- helpers de navegación (solo hijos directos, por namespace) ----------

function children(el: Element, prefix: keyof typeof NS, name: string): Element[] {
  const ns = NS[prefix];
  return Array.from(el.children).filter((c) => c.namespaceURI === ns && c.localName === name);
}

function child(el: Element, prefix: keyof typeof NS, name: string): Element | null {
  return children(el, prefix, name)[0] ?? null;
}

function path(el: Element | null, ...steps: string[]): Element | null {
  let current: Element | null = el;
  for (const step of steps) {
    if (!current) return null;
    const [prefix, name] = step.split(':') as [keyof typeof NS, string];
    current = child(current, prefix, name);
  }
  return current;
}

function text(el: Element | null): string {
  return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function numOrNull(el: Element | null): number | null {
  const raw = text(el);
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function num(el: Element | null): number {
  return numOrNull(el) ?? 0;
}
