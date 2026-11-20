import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { env } from "../config/env.js";
import { mongoClient, mongoDb } from "../config/database.js";

export const auth = betterAuth({
  appName: "MatriMap",
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  // Origins allowed to call the auth API from a browser.
  trustedOrigins: [env.CLIENT_URL],

  database: mongodbAdapter(
    mongoDb,
    env.MONGODB_ENABLE_TRANSACTIONS === "true" ? { client: mongoClient } : undefined,
  ),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh once per day
  },
});

export type AuthContext = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
