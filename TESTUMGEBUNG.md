# Mitarbeitertest auf Render

Diese Variante stellt die vorhandene Anwendung als gemeinsamen, passwortgeschützten Test bereit. Noch nicht veröffentlicht.

## Einrichten

1. Den Inhalt dieses Projektordners in ein privates GitHub- oder GitLab-Repository übernehmen. Alternativ das bereitgestellte ZIP entpacken. `.env`, Datenbanken, Reports und `.venv` gehören nicht ins Repository; das ZIP enthält sie nicht.
2. In Render unter „New > Blueprint“ das Repository verbinden und `render.yaml` auswählen.
3. Die Konfiguration schlägt einen Python-Webdienst in Frankfurt und 1 GB dauerhaften Speicher vor. Dienst und Datenträger sind kostenpflichtig: die angezeigten Kosten vor dem Anlegen prüfen.
4. `ASANA_ACCESS_TOKEN` direkt in Render als geheime Umgebungsvariable hinterlegen. Für den Test möglichst einen Asana-Zugang mit Zugriff nur auf die vorgesehenen Testprojekte verwenden. Der Token wird ausschließlich im Backend verwendet.
5. Render erzeugt `TEST_PASSWORD` automatisch. Benutzername: `apenio-test`. Das Kennwort kann in den Service-Einstellungen eingesehen bzw. durch ein zufälliges Kennwort mit mindestens 24 Zeichen ersetzt werden.
6. Nach dem Deployment die HTTPS-Adresse öffnen. Der Browser fragt nach Benutzername und Kennwort. Diese Zugangsdaten getrennt vom Link an die vorgesehenen Testpersonen geben.
7. Kontrollieren: ohne Anmeldung sind Startseite, API, PDF-Vorschauen und Downloads gesperrt. `/healthz` liefert ausschließlich den technischen Erreichbarkeitsstatus, prüft aber nicht den Asana-Token.

## Verhalten im Test

- Testpersonen benötigen nur Browser, Link und Testzugang. Kein lokales Python und kein eigener Asana-Token.
- Alle teilen dieselben Einstellungen. Bei gleichzeitiger Änderung desselben Kunden gilt der zuletzt gespeicherte Stand. Daher Kunden unter den Testpersonen aufteilen.
- Asana wird nur gelesen; Konfiguration und Budgetzuordnungen werden in der Testdatenbank gespeichert.
- Die neue Testdatenbank beginnt leer. Die lokale Datenbank wird nicht automatisch übertragen.
- Datenbank und Reports liegen auf dem persistenten Datenträger unter `/var/data`. Deployments ersetzen diesen Inhalt nicht.
- Jeder Reportlauf erhält einen eigenen Ablageort. Alte Vorschauen und Downloads werden nicht durch neue Läufe überschrieben.
- Keine geschützten Inhalte im Service-Worker-Cache. Browserantworten werden mit `Cache-Control: no-store` ausgeliefert.
- Dies ist ein gemeinsamer Testzugang ohne personenbezogene Rechte oder Auditprotokoll. Basic Authentication bietet keinen eigenen Logout-Knopf; für Tests ein privates Browserfenster verwenden und anschließend schließen. Bei Ende der Testrunde das Kennwort wechseln oder den Dienst abschalten.
- Für den Test einen Dienst mit einem Worker betreiben. Dauerhafte Nutzung benötigt zusätzlich Backup-Konzept, individuelle Anmeldung und Berechtigungskonzept.

## Lokal

Ohne `APP_ENV=hosted` läuft der bisherige lokale Start weiterhin wie gewohnt. Nicht ohne aktivierten Hostingmodus ins Internet stellen. Bei Render aktiviert auch dessen `RENDER`-Umgebungsvariable den Schutz. Ohne vollständigen Testzugang bleibt der Hostingmodus gesperrt.

## Referenzen

- https://render.com/docs/blueprint-spec
- https://render.com/docs/disks
