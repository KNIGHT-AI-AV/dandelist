import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shop hostnames resolve to a public documentation address, so no test touches real DNS.
vi.mock("node:dns/promises", async (importOriginal) => ({ ...(await importOriginal<object>()), lookup: async () => [{ address: "93.184.215.14", family: 4 }] }));
import type { Meta, Step } from "../src/agent/agent";
import { huntWish, type HuntResult } from "../src/agent/find";
import { imageResponse, jpegHeader, pngHeader } from "./images";

/**
 * The fast card's photo follows it (live hunts, 2026-10-31: fast cards at 13 to 22 s, full cards at 52 to 54 s). A fast
 * card that went out without a photo goes again the moment the hunt's own checked pick lands, while the hunt runs; never
 * after the full card.
 */

const SHOP = "https://www.jeweller.example/rolex-submariner-date";
const PHOTO = "https://upload.wikimedia.org/rolex-submariner-date-126610ln.jpg";
const THUMB = "https://upload.wikimedia.org/thumb/rolex-submariner-date-126610ln.jpg";

const fakeWeb = (async (input: string | URL) => {
  const u = String(input);
  // The shop's page prices it, but its only picture is the shop's logo: the fast card goes without a photo.
  if (u === SHOP) {
    return new Response(`<html><head><title>Rolex Submariner Date | Fine Jeweller</title><meta property="og:image" content="/static/logo.png"></head><body><p>Rolex Submariner Date, new. Our price: $10,500.</p></body></html>`, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  if (u.endsWith("/static/logo.png")) return imageResponse(pngHeader(600, 200), "image/png");
  if (u === PHOTO || u === THUMB) return imageResponse(jpegHeader(3000, 2000), "image/jpeg");
  if (u.startsWith("https://commons.wikimedia.org/")) {
    return Response.json({
      query: {
        pages: {
          5: {
            pageid: 5,
            index: 1,
            title: "File:Rolex Submariner Date 126610LN.jpg",
            imageinfo: [{ width: 3000, height: 2000, mime: "image/jpeg", url: PHOTO, thumburl: THUMB, extmetadata: { Artist: { value: "A. Photographer" }, LicenseShortName: { value: "CC BY-SA 4.0" } } }],
          },
        },
      },
    });
  }
  if (u.startsWith("https://api.frankfurter.dev/")) return Response.json({ date: "2026-10-30", rates: { USD: 1 } });
  return new Response("gone", { status: 404, headers: { "content-type": "text/html" } });
}) as unknown as typeof fetch;

type Body = Record<string, any>;
const result = (text: string, raw: unknown = {}) => ({
  id: `r${Math.random().toString(36).slice(2, 8)}`,
  text,
  citations: [],
  functionCalls: [],
  searchQueries: [],
  usage: { model: "muse-spark-1.3", inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, searches: 0 },
  costUsd: 0.001,
  raw,
});

const DRAFT = { title: "Rolex Submariner Date", kind: "buy", summary: "A Rolex Submariner Date in steel.", specifics: [], region: "US", currency: "USD", unknowns: [], typical: 0 };

/** Every model call of one hunt. The photo checks wait for `photos`, and the research's answer for `answer`. */
function huntMeta(photos: Promise<void>, answer: Promise<void>): Meta {
  return {
    responses: async (b: Body) => {
      const format = b.text?.format?.name;
      const instructions = String(b.instructions ?? "");
      if (format === "photo_check") {
        await photos;
        return result(JSON.stringify({ seen: "the very thing wished for", fits: ["A"], quality: "studio", clean: true })) as never;
      }
      if (instructions.startsWith("You find the best photograph of one wish")) return result("Nothing found.") as never;
      if (format === "wish_draft") return result(JSON.stringify(DRAFT)) as never;
      if (format === "wish_questions") return result(JSON.stringify({ questions: [] })) as never;
      if (instructions.startsWith("You find, fast")) {
        return result(`${SHOP} | $10,500 | USD`, { output: [{ type: "web_search_call", action: { query: "rolex submariner date price" }, results: [{ url: SHOP, title: "Rolex Submariner Date | Fine Jeweller" }] }] }) as never;
      }
      if (instructions.startsWith("You are Dandelist's price researcher")) return result("Done.") as never;
      if (format === "price_options") {
        await answer;
        return result(JSON.stringify({ options: [], note: "", media: { kind: "product", subject: "Rolex Submariner Date", generation: "", noun: "watch" } })) as never;
      }
      return result("The jeweller's listing is the one.") as never;
    },
  };
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { opened, open };
}

beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-31T08:00:00Z") }));
afterEach(() => vi.useRealTimers());

const base = () => ({ onStep: (_s: Step) => undefined, now: () => new Date(), fetcher: fakeWeb, homeCurrency: "USD" });

describe("the fast card's photo", () => {
  it("follows the card as soon as the hunt's checked pick lands, while the research is still out", async () => {
    const photos = gate();
    const answer = gate();
    const sent: HuntResult[] = [];
    let ended = false;
    const hunt = huntWish(huntMeta(photos.opened, answer.opened), { ...base(), text: "A Rolex Submariner date in steel", onProvisional: (r) => void sent.push(structuredClone(r)) });
    void hunt.then(() => (ended = true));
    // The photo checks are slow, so the fast card goes out first, priced, with no photo yet.
    await vi.advanceTimersByTimeAsync(12_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.provisional).toBe(true);
    expect(sent[0]!.options[0]).toMatchObject({ url: SHOP, upfrontCents: 1_050_000 });
    expect(sent[0]!.options[0]!.imageUrl).toBeUndefined();
    // The checks pass: the same card goes again with the photo, the hunt still running.
    photos.open();
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.provisional).toBe(true);
    expect(sent[1]!.options).toHaveLength(1);
    expect(sent[1]!.options[0]).toMatchObject({ url: SHOP, upfrontCents: 1_050_000, imageUrl: expect.stringMatching(/^https:\/\/upload\.wikimedia\.org\//) });
    expect(ended).toBe(false);
    answer.open();
    await vi.advanceTimersByTimeAsync(60_000);
    const done = await hunt;
    expect(done.provisional).toBe(false);
    expect(done.options[0]).toMatchObject({ url: SHOP, imageUrl: sent[1]!.options[0]!.imageUrl });
    // Nothing provisional after the full card.
    expect(sent).toHaveLength(2);
  });

  it("never goes after the full card: a pick that lands once the hunt has settled rides on the full card only", async () => {
    const photos = gate();
    const answer = gate();
    const sent: HuntResult[] = [];
    let ended = false;
    const hunt = huntWish(huntMeta(photos.opened, answer.opened), { ...base(), text: "A Rolex Submariner date in steel", onProvisional: (r) => void sent.push(structuredClone(r)) });
    void hunt.then(() => (ended = true));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(sent).toHaveLength(1);
    // The research answers first, and the hunt settles while the photo search is still out.
    answer.open();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(ended).toBe(false);
    photos.open();
    await vi.advanceTimersByTimeAsync(100);
    const done = await hunt;
    expect(sent).toHaveLength(1);
    expect(done.provisional).toBe(false);
    expect(done.options[0]).toMatchObject({ url: SHOP, imageUrl: expect.stringMatching(/^https:\/\/upload\.wikimedia\.org\//) });
  });

  it("goes once when the photo search finds nothing (control)", async () => {
    const answer = gate();
    const sent: HuntResult[] = [];
    // Every photo check fails: no stand-in, no pick.
    const meta = huntMeta(Promise.resolve(), answer.opened);
    const failing: Meta = {
      responses: async (b: Body) => (b.text?.format?.name === "photo_check" ? (result(JSON.stringify({ seen: "something else", fits: [], quality: "studio", clean: true })) as never) : meta.responses(b as never)),
    };
    const hunt = huntWish(failing, { ...base(), text: "A Rolex Submariner date in steel", onProvisional: (r) => void sent.push(structuredClone(r)) });
    await vi.advanceTimersByTimeAsync(12_000);
    answer.open();
    await vi.advanceTimersByTimeAsync(60_000);
    const done = await hunt;
    expect(sent).toHaveLength(1);
    expect(sent[0]!.options[0]!.imageUrl).toBeUndefined();
    expect(done.provisional).toBe(false);
  });
});
