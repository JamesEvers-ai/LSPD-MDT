-- LSPD MDT performance indexes
-- Safe to run multiple times. These indexes target the high-frequency
-- authentication, patrol, personnel and permission lookups used by the API.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_fib_mdt_sessions_token_hash
  ON public.fib_mdt_sessions (token_hash);

CREATE INDEX IF NOT EXISTS idx_fib_mdt_sessions_expires_at
  ON public.fib_mdt_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_rank_permissions_rank_id
  ON public.rank_permissions (rank_id);

CREATE INDEX IF NOT EXISTS idx_rank_permissions_permission_id
  ON public.rank_permissions (permission_id);

CREATE INDEX IF NOT EXISTS idx_patrol_members_patrol_id
  ON public.patrol_members (patrol_id);

CREATE INDEX IF NOT EXISTS idx_patrol_members_user_id
  ON public.patrol_members (user_id);

CREATE INDEX IF NOT EXISTS idx_patrols_updated_at
  ON public.patrols (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_personnel_user_id
  ON public.personnel (user_id);

CREATE INDEX IF NOT EXISTS idx_personnel_trainings_user_id_created_at
  ON public.personnel_trainings (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_personnel_notes_user_id_created_at
  ON public.personnel_notes (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fib_mdt_logs_created_at
  ON public.fib_mdt_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fib_record_shares_token_hash
  ON public.fib_record_shares (token_hash);

CREATE INDEX IF NOT EXISTS idx_fib_record_shares_expires_at
  ON public.fib_record_shares (expires_at);

CREATE INDEX IF NOT EXISTS idx_fib_records_created_at
  ON public.fib_records (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fib_wanted_status
  ON public.fib_wanted (status);

COMMIT;

NOTIFY pgrst, 'reload schema';
