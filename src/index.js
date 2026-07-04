require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const logger = require("./logger");
const { registerCommands } = require("./registerCommands");
const { createTicketRuntime } = require("./ticketRuntime");

async function bootstrap() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error("DISCORD_TOKEN fehlt in .env");
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
  });

  const runtime = await createTicketRuntime(client);

  client.once("ready", async () => {
    logger.info(`Bot online als ${client.user.tag}`);

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

  await client.login(token);
}

bootstrap().catch((error) => {
  logger.error("Startup fehlgeschlagen", { error: error.message });
  process.exit(1);
});
