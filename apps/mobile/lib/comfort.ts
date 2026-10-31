import { annualRecurringCents, loanPaymentCents, type Recurring } from "@dandelist/cost";
import type { PoolGroup } from "./welcome";
import type { Wish, WishKind } from "./wishes";

/**
 * "What would it take?" (owner, 2026-10-28: "this is not a savings app... it's a wish list"). A fader of incomes a
 * year; for each, a face and a line say how comfortably that income carries everything on the list. Nothing here is a
 * budget or a date: a year's income over what the list needs picks one of six stages (owner, 2026-10-29: "horrid,
 * upset, normal, smile, big smile, ritzy rich"). The fader runs from $10,000 to $100 million, and further either way
 * when a list needs it, so the far left is always horrid and the far right always ritzy.
 *
 * What a list needs (owner, 2026-10-30: "If I add two watches that equal $75,000 and $80,000 salary shouldn't be
 * enough... It needs to be very, very intelligent with the price matrix"): each wish may take only the share of a
 * year's gross income its kind of purchase comfortably takes, and the needs add up. The describe call judges that
 * share for each saved wish like an accountant would (owner, 2026-10-30: "what percentage of their annual salary that
 * is reasonable to pay for said thing"); the matrix below stands in until it has, and for the welcome's cards. Either
 * way, every sum is done here, never by a model.
 */
export const INCOME_MIN = 1_000_000; // $10,000
export const INCOME_MAX = 10_000_000_000; // $100,000,000

const LADDER = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5];

/**
 * The notches the fader lands on, in US cents: a 1, 1.5, 2, 2.5, 3, 4, 5, 7.5 ladder in each decade of the shown
 * currency, so the notches read as round numbers there (€250,000; ¥25,000,000 with a unit of 100). `rate` is units
 * of that currency per dollar. Away from dollars the cents are fractional on purpose: converting back lands exactly
 * on the round figure.
 */
export function incomeSteps(rate = 1, unit = 1, range?: { low: number; high: number }): number[] {
  // Whole decades of the shown currency, wide enough for the range (in US cents) when one is given.
  const low = Math.min(INCOME_MIN * unit, range ? 10 ** Math.floor(Math.log10(range.low * rate)) : Infinity);
  const top = Math.max(INCOME_MAX * unit, range ? 10 ** Math.ceil(Math.log10(range.high * rate)) : 0);
  return ladderSteps(rate, low, top);
}

/**
 * The ladder's notches in US cents, from `low` up to `top`: both in the shown currency's cents and each a power of
 * ten. The income fader and the money wish's amount slider both count on it.
 */
export function ladderSteps(rate: number, low: number, top: number): number[] {
  const out: number[] = [];
  for (let decade = low; decade < top; decade *= 10) for (const m of LADDER) out.push(Math.round(decade * m) / rate);
  out.push(top / rate);
  return rate === 1 ? out.map(Math.round) : out;
}

/** The dollar notches. */
export const INCOME_STEPS: number[] = incomeSteps();

/** Position on the fader (0 to 1) for an income, on a log scale so $50k and $50M both get room. */
export function fractionOf(cents: number, steps: readonly number[] = INCOME_STEPS): number {
  const lo = steps[0]!;
  const hi = steps[steps.length - 1]!;
  return Math.log(Math.max(lo, Math.min(hi, cents)) / lo) / Math.log(hi / lo);
}

/** The notch nearest a position. */
export function incomeAt(fraction: number, steps: readonly number[] = INCOME_STEPS): number {
  const f = Math.max(0, Math.min(1, fraction));
  let best = steps[0]!;
  for (const s of steps) if (Math.abs(fractionOf(s, steps) - f) < Math.abs(fractionOf(best, steps) - f)) best = s;
  return best;
}

/* ---------- the price matrix ---------- */

/** The kind of purchase a wish is, in the describe call's words (apps/api/src/describe.ts keeps the same list). */
export type Category = "thing" | "experience" | "trip" | "vehicle" | "home" | "service" | "money";
/** How it is paid for: all at once, over four years (a car), or a mortgage on 80% of it over thirty years (a home). */
export type Financing = "cash" | "loan" | "mortgage";
export const CATEGORIES: readonly Category[] = ["thing", "experience", "trip", "vehicle", "home", "service", "money"];
export const FINANCINGS: readonly Financing[] = ["cash", "loan", "mortgage"];

/**
 * The rules of thumb, by kind of purchase: how it is usually paid for, the share of a year's gross income that a year
 * of paying for it may comfortably take, and the share its running costs may take. Things (and money itself): about a
 * month's pay. Trips and experiences: a tenth. Vehicles: the 20/4/10 and 35% car rules. Homes: the 28% front-end
 * mortgage rule. Staff, memberships and services, and the running costs of things, trips and experiences: a tenth.
 */
const MATRIX: Record<Category, { financing: Financing; share: number; keepShare: number }> = {
  thing: { financing: "cash", share: 0.08, keepShare: 0.1 },
  money: { financing: "cash", share: 0.08, keepShare: 0.1 },
  experience: { financing: "cash", share: 0.1, keepShare: 0.1 },
  trip: { financing: "cash", share: 0.1, keepShare: 0.1 },
  service: { financing: "cash", share: 0.1, keepShare: 0.1 },
  vehicle: { financing: "loan", share: 0.12, keepShare: 0.12 },
  home: { financing: "mortgage", share: 0.28, keepShare: 0.28 },
};
/** A loan spreads the price over four years (the 20/4/10 rule's four). */
const LOAN_YEARS = 4;
/** A mortgage on 80% of the price at 6.5% over thirty years: about 6.07% of the price a year, by the cost engine. */
const MORTGAGE_PER_YEAR = 12 * loanPaymentCents(0.8, 0.065, 360);
/** A home's upkeep when none is recorded: tax, insurance and maintenance come to about 1.5% of its price a year. */
const HOME_UPKEEP = 0.015;
/** An owned wish nothing marks as a vehicle or a home is a vehicle under $2 million, and a home from there. */
const HOME_FROM = 200_000_000;
/** A judged share is kept within these, whatever it says (the describe call clamps it too). */
export const SHARE_MIN = 0.02;
export const SHARE_MAX = 0.35;
/** A list that adds up to nothing still needs a little, so the fader and its faces have somewhere to stand. */
const MIN_NEED = 100_00;

/**
 * One wish as the sum reads it: its kind of purchase, its price, a year of its running costs (US cents) and, when the
 * describe call judged it, how it is paid for and the share of income it may take.
 */
export interface ComfortEntry {
  category: Category;
  upfrontCents: number;
  recurringPerYearCents: number;
  judged?: { financing: Financing; share: number };
}

/** A year of paying a price: all of it in cash, a quarter on a loan, the payments on a mortgage. */
const yearOf = (cents: number, financing: Financing) => (financing === "loan" ? cents / LOAN_YEARS : financing === "mortgage" ? cents * MORTGAGE_PER_YEAR : cents);

/** The income a year one wish needs to be comfortable, in US cents: each part of its yearly cost over its share. */
export function needFor(e: ComfortEntry): number {
  const rule = MATRIX[e.category];
  const keep = e.category === "home" && e.recurringPerYearCents <= 0 ? e.upfrontCents * HOME_UPKEEP : e.recurringPerYearCents;
  return yearOf(e.upfrontCents, e.judged?.financing ?? rule.financing) / (e.judged?.share ?? rule.share) + keep / (e.judged?.share ?? rule.keepShare);
}

/** What a list needs: the income each wish needs, added up (a priceless wish is null and adds nothing). */
export function needOf(entries: readonly (ComfortEntry | null)[]): number {
  return entries.reduce((sum, e) => sum + (e ? needFor(e) : 0), 0);
}

/* ---------- wishes as the sum reads them ---------- */

type Owned = "vehicle" | "home";

/** Running costs only a home carries (the dream builder's keep lines: property tax, home insurance, utilities, HOA). */
const HOME_COSTS = /\b(?:property|council|land) tax|\bhome insurance|\bhomeowner|\bhoa\b|\bservice charge|\bstrata\b|\bground rent|\butilit|\bcondo fee|\bmortgage/i;
/** Running costs only a car, boat or plane carries (the car builder's: fuel or charging, registration and road licence). */
const VEHICLE_COSTS = /\bfuel\b|\bpetrol\b|\bdiesel\b|\bcharging\b|\bregistration\b|\broad (?:tax|licen[cs]e)|\btyres?\b|\btires?\b|\bmooring|\bmarina\b|\bberth|\bdockage\b|\bhangar|\bcrew\b|\bcaptain\b|\bparking\b|\b(?:car|auto|motor) insurance/i;
/** A name that says home, in the words the server's agent goes by (apps/api/src/agent/quick.ts, HOME). */
const HOME_WORDS = /\b(?:villa|house|home|apartment|flat|penthouse|condo|estate|mansion|cottage|chalet|farmhouse|bedroom|property|loft|townhouse)s?\b/i;

interface Evidence {
  name?: string;
  kind: WishKind;
  upfrontCents: number;
  recurringPerYearCents: number;
  worth?: string;
  /** What its photos show (details.agent.media.kind): a vehicle, or a place, which an owned wish is when it's a home. */
  media?: string;
  /** What the welcome's pool calls it. */
  hint?: Owned;
  labels: (string | undefined)[];
}

/** A vehicle or a home, by the best evidence an owned wish carries: its photos, the pool, its running costs, its name. */
function ownedOf(e: Evidence): Owned | null {
  if (e.media === "vehicle") return "vehicle";
  if (e.media === "place") return "home";
  if (e.hint) return e.hint;
  const costs = e.labels.filter(Boolean).join(", ");
  const home = HOME_COSTS.test(costs);
  if (home !== VEHICLE_COSTS.test(costs)) return home ? "home" : "vehicle";
  return e.name && HOME_WORDS.test(e.name) ? "home" : null;
}

/** The matrix's kind of purchase for a wish the describe call hasn't judged. */
function categoryOf(e: Evidence): Category {
  if (e.worth === "money") return "money";
  if (e.kind === "own") return ownedOf(e) ?? (e.upfrontCents < HOME_FROM ? "vehicle" : "home");
  // A car listed as bought rather than owned (the catalogue's Porsche 911, the title's hero) is still a car.
  if (e.kind === "buy" && (e.media === "vehicle" || e.hint === "vehicle")) return "vehicle";
  // Staff, memberships and services: nothing to buy, only running costs.
  if (e.upfrontCents <= 0 && e.recurringPerYearCents > 0) return "service";
  return e.kind === "visit" ? "trip" : e.kind === "do" ? "experience" : "thing";
}

/** The describe call's judgment of a wish, when it holds one the sum can use: a known kind and way to pay, a share kept within reason. */
export function judgedOf(comfort: unknown): { category: Category; financing: Financing; share: number } | null {
  if (!comfort || typeof comfort !== "object") return null;
  const { category, financing, share } = comfort as Record<string, unknown>;
  if (!CATEGORIES.includes(category as Category) || !FINANCINGS.includes(financing as Financing)) return null;
  if (typeof share !== "number" || !Number.isFinite(share) || share <= 0) return null;
  return { category: category as Category, financing: financing as Financing, share: Math.min(SHARE_MAX, Math.max(SHARE_MIN, share)) };
}

/**
 * A saved wish as the sum reads it: the describe call's judgment when it has one, the matrix otherwise. Null for a
 * priceless wish, which no total counts (lib/worth.ts).
 */
export function wishEntry(w: Pick<Wish, "name" | "kind" | "item" | "details">): ComfortEntry | null {
  const worth = w.details?.worth;
  if (worth === "priceless") return null;
  const upfrontCents = w.item.upfrontCents;
  const recurringPerYearCents = annualRecurringCents(w.item.recurring);
  const judged = judgedOf(w.details?.comfort);
  if (judged) return { category: judged.category, upfrontCents, recurringPerYearCents, judged: { financing: judged.financing, share: judged.share } };
  const labels = w.item.recurring.map((r) => r.label);
  return { category: categoryOf({ name: w.name, kind: w.kind, upfrontCents, recurringPerYearCents, worth, media: w.details?.agent?.media?.kind, labels }), upfrontCents, recurringPerYearCents };
}

/** A welcome card (a pick from the pool, a card made from the first wish, the first wish itself) or a catalogue entry. */
export interface PoolCard {
  name: string;
  kind: WishKind;
  category?: string;
  group?: PoolGroup;
  upfrontCents: number;
  recurring: Recurring[];
  media?: { kind: string };
  worth?: "money" | "priceless";
}

/** A welcome card as the sum reads it, by the matrix (no describe call has judged it yet). Null when it's priceless. */
export function poolEntry(e: PoolCard): ComfortEntry | null {
  if (e.worth === "priceless") return null;
  const recurringPerYearCents = annualRecurringCents(e.recurring);
  // The pool's own word: "drive" is a car; "live" in the home group is a home or land. The first wish's card carries a
  // stand-in category ("live" for anything owned, in the things group), so "live" counts only with the group.
  const hint: Owned | undefined = e.category === "drive" ? "vehicle" : e.category === "live" && e.group === "home" ? "home" : undefined;
  const labels = e.recurring.map((r) => r.label);
  return { category: categoryOf({ name: e.name, kind: e.kind, upfrontCents: e.upfrontCents, recurringPerYearCents, worth: e.worth, media: e.media?.kind, hint, labels }), upfrontCents: e.upfrontCents, recurringPerYearCents };
}

/**
 * True when the describe call should judge a wish (again): it holds no judgment the sum can use, or one made for
 * another tier, since how much the wish is wanted moves the share. A priceless wish is never in the sum.
 */
export function unjudged(w: Pick<Wish, "tier" | "details">): boolean {
  if (w.details?.worth === "priceless") return false;
  return !judgedOf(w.details?.comfort) || w.details?.comfort?.tier !== w.tier;
}

/* ---------- the faces ---------- */

export interface Stage {
  /** 0 to 5: horrid, upset, normal, smile, big smile, ritzy rich. */
  index: number;
  line: string;
}

/** A year's income over what the list needs: below these, the stage before. "Comfortably" starts where the two meet. */
const BOUNDS = [0.15, 0.4, 1, 4, 12];
const LINES = [
  "Out of reach for now",
  "A real stretch",
  "Doable, if you're careful",
  "You could comfortably afford this",
  "You could very much afford this",
  "You wouldn't notice the bill",
];
export const STAGES = LINES.length;
/** The stage that reads "comfortably". */
export const COMFORTABLE = 3;

const floored = (needCents: number) => Math.max(needCents, MIN_NEED);

export function stageOf(incomeCents: number, needCents: number): Stage {
  const ratio = incomeCents / floored(needCents);
  // A hair of tolerance so an income computed for a stage (comfortableIncome) lands in it despite rounding.
  const index = BOUNDS.filter((b) => ratio >= b - 1e-9).length;
  return { index, line: LINES[index]! };
}

/**
 * The income a year that carries everything on the list comfortably (owner, recording 03: "the estimated annual
 * income needed to comfortably afford everything"): the need, rounded up to two significant figures so it reads as
 * an estimate. $75,000 of watches needs $937,500, which reads $940,000.
 */
export function comfortableIncome(needCents: number): number {
  const exact = floored(needCents);
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(exact)) - 1);
  return Math.ceil(exact / magnitude - 1e-9) * magnitude;
}

/** Match the list's estimate until someone chooses an income; an unpriced list keeps its existing fallback. */
export function faderIncome({ needCents, selectedIncomeCents, hasPricedItems }: { needCents: number; selectedIncomeCents?: number; hasPricedItems: boolean }): number {
  return selectedIncomeCents ?? (hasPricedItems ? comfortableIncome(needCents) : startIncome(needCents));
}

/**
 * The incomes the fader must reach for a list (US cents): low enough that the far left reads horrid, high enough that
 * the far right reads ritzy, never narrower than $10,000 to $100 million.
 */
export function fullRange(needCents: number): { low: number; high: number } {
  const need = floored(needCents);
  return { low: Math.min(INCOME_MIN, need * BOUNDS[0]! * 0.5), high: Math.max(INCOME_MAX, need * BOUNDS[BOUNDS.length - 1]! * 1.5) };
}

/** A sensible starting income for a list: the first notch where it reads "comfortably", so the first face is a smile. */
export function startIncome(needCents: number, steps: readonly number[] = INCOME_STEPS): number {
  return steps.find((s) => s >= needCents) ?? steps[steps.length - 1]!;
}
