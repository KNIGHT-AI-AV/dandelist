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
