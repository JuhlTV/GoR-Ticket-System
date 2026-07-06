# Discord Ticket System (Galaxy-Style)

Ein leistungsstarkes, modernes Ticket-System fuer Support-Server mit einfacher Konfiguration.

## Features

- Ticket-Panel mit Dropdown-Auswahl nach Ticket-Typ
- Ticket-Erstellung per Modal (Problem-Beschreibung)
- Rollen- und Rechte-Management pro Ticket-Typ
- Claim/Unclaim, Prioritaet, Rename, Add/Remove User
- Transcript beim Schliessen (Markdown-Datei)
- Logging in separaten Kanaelen
- Einfache Konfiguration ueber JSON und Slash-Command
- Persistente Speicherung (Neustart-sicher)

## Schnellstart

1. Node.js 20+ installieren
2. Abhaengigkeiten installieren:
   npm install
3. Umgebungsdatei erstellen:
   - .env.example nach .env kopieren
   - Werte eintragen
4. Bot mit dem korrekten OAuth-Scope einladen oder neu einladen:
   npm run invite
   Wichtig: Der Link muss sowohl `bot` als auch `applications.commands` enthalten.
5. Befehle deployen:
   npm run deploy
6. Bot starten:
   npm start

## Setup im Discord-Server

1. Bot mit folgenden Rechten einladen:
   - Manage Channels
   - Manage Roles
   - Send Messages
   - Read Message History
   - Attach Files
   - Use Slash Commands
   - OAuth-Scopes: bot, applications.commands
2. Optional: Rollen/Kanaele in config/settings.json vorab eintragen
3. In Discord ausfuehren:
   - /ticket panel channel:#support
4. Support-Team arbeitet anschliessend mit:
   - /ticket close
   - /ticket claim
   - /ticket archived
   - /ticket reopen ticket:123
   - /ticket add
   - /ticket remove
   - /ticket rename
   - /ticket priority
   - /ticket stats
   - /ticket config

## Konfigurationsdateien

- config/settings.json: Globale Einstellungen
- config/ticket-types.json: Ticket-Kategorien und Typen

### Neue Settings

- inactivityReminderHours: Sendet nach X Stunden Inaktivitaet eine Erinnerung ins Ticket.
- inactivityAutoCloseHours: Schliesst Tickets nach X Stunden Inaktivitaet automatisch.
- reopenWindowHours: Zeitraum, in dem der Ersteller ein geschlossenes Ticket wieder oeffnen darf.
- inactivityMonitorIntervalMinutes: Intervall fuer die Inaktivitaetspruefung.

Diese Werte koennen auch direkt ueber `/ticket config` gesetzt werden.

- key:`inactivityReminderHours` number:`24`
- key:`inactivityAutoCloseHours` number:`168`
- key:`reopenWindowHours` number:`24`

### Ticket-Typ Felder

- defaultPriority: Standard-Prioritaet fuer neu erstellte Tickets dieses Typs.
- pingRoleIds: Rollen, die beim Erstellen oder Wiedereroeffnen erwaehnt werden.
- formFields: Zusaetzliche Formularfelder fuer das Ticket-Modal, z. B. Account, Beweise oder User-ID.

## Hinweise

- Bei AUTO_DEPLOY_COMMANDS=true werden Slash-Commands beim Start aktualisiert.
- Daten werden automatisch in data/store.json gespeichert.
- Wenn die Commands trotz erfolgreichem Deploy nicht sichtbar sind, den Bot ueber `npm run invite` mit `applications.commands` neu autorisieren und den Discord-Client einmal neu laden.

## Deployment auf Railway

1. Repository bei GitHub pushen und in Railway als neuen Service verbinden.
2. In Railway unter Variables setzen:
   - DISCORD_TOKEN
   - DISCORD_CLIENT_ID
   - DISCORD_GUILD_ID
   - AUTO_DEPLOY_COMMANDS=true (nur fuer den ersten Start empfohlen)
3. Der Bot startet automatisch mit npm start (railway.json ist bereits vorbereitet).
4. Nach dem ersten erfolgreichen Start AUTO_DEPLOY_COMMANDS auf false setzen.

### Persistente Ticket-Daten auf Railway

Railway nutzt ohne Volume ein nicht-persistentes Dateisystem. Damit offene Tickets und Statistiken Deployments ueberleben:

1. Railway Volume erstellen.
2. Volume in den Service mounten (z.B. auf /data).
3. Variable DATA_DIR=/data setzen.

Dann liegt die Datei dauerhaft unter /data/store.json.

Viel Erfolg mit deinem Support-System.
