import { Schema, model, type InferSchemaType } from "mongoose";

const profileSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    bio: { type: String, default: "", maxlength: 1000 },
    location: { type: String, default: "", maxlength: 120 },
    age: { type: Number, min: 18, max: 120 },
    images: { type: [String], default: [] },
    isPremium: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

export type Profile = InferSchemaType<typeof profileSchema>;
export const ProfileModel = model("Profile", profileSchema);
