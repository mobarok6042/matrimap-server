import { Schema, model, type InferSchemaType } from "mongoose";

const paymentTransactionSchema = new Schema(
  {
    vendorId: { type: String, required: true, index: true },
    plan: { type: String, enum: ["basic", "max"], required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    stripeSessionId: { type: String, required: true, unique: true },
    stripeSubscriptionId: { type: String, default: null },
    status: {
      type: String,
      enum: ["pending", "paid", "failed", "expired"],
      default: "pending",
      required: true,
    },
  },
  { timestamps: true, versionKey: false },
);

export type PaymentTransaction = InferSchemaType<typeof paymentTransactionSchema>;
export const PaymentTransactionModel = model("PaymentTransaction", paymentTransactionSchema);
