import type { Period } from "@dandelist/cost";
import type { MediaImage } from "./index";

/**
 * The dream builder's wire contract, shared by the API (apps/api/src/dream) and the app (app/dream.tsx).
 * A chat turn streams events; the agent's tools surface as widgets the app renders (generative UI).
 */

/** Where someone wants to live. Regional things (homes, staff, services, utilities, taxes) are priced here. */
export interface LifeContext {
  home: { country: string; region?: string; city?: string; label: string } | null;
  currency: string;
  household?: { adults: number; children: number };
}

/** One line of what it costs to keep something, with the evidence behind it. */
export interface KeepLine {
  label: string;
  amountCents: number;
  period: Period;
  /** How it was worked out, e.g. "0.42% of $8.5M a year (Malta property tax)". */
  basis: string;
  source?: { url: string; checkedAt: string };
  estimate: boolean;
}

export interface Listing {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  url: string;
  source: string;
  images: MediaImage[];
  /** Short facts the swipe card shows, e.g. "5 bedrooms", "Sea view", "Pool". */
  facts: string[];
  region?: string;
}

export type Widget =
  | {
      kind: "home_builder";
      id: string;
      region: string;
      styles: { id: string; label: string; imageUrl?: string }[];
      features: { id: string; label: string; on: boolean }[];
      bedrooms: number | null;
      budgetCents: number | null;
    }
  | {
      kind: "car_builder";
      id: string;
      steps: { id: string; title: string; choices: { id: string; label: string; priceCents?: number; imageUrl?: string; detail?: string }[]; selected?: string }[];
    }
  | { kind: "deck"; id: string; title: string; round: number; cards: Listing[] }
  | { kind: "service_quote"; id: string; service: string; region: string; summary: string; lines: KeepLine[]; images: MediaImage[] }
  | { kind: "region_picker"; id: string; current: LifeContext["home"] }
  | {
      kind: "wish_ready";
      id: string;
      wish: {
        name: string;
        kind: "buy" | "do" | "visit" | "own";
        upfrontCents: number;
        keep: KeepLine[];
        region?: string;
        seller?: string;
        url?: string;
        checkedAt?: string;
        status: "verified" | "estimate";
        images: MediaImage[];
      };
    };

/** What the app sends back: free text, or an answer to a widget. */
export type DreamAction =
  | { type: "message"; text: string }
  | { type: "builder"; widgetId: string; values: Record<string, unknown> }
  | { type: "swipe"; widgetId: string; listingId: string; verdict: "yes" | "no" }
  | { type: "search_now"; widgetId: string }
  | { type: "region"; home: NonNullable<LifeContext["home"]> };

export type DreamEvent =
  | { type: "text"; text: string }
  | { type: "step"; id: string; state: "running" | "done"; text: string }
  | { type: "widget"; widget: Widget }
  | { type: "life"; life: LifeContext }
  | { type: "error"; message: string }
  | { type: "done"; sessionId: string };
