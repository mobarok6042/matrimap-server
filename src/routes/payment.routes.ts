import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type Stripe from "stripe";
import { env } from "../config/env.js";
import { VENDOR_PLANS, getOrCreateVendorPlan, type PaidVendorPlan } from "../lib/vendor-plan.js";
import { HttpError } from "../lib/http-error.js";
import { isStripeConfigured, stripe } from "../lib/stripe.js";
import { requireAuth, requireRole } from "../middleware/require-auth.js";
import { PaymentTransactionModel } from "../models/payment-transaction.model.js";
import { ServiceModel } from "../models/service.model.js";
import { VendorPlanModel } from "../models/vendor-plan.model.js";

export const paymentRouter = Router();

const checkoutSchema = z.object({ plan: z.enum(["basic", "max"]).optional() });

paymentRouter.get("/me", requireAuth, requireRole("vendor"), async (req, res, next) => {
  try {
    const vendorId = req.auth!.user.id;
    const plan = await getOrCreateVendorPlan(vendorId);
    if (!plan) throw new HttpError(500, "Could not load the vendor's service plan.");

    const serviceCount = await ServiceModel.countDocuments({ vendorId });
    const currentPlan = VENDOR_PLANS[plan.plan as keyof typeof VENDOR_PLANS];
    res.json({
      plan: plan.plan,
      serviceCount,
      serviceLimit: currentPlan.serviceLimit,
      plans: VENDOR_PLANS,
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/payments/checkout — creates a hosted Stripe Checkout session. */
paymentRouter.post(
  "/checkout",
  requireAuth,
  requireRole("customer", "vendor"),
  async (req, res, next) => {
  try {
    if (!isStripeConfigured) {
      throw new HttpError(503, "Stripe is not configured. Add STRIPE_SECRET_KEY to .env");
    }

    const user = req.auth!.user;
    let plan: PaidVendorPlan | undefined;
    try {
      plan = checkoutSchema.parse(req.body ?? {}).plan;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new HttpError(400, "Choose either the Basic or Max vendor plan.");
      }
      throw error;
    }

    const role = (user as { role?: string }).role;
    if (role === "vendor" && !plan) {
      throw new HttpError(400, "Choose a vendor plan before checkout.");
    }
    if (role === "customer" && plan) {
      throw new HttpError(400, "Vendor plans are only available to vendor accounts.");
    }

    const vendorPlan = plan as PaidVendorPlan | undefined;
    const selectedPlan = vendorPlan ? VENDOR_PLANS[vendorPlan] : null;
    if (vendorPlan) await getOrCreateVendorPlan(user.id);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
        ...(vendorPlan
          ? {
              plan: vendorPlan,
              vendorName: user.name || "Vendor",
              vendorEmail: user.email,
            }
          : {}),
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: selectedPlan?.currency ?? "usd",
            unit_amount: selectedPlan?.amount ?? env.STRIPE_SUCCESS_AMOUNT,
            product_data: {
              name: selectedPlan ? `MatriMap ${selectedPlan.name} vendor plan` : "MatriMap Premium",
              description: selectedPlan
                ? `One-time purchase for up to ${selectedPlan.serviceLimit} vendor services`
                : "Unlock premium profile features",
            },
          },
        },
      ],
      success_url: `${env.CLIENT_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.CLIENT_URL}/checkout/cancel`,
      },
    );

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
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        const vendorId = session.metadata?.userId;
        const plan = session.metadata?.plan;
        if (
          session.mode !== "payment" ||
          session.payment_status !== "paid" ||
          !vendorId ||
          session.client_reference_id !== vendorId ||
          (plan !== "basic" && plan !== "max")
        ) {
          break;
        }

        if (session.amount_total === null || !session.currency) {
          throw new HttpError(400, "Stripe's completed session is missing its amount or currency.");
        }
        const selectedPlan = VENDOR_PLANS[plan];
        if (
          session.amount_total !== selectedPlan.amount ||
          session.currency !== selectedPlan.currency
        ) {
          throw new HttpError(400, "Stripe's completed session does not match the selected vendor plan.");
        }

        const eventTime = new Date(event.created * 1000);
        const planUpdate = await VendorPlanModel.updateOne(
          {
            vendorId,
            $or: [
              { lastCancelledAt: null },
              { lastCancelledAt: { $lt: eventTime } },
            ],
          },
          { $set: { plan } },
        );
        if (!planUpdate.matchedCount) {
          break;
        }

        const transaction = await PaymentTransactionModel.findOneAndUpdate(
          { checkoutSessionId: session.id },
          {
            $setOnInsert: {
              vendorId,
              vendorName: session.metadata?.vendorName || session.customer_details?.name || "Vendor",
              vendorEmail:
                session.metadata?.vendorEmail ||
                session.customer_details?.email ||
                session.customer_email ||
                "",
              plan,
              amount: session.amount_total,
              currency: session.currency,
              checkoutSessionId: session.id,
              paymentIntentId:
                typeof session.payment_intent === "string" ? session.payment_intent : null,
              paidAt: eventTime,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        ).lean();
        if (!transaction) throw new HttpError(500, "Could not save the Stripe transaction.");

        const currentPlan = await VendorPlanModel.findOne({ vendorId }).lean();
        if (currentPlan?.lastCancelledAt && eventTime <= currentPlan.lastCancelledAt) {
          await PaymentTransactionModel.deleteOne({ checkoutSessionId: session.id });
        }
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

paymentRouter.post(
  "/cancel",
  requireAuth,
  requireRole("vendor"),
  async (req, res, next) => {
    try {
      const vendorId = req.auth!.user.id;
      const plan = await getOrCreateVendorPlan(vendorId);
      if (!plan) throw new HttpError(500, "Could not load the vendor's service plan.");
      if (plan.plan === "free") throw new HttpError(400, "You are already on the Free plan.");

      await VendorPlanModel.updateOne(
        { vendorId },
        { $set: { plan: "free", lastCancelledAt: new Date() } },
      );
      await PaymentTransactionModel.deleteMany({ vendorId });

      res.json({
        plan: "free",
        message: "Your plan is now Free. The one-time Stripe payment was not refunded.",
      });
    } catch (error) {
      next(error);
    }
  },
);
