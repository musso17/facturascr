import {
  ACCOUNTING_STATUS_TO_LABEL,
  InvoiceFormState,
  InvoiceRecord,
  InvoiceStatus,
  SupabaseInvoiceRow,
} from './accounting-types';

export function mapInvoiceRow(row: SupabaseInvoiceRow): InvoiceRecord {
  const amount = row.amount ?? 0;
  const vat = row.vat ?? 0;
  const total = row.total ?? round(amount * (1 + vat / 100));
  const paid = row.paid ?? 0;
  const persistedStatus =
    row.status && ACCOUNTING_STATUS_TO_LABEL[row.status]
      ? ACCOUNTING_STATUS_TO_LABEL[row.status]
      : undefined;

  return withComputedStatus(
    {
      recordId: row.id,
      id: row.invoice_number ?? 'SIN-CODIGO',
      client: row.client ?? 'Sin cliente',
      clientId: row.client_id ?? null,
      ruc: row.ruc ?? '',
      description: row.description ?? '',
      issueDate: toDateInputValue(row.issue_date),
      dueDate: toDateInputValue(row.due_date ?? row.issue_date),
      amount,
      vat,
      total,
      paid,
      balance: Math.max(total - paid, 0),
      status: persistedStatus ?? 'Pendiente',
      paymentMethod: row.payment_method ?? null,
      paymentReference: row.payment_reference ?? null,
      paymentDate: row.payment_date ?? null,
      retentionIR: row.retention_ir ?? 0,
      itf: row.itf ?? 0,
      category: row.category ?? null,
    },
    persistedStatus,
  );
}

export function summarizeInvoices(list: InvoiceRecord[]) {
  return list.reduce(
    (acc, invoice) => {
      acc.facturado += invoice.total;
      acc.pagado += invoice.paid;
      acc.pendiente += invoice.balance;
      if (invoice.status === 'Vencido') {
        acc.vencido += invoice.balance;
      }
      return acc;
    },
    { facturado: 0, pagado: 0, pendiente: 0, vencido: 0 },
  );
}

function withComputedStatus(
  invoice: InvoiceRecord,
  persistedStatus?: InvoiceStatus | null,
): InvoiceRecord {
  const balance = Math.max(round(invoice.total - invoice.paid), 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = asLocalDate(invoice.dueDate);
  due.setHours(0, 0, 0, 0);

  const computedStatus: InvoiceStatus =
    balance <= 0 ? 'Pagado' : due < today ? 'Vencido' : 'Pendiente';
  let status: InvoiceStatus = computedStatus;

  if (persistedStatus) {
    status = persistedStatus;
    if (balance <= 0) {
      status = 'Pagado';
    } else if (persistedStatus === 'Pagado' && balance > 0) {
      status = computedStatus;
    }
  }

  return {
    ...invoice,
    balance,
    status,
  };
}

export function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function toDateInputValue(value?: string | null) {
  const source = value ?? new Date().toISOString();
  return new Date(source).toISOString().slice(0, 10);
}

export function asLocalDate(value: string) {
  if (!value) return new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return new Date(`${year}-${month}-${day}T00:00:00`);
}

export function toMonthKey(value: string) {
  if (!value) return '0000-00';
  return value.slice(0, 7);
}

export function formatMonthLabel(value: string) {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, 1);
  return new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' }).format(date);
}

export function toISODate(value: string) {
  return new Date(`${value}T00:00:00Z`).toISOString();
}

export function describeSupabaseError(error: unknown) {
  if (!error) return null;
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object') {
    const maybe = error as { message?: string; details?: string; hint?: string; code?: string };
    return maybe.message || maybe.details || maybe.hint || (maybe.code ? `Error ${maybe.code}` : null);
  }
  return null;
}

export function shortenName(value: string, max = 36) {
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

// Define expense categories that are considered fixed costs
const FIXED_COST_CATEGORIES = ['personal', 'administrativos', 'equipos'];

export interface MonthlyAggregate {
  month: string; // YYYY-MM
  income: number;
  fixedExpenses: number;
  variableExpenses: number;
  totalExpenses: number;
}

export function buildMonthlyAggregates(
  invoices: { issueDate: string; total: number }[],
  expenses: { issueDate: string; totalAmount: number; category: string }[],
): MonthlyAggregate[] {
  const monthlyMap = new Map<
    string,
    { income: number; fixedExpenses: number; variableExpenses: number }
  >();

  // Local helper to derive YYYY-MM without relying on potentially hoisted references
  const localMonthKey = (value: string) => {
    if (!value) return '0000-00';
    return value.slice(0, 7);
  };

  invoices.forEach((invoice) => {
    const monthKey = localMonthKey(invoice.issueDate);
    const entry = monthlyMap.get(monthKey) ?? { income: 0, fixedExpenses: 0, variableExpenses: 0 };
    entry.income += invoice.total;
    monthlyMap.set(monthKey, entry);
  });

  expenses.forEach((expense) => {
    const monthKey = localMonthKey(expense.issueDate);
    const entry = monthlyMap.get(monthKey) ?? { income: 0, fixedExpenses: 0, variableExpenses: 0 };
    if (FIXED_COST_CATEGORIES.includes(expense.category)) {
      entry.fixedExpenses += expense.totalAmount;
    } else {
      entry.variableExpenses += expense.totalAmount;
    }
    monthlyMap.set(monthKey, entry);
  });

  return Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, data]) => ({
      month,
      income: round(data.income),
      fixedExpenses: round(data.fixedExpenses),
      variableExpenses: round(data.variableExpenses),
      totalExpenses: round(data.fixedExpenses + data.variableExpenses),
    }));
}

export interface ProjectionBaseline {
  costosFijosReales: number;
  tasaCostoVariable: number; // as a decimal, e.g., 0.15 for 15%
  ingresosPromedioRecurrentes: number;
  saldoCajaActual: number;
}

export function calculateProjectionBaseline(
  monthlyAggregates: MonthlyAggregate[],
  currentCashBalance: number,
): ProjectionBaseline {
  const lookbackMonths = 6;
  // Get the last `lookbackMonths` or fewer if not enough data
  const recentAggregates = monthlyAggregates.slice(-lookbackMonths);

  if (recentAggregates.length === 0) {
    return {
      costosFijosReales: 0,
      tasaCostoVariable: 0,
      ingresosPromedioRecurrentes: 0,
      saldoCajaActual: currentCashBalance,
    };
  }

  const totalFixedExpenses = recentAggregates.reduce((sum, m) => sum + m.fixedExpenses, 0);
  const totalVariableExpenses = recentAggregates.reduce((sum, m) => sum + m.variableExpenses, 0);
  const totalIncome = recentAggregates.reduce((sum, m) => sum + m.income, 0);

  const costosFijosReales = round(totalFixedExpenses / recentAggregates.length); // Average monthly fixed costs
  const tasaCostoVariable = totalIncome > 0 ? round(totalVariableExpenses / totalIncome) : 0; // As a decimal
  const ingresosPromedioRecurrentes = round(totalIncome / recentAggregates.length);

  return {
    costosFijosReales,
    tasaCostoVariable,
    ingresosPromedioRecurrentes,
    saldoCajaActual: currentCashBalance,
  };
}

export interface FinancialMetrics {
  puntoEquilibrio: number;
  runway: number; // in months
}

export function calculateFinancialMetrics(baseline: ProjectionBaseline): FinancialMetrics {
  const { costosFijosReales, tasaCostoVariable, ingresosPromedioRecurrentes, saldoCajaActual } =
    baseline;

  // Punto de Equilibrio (PE)
  let puntoEquilibrio = 0;
  // PE = CostosFijosReales / (1 - TasaCostoVariable)
  const contributionMarginRatio = 1 - tasaCostoVariable;
  if (contributionMarginRatio > 0) {
    puntoEquilibrio = round(costosFijosReales / contributionMarginRatio);
  } else if (costosFijosReales > 0) {
    // If fixed costs exist but no positive contribution margin (i.e., contributionMarginRatio <= 0), PE is infinite/unreachable
    puntoEquilibrio = Infinity;
  }
  // If fixed costs are 0 and contribution margin is 0 or negative, PE is 0.

  // Runway
  let runway = Infinity;
  // Runway = SaldoCajaActual / (CostosFijosReales - IngresosPromedioRecurrentes)
  const netCashBurn = costosFijosReales - ingresosPromedioRecurrentes;

  if (netCashBurn > 0) { // If burning cash (fixed costs > recurrent income)
    runway = round(saldoCajaActual / netCashBurn);
  } else if (netCashBurn <= 0) { // If not burning cash or gaining cash, runway is infinite
    runway = Infinity;
  }

  return {
    puntoEquilibrio,
    runway,
  };
}

export function buildInvoicePayload(input: InvoiceFormState) {
  const amount = Number(input.amount) || 0;
  const vat = Number(input.vat) || 0;
  const total = round(amount * (1 + vat / 100));
  const paid = Math.min(Number(input.paid) || 0, total);

  return {
    invoice_number: input.id.trim(),
    client: input.client.trim(),
    client_id: input.clientId ?? null,
    ruc: input.ruc.trim(),
    description: input.description.trim(),
    issue_date: toISODate(input.issueDate),
    due_date: toISODate(input.dueDate),
    amount,
    vat,
    total,
    paid,
  };
}

export function parseSunatInvoiceXML(xmlContent: string): InvoiceFormState {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlContent, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('El XML tiene un formato inválido.');
  }

  const resolver = createNamespaceResolver(doc);
  const pick = (...expressions: string[]) => pickXPathText(doc, resolver, expressions);

  const invoiceId = pick('/ns:Invoice/cbc:ID') ?? '';
  if (!invoiceId) {
    throw new Error('No se encontró el número de factura en el XML.');
  }

  const issueDateRaw = pick('/ns:Invoice/cbc:IssueDate') ?? new Date().toISOString();
  const dueDateRaw =
    pick(
      '/ns:Invoice/cac:PaymentTerms[cbc:PaymentMeansID="Cuota001"]/cbc:PaymentDueDate',
      '/ns:Invoice/cac:PaymentTerms[cbc:PaymentMeansID="Cuota1"]/cbc:PaymentDueDate',
      '/ns:Invoice/cac:PaymentTerms[cbc:PaymentMeansID="Credito"]/cbc:PaymentDueDate',
      '(/ns:Invoice/cac:PaymentTerms/cbc:PaymentDueDate)[1]',
      '/ns:Invoice/cbc:DueDate',
    ) ?? issueDateRaw;

  const clientName =
    pick(
      '/ns:Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName',
      '/ns:Invoice/cac:AccountingCustomerParty/cac:Party/cbc:Name',
    ) ?? 'Sin cliente';

  const ruc =
    pick(
      '/ns:Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID',
      '/ns:Invoice/cac:AccountingCustomerParty/cbc:CustomerAssignedAccountID',
    ) ?? '';

  const description =
    pick(
      '(/ns:Invoice/cac:InvoiceLine/cac:Item/cbc:Description)[1]',
      '(/ns:Invoice/cac:InvoiceLine/cbc:Note)[1]',
      '(/ns:Invoice/cbc:Note)[1]',
    ) ?? `Factura ${invoiceId}`;

  const baseAmountRaw =
    pick('/ns:Invoice/cac:LegalMonetaryTotal/cbc:LineExtensionAmount') ??
    pick('(/ns:Invoice/cac:InvoiceLine/cbc:LineExtensionAmount)[1]');
  const totalAmountRaw = pick('/ns:Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount');
  const vatPercentRaw =
    pick('(/ns:Invoice/cac:TaxTotal/cac:TaxSubtotal/cbc:Percent)[1]') ??
    pick('(/ns:Invoice/cac:InvoiceLine/cac:TaxTotal/cac:TaxSubtotal/cbc:Percent)[1]');
  const vatAmountRaw =
    pick('(/ns:Invoice/cac:TaxTotal/cbc:TaxAmount)[1]') ??
    pick('(/ns:Invoice/cac:InvoiceLine/cac:TaxTotal/cbc:TaxAmount)[1]');

  const baseAmount = parseNumeric(baseAmountRaw);
  const totalAmount = parseNumeric(totalAmountRaw);
  const vatPercent = parseNumeric(vatPercentRaw);
  const vatAmount = parseNumeric(vatAmountRaw);

  let vatValue = Number.isFinite(vatPercent) ? vatPercent : NaN;
  if (!Number.isFinite(vatValue) && Number.isFinite(vatAmount) && Number.isFinite(baseAmount)) {
    vatValue = (vatAmount / baseAmount) * 100;
  } else if (!Number.isFinite(vatValue) && Number.isFinite(totalAmount) && Number.isFinite(baseAmount)) {
    vatValue = ((totalAmount - baseAmount) / baseAmount) * 100;
  }
  if (!Number.isFinite(vatValue)) {
    vatValue = 18;
  }

  let netAmount = Number.isFinite(baseAmount) ? baseAmount : NaN;
  if (!Number.isFinite(netAmount) && Number.isFinite(totalAmount)) {
    netAmount = totalAmount / (1 + vatValue / 100);
  }
  if (!Number.isFinite(netAmount)) {
    netAmount = 0;
  }

  return {
    id: invoiceId,
    client: clientName,
    ruc,
    description,
    issueDate: toDateInputValue(issueDateRaw),
    dueDate: toDateInputValue(dueDateRaw),
    amount: String(round(netAmount)),
    vat: String(round(vatValue)),
    paid: '0',
  };
}

function pickXPathText(doc: Document, resolver: XPathNSResolver, expressions: string[]) {
  for (const expression of expressions) {
    const text = getXPathText(doc, expression, resolver);
    if (text) return text;
  }
  return null;
}

function getXPathText(doc: Document, expression: string, resolver: XPathNSResolver) {
  if (typeof doc.evaluate !== 'function') {
    return null;
  }
  const result = doc.evaluate(expression, doc, resolver, XPathResult.STRING_TYPE, null);
  const value = result.stringValue?.trim();
  return value || null;
}

function createNamespaceResolver(doc: Document): XPathNSResolver {
  const namespaces: Record<string, string | null> = {
    ns: doc.documentElement?.namespaceURI ?? 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
    cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    sac: 'urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1',
    ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  };
  return ((prefix: string | null) => {
    if (!prefix) return namespaces.ns;
    return namespaces[prefix] ?? namespaces.ns;
  }) as XPathNSResolver;
}

function parseNumeric(value?: string | null) {
  if (!value) return NaN;
  const compact = value.replace(/\s+/g, '');
  if (!compact) return NaN;
  const normalized =
    compact.includes(',') && compact.includes('.')
      ? compact.replace(/,/g, '')
      : compact.replace(/,/g, '.');
  return Number(normalized);
}

/**
 * Analyzes historical income patterns by month to detect seasonality
 * Returns monthly indices (1.0 = average, >1.0 = above average, <1.0 = below average)
 */
export function analyzeSeasonality(monthlyAggregates: MonthlyAggregate[]): Record<number, number> {
  if (monthlyAggregates.length === 0) {
    // Return neutral indices (all months equal)
    return { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1 };
  }

  // Group by calendar month (1-12)
  const monthlyByCalendar = new Map<number, number[]>();
  for (let i = 1; i <= 12; i++) {
    monthlyByCalendar.set(i, []);
  }

  for (const agg of monthlyAggregates) {
    const [year, month] = agg.month.split('-').map(Number);
    const calendarMonth = month ?? 1;
    const values = monthlyByCalendar.get(calendarMonth) ?? [];
    values.push(agg.income);
    monthlyByCalendar.set(calendarMonth, values);
  }

  // Calculate average income per calendar month
  const monthAverages = new Map<number, number>();
  for (let i = 1; i <= 12; i++) {
    const values = monthlyByCalendar.get(i) ?? [];
    if (values.length > 0) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      monthAverages.set(i, avg);
    } else {
      monthAverages.set(i, 0);
    }
  }

  // Calculate global average income
  const allIncomes = Array.from(monthAverages.values());
  const globalAverage = allIncomes.length > 0 ? allIncomes.reduce((a, b) => a + b, 0) / allIncomes.length : 0;

  // Calculate indices (avoid division by zero)
  const indices: Record<number, number> = {};
  for (let i = 1; i <= 12; i++) {
    const monthAvg = monthAverages.get(i) ?? 0;
    indices[i] = globalAverage > 0 ? round(monthAvg / globalAverage) : 1;
  }

  // Smooth outliers: if any index is > 2.5x or < 0.3x, dampen it
  for (let i = 1; i <= 12; i++) {
    const idx = indices[i];
    if (idx > 2.5) {
      // Extreme high: dampen to 2.0 (still high but more realistic)
      indices[i] = 2.0;
    } else if (idx < 0.3) {
      // Extreme low: dampen to 0.5 (still low but more realistic)
      indices[i] = 0.5;
    }
  }

  return indices;
}

/**
 * Generates a seasonality-aware income projection for future months
 */
export function projectIncomeWithSeasonality(
  monthlyAggregates: MonthlyAggregate[],
  baselineIncome: number,
  projectionMonths: number,
  growthFactorMonthly: number = 1.0, // 1.0 = no growth, 1.01 = 1% monthly growth
): { month: string; projectedIncome: number }[] {
  const seasonalityIndices = analyzeSeasonality(monthlyAggregates);

  // Find the current date to start projection
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const result: { month: string; projectedIncome: number }[] = [];

  for (let i = 1; i <= projectionMonths; i++) {
    const futureDate = new Date(currentYear, currentMonth - 1 + i, 1);
    const futureYear = futureDate.getFullYear();
    const futureMonth = futureDate.getMonth() + 1;
    const monthKey = `${futureYear}-${String(futureMonth).padStart(2, '0')}`;

    // Get seasonality index for this calendar month
    const seasonalityIndex = seasonalityIndices[futureMonth] ?? 1;

    // Apply growth factor for each month passed
    const growthFactor = Math.pow(growthFactorMonthly, i);

    // Project income: baseline * seasonality * growth
    const projectedIncome = round(baselineIncome * seasonalityIndex * growthFactor);

    result.push({ month: monthKey, projectedIncome });
  }

  return result;
}
