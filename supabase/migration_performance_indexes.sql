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

-- Phase 2: indexes for the list/detail paths used most often by the MDT.
-- These are intentionally narrow and idempotent.
CREATE INDEX IF NOT EXISTS fib_records_type_updated_at_idx
  ON public.fib_records(type, updated_at DESC);
CREATE INDEX IF NOT EXISTS fib_records_status_updated_at_idx
  ON public.fib_records(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS fib_records_type_status_updated_at_idx
  ON public.fib_records(type, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS fib_wanted_created_at_idx
  ON public.fib_wanted(created_at DESC);
CREATE INDEX IF NOT EXISTS fib_wanted_status_created_at_idx
  ON public.fib_wanted(status, created_at DESC);
CREATE INDEX IF NOT EXISTS fib_internal_fine_catalog_category_sort_idx
  ON public.fib_internal_fine_catalog(category_id, sort_order ASC);
CREATE INDEX IF NOT EXISTS fib_internal_fines_event_date_idx
  ON public.fib_internal_fines(event_date DESC);
CREATE INDEX IF NOT EXISTS fib_internal_fines_created_at_idx
  ON public.fib_internal_fines(created_at DESC);
CREATE INDEX IF NOT EXISTS fib_calendar_events_event_date_created_at_idx
  ON public.fib_calendar_events(event_date, created_at DESC);
CREATE INDEX IF NOT EXISTS fib_vacations_status_created_at_idx
  ON public.fib_vacations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS fib_announcements_status_created_at_idx
  ON public.fib_announcements(status, created_at DESC);
CREATE INDEX IF NOT EXISTS fib_bonus_entries_created_at_idx
  ON public.fib_bonus_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS fib_gang_profiles_created_at_idx
  ON public.fib_gang_profiles(created_at DESC);
CREATE INDEX IF NOT EXISTS fib_patrols_status_updated_at_idx
  ON public.patrols(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS fib_patrol_members_patrol_user_idx
  ON public.patrol_members(patrol_id, user_id);
CREATE INDEX IF NOT EXISTS fib_patrol_members_user_patrol_idx
  ON public.patrol_members(user_id, patrol_id);

NOTIFY pgrst, 'reload schema';
