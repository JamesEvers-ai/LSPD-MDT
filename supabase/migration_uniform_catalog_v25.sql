-- LSPD MDT v25: Dienstkleidung / Uniform catalog
-- Source of the organization rules: supplied LSPD uniform regulation overview.

create table if not exists public.fib_uniform_catalog (
  id text primary key,
  name text not null,
  uniform_class text not null,
  description text,
  image_url text,
  active boolean not null default true,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fib_uniform_catalog_class_chk check (uniform_class in ('A','B','C','D','E','F'))
);

create table if not exists public.fib_uniform_organization_rules (
  id text primary key,
  organization_unit text not null unique,
  regular_class text not null,
  supplementary_classes text[] not null default '{}',
  source_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fib_uniform_catalog_class_active_idx
  on public.fib_uniform_catalog(uniform_class, active, name);
create index if not exists fib_uniform_org_rules_name_idx
  on public.fib_uniform_organization_rules(organization_unit);

insert into public.fib_uniform_organization_rules
(id, organization_unit, regular_class, supplementary_classes, source_note)
values
('UORG_CENTRAL_PATROL','Central Division – Patrol Division','B',array['A','C','E'],'Regelmäßige Uniformklasse B; ergänzend A, C, E.'),
('UORG_NORTHERN_PATROL','Northern Division – Patrol Division','B',array['A','C','E'],'Regelmäßige Uniformklasse B; ergänzend A, C, E.'),
('UORG_INVESTIGATIVE_DETECTIVE','Investigative Division – Detective Bureau','D',array['A','B','C'],'Regelmäßige Uniformklasse D; ergänzend A, B, C.'),
('UORG_METRO_SWAT','Metropolitan Division – S.W.A.T.','C',array['A','E','F'],'Regelmäßige Uniformklasse C; ergänzend A, E, F.'),
('UORG_METRO_GANG','Metropolitan Division – Gang Enforcement Detail','B',array['C','D','E','F'],'Regelmäßige Uniformklasse B; ergänzend C, D, E, F.'),
('UORG_METRO_K9','Metropolitan Division – K9 Unit','B',array['C','E','F'],'Regelmäßige Uniformklasse B; ergänzend C, E, F.'),
('UORG_SUPPORT_ACADEMY','Support Division – Police Academy','B / E',array['A','C'],'Regelmäßige Uniformklassen B / E; ergänzend A, C.'),
('UORG_SUPPORT_AIR','Support Division – Air Support Unit','B',array['E','F'],'Regelmäßige Uniformklasse B; ergänzend E, F.'),
('UORG_SUPPORT_PR','Support Division – Public Relations Office','A / B',array['D'],'Regelmäßige Uniformklassen A / B; ergänzend D.'),
('UORG_IA','Internal Affairs Division','B / D',array['A','C'],'Regelmäßige Uniformklassen B / D; ergänzend A, C.'),
('UORG_HIGH_COMMAND','High Command','A / B',array['C','D'],'Regelmäßige Uniformklassen A / B; ergänzend C, D.')
on conflict (organization_unit) do update set
  regular_class=excluded.regular_class,
  supplementary_classes=excluded.supplementary_classes,
  source_note=excluded.source_note,
  updated_at=now();

insert into public.permissions (id,key,name,label,description,category)
values
('P_LSPD_375_UNIFORM_VIEW','uniforms.view','Dienstkleidung ansehen','Dienstkleidung ansehen','Persönliche Dienstkleidung und Uniformklassen einsehen','Personal'),
('P_LSPD_375_UNIFORM_MANAGE','uniforms.manage','Dienstkleidung verwalten','Dienstkleidung verwalten','Dienstkleidungs-Katalog und Bildmaterial verwalten','Personal')
on conflict (key) do update set
  name=excluded.name,
  label=excluded.label,
  description=excluded.description,
  category=excluded.category;

notify pgrst, 'reload schema';
