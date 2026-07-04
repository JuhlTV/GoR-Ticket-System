const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const commandData = [
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Ticket-System verwalten")
    .addSubcommand((sub) =>
      sub
        .setName("panel")
        .setDescription("Sendet das Ticket-Panel in einen Kanal")
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("Zielkanal").setRequired(true)
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
              { name: "Log-Kanal", value: "logChannelId" },
              { name: "Transcript-Kanal", value: "transcriptChannelId" },
              { name: "Close Delay (Sekunden)", value: "closeDeleteDelaySeconds" },
              { name: "Nur 1 Ticket pro Typ", value: "allowOneTicketPerType" },
              { name: "Support-Rolle hinzufuegen", value: "addSupportRole" },
              { name: "Support-Rolle entfernen", value: "removeSupportRole" },
              { name: "Admin-Rolle hinzufuegen", value: "addAdminRole" },
              { name: "Admin-Rolle entfernen", value: "removeAdminRole" }
            )
        )
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("Kanalwert fuer Kanal-Einstellungen").setRequired(false)
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
            .setDescription("Numerischer Wert")
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(3600)
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
