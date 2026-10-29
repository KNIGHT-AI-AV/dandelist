import type { KeepLine, Listing, Widget } from "@dandelist/catalogue/dream";
import type { MediaImage } from "@dandelist/catalogue";
import type { ListingExtra } from "./hunt";
import type { Home } from "./life";

/** What a home search looks for, and where. `away` is true when this one wish is priced somewhere other than home. */
export interface HomeCriteria {
  kind: "home";
  place: Home;
  away: boolean;
  styles: string[];
  features: string[];
  avoid: string[];
  bedrooms: number | null;
  /** In `currency`. */
  maxPrice: number | null;
  currency: string;
  notes: string;
}

/** Cars ignore the region; listings come from whichever market sells them, converted to the home currency. */
export interface CarCriteria {
  kind: "car";
  make: string;
  model: string;
  trim: string;
  colour: string;
  condition: "new" | "used" | "any";
  maxPrice: number | null;
  currency: string;
  notes: string;
}

export type Criteria = HomeCriteria | CarCriteria;

export interface DeckState {
  id: string;
  kind: "home" | "car";
  criteria: Criteria;
  round: number;
  cards: Listing[];
  swipes: Record<string, "yes" | "no">;
  /** True once this deck's swipes have been turned into a refined search. */
  refined: boolean;
  /** Per listing id: what the estimator needs that the card doesn't show. */
  extra: Record<string, ListingExtra>;
}

export interface CarChoiceState {
  id: string;
  label: string;
  /** In the build's source currency, as the configurator states it. */
  price?: number;
  verified: boolean;
  /** A person's own words, retained without inventing a price. */
  custom?: boolean;
}

export interface CarBuildState {
  id: string;
  make: string;
  model: string;
  sourceUrl: string;
  sourceCurrency: string;
  /** Home currency per unit of source currency, from the ECB. */
  rate: number;
  steps: { id: string; title: string; multi: boolean; choices: CarChoiceState[]; selected: string[] }[];
  imageUrl?: string;
  checkedAt: string;
  consumptionL100?: number;
}

export interface QuoteState {
  id: string;
  service: string;
  coverage: string;
  region: string;
  currency: string;
  lines: KeepLine[];
  images: MediaImage[];
}

export interface DreamState {
  counter: number;
  home?: HomeCriteria;
  car?: CarCriteria;
  /** The widgets this session has shown, by id, so actions can find what they answer. */
  widgets: Record<string, Widget>;
  decks: Record<string, DeckState>;
  builds: Record<string, CarBuildState>;
  quotes: Record<string, QuoteState>;
  /** Listing URLs already shown, so a refined search brings new ones. */
  seen: string[];
}

export const emptyState = (): DreamState => ({ counter: 0, widgets: {}, decks: {}, builds: {}, quotes: {}, seen: [] });

export interface TranscriptEntry {
  role: "user" | "agent";
  text: string;
  at: string;
  widget?: { kind: Widget["kind"]; id: string };
}
