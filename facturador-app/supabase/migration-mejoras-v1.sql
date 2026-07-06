-- ============================================================
-- Facturador Inteligente — Migración mejoras v1 (P7)
-- Ejecutar UNA VEZ en Supabase: Dashboard → SQL Editor → New query
-- P1 (cliente en egresos) y P4 (detracciones) NO necesitan SQL:
-- usan la columna metadata (jsonb) que ya existe.
-- ============================================================

-- P7: histórico de liquidaciones de utilidades
create table if not exists public.utility_liquidations (
  id uuid primary key default gen_random_uuid(),
  period text not null unique,          -- YYYY-MM (mes de cierre del trimestre)
  excedente numeric not null default 0,
  reserva numeric not null default 0,   -- Reserva Cerezo 20%
  fondo_crecimiento numeric not null default 0,
  utilidad_neta numeric not null default 0,
  payouts jsonb not null default '{}'::jsonb,  -- { marcelo: {bono, utilidad, total}, ... }
  ventas jsonb not null default '{}'::jsonb,   -- ventas atribuidas por socio
  notes text,
  created_at timestamptz not null default now()
);

alter table public.utility_liquidations enable row level security;

-- Mismo modelo de acceso que el resto de tablas de la app (anon key)
drop policy if exists "utility_liquidations_all" on public.utility_liquidations;
create policy "utility_liquidations_all"
  on public.utility_liquidations
  for all
  using (true)
  with check (true);

-- Índices útiles para los reportes por cliente (P1) sobre metadata
create index if not exists idx_expenses_metadata_client
  on public.expenses using gin (metadata);
