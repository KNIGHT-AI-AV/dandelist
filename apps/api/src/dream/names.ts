import { bareName } from "../agent/quick";
import type { CarBuildState } from "./types";

/**
 * A wish's name from the listing it was picked from. Listing titles are written to sell and to rank, so the wish
 * would otherwise be called "Austin Luxury House for Sale | $1,045,000" (demo film, 2026-11-03): the site's
 * suffix and the price go (bareName), and so does "for sale". A title made of nothing else keeps its bare form.
 */
export function listingWishName(title: string): string {
  const bare = bareName(title);
  // Trailing " - " parts that are a listing number or a site ("- 13248191 LuxuryEstate.com", "- Ref 48213 -
  // idealista.com") go; one that is ordinary words ("- Zillow", "- 2024") could be part of the name and stays.
  const parts = bare.split(" - ");
  while (parts.length > 1 && /\b\d{5,}\b|\b[\w-]+\.(?:com|net|org|co|io|[a-z]{2})(?:\.[a-z]{2})?\b/i.test(parts[parts.length - 1]!)) parts.pop();
  const name = parts
    .join(" - ")
    .replace(/\b(?:for sale|for rent|to rent)\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, "");
  return (name || bare).slice(0, 120);
}

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** The labels chosen on one step of a build, in the order the step lists them. */
const chosen = (b: CarBuildState, step: string) => {
  const s = b.steps.find((x) => x.id === step);
  return s ? s.choices.filter((c) => s.selected.includes(c.id)).map((c) => c.label.trim()).filter(Boolean) : [];
};

/**
 * A wish's name from a finished car build: the model, with the trim only when it adds words the model doesn't have,
 * and the maker in front when the label leaves it out. Colour, interior and options stay out of the name (they made
 * "Porsche 911 Carrera, 911 Carrera, Contrasts, Ventilated Seats (Front)"); buildExtras lists them for the reply.
 */
export function buildWishName(b: CarBuildState): string {
  const model = chosen(b, "model")[0] || `${b.make} ${b.model}`.trim();
  const trim = chosen(b, "trim")[0] ?? "";
  const have = new Set(words(model));
  const withTrim = trim && words(trim).some((w) => !have.has(w)) ? `${model} ${trim}` : model;
  const make = words(b.make);
  // Any of the maker's words counts: "Mercedes-AMG G 63" already names a Mercedes-Benz.
  const named = make.length && !make.some((w) => have.has(w)) ? `${b.make} ${withTrim}` : withTrim;
  return named.slice(0, 120);
}

/** The colour, interior and options a build's name leaves out, in the order they were chosen. */
export const buildExtras = (b: CarBuildState): string[] => ["colour", "interior", "options"].flatMap((s) => chosen(b, s));
