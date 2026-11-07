import { AI_CONSENT_VERSION } from "../src/consent";

type Requester = { request(path: string, init?: RequestInit): Response | Promise<Response> };

/**
 * Gives the account behind `token` the AI consent the way the app's consent screen does (POST /me/consent), so a test
 * of some other feature starts from an account that may use the app. Returns the token. Tests of the consent itself
 * (consent.test.ts) leave accounts without it.
 */
export async function accepted(app: Requester, token: string): Promise<string> {
  const res = await app.request("/me/consent", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ version: AI_CONSENT_VERSION }) });
  if (!res.ok) throw new Error(`consent not saved: ${res.status} ${await res.text()}`);
  return token;
}
