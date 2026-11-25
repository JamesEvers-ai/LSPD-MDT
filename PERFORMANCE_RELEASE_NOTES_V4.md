# LSPD MDT v4

## Fix
- Removed the invalid `patrol_members.id` column from the Patrols read path. The current schema is accessed with `patrol_id`, `user_id` and `position` only.

## Departments
- Added a controlled department list in the personnel UI.
- Department is stored in the existing `personnel.department` field, so no migration is required for existing personnel rows.
- Department tabs filter the personnel overview without additional Supabase requests.

## Termination documents
- Added `personnel_terminations`.
- Termination documents use one compact JSON payload per termination and a SHA-256 token hash.
- The raw public token is only returned once when the document is created.
- Public termination URLs never expire.
- The employee is deactivated as part of the termination transaction flow.
- The personnel history receives a `termination_created` event.
- The document follows the supplied `09_Beendigung_Dienstverhaeltnis.docx` structure: document number/date, issuing office, processor, recipient, confidentiality, name/server ID, rank, division/unit, termination type, effective date, deciding office, reason, approval, returned equipment, MDT update, and signatures.

## Performance
- Permanent documents are a single-row lookup by indexed token hash.
- Department tabs are client-side filtering and therefore create no extra API/database traffic.
- Existing v1-v3 performance changes remain intact.
