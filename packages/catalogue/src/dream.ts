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
  /** "verified" when the price was read from the listing itself (its page or the portal's own data) at `checkedAt`. */
  status?: "verified" | "estimate";
  checkedAt?: string;
}

export type Widget =
  | {
      kind: "home_builder";
      id: string;
      region: string;
      /** `on` marks styles prefilled from the chat; `credit` is the reference photo's author and licence. */
      styles: { id: string; label: string; imageUrl?: string; on?: boolean; credit?: string }[];
      features: { id: string; label: string; on: boolean }[];
      bedrooms: number | null;
      budgetCents: number | null;
      /** Currency of `budgetCents` (the life context's currency). */
      currency?: string;
    }
  | {
      kind: "car_builder";
      id: string;
      steps: { id: string; title: string; choices: { id: string; label: string; priceCents?: number; imageUrl?: string; detail?: string; custom?: boolean }[]; selected?: string }[];
      /** Selected parts whose price is known, never a complete quote when unpriced is nonempty. */
      knownSubtotalCents?: number;
      unpriced?: string[];
      /** Currency of every `priceCents` above (the life context's currency). */
      currency?: string;
    }
  | { kind: "deck"; id: string; title: string; round: number; cards: Listing[] }
  | { kind: "service_quote"; id: string; service: string; region: string; summary: string; lines: KeepLine[]; images: MediaImage[]; currency?: string }
  | { kind: "region_picker"; id: string; current: LifeContext["home"] }
  /** A single thing to buy or do (a watch, a trip): handed to the item price research with the person's words. */
  | { kind: "item"; id: string; text: string }
  /**
   * A change to the person's own list that their Dandy suggests (owner, 2026-10-30: "change the list and manage list for
   * things like reorder"): the whole new order, tier moves and removals. Nothing changes until they tap Apply.
   */
  | { kind: "list_change"; id: string; title: string; order: string[]; tiers: { id: string; tier: "must" | "nice" | "dream" }[]; remove: string[] }
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
        /** Currency of `upfrontCents` and every keep line (the life context's currency, or the listing's when no rate exists). */
        currency?: string;
        /** One unit of `currency` in US dollars on `date`, so the app can store the wish in dollars. Absent for USD. */
        toUsd?: { rate: number; date: string };
      };
    };

/** What the app sends back: free text, or an answer to a widget. */
export type DreamAction =
  | { type: "message"; text: string }
  | { type: "builder"; widgetId: string; values: Record<string, unknown> }
  | { type: "swipe"; widgetId: string; listingId: string; verdict: "yes" | "no" }
  | { type: "search_now"; widgetId: string }
  /** Make a deck's listing the wish, or without listingId a service quote or car build; answers with wish_ready. */
  | { type: "pick"; widgetId: string; listingId?: string }
  | { type: "region"; home: NonNullable<LifeContext["home"]> };

export type DreamEvent =
  | { type: "text"; text: string }
  | { type: "step"; id: string; state: "running" | "done"; text: string }
  | { type: "widget"; widget: Widget }
  | { type: "life"; life: LifeContext }
  | { type: "error"; message: string }
  | { type: "done"; sessionId: string };
