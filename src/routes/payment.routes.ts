import { Router, type NextFunction, type Request, type Response } from "express";
import type Stripe from "stripe";
import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";
import { isStripeConfigured, stripe } from "../lib/stripe.js";
import { requireAuth } from "../middleware/require-auth.js";

export const paymentRouter = Router();

/** POST /api/payments/checkout — creates a hosted Stripe Checkout session. */
paymentRouter.post("/checkout", requireAuth, async (req, res, next) => {
  try {
    if (!isStripeConfigured) {
      throw new HttpError(503, "Stripe is not configured. Add STRIPE_SECRET_KEY to .env");
    }

    const user = req.auth!.user;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      client_reference_id: user.id,
      metadata: { userId: user.id },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: env.STRIPE_SUCCESS_AMOUNT,
            product_data: {
              name: "MatriMap Premium",
              description: "Unlock premium profile features",
            },
          },
        },
      ],
      success_url: `${env.CLIENT_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.CLIENT_URL}/checkout/cancel`,
    });

    res.json({ id: session.id, url: session.url });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/payments/webhook — mounted with express.raw() in app.ts so the
 * signature can be verified against the exact bytes Stripe signed.
 */
export async function stripeWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const signature = req.headers["stripe-signature"];
    if (!signature) throw new HttpError(400, "Missing stripe-signature header.");
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new HttpError(503, "Stripe webhook secret is not configured.");
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        signature,
        env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (error) {
      throw new HttpError(400, `Webhook signature verification failed: ${(error as Error).message}`);
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log(`✓ Checkout completed: ${session.id} for user ${session.client_reference_id}`);
        // TODO: mark the user's profile as premium in MongoDB.
        break;
      }
      case "payment_intent.payment_failed": {
        const intent = event.data.object as Stripe.PaymentIntent;
        console.warn(`✗ Payment failed: ${intent.id}`);
        break;
      }
      default:
        break;
    }

    res.json({ received: true });
  } catch (error) {
    next(error);
  }
}
