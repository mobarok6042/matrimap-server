import { MongoClient } from "mongodb";
import mongoose from "mongoose";
import { env } from "./env.js";

/**
 * Better Auth uses the native MongoDB driver, while application data uses
 * Mongoose. Both point at the same database.
 */
export const mongoClient = new MongoClient(env.MONGODB_URI, {
  serverSelectionTimeoutMS: 10_000,
});
export const mongoDb = mongoClient.db(env.DB_NAME);

export async function connectDatabases(): Promise<void> {
  await mongoClient.connect();
  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.DB_NAME,
    serverSelectionTimeoutMS: 10_000,
  });
  console.log(`✓ MongoDB connected (${env.DB_NAME})`);
}

export async function disconnectDatabases(): Promise<void> {
  await Promise.all([mongoClient.close(), mongoose.disconnect()]);
}
