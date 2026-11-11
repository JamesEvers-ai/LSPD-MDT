-- LSPD MDT Phase 3.60: individuelle Angaben in Klassifizierungsanträgen
-- Ergänzt Rang/Funktion als eigenes Feld für offene Anträge und aktive Klassifizierungen.
ALTER TABLE public.classification_requests
  ADD COLUMN IF NOT EXISTS rank_function TEXT;

ALTER TABLE public.classified_persons
  ADD COLUMN IF NOT EXISTS rank_function TEXT;

NOTIFY pgrst, 'reload schema';
