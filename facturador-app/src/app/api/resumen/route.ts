import { NextRequest, NextResponse } from 'next/server';
import { checkApiToken, serverSupabase, unauthorizedResponse } from '@/lib/api-auth';
import { mapInvoiceRow, summarizeInvoices } from '@/lib/accounting-service';
import { SupabaseExpenseRow, SupabaseInvoiceRow } from '@/lib/accounting-types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!checkApiToken(req)) return unauthorizedResponse();

  try {
    const supabase = serverSupabase();
    const year = String(new Date().getFullYear());

    const [invoicesRes, expensesRes] = await Promise.all([
      supabase.from('invoices').select('*'),
      supabase.from('expenses').select('*'),
    ]);
    if (invoicesRes.error) throw invoicesRes.error;
    if (expensesRes.error) throw expensesRes.error;

    const invoices = ((invoicesRes.data ?? []) as SupabaseInvoiceRow[]).map(mapInvoiceRow);
    const expenses = (expensesRes.data ?? []) as SupabaseExpenseRow[];

    const yearInvoices = invoices.filter((inv) => inv.issueDate.startsWith(year));
    const yearExpenses = expenses.filter((e) => e.issue_date.startsWith(year));

    const totals = summarizeInvoices(yearInvoices);
    const gastos = yearExpenses.reduce((s, e) => s + (e.total_amount || 0), 0);
    const gastosPagados = yearExpenses.reduce(
      (s, e) => s + (e.status === 'pagado' ? e.total_amount || 0 : e.paid_amount || 0),
      0,
    );

    const igvVentas = yearInvoices.reduce((s, inv) => s + (inv.total - inv.amount), 0);
    const igvCompras = yearExpenses.reduce((s, e) => s + (e.igv_amount || 0), 0);
    const igvPorPagar = Math.max(0, igvVentas - igvCompras);
    const pagoCuentaRenta = yearInvoices.reduce((s, inv) => s + inv.amount, 0) * 0.01;
    const cajaReal = totals.pagado - gastosPagados - igvPorPagar - pagoCuentaRenta;

    const vencidas = yearInvoices
      .filter((inv) => inv.status === 'Vencido')
      .map((inv) => ({
        factura: inv.id,
        cliente: inv.client,
        saldo: inv.balance,
        vencimiento: inv.dueDate,
      }));

    return NextResponse.json({
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
      utilidadDevengada: totals.facturado - gastos,
      cajaReal,
      impuestos: {
        igvVentas,
        igvCompras,
        igvPorPagar,
        pagoCuentaRenta1pct: pagoCuentaRenta,
      },
      facturasVencidas: vencidas,
    });
  } catch (error) {
    console.error('[api/resumen]', error);
    return NextResponse.json({ error: 'Error interno al generar el resumen.' }, { status: 500 });
  }
}
