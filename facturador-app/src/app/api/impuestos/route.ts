import { NextRequest, NextResponse } from 'next/server';
import { checkApiToken, serverSupabase, unauthorizedResponse } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!checkApiToken(req)) return unauthorizedResponse();

  try {
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

    return NextResponse.json({ cantidad: items.length, items });
  } catch (error) {
    console.error('[api/impuestos]', error);
    return NextResponse.json({ error: 'Error interno al listar impuestos.' }, { status: 500 });
  }
}
