import { Router } from "express";
import { requireAuth } from "../middleware/require-auth.js";

export const meRouter = Router();

meRouter.get("/", requireAuth, (req, res) => {
  res.json(req.auth);
});
