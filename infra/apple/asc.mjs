/**
 * Minimal App Store Connect API client. Reads the team's API key from ~/.secrets/apple/asc-drec.env
 * (ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID); nothing secret is printed.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SignJWT, importPKCS8 } from "jose";

const envFile = readFileSync(join(homedir(), ".secrets/apple/asc-drec.env"), "utf8");
const env = Object.fromEntries(envFile.split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
export const teamId = env.APPLE_TEAM_ID;
export const keyId = env.ASC_KEY_ID;
export const issuerId = env.ASC_ISSUER_ID;
export const keyPath = env.ASC_KEY_PATH.replace(/^~/, homedir());

async function token() {
  const key = await importPKCS8(readFileSync(keyPath, "utf8"), "ES256");
  return new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: keyId, typ: "JWT" }).setIssuer(issuerId).setIssuedAt().setExpirationTime("15m").setAudience("appstoreconnect-v1").sign(key);
}

export async function asc(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return json;
}
