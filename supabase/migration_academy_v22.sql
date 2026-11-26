-- LSPD MDT v22: Academy as dedicated navigation area, PDF storage, flexible tests, renamed record types.

-- Academy document file metadata. Existing text documents remain supported.
alter table public.academy_documents add column if not exists description text not null default '';
alter table public.academy_documents add column if not exists file_name text;
alter table public.academy_documents add column if not exists file_path text;
alter table public.academy_documents add column if not exists mime_type text;
alter table public.academy_documents add column if not exists file_size bigint;
alter table public.academy_documents alter column content drop not null;
create index if not exists academy_documents_file_idx on public.academy_documents(file_path);

-- Private Supabase Storage bucket. Files are served through short-lived signed URLs.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('academy-documents','academy-documents',false,10485760,array['application/pdf'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf'];

-- New record permissions. Existing rank assignments are copied from the old labels so the rename does not lock anyone out.
insert into public.permissions (id,key,name,label,description,category)
values
 ('P_LSPD_422_001','records.ia.view','IA-Akten ansehen','IA-Akten ansehen','Akten der Internal Affairs Division einsehen','Akten'),
 ('P_LSPD_422_002','records.ia.create','IA-Akten erstellen','IA-Akten erstellen','Akten der Internal Affairs Division erstellen','Akten'),
 ('P_LSPD_422_003','records.ia.edit','IA-Akten bearbeiten','IA-Akten bearbeiten','Akten der Internal Affairs Division bearbeiten','Akten'),
 ('P_LSPD_422_004','records.highcommand.view','High Command Akten ansehen','High Command Akten ansehen','Akten des High Command einsehen','Akten'),
 ('P_LSPD_422_005','records.highcommand.create','High Command Akten erstellen','High Command Akten erstellen','Akten des High Command erstellen','Akten'),
 ('P_LSPD_422_006','records.highcommand.edit','High Command Akten bearbeiten','High Command Akten bearbeiten','Akten des High Command bearbeiten','Akten')
on conflict (key) do update set name=excluded.name,label=excluded.label,description=excluded.description,category=excluded.category;

insert into public.rank_permissions (rank_id,permission_id)
select rp.rank_id, p.id
from public.rank_permissions rp
join public.permissions oldp on oldp.id=rp.permission_id
join public.permissions p on p.key=case oldp.key
  when 'records.doc.view' then 'records.ia.view'
  when 'records.doc.create' then 'records.ia.create'
  when 'records.doc.edit' then 'records.ia.edit'
  when 'records.director.view' then 'records.highcommand.view'
  when 'records.director.create' then 'records.highcommand.create'
  when 'records.director.edit' then 'records.highcommand.edit'
end
where oldp.key in ('records.doc.view','records.doc.create','records.doc.edit','records.director.view','records.director.create','records.director.edit')
on conflict do nothing;

-- Rename stored record types as part of the terminology change.
update public.fib_records set type='ia', classification='Geschützt – Internal Affairs' where type='doc';
update public.fib_records set type='highcommand', classification='Streng vertraulich – High Command' where type='director';

-- Remove the obsolete permission keys after copying their rank assignments.
delete from public.rank_permissions rp
where rp.permission_id in (select id from public.permissions where key in ('records.doc.view','records.doc.create','records.doc.edit','records.director.view','records.director.create','records.director.edit'));
delete from public.permissions where key in ('records.doc.view','records.doc.create','records.doc.edit','records.director.view','records.director.create','records.director.edit');

notify pgrst, 'reload schema';
