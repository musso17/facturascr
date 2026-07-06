import { NextRequest, NextResponse } from 'next/server';
import { checkApiToken, parsePeriodo, serverSupabase, unauthorizedResponse } from '@/lib/api-auth';
import { SupabaseExpenseRow } from '@/lib/accounting-types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!checkApiToken(req)) return unauthorizedResponse();

  try {
    const supabase = serverSupabase();
    const periodo = parsePeriodo(req);

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

    return NextResponse.json({ periodo: periodo ?? 'todos', cantidad: items.length, items });
  } catch (error) {
    console.error('[api/egresos]', error);
    return NextResponse.json({ error: 'Error interno al listar egresos.' }, { status: 500 });
  }
}
