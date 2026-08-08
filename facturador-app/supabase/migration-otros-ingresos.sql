-- ============================================================
-- Otros ingresos (gestión) — dinero que impacta la utilidad
-- pero NO pasa por facturación ni por los módulos fiscales.
-- Ejecutar UNA VEZ en Supabase: Dashboard → SQL Editor → Run
-- ============================================================

create table if not exists public.management_incomes (
  id uuid primary key default gen_random_uuid(),
  income_date date not null,
  amount numeric not null,
  description text not null,
  client_id uuid,          -- opcional: para margen por cliente
  client_name text,
  created_at timestamptz not null default now()
);

alter table public.management_incomes enable row level security;

drop policy if exists "management_incomes_all" on public.management_incomes;
create policy "management_incomes_all"
  on public.management_incomes
  for all
  using (true)
  with check (true);
