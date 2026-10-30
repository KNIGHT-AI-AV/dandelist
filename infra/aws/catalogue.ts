/**
 * Rebuilds the pre-login catalogue (packages/catalogue/src/catalogue.json) by asking the live Meta wish agent to
 * price every seed, signed in as the judge account. Each entry keeps the agent's chosen option with its seller,
 * URL, check time and media. Seeds that fail keep their previous entry. About $0.06 of Meta credit per seed.
 * Usage: API_URL=https://api.dandelist.knightaiav.com pnpm --filter @dandelist/infra-aws run catalogue [id ...]
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { seeds, type Entry, type Seed } from "../../packages/catalogue/src/index";
import { credentials, region } from "./creds";

const base = process.env.API_URL;
if (!base) throw new Error("Set API_URL to the service URL");
const out = fileURLToPath(new URL("../../packages/catalogue/src/catalogue.json", import.meta.url));
const only = process.argv.slice(2);

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

await call("POST", "/auth/email/start", { email: "judge@dandelist.com" });
const signIn = await call("POST", "/auth/email/verify", { email: "judge@dandelist.com", code });
if (signIn.status !== 200) throw new Error(`judge sign-in failed: ${signIn.status}`);
const token = signIn.json!.accessToken as string;

const rank = (o: any) => (o.status === "verified" ? 2 : 0) + ({ high: 1, medium: 0.5, low: 0 } as Record<string, number>)[o.confidence ?? "low"]!;

// RUNS="seed=runId,..." resumes runs that were already started instead of paying for new ones.
const resume = new Map((process.env.RUNS ?? "").split(",").filter(Boolean).map((p) => p.split("=") as [string, string]));

async function price(seed: Seed): Promise<Entry> {
  let run: any;
  const known = resume.get(seed.id);
  if (known) {
    run = (await call("GET", `/agent/runs/${known}`, undefined, token)).json!.run;
  } else {
    const read = await call("POST", "/agent/interpret", { text: seed.ask }, token);
    if (read.status !== 200) throw new Error(`interpret ${read.status} ${read.json?.error ?? ""}`);
    const started = await call("POST", "/agent/runs", { draft: read.json!.draft, answers: [] }, token);
    if (![200, 201, 202].includes(started.status)) throw new Error(`run ${started.status} ${started.json?.error ?? ""}`);
    run = started.json!.run;
  }
  const deadline = Date.now() + 240_000;
  while (run.status === "running" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    run = (await call("GET", `/agent/runs/${run.id}`, undefined, token)).json!.run;
  }
  if (run.status !== "done" || !run.result?.options?.length) throw new Error(`run ended ${run.status}: ${run.error ?? "no options"}`);
  const best = [...run.result.options].sort((a: any, b: any) => rank(b) - rank(a))[0];
  return {
    ...seed,
    upfrontCents: best.upfrontCents,
    recurring: best.recurring ?? [],
    status: best.status,
    seller: best.seller,
    url: best.url,
    checkedAt: best.checkedAt,
    ...(best.imageUrl ? { imageUrl: best.imageUrl } : {}),
    ...(best.media ? { media: best.media } : {}),
  };
}

// Hand-curated photographs: our own media store, or Unsplash's own links for Unsplash photos (unsplash-hotlinks.ts).
const CURATED = /^https:\/\/(api\.dandelist\.knightaiav\.com\/media\/|images\.unsplash\.com\/)/;
const previous = JSON.parse(await readFile(out, "utf8")) as Entry[];
const results = new Map(previous.map((e) => [e.id, e]));
const todo = seeds.filter((s) => !only.length || only.includes(s.id));
// Two at a time keeps well inside the per-user run cap and the agent's rate limits.
for (let i = 0; i < todo.length; i += 2) {
  await Promise.all(
    todo.slice(i, i + 2).map(async (seed) => {
      try {
        const e = await price(seed);
        // Hand-curated photographs survive a re-price.
        const prev = results.get(seed.id);
        if (CURATED.test(prev?.media?.images[0]?.url ?? "")) Object.assign(e, { media: prev!.media, imageUrl: prev!.imageUrl });
        results.set(seed.id, e);
        console.log(`ok    ${seed.id}  ${(e.upfrontCents / 100).toFixed(2)}  ${e.status}  ${e.seller}  media:${e.media ? `${e.media.images.length} img${e.media.model3d ? " +3d" : ""}${e.media.cutout ? " +cutout" : ""}` : e.imageUrl ? "og" : "none"}`);
      } catch (err) {
        console.log(`FAIL  ${seed.id}  ${(err as Error).message}`);
        process.exitCode = 1;
      }
    }),
  );
}
const ordered = seeds.map((s) => results.get(s.id)).filter(Boolean);
await writeFile(out, JSON.stringify(ordered, null, 2) + "\n");
console.log(`wrote ${ordered.length} entries`);
