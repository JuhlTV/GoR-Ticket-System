require("dotenv").config();
const path = require("path");
const fs = require("fs-extra");
const express = require("express");

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT || 3000);
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || null;

const app = express();

function auth(req, res, next) {
  if (!DASHBOARD_TOKEN) return next();
  const token = req.headers["x-token"] || req.query.token;
  if (token !== DASHBOARD_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

async function getStore() {
  if (!await fs.pathExists(STORE_PATH)) return { guilds: {} };
  try {
    return await fs.readJson(STORE_PATH);
  } catch {
    return { guilds: {} };
  }
}

app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.get("/stats", auth, async (_req, res) => {
  const store = await getStore();
  const result = {};
  for (const [guildId, guild] of Object.entries(store.guilds || {})) {
    const open = Object.values(guild.tickets || {});
    result[guildId] = {
      openTickets: open.length,
      closedTickets: Object.keys(guild.closedTickets || {}).length,
      totalOpened: guild.counters?.opened || 0,
      totalClosed: guild.counters?.closed || 0,
      lastTicketNumber: guild.counters?.lastTicketNumber || 0
    };
  }
  res.json(result);
});

app.get("/tickets", auth, async (req, res) => {
  const store = await getStore();
  const guildId = req.query.guild;
  if (!guildId) return res.status(400).json({ error: "guild query param required" });
  const guild = store.guilds?.[guildId];
  if (!guild) return res.status(404).json({ error: "Guild not found" });
  res.json({
    open: Object.values(guild.tickets || {}),
    closed: Object.values(guild.closedTickets || {}).slice(0, 100)
  });
});

app.get("/", auth, async (_req, res) => {
  const store = await getStore();
  const guilds = Object.entries(store.guilds || {});

  const rows = guilds.map(([id, guild]) => {
    const open = Object.keys(guild.tickets || {}).length;
    const closed = Object.keys(guild.closedTickets || {}).length;
    return `<tr>
      <td>${id}</td>
      <td>${guild.counters?.opened || 0}</td>
      <td>${open}</td>
      <td>${closed}</td>
    </tr>`;
  }).join("");

  res.send(`<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Ticket Dashboard</title>
<style>
body{font-family:sans-serif;background:#313338;color:#dcddde;padding:24px}
h1{color:#f2f3f5;margin-bottom:16px;font-size:22px}
p{color:#b5bac1;font-size:13px;margin-bottom:20px}
table{border-collapse:collapse;width:100%;background:#1e1f22;border-radius:8px;overflow:hidden}
th,td{padding:12px 16px;text-align:left;border-bottom:1px solid #3f4147}
th{background:#2b2d31;color:#b5bac1;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
tr:last-child td{border-bottom:none}
tr:hover td{background:#2e3035}
</style>
</head>
<body>
<h1>Ticket System Dashboard</h1>
<p>API: <a style="color:#00aff4" href="/stats">/stats</a> &nbsp; <a style="color:#00aff4" href="/tickets?guild=GUILD_ID">/tickets?guild=ID</a></p>
<table>
<thead><tr><th>Guild ID</th><th>Gesamt erstellt</th><th>Offen</th><th>Archiviert</th></tr></thead>
<tbody>${rows || "<tr><td colspan='4' style='color:#87898c'>Keine Daten</td></tr>"}</tbody>
</table>
</body>
</html>`);
});

function startDashboard() {
  app.listen(DASHBOARD_PORT, () => {
    console.log(`[Dashboard] Laeuft auf http://localhost:${DASHBOARD_PORT}`);
  });
}

module.exports = { startDashboard };
