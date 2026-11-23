-- Phase 3.74: vollständiger, rangweise konfigurierbarer LSPD-Berechtigungskatalog.
-- Idempotent: ergänzt fehlende Rechte, ändert keine bestehenden Rangzuweisungen.
insert into public.permissions (id,key,name,label,description,category)
values
('P_LSPD_374_001','dashboard.view','Dashboard ansehen','Dashboard ansehen','Dashboard und Kennzahlen aufrufen','Übersicht'),
('P_LSPD_374_002','patrols.view','Leitstelle ansehen','Leitstelle ansehen','Streifen und Leitstellenstatus einsehen','Leitstelle'),
('P_LSPD_374_003','patrols.manage','Leitstelle verwalten','Leitstelle verwalten','Streifen und Status verwalten','Leitstelle'),
('P_LSPD_374_004','patrols.edit','Streifen bearbeiten','Streifen bearbeiten','Bestehende Streifen bearbeiten','Leitstelle'),
('P_LSPD_374_005','patrols.delete','Streifen löschen','Streifen löschen','Streifen entfernen','Leitstelle'),
('P_LSPD_374_006','officers.view','Personalakten ansehen','Personalakten ansehen','Personalübersicht und Personalakten einsehen','Personal'),
('P_LSPD_374_007','officers.edit','Personal bearbeiten','Personal bearbeiten','Personalinformationen bearbeiten','Personal'),
('P_LSPD_374_008','officers.manage','Personal verwalten','Personal verwalten','Personalakten verwalten','Personal'),
('P_LSPD_374_009','announcements.view','Bekanntmachungen ansehen','Bekanntmachungen ansehen','Departmentbekanntmachungen lesen','Bekanntmachungen'),
('P_LSPD_374_010','announcements.manage','Bekanntmachungen verwalten','Bekanntmachungen verwalten','Bekanntmachungen erstellen und verwalten','Bekanntmachungen'),
('P_LSPD_374_011','calendar.view','Kalender ansehen','Kalender ansehen','Kalendertermine einsehen','Kalender'),
('P_LSPD_374_012','calendar.manage','Kalender verwalten','Kalender verwalten','Kalendertermine verwalten','Kalender'),
('P_LSPD_374_013','calendar.schedule_changes.view','Dienstplanänderungen ansehen','Dienstplanänderungen ansehen','Dienstplanänderungen einsehen','Kalender'),
('P_LSPD_374_014','calendar.schedule_changes.manage','Dienstplanänderungen verwalten','Dienstplanänderungen verwalten','Dienstplanänderungen verwalten','Kalender'),
('P_LSPD_374_015','ifines.view','Internen Bußgeldkatalog ansehen','Internen Bußgeldkatalog ansehen','Interne Sanktionen einsehen','Sanktionen'),
('P_LSPD_374_016','ifines.manage','Internen Bußgeldkatalog verwalten','Internen Bußgeldkatalog verwalten','Interne Sanktionen verwalten','Sanktionen'),
('P_LSPD_374_017','vehicles.view','Fahrzeugkatalog ansehen','Fahrzeugkatalog ansehen','Fahrzeugkatalog einsehen','Fahrzeuge'),
('P_LSPD_374_018','vehicles.manage','Fahrzeugkatalog verwalten','Fahrzeugkatalog verwalten','Fahrzeuge verwalten','Fahrzeuge'),
('P_LSPD_374_019','fines.view','Bußgeldkatalog ansehen','Bußgeldkatalog ansehen','Bußgeldkatalog aufrufen','Bußgeldkatalog'),
('P_LSPD_374_020','lawyers.view','Anwaltskammer ansehen','Anwaltskammer ansehen','Anwaltskammer einsehen','Anwaltskammer'),
('P_LSPD_374_021','records.view','Aktenbereich öffnen','Aktenbereich öffnen','Aktenbereich aufrufen','Akten'),
('P_LSPD_374_022','records.investigations.view','Ermittlungsakten ansehen','Ermittlungsakten ansehen','Ermittlungsakten einsehen','Akten'),
('P_LSPD_374_023','records.investigations.create','Ermittlungsakten erstellen','Ermittlungsakten erstellen','Ermittlungsakten erstellen','Akten'),
('P_LSPD_374_024','records.investigations.edit','Ermittlungsakten bearbeiten','Ermittlungsakten bearbeiten','Ermittlungsakten bearbeiten','Akten'),
('P_LSPD_374_025','records.reports.view','Berichte ansehen','Berichte ansehen','Berichte einsehen','Akten'),
('P_LSPD_374_026','records.reports.create','Berichte erstellen','Berichte erstellen','Berichte erstellen','Akten'),
('P_LSPD_374_027','records.reports.edit','Berichte bearbeiten','Berichte bearbeiten','Berichte bearbeiten','Akten'),
('P_LSPD_374_028','records.doc.view','DOC-Akten ansehen','DOC-Akten ansehen','Gesicherte DOC-Akten einsehen','Akten'),
('P_LSPD_374_029','records.doc.create','DOC-Akten erstellen','DOC-Akten erstellen','Gesicherte DOC-Akten erstellen','Akten'),
('P_LSPD_374_030','records.doc.edit','DOC-Akten bearbeiten','DOC-Akten bearbeiten','Gesicherte DOC-Akten bearbeiten','Akten'),
('P_LSPD_374_031','records.director.view','Leitungsakten ansehen','Leitungsakten ansehen','Leitungsakten einsehen','Akten'),
('P_LSPD_374_032','records.director.create','Leitungsakten erstellen','Leitungsakten erstellen','Leitungsakten erstellen','Akten'),
('P_LSPD_374_033','records.director.edit','Leitungsakten bearbeiten','Leitungsakten bearbeiten','Leitungsakten bearbeiten','Akten'),
('P_LSPD_374_034','warrants.view','Haftbefehle ansehen','Haftbefehle ansehen','Haftbefehle einsehen','Haftbefehle'),
('P_LSPD_374_035','warrants.manage','Haftbefehle verwalten','Haftbefehle verwalten','Haftbefehle aktualisieren','Haftbefehle'),
('P_LSPD_374_036','wanted.view','Fahndungen ansehen','Fahndungen ansehen','Fahndungseinträge einsehen','Fahndung'),
('P_LSPD_374_037','wanted.create','Fahndungen erstellen','Fahndungen erstellen','Fahndungseinträge erstellen','Fahndung'),
('P_LSPD_374_038','wanted.edit','Fahndungen bearbeiten','Fahndungen bearbeiten','Fahndungseinträge bearbeiten','Fahndung'),
('P_LSPD_374_039','wanted.delete','Fahndungen löschen','Fahndungen löschen','Fahndungseinträge löschen','Fahndung'),
('P_LSPD_374_040','gangs.evidence.view','Gangbeweise ansehen','Gangbeweise ansehen','Beweisakten und Beweismittel einsehen','Gang Enforcement'),
('P_LSPD_374_041','gangs.evidence.manage','Gangbeweise verwalten','Gangbeweise verwalten','Gang-Beweisakten erstellen und bearbeiten','Gang Enforcement'),
('P_LSPD_374_042','bonuses.view','Bonusübersicht ansehen','Bonusübersicht ansehen','Bonusübersicht einsehen','Bonus'),
('P_LSPD_374_043','bonuses.manage','Bonusübersicht verwalten','Bonusübersicht verwalten','Bonusauszahlungen verwalten','Bonus'),
('P_LSPD_374_044','logs.view','Systemprotokolle ansehen','Systemprotokolle ansehen','Audit-Protokolle einsehen','System'),
('P_LSPD_374_045','system.view','Systemverwaltung ansehen','Systemverwaltung ansehen','Systeminformationen und Einstellungen einsehen','System'),
('P_LSPD_374_046','system.manage','Systemverwaltung verwalten','Systemverwaltung verwalten','Systemverwaltung konfigurieren','System'),
('P_LSPD_374_047','system.permissions.view','Berechtigungen ansehen','Berechtigungen ansehen','Rangberechtigungen einsehen','System'),
('P_LSPD_374_048','system.permissions.manage','Berechtigungen verwalten','Berechtigungen verwalten','Rangberechtigungen bearbeiten','System'),
('P_LSPD_374_049','system.ranks.view','Dienstgrade ansehen','Dienstgrade ansehen','Dienstgrade einsehen','System'),
('P_LSPD_374_050','system.ranks.manage','Dienstgrade verwalten','Dienstgrade verwalten','Dienstgrade verwalten','System'),
('P_LSPD_374_051','system.users.view','Benutzer ansehen','Benutzer ansehen','Benutzerkonten einsehen','System'),
('P_LSPD_374_052','system.users.manage','Benutzer verwalten','Benutzer verwalten','Benutzerkonten verwalten','System')
on conflict (key) do update set
  name=excluded.name,
  label=excluded.label,
  description=excluded.description,
  category=excluded.category;

-- Gangbeweise werden nun über eigene, explizite Rechte geschützt.
-- Bestehende gangs.view/manage-Zuweisungen werden NICHT automatisch kopiert:
-- sensible Beweisakten sollen bewusst durch die Leitung freigegeben werden.
notify pgrst, 'reload schema';

insert into public.permissions (id,key,name,label,description,category)
values
 ('P_LSPD_374_VAC_VIEW','vacations.view','Urlaubsverwaltung ansehen','Urlaubsverwaltung ansehen','Urlaubsanträge und Abwesenheiten einsehen','Personal'),
 ('P_LSPD_374_VAC_MANAGE','vacations.manage','Urlaubsverwaltung verwalten','Urlaubsverwaltung verwalten','Urlaubsanträge bearbeiten und verwalten','Personal')
on conflict (key) do update set name=excluded.name,label=excluded.label,description=excluded.description,category=excluded.category;
notify pgrst, 'reload schema';
