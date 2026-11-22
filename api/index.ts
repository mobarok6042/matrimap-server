import { createApp } from "../src/app.js";
import { connectDatabases } from "../src/config/database.js";

const app = createApp();
let databaseConnection: Promise<void> | undefined;

function ensureDatabaseConnection(): Promise<void> {
  databaseConnection ??= connectDatabases().catch((error) => {
    databaseConnection = undefined;
    throw error;
  });
  return databaseConnection;
}

/** Vercel serverless entrypoint for the Express application. */
export default async function handler(req: any, res: any): Promise<void> {
  try {
    await ensureDatabaseConnection();
    app(req, res);
  } catch (error) {
    console.error("[matrimap:vercel] Database connection failed", error);
    res.status(503).json({ error: "The API database is temporarily unavailable." });
  }
}
