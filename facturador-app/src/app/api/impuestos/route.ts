import { NextRequest, NextResponse } from 'next/server';
import { checkApiToken, unauthorizedResponse } from '@/lib/api-auth';
import { getImpuestos } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!checkApiToken(req)) return unauthorizedResponse();
  try {
    return NextResponse.json(await getImpuestos());
  } catch (error) {
    console.error('[api/impuestos]', error);
    return NextResponse.json({ error: 'Error interno al listar impuestos.' }, { status: 500 });
  }
}
