import type { Item, Period } from "@dandelist/cost";
import checked from "./catalogue.json";

/**
 * The pre-login catalogue: real things with real prices. Each entry was priced by the Meta wish agent on the
 * seller's own page (or marked an estimate when no page could confirm it) and keeps its source and check time,
 * which the cards show. `infra/aws/catalogue.ts` rebuilds `catalogue.json` from `seeds`.
 */

export type Category = "drive" | "capture" | "wear" | "travel" | "move" | "live";

export interface Seed {
  id: string;
  /** What the agent is asked to price. */
  ask: string;
  name: string;
  kind: "buy" | "do" | "visit" | "own";
  category: Category;
}

export interface MediaImage {
  url: string;
  width?: number;
  height?: number;
  source: string;
  credit?: string;
  license?: string;
  clean?: boolean;
  generated?: boolean;
  /** Smaller copies of this same photo, narrowest first, for screens that show it smaller (see sizedFor). */
  variants?: { width: number; height: number; url: string }[];
}

export interface Entry extends Seed {
  upfrontCents: number;
  recurring: { label: string; amountCents: number; period: Period }[];
  status: "verified" | "estimate";
  seller: string;
  url: string;
  checkedAt: string;
  imageUrl?: string;
  media?: {
    kind: "product" | "vehicle" | "place" | "experience" | "other";
    images: MediaImage[];
    model3d?: { provider: "sketchfab"; uid: string; name: string; author: string; license: string; embedUrl: string; thumbnail: string };
    cutout?: { url: string; width: number; height: number; from: string; model: "sam-3.1" };
  };
}

/** The photograph to lead with: the first real (not generated) one, since images are kept best first; else the price page's. */
export function heroOf(e: Pick<Entry, "media" | "imageUrl">): string | undefined {
  const all = e.media?.images ?? [];
  return (all.find((i) => !i.generated) ?? all[0])?.url ?? e.imageUrl;
}

/**
 * The real photograph whose shape is closest to the frame's (width / height), so a tall card and a wide card each get
 * a version composed for them instead of a crop that cuts the subject. Ties go to the earlier, better image. Given the
 * frame in pixels, the smallest copy of it that still covers the frame (sizedFor).
 */
export function heroFor(e: Pick<Entry, "media" | "imageUrl">, aspect: number, framePx?: { width: number; height: number }): string | undefined {
  const real = (e.media?.images ?? []).filter((i) => !i.generated && i.width && i.height);
  if (!real.length || !(aspect > 0)) return heroOf(e);
  const off = (i: MediaImage) => Math.abs(Math.log(i.width! / i.height! / aspect));
  const best = real.reduce((b, i) => (off(i) < off(b) - 0.05 ? i : b));
  // Covering the frame, the photo is as wide as the frame or as its height at the photo's own shape, whichever is more.
  return framePx ? sizedFor(best, Math.max(framePx.width, (framePx.height * best.width!) / best.height!)) : best.url;
}

/**
 * The smallest copy of a photo at least `need` pixels wide, else its widest: a phone isn't sent a 4K crop to show at a
 * third of the size (Lighthouse, 2026-10-30: the title photo was 924 KB, about 690 KB more than a phone shows).
 */
export function sizedFor(i: MediaImage, need?: number): string {
  if (!(need && need > 0) || !i.variants?.length || !i.width) return i.url;
  const all = [...i.variants, { width: i.width, height: i.height ?? 0, url: i.url }].sort((a, b) => a.width - b.width);
  return (all.find((v) => v.width >= need) ?? all[all.length - 1]!).url;
}

export const seeds: Seed[] = [
  { id: "porsche-911", ask: "A new Porsche 911 Carrera (current model year), US base price on porsche.com", name: "Porsche 911 Carrera", kind: "buy", category: "drive" },
  { id: "leica-q3", ask: "Leica Q3 camera, new, US price from Leica's own store", name: "Leica Q3", kind: "buy", category: "capture" },
  { id: "lisbon-month", ask: "A month living in Lisbon: round-trip flights from New York and a furnished one-bedroom apartment for a month", name: "A month in Lisbon", kind: "visit", category: "travel" },
  { id: "rolex-submariner", ask: "Rolex Submariner Date, steel, black dial, US retail price on rolex.com", name: "Rolex Submariner", kind: "buy", category: "wear" },
  { id: "kyoto-autumn", ask: "Two weeks in Kyoto in autumn: round-trip flights from New York and a good hotel", name: "Two weeks in Kyoto", kind: "visit", category: "travel" },
  { id: "peloton-bike-plus", ask: "Peloton Bike+ with the All-Access membership, US price on onepeloton.com", name: "Peloton Bike+", kind: "buy", category: "move" },
  { id: "rimowa-cabin", ask: "Rimowa Original Cabin suitcase in aluminium, US price on rimowa.com", name: "Rimowa Original Cabin", kind: "buy", category: "travel" },
  { id: "range-rover-sport", ask: "A new Range Rover Sport, US starting price on landroverusa.com", name: "Range Rover Sport", kind: "buy", category: "drive" },
  { id: "amalfi-week", ask: "A week on the Amalfi Coast in summer: round-trip flights from New York and a sea-view hotel in Positano", name: "A week in Positano", kind: "visit", category: "travel" },
  { id: "eames-lounge", ask: "Herman Miller Eames Lounge Chair and Ottoman, US price on hermanmiller.com", name: "Eames Lounge Chair", kind: "buy", category: "live" },
  { id: "vision-pro", ask: "Apple Vision Pro, US price on apple.com", name: "Apple Vision Pro", kind: "buy", category: "capture" },
];

export const entries: Entry[] = checked as Entry[];

const byId = new Map(entries.map((e) => [e.id, e]));
export function entry(id: string): Entry | undefined {
  return byId.get(id);
}

/** Step 2: one you'd say yes to. */
export const firstPick = ["porsche-911", "leica-q3", "lisbon-month"];

/** Step 3: four this-or-that rounds, each crossing categories and price bands. */
export const pairs: [string, string][] = [
  ["rolex-submariner", "kyoto-autumn"],
  ["peloton-bike-plus", "rimowa-cabin"],
  ["range-rover-sport", "amalfi-week"],
  ["eames-lounge", "vision-pro"],
];

export function toItem(e: Entry): Item {
  return { id: e.id, upfrontCents: e.upfrontCents, recurring: e.recurring.map(({ amountCents, period, label }) => ({ amountCents, period, label })) };
}
