-- Enable uuid generation if needed
create extension if not exists "pgcrypto";

-- Reusable trigger to keep updated_at in sync
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Enumerations for the accounting domain
create type public.accounting_status as enum ('pendiente', 'pagado', 'vencido');
create type public.expense_document_type as enum ('factura', 'recibo', 'boleta');
create type public.expense_category as enum (
  'servicios',
  'materiales',
  'personal',
  'marketing',
  'administrativos',
  'equipos'
);
create type public.partner_role as enum ('cliente', 'proveedor', 'ambos');
create type public.document_type as enum ('ruc', 'dni', 'carnet_extranjeria', 'pasaporte', 'otros');
create type public.payment_method as enum (
  'transferencia',
  'deposito',
  'efectivo',
  'tarjeta',
  'cheque',
  'yape_plin',
  'otros'
);

-- Business partners (clients / suppliers / professionals)
create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  role public.partner_role not null default 'cliente',
  name text not null,
  trade_name text,
  document_type public.document_type not null,
  document_number text not null,
  email text,
  phone text,
  address text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_number)
);

create trigger partners_set_updated_at
before update on public.partners
for each row
execute function public.set_updated_at();

-- Main expenses table
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  document_type public.expense_document_type not null,
  document_series text,
  document_number text not null,
  issue_date date not null,
  due_date date,
  partner_id uuid references public.partners (id) on delete set null,
  provider_name text not null,
  provider_document text,
  concept text not null,
  payment_method public.payment_method,
  operation_number text,
  payment_date date,
  base_amount numeric(12, 2) not null default 0,
  igv_amount numeric(12, 2) not null default 0,
  ir_retention numeric(12, 2) not null default 0,
  other_taxes numeric(12, 2) not null default 0,
  total_amount numeric(12, 2) not null default 0,
  category public.expense_category not null default 'servicios',
  status public.accounting_status not null default 'pendiente',
  paid_amount numeric(12, 2) not null default 0,
  notes text,
  attachments jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_positive_amounts check (
    base_amount >= 0
    and igv_amount >= 0
    and ir_retention >= 0
    and other_taxes >= 0
    and total_amount >= 0
  )
);

create index if not exists expenses_issue_date_idx on public.expenses (issue_date);
create index if not exists expenses_due_date_idx on public.expenses (due_date);
create index if not exists expenses_status_idx on public.expenses (status);
create index if not exists expenses_category_idx on public.expenses (category);

create trigger expenses_set_updated_at
before update on public.expenses
for each row
execute function public.set_updated_at();

-- Optional detail of payments applied to expenses
create table if not exists public.expense_payments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  payment_method public.payment_method not null,
  amount numeric(12, 2) not null check (amount > 0),
  paid_at date not null default (now()::date),
  operation_number text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists expense_payments_expense_idx on public.expense_payments (expense_id);

-- Extend existing invoices table with accounting fields
alter table public.invoices
  add column if not exists client_id uuid references public.partners (id) on delete set null,
  add column if not exists category text,
  add column if not exists payment_method public.payment_method,
  add column if not exists payment_reference text,
  add column if not exists payment_date date,
  add column if not exists status public.accounting_status not null default 'pendiente',
  add column if not exists retention_ir numeric(12, 2) not null default 0,
  add column if not exists itf numeric(12, 2) not null default 0,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists invoices_issue_date_idx on public.invoices (issue_date);
create index if not exists invoices_due_date_idx on public.invoices (due_date);
create index if not exists invoices_status_idx on public.invoices (status);

create trigger invoices_set_updated_at
before update on public.invoices
for each row
execute function public.set_updated_at();

-- Normalize legacy rows
update public.invoices
set status = 'pagado'
where status = 'pendiente' and total is not null and paid is not null and paid >= total;

update public.invoices
set status = 'vencido'
where status = 'pendiente'
  and due_date is not null
  and (due_date::date) < (now()::date);

-- Tax summary view (monthly IGV / IR balances)
create or replace view public.v_monthly_tax_liabilities as
with invoice_data as (
  select
    date_trunc('month', issue_date::date)::date as period,
    sum(amount) as taxable_sales,
    sum((amount) * coalesce(vat, 0) / 100) as igv_sales,
    sum(retention_ir) as ir_withheld_sales
  from public.invoices
  group by 1
),
expense_data as (
  select
    date_trunc('month', issue_date)::date as period,
    sum(base_amount) as taxable_purchases,
    sum(igv_amount) as igv_purchases,
    sum(ir_retention) as ir_retention_expenses
  from public.expenses
  group by 1
)
select
  coalesce(i.period, e.period) as period,
  coalesce(i.taxable_sales, 0) as taxable_sales,
  coalesce(i.igv_sales, 0) as igv_sales,
  coalesce(e.taxable_purchases, 0) as taxable_purchases,
  coalesce(e.igv_purchases, 0) as igv_purchases,
  coalesce(i.igv_sales, 0) - coalesce(e.igv_purchases, 0) as igv_payable,
  coalesce(e.ir_retention_expenses, 0) as ir_retention_expenses,
  coalesce(i.ir_withheld_sales, 0) as ir_withheld_sales
from invoice_data i
full join expense_data e on i.period = e.period
order by period desc;
