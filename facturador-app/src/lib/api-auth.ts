import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Autenticación por token para la API de solo lectura (P8) y el servidor MCP.
 * El token vive en REPORT_API_TOKEN (env). Se acepta:
 *   - Authorization: Bearer <token>
 *   - x-api-token: <token>
 *   - ?token=<token>  (para el conector MCP, cuyo campo de URL no admite headers)
 */
export function checkApiToken(req: NextRequest): boolean {
  const expected = process.env.REPORT_API_TOKEN;
  if (!expected) return false;
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  const token = bearer ?? req.headers.get('x-api-token') ?? req.nextUrl.searchParams.get('token');
  return token === expected;
}

export function unauthorizedResponse() {
  return NextResponse.json(
    { error: 'No autorizado. Envía el token en Authorization: Bearer <token>.' },
    { status: 401 },
  );
}

/**
 * Cliente Supabase del servidor para la API/MCP de solo lectura.
 *
 * Usa la service role key: las tablas tienen RLS "solo usuarios autenticados",
 * así que con la anon key (sin sesión) Supabase devuelve 0 filas sin error.
 * Por eso el conector "Facturador" respondía cero facturas.
 * La key vive solo en el servidor (SUPABASE_SERVICE_ROLE_KEY, sin NEXT_PUBLIC_)
 * y estas rutas están protegidas con REPORT_API_TOKEN y nunca escriben.
 */
export function serverSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error('Falta NEXT_PUBLIC_SUPABASE_URL en el servidor.');
  }
  if (!key) {
    throw new Error(
      'Falta SUPABASE_SERVICE_ROLE_KEY en el servidor. Sin ella, RLS devuelve 0 filas ' +
        '(Supabase → Project Settings → API → service_role; agrégala en las variables de entorno de Netlify).',
    );
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Valida el query param periodo=YYYY-MM; devuelve null si no viene o es inválido. */
export function parsePeriodo(req: NextRequest): string | null {
  const periodo = req.nextUrl.searchParams.get('periodo');
  if (!periodo) return null;
  return /^\d{4}-\d{2}$/.test(periodo) ? periodo : null;
}
