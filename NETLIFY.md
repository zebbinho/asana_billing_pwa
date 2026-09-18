# Netlify-Mitarbeitertest

## Zwei Startwege bleiben verfügbar

- Lokal: `start.bat` wie bisher. Python liest den Asana-Token aus `.env`, Einstellungen liegen in `.billing.db`. Ohne `APP_ENV=hosted` gibt es lokal keine zusätzliche Anmeldung.
- Netlify: `netlify.toml` verwendet Node.js 24, serverseitige Functions und Netlify Blobs. Python und SQLite werden dort nicht benötigt. Die Netlify-Datenbank beginnt leer; lokale Einstellungen werden nicht automatisch übertragen.

## GitHub mit Netlify verbinden

1. Diesen Projektstand in das Repository übertragen.
2. In Netlify eine Site aus `zebbinho/asana_billing_pwa` importieren (oder die vorhandene Site mit dem Repository verbinden).
3. Basisverzeichnis: Repository-Wurzel. Build: `npm run build`. Publish: `netlify/public`. Functions: `netlify/functions`. Diese Werte stehen bereits in `netlify.toml`.
4. Unter Environment variables drei Werte setzen, ausschließlich für die Functions-Laufzeit und den Production-Kontext:
   - `ASANA_ACCESS_TOKEN`: Asana-PAT, ausschließlich serverseitig.
   - `TEST_USERNAME`: gewünschter gemeinsamer Benutzername, beispielsweise `apenio-test`.
   - `TEST_PASSWORD`: zufälliges Kennwort mit mindestens 24 Zeichen, getrennt vom Asana-Token.
5. Optional: `ASANA_WORKSPACE_GID`, `ASANA_WORKSPACE_NAME`.
6. Neu deployen. Die HTTPS-Adresse öffnen: Der Browser fragt nach Benutzername und Kennwort. Ohne vollständige Konfiguration bleibt der Zugriff gesperrt.
7. Mitarbeiter erhalten nur den Site-Link und den Testzugang, niemals den Asana-Token.

Die Secrets gehören nicht in `netlify.toml`, GitHub, Frontend-Variablen oder Build-Befehle. Kein zusätzlicher Netlify-API-Token ist für Blobs im Functions-Betrieb erforderlich.

## Was ist geschützt?

Alle App-Seiten, API-Endpunkte, PDF-/CSV-/ZIP-Downloads und Vorschauen laufen durch dieselbe serverseitige Basic-Authentication-Prüfung. Der öffentliche Publish-Ordner enthält keine Anwendung oder Kundendaten. Hintergrundaufträge prüfen zusätzlich eine auftragsgebundene Signatur. Schreibanfragen aus fremden Webseiten werden abgewiesen.

Ein gemeinsamer Testzugang erlaubt allen Testpersonen Zugriff auf dieselben Projekte, Budgets und Reports. Er ersetzt keine personenbezogenen Rechte. Für einen kleinen internen Test ist er vorgesehen; individuelle Anmeldung kann später ergänzt werden. Basic Authentication bietet keinen eigenen Logout-Knopf: ein privates Browserfenster nutzen und nach dem Test schließen. Kennwortänderungen sperren die bisherigen Zugangsdaten.

## Daten und Laufzeiten

Einstellungen werden pro Projekt in Netlify Blobs gespeichert; neue Deployments löschen sie nicht. Projektänderungen sind als Ganzes gespeichert; bei gleichzeitigen Bearbeitungen gilt der zuletzt gespeicherte Stand. Kunden daher zunächst unter den Testpersonen aufteilen.

Zeitbuchungen, Projekte und Aufgaben werden in Hintergrundaufträgen geladen. Der Browser fragt den Fortschritt ab. Die Report-Erstellung verwendet eine Kopie der beim Start gültigen Einstellungen. Jeder Lauf hat eine eigene ID und überschreibt keine vorherigen Reports. Laufende Aufträge können nach dem Schließen des Tabs weiterlaufen. Die Oberfläche besitzt noch keine Reporthistorie und keine automatische Löschfrist. Gespeicherte Daten können in der Netlify-Blobs-Verwaltung eingesehen/exportiert werden.

Produktionsdaten und Deploy-Preview-/Branch-Kontexte nutzen getrennte Stores. Produktionssecrets nicht für öffentliche Deploy Previews freigeben.

PDFs werden serverseitig erstellt, die Vorschau rendert die tatsächliche PDF mit lokal ausgeliefertem PDF.js im Browser. Der PDF-Renderer unterscheidet sich technisch von Python; Netlify-Reports haben eine separate Budgetseite. Monatssummen, kumulierte Budgetstunden, Asana-Priorität, lokale Fallbacks und Auditdateien bleiben erhalten.

Netlify muss Background Functions und Blobs im gewählten Tarif unterstützen. Laut aktueller Dokumentation stehen Background Functions auch in den aktuellen kreditbasierten Free-Tarifen zur Verfügung; ältere Tarife können abweichen. Verbrauch und Limits im vorhandenen Konto prüfen. Es ist kein zusätzlicher Render-Dienst erforderlich. Diese Vorbereitung veröffentlicht nichts und ändert keine Tarifbuchung.

## Prüfen vor Mitarbeitertest

- Ohne Login sind auch direkte `/api/...`-Aufrufe gesperrt.
- Richtiger Login, falsches Kennwort, fehlende Serverkonfiguration testen.
- Asana-Verbindung, Zeitraum, Projekt ohne Stunden und Budgetzuordnung prüfen.
- Einstellungen speichern, Seite neu öffnen und Speicherung kontrollieren.
- Report erstellen, PDF-Vorschau und ZIP herunterladen, kumulierte Budgets prüfen.
- Nach einem erneuten Deployment müssen gespeicherte Einstellungen erhalten bleiben.

Lokal geprüft: Fachlogik und API mit isolierten Testdaten, Zugangsschutz, Auftragsfortschritt, PDF-Erstellung, Netlify-Funktionspakete. Ein echter Netlify-Deploymenttest mit eurem Konto steht noch aus.

## Entwicklung

Node.js 24 installieren, dann `npm ci`, `npm run build`, `npm test`.
`npm run test:server` startet ausschließlich auf 127.0.0.1:8767 eine synthetische Vorschau ohne Asana-Zugriff. Sie nutzt absichtlich automatische Testauthentifizierung und einen flüchtigen Speicher, ist kein produktiver Server und wird von Netlify nicht gestartet.

Die Python-Tests laufen weiterhin mit `python -m pytest -q`.

## Quellen

- https://docs.netlify.com/build/functions/environment-variables/
- https://docs.netlify.com/build/functions/background-functions/
- https://docs.netlify.com/build/data-and-storage/netlify-blobs/
