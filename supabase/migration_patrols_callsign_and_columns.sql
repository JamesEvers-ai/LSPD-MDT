-- LSPD MDT Phase 3.7: Schema-Abgleich für die Leitstelle / Streifen
-- Im Supabase SQL Editor ausführen. Bestehende Daten bleiben erhalten.
-- Ergänzt nur fehlende Spalten, die der aktuelle API-Handler verwendet.

BEGIN;

ALTER TABLE public.patrols
  ADD COLUMN IF NOT EXISTS callsign text,
  ADD COLUMN IF NOT EXISTS number text,
  ADD COLUMN IF NOT EXISTS vehicle_type text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by text;

UPDATE public.patrols SET created_at = now() WHERE created_at IS NULL;
UPDATE public.patrols SET updated_at = now() WHERE updated_at IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
