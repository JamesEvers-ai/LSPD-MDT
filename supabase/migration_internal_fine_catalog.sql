-- Modularer interner Bußgeldkatalog
create table if not exists public.fib_internal_fine_catalog (
  id text primary key,
  item_type text not null check (item_type in ('category','fine')),
  category_id text null references public.fib_internal_fine_catalog(id) on delete restrict,
  title text not null,
  description text not null default '',
  amount numeric(12,2) null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fib_internal_fine_catalog_type_shape check (
    (item_type = 'category' and category_id is null and amount is null)
    or (item_type = 'fine' and category_id is not null and amount is not null and amount >= 0)
  )
);
create index if not exists fib_internal_fine_catalog_type_order_idx
  on public.fib_internal_fine_catalog(item_type, active, sort_order, title);
create index if not exists fib_internal_fine_catalog_category_idx
  on public.fib_internal_fine_catalog(category_id);
