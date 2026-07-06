const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");

const commandData = [
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Ticket-System verwalten")
    .addSubcommand((sub) =>
      sub
        .setName("panel")
        .setDescription("Sendet das Ticket-Panel in einen Kanal")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Zielkanal")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("close")
        .setDescription("Schliesst das aktuelle Ticket")
        .addStringOption((opt) =>
          opt.setName("reason").setDescription("Grund fuer das Schliessen").setRequired(false)
        )
    )
    .addSubcommand((sub) => sub.setName("claim").setDescription("Ticket claimen"))
    .addSubcommand((sub) => sub.setName("unclaim").setDescription("Claim entfernen"))
    .addSubcommand((sub) => sub.setName("reply").setDescription("Schnellantwort aus vordefinierter Liste senden"))
    .addSubcommand((sub) =>
      sub
        .setName("reopen")
        .setDescription("Geschlossenes Ticket wieder oeffnen")
        .addIntegerOption((opt) =>
          opt.setName("ticket").setDescription("Ticket-Nummer").setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("archived")
        .setDescription("Archivierte Tickets anzeigen")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Nur Tickets dieses Users anzeigen").setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("limit")
            .setDescription("Maximale Anzahl Eintraege")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(20)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Ticket-Status setzen")
        .addStringOption((opt) =>
          opt
            .setName("state")
            .setDescription("Neuer Ticket-Status")
            .setRequired(true)
            .addChoices(
              { name: "Open", value: "open" },
              { name: "Claimed", value: "claimed" },
              { name: "Waiting for User", value: "waiting-for-user" },
              { name: "Waiting for Support", value: "waiting-for-support" }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("User zum Ticket hinzufuegen")
        .addUserOption((opt) => opt.setName("user").setDescription("User").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("User aus Ticket entfernen")
        .addUserOption((opt) => opt.setName("user").setDescription("User").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("rename")
        .setDescription("Ticket-Kanal umbenennen")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Neuer Kanalname")
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(80)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("priority")
        .setDescription("Prioritaet setzen")
        .addStringOption((opt) =>
          opt
            .setName("level")
            .setDescription("Prioritaetsstufe")
            .setRequired(true)
            .addChoices(
              { name: "Low", value: "low" },
              { name: "Normal", value: "normal" },
              { name: "High", value: "high" },
              { name: "Urgent", value: "urgent" }
            )
        )
    )
    .addSubcommand((sub) => sub.setName("stats").setDescription("Zeigt Ticket-Statistiken"))
    .addSubcommand((sub) =>
      sub
        .setName("config")
        .setDescription("Einstellungen fuer das Ticket-System")
        .addStringOption((opt) =>
          opt
            .setName("key")
            .setDescription("Welche Einstellung soll geaendert werden?")
            .setRequired(true)
            .addChoices(
              { name: "Aktuelle Konfiguration anzeigen", value: "show" },
              { name: "Log-Kanal", value: "logChannelId" },
              { name: "Transcript-Kanal", value: "transcriptChannelId" },
              { name: "Close Delay (Sekunden)", value: "closeDeleteDelaySeconds" },
              { name: "Inaktivitaets-Reminder (Stunden)", value: "inactivityReminderHours" },
              { name: "Auto-Close bei Inaktivitaet (Stunden)", value: "inactivityAutoCloseHours" },
              { name: "Reopen-Fenster (Stunden)", value: "reopenWindowHours" },
              { name: "Nur 1 Ticket pro Typ", value: "allowOneTicketPerType" },
              { name: "Team-Rolle hinzufuegen", value: "addSupportRole" },
              { name: "Team-Rolle entfernen", value: "removeSupportRole" },
              { name: "Admin-Rolle hinzufuegen", value: "addAdminRole" },
              { name: "Admin-Rolle entfernen", value: "removeAdminRole" },
              { name: "Panel-Stil (true=Buttons, false=Dropdown)", value: "panelStyle" },
              { name: "Panel-Titel", value: "panelTitle" },
              { name: "Panel-Beschreibung", value: "panelDescription" },
              { name: "Panel-Farbe (Hex ohne #, z.B. 1f8b4c)", value: "panelColor" },
              { name: "Panel-Footer", value: "panelFooter" },
              { name: "Panel-Bild-URL", value: "panelImageUrl" },
              { name: "Panel-Thumbnail-URL", value: "panelThumbnailUrl" },
              { name: "Thread-Modus (true=Threads statt Kanaele)", value: "useThreads" },
              { name: "Thread-Kanal (Parent-Kanal fuer Threads)", value: "threadChannelId" }
            )
        )
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Kanalwert fuer Kanal-Einstellungen")
            .setRequired(false)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addRoleOption((opt) =>
          opt.setName("role").setDescription("Rollenwert fuer Rollen-Einstellungen").setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt.setName("bool").setDescription("Boolescher Wert true/false").setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("number")
            .setDescription("Numerischer Wert (Sekunden oder Stunden)")
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(8760)
        )
        .addStringOption((opt) =>
          opt
            .setName("text")
            .setDescription("Textwert fuer Titel, Beschreibung, URL oder Farbe")
            .setRequired(false)
            .setMaxLength(1000)
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName("tag")
        .setDescription("Ticket-Tags verwalten")
        .addSubcommand((sub) =>
          sub
            .setName("add")
            .setDescription("Tag hinzufuegen")
            .addStringOption((opt) =>
              opt.setName("name").setDescription("Tag-Name").setRequired(true).setMaxLength(30)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("remove")
            .setDescription("Tag entfernen")
            .addStringOption((opt) =>
              opt.setName("name").setDescription("Tag-Name").setRequired(true).setMaxLength(30)
            )
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName("blacklist")
        .setDescription("Blacklist verwalten")
        .addSubcommand((sub) =>
          sub
            .setName("add")
            .setDescription("User zur Blacklist hinzufuegen")
            .addUserOption((opt) =>
              opt.setName("user").setDescription("User").setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("remove")
            .setDescription("User von Blacklist entfernen")
            .addUserOption((opt) =>
              opt.setName("user").setDescription("User").setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub.setName("list").setDescription("Blacklist anzeigen")
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .toJSON()
];

async function registerCommands({ token, clientId, guildId }) {
  if (!token || !clientId) {
    throw new Error("DISCORD_TOKEN oder DISCORD_CLIENT_ID fehlt.");
  }

  const rest = new REST({ version: "10" }).setToken(token);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commandData
    });
    return { scope: "guild", guildId, count: commandData.length };
  }

  await rest.put(Routes.applicationCommands(clientId), {
    body: commandData
  });
  return { scope: "global", count: commandData.length };
}

module.exports = {
  registerCommands,
  commandData
};
