import { createApp } from "./app.js";
import { connectDatabases, disconnectDatabases } from "./config/database.js";
import { env } from "./config/env.js";

async function main(): Promise<void> {
  // Keep the API up even if Atlas is temporarily unreachable so health/auth
  // diagnostics still respond. Database-backed routes will report the error.
  try {
    await connectDatabases();
  } catch (error) {
    console.warn("! MongoDB connection failed at startup:", (error as Error).message);
    console.warn("  Database-backed routes will fail until the connection is restored.");
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`✓ MatriMap API listening on port ${env.PORT} (auth base URL: ${env.BETTER_AUTH_URL})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down`);
    server.close(async () => {
      await disconnectDatabases().catch(() => undefined);
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
