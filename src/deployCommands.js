require("dotenv").config();

const { registerCommands } = require("./registerCommands");

async function main() {
  const result = await registerCommands({
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID
  });

  if (result.scope === "guild") {
    console.log(`Guild-Commands deployed (${result.count}) in Guild ${result.guildId}`);
  } else {
    console.log(`Global-Commands deployed (${result.count})`);
  }
}

main().catch((err) => {
  console.error("Command-Deployment fehlgeschlagen:", err);
  process.exit(1);
});
