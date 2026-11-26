-- LSPD MDT v26: organisation-specific uniform variants.
-- A uniform class is not sufficient to determine the concrete garment:
-- the same class can have different garments per organization unit (e.g. GED vs K9).

alter table public.fib_uniform_catalog
  add column if not exists organization_units text[] not null default '{}';

create index if not exists fib_uniform_catalog_org_units_gin_idx
  on public.fib_uniform_catalog using gin (organization_units);

-- Empty organization_units = generic item for every organization unit in the class.
-- A populated array = only the listed organization units may see the item.

notify pgrst, 'reload schema';
