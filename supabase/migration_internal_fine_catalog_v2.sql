-- Erweiterung des internen Bußgeldkatalogs zu einem modularen Sanktionskatalog.
-- Bestehende Geldstrafen werden ohne Datenverlust in den neuen Sanktionstyp übernommen.

alter table public.fib_internal_fine_catalog
  add column if not exists sanction_type text,
  add column if not exists sanction_value numeric(12,2),
  add column if not exists sanction_unit text not null default '';

alter table public.fib_internal_fine_catalog
  drop constraint if exists fib_internal_fine_catalog_item_type_check;
alter table public.fib_internal_fine_catalog
  drop constraint if exists fib_internal_fine_catalog_type_shape;

update public.fib_internal_fine_catalog
set item_type = 'sanction'
where item_type = 'fine';

update public.fib_internal_fine_catalog
set sanction_type = 'fine'
where item_type = 'sanction' and sanction_type is null;

-- Bereits vorhandene Rassismus-Einträge werden bei der Migration zwingend als Kündigung klassifiziert.
update public.fib_internal_fine_catalog
set sanction_type = 'termination', amount = null, sanction_value = null, sanction_unit = ''
where item_type = 'sanction'
  and (title || ' ' || description) ~* '(rassism|rassistisch|rassistische)';

alter table public.fib_internal_fine_catalog
  add constraint fib_internal_fine_catalog_item_type_check
  check (item_type in ('category','sanction'));

alter table public.fib_internal_fine_catalog
  add constraint fib_internal_fine_catalog_type_shape check (
    (item_type = 'category' and category_id is null and amount is null and sanction_type is null and sanction_value is null)
    or
    (item_type = 'sanction' and category_id is not null and sanction_type in ('fine','hq_rounds','fort_rounds','human_labs','suspension','termination') and (
      (sanction_type = 'fine' and amount is not null and amount >= 0 and sanction_value is null)
      or (sanction_type in ('hq_rounds','fort_rounds','human_labs','suspension') and amount is null and sanction_value > 0 and length(trim(sanction_unit)) > 0)
      or (sanction_type = 'termination' and amount is null and sanction_value is null)
    ))
  );

create index if not exists fib_internal_fine_catalog_sanction_type_idx
  on public.fib_internal_fine_catalog(sanction_type, active, sort_order);

-- Klar definierte Standardregel: Rassismus ist ein kündigungswürdiges Dienstvergehen.
insert into public.fib_internal_fine_catalog
  (id,item_type,category_id,title,description,amount,sanction_type,sanction_value,sanction_unit,active,sort_order,created_at,updated_at)
values
  ('IFC_DISCIPLINARY_TERMINATION','category',null,'Kündigungswürdige Dienstvergehen','Schwerwiegende Verstöße, die zur Beendigung des Dienstverhältnisses führen.',null,null,null,'',true,900,now(),now())
on conflict (id) do nothing;

insert into public.fib_internal_fine_catalog
  (id,item_type,category_id,title,description,amount,sanction_type,sanction_value,sanction_unit,active,sort_order,created_at,updated_at)
values
  ('IFC_DISCIPLINARY_RACISM','sanction','IFC_DISCIPLINARY_TERMINATION','Rassismus / rassistische Äußerungen','Rassistische Handlungen, Äußerungen oder Diskriminierung führen zur Kündigung.',null,'termination',null,'',true,10,now(),now())
on conflict (id) do nothing;
