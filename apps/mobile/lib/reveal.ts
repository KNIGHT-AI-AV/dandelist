import { entries, heroFor } from "@dandelist/catalogue";
import type { Step } from "./agent";
import { hostOf } from "./words";

/**
 * The wait while the agent prices a wish (owner, 2026-10-28): the card's space is carved out, pictures shuffle behind a
 * blur that clears as the agent finds the real thing, and its reasoning reads live. This file decides what to show;
 * components/wish-reveal.tsx draws it.
 */

type WishKind = "buy" | "do" | "visit" | "own";

/** Most real finds the shuffle cycles through, and how many it needs before the design pictures step aside. */
const DECK_MAX = 8;
const REAL_ENOUGH = 3;
/** Blur in points at zero clarity, and the step it moves in, so a sharpening picture redraws a few times rather than every tick. */
export const MAX_BLUR = 28;
const BLUR_STEP = 4;

/** Design pictures to dream on before the agent has found anything: real catalogue photos of the same kind of wish. */
export function moodFor(kind: WishKind | undefined, aspect: number): string[] {
  const travel = kind === "visit" || kind === "do";
  const same = entries.filter((e) => (travel ? e.kind === "visit" : e.kind !== "visit"));
  return unique((same.length ? same : entries).map((e) => heroFor(e, aspect)));
}

/** Pictures on the pages the agent opened, newest first, each once. */
export function foundImages(steps: Step[]): string[] {
  return unique(steps.flatMap((s) => (s.type === "open" && s.ok && s.imageUrl ? [s.imageUrl] : [])).reverse());
}

/** A picture in the shuffle. Design pictures are not the wish, so they never come into focus. */
export interface Card {
  uri: string;
  real: boolean;
}

/** The least blur a design picture ever shows: enough that a car or a room reads as colour and light, not as a thing. */
export const MOOD_BLUR = 24;

/** The shuffle: real finds first, then design pictures until there are enough real ones to stand alone. */
export function deckFor(steps: Step[], kind: WishKind | undefined, aspect: number): Card[] {
  const found = foundImages(steps);
  const mood = found.length >= REAL_ENOUGH ? [] : moodFor(kind, aspect).filter((u) => !found.includes(u));
  return [...found.map((uri) => ({ uri, real: true })), ...mood.map((uri) => ({ uri, real: false }))].slice(0, DECK_MAX);
}

/** The blur for one card: a real find follows the clarity, a design picture never drops below MOOD_BLUR. */
export const cardBlur = (card: Card, clarity: number) => (card.real ? blurFor(clarity) : Math.max(MOOD_BLUR, blurFor(clarity)));

/** How clear the picture is, 0 to 1. Each real find and each checked price sharpens it; only the finished answer is fully clear. */
export function clarityOf(steps: Step[], done: boolean): number {
  if (done) return 1;
  const checks = steps.filter((s) => s.type === "check" || s.type === "price").length;
  return Math.min(0.8, 0.1 + 0.2 * foundImages(steps).length + 0.1 * checks);
}

/** How sharply the blur falls as clarity rises: above 1, design pictures stay dreamy and real finds clear quickly. */
const FOCUS_CURVE = 1.6;

/** The blur to draw at a clarity, in steps of BLUR_STEP. */
export const blurFor = (clarity: number) => Math.round((Math.pow(1 - Math.min(1, Math.max(0, clarity)), FOCUS_CURVE) * MAX_BLUR) / BLUR_STEP) * BLUR_STEP;

/** What the agent is doing, in one line, for steps that carry no thought of their own. */
export function lineFor(s: Step): string | null {
  switch (s.type) {
    case "search":
      return /^\d+ web search/.test(s.query) ? "Searching the web" : `Searching for ${s.query}`;
    case "open":
      return s.ok ? `Reading ${hostOf(s.url)}` : `${hostOf(s.url)} wouldn't open, so I'm trying elsewhere`;
    case "check":
      return s.verified ? `The price is printed on ${hostOf(s.url)}` : s.listed ? `${hostOf(s.url)} lists it in today's shop results` : `${hostOf(s.url)} didn't show the price, so that one stays an estimate`;
    case "fx":
      return `Converting ${s.from} to ${s.to}`;
    case "price":
      return `Priced ${s.label}`;
    case "explain":
      return "Working out what it costs to keep";
    case "note":
      return s.text;
  }
}

/** A thought stays up until two newer steps have passed, so it can be read; otherwise the newest step speaks. */
const THOUGHT_HOLD = 2;

/** The line to show now: the agent's own thought when it is fresh, else what the newest step is doing. */
export function thoughtOf(steps: Step[]): { text: string; mine: boolean } | null {
  const t = steps.findLastIndex((s) => s.type === "note" && s.event?.kind === "thought");
  if (t >= 0 && t >= steps.length - 1 - THOUGHT_HOLD) return { text: (steps[t] as Extract<Step, { type: "note" }>).text, mine: true };
  for (let i = steps.length - 1; i >= 0; i--) {
    // The server writes each step's line now; older runs carry none, so the app's own wording stands in.
    const line = steps[i]!.line || lineFor(steps[i]!);
    if (line) return { text: line, mine: false };
  }
  return null;
}

function unique(urls: (string | undefined)[]): string[] {
  return [...new Set(urls.filter((u): u is string => !!u))];
}
