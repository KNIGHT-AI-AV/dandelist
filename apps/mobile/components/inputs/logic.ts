/**
 * The pure rules behind the input kit, with no React Native in them so vitest can check them: sign-in code
 * sanitising, live money formatting with caret maths, and the email check. The components in this folder call these.
 */

/* ------------------------------------------------------------------------------------------------ code */

/** Sign-in codes are six digits (the API's email code). */
export const CODE_LENGTH = 6;

/** Eastern Arabic and Persian digits, which some SMS and mail clients send, read as 0-9. */
function westernDigits(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Digits only (full-width and Arabic-Indic digits count), capped at `length`. */
export function sanitizeCode(text: string, length = CODE_LENGTH): string {
  return westernDigits(text).replace(/\D/g, "").slice(0, length);
}

/** A run of exactly `length` digits standing on its own ("Your code is 123456."). */
function standaloneRun(text: string, length: number): string | null {
  return text.match(new RegExp(`(?<!\\d)\\d{${length}}(?!\\d)`))?.[0] ?? null;
}

/**
 * The code after an edit of the one hidden input. Typing appends a digit. A paste or autofill that carries a whole
 * code wins over the digits already there, and a code inside a sentence is found ("Your code is 123456.").
 */
export function nextCode(prev: string, raw: string, length = CODE_LENGTH): string {
  const text = westernDigits(raw);
  const run = standaloneRun(text, length);
  if (run) return run;
  // A paste lands after the digits already typed (the caret is held at the end): take the pasted code alone.
  if (prev && text.startsWith(prev)) {
    const added = text.slice(prev.length);
    if (sanitizeCode(added, Infinity).length >= length) return standaloneRun(added, length) ?? sanitizeCode(added, length);
  }
  return sanitizeCode(text, length);
}

/* ----------------------------------------------------------------------------------------------- money */

/** The largest amount a money field takes: $999,999,999.99, so anything from a billion up is refused. */
export const MONEY_MAX_CENTS = 99_999_999_999;
const PREFIX = "$";

/** What a money field holds: digits with at most one "." and two decimals, e.g. "12500", "29.9", "12.". */
export type MoneyRaw = string;
export interface Selection {
  start: number;
  end: number;
}
export interface MoneyEdit {
  raw: MoneyRaw;
  /** The display text, "$12,500". Empty when nothing is entered, so the placeholder shows. */
  text: string;
  /** Where the caret goes in `text`. */
  caret: number;
  cents: number | null;
  /** The edit was refused because the amount would pass the cap; `text` is the previous text. */
  over: boolean;
}

/** "$" and the whole part grouped by thousands, then the decimals exactly as typed: "12500.5" → "$12,500.5". */
export function moneyText(raw: MoneyRaw): string {
  if (!raw) return "";
  const [whole = "", frac] = raw.split(".");
  const grouped = (whole || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${PREFIX}${grouped}${frac === undefined ? "" : `.${frac}`}`;
}

/** Cents for a raw amount; null when the field is empty. */
export function rawToCents(raw: MoneyRaw): number | null {
  if (!raw) return null;
  return Math.round(Number(raw.endsWith(".") ? raw.slice(0, -1) || "0" : raw) * 100);
}

/** The raw text for a stored amount: 250000 → "2500", 2999 → "29.99". */
export function centsToRaw(cents: number | null): MoneyRaw {
  if (cents === null || !Number.isFinite(cents) || cents < 0) return "";
  const c = Math.round(cents);
  return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2);
}

const isRawChar = (ch: string) => ch === "." || (ch >= "0" && ch <= "9");

/** The raw characters (digits and ".") in a display string. */
function rawOf(text: string): MoneyRaw {
  return [...text].filter(isRawChar).join("");
}

/** How many raw characters sit before display position `pos`. */
function rawIndex(text: string, pos: number): number {
  let n = 0;
  for (let i = 0; i < pos && i < text.length; i++) if (isRawChar(text[i]!)) n++;
  return n;
}

/** Cents for what a money field shows ("$12,500" → 1250000); null when empty. */
export function textCents(text: string): number | null {
  return rawToCents(rawOf(text));
}

/** The display position just after the `k`-th raw character (just after "$" for k = 0). */
export function displayCaret(text: string, k: number): number {
  if (!text) return 0;
  if (k <= 0) return text.startsWith(PREFIX) ? PREFIX.length : 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (isRawChar(text[i]!) && ++n === k) return i + 1;
  }
  return text.length;
}

/**
 * Turns typed or pasted characters into raw ones. One typed "." or "," is the decimal point (a European keypad
 * shows ","). In a paste, "," before exactly three digits groups thousands ("12,500"), otherwise the last "," is
 * the decimal point ("12,50"). `hasPoint` drops any point when the amount already has one.
 */
function cleanInserted(inserted: string, hasPoint: boolean): string {
  let s = westernDigits(inserted).replace(/[^\d.,]/g, "");
  if (inserted.length === 1) s = s.replace(",", ".");
  // "1.250,50": dots group and the comma is the point.
  else if (s.includes(".") && s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(/,(?=[^,]*$)/, ".").replace(/,/g, "");
  else if (s.includes(".")) s = s.replace(/,/g, "");
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
  else {
    const last = s.lastIndexOf(",");
    if (last >= 0) s = `${s.slice(0, last).replace(/,/g, "")}.${s.slice(last + 1).replace(/,/g, "")}`;
  }
  const first = s.indexOf(".");
  if (first >= 0) s = hasPoint ? s.replace(/\./g, "") : s.slice(0, first + 1) + s.slice(first + 1).replace(/\./g, "");
  return s;
}

/** Leading zeros go ("007" → "7", ".5" → "0.5"), decimals stop at two; the caret moves with what it sat after. */
function normalize(raw: string, caret: number): { raw: MoneyRaw; caret: number } {
  let r = raw;
  let c = caret;
  if (r.startsWith(".")) {
    r = `0${r}`;
    c += 1;
  }
  const lead = r.match(/^0+(?=\d)/)?.[0].length ?? 0;
  if (lead) {
    r = r.slice(lead);
    c = Math.max(0, c - Math.min(lead, c));
  }
  const point = r.indexOf(".");
  if (point >= 0 && r.length - point - 1 > 2) r = r.slice(0, point + 3);
  return { raw: r, caret: Math.min(c, r.length) };
}

/** Where an edit happened: the replaced range of `prev` and the text put there. */
function locate(prev: string, next: string, sel?: Selection): { from: number; to: number; inserted: string } {
  const fits = (from: number, to: number) => {
    const insLen = next.length - (prev.length - (to - from));
    if (from < 0 || to > prev.length || insLen < 0) return null;
    if (next.slice(0, from) !== prev.slice(0, from) || next.slice(from + insLen) !== prev.slice(to)) return null;
    return { from, to, inserted: next.slice(from, from + insLen) };
  };
  if (sel) {
    // The selection before the edit says where it happened, which plain diffing can't when digits repeat.
    const hit = fits(sel.start, sel.end) ?? (sel.start === sel.end ? fits(sel.start - 1, sel.start) ?? fits(sel.start, sel.start + 1) : null);
    if (hit) return hit;
  }
  let a = 0;
  while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
  let b = 0;
  while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
  return { from: a, to: prev.length - b, inserted: next.slice(a, next.length - b) };
}

/**
 * One edit of a money field. `prevText` is what the field showed (always our own format), `nextText` what the
 * input reports after the keystroke or paste, `sel` the selection before it. Returns the new display text and
 * where the caret belongs, so typing in the middle of "$12,500" keeps the caret after the new digit.
 */
export function editMoney(prevText: string, nextText: string, sel?: Selection, maxCents = MONEY_MAX_CENTS): MoneyEdit {
  const prevRaw = rawOf(prevText);
  const { from, to, inserted } = locate(prevText, nextText, sel);
  let rawFrom = rawIndex(prevText, from);
  const rawTo = rawIndex(prevText, to);
  // Deleting only a "," or the "$" deletes the digit before it, as in any formatted field.
  if (!inserted && to > from && rawFrom === rawTo && rawFrom > 0) rawFrom -= 1;
  const kept = prevRaw.slice(0, rawFrom) + prevRaw.slice(rawTo);
  const ins = cleanInserted(inserted, kept.includes("."));
  const { raw, caret } = normalize(prevRaw.slice(0, rawFrom) + ins + prevRaw.slice(rawTo), rawFrom + ins.length);
  const cents = rawToCents(raw);
  if (cents !== null && cents > maxCents) {
    return { raw: prevRaw, text: prevText, caret: Math.min(to, prevText.length), cents: rawToCents(prevRaw), over: true };
  }
  const text = moneyText(raw);
  return { raw, text, caret: displayCaret(text, caret), cents, over: false };
}

/* ----------------------------------------------------------------------------------------------- email */

/** Looks like a whole address: something, "@", a domain with a dot and a two-letter-or-longer ending. */
export function isEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(text.trim());
}

/** How long after a send a change that restates the sent words is taken for iOS handing them back, not typing. */
export const ECHO_MS = 1000;

/** True when `next` is the sent text coming back (an autocorrection may have changed a word): its opening matches. */
export function echoes(next: string, sent: string): boolean {
  const a = next.trim().toLowerCase();
  const b = sent.trim().toLowerCase();
  if (!a || !b) return false;
  const head = Math.min(12, b.length);
  return a.slice(0, head) === b.slice(0, head) && Math.abs(a.length - b.length) <= 4;
}
