const path = require("path");
const fs = require("fs-extra");
const {
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const logger = require("./logger");
const { JsonStore } = require("./store");

const SETTINGS_PATH = path.join(process.cwd(), "config", "settings.json");
const TYPES_PATH = path.join(process.cwd(), "config", "ticket-types.json");
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

const DEFAULT_SETTINGS = {
  globalSupportRoleIds: [],
  adminRoleIds: [],
  logChannelId: "",
  transcriptChannelId: "",
  allowOneTicketPerType: true,
  closeDeleteDelaySeconds: 10,
  ticketChannelNameFormat: "ticket-{id}-{user}",
  maxMessagesInTranscript: 500
};

function sanitizeChannelName(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

function safeContent(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join(" ")
    .trim();
}

async function createTicketRuntime(client) {
  await fs.ensureDir(path.dirname(SETTINGS_PATH));

  const defaultSettings = {
    ...DEFAULT_SETTINGS,
    ...(await readJsonWithFallback(SETTINGS_PATH, DEFAULT_SETTINGS))
  };
  const ticketTypes = normalizeTicketTypes(await readJsonWithFallback(TYPES_PATH, []));

  if (ticketTypes.length === 0) {
    throw new Error("ticket-types.json enthaelt keine gueltigen Ticket-Typen.");
  }

  const store = new JsonStore(STORE_PATH);
  await store.init();

  return new TicketRuntime(client, defaultSettings, ticketTypes, store);
}

async function readJsonWithFallback(filePath, fallback) {
  const exists = await fs.pathExists(filePath);
  if (!exists) {
    await fs.writeJson(filePath, fallback, { spaces: 2 });
    return fallback;
  }

  try {
    const parsed = await fs.readJson(filePath);
    return parsed ?? fallback;
  } catch (error) {
    logger.warn("Konfigurationsdatei ungueltig, nutze Fallback", {
      filePath,
      error: error.message
    });
    return fallback;
  }
}

function normalizeTicketTypes(value) {
  if (!Array.isArray(value)) return [];

  const normalized = [];
  const usedIds = new Set();

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    if (!item.id || !item.label) continue;

    const id = sanitizeChannelName(String(item.id));
    if (!id || usedIds.has(id)) continue;

    usedIds.add(id);
    normalized.push({
      id,
      label: String(item.label).slice(0, 100),
      description: String(item.description || "Support-Anfrage").slice(0, 100),
      emoji: item.emoji ? String(item.emoji) : "🎫",
      categoryName: String(item.categoryName || "SUPPORT TICKETS").slice(0, 100),
      supportRoleIds: Array.isArray(item.supportRoleIds)
        ? [...new Set(item.supportRoleIds.map((idValue) => String(idValue)))]
        : []
    });
  }

  return normalized;
}

class TicketRuntime {
  constructor(client, defaultSettings, ticketTypes, store) {
    this.client = client;
    this.defaultSettings = defaultSettings;
    this.ticketTypes = ticketTypes;
    this.store = store;
  }

  getTypeById(typeId) {
    return this.ticketTypes.find((type) => type.id === typeId) || null;
  }

  getGuildSettings(guildId) {
    return this.store.getSettings(guildId, this.defaultSettings);
  }

  isAdmin(member, settings) {
    if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
    const adminRoles = settings.adminRoleIds || [];
    return member.roles.cache.some((role) => adminRoles.includes(role.id));
  }

  isSupport(member, settings, ticketType) {
    if (this.isAdmin(member, settings)) return true;

    const globalSupport = settings.globalSupportRoleIds || [];
    const typeSupport = ticketType?.supportRoleIds || [];
    const supportRoleIds = [...new Set([...globalSupport, ...typeSupport])];

    return member.roles.cache.some((role) => supportRoleIds.includes(role.id));
  }

  async handleInteraction(interaction) {
    if (!interaction.inGuild()) return;

    if (interaction.isChatInputCommand() && interaction.commandName === "ticket") {
      return this.handleTicketCommand(interaction);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "ticket:create") {
      return this.handleTicketCreateSelect(interaction);
    }

    if (interaction.isButton()) {
      return this.handleTicketButtons(interaction);
    }

    if (interaction.isModalSubmit()) {
      return this.handleTicketModals(interaction);
    }
  }

  async handleTicketCommand(interaction) {
    const sub = interaction.options.getSubcommand();
    const settings = this.getGuildSettings(interaction.guildId);

    if (sub === "panel") {
      if (!this.isAdmin(interaction.member, settings)) {
        return interaction.reply({ content: "Dafuer fehlen dir Admin-Rechte.", ephemeral: true });
      }

      const channel = interaction.options.getChannel("channel", true);
      if (!channel.isTextBased()) {
        return interaction.reply({
          content: "Bitte einen Textkanal oder Ankuendigungs-Kanal auswaehlen.",
          ephemeral: true
        });
      }

      await this.sendTicketPanel(channel);
      return interaction.reply({
        content: `Ticket-Panel wurde in ${channel} gesendet.`,
        ephemeral: true
      });
    }

    if (sub === "stats") {
      if (!this.isAdmin(interaction.member, settings)) {
        return interaction.reply({ content: "Dafuer fehlen dir Admin-Rechte.", ephemeral: true });
      }

      const stats = this.store.getStats(interaction.guildId);
      const embed = new EmbedBuilder()
        .setTitle("Ticket-Statistiken")
        .setColor(0x2f3136)
        .addFields(
          { name: "Erstellt", value: String(stats.opened), inline: true },
          { name: "Geschlossen", value: String(stats.closed), inline: true },
          { name: "Offen", value: String(stats.openNow), inline: true },
          { name: "Letzte Ticket-Nr", value: String(stats.lastTicketNumber), inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === "config") {
      return this.handleConfigCommand(interaction, settings);
    }

    const ticket = this.store.getTicket(interaction.guildId, interaction.channelId);
    if (!ticket) {
      return interaction.reply({
        content: "Dieser Befehl funktioniert nur in einem Ticket-Kanal.",
        ephemeral: true
      });
    }

    const ticketType = this.getTypeById(ticket.typeId);
    const isAdmin = this.isAdmin(interaction.member, settings);
    const isSupport = this.isSupport(interaction.member, settings, ticketType);
    const isCreator = interaction.user.id === ticket.creatorId;

    if (sub === "close") {
      if (!isCreator && !isSupport && !isAdmin) {
        return interaction.reply({ content: "Du darfst dieses Ticket nicht schliessen.", ephemeral: true });
      }

      const reason = interaction.options.getString("reason") || "Kein Grund angegeben";
      await interaction.reply({ content: "Ticket wird geschlossen...", ephemeral: true });
      return this.closeTicketChannel(interaction.channel, interaction.user, reason);
    }

    if (sub === "claim") {
      if (!isSupport) {
        return interaction.reply({ content: "Nur Support/Admin kann claimen.", ephemeral: true });
      }

      await this.store.updateTicket(interaction.guildId, interaction.channelId, {
        claimedBy: interaction.user.id
      });

      return interaction.reply({ content: `Ticket wurde von ${interaction.user} geclaimt.` });
    }

    if (sub === "unclaim") {
      if (!isSupport) {
        return interaction.reply({ content: "Nur Support/Admin kann unclaimen.", ephemeral: true });
      }

      await this.store.updateTicket(interaction.guildId, interaction.channelId, {
        claimedBy: null
      });

      return interaction.reply({ content: "Claim wurde entfernt." });
    }

    if (sub === "add") {
      if (!isSupport && !isAdmin) {
        return interaction.reply({ content: "Nur Support/Admin kann User hinzufuegen.", ephemeral: true });
      }

      const user = interaction.options.getUser("user", true);
      await interaction.channel.permissionOverwrites.edit(user.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true
      });

      const participants = new Set(ticket.participants || []);
      participants.add(user.id);
      await this.store.updateTicket(interaction.guildId, interaction.channelId, {
        participants: [...participants]
      });

      return interaction.reply({ content: `${user} wurde zum Ticket hinzugefuegt.` });
    }

    if (sub === "remove") {
      if (!isSupport && !isAdmin) {
        return interaction.reply({ content: "Nur Support/Admin kann User entfernen.", ephemeral: true });
      }

      const user = interaction.options.getUser("user", true);
      if (user.id === ticket.creatorId) {
        return interaction.reply({ content: "Der Ticket-Ersteller kann nicht entfernt werden.", ephemeral: true });
      }

      await interaction.channel.permissionOverwrites.delete(user.id);
      const participants = (ticket.participants || []).filter((id) => id !== user.id);
      await this.store.updateTicket(interaction.guildId, interaction.channelId, {
        participants
      });

      return interaction.reply({ content: `${user} wurde aus dem Ticket entfernt.` });
    }

    if (sub === "rename") {
      if (!isSupport && !isAdmin) {
        return interaction.reply({ content: "Nur Support/Admin darf umbenennen.", ephemeral: true });
      }

      const nextName = sanitizeChannelName(interaction.options.getString("name", true));
      await interaction.channel.setName(nextName);
      return interaction.reply({ content: `Ticket-Kanal umbenannt zu #${nextName}.` });
    }

    if (sub === "priority") {
      if (!isSupport && !isAdmin) {
        return interaction.reply({ content: "Nur Support/Admin darf Prioritaet setzen.", ephemeral: true });
      }

      const level = interaction.options.getString("level", true);
      await this.store.updateTicket(interaction.guildId, interaction.channelId, {
        priority: level
      });

      const colors = {
        low: "🟢",
        normal: "🟡",
        high: "🟠",
        urgent: "🔴"
      };

      return interaction.reply({ content: `Prioritaet gesetzt: ${colors[level]} ${level}` });
    }
  }

  async handleConfigCommand(interaction, settings) {
    if (!this.isAdmin(interaction.member, settings)) {
      return interaction.reply({ content: "Dafuer fehlen dir Admin-Rechte.", ephemeral: true });
    }

    const key = interaction.options.getString("key", true);
    const channel = interaction.options.getChannel("channel");
    const role = interaction.options.getRole("role");
    const bool = interaction.options.getBoolean("bool");
    const number = interaction.options.getInteger("number");

    if (key === "logChannelId" || key === "transcriptChannelId") {
      if (!channel) {
        return interaction.reply({ content: "Bitte channel angeben.", ephemeral: true });
      }

      if (!channel.isTextBased()) {
        return interaction.reply({
          content: "Der Kanal muss textbasiert sein.",
          ephemeral: true
        });
      }

      await this.store.setSetting(interaction.guildId, key, channel.id);
      return interaction.reply({ content: `${key} wurde auf ${channel} gesetzt.`, ephemeral: true });
    }

    if (key === "closeDeleteDelaySeconds") {
      if (number === null) {
        return interaction.reply({ content: "Bitte number angeben.", ephemeral: true });
      }

      await this.store.setSetting(interaction.guildId, key, number);
      return interaction.reply({ content: `Close Delay auf ${number} Sekunden gesetzt.`, ephemeral: true });
    }

    if (key === "allowOneTicketPerType") {
      if (bool === null) {
        return interaction.reply({ content: "Bitte bool angeben.", ephemeral: true });
      }

      await this.store.setSetting(interaction.guildId, key, bool);
      return interaction.reply({ content: `allowOneTicketPerType = ${bool}`, ephemeral: true });
    }

    if (key === "addSupportRole") {
      if (!role) return interaction.reply({ content: "Bitte role angeben.", ephemeral: true });
      const updated = await this.store.addRoleToListSetting(interaction.guildId, "globalSupportRoleIds", role.id);
      return interaction.reply({
        content: `Support-Rolle hinzugefuegt. Aktuell: ${updated.map((id) => `<@&${id}>`).join(", ") || "keine"}`,
        ephemeral: true
      });
    }

    if (key === "removeSupportRole") {
      if (!role) return interaction.reply({ content: "Bitte role angeben.", ephemeral: true });
      const updated = await this.store.removeRoleFromListSetting(interaction.guildId, "globalSupportRoleIds", role.id);
      return interaction.reply({
        content: `Support-Rolle entfernt. Aktuell: ${updated.map((id) => `<@&${id}>`).join(", ") || "keine"}`,
        ephemeral: true
      });
    }

    if (key === "addAdminRole") {
      if (!role) return interaction.reply({ content: "Bitte role angeben.", ephemeral: true });
      const updated = await this.store.addRoleToListSetting(interaction.guildId, "adminRoleIds", role.id);
      return interaction.reply({
        content: `Admin-Rolle hinzugefuegt. Aktuell: ${updated.map((id) => `<@&${id}>`).join(", ") || "keine"}`,
        ephemeral: true
      });
    }

    if (key === "removeAdminRole") {
      if (!role) return interaction.reply({ content: "Bitte role angeben.", ephemeral: true });
      const updated = await this.store.removeRoleFromListSetting(interaction.guildId, "adminRoleIds", role.id);
      return interaction.reply({
        content: `Admin-Rolle entfernt. Aktuell: ${updated.map((id) => `<@&${id}>`).join(", ") || "keine"}`,
        ephemeral: true
      });
    }

    return interaction.reply({
      content: "Unbekannter Config-Key.",
      ephemeral: true
    });
  }

  async sendTicketPanel(channel) {
    const embed = new EmbedBuilder()
      .setColor(0x1f8b4c)
      .setTitle("Support Ticket erstellen")
      .setDescription(
        "Waehle den passenden Ticket-Typ aus. Danach oeffnet sich ein Formular fuer dein Anliegen."
      )
      .addFields(
        this.ticketTypes.slice(0, 25).map((type) => ({
          name: `${type.emoji || "🎫"} ${type.label}`,
          value: type.description || "Keine Beschreibung"
        }))
      )
      .setFooter({ text: "Bitte ein Ticket pro Thema erstellen." })
      .setTimestamp();

    const menu = new StringSelectMenuBuilder()
      .setCustomId("ticket:create")
      .setPlaceholder("Welchen Support brauchst du?")
      .addOptions(
        this.ticketTypes.slice(0, 25).map((type) => ({
          label: type.label.slice(0, 100),
          value: type.id,
          description: (type.description || "Ticket erstellen").slice(0, 100),
          emoji: type.emoji || undefined
        }))
      );

    const row = new ActionRowBuilder().addComponents(menu);
    await channel.send({ embeds: [embed], components: [row] });
  }

  async handleTicketCreateSelect(interaction) {
    const typeId = interaction.values[0];
    const type = this.getTypeById(typeId);

    if (!type) {
      return interaction.reply({ content: "Ungueltiger Ticket-Typ.", ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId(`ticket:createModal:${typeId}`)
      .setTitle(`Ticket: ${type.label}`);

    const reasonInput = new TextInputBuilder()
      .setCustomId("reason")
      .setLabel("Beschreibe dein Anliegen")
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(5)
      .setMaxLength(1000)
      .setRequired(true)
      .setPlaceholder("Beschreibe dein Problem so genau wie moeglich...");

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    return interaction.showModal(modal);
  }

  async handleTicketButtons(interaction) {
    if (interaction.customId === "ticket:close") {
      const modal = new ModalBuilder()
        .setCustomId("ticket:closeModal")
        .setTitle("Ticket schliessen");

      const reasonInput = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Schliessungsgrund")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200)
        .setPlaceholder("z.B. Problem geloest");

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      return interaction.showModal(modal);
    }

    const ticket = this.store.getTicket(interaction.guildId, interaction.channelId);
    if (!ticket) {
      return interaction.reply({
        content: "Das ist kein aktiver Ticket-Kanal.",
        ephemeral: true
      });
    }

    const settings = this.getGuildSettings(interaction.guildId);
    const ticketType = this.getTypeById(ticket.typeId);
    const isSupport = this.isSupport(interaction.member, settings, ticketType);

    if (!isSupport) {
      return interaction.reply({ content: "Nur Support/Admin kann diese Aktion ausfuehren.", ephemeral: true });
    }

    if (interaction.customId === "ticket:claim") {
      await this.store.updateTicket(interaction.guildId, interaction.channelId, { claimedBy: interaction.user.id });
      return interaction.reply({ content: `Ticket wurde von ${interaction.user} geclaimt.` });
    }

    if (interaction.customId === "ticket:unclaim") {
      await this.store.updateTicket(interaction.guildId, interaction.channelId, { claimedBy: null });
      return interaction.reply({ content: "Claim wurde entfernt." });
    }
  }

  async handleTicketModals(interaction) {
    if (interaction.customId.startsWith("ticket:createModal:")) {
      const typeId = interaction.customId.split(":")[2];
      return this.createTicketFromModal(interaction, typeId);
    }

    if (interaction.customId === "ticket:closeModal") {
      const ticket = this.store.getTicket(interaction.guildId, interaction.channelId);
      if (!ticket) {
        return interaction.reply({ content: "Kein aktives Ticket gefunden.", ephemeral: true });
      }

      const settings = this.getGuildSettings(interaction.guildId);
      const type = this.getTypeById(ticket.typeId);
      const isAdmin = this.isAdmin(interaction.member, settings);
      const isSupport = this.isSupport(interaction.member, settings, type);
      const isCreator = interaction.user.id === ticket.creatorId;

      if (!isCreator && !isSupport && !isAdmin) {
        return interaction.reply({ content: "Du darfst dieses Ticket nicht schliessen.", ephemeral: true });
      }

      const reason = interaction.fields.getTextInputValue("reason") || "Kein Grund angegeben";
      await interaction.reply({ content: "Ticket wird geschlossen...", ephemeral: true });
      return this.closeTicketChannel(interaction.channel, interaction.user, reason);
    }
  }

  async createTicketFromModal(interaction, typeId) {
    const type = this.getTypeById(typeId);
    if (!type) {
      return interaction.reply({ content: "Ungueltiger Ticket-Typ.", ephemeral: true });
    }

    const settings = this.getGuildSettings(interaction.guildId);
    const reason = interaction.fields.getTextInputValue("reason");

    if (settings.allowOneTicketPerType) {
      const existing = this.store.findOpenTicketByUserAndType(interaction.guildId, interaction.user.id, typeId);
      if (existing) {
        return interaction.reply({
          content: `Du hast bereits ein offenes ${type.label}-Ticket: <#${existing.channelId}>`,
          ephemeral: true
        });
      }
    }

    let channel;
    try {
      channel = await this.createTicketChannel(interaction.guild, interaction.member, type, settings);
    } catch (error) {
      logger.error("Ticket-Kanal konnte nicht erstellt werden", { error: error.message });
      return interaction.reply({
        content: "Ticket konnte nicht erstellt werden. Bitte pruefe Bot-Rechte und versuche es erneut.",
        ephemeral: true
      });
    }

    const ticket = await this.store.createTicket(interaction.guildId, {
      guildId: interaction.guildId,
      channelId: channel.id,
      creatorId: interaction.user.id,
      typeId,
      reason: safeContent(reason)
    });

    const finalName = this.buildTicketChannelName(settings, ticket.ticketId, interaction.user.username);
    if (channel.name !== finalName) {
      await channel.setName(finalName).catch(() => null);
    }

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle(`Ticket #${ticket.ticketId} - ${type.label}`)
      .setDescription("Unser Support-Team hilft dir schnellstmoeglich weiter.")
      .addFields(
        { name: "Erstellt von", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Prioritaet", value: "🟡 normal", inline: true },
        { name: "Anliegen", value: safeContent(reason).slice(0, 1024) || "Kein Text" }
      )
      .setTimestamp();

    const actions = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ticket:close").setLabel("Close").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("ticket:claim").setLabel("Claim").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("ticket:unclaim").setLabel("Unclaim").setStyle(ButtonStyle.Secondary)
    );

    await channel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [embed],
      components: [actions]
    });

    await this.sendLog(interaction.guild, settings.logChannelId, {
      title: "Ticket erstellt",
      color: 0x1f8b4c,
      fields: [
        { name: "Ticket", value: `#${ticket.ticketId}`, inline: true },
        { name: "Kanal", value: `<#${channel.id}>`, inline: true },
        { name: "Typ", value: type.label, inline: true },
        { name: "User", value: `<@${interaction.user.id}>`, inline: true }
      ]
    });

    return interaction.reply({
      content: `Dein Ticket wurde erstellt: ${channel}`,
      ephemeral: true
    });
  }

  async createTicketChannel(guild, member, ticketType, settings) {
    const me = guild.members.me;
    if (!me) {
      throw new Error("Bot-Mitglied in Guild nicht gefunden.");
    }

    let category = guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        channel.name.toLowerCase() === String(ticketType.categoryName || "tickets").toLowerCase()
    );

    if (!category) {
      category = await guild.channels.create({
        name: String(ticketType.categoryName || "TICKETS").slice(0, 100),
        type: ChannelType.GuildCategory
      });
    }

    const supportRoleIds = [
      ...(settings.globalSupportRoleIds || []),
      ...(ticketType.supportRoleIds || [])
    ];

    const overwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles
        ]
      },
      {
        id: me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages
        ]
      }
    ];

    for (const roleId of [...new Set(supportRoleIds)]) {
      overwrites.push({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles
        ]
      });
    }

    return guild.channels.create({
      name: `ticket-${sanitizeChannelName(member.user.username)}`.slice(0, 95),
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: overwrites,
      topic: `Support-Ticket von ${member.user.tag} (${member.id})`
    });
  }

  buildTicketChannelName(settings, ticketId, username) {
    const format = settings.ticketChannelNameFormat || "ticket-{id}-{user}";
    const userPart = sanitizeChannelName(username || "user");
    const rendered = format
      .replaceAll("{id}", String(ticketId))
      .replaceAll("{user}", userPart || "user");

    return sanitizeChannelName(rendered) || `ticket-${ticketId}`;
  }

  async closeTicketChannel(channel, closedByUser, reason) {
    const guildId = channel.guild.id;
    const settings = this.getGuildSettings(guildId);
    const ticket = this.store.getTicket(guildId, channel.id);

    if (!ticket) return;
    if (ticket.status === "closing") return;

    await this.store.updateTicket(guildId, channel.id, {
      status: "closing",
      closedBy: closedByUser.id,
      closeReason: safeContent(reason)
    });

    const transcript = await this.createTranscript(channel, settings.maxMessagesInTranscript || 500);
    const transcriptFileName = `transcript-ticket-${ticket.ticketId}.md`;
    const transcriptBuffer = Buffer.from(transcript, "utf8");
    const attachmentForLog = new AttachmentBuilder(transcriptBuffer, {
      name: transcriptFileName
    });
    const attachmentForTranscript = new AttachmentBuilder(transcriptBuffer, {
      name: transcriptFileName
    });

    const type = this.getTypeById(ticket.typeId);

    await this.sendLog(channel.guild, settings.logChannelId, {
      title: "Ticket geschlossen",
      color: 0xdb4437,
      fields: [
        { name: "Ticket", value: `#${ticket.ticketId}`, inline: true },
        { name: "Typ", value: type?.label || ticket.typeId, inline: true },
        { name: "Ersteller", value: `<@${ticket.creatorId}>`, inline: true },
        { name: "Geschlossen von", value: `<@${closedByUser.id}>`, inline: true },
        { name: "Grund", value: safeContent(reason).slice(0, 1024) || "Kein Grund" }
      ],
      files: [attachmentForLog]
    });

    if (settings.transcriptChannelId) {
      const transcriptChannel = channel.guild.channels.cache.get(settings.transcriptChannelId);
      if (transcriptChannel && transcriptChannel.isTextBased()) {
        await transcriptChannel.send({
          content: `Transcript fuer Ticket #${ticket.ticketId}`,
          files: [attachmentForTranscript]
        });
      }
    }

    await this.store.closeTicket(guildId, channel.id);

    const delay = Math.max(0, Number(settings.closeDeleteDelaySeconds || 0));
    await channel.send(`Ticket wird in ${delay} Sekunden geschlossen. Grund: ${safeContent(reason) || "Kein Grund"}`);

    setTimeout(async () => {
      await channel.delete("Ticket geschlossen").catch((error) => {
        logger.warn("Ticket-Channel konnte nicht geloescht werden", { error: error.message });
      });
    }, delay * 1000);
  }

  async createTranscript(channel, maxMessages) {
    const messages = [];
    let before;

    while (messages.length < maxMessages) {
      const take = Math.min(100, maxMessages - messages.length);
      const fetched = await channel.messages.fetch({ limit: take, before });
      if (fetched.size === 0) break;

      const current = [...fetched.values()];
      messages.push(...current);
      before = current[current.length - 1].id;

      if (current.length < take) break;
    }

    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const lines = [
      `# Transcript ${channel.name}`,
      `Guild: ${channel.guild.name} (${channel.guild.id})`,
      `Channel: ${channel.name} (${channel.id})`,
      `Created: ${new Date().toISOString()}`,
      ""
    ];

    for (const message of messages) {
      const time = new Date(message.createdTimestamp).toISOString();
      const author = `${message.author.tag} (${message.author.id})`;
      const content = safeContent(message.content) || "[Kein Text]";
      lines.push(`[${time}] ${author}: ${content}`);

      if (message.attachments.size > 0) {
        for (const attachment of message.attachments.values()) {
          lines.push(`  Attachment: ${attachment.url}`);
        }
      }
    }

    return lines.join("\n");
  }

  async sendLog(guild, logChannelId, payload) {
    if (!logChannelId) return;

    const channel = guild.channels.cache.get(logChannelId);
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(payload.title || "Ticket Log")
      .setColor(payload.color || 0x2f3136)
      .setTimestamp();

    if (Array.isArray(payload.fields) && payload.fields.length > 0) {
      embed.addFields(payload.fields);
    }

    await channel.send({
      embeds: [embed],
      files: payload.files || []
    });
  }
}

module.exports = {
  createTicketRuntime
};
