import { NextRequest, NextResponse } from 'next/server';
import { checkApiToken, unauthorizedResponse } from '@/lib/api-auth';
import { getResumen } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!checkApiToken(req)) return unauthorizedResponse();
  try {
    return NextResponse.json(await getResumen());
  } catch (error) {
    console.error('[api/resumen]', error);
    return NextResponse.json({ error: 'Error interno al generar el resumen.' }, { status: 500 });
  }
}
