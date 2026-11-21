import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { ObjectId } from "mongodb";
import { auth } from "../lib/auth.js";
import { mongoDb } from "../config/database.js";
import { createAccessToken, getAccessTokenCookie } from "../lib/jwt.js";
import { HttpError } from "../lib/http-error.js";

export const authTokenRouter = Router();

authTokenRouter.get("/", async (req, res, next) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new HttpError(401, "You must be signed in to obtain an access token.");

    const ids: (string | ObjectId)[] = [session.user.id];
    if (ObjectId.isValid(session.user.id)) ids.push(new ObjectId(session.user.id));
    const user = await mongoDb.collection<{ _id: string | ObjectId; isBlocked?: boolean }>("user").findOne(
      { _id: { $in: ids } },
      { projection: { isBlocked: 1 } },
    );
    if (!user) throw new HttpError(401, "User account not found.");
    if (user.isBlocked === true) throw new HttpError(403, "Your account is blocked and cannot perform this action.");

    res.setHeader("Set-Cookie", getAccessTokenCookie(createAccessToken(session.user.id)));
    res.json({ authenticated: true });
  } catch (error) {
    next(error);
  }
});

authTokenRouter.delete("/", (_req, res) => {
  res.setHeader("Set-Cookie", getAccessTokenCookie("", 0));
  res.status(204).end();
});

