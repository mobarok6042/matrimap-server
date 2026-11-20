import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017"),
  DB_NAME: z.string().min(1).default("matrimap"),
  MONGODB_ENABLE_TRANSACTIONS: z.enum(["true", "false"]).default("false"),

  // Safe fallback for local development only. Always set this in production.
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .default("matrimap-local-development-secret-replace-me-123456"),
  BETTER_AUTH_URL: z.url().default("http://localhost:4000"),
  CLIENT_URL: z
    .string()
    .min(1)
    .refine(
      (value) =>
        value.split(",").every((origin) => {
          try {
            new URL(origin.trim());
            return true;
          } catch {
            return false;
          }
        }),
      "CLIENT_URL must be a comma-separated list of valid URLs",
    )
    .default("http://localhost:3000"),

  // Google OAuth. Optional at the type level so builds work without secrets,
  // but the provider is only registered when both values are present.
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),

  IMGBB_API_KEY: z.string().default(""),

  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_PUBLISHABLE_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_SUCCESS_AMOUNT: z.coerce.number().int().positive().default(999),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.issues);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
