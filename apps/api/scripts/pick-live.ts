/**
 * Makes one daily pick against the real Meta API and the real web for a sample list with notes, and prints each model
 * call with its time, then the pick and its photo. No database. Usage: MODEL_API_KEY=... tsx scripts/pick-live.ts.
 * Spends about a cent.
 */
import { MetaClient } from "@dandelist/meta";
import type { Meta } from "../src/agent/agent";
import { publicFetch } from "../src/agent/tools";
import { digestLine, notesBlock } from "../src/notes";
import { choosePick, photoFor } from "../src/picks";

const client = new MetaClient({
  apiKey: process.env.MODEL_API_KEY!,
  onUsage: (u, c) => console.log(`  usage: ${u.inputTokens} in, ${u.outputTokens} out, ${u.searches} searches, ~$${c.toFixed(4)}`),
});
let n = 0;
const meta: Meta = {
  responses: async (body) => {
    const i = ++n;
    const t = Date.now();
    const res = await client.responses(body);
    const format = (body.text as { format?: { name?: string } } | undefined)?.format?.name ?? "text";
    console.log(`call ${i} (${format}${body.previous_response_id ? ", follow-up" : ""}): ${Date.now() - t} ms, answer: ${res.text.replace(/\s+/g, " ").slice(0, 240)}`);
    return res;
  },
};

const wishes = [
  { name: "Leica Q3", kind: "buy", note: "My dad shot everything on a Leica. I want one to photograph my kids growing up." },
  { name: "A week in Kyoto in April", kind: "visit", note: "Cherry blossoms with my wife for our tenth anniversary." },
  { name: "Porsche 911 Carrera", kind: "own", note: "" },
];
const notes = notesBlock(wishes.filter((w) => w.note).map((w) => digestLine(w.name, w.note)));

const t0 = Date.now();
const pick = await choosePick(meta, { day: new Date().toISOString().slice(0, 10), home: "Lisbon, Portugal", wishes, picks: [{ title: "Fujifilm X100VI", status: "skipped" }], notes });
console.log(`\npick in ${Date.now() - t0} ms:`, pick);
const t1 = Date.now();
const photo = await photoFor(meta, pick, publicFetch, Date.now() + 9_000);
console.log(`photo in ${Date.now() - t1} ms:`, photo);
