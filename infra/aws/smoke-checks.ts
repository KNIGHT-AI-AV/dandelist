export type SmokeReply = { status: number; json: Record<string, any> | null };
export type SmokeCall = (method: string, path: string, body?: unknown) => Promise<SmokeReply>;
export type SmokeCheck = { label: string; ok: boolean; detail?: string };

/** Public release checks have no credentials, account writes or model requests. */
export async function publicSmoke(base: string, request: typeof fetch = fetch): Promise<SmokeCheck[]> {
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Use an API origin without credentials, query or path");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Use HTTPS, or HTTP on loopback for a local test");
  }
  const checks: SmokeCheck[] = [];
  for (const [path, label, valid] of [
    ["/healthz", "health and database", (r: SmokeReply) => r.status === 200 && r.json?.ok === true],
    ["/config/features", "public feature configuration", (r: SmokeReply) => r.status === 200 && typeof r.json?.chatContinuity === "boolean"],
    ["/auth/providers", "sign-in providers", (r: SmokeReply) => r.status === 200 && Array.isArray(r.json?.providers) && r.json.providers.length > 0],
    ["/me/consent", "account consent requires sign-in", (r: SmokeReply) => r.status === 401],
  ] as const) {
    try {
      const response = await request(new URL(path, url), {
        method: "GET", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      const json = await response.json().catch(() => null);
      checks.push({ label, ok: valid({ status: response.status, json }), detail: String(response.status) });
    } catch {
      // Never echo a response body, URL query, cookie, credential or account data.
      checks.push({ label, ok: false, detail: "request failed" });
    }
  }
  return checks;
}

/** Requires the account's existing consent; never records acceptance on its behalf. */
export async function accountSmoke(call: SmokeCall, agent = false): Promise<SmokeCheck[]> {
  const checks: SmokeCheck[] = [];
  const consent = await call("GET", "/me/consent");
  const accepted = consent.status === 200 && consent.json?.consent?.accepted === true;
  checks.push({ label: "account owner has accepted current AI consent", ok: accepted, detail: String(consent.status) });
  if (!accepted) {
    if (consent.status === 200 && consent.json?.consent?.accepted === false) {
      const denied = await call("GET", "/wishes");
      checks.push({ label: "protected data denied before consent", ok: denied.status === 403 && denied.json?.code === "consent_required", detail: String(denied.status) });
    }
    return checks;
  }

  const created = await call("POST", "/wishes", {
    name: "Smoke test wish", kind: "buy", upfrontCents: 12345,
    recurring: [{ amountCents: 500, period: "month" }],
  });
  const id = created.json?.wish?.id;
  const validId = typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  checks.push({ label: "create wish", ok: created.status === 201 && validId, detail: String(created.status) });
  if (created.status !== 201 || !validId) return checks;
  try {
    const list = await call("GET", "/wishes");
    checks.push({ label: "list includes the created wish", ok: list.status === 200 && Array.isArray(list.json?.wishes) && list.json.wishes.some((w: { id: string }) => w.id === id) });
    if (agent) {
      const read = await call("POST", "/agent/interpret", { text: "a Peloton Bike+" });
      checks.push({ label: "agent reads a wish", ok: read.status === 200 && typeof read.json?.draft?.title === "string", detail: String(read.status) });
    }
  } finally {
    const deleted = await call("DELETE", `/wishes/${id}`);
    checks.push({ label: "delete the created wish", ok: deleted.status === 204, detail: String(deleted.status) });
  }
  return checks;
}
