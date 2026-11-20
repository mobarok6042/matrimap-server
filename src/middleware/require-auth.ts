import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { auth } from "../lib/auth.js";

declare global {
  namespace Express {
    interface Request {
      auth?: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      res.status(401).json({ error: "You must be signed in to do that." });
      return;
    }

    req.auth = session;
    next();
  } catch (error) {
    next(error);
  }
}
