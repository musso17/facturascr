/**
 * Lógica de reportes de solo lectura, compartida entre:
 *  - La API REST (/api/resumen, /api/ingresos, /api/egresos, /api/impuestos)
 *  - El servidor MCP (/api/mcp), para usar Claude en el celular conectado al Facturador
 *
 * Nunca escribe datos — solo lee de Supabase con la anon key del servidor.
 */
import { mapInvoiceRow, summarizeInvoices } from './accounting-service';
import { calcDetraction } from './detraction';
import { getCollectionBreakdown } from './collection';
import { serverSupabase } from './api-auth';
import { SupabaseExpenseRow, SupabaseInvoiceRow } from './accounting-types';

export async function getResumen() {
  const supabase = serverSupabase();
  const year = String(new Date().getFullYear());

  const [invoicesRes, expensesRes, otherIncomesRes] = await Promise.all([
    supabase.from('invoices').select('*'),
    supabase.from('expenses').select('*'),
    supabase.from('management_incomes').select('income_date,amount'),
  ]);
  if (invoicesRes.error) throw invoicesRes.error;
  if (expensesRes.error) throw expensesRes.error;

  const invoices = ((invoicesRes.data ?? []) as SupabaseInvoiceRow[]).map(mapInvoiceRow);
  const expenses = (expensesRes.data ?? []) as SupabaseExpenseRow[];
  // Tolerante a tabla ausente (migración opcional)
  const otherIncomesRows = otherIncomesRes.error
    ? []
    : ((otherIncomesRes.data ?? []) as { income_date: string; amount: number }[]);

  const yearInvoices = invoices.filter((inv) => inv.issueDate.startsWith(year));
  const yearExpenses = expenses.filter((e) => e.issue_date.startsWith(year));
  const otrosIngresos = otherIncomesRows
    .filter((i) => i.income_date.startsWith(year))
    .reduce((s, i) => s + (Number(i.amount) || 0), 0);

  const totals = summarizeInvoices(yearInvoices);
  const gastos = yearExpenses.reduce((s, e) => s + (e.total_amount || 0), 0);
  const gastosPagados = yearExpenses.reduce(
    (s, e) => s + (e.status === 'pagado' ? e.total_amount || 0 : e.paid_amount || 0),
    0,
  );

  const igvVentas = yearInvoices.reduce((s, inv) => s + (inv.total - inv.amount), 0);
  const igvCompras = yearExpenses.reduce((s, e) => s + (e.igv_amount || 0), 0);
  const igvPorPagar = Math.max(0, igvVentas - igvCompras);
  // Los otros ingresos de gestión no entran al IGV ni al pago a cuenta de renta
  const pagoCuentaRenta = yearInvoices.reduce((s, inv) => s + inv.amount, 0) * 0.01;
  const cajaReal = totals.pagado + otrosIngresos - gastosPagados - igvPorPagar - pagoCuentaRenta;

  const vencidas = yearInvoices
    .filter((inv) => inv.status === 'Vencido')
    .map((inv) => ({
      factura: inv.id,
      cliente: inv.client,
      saldo: inv.balance,
      vencimiento: inv.dueDate,
    }));

  return {
    generadoEl: new Date().toISOString(),
    anio: Number(year),
    ingresos: {
      facturado: totals.facturado,
      cobrado: totals.pagado,
      pendiente: totals.pendiente,
      vencido: totals.vencido,
      facturas: yearInvoices.length,
    },
    egresos: {
      total: gastos,
      pagado: gastosPagados,
      pendiente: Math.max(gastos - gastosPagados, 0),
      registros: yearExpenses.length,
    },
    otrosIngresosGestion: otrosIngresos,
    utilidadDevengada: totals.facturado + otrosIngresos - gastos,
    cajaReal,
    impuestos: {
      igvVentas,
      igvCompras,
      igvPorPagar,
      pagoCuentaRenta1pct: pagoCuentaRenta,
    },
    facturasVencidas: vencidas,
  };
}

export async function getIngresos(periodo: string | null) {
  const supabase = serverSupabase();

  let query = supabase.from('invoices').select('*').order('issue_date', { ascending: false });
  if (periodo) {
    const [year, month] = periodo.split('-').map(Number);
    const start = `${periodo}-01`;
    const end = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    query = query.gte('issue_date', start).lt('issue_date', end);
  }

  const { data, error } = await query;
  if (error) throw error;

  const items = ((data ?? []) as SupabaseInvoiceRow[]).map(mapInvoiceRow).map((inv) => {
    const detraction = calcDetraction(inv.total);
    const breakdown = getCollectionBreakdown(inv);
    return {
      factura: inv.id,
      cliente: inv.client,
      ruc: inv.ruc,
      descripcion: inv.description,
      emision: inv.issueDate,
      vencimiento: inv.dueDate,
      base: inv.amount,
      total: inv.total,
      cobrado: inv.paid,
      saldo: inv.balance,
      estado: inv.status,
      detraccion: detraction.applies
        ? {
            monto: detraction.detractionAmount,
            estado: inv.detractionStatus ?? 'sin_verificar',
            depositada: inv.detractionStatus === 'depositada',
            constancia: inv.detractionReceipt ?? null,
          }
        : null,
      retencionIGV: inv.igvRetention
        ? { monto: inv.igvRetention, comprobante: inv.retentionReceipt ?? null }
        : null,
      netoCuentaCorriente: breakdown.netToAccount,
      cuentaDestino: inv.paymentAccount ?? null,
      fechaCobro: inv.paymentDate ?? null,
    };
  });

  return { periodo: periodo ?? 'todos', cantidad: items.length, items };
}

export async function getEgresos(periodo: string | null) {
  const supabase = serverSupabase();

  let query = supabase.from('expenses').select('*').order('issue_date', { ascending: false });
  if (periodo) {
    const [year, month] = periodo.split('-').map(Number);
    const start = `${periodo}-01`;
    const end = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    query = query.gte('issue_date', start).lt('issue_date', end);
  }

  const { data, error } = await query;
  if (error) throw error;

  const items = ((data ?? []) as SupabaseExpenseRow[]).map((row) => {
    const meta = (row.metadata ?? {}) as { client_name?: string | null };
    return {
      documento: row.document_series
        ? `${row.document_series}-${row.document_number}`
        : row.document_number,
      tipo: row.document_type,
      proveedor: row.provider_name,
      documentoProveedor: row.provider_document,
      concepto: row.concept,
      categoria: row.category,
      clienteAtribuido: meta.client_name ?? null,
      emision: row.issue_date,
      vencimiento: row.due_date,
      base: row.base_amount,
      igv: row.igv_amount,
      retencionIR: row.ir_retention,
      total: row.total_amount,
      pagado: row.status === 'pagado' ? row.total_amount : row.paid_amount,
      estado: row.status,
      metodoPago: row.payment_method,
    };
  });

  return { periodo: periodo ?? 'todos', cantidad: items.length, items };
}

export async function getImpuestos() {
  const supabase = serverSupabase();
  const { data, error } = await supabase
    .from('v_monthly_tax_liabilities')
    .select('*')
    .order('period', { ascending: false });
  if (error) throw error;

  const items = (data ?? []).map((row) => ({
    periodo: String(row.period).slice(0, 7),
    ventasGravadas: Number(row.taxable_sales) || 0,
    igvVentas: Number(row.igv_sales) || 0,
    comprasGravadas: Number(row.taxable_purchases) || 0,
    igvCompras: Number(row.igv_purchases) || 0,
    igvPorPagar: Number(row.igv_payable) || 0,
    retencionesIR: Number(row.ir_retention_expenses) || 0,
  }));

  return { cantidad: items.length, items };
}
