-- LSPD MDT v21: Police Academy + department-scoped Academy access
create table if not exists public.department_permissions (
  id text primary key,
  department text not null,
  permission_id text not null references public.permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by text null
);
create unique index if not exists department_permissions_unique on public.department_permissions(department, permission_id);
create index if not exists department_permissions_department_idx on public.department_permissions(department);

insert into public.permissions (id,key,name,label,description,category)
values
 ('PERM_ACAD_VIEW','academy.view','Academy ansehen','Academy ansehen','Zugriff auf Schulungsunterlagen und Academy-Tests','Academy'),
 ('PERM_ACAD_MANAGE','academy.manage','Academy verwalten','Academy verwalten','Schulungsdokumente und Abschlusstests erstellen und bearbeiten','Academy'),
 ('PERM_ACAD_TEST','academy.test','Academy-Test ablegen','Academy-Test ablegen','Abschlusstests der Police Academy ablegen','Academy')
on conflict (key) do update set name=excluded.name,label=excluded.label,description=excluded.description,category=excluded.category;

create table if not exists public.academy_documents (
  id text primary key,
  title text not null,
  category text not null default 'Ausbildung',
  content text not null,
  active boolean not null default true,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists academy_documents_active_idx on public.academy_documents(active, updated_at desc);

create table if not exists public.academy_tests (
  id text primary key,
  title text not null,
  description text,
  active boolean not null default true,
  passing_score integer not null default 70,
  questions jsonb not null default '[]'::jsonb,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists academy_tests_active_idx on public.academy_tests(active, updated_at desc);

create table if not exists public.academy_attempts (
  id text primary key,
  test_id text not null references public.academy_tests(id) on delete cascade,
  user_id text not null,
  user_name text,
  score integer not null,
  passed boolean not null default false,
  answers jsonb not null default '[]'::jsonb,
  submitted_at timestamptz not null default now()
);
create index if not exists academy_attempts_user_idx on public.academy_attempts(user_id, submitted_at desc);
create index if not exists academy_attempts_test_idx on public.academy_attempts(test_id, submitted_at desc);

-- Optional starter configuration: uncomment/adjust after confirming which departments should have access.
-- insert into public.department_permissions (id,department,permission_id)
-- select 'DP'||substr(md5(d.department||p.key),1,14),d.department,p.id
-- from (values ('Police Academy'),('Patrol Division')) d(department)
-- cross join public.permissions p where p.key in ('academy.view','academy.manage','academy.test')
-- on conflict (department,permission_id) do nothing;
