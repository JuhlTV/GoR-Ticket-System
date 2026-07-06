require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const logger = require("./logger");
const { registerCommands } = require("./registerCommands");
const { createTicketRuntime } = require("./ticketRuntime");
const { startDashboard } = require("./dashboard");

function validateEnvironment() {
  if (!process.env.DISCORD_TOKEN) {
    throw new Error("DISCORD_TOKEN fehlt in .env");
  }

  if (String(process.env.AUTO_DEPLOY_COMMANDS).toLowerCase() === "true") {
    if (!process.env.DISCORD_CLIENT_ID) {
      throw new Error("DISCORD_CLIENT_ID fehlt, wird aber fuer AUTO_DEPLOY_COMMANDS benoetigt.");
    }
  }
}

function bindProcessHandlers(client) {
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled Promise Rejection", {
      error: reason instanceof Error ? reason.message : String(reason)
    });
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught Exception", { error: error.message });
  });

  const shutdown = async (signal) => {
    logger.info(`Signal erhalten: ${signal}. Bot wird sauber beendet.`);
    try {
      await client.destroy();
    } catch (error) {
      logger.warn("Fehler beim Shutdown", { error: error.message });
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

async function bootstrap() {
  validateEnvironment();
  const token = process.env.DISCORD_TOKEN;

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
  });
  bindProcessHandlers(client);

  const runtime = await createTicketRuntime(client);

  client.once("clientReady", async () => {
    logger.info(`Bot online als ${client.user.tag}`);

    runtime.startInactivityMonitor();

    if (String(process.env.DASHBOARD_ENABLED).toLowerCase() === "true") {
      startDashboard();
    }

    if (String(process.env.AUTO_DEPLOY_COMMANDS).toLowerCase() === "true") {
      try {
        const deployResult = await registerCommands({
          token: process.env.DISCORD_TOKEN,
          clientId: process.env.DISCORD_CLIENT_ID,
          guildId: process.env.DISCORD_GUILD_ID
        });
        logger.info("Slash-Commands automatisch aktualisiert", deployResult);
      } catch (error) {
        logger.error("Auto-Deployment fehlgeschlagen", { error: error.message });
      }
    }
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      await runtime.handleInteraction(interaction);
    } catch (error) {
      logger.error("Fehler in interactionCreate", { error: error.message });

      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Es ist ein Fehler aufgetreten. Bitte versuche es erneut.",
          ephemeral: true
        });
      }
    }
  });

  client.on("messageCreate", async (message) => {
    try {
      await runtime.handleMessage(message);
    } catch (error) {
      logger.error("Fehler in messageCreate", { error: error.message });
    }
  });

  await client.login(token);
}

bootstrap().catch((error) => {
  logger.error("Startup fehlgeschlagen", { error: error.message });
  process.exit(1);
});
