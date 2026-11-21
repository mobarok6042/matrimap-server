import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type Stripe from "stripe";
import { env } from "../config/env.js";
import {
  VENDOR_PLANS,
  getOrCreateVendorPlan,
  type PaidVendorPlan,
} from "../lib/vendor-plan.js";
import { HttpError } from "../lib/http-error.js";
import { isStripeConfigured, isStripeTestMode, stripe } from "../lib/stripe.js";
import { requireAuth, requireRole } from "../middleware/require-auth.js";
import { PaymentTransactionModel } from "../models/payment-transaction.model.js";
import { ServiceModel } from "../models/service.model.js";
import { VendorPlanModel } from "../models/vendor-plan.model.js";

export const paymentRouter = Router();

const checkoutSchema = z.object({ plan: z.enum(["basic", "max"]).optional() });
type TransactionStatus = "pending" | "paid" | "failed" | "expired";

function getParamId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] ?? "" : id;
}

function getVendorPlanFromSession(
  session: Stripe.Checkout.Session,
): { vendorId: string; plan: PaidVendorPlan } | null {
  const vendorId = session.metadata?.userId;
  const plan = session.metadata?.plan;
  if (
    session.mode !== "payment" ||
    !vendorId ||
    session.client_reference_id !== vendorId ||
    (plan !== "basic" && plan !== "max")
  ) {
    return null;
  }
  return { vendorId, plan };
}

async function saveVendorTransaction(
  session: Stripe.Checkout.Session,
  plan: PaidVendorPlan,
  status: TransactionStatus,
) {
  const vendor = getVendorPlanFromSession(session);
  if (!vendor || session.amount_total === null || !session.currency) {
    throw new HttpError(400, "Stripe's session is missing valid vendor plan payment details.");
  }

  const selectedPlan = VENDOR_PLANS[plan];
  if (
    vendor.plan !== plan ||
    session.amount_total !== selectedPlan.amount ||
    session.currency !== selectedPlan.currency
  ) {
    throw new HttpError(400, "Stripe's session does not match the selected vendor plan.");
  }

  const transactionFields = {
    vendorId: vendor.vendorId,
    plan,
    amount: session.amount_total,
    currency: session.currency,
    stripeSessionId: session.id,
    stripeSubscriptionId:
      typeof session.subscription === "string" ? session.subscription : null,
  };
  const update =
    status === "pending"
      ? {
          $set: transactionFields,
          $setOnInsert: { status: "pending" as const },
        }
      : { $set: { ...transactionFields, status } };

  const transaction = await PaymentTransactionModel.findOneAndUpdate(
    { stripeSessionId: session.id },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  if (!transaction) throw new HttpError(500, "Could not save the Stripe transaction.");
  return transaction;
}

async function activateVendorPlan(
  vendorId: string,
  plan: PaidVendorPlan,
  checkoutCreatedAt: Date,
): Promise<boolean> {
  const result = await VendorPlanModel.updateOne(
    {
      vendorId,
      $or: [
        { lastCancelledAt: null },
        { lastCancelledAt: { $lt: checkoutCreatedAt } },
      ],
    },
    { $set: { plan } },
  );
  return result.matchedCount > 0;
}

async function syncVendorCheckoutSession(
  session: Stripe.Checkout.Session,
  status: TransactionStatus,
): Promise<void> {
  const vendorPlan = getVendorPlanFromSession(session);
  if (!vendorPlan) return;

  const planRecord = await getOrCreateVendorPlan(vendorPlan.vendorId);
  if (!planRecord) throw new HttpError(500, "Could not load the vendor's service plan.");
  const checkoutCreatedAt = new Date(session.created * 1000);
  if (planRecord.lastCancelledAt && checkoutCreatedAt <= planRecord.lastCancelledAt) return;

  await saveVendorTransaction(session, vendorPlan.plan, status);
  if (
    status === "paid" &&
    !(await activateVendorPlan(vendorPlan.vendorId, vendorPlan.plan, checkoutCreatedAt))
  ) {
    await PaymentTransactionModel.deleteOne({
      stripeSessionId: session.id,
      vendorId: vendorPlan.vendorId,
    });
  }
}

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

paymentRouter.get(
  "/session/:id",
  requireAuth,
  requireRole("customer", "vendor"),
  async (req, res, next) => {
    try {
      if (!isStripeConfigured) {
        throw new HttpError(503, "Stripe test mode is not configured on the server.");
      }

      const user = req.auth!.user;
      const session = await stripe.checkout.sessions.retrieve(getParamId(req));
      if (
        session.client_reference_id !== user.id ||
        session.metadata?.userId !== user.id
      ) {
        throw new HttpError(404, "Payment session not found.");
      }

      let transaction = null;
      const vendorPlan = getVendorPlanFromSession(session);
      if (vendorPlan) {
        if ((user as { role?: string }).role !== "vendor") {
          throw new HttpError(404, "Payment session not found.");
        }

        const planRecord = await getOrCreateVendorPlan(vendorPlan.vendorId);
        if (!planRecord) throw new HttpError(500, "Could not load the vendor's service plan.");
        const checkoutCreatedAt = new Date(session.created * 1000);
        const wasCancelled =
          planRecord.lastCancelledAt && checkoutCreatedAt <= planRecord.lastCancelledAt;

        if (!wasCancelled) {
          const status: TransactionStatus =
            session.payment_status === "paid"
              ? "paid"
              : session.status === "expired"
                ? "expired"
                : "pending";
          transaction = await saveVendorTransaction(session, vendorPlan.plan, status);
          if (status === "paid") {
            const activated = await activateVendorPlan(
              vendorPlan.vendorId,
              vendorPlan.plan,
              checkoutCreatedAt,
            );
            if (!activated) {
              await PaymentTransactionModel.deleteOne({
                stripeSessionId: session.id,
                vendorId: vendorPlan.vendorId,
              });
              transaction = null;
            }
          }
        } else {
          transaction = await PaymentTransactionModel.findOne({
            stripeSessionId: session.id,
            vendorId: user.id,
          }).lean();
        }
      }

      const createdAt =
        transaction?.createdAt ?? new Date(session.created * 1000);
      const status: TransactionStatus =
        transaction?.status ??
        (session.payment_status === "paid"
          ? "paid"
          : session.status === "expired"
            ? "expired"
            : "pending");

      res.json({
        vendorId: transaction?.vendorId ?? vendorPlan?.vendorId ?? null,
        plan: transaction?.plan ?? vendorPlan?.plan ?? null,
        amount: transaction?.amount ?? session.amount_total,
        currency: transaction?.currency ?? session.currency,
        stripeSessionId: session.id,
        stripeSubscriptionId:
          transaction?.stripeSubscriptionId ??
          (typeof session.subscription === "string" ? session.subscription : null),
        status,
        createdAt,
        mode: isStripeTestMode ? "test" : "live",
      });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /api/payments/checkout — creates a hosted Stripe Checkout session. */
paymentRouter.post(
  "/checkout",
  requireAuth,
  requireRole("customer", "vendor"),
  async (req, res, next) => {
  try {
    if (!isStripeConfigured) {
      throw new HttpError(
        503,
        "Stripe test mode is not configured. Add an sk_test_ secret key to the server .env.",
      );
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

    if (vendorPlan) {
      await saveVendorTransaction(session, vendorPlan, "pending");
    }

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
    } catch {
      console.warn("[matrimap:stripe] Webhook signature verification failed");
      throw new HttpError(400, "Stripe webhook signature verification failed.");
    }

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        await syncVendorCheckoutSession(
          session,
          session.payment_status === "paid" ? "paid" : "pending",
        );
        break;
      }
      case "checkout.session.async_payment_failed": {
        await syncVendorCheckoutSession(event.data.object as Stripe.Checkout.Session, "failed");
        break;
      }
      case "checkout.session.expired": {
        await syncVendorCheckoutSession(event.data.object as Stripe.Checkout.Session, "expired");
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
