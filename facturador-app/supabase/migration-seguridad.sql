-- ============================================================
-- Seguridad: nada debe ser accesible con la anon key (es pública,
-- viaja en el código del navegador). La app usa la sesión del usuario
-- (rol authenticated) y la API/MCP del servidor la service role key.
-- Complementa la sección 3 de migration-cobranza.sql.
-- Aplicada el 2026-11-12. Es idempotente.
-- ============================================================

-- Liquidaciones de utilidades (pagos a socios): estaba abierta a cualquiera
drop policy if exists "utility_liquidations_all" on public.utility_liquidations;
create policy "utility_liquidations_all" on public.utility_liquidations
  for all to authenticated using (true) with check (true);

-- Proyectos: tenía una política "Allow all" abierta además de la de autenticados
drop policy if exists "Allow all" on public.projects;

-- Vista de impuestos mensuales: las vistas corren con los permisos de su dueño
-- (postgres) y se saltaban el RLS de invoices/expenses. Con security_invoker
-- respetan los permisos de quien consulta.
alter view public.v_monthly_tax_liabilities set (security_invoker = true);
revoke all on public.v_monthly_tax_liabilities from anon;

-- Bucket público sin uso en el código (XML de prueba de E001-254): privado.
-- Los XML ahora viven en la tabla source_documents, protegida por RLS.
update storage.buckets set public = false where id = 'facturador-inteligente';

-- Funciones de trigger con search_path fijo (aviso del linter de Supabase).
-- Solo usan now(), que está siempre en pg_catalog.
alter function public.set_updated_at() set search_path = '';
alter function public.trigger_set_timestamp() set search_path = '';
