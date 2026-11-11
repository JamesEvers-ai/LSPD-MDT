-- LSPD MDT: Erweiterung für die modulare Dienstaufnahme
-- In Supabase SQL Editor ausführen, bevor die neue Dienstaufnahme genutzt wird.
alter table public.patrols add column if not exists location text not null default '';
alter table public.patrols add column if not exists activity text not null default '';
