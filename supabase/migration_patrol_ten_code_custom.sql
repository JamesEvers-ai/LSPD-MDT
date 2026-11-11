-- LSPD MDT: frei konfigurierbare Ten Codes getrennt vom eingeschränkten Streifenstatus
-- Bestehende Werte bleiben erhalten und werden in ten_code übernommen.
ALTER TABLE public.patrols
  ADD COLUMN IF NOT EXISTS ten_code text;

UPDATE public.patrols
SET ten_code = status
WHERE ten_code IS NULL OR btrim(ten_code) = '';

ALTER TABLE public.patrols
  ALTER COLUMN ten_code SET DEFAULT '10-1';

UPDATE public.patrols
SET ten_code = '10-1'
WHERE ten_code IS NULL OR btrim(ten_code) = '';

ALTER TABLE public.patrols
  ALTER COLUMN ten_code SET NOT NULL;
