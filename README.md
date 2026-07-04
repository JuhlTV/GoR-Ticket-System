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
4. Befehle deployen:
   npm run deploy
5. Bot starten:
   npm start

## Setup im Discord-Server

1. Bot mit folgenden Rechten einladen:
   - Manage Channels
   - Manage Roles
   - Send Messages
   - Read Message History
   - Attach Files
   - Use Slash Commands
2. Optional: Rollen/Kanaele in config/settings.json vorab eintragen
3. In Discord ausfuehren:
   - /ticket panel channel:#support
4. Support-Team arbeitet anschliessend mit:
   - /ticket close
   - /ticket claim
   - /ticket add
   - /ticket remove
   - /ticket rename
   - /ticket priority
   - /ticket stats
   - /ticket config

## Konfigurationsdateien

- config/settings.json: Globale Einstellungen
- config/ticket-types.json: Ticket-Kategorien und Typen

## Hinweise

- Bei AUTO_DEPLOY_COMMANDS=true werden Slash-Commands beim Start aktualisiert.
- Daten werden automatisch in data/store.json gespeichert.

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
