-- ============================================================
-- Cobranza: retención IGV, estado real de la detracción,
-- cuenta destino de cada cobro y alias bancarios por cliente.
-- Ejecutar UNA VEZ en Supabase: Dashboard → SQL Editor → Run
-- (es idempotente: se puede volver a correr sin romper nada)
-- ============================================================

-- 1. Facturas de venta
alter table public.invoices
  -- Retención del IGV (3%) que practica un cliente agente de retención.
  -- Se descuenta del IGV por pagar del mes (no de la renta).
  add column if not exists igv_retention numeric(12, 2) not null default 0,
  add column if not exists retention_receipt text,     -- N° comprobante de retención (R001-…)
  -- Estado real de la detracción: null = sin verificar
  add column if not exists detraction_status text,
  add column if not exists detraction_receipt text,    -- N° constancia de depósito del BN
  -- Cuenta a la que entró el cobro (payment_date y payment_reference ya existían)
  add column if not exists payment_account text;

alter table public.invoices drop constraint if exists invoices_detraction_status_check;
alter table public.invoices
  add constraint invoices_detraction_status_check
  check (detraction_status is null or detraction_status in ('pendiente', 'depositada', 'no_aplicada'));

-- Conserva lo que ya estaba marcado con la casilla antigua
update public.invoices
set detraction_status = 'depositada'
where detraction_status is null
  and coalesce((metadata ->> 'detraction_deposited')::boolean, false);

-- 2. Clientes: agente de retención y cómo aparecen en el extracto del banco
alter table public.partners
  add column if not exists is_retention_agent boolean not null default false,
  -- Textos con los que el banco muestra sus pagos ("Corrección de comisiones",
  -- "Martel-Espino-Silva", "Abono por traspaso"…). Se buscan dentro de la glosa.
  add column if not exists bank_aliases text[] not null default '{}';

-- 3. Seguridad: estas tablas tenían políticas abiertas a cualquiera con la
--    anon key (que es pública: viaja en el código del navegador). Se limitan a
--    usuarios autenticados, igual que invoices/expenses. La API/MCP del
--    servidor usa la service role key, así que no se ve afectada.
drop policy if exists "Allow all for authenticated" on public.bank_transactions;
create policy "Allow all for authenticated" on public.bank_transactions
  for all to authenticated using (true) with check (true);

drop policy if exists "Allow all for authenticated" on public.reconciliations;
create policy "Allow all for authenticated" on public.reconciliations
  for all to authenticated using (true) with check (true);

drop policy if exists "management_incomes_all" on public.management_incomes;
create policy "management_incomes_all" on public.management_incomes
  for all to authenticated using (true) with check (true);
