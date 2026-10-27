/**
 * Walks the live dream builder end to end, signed in as the judge account: a single item hands off to the item
 * research, and a described home goes builder, search, deck, pick, priced wish. Prints every event. Spends about
 * $0.7 of Meta credit per home run; "item" alone spends cents.
 * Usage: API_URL=https://api.dandelist.knightaiav.com pnpm --filter @dandelist/infra-aws exec tsx dream-smoke.ts [item] [home]
 */
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { DreamAction, DreamEvent, Widget } from "../../packages/catalogue/src/dream";
import { credentials, region } from "./creds";

const base = process.env.API_URL;
if (!base) throw new Error("Set API_URL to the service URL");
const which = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ["item", "home"]);

const code = (await new SecretsManagerClient({ region, credentials }).send(new GetSecretValueCommand({ SecretId: "dandelist/api/judge-code" }))).SecretString!;
const post = (path: string, body: unknown, token?: string) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
await post("/auth/email/start", { email: "judge@dandelist.com" });
const signIn = await post("/auth/email/verify", { email: "judge@dandelist.com", code });
if (signIn.status !== 200) throw new Error(`judge sign-in failed: ${signIn.status}`);
const token = ((await signIn.json()) as { accessToken: string }).accessToken;

/** One turn: posts the action, prints each streamed event, returns the session and the widgets it showed. */
async function turn(sessionId: string | null, action: DreamAction): Promise<{ sessionId: string | null; widgets: Widget[] }> {
  const started = Date.now();
  const res = await post("/dream/turn", { sessionId, action }, token);
  if (!res.ok || !res.body) throw new Error(`turn ${action.type}: ${res.status} ${await res.text()}`);
  const widgets: Widget[] = [];
  let session = sessionId;
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const data = buffer.slice(0, cut).split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      buffer = buffer.slice(cut + 2);
      if (!data) continue;
      const e = JSON.parse(data) as DreamEvent;
      if (e.type === "done") session = e.sessionId;
      if (e.type === "widget") widgets.push(e.widget);
      const brief = e.type === "widget" ? summary(e.widget) : JSON.stringify(e);
      console.log(`  [${((Date.now() - started) / 1000).toFixed(1)}s] ${e.type}: ${brief.slice(0, 300)}`);
    }
  }
  return { sessionId: session, widgets };
}

function summary(w: Widget): string {
  switch (w.kind) {
    case "deck":
      return `deck ${w.id}, ${w.cards.length} cards: ${w.cards.map((c) => `${c.title} ${c.currency} ${c.priceCents / 100} ${c.status ?? ""}`).join(" | ")}`;
    case "wish_ready":
      return `wish ${w.wish.name}, ${w.wish.currency} ${w.wish.upfrontCents / 100}, toUsd ${JSON.stringify(w.wish.toUsd)}, keep ${w.wish.keep.map((k) => `${k.label} ${k.amountCents / 100}/${k.period}`).join(", ")}`;
    case "home_builder":
      return `home_builder ${w.id} in ${w.region}: styles ${w.styles.map((s) => `${s.label}${s.on ? "*" : ""}`).join(", ")}; features ${w.features.filter((f) => f.on).map((f) => f.label).join(", ")}`;
    default:
      return JSON.stringify(w);
  }
}

if (which.has("item")) {
  console.log("ITEM: a Leica Q3");
  const r = await turn(null, { type: "message", text: "a Leica Q3" });
  if (!r.widgets.some((w) => w.kind === "item")) console.log("  !! no item hand-off");
}

if (which.has("home")) {
  console.log("HOME: a modern sea-view villa in Malta with a pool");
  let r = await turn(null, { type: "message", text: "I want to live in Malta, in a modern sea-view villa with a pool" });
  const builder = r.widgets.find((w) => w.kind === "home_builder");
  if (!builder) throw new Error("no home builder");
  r = await turn(r.sessionId, { type: "search_now", widgetId: builder.id });
  const deck = r.widgets.find((w): w is Extract<Widget, { kind: "deck" }> => w.kind === "deck");
  if (!deck?.cards.length) throw new Error("no deck");
  r = await turn(r.sessionId, { type: "pick", widgetId: deck.id, listingId: deck.cards[0]!.id });
  if (!r.widgets.some((w) => w.kind === "wish_ready")) console.log("  !! no priced wish");
}
