-- LSPD MDT v27: canonical organization-unit list for the uniform catalog.
-- The personnel system uses exactly these organization/division labels.
-- No new class assignment is invented here: existing class rules remain authoritative.

create table if not exists public.fib_uniform_organization_registry (
  organization_unit text primary key,
  active boolean not null default true,
  sort_order integer not null default 100
);

insert into public.fib_uniform_organization_registry (organization_unit, sort_order) values
('Internal Affairs Division',10),
('Central Division',20),
('Northern Division',30),
('Patrol Division',40),
('Investigative Division',50),
('Metropolitan Division',60),
('Support Division',70),
('Internal Affairs',80),
('Patrol Unit',90),
('Detective Bureau',100),
('Special Weapons and Tactics',110),
('Gang Enforcement Detail',120),
('Canine (K9)',130),
('Police Academy',140),
('Public Relations Office',150),
('Air Support Division',160),
('High Command',170)
on conflict (organization_unit) do update set active=true, sort_order=excluded.sort_order;

create index if not exists fib_uniform_org_registry_sort_idx
  on public.fib_uniform_organization_registry(active, sort_order);

notify pgrst, 'reload schema';
