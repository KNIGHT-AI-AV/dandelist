import { formatCents } from "./money";
import type { PriceOption, Run, Step } from "./agent";
import { webOnly } from "./dream";
import type { Wish, WishDetails } from "./wishes";
import { hostOf, whenChecked } from "./words";

/** Pure helpers for "Check the price again" on the wish page. No React, so tests can load them. */

/** How often a running check is polled; the new-wish screen polls at the same pace. */
export const POLL_MS = 1500;

export type Direction = "down" | "up" | "same";

/**
 * When the saved price was checked, as it reads after "since" or "as": "earlier today", "yesterday", or a short
 * date ("Oct 27") for anything older, because "since 3 days ago" doesn't read. Null when the date is unreadable.
 */
export function sinceWhen(checkedAt: string, now = new Date()): string | null {
  const then = new Date(checkedAt);
  if (Number.isNaN(then.getTime())) return null;
  const w = whenChecked(checkedAt, now);
  if (w === "today") return "earlier today";
  if (w === "yesterday") return w;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The new price against the saved one, in a few plain words: "Down $120 since Oct 27", "Same price as yesterday". */
export function priceChange(oldCents: number, newCents: number, checkedAt: string, now = new Date()): { direction: Direction; deltaCents: number; text: string } {
  const deltaCents = Math.round(newCents) - Math.round(oldCents);
  const when = sinceWhen(checkedAt, now);
  if (deltaCents === 0) return { direction: "same", deltaCents, text: when ? `Same price as ${when}` : "Same price" };
  const direction: Direction = deltaCents < 0 ? "down" : "up";
  const words = `${direction === "down" ? "Down" : "Up"} ${formatCents(Math.abs(deltaCents))}`;
  return { direction, deltaCents, text: when ? `${words} since ${when}` : words };
}

/** One agent step as the ledger words it: a verb, then the detail it acted on. */
export function stepLine(s: Step): { verb: string; detail: string } {
  switch (s.type) {
    case "search":
      return { verb: "Searched", detail: s.query };
    case "open":
      return { verb: s.ok ? "Opened" : "Couldn't open", detail: hostOf(s.url) };
    case "fx":
      return { verb: "Converted", detail: `${s.from} to ${s.to}` };
    case "check":
      return { verb: s.verified ? "Checked" : "Couldn't confirm", detail: hostOf(s.url) };
    case "price":
      return { verb: "Priced", detail: s.upfrontCents != null ? `${s.label} · ${formatCents(s.upfrontCents)}` : s.label };
    case "explain":
      return { verb: "Summing up", detail: "comparing the options" };
    case "note":
      return { verb: "", detail: s.text };
  }
}

/** Elapsed time as the research clock shows it: "0:07", "1:42". */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The option to compare against: the same seller's site when the agent found it again (so the change is the
 * listing's own), otherwise the agent's top pick.
 */
export function pickOption(options: PriceOption[], savedUrl?: string): PriceOption | undefined {
  const host = savedUrl ? hostOf(savedUrl) : "";
  return (host ? options.find((o) => hostOf(o.url) === host) : undefined) ?? options[0];
}

export interface PricePatch {
  upfrontCents: number;
  recurring?: { amountCents: number; period: PriceOption["recurring"][number]["period"]; label: string }[];
  details: WishDetails;
}

/**
 * The PATCH body for "Use the new price": the new figure and where it came from. The wish keeps its name, tier and
 * saved photos (the new option's pictures only fill a gap), and keeps its running costs unless the agent itemised
 * new ones.
 */
export function newPricePatch(wish: Pick<Wish, "details">, run: Pick<Run, "id" | "result">, option: PriceOption): PricePatch {
  const saved = wish.details.agent;
  const imageUrl = saved?.imageUrl || webOnly(option.imageUrl);
  const media = saved?.media ?? option.media;
  return {
    upfrontCents: option.upfrontCents,
    ...(option.recurring.length ? { recurring: option.recurring.map((r) => ({ amountCents: r.amountCents, period: r.period, label: r.label.slice(0, 60) })) } : {}),
    details: {
      ...wish.details,
      agent: {
        runId: run.id,
        seller: option.seller,
        url: webOnly(option.url),
        status: option.status,
        checkedAt: option.checkedAt,
        ...(imageUrl ? { imageUrl } : {}),
        ...(media ? { media } : {}),
        explanation: run.result?.explanation || saved?.explanation || "",
        source: option.source,
      },
    },
  };
}

/**
 * The PATCH body for a wish the person told the Dandy more about ("the black dial, not the green"): the thing itself
 * may have changed, so it takes the new name and the new find's own pictures, not only its price. Its tier stays.
 */
export function amendPatch(wish: Pick<Wish, "details">, run: Pick<Run, "id" | "result">, option: PriceOption, name: string): PricePatch & { name: string } {
  const base = newPricePatch({ details: { ...wish.details, agent: undefined } }, run, option);
  return { ...base, name: name.trim().slice(0, 200) };
}
