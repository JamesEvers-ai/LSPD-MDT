-- LSPD MDT: page-level permissions and centralized audit log.
-- Safe to execute repeatedly; existing records and permission assignments are retained.

create table if not exists public.fib_mdt_logs (
  id text primary key,
  action text not null,
  module_name text not null,
  item_id text,
  detail text not null default '',
  actor_id text,
  actor_name text not null default 'System',
  created_at timestamptz not null default now()
);

alter table public.fib_mdt_logs
  add column if not exists actor_id text,
  add column if not exists actor_name text not null default 'System',
  add column if not exists module_name text,
  add column if not exists item_id text,
  add column if not exists detail text not null default '',
  add column if not exists action text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists fib_mdt_logs_created_at_idx
  on public.fib_mdt_logs(created_at desc);
create index if not exists fib_mdt_logs_actor_id_idx
  on public.fib_mdt_logs(actor_id);
create index if not exists fib_mdt_logs_module_name_idx
  on public.fib_mdt_logs(module_name);

-- Every application area has an explicit view permission. Manage permissions
-- are separate so read-only access never implies write access.
insert into public.permissions (id, key, name, label, description, category)
values
 ('P_LSPD_DASH_VIEW','dashboard.view','Dashboard ansehen','Dashboard ansehen','Dashboard und Kennzahlen lesen','Übersicht'),
 ('P_LSPD_PATROL_VIEW','patrols.view','Leitstelle ansehen','Leitstelle ansehen','Leitstelle und Streifenübersicht lesen','Leitstelle'),
 ('P_LSPD_PATROL_MANAGE','patrols.manage','Leitstelle verwalten','Leitstelle verwalten','Streifen und Leitstellenstatus verwalten','Leitstelle'),
 ('P_LSPD_OFFICERS_VIEW','officers.view','Personalakten ansehen','Personalakten ansehen','Personalübersicht und Personalakten lesen','Personal'),
 ('P_LSPD_OFFICERS_MANAGE','officers.manage','Personalakten verwalten','Personalakten verwalten','Personalinformationen und Akteneinträge verwalten','Personal'),
 ('P_LSPD_IFINES_VIEW','ifines.view','Interner Bußgeldkatalog ansehen','Interner Bußgeldkatalog ansehen','Interne Sanktionen lesen','Interne Sanktionen'),
 ('P_LSPD_IFINES_MANAGE','ifines.manage','Interner Bußgeldkatalog verwalten','Interner Bußgeldkatalog verwalten','Interne Sanktionen verwalten','Interne Sanktionen'),
 ('P_LSPD_VEHICLES_VIEW','vehicles.view','Fahrzeugkatalog ansehen','Fahrzeugkatalog ansehen','Fahrzeugkatalog lesen','Fahrzeuge'),
 ('P_LSPD_VEHICLES_MANAGE','vehicles.manage','Fahrzeugkatalog verwalten','Fahrzeugkatalog verwalten','Fahrzeuge hinzufügen, bearbeiten und entfernen','Fahrzeuge'),
 ('P_LSPD_FINES_VIEW','fines.view','Bußgeldkatalog ansehen','Bußgeldkatalog ansehen','Bußgeldkatalog lesen','Bußgeldkatalog'),
 ('P_LSPD_LAWYERS_VIEW','lawyers.view','Anwaltskammer ansehen','Anwaltskammer ansehen','Anwaltskammer lesen','Anwaltskammer'),
 ('P_LSPD_RECORDS_VIEW','records.view','Akten ansehen','Akten ansehen','Akten und Berichte lesen','Akten'),
 ('P_LSPD_RECORDS_MANAGE','records.manage','Akten verwalten','Akten verwalten','Akten und Berichte erstellen und bearbeiten','Akten'),
 ('P_LSPD_WARRANTS_VIEW','warrants.view','Haftbefehle ansehen','Haftbefehle ansehen','Haftbefehle lesen','Haftbefehle'),
 ('P_LSPD_WANTED_VIEW','wanted.view','Fahndungen ansehen','Fahndungen ansehen','Fahndungen lesen','Fahndung'),
 ('P_LSPD_CLASS_VIEW','classification.view','Klassifizierungen ansehen','Klassifizierungen ansehen','Klassifizierungen lesen','Klassifizierungen'),
 ('P_LSPD_CLASS_MANAGE','classification.manage','Klassifizierungen verwalten','Klassifizierungen verwalten','Klassifizierungen bearbeiten und entscheiden','Klassifizierungen'),
 ('P_LSPD_SYSTEM_VIEW','system.view','Systemverwaltung ansehen','Systemverwaltung ansehen','Systeminformationen lesen','System'),
 ('P_LSPD_SYSTEM_MANAGE','system.manage','Systemverwaltung verwalten','Systemverwaltung verwalten','Benutzer, Dienstgrade und Berechtigungen verwalten','System'),
 ('P_LSPD_LOGS_VIEW','logs.view','Systemprotokolle ansehen','Systemprotokolle ansehen','Protokollierte Aktionen lesen','System')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
