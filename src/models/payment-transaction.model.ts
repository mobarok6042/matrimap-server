import { Schema, model, type InferSchemaType } from "mongoose";

const paymentTransactionSchema = new Schema(
  {
    vendorId: { type: String, required: true, index: true },
    vendorName: { type: String, required: true },
    vendorEmail: { type: String, required: true },
    plan: { type: String, enum: ["basic", "max"], required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    checkoutSessionId: { type: String, required: true, unique: true },
    paymentIntentId: { type: String, default: null },
    paidAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false },
);

export type PaymentTransaction = InferSchemaType<typeof paymentTransactionSchema>;
export const PaymentTransactionModel = model("PaymentTransaction", paymentTransactionSchema);
