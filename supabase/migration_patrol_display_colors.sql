-- LSPD MDT Phase 3.36: persist master-configurable patrol roster colors.
-- Run once in the Supabase SQL Editor.
BEGIN;
CREATE TABLE IF NOT EXISTS public.fib_mdt_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
ALTER TABLE public.fib_mdt_settings ENABLE ROW LEVEL SECURITY;
-- Access is performed by the Cloudflare Pages Function using the server-side service role.
-- No client-facing policies are created, so browser clients cannot read or write settings directly.
NOTIFY pgrst, 'reload schema';
COMMIT;
