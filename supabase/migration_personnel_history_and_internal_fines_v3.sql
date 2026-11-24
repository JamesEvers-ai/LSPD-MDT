-- LSPD MDT v3: Personalakten-Historie + robuste Mehrfach-Sanktionen
-- Idempotent ausführbar.

create table if not exists public.personnel_history (
  id text primary key,
  user_id text not null,
  action text not null,
  detail text not null default '',
  actor_id text,
  actor_name text not null default 'System',
  created_at timestamptz not null default now()
);

create index if not exists personnel_history_user_created_idx
  on public.personnel_history(user_id, created_at desc);
create index if not exists personnel_history_created_idx
  on public.personnel_history(created_at desc);

-- Mehrere Maßnahmen pro Katalogeintrag erlauben.
alter table public.fib_internal_fine_catalog
  add column if not exists sanction_components jsonb not null default '[]'::jsonb;

update public.fib_internal_fine_catalog
set sanction_components = case
  when item_type <> 'sanction' then '[]'::jsonb
  when sanction_type = 'fine' then jsonb_build_array(jsonb_build_object('type','fine','label','Geldstrafe','amount',amount))
  when sanction_type = 'hq_rounds' then jsonb_build_array(jsonb_build_object('type','hq_rounds','label','HQ-Runden','value',sanction_value,'unit',sanction_unit))
  when sanction_type = 'fort_rounds' then jsonb_build_array(jsonb_build_object('type','fort_rounds','label','Fort-Runden','value',sanction_value,'unit',sanction_unit))
  when sanction_type = 'human_labs' then jsonb_build_array(jsonb_build_object('type','human_labs','label','Human Labs','value',sanction_value,'unit',sanction_unit))
  when sanction_type = 'suspension' then jsonb_build_array(jsonb_build_object('type','suspension','label','Suspendierung','value',sanction_value,'unit',sanction_unit))
  when sanction_type = 'termination' then jsonb_build_array(jsonb_build_object('type','termination','label','Kündigung'))
  else '[]'::jsonb
end
where sanction_components = '[]'::jsonb;

alter table public.fib_internal_fine_catalog
  drop constraint if exists fib_internal_fine_catalog_type_shape;

alter table public.fib_internal_fine_catalog
  add constraint fib_internal_fine_catalog_type_shape check (
    (item_type = 'category' and category_id is null and amount is null and sanction_type is null and sanction_value is null and jsonb_typeof(sanction_components) = 'array')
    or
    (item_type = 'sanction' and category_id is not null and jsonb_typeof(sanction_components) = 'array' and (
      (sanction_type = 'composite' and amount is null and sanction_value is null and jsonb_array_length(sanction_components) >= 2)
      or (sanction_type = 'fine' and amount is not null and amount >= 0 and sanction_value is null and jsonb_array_length(sanction_components) = 1)
      or (sanction_type in ('hq_rounds','fort_rounds','human_labs','suspension') and amount is null and sanction_value > 0 and length(trim(sanction_unit)) > 0 and jsonb_array_length(sanction_components) = 1)
      or (sanction_type = 'termination' and amount is null and sanction_value is null and jsonb_array_length(sanction_components) = 1)
    ))
  );

create index if not exists fib_internal_fine_catalog_components_gin
  on public.fib_internal_fine_catalog using gin (sanction_components);

notify pgrst, 'reload schema';
