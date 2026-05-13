-- Migration 002: Projects Schema

-- Enums for project status and billing status
create type public.project_status as enum ('en_progreso', 'completado', 'cancelado');
create type public.project_billing_status as enum ('pendiente', 'parcial', 'facturado');

-- Projects table
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_id uuid references public.partners (id) on delete set null,
  description text,
  status public.project_status not null default 'en_progreso',
  billing_status public.project_billing_status not null default 'pendiente',
  expected_amount numeric(12, 2) not null default 0,
  due_date date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_status_idx on public.projects (status);
create index if not exists projects_billing_status_idx on public.projects (billing_status);
create index if not exists projects_client_id_idx on public.projects (client_id);

create trigger projects_set_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

-- Link invoices to projects (optional)
alter table public.invoices
  add column if not exists project_id uuid references public.projects (id) on delete set null;

create index if not exists invoices_project_id_idx on public.invoices (project_id);
