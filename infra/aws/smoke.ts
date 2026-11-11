/**
 * Checks the live API end to end using an account that has already accepted AI consent.
 * Consent is never accepted by this script. The judge code is read from Secrets Manager and never printed.
 * Usage: API_URL=https://... pnpm --filter @dandelist/infra-aws run smoke
 * AGENT=1 also asks the Meta agent to read one wish (a paid call; separate spending authority required).
 * Use smoke:public for credential-free, read-only release checks.
 */
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { credentials, region } from "./creds";
import { accountSmoke } from "./smoke-checks";

const base = process.env.API_URL;
if (!base) throw new Error("Set API_URL to the service URL");
const email = "judge@dandelist.com";
const code = (await new SecretsManagerClient({ region, credentials }).send(new GetSecretValueCommand({ SecretId: "dandelist/api/judge-code" }))).SecretString!;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, any>) : null };
}

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) process.exitCode = 1;
}

const health = await call("GET", "/healthz");
check("health and database", health.status === 200 && health.json?.ok === true, String(health.status));

check("judge sign-in start", (await call("POST", "/auth/email/start", { email })).status === 204);
const signIn = await call("POST", "/auth/email/verify", { email, code });
check("judge sign-in verify", signIn.status === 200, String(signIn.status));
const token = signIn.json?.accessToken as string;

if (signIn.status === 200 && typeof token === "string" && token.length > 0) {
  try {
    for (const result of await accountSmoke((method, path, body) => call(method, path, body, token), process.env.AGENT === "1")) {
      check(result.label, result.ok, result.detail);
    }
  } finally {
    check("sign out", (await call("POST", "/auth/logout", {}, token)).status === 204);
  }
} else {
  check("valid sign-in token", false);
}
