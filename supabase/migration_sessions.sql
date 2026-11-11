create table if not exists public.fib_mdt_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists fib_mdt_sessions_user_id_idx on public.fib_mdt_sessions(user_id);
create index if not exists fib_mdt_sessions_expires_at_idx on public.fib_mdt_sessions(expires_at);

create table if not exists public.fib_record_shares (
  id text primary key,
  record_id text not null,
  token_hash text not null unique,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists fib_record_shares_record_id_idx on public.fib_record_shares(record_id);
create index if not exists fib_record_shares_expires_at_idx on public.fib_record_shares(expires_at);


-- Storage bucket for user profile images. Public read is intentional for profile avatars;
-- uploads and deletes are performed only by server-side Pages Functions with the secret key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fib-profile-images', 'fib-profile-images', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png','image/jpeg','image/webp'];

-- Shared schema for modules whose original source pages were not present in the supplied archive.
create table if not exists public.fib_announcements (
 id text primary key, title text not null, description text not null default '', status text not null default 'active', event_date timestamptz, metadata jsonb not null default '{}'::jsonb, created_by text, created_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.fib_vacations (like public.fib_announcements including all);
create table if not exists public.fib_internal_fines (like public.fib_announcements including all);
create table if not exists public.fib_calendar_events (like public.fib_announcements including all);
create table if not exists public.fib_gang_profiles (like public.fib_announcements including all);
create table if not exists public.fib_bonus_entries (like public.fib_announcements including all);
create table if not exists public.fib_mdt_logs (
 id text primary key, action text not null, module_name text not null, item_id text, detail text not null default '', actor_id text, actor_name text not null default 'System', created_at timestamptz not null default now()
);
create index if not exists fib_announcements_created_at_idx on public.fib_announcements(created_at desc);
create index if not exists fib_vacations_created_at_idx on public.fib_vacations(created_at desc);
create index if not exists fib_internal_fines_created_at_idx on public.fib_internal_fines(created_at desc);
create index if not exists fib_calendar_events_event_date_idx on public.fib_calendar_events(event_date);
create index if not exists fib_gang_profiles_created_at_idx on public.fib_gang_profiles(created_at desc);
create index if not exists fib_bonus_entries_created_at_idx on public.fib_bonus_entries(created_at desc);
create index if not exists fib_mdt_logs_created_at_idx on public.fib_mdt_logs(created_at desc);

-- Permissions used by the newly enabled modules. Assign them to ranks in the MDT's System page.
insert into public.permissions (id, key, name, label, description, category)
values
 ('P_ANN_VIEW', 'announcements.view', 'Bekanntmachungen ansehen', 'Bekanntmachungen ansehen', 'Bekanntmachungen lesen', 'Bekanntmachungen'),
 ('P_ANN_MANAGE', 'announcements.manage', 'Bekanntmachungen verwalten', 'Bekanntmachungen verwalten', 'Bekanntmachungen erstellen, bearbeiten und löschen', 'Bekanntmachungen'),
 ('P_VAC_VIEW', 'vacations.view', 'Urlaub ansehen', 'Urlaub ansehen', 'Urlaubsanträge lesen', 'Urlaub'),
 ('P_VAC_MANAGE', 'vacations.manage', 'Urlaub verwalten', 'Urlaub verwalten', 'Urlaubsanträge verwalten', 'Urlaub'),
 ('P_IFINES_VIEW', 'ifines.view', 'Interne Bußgelder ansehen', 'Interne Bußgelder ansehen', 'Interne Bußgelder lesen', 'Interne Bußgelder'),
 ('P_IFINES_MANAGE', 'ifines.manage', 'Interne Bußgelder verwalten', 'Interne Bußgelder verwalten', 'Interne Bußgelder erstellen, bearbeiten und löschen', 'Interne Bußgelder'),
 ('P_CAL_VIEW', 'calendar.view', 'Kalender ansehen', 'Kalender ansehen', 'Kalendertermine lesen', 'Kalender'),
 ('P_CAL_MANAGE', 'calendar.manage', 'Kalender verwalten', 'Kalender verwalten', 'Kalendertermine verwalten', 'Kalender'),
 ('P_GANGS_VIEW', 'gangs.view', 'Gangübersicht ansehen', 'Gangübersicht ansehen', 'Gangübersicht lesen', 'Ermittlungen'),
 ('P_GANGS_MANAGE', 'gangs.manage', 'Gangübersicht verwalten', 'Gangübersicht verwalten', 'Einträge der Gangübersicht verwalten', 'Ermittlungen'),
 ('P_BONUS_VIEW', 'bonuses.view', 'Bonussystem ansehen', 'Bonussystem ansehen', 'Bonuseinträge lesen', 'Bonussystem'),
 ('P_BONUS_MANAGE', 'bonuses.manage', 'Bonussystem verwalten', 'Bonussystem verwalten', 'Bonuseinträge verwalten', 'Bonussystem'),
 ('P_LOGS_VIEW', 'logs.view', 'Systemprotokolle ansehen', 'Systemprotokolle ansehen', 'Systemprotokolle lesen', 'System')
on conflict (key) do nothing;
