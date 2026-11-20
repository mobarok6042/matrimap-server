import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { auth } from "../lib/auth.js";
import { mongoDb } from "../config/database.js";
import { HttpError } from "../lib/http-error.js";

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

export function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const role = (req.auth?.user as { role?: string } | undefined)?.role;
  if (role !== "admin") {
    next(new HttpError(403, "Only administrators can access this resource."));
    return;
  }
  next();
}

export async function requireUnblockedUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await mongoDb.collection<{ _id: string; isBlocked?: boolean }>("user").findOne(
      { _id: req.auth!.user.id },
      { projection: { isBlocked: 1 } },
    );

    if (user?.isBlocked === true) {
      res.status(403).json({ error: "Your account is blocked and cannot perform this action." });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}
