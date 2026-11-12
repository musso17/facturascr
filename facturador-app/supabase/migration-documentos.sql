-- ============================================================
-- Comprobantes originales (XML SUNAT) de facturas y egresos.
-- Permite "Ver factura" con todo su detalle: líneas, cuotas,
-- detracción, orden de compra, monto en letras, etc.
-- Tabla aparte para no inflar las consultas de invoices/expenses.
-- Ejecutar UNA VEZ en Supabase: Dashboard → SQL Editor → Run
-- ============================================================

create table if not exists public.source_documents (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid unique references public.invoices (id) on delete cascade,
  expense_id uuid unique references public.expenses (id) on delete cascade,
  file_name text,
  xml text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_documents_one_parent check (num_nonnulls(invoice_id, expense_id) = 1)
);

drop trigger if exists source_documents_set_updated_at on public.source_documents;
create trigger source_documents_set_updated_at
before update on public.source_documents
for each row
execute function public.set_updated_at();

alter table public.source_documents enable row level security;

drop policy if exists "Auth users full access source_documents" on public.source_documents;
create policy "Auth users full access source_documents"
  on public.source_documents
  for all
  to authenticated
  using (true)
  with check (true);
