import { HttpError } from "./http-error.js";
import { MongoServerError } from "mongodb";
import { ServiceModel } from "../models/service.model.js";
import { VendorPlanModel } from "../models/vendor-plan.model.js";

export const VENDOR_PLANS = {
  free: { name: "Free", serviceLimit: 3, amount: 0, currency: "usd" },
  basic: { name: "Basic", serviceLimit: 10, amount: 1111, currency: "usd" },
  max: { name: "Max", serviceLimit: 25, amount: 1999, currency: "usd" },
} as const;

export type PaidVendorPlan = Exclude<keyof typeof VENDOR_PLANS, "free">;
export type VendorPlanName = keyof typeof VENDOR_PLANS;

export async function getOrCreateVendorPlan(vendorId: string) {
  const existing = await VendorPlanModel.findOne({ vendorId }).lean();
  if (existing) return existing;

  const serviceCount = await ServiceModel.countDocuments({ vendorId });
  try {
    return await VendorPlanModel.findOneAndUpdate(
      { vendorId },
      { $setOnInsert: { vendorId, plan: "free", serviceCount } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
    const createdByConcurrentRequest = await VendorPlanModel.findOne({ vendorId }).lean();
    if (!createdByConcurrentRequest) throw error;
    return createdByConcurrentRequest;
  }
}

export async function reserveVendorServiceSlot(vendorId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const plan = await getOrCreateVendorPlan(vendorId);
    if (!plan) throw new HttpError(500, "Could not load the vendor's service plan.");

    const limit = VENDOR_PLANS[plan.plan as VendorPlanName].serviceLimit;
    const reserved = await VendorPlanModel.findOneAndUpdate(
      {
        vendorId,
        plan: plan.plan,
        serviceCount: { $lt: limit },
      },
      { $inc: { serviceCount: 1 } },
      { new: true },
    ).lean();

    if (reserved) return;

    const current = await VendorPlanModel.findOne({ vendorId }).lean();
    if (
      current?.plan === plan.plan &&
      current.serviceCount >= VENDOR_PLANS[current.plan as VendorPlanName].serviceLimit
    ) {
      const currentPlan = VENDOR_PLANS[current.plan as VendorPlanName];
      throw new HttpError(
        403,
        `Your ${currentPlan.name} plan allows up to ${currentPlan.serviceLimit} services. Choose a higher plan to add more.`,
      );
    }
  }

  throw new HttpError(409, "Your plan changed while submitting the service. Please try again.");
}

export async function releaseVendorServiceSlot(vendorId: string): Promise<void> {
  await VendorPlanModel.updateOne(
    { vendorId, serviceCount: { $gt: 0 } },
    { $inc: { serviceCount: -1 } },
  );
}
