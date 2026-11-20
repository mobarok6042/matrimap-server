import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { APIError, betterAuth } from "better-auth";
import { z } from "zod";
import { env } from "../config/env.js";
import { mongoClient, mongoDb } from "../config/database.js";

/** Roles a user may choose during sign-up. `pending` is only for OAuth users. */
export const USER_ROLES = ["customer", "vendor"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** At least 6 characters, with at least one lowercase and one uppercase letter. */
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z]).{6,}$/;

export const PASSWORD_RULE_MESSAGE =
  "Password must be at least 6 characters and contain one uppercase and one lowercase letter.";

const googleProvider =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
      }
    : undefined;

export const auth = betterAuth({
  appName: "MatriMap",
  secret: env.BETTER_AUTH_SECRET,
  // The browser talks to the Next.js origin; Next.js proxies /api/auth/* here.
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: env.CLIENT_URL.split(",").map((origin) => origin.trim()),

  database: mongodbAdapter(
    mongoDb,
    env.MONGODB_ENABLE_TRANSACTIONS === "true" ? { client: mongoClient } : undefined,
  ),

  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        defaultValue: "pending",
        input: true,
        validator: {
          input: z.enum(["customer", "vendor", "pending"]),
          output: z.enum(["customer", "vendor", "pending", "admin"]),
        },
      },
      isBlocked: {
        type: "boolean",
        required: true,
        defaultValue: false,
        input: false,
      },
    },
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
    maxPasswordLength: 128,
    autoSignIn: true,
  },

  ...(googleProvider ? { socialProviders: googleProvider } : {}),

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh once per day
  },

  hooks: {
    before: async (ctx) => {
      // The generic middleware type does not expose `path`/`body`; both are
      // present at runtime and are the documented way to inspect the request.
      const request = ctx as unknown as {
        path?: string;
        body?: Record<string, unknown>;
      };

      if (request.path === "/sign-up/email") {
        const password = request.body?.password;
        if (typeof password !== "string" || !PASSWORD_PATTERN.test(password)) {
          throw new APIError("BAD_REQUEST", { message: PASSWORD_RULE_MESSAGE });
        }

        const role = request.body?.role;
        if (role !== "customer" && role !== "vendor") {
          throw new APIError("BAD_REQUEST", {
            message: "Choose a valid account role: Vendor or Customer.",
          });
        }
      }
    },
  },
});

export type AuthContext = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
