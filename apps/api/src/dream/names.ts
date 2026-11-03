import { bareName } from "../agent/quick";
import type { CarBuildState } from "./types";

const MAX = 120;
/** Ends a cut name on a whole word, with no separator left dangling. */
const tidyEnd = (s: string) => {
  const cut = s.length > MAX ? s.slice(0, MAX).replace(/\s+\S*$/, "") : s;
  // A full stop can end an abbreviation ("Sq.Ft."), so only a dangling separator goes.
  return cut.replace(/[\s,;:–—-]+$/, "");
};

// A trailing " - " part that is only a listing number ("13248191", "Ref 48213", "MLS 4821377"), a site
// ("idealista.com", "13248191 LuxuryEstate.com") or a price ("1.045.000 €", "£1,045,000 GBP"). A part with a place,
// a ZIP code or a size in it ("Wimberley, TX 78676", "12345 Oak Street", "2,500 Sq.Ft.") is part of the name.
const NUMBER = /^\W*(?:(?:ref|id|mls|no|code)\b\.?\W*)?\d{5,}\W*$/i;
const SITE = /^(?:\W*\d{5,}\W+)?[\w-]+\.(?:com|net|org|io|co|es|fr|it|de|uk|pt|nl|ie|au|ca|mt|ch|at|be|se|no|dk|gr|ae|us|mx|br)(?:\.[a-z]{2})?\W*$/i;
// A price needs its currency, symbol or code, so a year ("Rolls-Royce Cullinan - 2024") stays.
const PRICE = /^\W*(?:[$£€¥]\s?\d[\d.,\s]*|\d[\d.,\s]*\s?(?:[$£€¥]|\b[A-Z]{3}\b)|[A-Z]{3}\s?\d[\d.,\s]*)\W*$/;
const SALE = /\(\s*(?:for sale|for rent|to rent)\s*\)|\b(?:for sale by owner|for sale|for rent|to rent)\b/gi;

/**
 * A wish's name from the listing it was picked from. Listing titles are written to sell and to rank, so the wish
 * would otherwise be called "Austin Luxury House for Sale | $1,045,000" (demo film, 2026-11-03): the site's
 * suffix and the price go (bareName), then "for sale" and any trailing number, site or price part. A title that is
 * only "For Sale" before its separator is named from the rest; one made of nothing else keeps its bare form.
 */
export function listingWishName(title: string): string {
  // bareName stops at 140 characters, which can cut a word; a name never ends on half of one.
  const cut = bareName(title);
  const bare = cut.length >= 140 ? cut.replace(/\s+\S*$/, "") : cut;
  const parts = bare
    .split(" - ")
    .map((p) => p.replace(SALE, " ").replace(/\(\s*\)|\[\s*\]/g, " ").replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim())
    .filter((p) => p && !/^[,.;:–—-]+$/.test(p));
  while (parts.length > 1 && [NUMBER, SITE, PRICE].some((re) => re.test(parts[parts.length - 1]!))) parts.pop();
  const name = tidyEnd(parts.join(" - ").replace(/^[\s,.;:–—-]+/, ""));
  if (name) return name;
  // "For Sale • 3 bed house in Austin": bareName keeps only the part before the separator, which said nothing.
  // Only a rest of two words or more: after "For Sale | " a single word is usually the site ("Zillow").
  const rest = title.split(/ [|–—•·] /).slice(1).join(" | ");
  return (rest.trim().split(/\s+/).length > 1 && rest !== title && listingWishName(rest)) || tidyEnd(bare);
}

/** Words for comparing names: lower case, accents gone ("ŠKODA" is "skoda"), split on anything but letters and digits. */
const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** The labels chosen on one step of a build, in the order the step lists them. */
const chosen = (b: CarBuildState, step: string) => {
  const s = b.steps.find((x) => x.id === step);
  return s ? s.choices.filter((c) => s.selected.includes(c.id)).map((c) => c.label.trim()).filter(Boolean) : [];
};

/** The trim's words that the model's name doesn't already end with ("911 Carrera S" after "Porsche 911 Carrera" is "S"). */
function trimAfter(model: string, trim: string): string {
  const tokens = trim.split(/\s+/).filter(Boolean);
  const key = (t: string) => words(t).join("");
  const m = model.split(/\s+/).map(key);
  const t = tokens.map(key);
  let k = Math.min(m.length, t.length);
  while (k > 0 && m.slice(m.length - k).join(" ") !== t.slice(0, k).join(" ")) k--;
  return tokens.slice(k).join(" ");
}

/**
 * A wish's name from a finished car build: the model, then whatever the trim adds to it, and the maker in front when
 * the label leaves it out. Colour, interior and options stay out of the name (they made "Porsche 911 Carrera, 911
 * Carrera, Contrasts, Ventilated Seats (Front)"); buildExtras lists them for the conversation's record.
 */
export function buildWishName(b: CarBuildState): string {
  const model = chosen(b, "model")[0] || `${b.make} ${b.model}`.trim();
  const trim = chosen(b, "trim")[0] ?? "";
  const have = new Set(words(model));
  const extra = trim && words(trim).some((w) => !have.has(w)) ? trimAfter(model, trim) : "";
  const withTrim = extra ? `${model} ${extra}` : model;
  const make = words(b.make);
  // Any of the maker's words counts: "Mercedes-AMG G 63" already names a Mercedes-Benz.
  const named = make.length && !make.some((w) => have.has(w)) ? `${b.make} ${withTrim}` : withTrim;
  return tidyEnd(named);
}

/** The colour, interior and options a build's name leaves out, in the order they were chosen. */
export const buildExtras = (b: CarBuildState): string[] => ["colour", "interior", "options"].flatMap((s) => chosen(b, s));
