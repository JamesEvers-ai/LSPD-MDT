-- LSPD MDT Phase 3.73
-- Scheduled cleanup and removal of LSPD-side classification administration.
-- Safe to re-run. Classification tables are intentionally NOT dropped because
-- they may be shared with the separate FIB application.

-- Remove only the two LSPD-specific permission records introduced by the
-- LSPD permission migration. Do not touch generic/FIB classification keys.
delete from public.rank_permissions rp
using public.permissions p
where rp.permission_id = p.id
  and p.id in ('P_LSPD_CLASS_VIEW', 'P_LSPD_CLASS_MANAGE');

delete from public.permissions
where id in ('P_LSPD_CLASS_VIEW', 'P_LSPD_CLASS_MANAGE');

-- pg_cron is available as a Supabase extension. Jobs run in UTC.
create extension if not exists pg_cron;

-- Efficient weekly selection of schedule-change entries only.
create index if not exists fib_calendar_schedule_change_cleanup_idx
  on public.fib_calendar_events ((metadata->>'entry_type'), created_at);

-- Replace named jobs idempotently.
do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'lspd-weekly-calendar-change-cleanup';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  select jobid into existing_job
  from cron.job
  where jobname = 'lspd-record-share-expiry-cleanup-hourly';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  select jobid into existing_job
  from cron.job
  where jobname = 'lspd-session-cleanup-local-0400';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  -- Sunday 22:00 UTC: 23:00 in Austria during winter / 00:00 during summer.
  -- Only temporary schedule-change entries are deleted; normal calendar events
  -- are retained.
  perform cron.schedule(
    'lspd-weekly-calendar-change-cleanup',
    '0 22 * * 0',
    $job$delete from public.fib_calendar_events
          where metadata->>'application' = 'lspd'
            and metadata->>'entry_type' = 'schedule_change';$job$
  );

  -- Expired shared-record links are removed hourly. They are already unusable
  -- at expires_at; this job removes their database rows shortly afterwards.
  perform cron.schedule(
    'lspd-record-share-expiry-cleanup-hourly',
    '0 * * * *',
    $job$delete from public.fib_record_shares
          where expires_at <= now();$job$
  );

  -- Runs hourly but performs the cleanup only during 04:00–04:59 Europe/Vienna.
  -- This preserves the requested local 04:00 cleanup across daylight-saving changes.
  perform cron.schedule(
    'lspd-session-cleanup-local-0400',
    '0 * * * *',
    $job$delete from public.fib_mdt_sessions
          where expires_at <= now()
            and extract(hour from (now() at time zone 'Europe/Vienna')) = 4;$job$
  );
end
$$;

notify pgrst, 'reload schema';
