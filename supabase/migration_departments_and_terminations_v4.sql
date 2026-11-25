-- LSPD MDT v4
-- Departments + permanent personnel termination documents.
-- Idempotent.

-- patrol_members has no guaranteed id column in the current schema.
-- v4 API therefore only uses patrol_id/user_id/position.

create table if not exists public.personnel_terminations (
  id text primary key,
  user_id text not null,
  document_number text not null unique,
  public_token_hash text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_by text,
  created_by_name text not null default 'System',
  created_at timestamptz not null default now()
);

create index if not exists personnel_terminations_user_created_idx
  on public.personnel_terminations(user_id, created_at desc);
create unique index if not exists personnel_terminations_token_hash_uidx
  on public.personnel_terminations(public_token_hash);
create index if not exists personnel_terminations_document_number_idx
  on public.personnel_terminations(document_number);

-- Normalize department storage as text while retaining existing data.
-- The application supplies the controlled department list; old/custom values remain readable.

notify pgrst, 'reload schema';
