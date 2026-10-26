import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_CODES_PER_HOUR = 5;

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(pepper: string, email: string, code: string): string {
  return createHash("sha256").update(`${pepper}:${email}:${code}`).digest("hex");
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashRefresh(token) };
}

export function hashRefresh(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function signAccess(secret: string, userId: string, sessionId: string, nowS: number): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt(nowS)
    .setExpirationTime(nowS + ACCESS_TTL_S)
    .setIssuer("dandelist-api")
    .sign(new TextEncoder().encode(secret));
}

export async function verifyAccess(secret: string, token: string, nowS: number): Promise<{ userId: string; sessionId: string }> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { issuer: "dandelist-api", currentDate: new Date(nowS * 1000) });
  if (!payload.sub || typeof payload.sid !== "string") throw new Error("token is missing claims");
  return { userId: payload.sub, sessionId: payload.sid };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
