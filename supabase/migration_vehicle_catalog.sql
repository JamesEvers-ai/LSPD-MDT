-- LSPD MDT Phase 3.56: Fahrzeugkatalog
-- Im Supabase SQL Editor vollständig ausführen.
create table if not exists public.fib_vehicle_catalog (
  id text primary key,
  name text not null,
  vehicle_class text not null check (vehicle_class in ('STR','STR (UM)','OFF','OFF (UM)','HSP','HSP (UM)','OVW')),
  image_url text,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fib_vehicle_catalog_active_class_idx
  on public.fib_vehicle_catalog (active, vehicle_class, name);

alter table public.fib_vehicle_catalog enable row level security;
-- Zugriffe erfolgen ausschließlich über die Cloudflare Pages Function mit Service-Role-Key.
drop policy if exists "fib_vehicle_catalog_no_direct_access" on public.fib_vehicle_catalog;
create policy "fib_vehicle_catalog_no_direct_access"
  on public.fib_vehicle_catalog for all
  using (false) with check (false);

notify pgrst, 'reload schema';
