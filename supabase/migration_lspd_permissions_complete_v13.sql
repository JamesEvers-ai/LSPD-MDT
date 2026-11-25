-- LSPD MDT v13: complete page/action permission catalog.
-- Idempotent. Adds only permission definitions; existing rank assignments are preserved.
-- IMPORTANT: permissions are not automatically granted to ranks.

insert into public.permissions (id,key,name,label,description,category)
values
 ('P_LSPD_373_PATROL_CREATE','patrols.create','Streifen erstellen','Streifen erstellen','Neue Streifen in der Leitstelle erstellen','Leitstelle'),
 ('P_LSPD_373_PATROL_EDIT','patrols.edit','Streifen bearbeiten','Streifen bearbeiten','Bestehende Streifen und Streifenstatus bearbeiten','Leitstelle'),
 ('P_LSPD_373_PATROL_DELETE','patrols.delete','Streifen löschen','Streifen löschen','Streifen aus der Leitstelle entfernen','Leitstelle'),
 ('P_LSPD_373_OFFICERS_TERMINATE','officers.terminate','Kündigungen ausstellen','Kündigungen ausstellen','Kündigungsschreiben ausstellen und Dienstverhältnisse beenden','Personal'),
 ('P_LSPD_373_CLASSIFICATION_VIEW','classification.view','Klassifizierungen ansehen','Klassifizierungen ansehen','Klassifizierungsanträge und klassifizierte Personen einsehen','Klassifizierung'),
 ('P_LSPD_373_CLASSIFICATION_APPROVE','classification.approve','Klassifizierungen genehmigen','Klassifizierungen genehmigen','Klassifizierungsanträge genehmigen oder ablehnen','Klassifizierung'),
 ('P_LSPD_373_CLASSIFICATION_CREATE','classification.create','Klassifizierungen erstellen','Klassifizierungen erstellen','Klassifizierungsanträge und Einträge erstellen','Klassifizierung'),
 ('P_LSPD_373_CLASSIFICATION_DELETE','classification.delete','Klassifizierungen löschen','Klassifizierungen löschen','Klassifizierungsanträge und Einträge löschen','Klassifizierung')
on conflict (key) do update set
 name=excluded.name,
 label=excluded.label,
 description=excluded.description,
 category=excluded.category;

create index if not exists idx_permissions_key on public.permissions(key);
create index if not exists idx_rank_permissions_rank_permission on public.rank_permissions(rank_id, permission_id);

notify pgrst, 'reload schema';
