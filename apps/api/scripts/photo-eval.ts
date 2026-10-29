/**
 * The photo hunt against a fixed set of wishes (owner, 2026-10-29: "run them all on test assignment to see which is
 * accurate"). Each variant hunts every case; the picks, their source and their time go to <out>/<variant>.json for a
 * person to judge against each case's `truth`.
 *
 *   tsx scripts/photo-eval.ts <variant> <out dir>
 *
 * The Meta key comes from MODEL_API_KEY or a vault reader (see key.ts) and is never printed or written.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { MetaClient } from "@dandelist/meta";
import { findPhoto, type PhotoSubject } from "../src/agent/photos";
import { publicFetch } from "../src/agent/tools";
import { apiKey } from "./key";

type Case = PhotoSubject & { truth: string };
const [variant = "current", out = "photo-eval-out"] = process.argv.slice(2);
const cases = JSON.parse(readFileSync(new URL("./photo-eval-cases.json", import.meta.url), "utf8")) as Case[];
// A retake turns down the first hunt's pick: <out>/v6-spark.json, when there is one.
const first = existsSync(`${out}/v6-spark.json`) ? (JSON.parse(readFileSync(`${out}/v6-spark.json`, "utf8")) as { results: { title: string; url: string | null }[] }).results : [];
const turnedDown = (title: string) => first.find((r) => r.title === title)?.url ?? undefined;

let calls = 0;
let costUsd = 0;
const meta = new MetaClient({ apiKey: apiKey(), onUsage: (_u, c) => void ((calls += 1), (costUsd += c)) });

const hunt = async (c: Case) => {
  const subject: PhotoSubject = { title: c.title, kind: c.kind, place: c.place };
  switch (variant) {
    // The first card's hunt, with each model planning and checking at low effort.
    case "v7-spark":
      return findPhoto(meta, subject, { fetcher: publicFetch, by: Date.now() + 40_000 });
    case "v3-wonder":
      return findPhoto(meta, subject, { fetcher: publicFetch, model: "muse-wonder-1.0", by: Date.now() + 40_000 });
    // A retake of the first hunt's pick, as the app's Retake asks for it.
    case "v6-retake": {
      const shown = turnedDown(c.title);
      return findPhoto(meta, subject, { fetcher: publicFetch, deep: true, exclude: shown ? [shown] : [], by: Date.now() + 35_000 });
    }
    default:
      throw new Error(`no variant ${variant}`);
  }
};

const results: unknown[] = [];
const queue = [...cases];
const worker = async () => {
  for (let c = queue.shift(); c; c = queue.shift()) {
    const t0 = Date.now();
    const found = await hunt(c).catch((e) => ({ error: (e as Error).message }));
    const ms = Date.now() - t0;
    const row = found && "image" in found ? { title: c.title, truth: c.truth, url: found.image.url, how: found.how, ms } : { title: c.title, truth: c.truth, url: null, how: null, ms, error: (found as { error?: string } | null)?.error ?? "none found" };
    results.push(row);
    console.log(`${variant} | ${(ms / 1000).toFixed(1)} s | ${c.title} | ${"url" in row && row.url ? row.how : "NONE"}`);
  }
};
await Promise.all([worker(), worker(), worker(), worker()]);
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/${variant}.json`, JSON.stringify({ variant, calls, costUsd, results }, null, 2));
console.log(`${variant}: ${results.length} cases, ${calls} model calls, $${costUsd.toFixed(3)}`);
