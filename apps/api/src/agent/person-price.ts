import { priceMentions } from "./tools";

const PERSON = "(persons?|people|adults?|children|child|guests?|heads?|pax|passengers?|travell?ers?|participants?)";
const AFTER = new RegExp("^\\s*(?:(?:per|a|each|/)\\s*" + PERSON + "\\b|p\\.?p\\.?(?![a-z])|pax\\b)", "i");
const BEFORE = new RegExp("\\b(?:per|each)\\s+" + PERSON + "(?:\\s+guests?)?\\s*[:=]?\\s*$", "i");
/**
 * A time unit in the same clause just after a quote or its person unit ("per person per month", "/person/night",
 * "per adult guest per month", "USD 150/month"): a recurring charge.
 */
const PER_TIME = /^[^.;\n]{0,30}?(?:\b(?:per|a|each|every)\s+|\/\s*)(?:month|mo|week|wk|year|yr|day|night|nt|hour|hr|session|lesson|class)\b/i;
/** "Monthly" and the like count only right after the quote: "including daily breakfast" is no billing period. */
const TIME_WORD = /^\s*,?\s*(?:monthly|weekly|nightly|daily|yearly|annually|hourly)\b/i;
const RECURRING = { test: (s: string) => PER_TIME.test(s) || TIME_WORD.test(s) };
/** A separate rate for children named anywhere in the text. */
const CHILD_RATE = /\b(?:per|each|a|\/)\s*(?:child|children|kids?|infants?|teens?|youths?)\b|\b(?:child|children'?s?|kids?'?|infant|youth|junior)\s+(?:prices?|rates?|tickets?|fares?)\b/i;

/** Who a quoted unit is for: an adult, a child, or any person. */
type Tier = "adult" | "child" | "person";
const tierOf = (word: string | undefined): Tier => (!word ? "person" : /^adults?$/i.test(word) ? "adult" : /^(?:children|child)$/i.test(word) ? "child" : "person");
const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));
const SYMBOLS: Record<string, string> = { "US$": "USD", "CA$": "CAD", "C$": "CAD", "AU$": "AUD", "A$": "AUD", "NZ$": "NZD", "CN¥": "CNY", "€": "EUR", "£": "GBP" };
const MARK = "(?:[A-Z]{3}(?![A-Z])|US\\$|CA\\$|C\\$|AU\\$|A\\$|NZ\\$|CN¥|[€£$¥])";
const LEADING_CURRENCY = new RegExp("(^|[^A-Z])(" + MARK + ")\\s*$", "i");
const TRAILING_CURRENCY = new RegExp("^\\s*(" + MARK + ")", "i");

function namedCurrency(mark: string | undefined): string | undefined {
  const value = mark?.toUpperCase();
  return value ? (CURRENCIES.has(value) ? value : SYMBOLS[value]) : undefined;
}

const currencyMark = (mark: string | undefined) => !!namedCurrency(mark) || mark === "$" || mark === "¥";

/** Each place the text states this amount with a person unit beside it: who the unit is for, and whether it recurs. */
function personQuotes(text: string, amount: number, currency?: string): { tier: Tier; recurring: boolean }[] {
  if (!Number.isFinite(amount) || amount <= 0) return [];
  // A wide enough window to see a period after a compound unit ("per adult guest per month").
  return priceMentions(text, amount, 48).flatMap((m) => {
    const leading = LEADING_CURRENCY.exec(m.before);
    const trailing = TRAILING_CURRENCY.exec(m.after);
    // Skip actual currency marks, never arbitrary three-letter words such as "and".
    const before = leading && currencyMark(leading[2]) ? m.before.slice(0, leading.index + leading[1]!.length) : m.before;
    const after = trailing && currencyMark(trailing[1]) ? m.after.slice(trailing[0].length) : m.after;
    const unitAfter = AFTER.exec(after);
    const unitBefore = unitAfter ? null : BEFORE.exec(before);
    if (!unitAfter && !unitBefore) return [];
    const codes = [namedCurrency(leading?.[2]), namedCurrency(trailing?.[1])].filter(Boolean);
    // An explicitly different currency's quote does not contradict this amount in the selected currency.
    if (currency && codes.length && !codes.some((code) => code === currency.toUpperCase())) return [];
    const recurring = RECURRING.test(after) || (!!unitAfter && RECURRING.test(after.slice(unitAfter[0].length)));
    return [{ tier: tierOf((unitAfter ?? unitBefore)![1]), recurring }];
  });
}

/**
 * Explicit person-unit wording next to this amount, not a party-count guess or a multiplier.
 * A separate total stays usable. Conflicting same-amount wording stays held, even beside generic markup.
 * This text guard does not interpret structured-only units or establish that an unmarked amount is a total.
 */
export function personPrice(text: string, amount: number, currency?: string): boolean {
  return personQuotes(text, amount, currency).length > 0;
}

/**
 * Whether a per-person quote can be priced for a stated party by multiplying (Codex's review of #79, 2026-10-30):
 * every person-unit mention of the amount is a one-time price, never per month, night or session, and none is a
 * child's rate. An adult's rate counts only for a party of adults, and a party not stated as adults is held when the
 * text names a separate child rate. Anything else stays held.
 */
export function perPersonApplies(texts: string[], amount: number, currency: string | undefined, adultsOnly: boolean): boolean {
  const quotes = texts.flatMap((t) => personQuotes(t, amount, currency));
  if (!quotes.length || quotes.some((q) => q.recurring || q.tier === "child")) return false;
  if (adultsOnly) return true;
  return !quotes.some((q) => q.tier === "adult") && !texts.some((t) => CHILD_RATE.test(t));
}

const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const countOf = (word: string) => COUNT_WORDS[word] ?? Number(word);
const HEADS = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(adults?|people|persons?|guests?|travell?ers?|passengers?|kids?|children|child|teens?|seniors?|infants?|babies|pax|of us)\b/g;
const FAMILY = /\b(?:family|group|party) of (\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/;
/** People priced at a rate of their own: a party that counts them mixes tiers. */
const OWN_RATE = /^(?:kids?|children|child|teens?|seniors?|infants?|babies)$/;
// "for 4" counts people, never "for 4 nights" or "for 2 hours".
const FOR_N = /\bfor (\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?!\s*(?:nights?|days?|hours?|hrs?|weeks?|months?|years?|minutes?|mins?|courses?|sessions?|lessons?|rounds?|%))/;
const TWO = /\b(?:couple|pair|the two of us|both of us|(?:my|our) (?:wife|husband|partner|girlfriend|boyfriend|fianc[eé]e?) and (?:me|i))\b/;
const ONE = /\b(?:just (?:me|you)|only me|solo|by myself|on my own|alone|one person)\b/;

/**
 * How many people a stated party adds up to, from plain words: "2 adults, 2 children" is 4, "a couple" is 2, "just
 * me" is 1, "for 4" is 4 (never "for 4 nights"). Null when the words don't say.
 */
export function headcount(text: string): number | null {
  const t = text.toLowerCase();
  let sum = 0;
  for (const m of t.matchAll(HEADS)) sum += countOf(m[1]!);
  if (sum > 0) return sum;
  const family = FAMILY.exec(t);
  if (family) return countOf(family[1]!);
  if (TWO.test(t)) return 2;
  if (ONE.test(t)) return 1;
  const forN = FOR_N.exec(t);
  return forN ? countOf(forN[1]!) : null;
}

const PEOPLE_FIELD = /\b(?:people|persons?|guests?|travell?ers?|passengers?|adults?|party|group|headcount|who'?s (?:going|coming)|how many)\b/i;
/** A field that counts people with a rate of their own ("children: 2", "kids", "seniors"). */
const OWN_RATE_FIELD = /\b(?:children|child|kids?|infants?|babies|seniors?|teens?)\b/i;

/** A stated party: how many people, and whether the words say they are all adults. */
export interface Party {
  count: number;
  adultsOnly: boolean;
}

/**
 * The party the words state, or "mixed" when they count children, seniors or a family (people who may be priced at
 * their own rate), or null when they don't say.
 */
function partyIn(text: string): Party | "mixed" | null {
  const t = text.toLowerCase();
  const groups = [...t.matchAll(HEADS)];
  if (groups.some((m) => OWN_RATE.test(m[2]!)) || /\bfamily of\b/.test(t)) return "mixed";
  const count = headcount(t);
  if (count === null) return null;
  const adultsOnly = groups.length ? groups.every((m) => /^adults?$/.test(m[2]!)) : TWO.test(t) || ONE.test(t);
  return { count, adultsOnly };
}

/**
 * The party a wish is for, when it says, so a per-person quote is priced for the people going (the owner's list,
 * 2026-10-29: per-person prices were being shown as totals). The answer to a "how many people" question counts
 * first, then a detail the reading named, then the wish's own words. Null when nothing states it, or when the party
 * mixes people who may be priced at their own rate: a per-person quote is then held, as #78 did.
 */
export function partyOf(draft: { questions?: { id: string; label: string; picked: string }[]; specifics: { name: string; value: string }[]; summary?: string } | null | undefined, words = ""): Party | null {
  const fromField = (name: string, value: string): Party | "mixed" | null => {
    // A field of its own for children or seniors ("children: 2", "kids: seven") mixes the party unless it plainly says
    // none: any other value holds the quote (Codex, #87 review: the count words one to twelve and anything unforeseen).
    if (OWN_RATE_FIELD.test(name)) return !value.trim() || /^\s*(?:0|none|no|zero|nobody|n\/a)\b/i.test(value) ? null : "mixed";
    if (!PEOPLE_FIELD.test(name)) return null;
    return partyIn(value) ?? (/^\s*\d{1,2}\s*$/.test(value) ? { count: Number(value), adultsOnly: false } : null);
  };
  // Every place the wish states its people is read: one that mixes tiers holds the quote, wherever it is.
  const all = [
    ...(draft?.questions ?? []).map((q) => fromField(`${q.id} ${q.label}`, q.picked)),
    ...(draft?.specifics ?? []).map((s) => fromField(s.name, s.value)),
    partyIn(words),
    draft?.summary ? partyIn(draft.summary) : null,
  ];
  if (all.includes("mixed")) return null;
  const found = all.find((p): p is Party => p !== null && p !== "mixed");
  return found && found.count >= 1 && found.count <= 90 ? found : null;
}
