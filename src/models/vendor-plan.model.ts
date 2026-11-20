import { Schema, model, type InferSchemaType } from "mongoose";

const vendorPlanSchema = new Schema(
  {
    vendorId: { type: String, required: true, unique: true, index: true },
    plan: { type: String, enum: ["free", "basic", "max"], default: "free", required: true },
    serviceCount: { type: Number, min: 0, default: 0, required: true },
    lastCancelledAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

export type VendorPlan = InferSchemaType<typeof vendorPlanSchema>;
export const VendorPlanModel = model("VendorPlan", vendorPlanSchema);
