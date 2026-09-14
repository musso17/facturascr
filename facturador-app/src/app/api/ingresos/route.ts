import { NextRequest, NextResponse } from 'next/server';
import { checkApiToken, parsePeriodo, unauthorizedResponse } from '@/lib/api-auth';
import { getIngresos } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!checkApiToken(req)) return unauthorizedResponse();
  try {
    return NextResponse.json(await getIngresos(parsePeriodo(req)));
  } catch (error) {
    console.error('[api/ingresos]', error);
    return NextResponse.json({ error: 'Error interno al listar ingresos.' }, { status: 500 });
  }
}
