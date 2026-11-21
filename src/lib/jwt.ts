import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

export const ACCESS_TOKEN_COOKIE = "matrimap_access_token";
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

export interface AccessTokenClaims {
  sub: string;
  iat: number;
  exp: number;
}

function encode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function sign(value: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(value).digest("base64url");
}

export function createAccessToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encode(JSON.stringify({ sub: userId, iat: now, exp: now + ACCESS_TOKEN_TTL_SECONDS }));
  const content = `${header}.${payload}`;
  return `${content}.${sign(content)}`;
}

export function verifyAccessToken(token: string): AccessTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expectedSignature = sign(`${header}.${payload}`);
  const received = Buffer.from(signature, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<AccessTokenClaims>;
    if (
      typeof claims.sub !== "string" ||
      typeof claims.iat !== "number" ||
      typeof claims.exp !== "number" ||
      claims.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return claims as AccessTokenClaims;
  } catch {
    return null;
  }
}

export function getAccessTokenCookie(token: string, maxAge = ACCESS_TOKEN_TTL_SECONDS): string {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ACCESS_TOKEN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
