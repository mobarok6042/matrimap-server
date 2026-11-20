import { Schema, model, type InferSchemaType } from "mongoose";

const serviceSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 120 },
    category: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    pricingUnit: { type: String, default: "per event", trim: true },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    location: { type: String, required: true, trim: true, maxlength: 120 },
    image: { type: String, default: "" },
    images: { type: [String], default: [] },
    phone: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true },
    vendorId: { type: String, required: true, index: true },
    vendorName: { type: String, required: true, trim: true },
    vendorEmail: { type: String, required: true, trim: true },
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "declined"],
      default: "pending",
      index: true,
    },
    rating: { type: Number, default: 5.0, min: 1, max: 5 },
    isAvailable: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);

export type Service = InferSchemaType<typeof serviceSchema>;
export const ServiceModel = model("Service", serviceSchema);
