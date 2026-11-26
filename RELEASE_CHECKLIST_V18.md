# LSPD MDT – Leitstelle v18

## Referenz-Checkliste

### Optik – aktive Streifen
- [x] Gruppenüberschrift als kompakte Status-/Callsign-Kennung
- [x] Kompakte horizontale Streifenzeile statt großer Karten
- [x] Callsign als eigener Block mit Callsign-Typ und Nummer
- [x] Ten Code als eigener kompakter Statusblock
- [x] Einsatzort als eigener Block
- [x] Fahrzeug als eigener Block
- [x] Tätigkeit/Status als eigener Block
- [x] Besatzung als kompakter Besatzungsblock
- [x] Beitritt-/Aktionselemente rechts
- [x] Sehr geringe Zeilenhöhe und reduzierte Abstände
- [x] Einheitliche LSPD-Light-Farben statt alter dunkler FIB-Optik
- [x] Responsive Anpassung für kleinere Bildschirmbreiten

### Optik – Leitstellenleiste
- [x] Kompakte Leiste mit nur „Callsign“ und „Status“ als Gruppierung
- [x] Anzahl aktiver Streifen bleibt sichtbar
- [x] Keine unnötigen Ten-Code-/Funk-/Statusfilter in der Gruppierungsleiste
- [x] LSPD-Light-Styling
- [x] Obere Statuschips (FUNK, STATUS, TEN CODE, EINSATZORT, FAHRZEUG) auf LSPD-Light vereinheitlicht
- [x] Dienst-Auswahlliste und Master-Konfiguration auf LSPD-Light vereinheitlicht

### Funktion
- [x] „Außer Dienst“ wiederhergestellt
- [x] „Außer Dienst“ bleibt mit dem bestehenden `leavePatrol`-Workflow verbunden
- [x] Dienststatus synchronisiert weiterhin mit der globalen Topbar
- [x] Gruppierung nach Callsign oder Status bleibt umschaltbar
- [x] Ten Codes werden weiterhin aus der globalen Master-Konfiguration geladen
- [x] Callsigns werden aus der Personalakte des Streifenführers aufgelöst
- [x] Gruppierungswerte entstehen nur aus tatsächlich aktiven Streifen
- [x] Manuelle Callsign-Eingabe im Streifenformular entfernt; Personalakte ist maßgeblich
- [x] Backend verwendet bei der Leitstellenauflösung ausschließlich den Callsign aus der Personalakte
- [x] Join-, Bearbeiten- und Löschen-Funktionen bleiben erhalten
- [x] Bestehende Berechtigungsprüfung bleibt erhalten
- [x] Keine neue Supabase-Migration erforderlich

## Technische Prüfung
- [x] `public/pages/patrols.html` JavaScript-Syntax geprüft
- [x] `public/js/pages/patrols.js` JavaScript-Syntax geprüft
- [x] `functions/api/[[path]].js` JavaScript-Syntax geprüft
