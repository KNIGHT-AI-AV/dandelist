import type { Period } from "@dandelist/cost";
import type { WishKind } from "./wishes";

/** Shapes the API's wish agent returns. The app shows these numbers; it never asks the model for one. */

export interface Draft {
  title: string;
  kind: WishKind;
  summary: string;
  specifics: { name: string; value: string }[];
  region: string;
  currency: string;
  unknowns: string[];
}

export interface Question {
  question: string;
  choices: string[];
}

export interface Answer {
  question: string;
  answer: string;
}

/**
 * What the shopping and media tools did. These arrive as "note" steps carrying an `event`, so a ledger that only
 * knows notes still shows their text; switch on `event.kind` to draw a richer line.
 */
export type AgentEvent =
  /** Searched shops: one Google Shopping search and how many offers came back. */
  | { kind: "shop"; query: string; offers: number }
  /** Looked for 3D models on Sketchfab. */
  | { kind: "search3d"; query: string; found: number }
  /** Found photos for an option: how many, and the best one's size and source. */
  | { kind: "photos"; label: string; count: number; best?: { width: number; height: number; source: string } }
  /** Found a 3D model that truly matches. */
  | { kind: "model3d"; name: string; author: string }
  /** Image work with Meta's models: a SAM 3.1 cutout, a Muse Image upscale or a generated fallback picture. */
  | { kind: "imagework"; how: "cutout" | "upscaled" | "generated"; label: string; ok: boolean }
  /** The agent's own one-line reason for what it does next. */
  | { kind: "thought"; text: string };

export type Step =
  | { type: "search"; query: string; at: string }
  | { type: "open"; url: string; title?: string; ok: boolean; imageUrl?: string; at: string }
  | { type: "fx"; from: string; to: string; rate?: number; at: string }
  /** `listed`: not confirmed on the seller's page, but a named merchant lists it at this price in today's shopping search. */
  | { type: "check"; url: string; verified: boolean; listed?: boolean; at: string }
  | { type: "price"; label: string; upfrontCents?: number; at: string }
  | { type: "explain"; at: string }
  | { type: "note"; text: string; event?: AgentEvent; at: string };

export type MediaKind = "product" | "vehicle" | "place" | "experience" | "other";

export interface MediaImage {
  url: string;
  width?: number;
  height?: number;
  /** Where it came from: a site like leica-camera.com, "Google Shopping", "commons.wikimedia.org" or "Meta Muse Image". */
  source: string;
  credit?: string;
  license?: string;
  /** Transparent or cut-out background. */
  clean?: boolean;
  /** Made or reworked by Muse Image: label it as generated. */
  generated?: boolean;
}

export interface Model3d {
  provider: "sketchfab";
  uid: string;
  name: string;
  author: string;
  license: string;
  /** Sketchfab player: autostart, dark theme, transparent background, no hint (the app draws its own). */
  embedUrl: string;
  thumbnail: string;
}

/** The product lifted out of a real photo by SAM 3.1, as a transparent PNG. */
export interface Cutout {
  url: string;
  width: number;
  height: number;
  /** The real photo it was cut from. */
  from: string;
  model: "sam-3.1";
}

/** Real photos first, best first. Save it with the wish as details.agent.media. */
export interface Media {
  kind: MediaKind;
  images: MediaImage[];
  model3d?: Model3d;
  cutout?: Cutout;
}

/** One part of a trip's price, such as the flights or the nights at a hotel, priced on its own page. */
export interface PricePart {
  label: string;
  kind: "flight" | "lodging" | "other";
  seller: string;
  url: string;
  /** One night, one traveller's fare, or the whole party's fare. */
  unitCents: number;
  quantity: number;
  unit: "night" | "person" | "trip";
  /** unitCents × quantity. */
  totalCents: number;
  source: { currency: string; price: number; rate: number; rateDate: string };
  status: "verified" | "estimate";
  statusLabel: string;
  evidence: string;
}

export interface PriceOption {
  label: string;
  seller: string;
  url: string;
  /** For a trip, the sum of its parts. */
  upfrontCents: number;
  recurring: { label: string; amountCents: number; period: Period }[];
  source: { currency: string; price: number; rate: number; rateDate: string };
  /**
   * verified only when the price was read on a page whose host belongs to the seller (for a trip, every part was);
   * everything else is an estimate.
   */
  status: "verified" | "estimate";
  /**
   * Honest, ready-to-show words for where the price came from: "Checked on leica-camera.com", "Checked on Adorama
   * via shopping search" (a named merchant's listing today; its page unchecked), "Estimate: seen on someblog.com,
   * not Herman Miller's own site", "2 of 2 parts checked on the sellers' sites", or "Estimate".
   */
  statusLabel: string;
  /** Present when the price is a merchant's listing in today's shopping search. */
  listing?: { merchant: string; title: string; condition?: "new" | "used" | "refurbished" };
  /** Trips only: flights, nights × nightly rate and so on, each with its own source. */
  parts?: PricePart[];
  evidence: string;
  confidence: "high" | "medium" | "low";
  imageUrl?: string;
  media?: Media;
  checkedAt: string;
  totals: { monthlyCents: number; horizonCents: number; spreadMonthlyCents: number };
}

export interface Run {
  id: string;
  status: "running" | "done" | "error";
  steps: Step[];
  result: { options: PriceOption[]; explanation: string; note: string; horizonYears: number } | null;
  error: string | null;
  cached?: boolean;
  createdAt: string;
}

type Api = (path: string, init?: RequestInit) => Promise<Response>;

async function read<T>(res: Response | null, fallback: string): Promise<T> {
  if (!res) throw new Error("Can't reach Dandelist. Check your connection.");
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? fallback);
  return body;
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export async function interpretWish(api: Api, text: string) {
  return read<{ draft: Draft; questions: Question[] }>(await api("/agent/interpret", json({ text })).catch(() => null), "Couldn't read that wish. Try again.");
}

/** Say your wish: the recorded clip (a 16 kHz mono WAV) in, the words Muse Voice Transcribe heard out. */
export async function transcribeWish(api: Api, wav: Uint8Array) {
  const init: RequestInit = { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav as unknown as BodyInit };
  return (await read<{ text: string }>(await api("/agent/transcribe", init).catch(() => null), "Couldn't hear that. Try again, or type it.")).text;
}

export async function startResearch(api: Api, draft: Draft, answers: Answer[]) {
  return (await read<{ run: Run }>(await api("/agent/runs", json({ draft, answers })).catch(() => null), "Couldn't start the research.")).run;
}

export async function getRun(api: Api, id: string) {
  return (await read<{ run: Run }>(await api(`/agent/runs/${id}`).catch(() => null), "Lost track of the research.")).run;
}
