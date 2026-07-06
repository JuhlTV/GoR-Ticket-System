require("dotenv").config();

const requiredPermissions = [
  1024,
  2048,
  32768,
  65536,
  16,
  268435456
].reduce((total, permission) => total + permission, 0);

function main() {
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!clientId) {
    throw new Error("DISCORD_CLIENT_ID fehlt in .env");
  }

  const inviteUrl = new URL("https://discord.com/oauth2/authorize");
  inviteUrl.searchParams.set("client_id", clientId);
  inviteUrl.searchParams.set("scope", "bot applications.commands");
  inviteUrl.searchParams.set("permissions", String(requiredPermissions));

  console.log(inviteUrl.toString());
}

main();