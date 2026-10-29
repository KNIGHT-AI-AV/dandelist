/**
 * Why the photo hunt finds what it finds: every step of the hunt for a few wishes (plan, sources, sizing, checks),
 * with timings.
 *
 *   tsx scripts/photo-diag.ts <model: spark|wonder> "<title>|<kind>|<place>" ...
 */
import { MetaClient } from "@dandelist/meta";
import { findPhoto, type PhotoSubject } from "../src/agent/photos";
import { publicFetch } from "../src/agent/tools";
import { apiKey } from "./key";

const [which = "spark", ...wishes] = process.argv.slice(2);
const model = which === "wonder" ? "muse-wonder-1.0" : undefined;
const meta = new MetaClient({ apiKey: apiKey() });
const t = (t0: number) => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const cut = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n)}…` : s);

for (const w of wishes) {
  const [title, kind = "buy", place] = w.split("|");
  const subject: PhotoSubject = { title: title!, kind: kind as PhotoSubject["kind"], place };
  const t0 = Date.now();
  console.log(`\n=== ${title}`);
  const found = await findPhoto(meta, subject, {
    fetcher: publicFetch,
    model,
    by: Date.now() + 60_000,
    trace: (e) => {
      if (e.step === "plan") console.log(`  plan ${t(t0)} ${JSON.stringify(e.plan)}`);
      else if (e.step === "sources") console.log(`  sources ${t(t0)} page ${e.page}, web ${e.web}, wikipedia ${e.wikipedia}, commons ${e.commons}`);
      else if (e.step === "web") {
        console.log(`  web said ${e.said.length}: ${e.said.slice(0, 8).map((u) => cut(u, 90)).join(" | ")}`);
        for (const r of e.read) console.log(`    read ${r.ok ? "ok" : "FAILED"}, ${r.photos} photos: ${cut(r.url)}`);
      } else if (e.step === "sized") console.log(`  sized ${e.how} ${e.ok ? "ok" : `NO (${e.reasons.join("; ")})`}: ${cut(e.url)}`);
      else console.log(`  checked ${t(t0)} ${e.how} ${e.verdict ? cut(JSON.stringify(e.verdict), 420) : "FAILED or timed out"}: ${cut(e.url)}`);
    },
  });
  console.log(`  => ${found ? `${found.how} ${cut(found.image.url, 140)}` : "NONE"} after ${t(t0)}`);
}
