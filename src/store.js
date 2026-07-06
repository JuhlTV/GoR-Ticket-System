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
        closedTickets: {},
        userTickets: {},
        counters: {
          opened: 0,
          closed: 0,
          lastTicketNumber: 0
        }
      };
    }

    if (!this.state.guilds[guildId].closedTickets) {
      this.state.guilds[guildId].closedTickets = {};
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

  getClosedTicket(guildId, ticketId) {
    const guild = this.ensureGuild(guildId);
    return guild.closedTickets[String(ticketId)] || null;
  }

  isBlacklisted(guildId, userId) {
    const guild = this.ensureGuild(guildId);
    return (guild.settingsOverrides.blacklist || []).includes(userId);
  }

  async addToBlacklist(guildId, userId) {
    const guild = this.ensureGuild(guildId);
    if (!Array.isArray(guild.settingsOverrides.blacklist)) {
      guild.settingsOverrides.blacklist = [];
    }
    if (!guild.settingsOverrides.blacklist.includes(userId)) {
      guild.settingsOverrides.blacklist.push(userId);
      await this.save();
    }
    return guild.settingsOverrides.blacklist;
  }

  async removeFromBlacklist(guildId, userId) {
    const guild = this.ensureGuild(guildId);
    const current = guild.settingsOverrides.blacklist || [];
    guild.settingsOverrides.blacklist = current.filter((id) => id !== userId);
    await this.save();
    return guild.settingsOverrides.blacklist;
  }

  getBlacklist(guildId) {
    const guild = this.ensureGuild(guildId);
    return guild.settingsOverrides.blacklist || [];
  }

  getSupporterStats(guildId) {
    const guild = this.ensureGuild(guildId);
    const closed = Object.values(guild.closedTickets);
    const stats = {};

    for (const ticket of closed) {
      if (!ticket.claimedBy) continue;
      if (!stats[ticket.claimedBy]) {
        stats[ticket.claimedBy] = { userId: ticket.claimedBy, closed: 0, totalResponseTime: 0, responseCount: 0 };
      }
      stats[ticket.claimedBy].closed++;
      if (ticket.firstSupportResponseAt && ticket.createdAt) {
        const responseTime = ticket.firstSupportResponseAt - ticket.createdAt;
        if (responseTime > 0) {
          stats[ticket.claimedBy].totalResponseTime += responseTime;
          stats[ticket.claimedBy].responseCount++;
        }
      }
    }

    return Object.values(stats)
      .map((s) => ({
        userId: s.userId,
        closed: s.closed,
        avgResponseTimeMs: s.responseCount > 0 ? Math.round(s.totalResponseTime / s.responseCount) : null
      }))
      .sort((a, b) => b.closed - a.closed);
  }

  listClosedTickets(guildId, options = {}) {
    const guild = this.ensureGuild(guildId);
    let tickets = Object.values(guild.closedTickets);

    if (options.creatorId) {
      tickets = tickets.filter((ticket) => ticket.creatorId === options.creatorId);
    }

    if (options.typeId) {
      tickets = tickets.filter((ticket) => ticket.typeId === options.typeId);
    }

    tickets.sort((left, right) => Number(right.closedAt || 0) - Number(left.closedAt || 0));

    const limit = Math.max(1, Number(options.limit || tickets.length || 10));
    return tickets.slice(0, limit);
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
      if (ticket && ticket.status !== "closed" && ticket.typeId === typeId) {
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
      statusUpdatedAt: Date.now(),
      claimedBy: null,
      claimedAt: null,
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

    const closedTicket = {
      ...ticket,
      status: "closed",
      closedAt: ticket.closedAt || Date.now(),
      updatedAt: Date.now()
    };

    guild.closedTickets[String(closedTicket.ticketId)] = closedTicket;

    if (guild.userTickets[ticket.creatorId]) {
      guild.userTickets[ticket.creatorId] = guild.userTickets[ticket.creatorId].filter((id) => id !== channelId);
      if (guild.userTickets[ticket.creatorId].length === 0) {
        delete guild.userTickets[ticket.creatorId];
      }
    }

    delete guild.tickets[channelId];
    await this.save();
    return closedTicket;
  }

  async reopenTicket(guildId, ticketId, patch) {
    const guild = this.ensureGuild(guildId);
    const closedTicket = guild.closedTickets[String(ticketId)];
    if (!closedTicket) return null;

    const reopenedTicket = {
      ...closedTicket,
      ...patch,
      status: "open",
      statusUpdatedAt: Date.now(),
      reopenedAt: Date.now(),
      reopenedFromClosedAt: closedTicket.closedAt || null,
      closeReason: null,
      closedAt: null,
      updatedAt: Date.now()
    };

    guild.tickets[reopenedTicket.channelId] = reopenedTicket;

    if (!guild.userTickets[reopenedTicket.creatorId]) {
      guild.userTickets[reopenedTicket.creatorId] = [];
    }

    if (!guild.userTickets[reopenedTicket.creatorId].includes(reopenedTicket.channelId)) {
      guild.userTickets[reopenedTicket.creatorId].push(reopenedTicket.channelId);
    }

    delete guild.closedTickets[String(ticketId)];
    await this.save();
    return reopenedTicket;
  }

  getStats(guildId) {
    const guild = this.ensureGuild(guildId);
    const openTickets = Object.values(guild.tickets);
    const byStatus = {
      open: 0,
      claimed: 0,
      "waiting-for-user": 0,
      "waiting-for-support": 0,
      closing: 0,
      closed: Object.keys(guild.closedTickets).length
    };

    for (const ticket of openTickets) {
      if (Object.prototype.hasOwnProperty.call(byStatus, ticket.status)) {
        byStatus[ticket.status] += 1;
      }
    }

    return {
      opened: guild.counters.opened,
      closed: guild.counters.closed,
      openNow: openTickets.length,
      claimedNow: openTickets.filter((ticket) => ticket.claimedBy).length,
      lastTicketNumber: guild.counters.lastTicketNumber,
      byStatus
    };
  }
}

module.exports = {
  JsonStore
};
