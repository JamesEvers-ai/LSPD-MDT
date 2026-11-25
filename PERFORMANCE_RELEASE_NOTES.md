# LSPD MDT Performance / Stability Release Notes

## v3 – Personalakten, interne Sanktionen und Modal-UI
- `renderTenCodeColorSettings` ist jetzt sicher über `window.renderTenCodeColorSettings` erreichbar.
- Interne Sanktionen unterstützen mehrere Maßnahmen. Die neue Supabase-Migration stellt die JSONB-Spalte und den passenden Composite-Constraint konsistent her.
- Personalakten besitzen jetzt eine `Historie`-Registerkarte. Änderungen an Stammdaten, Dienstgrad, Schulungen, Vermerken und internen Sanktionen werden protokolliert.
- Personalakten-Modal und interne Bußgeldverwaltung verwenden konsequent die helle LSPD-Oberfläche.
- Die Historie ist fehlertolerant: Fehlt die neue Tabelle noch, bleiben die übrigen Personalakten-Funktionen nutzbar; nach Ausführung der Migration wird die Historie aktiv.
