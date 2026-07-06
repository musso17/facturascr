import { NextRequest, NextResponse } from 'next/server';
import { checkApiToken, parsePeriodo, serverSupabase, unauthorizedResponse } from '@/lib/api-auth';
import { mapInvoiceRow } from '@/lib/accounting-service';
import { calcDetraction } from '@/lib/detraction';
import { SupabaseInvoiceRow } from '@/lib/accounting-types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!checkApiToken(req)) return unauthorizedResponse();

  try {
    const supabase = serverSupabase();
    const periodo = parsePeriodo(req);

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
          ? { monto: detraction.detractionAmount, depositada: inv.detractionDeposited ?? false }
          : null,
      };
    });

    return NextResponse.json({ periodo: periodo ?? 'todos', cantidad: items.length, items });
  } catch (error) {
    console.error('[api/ingresos]', error);
    return NextResponse.json({ error: 'Error interno al listar ingresos.' }, { status: 500 });
  }
}
