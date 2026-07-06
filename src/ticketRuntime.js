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
const { buildHtmlTranscript } = require("./transcript");

const RESPONSES_PATH = path.join(process.cwd(), "config", "responses.json");

const SETTINGS_PATH = path.join(process.cwd(), "config", "settings.json");
const TYPES_PATH = path.join(process.cwd(), "config", "ticket-types.json");
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

const STATUS_META = {
  open: {
    label: "Open",
    emoji: "🟢"
  },
  claimed: {
    label: "Claimed",
    emoji: "🔵"
  },
  "waiting-for-user": {
    label: "Waiting for User",
    emoji: "🟠"
  },
  "waiting-for-support": {
    label: "Waiting for Support",
    emoji: "🟣"
  },
  closing: {
    label: "Closing",
    emoji: "⚫"
  },
  closed: {
    label: "Closed",
    emoji: "⚪"
  }
};

const PRIORITY_META = {
  low: "🟢 low",
  normal: "🟡 normal",
  high: "🟠 high",
  urgent: "🔴 urgent"
};

const DEFAULT_SETTINGS = {
  globalSupportRoleIds: [],
  adminRoleIds: [],
  logChannelId: "",
  transcriptChannelId: "",
  allowOneTicketPerType: true,
  closeDeleteDelaySeconds: 10,
  inactivityReminderHours: 24,
  inactivityAutoCloseHours: 168,
  reopenWindowHours: 24,
  inactivityMonitorIntervalMinutes: 5,
  ticketChannelNameFormat: "ticket-{id}-{user}",
  maxMessagesInTranscript: 500,
  panelStyle: "dropdown",
  panelTitle: "Support Ticket erstellen",
  panelDescription: "Waehle den passenden Ticket-Typ aus. Danach oeffnet sich ein Formular fuer dein Anliegen.",
  panelColor: 0x1f8b4c,
  panelFooter: "Bitte ein Ticket pro Thema erstellen.",
  panelImageUrl: "",
  panelThumbnailUrl: "",
  useThreads: false,
  threadChannelId: "",
  serverTeamRoleId: ""
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
    const formFields = Array.isArray(item.formFields)
      ? item.formFields
          .filter((field) => field && typeof field === "object" && field.label)
          .slice(0, 4)
          .map((field, index) => ({
            id: sanitizeChannelName(String(field.id || `field-${index + 1}`)) || `field-${index + 1}`,
            label: String(field.label).slice(0, 45),
            placeholder: String(field.placeholder || "").slice(0, 100),
            required: field.required !== false,
            style: String(field.style || "paragraph").toLowerCase() === "short" ? "short" : "paragraph",
            minLength: Math.max(0, Number(field.minLength || 0)),
            maxLength: Math.min(1000, Math.max(1, Number(field.maxLength || 300)))
          }))
      : [];

    normalized.push({
      id,
      label: String(item.label).slice(0, 100),
      description: String(item.description || "Support-Anfrage").slice(0, 100),
      emoji: item.emoji ? String(item.emoji) : "🎫",
      categoryName: String(item.categoryName || "SUPPORT TICKETS").slice(0, 100),
      defaultPriority: Object.prototype.hasOwnProperty.call(PRIORITY_META, String(item.defaultPriority))
        ? String(item.defaultPriority)
        : "normal",
      openingMessage: item.openingMessage ? String(item.openingMessage).slice(0, 2000) : null,
      pingRoleIds: Array.isArray(item.pingRoleIds)
        ? [...new Set(item.pingRoleIds.map((idValue) => String(idValue)))]
        : [],
      formFields,
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
    this.inactivityTimer = null;
  }

  getTypeById(typeId) {
    return this.ticketTypes.find((type) => type.id === typeId) || null;
  }

  getGuildSettings(guildId) {
    return this.store.getSettings(guildId, this.defaultSettings);
  }

  getStatusDisplay(status) {
    const meta = STATUS_META[status] || STATUS_META.open;
    return `${meta.emoji} ${meta.label}`;
  }

  buildTicketEmbed(ticket, ticketType) {
    const responseFields = Array.isArray(ticket.formResponses)
      ? ticket.formResponses.slice(0, 4).map((field) => ({
          name: field.label,
          value: safeContent(field.value).slice(0, 1024) || "Kein Text"
        }))
      : [];

    return new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle(`Ticket #${ticket.ticketId} - ${ticketType?.label || ticket.typeId}`)
      .setDescription("Unser Team hilft dir schnellstmoeglich weiter.")
      .addFields(
        { name: "Erstellt von", value: `<@${ticket.creatorId}>`, inline: true },
        { name: "Status", value: this.getStatusDisplay(ticket.status), inline: true },
        {
          name: "Zustaendig",
          value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : "Niemand",
          inline: true
        },
        { name: "Prioritaet", value: PRIORITY_META[ticket.priority] || PRIORITY_META.normal, inline: true },
        { name: "Anliegen", value: safeContent(ticket.reason).slice(0, 1024) || "Kein Text" },
        ...responseFields,
        ...(Array.isArray(ticket.tags) && ticket.tags.length > 0
          ? [{ name: "Tags", value: ticket.tags.map((t) => `\`${t}\``).join(" "), inline: true }]
          : [])
      )
      .setTimestamp(new Date(ticket.createdAt || Date.now()));
  }

  startInactivityMonitor() {
    if (this.inactivityTimer) {
      return;
    }

    const intervalMs = Math.max(1, Number(this.defaultSettings.inactivityMonitorIntervalMinutes || 5)) * 60 * 1000;
    this.inactivityTimer = setInterval(() => {
      void this.runInactivitySweep();
    }, intervalMs);

    if (typeof this.inactivityTimer.unref === "function") {
      this.inactivityTimer.unref();
    }

    void this.runInactivitySweep();
  }

  async runInactivitySweep() {
    const now = Date.now();

    for (const guild of this.client.guilds.cache.values()) {
      const settings = this.getGuildSettings(guild.id);
      const reminderMs = Math.max(0, Number(settings.inactivityReminderHours || 0)) * 60 * 60 * 1000;
      const autoCloseMs = Math.max(0, Number(settings.inactivityAutoCloseHours || 0)) * 60 * 60 * 1000;
      const openTickets = this.store.getAllOpenTickets(guild.id);

      for (const ticket of openTickets) {
        if (ticket.status === "closing" || ticket.status === "closed") {
          continue;
        }

        const lastActivityAt = Number(ticket.lastActivityAt || ticket.updatedAt || ticket.createdAt || now);
        const inactiveFor = now - lastActivityAt;

        const channel = guild.channels.cache.get(ticket.channelId) || (await guild.channels.fetch(ticket.channelId).catch(() => null));
        if (!channel || !channel.isTextBased()) {
          continue;
        }

        if (autoCloseMs > 0 && inactiveFor >= autoCloseMs) {
          await channel.send("Dieses Ticket wurde automatisch wegen Inaktivitaet geschlossen.").catch(() => null);
          await this.closeTicketChannel(channel, this.client.user, "Automatisch wegen Inaktivitaet geschlossen");
          continue;
        }

        if (reminderMs > 0 && inactiveFor >= reminderMs) {
          const remindedAt = Number(ticket.inactivityRemindedAt || 0);
          if (remindedAt < lastActivityAt) {
            await channel
              .send("Dieses Ticket ist aktuell inaktiv. Bitte antworte hier, falls noch Hilfe benoetigt wird.")
              .catch(() => null);
            await this.updateTicketState(guild.id, channel, {
              inactivityRemindedAt: now
            });
          }
        }
      }
    }
  }

  async syncTicketMessage(channel, ticket) {
    if (!ticket?.controlMessageId || !channel?.isTextBased()) {
      return;
    }

    const ticketType = this.getTypeById(ticket.typeId);

    try {
      const message = await channel.messages.fetch(ticket.controlMessageId);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket:close").setLabel("Close").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("ticket:claim").setLabel("Claim").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("ticket:unclaim").setLabel("Unclaim").setStyle(ButtonStyle.Secondary)
      );

      await message.edit({
        embeds: [this.buildTicketEmbed(ticket, ticketType)],
        components: [row]
      });
    } catch (error) {
      logger.warn("Ticket-Nachricht konnte nicht synchronisiert werden", { error: error.message });
    }
  }

  async updateTicketState(guildId, channel, patch) {
    const nextPatch = { ...patch };

    if (nextPatch.status) {
      nextPatch.statusUpdatedAt = Date.now();
    }

    const ticket = await this.store.updateTicket(guildId, channel.id, nextPatch);
    if (ticket) {
      await this.syncTicketMessage(channel, ticket);
    }

    return ticket;
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

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "ticket:create") {
        return this.handleTicketCreateSelect(interaction);
      }
      if (interaction.customId.startsWith("ticket:replyMenu:")) {
        return this.handleReplySelect(interaction);
      }
    }

    if (interaction.isButton()) {
      return this.handleTicketButtons(interaction);
    }

    if (interaction.isModalSubmit()) {
      return this.handleTicketModals(interaction);
    }
  }

  async handleMessage(message) {
    if (!message.guild || message.author.bot) return;

    const ticket = this.store.getTicket(message.guild.id, message.channel.id);
    if (!ticket || ticket.status === "closing" || ticket.status === "closed") {
      return;
    }

    const settings = this.getGuildSettings(message.guild.id);
    const ticketType = this.getTypeById(ticket.typeId);
    const isSupportMember = message.member && this.isSupport(message.member, settings, ticketType);
    const isParticipant = message.author.id === ticket.creatorId || (ticket.participants || []).includes(message.author.id);

    if (isSupportMember) {
      const patch = {};

      if (!ticket.firstSupportResponseAt) {
        patch.firstSupportResponseAt = Date.now();
      }

      if (ticket.status !== "waiting-for-user") {
        patch.status = "waiting-for-user";
      }

      patch.lastActivityAt = Date.now();
      patch.inactivityRemindedAt = null;

      if (Object.keys(patch).length > 0) {
        await this.updateTicketState(message.guild.id, message.channel, patch);
      }

      return;
    }

    if (isParticipant && ticket.status !== "waiting-for-support") {
      await this.updateTicketState(message.guild.id, message.channel, {
        status: "waiting-for-support",
        lastActivityAt: Date.now(),
        inactivityRemindedAt: null
      });
      return;
    }

    if (isParticipant) {
      await this.updateTicketState(message.guild.id, message.channel, {
        lastActivityAt: Date.now(),
        inactivityRemindedAt: null
      });
    }
  }

  async handleTicketCommand(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const settings = this.getGuildSettings(interaction.guildId);

    if (group === "tag") {
      return this.handleTagGroup(interaction, sub, settings);
    }

    if (group === "blacklist") {
      return this.handleBlacklistGroup(interaction, sub, settings);
    }

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

      await this.sendTicketPanel(channel, settings);
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
      const supporterStats = this.store.getSupporterStats(interaction.guildId);

      const embed = new EmbedBuilder()
        .setTitle("Ticket-Statistiken")
        .setColor(0x2f3136)
        .addFields(
          { name: "Erstellt", value: String(stats.opened), inline: true },
          { name: "Geschlossen", value: String(stats.closed), inline: true },
          { name: "Offen", value: String(stats.openNow), inline: true },
          { name: "Geclaimt", value: String(stats.claimedNow), inline: true },
          { name: "Waiting for User", value: String(stats.byStatus["waiting-for-user"]), inline: true },
          { name: "Waiting for Support", value: String(stats.byStatus["waiting-for-support"]), inline: true },
          { name: "Letzte Ticket-Nr", value: String(stats.lastTicketNumber), inline: true }
        )
        .setTimestamp();

      if (supporterStats.length > 0) {
        const supporterText = supporterStats.slice(0, 10).map((s, i) => {
          const avg = s.avgResponseTimeMs
            ? ` (avg. Antwortzeit: ${Math.round(s.avgResponseTimeMs / 60000)}m)`
            : "";
          return `${i + 1}. <@${s.userId}> — ${s.closed} Tickets${avg}`;
        }).join("\n");
        embed.addFields({ name: "Top Supporter", value: supporterText.slice(0, 1024) });
      }

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === "config") {
      return this.handleConfigCommand(interaction, settings);
    }

    if (sub === "reply") {
      const replyTicket = this.store.getTicket(interaction.guildId, interaction.channelId);
      if (!replyTicket) {
        return interaction.reply({ content: "Dieser Befehl funktioniert nur in einem Ticket-Kanal.", ephemeral: true });
      }
      const replyTicketType = this.getTypeById(replyTicket.typeId);
      if (!this.isSupport(interaction.member, settings, replyTicketType) && !this.isAdmin(interaction.member, settings)) {
        return interaction.reply({ content: "Nur Team/Admin kann Schnellantworten senden.", ephemeral: true });
      }
      const responses = await this.loadResponses();
      if (responses.length === 0) {
        return interaction.reply({ content: "Keine Schnellantworten in config/responses.json konfiguriert.", ephemeral: true });
      }
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`ticket:replyMenu:${interaction.channelId}`)
        .setPlaceholder("Antwort auswaehlen...")
        .addOptions(
          responses.slice(0, 25).map((r) => ({
            label: String(r.label || r.id).slice(0, 100),
            value: String(r.id).slice(0, 100),
            description: String(r.content || "").slice(0, 100)
          }))
        );
      return interaction.reply({
        content: "Waehle eine Schnellantwort:",
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true
      });
    }

    if (sub === "archived") {
      const requestedUser = interaction.options.getUser("user");
      const limit = interaction.options.getInteger("limit") || 10;
      const memberTicketType = null;
      const isAdmin = this.isAdmin(interaction.member, settings);
      const isSupport = this.isSupport(interaction.member, settings, memberTicketType);

      if (!isAdmin && !isSupport && requestedUser && requestedUser.id !== interaction.user.id) {
        return interaction.reply({
          content: "Du kannst nur deine eigenen archivierten Tickets anzeigen.",
          ephemeral: true
        });
      }

      const creatorId = isAdmin || isSupport ? requestedUser?.id : interaction.user.id;
      const archivedTickets = this.store.listClosedTickets(interaction.guildId, {
        creatorId,
        limit
      });

      if (archivedTickets.length === 0) {
        return interaction.reply({
          content: creatorId
            ? "Keine archivierten Tickets fuer diesen User gefunden."
            : "Keine archivierten Tickets gefunden.",
          ephemeral: true
        });
      }

      const description = archivedTickets
        .map((ticket) => {
          const type = this.getTypeById(ticket.typeId);
          const closedAt = ticket.closedAt ? `<t:${Math.floor(ticket.closedAt / 1000)}:f>` : "unbekannt";
          return [
            `#${ticket.ticketId} | ${type?.label || ticket.typeId}`,
            `Ersteller: <@${ticket.creatorId}>`,
            `Geschlossen: ${closedAt}`,
            `Grund: ${(ticket.closeReason || "Kein Grund").slice(0, 80)}`
          ].join("\n");
        })
        .join("\n\n");

      const embed = new EmbedBuilder()
        .setTitle("Archivierte Tickets")
        .setColor(0x2f3136)
        .setDescription(description.slice(0, 4096))
        .setFooter({ text: `Anzahl: ${archivedTickets.length}` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === "reopen") {
      const ticketId = interaction.options.getInteger("ticket", true);
      const archivedTicket = this.store.getClosedTicket(interaction.guildId, ticketId);
      if (!archivedTicket) {
        return interaction.reply({ content: `Kein archiviertes Ticket #${ticketId} gefunden.`, ephemeral: true });
      }

      const ticketType = this.getTypeById(archivedTicket.typeId);
      if (!ticketType) {
        return interaction.reply({
          content: "Der Ticket-Typ dieses archivierten Tickets existiert nicht mehr.",
          ephemeral: true
        });
      }

      const isAdmin = this.isAdmin(interaction.member, settings);
      const isSupport = this.isSupport(interaction.member, settings, ticketType);
      const isCreator = interaction.user.id === archivedTicket.creatorId;

      if (!isCreator && !isSupport && !isAdmin) {
        return interaction.reply({ content: "Du darfst dieses Ticket nicht wieder oeffnen.", ephemeral: true });
      }

      const reopenWindowHours = Math.max(0, Number(settings.reopenWindowHours || 0));
      if (!isSupport && !isAdmin && reopenWindowHours > 0) {
        const closedAt = Number(archivedTicket.closedAt || 0);
        const reopenDeadline = closedAt + reopenWindowHours * 60 * 60 * 1000;
        if (closedAt > 0 && Date.now() > reopenDeadline) {
          return interaction.reply({
            content: `Dieses Ticket kann nur innerhalb von ${reopenWindowHours} Stunden wieder geoeffnet werden.`,
            ephemeral: true
          });
        }
      }

      if (settings.allowOneTicketPerType) {
        const existing = this.store.findOpenTicketByUserAndType(interaction.guildId, archivedTicket.creatorId, archivedTicket.typeId);
        if (existing) {
          return interaction.reply({
            content: `Es gibt bereits ein offenes Ticket dieses Typs: <#${existing.channelId}>`,
            ephemeral: true
          });
        }
      }

      const creatorMember = await interaction.guild.members.fetch(archivedTicket.creatorId).catch(() => null);
      if (!creatorMember) {
        return interaction.reply({
          content: "Der Ticket-Ersteller ist nicht mehr auf dem Server. Ticket kann nicht wieder geoeffnet werden.",
          ephemeral: true
        });
      }

      let channel;
      try {
        channel = await this.createTicketChannel(interaction.guild, creatorMember, ticketType, settings);
      } catch (error) {
        logger.error("Ticket-Kanal konnte fuer Reopen nicht erstellt werden", { error: error.message });
        return interaction.reply({
          content: "Ticket konnte nicht wieder geoeffnet werden. Bitte pruefe Bot-Rechte.",
          ephemeral: true
        });
      }

      const finalName = this.buildTicketChannelName(settings, archivedTicket.ticketId, creatorMember.user.username);
      if (channel.name !== finalName) {
        await channel.setName(finalName).catch(() => null);
      }

      const reopenedTicket = await this.store.reopenTicket(interaction.guildId, ticketId, {
        guildId: interaction.guildId,
        channelId: channel.id,
        claimedBy: null,
        claimedAt: null,
        status: "open",
        lastActivityAt: Date.now(),
        inactivityRemindedAt: null
      });

      if (!reopenedTicket) {
        return interaction.reply({ content: "Reopen fehlgeschlagen.", ephemeral: true });
      }

      const actions = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket:close").setLabel("Close").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("ticket:claim").setLabel("Claim").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("ticket:unclaim").setLabel("Unclaim").setStyle(ButtonStyle.Secondary)
      );

      const pingMentions = [...new Set(ticketType?.pingRoleIds || [])].map((roleId) => `<@&${roleId}>`).join(" ");
      const controlMessage = await channel.send({
        content: [pingMentions, `<@${reopenedTicket.creatorId}>`, `Ticket #${reopenedTicket.ticketId} wurde wieder geoeffnet.`]
          .filter(Boolean)
          .join(" "),
        embeds: [this.buildTicketEmbed(reopenedTicket, ticketType)],
        components: [actions]
      });

      await this.updateTicketState(interaction.guildId, channel, {
        controlMessageId: controlMessage.id,
        reopenedBy: interaction.user.id
      });

      await this.sendLog(interaction.guild, settings.logChannelId, {
        title: "Ticket wieder geoeffnet",
        color: 0x4285f4,
        fields: [
          { name: "Ticket", value: `#${reopenedTicket.ticketId}`, inline: true },
          { name: "Kanal", value: `<#${channel.id}>`, inline: true },
          { name: "Typ", value: ticketType?.label || reopenedTicket.typeId, inline: true },
          { name: "Wieder geoeffnet von", value: `<@${interaction.user.id}>`, inline: true }
        ]
      });

      return interaction.reply({
        content: `Ticket #${reopenedTicket.ticketId} wurde wieder geoeffnet: ${channel}`,
        ephemeral: true
      });
    }

    if (sub === "status") {
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

      if (!isSupport && !isAdmin) {
        return interaction.reply({ content: "Nur Team/Admin darf den Status setzen.", ephemeral: true });
      }

      const nextStatus = interaction.options.getString("state", true);
      const patch = { status: nextStatus };

      if (nextStatus === "claimed" && !ticket.claimedBy) {
        patch.claimedBy = interaction.user.id;
        patch.claimedAt = Date.now();
      }

      if (nextStatus !== "claimed") {
        patch.claimedBy = nextStatus === "open" ? null : ticket.claimedBy;
      }

      await this.updateTicketState(interaction.guildId, interaction.channel, patch);
      return interaction.reply({ content: `Status gesetzt: ${this.getStatusDisplay(nextStatus)}` });
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
        return interaction.reply({ content: "Nur Team/Admin kann claimen.", ephemeral: true });
      }

      if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id) {
        return interaction.reply({
          content: `Dieses Ticket ist bereits von <@${ticket.claimedBy}> geclaimt.`,
          ephemeral: true
        });
      }

      await this.updateTicketState(interaction.guildId, interaction.channel, {
        claimedBy: interaction.user.id,
        claimedAt: ticket.claimedAt || Date.now(),
        status: "claimed"
      });

      return interaction.reply({ content: `Ticket wurde von ${interaction.user} geclaimt.` });
    }

    if (sub === "unclaim") {
      if (!isSupport) {
        return interaction.reply({ content: "Nur Team/Admin kann unclaimen.", ephemeral: true });
      }

      await this.updateTicketState(interaction.guildId, interaction.channel, {
        claimedBy: null,
        status: "waiting-for-support"
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
        return interaction.reply({ content: "Nur Team/Admin darf umbenennen.", ephemeral: true });
      }

      const nextName = sanitizeChannelName(interaction.options.getString("name", true));
      await interaction.channel.setName(nextName);
      return interaction.reply({ content: `Ticket-Kanal umbenannt zu #${nextName}.` });
    }

    if (sub === "priority") {
      if (!isSupport && !isAdmin) {
        return interaction.reply({ content: "Nur Team/Admin darf Prioritaet setzen.", ephemeral: true });
      }

      const level = interaction.options.getString("level", true);
      await this.updateTicketState(interaction.guildId, interaction.channel, {
        priority: level
      });

      return interaction.reply({ content: `Prioritaet gesetzt: ${PRIORITY_META[level] || level}` });
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
    const text = interaction.options.getString("text") ?? null;

    if (key === "show") {
      const formatRoleList = (roleIds) =>
        roleIds.length > 0 ? roleIds.map((id) => `<@&${id}>`).join(", ") : "keine";

      const embed = new EmbedBuilder()
        .setTitle("Ticket-Konfiguration")
        .setColor(0x2f3136)
        .addFields(
          { name: "Log-Kanal", value: settings.logChannelId ? `<#${settings.logChannelId}>` : "nicht gesetzt", inline: true },
          {
            name: "Transcript-Kanal",
            value: settings.transcriptChannelId ? `<#${settings.transcriptChannelId}>` : "nicht gesetzt",
            inline: true
          },
          { name: "Standard-Teamrollen", value: formatRoleList(settings.globalSupportRoleIds || []) },
          { name: "Admin-Rollen", value: formatRoleList(settings.adminRoleIds || []) },
          { name: "Nur 1 Ticket pro Typ", value: String(Boolean(settings.allowOneTicketPerType)), inline: true },
          { name: "Close Delay", value: `${Number(settings.closeDeleteDelaySeconds || 0)} Sekunden`, inline: true },
          { name: "Inaktivitaets-Reminder", value: `${Number(settings.inactivityReminderHours || 0)} Stunden`, inline: true },
          { name: "Auto-Close", value: `${Number(settings.inactivityAutoCloseHours || 0)} Stunden`, inline: true },
          { name: "Reopen-Fenster", value: `${Number(settings.reopenWindowHours || 0)} Stunden`, inline: true },
          { name: "Panel-Stil", value: String(settings.panelStyle || "dropdown"), inline: true },
          { name: "Panel-Titel", value: String(settings.panelTitle || "–").slice(0, 100), inline: true },
          { name: "Thread-Modus", value: String(Boolean(settings.useThreads)), inline: true },
          {
            name: "Thread-Kanal",
            value: settings.threadChannelId ? `<#${settings.threadChannelId}>` : "nicht gesetzt",
            inline: true
          },
          {
            name: "Server-Team-Rolle",
            value: settings.serverTeamRoleId ? `<@&${settings.serverTeamRoleId}>` : "nicht gesetzt",
            inline: true
          }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

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

    if (key === "inactivityReminderHours") {
      if (number === null) {
        return interaction.reply({ content: "Bitte number angeben.", ephemeral: true });
      }

      await this.store.setSetting(interaction.guildId, key, number);
      return interaction.reply({ content: `Inaktivitaets-Reminder auf ${number} Stunden gesetzt.`, ephemeral: true });
    }

    if (key === "inactivityAutoCloseHours") {
      if (number === null) {
        return interaction.reply({ content: "Bitte number angeben.", ephemeral: true });
      }

      await this.store.setSetting(interaction.guildId, key, number);
      return interaction.reply({ content: `Auto-Close bei Inaktivitaet auf ${number} Stunden gesetzt.`, ephemeral: true });
    }

    if (key === "reopenWindowHours") {
      if (number === null) {
        return interaction.reply({ content: "Bitte number angeben.", ephemeral: true });
      }

      await this.store.setSetting(interaction.guildId, key, number);
      return interaction.reply({ content: `Reopen-Fenster auf ${number} Stunden gesetzt.`, ephemeral: true });
    }

    if (key === "panelStyle") {
      if (bool === null) return interaction.reply({ content: "Bitte bool angeben (true=Buttons, false=Dropdown).", ephemeral: true });
      await this.store.setSetting(interaction.guildId, key, bool ? "buttons" : "dropdown");
      return interaction.reply({ content: `Panel-Stil: ${bool ? "Buttons" : "Dropdown"}.`, ephemeral: true });
    }

    if (key === "panelTitle" || key === "panelDescription" || key === "panelFooter" || key === "panelImageUrl" || key === "panelThumbnailUrl") {
      if (!text) return interaction.reply({ content: "Bitte text angeben.", ephemeral: true });
      await this.store.setSetting(interaction.guildId, key, text);
      return interaction.reply({ content: `${key} gesetzt.`, ephemeral: true });
    }

    if (key === "panelColor") {
      if (!text) return interaction.reply({ content: "Bitte text angeben (Hex-Farbe z.B. 1f8b4c).", ephemeral: true });
      const colorInt = parseInt(text.replace(/^#/, ""), 16);
      if (isNaN(colorInt)) return interaction.reply({ content: "Ungueltige Hex-Farbe.", ephemeral: true });
      await this.store.setSetting(interaction.guildId, key, colorInt);
      return interaction.reply({ content: `Panel-Farbe auf #${text.replace(/^#/, "")} gesetzt.`, ephemeral: true });
    }

    if (key === "useThreads") {
      if (bool === null) return interaction.reply({ content: "Bitte bool angeben.", ephemeral: true });
      await this.store.setSetting(interaction.guildId, key, bool);
      return interaction.reply({ content: `Thread-Modus: ${bool ? "aktiviert" : "deaktiviert"}.`, ephemeral: true });
    }

    if (key === "threadChannelId") {
      if (!channel) return interaction.reply({ content: "Bitte channel angeben.", ephemeral: true });
      await this.store.setSetting(interaction.guildId, key, channel.id);
      return interaction.reply({ content: `Thread-Kanal auf ${channel} gesetzt.`, ephemeral: true });
    }

    if (key === "serverTeamRoleId") {
      if (!role) return interaction.reply({ content: "Bitte role angeben.", ephemeral: true });
      await this.store.setSetting(interaction.guildId, key, role.id);
      return interaction.reply({ content: `Server-Team-Rolle auf ${role} gesetzt. Diese Rolle wird automatisch zu neuen Threads hinzugefuegt.`, ephemeral: true });
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
        content: `Team-Rolle hinzugefuegt. Aktuell: ${updated.map((id) => `<@&${id}>`).join(", ") || "keine"}`,
        ephemeral: true
      });
    }

    if (key === "removeSupportRole") {
      if (!role) return interaction.reply({ content: "Bitte role angeben.", ephemeral: true });
      const updated = await this.store.removeRoleFromListSetting(interaction.guildId, "globalSupportRoleIds", role.id);
      return interaction.reply({
        content: `Team-Rolle entfernt. Aktuell: ${updated.map((id) => `<@&${id}>`).join(", ") || "keine"}`,
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

  async sendTicketPanel(channel, settings = {}) {
    const panelColor = Number(settings.panelColor || 0x1f8b4c);
    const panelTitle = String(settings.panelTitle || "Support Ticket erstellen");
    const panelDescription = String(settings.panelDescription || "Waehle den passenden Ticket-Typ aus. Danach oeffnet sich ein Formular fuer dein Anliegen.");
    const panelFooter = String(settings.panelFooter || "Bitte ein Ticket pro Thema erstellen.");
    const panelStyle = String(settings.panelStyle || "dropdown");

    const embed = new EmbedBuilder()
      .setColor(panelColor)
      .setTitle(panelTitle)
      .setDescription(panelDescription)
      .addFields(
        this.ticketTypes.slice(0, 25).map((type) => ({
          name: `${type.emoji || "🎫"} ${type.label}`,
          value: type.description || "Keine Beschreibung",
          inline: true
        }))
      )
      .setFooter({ text: panelFooter })
      .setTimestamp();

    if (settings.panelImageUrl) {
      try { embed.setImage(settings.panelImageUrl); } catch { /* invalid URL, skip */ }
    }
    if (settings.panelThumbnailUrl) {
      try { embed.setThumbnail(settings.panelThumbnailUrl); } catch { /* invalid URL, skip */ }
    }

    let components = [];

    if (panelStyle === "buttons" && this.ticketTypes.length <= 25) {
      const rows = [];
      for (let i = 0; i < Math.min(this.ticketTypes.length, 25); i++) {
        const rowIndex = Math.floor(i / 5);
        if (!rows[rowIndex]) rows[rowIndex] = new ActionRowBuilder();
        const type = this.ticketTypes[i];
        rows[rowIndex].addComponents(
          new ButtonBuilder()
            .setCustomId(`ticket:type:${type.id}`)
            .setLabel(type.label.slice(0, 80))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(type.emoji || "🎫")
        );
      }
      components = rows;
    } else {
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
      components = [new ActionRowBuilder().addComponents(menu)];
    }

    await channel.send({ embeds: [embed], components });
  }

  buildTicketCreateModal(type) {
    const modal = new ModalBuilder()
      .setCustomId(`ticket:createModal:${type.id}`)
      .setTitle(`Ticket: ${type.label}`);

    const components = [];
    const reasonInput = new TextInputBuilder()
      .setCustomId("reason")
      .setLabel("Beschreibe dein Anliegen")
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(5)
      .setMaxLength(1000)
      .setRequired(true)
      .setPlaceholder("Beschreibe dein Problem so genau wie moeglich...");

    components.push(new ActionRowBuilder().addComponents(reasonInput));

    for (const field of type.formFields || []) {
      const input = new TextInputBuilder()
        .setCustomId(`field:${field.id}`)
        .setLabel(field.label)
        .setStyle(field.style === "short" ? TextInputStyle.Short : TextInputStyle.Paragraph)
        .setRequired(field.required !== false)
        .setMaxLength(field.maxLength || 300);

      if (field.placeholder) input.setPlaceholder(field.placeholder);
      if (field.minLength > 0) input.setMinLength(field.minLength);

      components.push(new ActionRowBuilder().addComponents(input));
    }

    modal.addComponents(...components);
    return modal;
  }

  async loadResponses() {
    if (!await fs.pathExists(RESPONSES_PATH)) return [];
    try {
      const parsed = await fs.readJson(RESPONSES_PATH);
      return Array.isArray(parsed) ? parsed.filter((r) => r && r.id && r.label && r.content) : [];
    } catch {
      return [];
    }
  }

  async handleTagGroup(interaction, sub, settings) {
    const ticket = this.store.getTicket(interaction.guildId, interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: "Dieser Befehl funktioniert nur in einem Ticket-Kanal.", ephemeral: true });
    }
    const ticketType = this.getTypeById(ticket.typeId);
    if (!this.isSupport(interaction.member, settings, ticketType) && !this.isAdmin(interaction.member, settings)) {
      return interaction.reply({ content: "Nur Team/Admin kann Tags setzen.", ephemeral: true });
    }

    const tagName = interaction.options.getString("name", true).trim().slice(0, 30);

    if (sub === "add") {
      const tags = [...new Set([...(ticket.tags || []), tagName])].slice(0, 15);
      await this.updateTicketState(interaction.guildId, interaction.channel, { tags });
      return interaction.reply({ content: `Tag \`${tagName}\` hinzugefuegt.`, ephemeral: true });
    }

    if (sub === "remove") {
      const tags = (ticket.tags || []).filter((t) => t !== tagName);
      await this.updateTicketState(interaction.guildId, interaction.channel, { tags });
      return interaction.reply({ content: `Tag \`${tagName}\` entfernt.`, ephemeral: true });
    }
  }

  async handleBlacklistGroup(interaction, sub, settings) {
    if (!this.isAdmin(interaction.member, settings)) {
      return interaction.reply({ content: "Nur Admins koennen die Blacklist verwalten.", ephemeral: true });
    }

    if (sub === "add") {
      const user = interaction.options.getUser("user", true);
      await this.store.addToBlacklist(interaction.guildId, user.id);
      return interaction.reply({ content: `${user} wurde zur Blacklist hinzugefuegt.`, ephemeral: true });
    }

    if (sub === "remove") {
      const user = interaction.options.getUser("user", true);
      await this.store.removeFromBlacklist(interaction.guildId, user.id);
      return interaction.reply({ content: `${user} wurde von der Blacklist entfernt.`, ephemeral: true });
    }

    if (sub === "list") {
      const blacklist = this.store.getBlacklist(interaction.guildId);
      const content = blacklist.length > 0
        ? blacklist.map((id) => `<@${id}>`).join("\n")
        : "Blacklist ist leer.";
      return interaction.reply({ content: `**Blacklist:**\n${content}`, ephemeral: true });
    }
  }

  async handleReplySelect(interaction) {
    const channelId = interaction.customId.split(":")[2];
    const channel = interaction.guild?.channels.cache.get(channelId);
    const responseId = interaction.values?.[0];

    const responses = await this.loadResponses();
    const response = responses.find((r) => r.id === responseId);

    if (!response) {
      return interaction.reply({ content: "Antwort nicht gefunden.", ephemeral: true });
    }

    if (channel?.isTextBased()) {
      await channel.send(`> ${response.content}\n\n*— ${interaction.user}*`);
    }

    return interaction.reply({ content: "Schnellantwort gesendet.", ephemeral: true });
  }

  async handleTicketCreateSelect(interaction) {
    const typeId = interaction.values[0];
    const type = this.getTypeById(typeId);

    if (!type) {
      return interaction.reply({ content: "Ungueltiger Ticket-Typ.", ephemeral: true });
    }

    return interaction.showModal(this.buildTicketCreateModal(type));
  }

  async handleTicketButtons(interaction) {
    if (interaction.customId.startsWith("ticket:type:")) {
      const typeId = interaction.customId.split(":")[2];
      const type = this.getTypeById(typeId);
      if (!type) return interaction.reply({ content: "Ungueltiger Ticket-Typ.", ephemeral: true });
      return interaction.showModal(this.buildTicketCreateModal(type));
    }

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
      return interaction.reply({ content: "Nur Team/Admin kann diese Aktion ausfuehren.", ephemeral: true });
    }

    if (interaction.customId === "ticket:claim") {
      if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id) {
        return interaction.reply({
          content: `Dieses Ticket ist bereits von <@${ticket.claimedBy}> geclaimt.`,
          ephemeral: true
        });
      }

      await this.updateTicketState(interaction.guildId, interaction.channel, {
        claimedBy: interaction.user.id,
        claimedAt: ticket.claimedAt || Date.now(),
        status: "claimed"
      });
      return interaction.reply({ content: `Ticket wurde von ${interaction.user} geclaimt.` });
    }

    if (interaction.customId === "ticket:unclaim") {
      await this.updateTicketState(interaction.guildId, interaction.channel, {
        claimedBy: null,
        status: "waiting-for-support"
      });
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
    const formResponses = (type.formFields || []).map((field) => ({
      id: field.id,
      label: field.label,
      value: interaction.fields.getTextInputValue(`field:${field.id}`)
    }));

    if (this.store.isBlacklisted(interaction.guildId, interaction.user.id)) {
      return interaction.reply({ content: "Du bist fuer das Ticket-System gesperrt.", ephemeral: true });
    }

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
      reason: safeContent(reason),
      priority: type.defaultPriority || "normal",
      formResponses,
      lastActivityAt: Date.now(),
      inactivityRemindedAt: null
    });

    const finalName = this.buildTicketChannelName(settings, ticket.ticketId, interaction.user.username);
    if (channel.name !== finalName) {
      await channel.setName(finalName).catch(() => null);
    }

    const actions = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ticket:close").setLabel("Close").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("ticket:claim").setLabel("Claim").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("ticket:unclaim").setLabel("Unclaim").setStyle(ButtonStyle.Secondary)
    );

    const controlMessage = await channel.send({
      content: [
        [...new Set(type.pingRoleIds || [])].map((roleId) => `<@&${roleId}>`).join(" "),
        `<@${interaction.user.id}>`
      ]
        .filter(Boolean)
        .join(" "),
      embeds: [this.buildTicketEmbed(ticket, type)],
      components: [actions]
    });

    await this.updateTicketState(interaction.guildId, channel, {
      controlMessageId: controlMessage.id
    });

    if (type.openingMessage) {
      await channel.send(type.openingMessage).catch(() => null);
    }

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

    // Thread-based mode
    if (settings.useThreads && settings.threadChannelId) {
      const parentChannel = guild.channels.cache.get(settings.threadChannelId);
      if (parentChannel && parentChannel.isTextBased() && !parentChannel.isThread?.()) {
        const thread = await parentChannel.threads.create({
          name: `ticket-${ticketType.id}-${sanitizeChannelName(member.user.username)}`.slice(0, 95),
          type: ChannelType.PrivateThread,
          invitable: false
        });
        await thread.members.add(member.id).catch(() => null);

        // Add server team role to thread
        if (settings.serverTeamRoleId) {
          try {
            const teamRole = guild.roles.cache.get(settings.serverTeamRoleId);
            if (teamRole) {
              const teamMembers = guild.members.cache.filter(m => m.roles.cache.has(settings.serverTeamRoleId));
              for (const teamMember of teamMembers.values()) {
                await thread.members.add(teamMember.id).catch(() => null);
              }
            }
          } catch (err) {
            logger.error("Error adding team to thread:", err);
          }
        }

        return thread;
      }
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
      ...(ticketType.supportRoleIds || []),
      ...(ticketType.pingRoleIds || [])
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
      closeReason: safeContent(reason),
      closedAt: Date.now()
    });

    const closingTicket = this.store.getTicket(guildId, channel.id);
    await this.syncTicketMessage(channel, closingTicket);

    const transcript = await this.createTranscript(channel, closingTicket, settings.maxMessagesInTranscript || 500);
    const transcriptFileName = `transcript-ticket-${ticket.ticketId}.html`;
    const transcriptBuffer = Buffer.from(transcript, "utf8");
    const attachmentForLog = new AttachmentBuilder(transcriptBuffer, { name: transcriptFileName });
    const attachmentForTranscript = new AttachmentBuilder(transcriptBuffer, { name: transcriptFileName });

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

    const isThread = typeof channel.isThread === "function" ? channel.isThread() : false;
    const delay = Math.max(0, Number(settings.closeDeleteDelaySeconds || 0));
    const closeMsg = isThread
      ? `Thread wird in ${delay} Sekunden archiviert.`
      : `Ticket wird in ${delay} Sekunden geschlossen. Grund: ${safeContent(reason) || "Kein Grund"}`;

    await channel.send(closeMsg);

    setTimeout(async () => {
      if (isThread) {
        await channel.setArchived(true).catch((error) => {
          logger.warn("Thread konnte nicht archiviert werden", { error: error.message });
        });
      } else {
        await channel.delete("Ticket geschlossen").catch((error) => {
          logger.warn("Ticket-Channel konnte nicht geloescht werden", { error: error.message });
        });
      }
    }, delay * 1000);
  }

  async createTranscript(channel, ticket, maxMessages) {
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

    const ticketType = this.getTypeById(ticket.typeId);

    return buildHtmlTranscript({
      ticket,
      ticketType,
      guildName: channel.guild.name,
      channelName: channel.name,
      messages
    });
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
