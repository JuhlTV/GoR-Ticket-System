/**
 * Guild Settings Export/Backup
 * 
 * Diese Datei kann verwendet werden um Guild-Einstellungen schnell zu speichern,
 * zu versionieren oder über Umgebungen zu portieren.
 * 
 * Du kannst diese Einstellungen per Skript laden:
 * const settings = require('./config/guild-settings.js');
 * 
 * DEINE AKTUELLEN EINSTELLUNGEN:
 */

module.exports = {
  // Panel-Konfiguration
  panelStyle: "buttons",           // true=Buttons, false=Dropdown
  panelTitle: "Support-Hub",
  panelDescription: "Waehle deinen Support-Kanal...",
  panelColor: 0x5865f2,            // Discord-Blau (hex: 5865f2)
  panelFooter: "Bitte ein Ticket pro Thema erstellen.",
  panelImageUrl: "",
  panelThumbnailUrl: "",

  // Thread-Konfiguration
  useThreads: true,                // true=Threads, false=Kanaele
  threadChannelId: "",             // wird auf die Channel-ID gesetzt
  serverTeamRoleId: "",            // wird auf die Team-Rollen-ID gesetzt

  // Automatische Verwaltung
  allowOneTicketPerType: true,     // Nur 1 offenes Ticket pro Typ
  closeDeleteDelaySeconds: 10,     // Warten vor automatischem Kanal-Löschen
  inactivityReminderHours: 24,     // Erinnerung nach X Stunden Inaktivität
  inactivityAutoCloseHours: 168,   // Auto-Close nach X Stunden Inaktivität (7 Tage)
  reopenWindowHours: 24,           // Zeitfenster um Tickets erneut zu öffnen

  // Kanal-Konfiguration
  logChannelId: "",                // Logging-Kanal
  transcriptChannelId: "",         // Transcript/Archiv-Kanal

  // Hinweise zur Verwendung:
  // 1. Fülle die leeren IDs ein (Channel-IDs, Rollen-IDs)
  // 2. Du kannst diese Datei versionieren (git tracking)
  // 3. Für Produktion: Nutze .env Variablen oder ein Backend-System
  //
  // Beispiel zum Laden:
  // const { panelColor, useThreads } = require('./config/guild-settings.js');
};
