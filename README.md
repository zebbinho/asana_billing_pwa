# Asana Billing PWA v0.4

Lokale Browser-Anwendung zur Erstellung von Dienstleistungs- und Budgetreports aus Asana Time Tracking.

## Start unter Windows

1. ZIP entpacken.
2. `start.bat` doppelklicken.
3. Beim ersten Start wird `.env` angelegt und in Notepad geöffnet.
4. Token eintragen:

   `ASANA_ACCESS_TOKEN=DEIN_PAT`

5. Datei speichern, Notepad schließen und `start.bat` erneut starten.
6. Browser: `http://127.0.0.1:8765`

Der PAT bleibt ausschließlich lokal in `.env` und wird nicht an das Browser-Frontend ausgegeben.

## Workspace

Voreingestellt:
- apenio GmbH
- Workspace GID `1207205268697266`

## Zeitraum

- Schnellauswahl eines Monats bleibt erhalten.
- Zusätzlich können `Von` und `Bis` beliebig gesetzt werden, auch über Monats- und Jahresgrenzen.

## Projekte

Die Projektliste wird direkt aus dem Workspace geladen und vollständig paginiert. Projekte ohne Zeitbuchungen im gewählten Zeitraum bleiben sichtbar. Archivierte Projekte werden gekennzeichnet.

## Automatische Budgetzuordnung ab v0.4

Die Anwendung sucht im gewählten Asana-Projekt nach dem Custom Field:

`apenio-Budgets`

Nach der Erkennung wird intern dessen Asana-GID verwendet. Für jeden Task mit Zeitbuchungen werden die Custom Fields geladen und der Wert von `apenio-Budgets` ausgelesen.

Priorität der Budgetzuordnung:

1. Asana Custom Field `apenio-Budgets`
2. lokal gespeicherte manuelle Task-Zuordnung als Fallback
3. `UNASSIGNED`

In der Oberfläche wird angezeigt:
- ob `apenio-Budgets` erkannt wurde,
- die erkannte Custom-Field-GID,
- wie viele Tasks automatisch zugeordnet wurden,
- welche Tasks noch keine Budgetzuordnung haben.

Neu in Asana gefundene Budgetnamen erscheinen automatisch in der Budgetliste. Die beauftragten Stunden müssen weiterhin lokal gepflegt werden, solange dafür keine eindeutige Asana-Quelle festgelegt ist.

## Report-Ausgabe

Je Reportlauf werden erzeugt:
- `01_time_entries_raw.csv`
- `03_billing_lines.csv`
- `04_budget_summary.csv`
- `customer_service_report.pdf`
- `run_summary.json`
- `report_package.zip`

`03_billing_lines.csv` enthält zusätzlich:
- `asana_budget`
- `budget_name`
- `budget_source` (`asana`, `local_fallback`, `unassigned`)

Damit ist nachvollziehbar, woher jede Budgetzuordnung stammt.

## Update von einer älteren Version

Aus deinem bisherigen App-Ordner in den neuen kopieren:
- `.env` für den Token
- `.billing.db` für Kunden-, Budget- und manuelle Fallback-Zuordnungen

Diese Dateien sind absichtlich nicht im ZIP enthalten.

## Erscheinungsbild

Die Weboberfläche orientiert sich an https://www.apenio.de/ (Stand 18.09.2026):
- Dunkelblau `#273d59`, orange Aktionsfarbe `#ef9b14`, weiße Inhaltsflächen.
- Originales apenio-Logo und Source Sans Pro, lokal unter `app/static/brand/` eingebunden.
- Vier nummerierte Arbeitsabschnitte und responsives Layout für kleinere Bildschirme.
- Markenressourcen werden lokal geladen; keine externen Schrift- oder Bildabrufe beim App-Start.

Quellen: Logo https://www.apenio.de/assets/images/9/logo-0cfbe845.png und Schriftdateien unter https://www.apenio.de/files/fonts/source-sans-pro-v11/.
Die Gestaltung ist aus der Website abgeleitet, kein offizielles CI-Handbuch. PDF-Layout und Abrechnungslogik bleiben unverändert.

## Monatsprüfung und Vorschau

- Während API-Anfragen zeigt eine Ladeanzeige den aktuellen Vorgang; Eingaben sind währenddessen gesperrt.
- Zeitraumwechsel verwerfen die bisherige Prüfansicht. Vor einer neuen Vorschau müssen die Daten erneut geladen werden.
- „Alle Änderungen speichern“ speichert Kundenname, Budgets und Task-Zuordnungen gemeinsam. Ungespeicherte Änderungen werden angezeigt und beim Wechsel abgefragt.
- „Speichern & PDF-Vorschau erstellen“ speichert geänderte Eingaben und erstellt den Report. Die tatsächlichen PDF-Seiten werden lokal mit PyMuPDF für den Browser gerendert.
- Fehlende Budget-, Task- oder Projektzuordnungen werden vor dem Download angezeigt. Bei offenen Fällen muss die Prüfung per Checkbox bestätigt werden.
- PDF und ZIP können separat heruntergeladen werden. Die Vorschauerstellung schreibt bereits die Reportdateien; eine separate revisionssichere Freigabe/Reporthistorie ist noch nicht implementiert.

Tests: `python -m pytest -q` (zusätzlich `pytest` installieren).

## Geschützte Mitarbeitertests

`render.yaml` und `TESTUMGEBUNG.md` bereiten einen passwortgeschützten Render-Testdienst vor. Im Hostingmodus schützen serverseitige Zugangsdaten sämtliche Inhalte. `DATA_DIR` legt den persistenten Speicherort fest. Jeder Reportlauf erhält einen eigenen Ablageordner; bestehende Dateien werden nicht überschrieben. Eine Reporthistorie in der Oberfläche ist noch nicht enthalten.

## Netlify und lokaler Betrieb

Alternativ zu Render ist eine Netlify-Variante enthalten. Einrichtung und gemeinsame Testanmeldung: siehe [NETLIFY.md](NETLIFY.md). `start.bat` und die lokale Python-Version bleiben verfügbar. Netlify verwendet eigene persistente Blobs-Daten; lokale SQLite-Daten werden nicht automatisch synchronisiert.
