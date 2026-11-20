import { Schema, model, type InferSchemaType } from "mongoose";

const bookingSchema = new Schema(
  {
    serviceId: { type: String, required: true, index: true },
    serviceTitle: { type: String, required: true, trim: true },
    vendorId: { type: String, required: true, index: true },
    vendorName: { type: String, required: true, trim: true },
    vendorEmail: { type: String, required: true, trim: true },
    customerId: { type: String, required: true, index: true },
    customerName: { type: String, required: true, trim: true },
    customerEmail: { type: String, required: true, trim: true },
    eventDate: { type: String, required: true, trim: true, maxlength: 30 },
    eventLocation: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, default: "", trim: true, maxlength: 2000 },
    status: { type: String, enum: ["pending", "accepted", "declined"], default: "pending" },
  },
  { timestamps: true, versionKey: false },
);

export type Booking = InferSchemaType<typeof bookingSchema>;
export const BookingModel = model("Booking", bookingSchema);
