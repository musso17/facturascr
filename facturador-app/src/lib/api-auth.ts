import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Autenticación por token para la API de solo lectura (P8).
 * El token vive en REPORT_API_TOKEN (env). Se acepta:
 *   - Authorization: Bearer <token>
 *   - x-api-token: <token>
 */
export function checkApiToken(req: NextRequest): boolean {
  const expected = process.env.REPORT_API_TOKEN;
  if (!expected) return false;
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  const token = bearer ?? req.headers.get('x-api-token');
  return token === expected;
}

export function unauthorizedResponse() {
  return NextResponse.json(
    { error: 'No autorizado. Envía el token en Authorization: Bearer <token>.' },
    { status: 401 },
  );
}

export function serverSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase env vars faltantes en el servidor.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Valida el query param periodo=YYYY-MM; devuelve null si no viene o es inválido. */
export function parsePeriodo(req: NextRequest): string | null {
  const periodo = req.nextUrl.searchParams.get('periodo');
  if (!periodo) return null;
  return /^\d{4}-\d{2}$/.test(periodo) ? periodo : null;
}
