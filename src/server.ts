import { createApp } from "./app.js";
import { connectDatabases, disconnectDatabases } from "./config/database.js";
import { env } from "./config/env.js";

async function main(): Promise<void> {
  await connectDatabases();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`✓ MatriMap API listening on ${env.BETTER_AUTH_URL} (port ${env.PORT})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down`);
    server.close(async () => {
      await disconnectDatabases();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
