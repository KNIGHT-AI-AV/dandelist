import { toMediaImage, type Archive } from "../archive/archive";
import { FALLBACK_LINE, cleanLine, type Draft, type Meta } from "./agent";
import type { Media } from "./media";
import { findPhoto, type FoundPhoto, type PhotoPlan, type PhotoSubject } from "./photos";
import { within } from "./time";
import { fxRate, type Fetcher } from "./tools";

/**
 * The card for a wish no shop prices (owner, 2026-10-30, after typing "Money" as a first wish: "for money spawn a
 * slider for people to say how much money", "Make up clever values for things that have no value. Or put infinity").
 * Money itself becomes an amount the person picks, starting at what the wish names; a priceless wish shows infinity
 * and the line the model wrote for it when it read the wish. Neither runs a price hunt.
 */
export type WorthCard =
  | { worth: "money"; title: string; kind: Draft["kind"]; amountCents?: number }
  | { worth: "priceless"; title: string; kind: Draft["kind"]; line: string };

/** The most an amount may be: the wishes API's own ceiling, ten billion dollars in US cents. */
const MAX_CENTS = 1_000_000_000_000;

/** The amount a money wish names, in US cents at today's rate. None when it names none or no rate comes in time. */
export async function namedCents(d: Pick<Draft, "amount" | "currency">, fetcher: Fetcher, ms = 3_000): Promise<number | undefined> {
  if (!d.amount || !(d.amount > 0)) return undefined;
  const fx = await within(fxRate(d.currency, "USD", fetcher), ms).catch(() => null);
  if (!fx) return undefined;
  const cents = Math.round(d.amount * fx.rate * 100);
  return cents > 0 ? Math.min(cents, MAX_CENTS) : undefined;
}

/** The card for a money or priceless draft; null for one a shop prices. */
export async function worthCard(d: Draft, fetcher: Fetcher): Promise<WorthCard | null> {
  if (d.worth === "money") {
    const amountCents = await namedCents(d, fetcher);
    return { worth: "money", title: d.title, kind: d.kind, ...(amountCents ? { amountCents } : {}) };
  }
  // A draft sent back by an app carries its own line; one without gets the fallback, never a price hunt.
  if (d.worth === "priceless") return { worth: "priceless", title: d.title, kind: d.kind, line: cleanLine(d.line) ?? FALLBACK_LINE };
  return null;
}

/** What a money wish shows: gold bars, which read as money in any currency. */
export const MONEY_SUBJECT: PhotoSubject = { title: "Gold bars", kind: "buy", summary: "Stacked gold bullion bars" };

/** The photo plan for money, fixed, so the hunt spends nothing on planning it. */
export const MONEY_PLAN: PhotoPlan = {
  identity: "Gold bullion bars",
  lookalikes: ["Gold coins", "Brass or copper ingots", "Gold jewellery"],
  exact: false,
  official: "",
  articles: ["Gold bar"],
  commons: "Gold bars",
  web: "gold bullion bars photograph",
  kind: "product",
};

/** How long a found money photo serves every money wish; a hunt that found none is not repeated for a while. */
const KEEP_MS = 12 * 60 * 60_000;
const MISS_MS = 30 * 60_000;

let held: { photo: FoundPhoto | null; at: number } | null = null;
let hunting: Promise<FoundPhoto | null> | null = null;

/** Forgets the held money photo (tests). */
export function forgetMoneyPhoto(): void {
  held = null;
  hunting = null;
}

/**
 * A checked photograph for money: the archive's, when it holds gold bars, else the photo hunt's pick, which passed
 * the same two looks as every wish's photo. One is found once and serves every money wish for half a day, so most
 * money wishes cost nothing here. Null when none passes by `by`; the card then shows its own panel. The caller keeps
 * `meta` working until this settles: a hunt already under way is shared with money wishes that arrive meanwhile.
 */
export async function moneyPhoto(meta: Meta, ctx: { fetcher: Fetcher; archive?: Archive; by: number }): Promise<FoundPhoto | null> {
  const now = Date.now();
  if (held && now - held.at < (held.photo ? KEEP_MS : MISS_MS)) return held.photo;
  const pending: Promise<FoundPhoto | null> =
    hunting ??
    (hunting = (async (): Promise<FoundPhoto | null> => {
      const hit = await ctx.archive?.lookup(MONEY_SUBJECT.title, "product").catch(() => null);
      if (hit?.photos[0]) return { image: toMediaImage(hit.photos[0]), kind: "product", how: "commons" };
      return findPhoto(meta, MONEY_SUBJECT, { fetcher: ctx.fetcher, plan: Promise.resolve(MONEY_PLAN), by: ctx.by });
    })()
      .catch(() => null)
      .then((photo) => {
        held = { photo, at: Date.now() };
        hunting = null;
        return photo;
      }));
  return within(pending, ctx.by - Date.now());
}

/** A found photo as the app saves it with a wish. */
export const photoMedia = (f: FoundPhoto): { imageUrl: string; media: Media } => ({ imageUrl: f.image.url, media: { kind: f.kind, images: [f.image] } });
