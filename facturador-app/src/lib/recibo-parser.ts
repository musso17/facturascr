/**
 * Parser de Recibos por Honorarios Electrónicos (SUNAT) a partir del texto
 * plano extraído del PDF. Compartido entre el cliente (extracción en el
 * navegador con unpdf) y el endpoint /api/scan-invoice.
 *
 * unpdf devuelve el texto en orden de streams internos del PDF, no en orden
 * visual: las etiquetas quedan separadas de sus valores. Por eso los montos
 * se extraen posicionalmente (BASE (RETENCIÓN) NETO SOLES) y no por etiqueta.
 */

const MONTHS: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04',
  mayo: '05', junio: '06', julio: '07', agosto: '08',
  setiembre: '09', septiembre: '09', octubre: '10',
  noviembre: '11', diciembre: '12',
};

// Tokens con los que puede empezar la dirección del emisor en el recibo.
// El nombre del profesional termina donde empieza uno de estos.
const ADDRESS_TOKENS =
  'CAL\\.|JR\\.|AV\\.|AVD\\.?|PROV\\.|URB\\.|NRO\\.|MZA\\.|LOTE\\.?|LT\\.|APV\\.|ASOC\\.|PSJE\\.|PJ\\.|CALLE|JIR[OÓ]N|AVENIDA|CARRETERA|SECTOR|BARRIO|TEL[EÉ]FONO';

export interface ParsedRecibo {
  documentType: 'recibo';
  currency: 'PEN';
  category: string;
  description: string;
  igvAmount: 0;
  ruc?: string;
  documentSeries?: string;
  documentNumber: string;
  providerName: string;
  baseAmount?: number;
  irRetentionAmount?: number;
  totalAmount?: number;
  issueDate?: string;
  dueDate?: string;
}

function parseMoney(raw: string): number {
  const clean = raw.replace(/[()S/\s]/g, '').trim();
  if (/^\d{1,3}(?:,\d{3})*\.\d{2}$/.test(clean)) return parseFloat(clean.replace(/,/g, ''));
  if (/^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(clean)) return parseFloat(clean.replace(/\./g, '').replace(',', '.'));
  return parseFloat(clean.replace(/,/g, '')) || 0;
}

// Primer número con formato de dinero después de una etiqueta
function findAmountAfter(text: string, labelRe: RegExp): number | null {
  const match = text.match(labelRe);
  if (!match) return null;
  const rest = text.slice(match.index! + match[0].length);
  const numMatch = rest.match(/[\d]{1,3}(?:[,.][\d]{3})*[.,][\d]{2}/);
  if (!numMatch) return null;
  return parseMoney(numMatch[0]);
}

export function parseReciboText(rawText: string): ParsedRecibo {
  const norm = rawText.replace(/\s+/g, ' ').trim();

  const data: ParsedRecibo = {
    documentType: 'recibo',
    currency: 'PEN',
    category: 'servicios',
    description: 'Servicios profesionales',
    igvAmount: 0,
    documentNumber: `RHE-${Date.now().toString().slice(-5)}`,
    providerName: 'Proveedor Desconocido',
  };

  // === RUC DEL EMISOR ===
  const personalRucMatch = norm.match(/\b(10\d{9})\b/);
  if (personalRucMatch) {
    data.ruc = personalRucMatch[1];
  } else {
    const labeledRuc = norm.match(/R\.?U\.?C\.?\s+(\d{11})/i);
    if (labeledRuc) data.ruc = labeledRuc[1];
  }

  // === SERIE Y NÚMERO ===
  const nroMatch = norm.match(/(E\d{3})\s*[-]?\s*(\d+)/i);
  if (nroMatch) {
    data.documentSeries = nroMatch[1].toUpperCase();
    data.documentNumber = nroMatch[2];
  }

  // === NOMBRE DEL EMISOR ===
  // Va después de "Nro: <serie> <número>" y termina donde empieza la dirección
  const nameMatch = norm.match(
    new RegExp(
      `(?:E\\d{3}\\s*[-]?\\s*\\d+)\\s+([A-ZÁÉÍÓÚÑ\\s]+?)\\s+(?:${ADDRESS_TOKENS})`,
      'i',
    ),
  );
  if (nameMatch) {
    data.providerName = nameMatch[1].trim();
  }

  // === MONTOS (posicional: BASE (RETENCIÓN) NETO SOLES) ===
  const amountBlockMatch = norm.match(
    /([\d]{1,3}(?:,[\d]{3})*\.[\d]{2})\s+\(([\d]{1,3}(?:,[\d]{3})*\.[\d]{2})\)\s+([\d]{1,3}(?:,[\d]{3})*\.[\d]{2})\s+(?:SOLES|D[OÓ]LARES)/i,
  );
  if (amountBlockMatch) {
    data.baseAmount = parseMoney(amountBlockMatch[1]);
    data.irRetentionAmount = parseMoney(amountBlockMatch[2]);
    data.totalAmount = parseMoney(amountBlockMatch[3]);
  } else {
    const base = findAmountAfter(norm, /Total\s+por\s+honorarios\s*:?/i);
    if (base !== null) data.baseAmount = base;
    const total = findAmountAfter(norm, /Total\s+Neto\s+Recibido\s*:?/i);
    if (total !== null) data.totalAmount = total;
    if ((data.totalAmount == null || data.totalAmount === 0) && data.baseAmount != null) {
      data.totalAmount = data.baseAmount;
    }
  }

  // === CONCEPTO Y FECHA ===
  const conceptAndDateMatch = norm.match(
    /(?:SOLES|D[OÓ]LARES)\s+(.+?)\s+-\s+[A-Z]\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i,
  );
  if (conceptAndDateMatch) {
    data.description = conceptAndDateMatch[1].trim();
    const [, , day, monthStr, year] = conceptAndDateMatch;
    const month = MONTHS[monthStr.toLowerCase()] || '01';
    data.issueDate = `${year}-${month}-${day.padStart(2, '0')}`;
    data.dueDate = data.issueDate;
  } else {
    const fallbackDate = norm.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (fallbackDate) {
      const [, day, monthStr, year] = fallbackDate;
      const month = MONTHS[monthStr.toLowerCase()] || '01';
      data.issueDate = `${year}-${month}-${day.padStart(2, '0')}`;
      data.dueDate = data.issueDate;
    }
  }

  return data;
}
