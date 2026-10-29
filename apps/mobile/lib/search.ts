/**
 * Search over the wishes on the phone, instant and by meaning where it can be (owner, recording 03: "travel" finds
 * trips, "car" finds a G-Wagon, "family" finds private security). It reads the name, the one-sentence description
 * and tags the API writes (`details.about`, `details.tags`), the kind, and a small map of related words. When what
 * it finds here is weak, the page asks the API to rank by meaning (POST /wishes/search) and merges that in.
 *
 * Pure (no React), so the ranking is tested on its own.
 */

export interface Searchable {
  id: string;
  name: string;
  kind: string;
  about?: string;
  tags?: string[];
}

export interface Hit {
  id: string;
  score: number;
}

/** A hit at least this good is a direct match on a name or a tag: the API isn't asked. */
export const STRONG = 0.8;
/** Queries shorter than this stay on the phone. */
export const MIN_REMOTE_CHARS = 3;
/** How long typing must pause before the API is asked, in ms. */
export const REMOTE_DEBOUNCE_MS = 350;

/** Groups of words that mean the same thing for a wish list. A word in a group finds every other word in it. */
export const SYNONYMS: readonly (readonly string[])[] = [
  ["travel", "trip", "journey", "holiday", "vacation", "getaway", "visit", "tour", "flight", "fly", "abroad", "cruise", "safari", "resort", "hotel", "stay", "beach", "island", "retreat", "honeymoon", "month in", "weekend in"],
  ["car", "auto", "vehicle", "drive", "suv", "g wagon", "gwagon", "g class", "g 63", "mercedes", "porsche", "ferrari", "lamborghini", "bentley", "rolls royce", "range rover", "tesla", "bmw", "audi", "aston martin", "mclaren", "supercar", "4x4"],
  ["home", "house", "villa", "apartment", "flat", "penthouse", "property", "condo", "cabin", "chalet", "estate", "mansion", "residence"],
  ["family", "kids", "children", "child", "parents", "mother", "father", "wife", "husband", "partner", "security", "protection", "bodyguard", "nanny", "school", "tuition", "education"],
  ["watch", "rolex", "patek", "audemars", "omega", "cartier", "timepiece", "chronograph"],
  ["jewelry", "jewellery", "ring", "necklace", "diamond", "bracelet", "earrings", "gold"],
  ["boat", "yacht", "sailboat", "catamaran", "superyacht", "sailing"],
  ["plane", "jet", "private jet", "aviation", "helicopter", "flying"],
  ["fitness", "health", "gym", "peloton", "trainer", "workout", "wellness", "spa", "yoga"],
  ["tech", "phone", "laptop", "computer", "iphone", "macbook", "camera", "gadget", "headphones"],
  ["art", "painting", "sculpture", "gallery", "print", "collection"],
  ["fashion", "bag", "handbag", "birkin", "shoes", "clothes", "suit", "dress", "wardrobe", "hermes", "chanel"],
  ["food", "dinner", "restaurant", "chef", "wine", "tasting", "dining", "michelin"],
  ["learn", "course", "lessons", "class", "study", "degree", "language"],
  ["music", "piano", "guitar", "concert", "festival", "vinyl"],
];

/** Words for each kind of wish, so "travel" finds the places to visit and "experience" the things to do. */
export const KIND_WORDS: Record<string, readonly string[]> = {
  visit: ["visit", "travel", "trip", "place", "go", "see", "destination"],
  do: ["do", "experience", "activity", "adventure", "service"],
  buy: ["buy", "purchase", "shop", "thing", "gift"],
  own: ["own", "keep", "asset", "property", "investment"],
};

const STOP = new Set(["a", "an", "the", "my", "our", "for", "to", "of", "in", "on", "and", "or", "with", "some", "i", "want", "new", "something", "things"]);

/** Lowercase, no accents, letters and digits only, single spaces. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A crude stem: "trips" and "trip" meet, "watches" and "watch" too, "glass" stays "glass". */
export function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

const words = (s: string) => normalize(s).split(" ").filter(Boolean).map(stem);

/** The query's words, without filler. A query of only filler keeps its words. */
export function queryTerms(q: string): string[] {
  const all = words(q);
  const kept = all.filter((w) => !STOP.has(w));
  return [...new Set(kept.length ? kept : all)];
}

const GROUPS = SYNONYMS.map((g) => g.map((w) => words(w).join(" ")));
/** Whole words the map knows. Typing one ("car") means that word, not every word it starts ("card", "cartier"). */
const VOCAB = new Set([...GROUPS.flat(), ...Object.values(KIND_WORDS).flat().map((w) => words(w).join(" "))].filter((w) => !w.includes(" ")));

/**
 * Every word related to `term` through the synonym map (not the term itself). A term that is a word in a group
 * ("car", or "travelling" built on "travel") uses those groups only; a part-typed term ("fam") uses the groups with
 * a word that starts with it. So "car" never reaches the watches through "cartier".
 */
export function related(term: string): string[] {
  const whole = GROUPS.filter((g) => g.some((w) => w === term || (w.length >= 4 && !w.includes(" ") && term.startsWith(w))));
  const groups = whole.length ? whole : term.length >= 3 ? GROUPS.filter((g) => g.some((w) => w.startsWith(term))) : [];
  const out = new Set<string>();
  for (const g of groups) for (const w of g) if (w !== term) out.add(w);
  return [...out];
}

/** How well a phrase (one or more stemmed words) matches a field's words: whole word, word start, or nothing. */
function fieldMatch(field: string[], phrase: string, partial: boolean): number {
  if (!field.length) return 0;
  const parts = phrase.split(" ");
  if (parts.length > 1) {
    for (let i = 0; i + parts.length <= field.length; i++) if (parts.every((p, j) => field[i + j] === p)) return 1;
    return 0;
  }
  if (field.includes(phrase)) return 1;
  if (partial && field.some((w) => w.startsWith(phrase))) return 0.8;
  return 0;
}

interface Prepared {
  id: string;
  name: string[];
  nameText: string;
  tags: string[][];
  about: string[];
  kind: string[];
}

function prepare(w: Searchable): Prepared {
  return {
    id: w.id,
    name: words(w.name),
    nameText: words(w.name).join(" "),
    tags: (w.tags ?? []).map(words),
    about: words(w.about ?? ""),
    kind: (KIND_WORDS[w.kind] ?? [w.kind]).map((k) => stem(normalize(k))),
  };
}

/** The best a single phrase does on one wish, before the synonym discount. */
function phraseScore(w: Prepared, phrase: string, partial: boolean): number {
  const name = fieldMatch(w.name, phrase, partial);
  const tag = Math.max(0, ...w.tags.map((t) => fieldMatch(t, phrase, partial)));
  const about = fieldMatch(w.about, phrase, partial);
  const kind = w.kind.includes(phrase) ? 1 : 0;
  return Math.max(name * 1, tag * 0.95, about * 0.6, kind * 0.5);
}

/** Related words count for less than the word typed. */
const RELATED = 0.7;

/**
 * Ranks wishes for a query, best first. Each query word scores its best match on the wish (name, then tags, then
 * the description, then the kind; a related word at 70%), and a wish that misses some words is discounted by how
 * many it missed. The last word is matched as a prefix, so results follow typing, unless it is already a whole
 * word the map knows. Ties keep the list's order.
 */
export function localSearch(items: Searchable[], q: string): Hit[] {
  const terms = queryTerms(q);
  if (!terms.length) return [];
  const whole = terms.join(" ");
  const expanded = terms.map((t) => related(t));
  const hits: Hit[] = [];
  items.forEach((item) => {
    const w = prepare(item);
    let sum = 0;
    let matched = 0;
    terms.forEach((t, i) => {
      const partial = i === terms.length - 1 && !VOCAB.has(t);
      let best = phraseScore(w, t, partial);
      for (const r of expanded[i]!) if (best < RELATED) best = Math.max(best, phraseScore(w, r, false) * RELATED);
      if (best > 0) matched++;
      sum += best;
    });
    if (!matched) return;
    const coverage = matched / terms.length;
    // A multi-word query that misses half its words is noise.
    if (terms.length > 1 && coverage < 0.5) return;
    let score = (sum / terms.length) * coverage;
    if (terms.length > 1 && w.nameText.includes(whole)) score += 0.5;
    hits.push({ id: item.id, score: Math.round(score * 1000) / 1000 });
  });
  const order = new Map(items.map((w, i) => [w.id, i]));
  return hits.sort((a, b) => b.score - a.score || order.get(a.id)! - order.get(b.id)!);
}

/** Whether to ask the API: a real query, and nothing here matches it directly by name or tag. */
export function wantsRemote(q: string, hits: Hit[]): boolean {
  if (normalize(q).replace(/ /g, "").length < MIN_REMOTE_CHARS) return false;
  return !hits.some((h) => h.score >= STRONG);
}

/**
 * One ranked list from both: direct matches here first, then the API's ranking by meaning, then the rest of what
 * was found here. Ids the API returns that aren't on the phone are left out.
 */
export function mergeResults(local: Hit[], remote: string[] | null, known: Set<string>): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    if (known.has(id) && !out.includes(id)) out.push(id);
  };
  for (const h of local) if (h.score >= STRONG) add(h.id);
  for (const id of remote ?? []) add(id);
  for (const h of local) add(h.id);
  return out;
}
