import { importPKCS8, SignJWT } from "jose";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const unavailable = () => new Error("Play identity unavailable");

/** Deployment-owned service-account identity. Never logs a key, assertion, token or provider error body. */
export function playIdentity(json: string, request: typeof fetch = fetch, now: () => number = Date.now): () => Promise<string> {
  let account: { client_email: string; private_key: string };
  try {
    if (json.length > 32_000) throw unavailable();
    const value = JSON.parse(json);
    if (value.type !== "service_account" || typeof value.client_email !== "string" ||
        !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(value.client_email) ||
        typeof value.private_key !== "string" || !value.private_key.startsWith("-----BEGIN PRIVATE KEY-----")) throw unavailable();
    account = value;
  } catch { throw unavailable(); }
  let cached: { token: string; until: number } | undefined;
  let pending: Promise<string> | undefined;
  async function refresh(): Promise<string> {
    try {
      const issued = Math.floor(now() / 1000);
      const key = await importPKCS8(account.private_key, "RS256");
      const assertion = await new SignJWT({ scope: SCOPE }).setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setIssuer(account.client_email).setAudience(TOKEN_URL).setIssuedAt(issued).setExpirationTime(issued + 3600).sign(key);
      const response = await request(TOKEN_URL, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      });
      if (!response.ok) throw unavailable();
      const text = await response.text();
      if (text.length > 32_000) throw unavailable();
      const data = JSON.parse(text);
      if (data.token_type !== "Bearer" || typeof data.access_token !== "string" ||
          !data.access_token || data.access_token.length > 16_000 || /\s/.test(data.access_token) ||
          !Number.isInteger(data.expires_in) || data.expires_in < 120 || data.expires_in > 3600) throw unavailable();
      cached = { token: data.access_token, until: now() + (data.expires_in - 60) * 1000 };
      return cached.token;
    } catch { throw unavailable(); }
  }
  return async () => {
    if (cached && now() < cached.until) return cached.token;
    if (!pending) pending = refresh().finally(() => { pending = undefined; });
    return pending;
  };
}
