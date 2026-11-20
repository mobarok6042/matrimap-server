import cors from "cors";
import express from "express";
import helmet from "helmet";
import { toNodeHandler } from "better-auth/node";
import { env } from "./config/env.js";
import { auth } from "./lib/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { meRouter } from "./routes/me.routes.js";
import { paymentRouter, stripeWebhook } from "./routes/payment.routes.js";
import { profileRouter } from "./routes/profile.routes.js";
import { serviceRouter } from "./routes/service.routes.js";
import { bookingRouter } from "./routes/booking.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { uploadRouter } from "./routes/upload.routes.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin: env.CLIENT_URL.split(",").map((origin) => origin.trim()),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: Math.round(process.uptime()) });
  });

  // Better Auth needs the untouched request stream — mount before express.json().
  app.all("/api/auth/{*splat}", toNodeHandler(auth));

  // Stripe needs the raw body bytes for signature verification.
  app.post("/api/payments/webhook", express.raw({ type: "application/json" }), stripeWebhook);

  app.use(express.json({ limit: "1mb" }));

  app.use("/api/me", meRouter);
  app.use("/api/profiles", profileRouter);
  app.use("/api/services", serviceRouter);
  app.use("/api/bookings", bookingRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/upload", uploadRouter);
  app.use("/api/payments", paymentRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
