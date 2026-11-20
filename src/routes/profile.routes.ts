import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../lib/http-error.js";
import { ProfileModel } from "../models/profile.model.js";
import { requireAuth } from "../middleware/require-auth.js";

export const profileRouter = Router();

const upsertSchema = z.object({
  displayName: z.string().min(2).max(80),
  bio: z.string().max(1000).optional(),
  location: z.string().max(120).optional(),
  age: z.number().int().min(18).max(120).optional(),
  images: z.array(z.url()).max(12).optional(),
});

profileRouter.get("/", async (_req, res, next) => {
  try {
    const profiles = await ProfileModel.find().sort({ createdAt: -1 }).limit(50).lean();
    res.json(profiles);
  } catch (error) {
    next(error);
  }
});

profileRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const profile = await ProfileModel.findOne({ userId: req.auth!.user.id }).lean();
    if (!profile) throw new HttpError(404, "Profile not found");
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

profileRouter.post("/", requireAuth, async (req, res, next) => {
  try {
    const input = upsertSchema.parse(req.body);
    const userId = req.auth!.user.id;

    const profile = await ProfileModel.findOneAndUpdate(
      { userId },
      { $set: { ...input, userId } },
      { new: true, upsert: true, runValidators: true },
    ).lean();

    res.json(profile);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid profile", issues: error.issues });
      return;
    }
    next(error);
  }
});
