import { Router, type NextFunction, type Request, type Response } from "express";
import { ObjectId, type Document, type Filter } from "mongodb";
import { Types } from "mongoose";
import { z } from "zod";
import { mongoDb } from "../config/database.js";
import { HttpError } from "../lib/http-error.js";
import { requireAdmin, requireAuth } from "../middleware/require-auth.js";
import { ServiceModel } from "../models/service.model.js";
import { PaymentTransactionModel } from "../models/payment-transaction.model.js";

type ManagedRole = "customer" | "vendor";

interface ManagedUserDocument extends Document {
  _id: string | ObjectId;
  name: string;
  email: string;
  role: ManagedRole;
  isBlocked?: boolean;
  createdAt: Date;
}

const users = mongoDb.collection<ManagedUserDocument>("user");
export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

function getParamId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] ?? "" : id;
}

adminRouter.get("/services", async (_req, res, next) => {
  try {
    const services = await ServiceModel.find().sort({ createdAt: -1 }).lean();
    res.json(services);
  } catch (error) {
    next(error);
  }
});

function reviewService(approvalStatus: "approved" | "declined") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = getParamId(req);
      if (!Types.ObjectId.isValid(id)) {
        throw new HttpError(404, "Service not found");
      }

      const service = await ServiceModel.findOneAndUpdate(
        {
          _id: id,
          $or: [{ approvalStatus: "pending" }, { approvalStatus: { $exists: false } }],
        },
        { $set: { approvalStatus } },
        { new: true },
      ).lean();

      if (!service) throw new HttpError(404, "Pending service not found");
      res.json(service);
    } catch (error) {
      next(error);
    }
  };
}

adminRouter.post("/services/:id/approve", reviewService("approved"));
adminRouter.post("/services/:id/decline", reviewService("declined"));

const availabilitySchema = z.object({ isAvailable: z.boolean() });

adminRouter.patch("/services/:id/availability", async (req, res, next) => {
  try {
    const id = getParamId(req);
    if (!Types.ObjectId.isValid(id)) throw new HttpError(404, "Service not found");

    const { isAvailable } = availabilitySchema.parse(req.body);
    const service = await ServiceModel.findOneAndUpdate(
      { _id: id, approvalStatus: "approved" },
      { $set: { isAvailable } },
      { new: true },
    ).lean();

    if (!service) throw new HttpError(404, "Approved service not found");
    res.json(service);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "isAvailable must be a boolean." });
      return;
    }
    next(error);
  }
});

adminRouter.get("/users", async (_req, res, next) => {
  try {
    const accounts = await users
      .find(
        { role: { $in: ["customer", "vendor"] } },
        { projection: { name: 1, email: 1, role: 1, isBlocked: 1, createdAt: 1 } },
      )
      .sort({ createdAt: -1 })
      .toArray();

    res.json(
      accounts.map((user) => ({
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        isBlocked: user.isBlocked === true,
        createdAt: user.createdAt,
      })),
    );
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/payments", async (_req, res, next) => {
  try {
    const transactions = await PaymentTransactionModel.find()
      .select("vendorId plan amount currency stripeSessionId stripeSubscriptionId status createdAt")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    res.json(transactions);
  } catch (error) {
    next(error);
  }
});

async function setUserBlocked(
  userId: string,
  isBlocked: boolean,
  res: Response,
): Promise<void> {
  const ids: (string | ObjectId)[] = [userId];
  if (ObjectId.isValid(userId)) ids.push(new ObjectId(userId));
  const filter: Filter<ManagedUserDocument> = {
    $and: [
      { _id: { $in: ids } },
      { role: { $in: ["customer", "vendor"] } },
    ],
  };
  const result = await users.updateOne(filter, { $set: { isBlocked } });
  if (!result.matchedCount) throw new HttpError(404, "Customer or vendor account not found");

  const user = await users.findOne(filter, {
    projection: { name: 1, email: 1, role: 1, isBlocked: 1, createdAt: 1 },
  });
  if (!user) throw new HttpError(404, "Customer or vendor account not found");

  res.json({
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    isBlocked: user.isBlocked === true,
    createdAt: user.createdAt,
  });
}

adminRouter.post("/users/:id/block", async (req, res, next) => {
  try {
    await setUserBlocked(getParamId(req), true, res);
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/users/:id/unblock", async (req, res, next) => {
  try {
    await setUserBlocked(getParamId(req), false, res);
  } catch (error) {
    next(error);
  }
});
