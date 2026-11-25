# LSPD MDT – Performance / UI Release v12

## Personalakte / globales Modal

- Die Personalakte verwendet ausschließlich den globalen `FIB_MDT_MODAL`-Shell aus `public/index.html`.
- Das page-lokale `agentsSystemModal*`-Markup wurde entfernt.
- Alte page-lokale Rank-/Custom-Select-Komponenten wurden entfernt.
- Alle Personalakten-Selects verwenden den zentralen `FIB_MDT_SELECTS`-Dropdown-Manager.
- Der zentrale Dropdown-Manager wurde auf das helle LSPD-Design umgestellt.
- Das globale Modal im Agents-Modus verwendet das helle LSPD-Design.
- Die Personalakte wird geöffnet, bevor ihr Inhalt gerendert wird, damit der globale Modal-Body nicht durch `open()` überschrieben wird.
- Nach Tab-Wechseln und dynamischem Re-Render wird der zentrale Dropdown-Manager erneut gescannt.

## Bereinigung

Entfernt wurden die alten Referenzen an:
- `agentsSystemModal`
- `agentsSystemModalOverlay`
- `agentRankSelect`
- `agents-custom-select`
- `agents-hidden-select`
- `closeRankDropdown`
- `enhanceModalSelects`
- alte `agents-system-modal` / `agents-rank-select` CSS-Regeln

## Validierung

- Alle standalone JavaScript-Dateien: `node --check` erfolgreich.
- Alle Inline-JavaScript-Blöcke in HTML-Dateien: `node --check` erfolgreich.
- Keine alten Personalakten-Modal-/Dropdown-Referenzen in den betroffenen Dateien und im gemeinsamen Design-CSS gefunden.

## Supabase

Für diese Änderung ist keine neue Supabase-Migration erforderlich.

## v13 permission and layout follow-up
- Added missing action permissions for Patrol create/edit/delete, personnel termination, and classification view/approve/create/delete.
- Personnel termination now requires `officers.terminate` server-side.
- Personnel search controls are constrained to the viewport and no longer participate in the overflowing department-tab flex row.
- Dispatch/Leitstelle received a final light-layout pass with responsive sizing and browser-light native selects.
