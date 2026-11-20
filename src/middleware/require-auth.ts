import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
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

    const userId = session.user.id;
    const ids: (string | ObjectId)[] = [userId];
    if (ObjectId.isValid(userId)) ids.push(new ObjectId(userId));

    const user = await mongoDb
      .collection<{ _id: string | ObjectId; isBlocked?: boolean }>("user")
      .findOne({ _id: { $in: ids } }, { projection: { isBlocked: 1 } });

    if (!user) {
      res.status(401).json({ error: "User account not found." });
      return;
    }

    if (user.isBlocked === true) {
      res.status(403).json({ error: "Your account is blocked and cannot perform this action." });
      return;
    }

    req.auth = session;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = (req.auth?.user as { role?: string } | undefined)?.role;
    if (!role || !allowedRoles.includes(role)) {
      next(new HttpError(403, "Your account role cannot access this resource."));
      return;
    }
    next();
  };
}

export async function denyVendorMarketplace(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.headers.cookie) {
    next();
    return;
  }

  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const role = (session?.user as { role?: string } | undefined)?.role;
    if (role === "vendor") {
      next(new HttpError(403, "Vendors can manage their own listings in My Services."));
      return;
    }
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
