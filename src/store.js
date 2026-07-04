const path = require("path");
const fs = require("fs-extra");

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = { guilds: {} };
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.ensureDir(path.dirname(this.filePath));

    if (await fs.pathExists(this.filePath)) {
      try {
        this.state = await fs.readJson(this.filePath);
      } catch {
        this.state = { guilds: {} };
        await this.save();
      }
    } else {
      await this.save();
    }
  }

  async save() {
    this.writeQueue = this.writeQueue.then(() =>
      fs.writeJson(this.filePath, this.state, { spaces: 2 })
    );
    return this.writeQueue;
  }

  ensureGuild(guildId) {
    if (!this.state.guilds[guildId]) {
      this.state.guilds[guildId] = {
        settingsOverrides: {},
        tickets: {},
        userTickets: {},
        counters: {
          opened: 0,
          closed: 0,
          lastTicketNumber: 0
        }
      };
    }

    return this.state.guilds[guildId];
  }

  getSettings(guildId, baseSettings) {
    const guild = this.ensureGuild(guildId);
    return {
      ...baseSettings,
      ...guild.settingsOverrides
    };
  }

  async setSetting(guildId, key, value) {
    const guild = this.ensureGuild(guildId);
    guild.settingsOverrides[key] = value;
    await this.save();
  }

  async addRoleToListSetting(guildId, key, roleId) {
    const guild = this.ensureGuild(guildId);
    if (!Array.isArray(guild.settingsOverrides[key])) {
      guild.settingsOverrides[key] = [];
    }

    if (!guild.settingsOverrides[key].includes(roleId)) {
      guild.settingsOverrides[key].push(roleId);
      await this.save();
    }

    return guild.settingsOverrides[key];
  }

  async removeRoleFromListSetting(guildId, key, roleId) {
    const guild = this.ensureGuild(guildId);
    const current = Array.isArray(guild.settingsOverrides[key]) ? guild.settingsOverrides[key] : [];
    guild.settingsOverrides[key] = current.filter((id) => id !== roleId);
    await this.save();
    return guild.settingsOverrides[key];
  }

  getTicket(guildId, channelId) {
    const guild = this.ensureGuild(guildId);
    return guild.tickets[channelId] || null;
  }

  getAllOpenTickets(guildId) {
    const guild = this.ensureGuild(guildId);
    return Object.values(guild.tickets);
  }

  findOpenTicketByUserAndType(guildId, userId, typeId) {
    const guild = this.ensureGuild(guildId);
    const channels = guild.userTickets[userId] || [];

    for (const channelId of channels) {
      const ticket = guild.tickets[channelId];
      if (ticket && ticket.status === "open" && ticket.typeId === typeId) {
        return ticket;
      }
    }

    return null;
  }

  async createTicket(guildId, ticketData) {
    const guild = this.ensureGuild(guildId);

    guild.counters.lastTicketNumber += 1;
    guild.counters.opened += 1;

    const ticketId = guild.counters.lastTicketNumber;
    const ticket = {
      ticketId,
      status: "open",
      claimedBy: null,
      participants: [],
      priority: "normal",
      createdAt: Date.now(),
      ...ticketData
    };

    guild.tickets[ticket.channelId] = ticket;

    if (!guild.userTickets[ticket.creatorId]) {
      guild.userTickets[ticket.creatorId] = [];
    }

    if (!guild.userTickets[ticket.creatorId].includes(ticket.channelId)) {
      guild.userTickets[ticket.creatorId].push(ticket.channelId);
    }

    await this.save();
    return ticket;
  }

  async updateTicket(guildId, channelId, patch) {
    const guild = this.ensureGuild(guildId);
    const ticket = guild.tickets[channelId];
    if (!ticket) return null;

    guild.tickets[channelId] = {
      ...ticket,
      ...patch,
      updatedAt: Date.now()
    };

    await this.save();
    return guild.tickets[channelId];
  }

  async closeTicket(guildId, channelId) {
    const guild = this.ensureGuild(guildId);
    const ticket = guild.tickets[channelId];
    if (!ticket) return null;

    guild.counters.closed += 1;

    if (guild.userTickets[ticket.creatorId]) {
      guild.userTickets[ticket.creatorId] = guild.userTickets[ticket.creatorId].filter((id) => id !== channelId);
      if (guild.userTickets[ticket.creatorId].length === 0) {
        delete guild.userTickets[ticket.creatorId];
      }
    }

    delete guild.tickets[channelId];
    await this.save();
    return ticket;
  }

  getStats(guildId) {
    const guild = this.ensureGuild(guildId);
    return {
      opened: guild.counters.opened,
      closed: guild.counters.closed,
      openNow: Object.keys(guild.tickets).length,
      lastTicketNumber: guild.counters.lastTicketNumber
    };
  }
}

module.exports = {
  JsonStore
};
