/**
 * Checks the live API end to end: health (which queries Postgres), sign-in as the judge account, and a wish
 * created, listed and removed. The judge code is read from Secrets Manager and never printed.
 * Usage: API_URL=https://... pnpm --filter @dandelist/infra-aws run smoke
 */
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { credentials, region } from "./creds";

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

const created = await call("POST", "/wishes", { name: "Smoke test wish", kind: "buy", upfrontCents: 12345, recurring: [{ amountCents: 500, period: "month" }] }, token);
check("create wish", created.status === 201, String(created.status));
const id = created.json?.wish?.id as string;
const list = await call("GET", "/wishes", undefined, token);
check("list includes it", list.status === 200 && list.json?.wishes?.some((w: { id: string }) => w.id === id));
check("delete wish", (await call("DELETE", `/wishes/${id}`, undefined, token)).status === 204);
check("sign out", (await call("POST", "/auth/logout", {}, token)).status === 204);
