import { priceMentions } from "./tools";

const PERSON = "(?:persons?|people|adults?|children|child|guests?|heads?|pax|passengers?|travell?ers?|participants?)";
const AFTER = new RegExp("^\\s*(?:(?:per|a|each|/)\\s*" + PERSON + "\\b|p\\.?p\\.?(?![a-z])|pax\\b)", "i");
const BEFORE = new RegExp("\\b(?:per|each)\\s+" + PERSON + "(?:\\s+guests?)?\\s*[:=]?\\s*$", "i");
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

/**
 * Explicit person-unit wording next to this amount, not a party-count guess or a multiplier.
 * A separate total stays usable. Conflicting same-amount wording stays held, even beside generic markup.
 * This text guard does not interpret structured-only units or establish that an unmarked amount is a total.
 */
export function personPrice(text: string, amount: number, currency?: string): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  return priceMentions(text, amount).some((m) => {
    const leading = LEADING_CURRENCY.exec(m.before);
    const trailing = TRAILING_CURRENCY.exec(m.after);
    // Skip actual currency marks, never arbitrary three-letter words such as "and".
    const before = leading && currencyMark(leading[2]) ? m.before.slice(0, leading.index + leading[1]!.length) : m.before;
    const after = trailing && currencyMark(trailing[1]) ? m.after.slice(trailing[0].length) : m.after;
    if (!AFTER.test(after) && !BEFORE.test(before)) return false;
    const codes = [namedCurrency(leading?.[2]), namedCurrency(trailing?.[1])].filter(Boolean);
    // An explicitly different currency's quote does not contradict this amount in the selected currency.
    return !currency || !codes.length || codes.some((code) => code === currency.toUpperCase());
  });
}

const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const countOf = (word: string) => COUNT_WORDS[word] ?? Number(word);
const HEADS = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:adults?|people|persons?|guests?|travell?ers?|passengers?|kids?|children|child|teens?|seniors?|pax|of us)\b/g;
const FAMILY = /\b(?:family|group|party) of (\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/;
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

/**
 * The party a wish is for, when it says, so a per-person quote is priced for the people going (the owner's list,
 * 2026-10-29: per-person prices were being shown as totals). The answer to a "how many people" question counts
 * first, then a detail the reading named, then the wish's own words. Null when nothing states it: a per-person quote
 * is then held, as before.
 */
export function partyOf(draft: { questions?: { id: string; label: string; picked: string }[]; specifics: { name: string; value: string }[]; summary?: string } | null | undefined, words = ""): number | null {
  const fromField = (name: string, value: string) => (PEOPLE_FIELD.test(name) ? (headcount(value) ?? (/^\s*\d{1,2}\s*$/.test(value) ? Number(value) : null)) : null);
  const found =
    draft?.questions?.map((q) => fromField(`${q.id} ${q.label}`, q.picked)).find((n) => n !== null) ??
    draft?.specifics.map((s) => fromField(s.name, s.value)).find((n) => n !== null) ??
    headcount(words) ??
    (draft?.summary ? headcount(draft.summary) : null);
  return found && found >= 1 && found <= 90 ? found : null;
}
