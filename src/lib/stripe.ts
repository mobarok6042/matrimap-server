import Stripe from "stripe";
import { env } from "../config/env.js";

/**
 * A placeholder key keeps local bootstrapping possible. Any real Stripe call
 * will fail with a clear error until STRIPE_SECRET_KEY is configured.
 */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY || "sk_test_placeholder");

export const isStripeConfigured = env.STRIPE_SECRET_KEY.length > 0;
