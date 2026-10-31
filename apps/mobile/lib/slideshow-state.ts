import type { MediaImage } from "../components/media";

export type SlideRecord = Readonly<{ epoch: number; attempt: number; index: number; image: MediaImage }>;
export type SlideshowState = {
  signature: string;
  epoch: number;
  nextAttempt: number;
  images: readonly MediaImage[];
  cursor: number;
  shown?: SlideRecord;
  candidate?: { record: SlideRecord; phase: "pending" | "fading" };
  failed: readonly number[];
};
export type SlideshowEvent =
  | { type: "deck"; images: readonly MediaImage[] }
  | { type: "tick"; epoch: number }
  | { type: "display" | "error" | "cancel"; record: SlideRecord }
  | { type: "finish"; record: SlideRecord; finished: boolean };

/** Ordered identity includes every current image field, not just URLs or array length. */
export function slideshowSignature(images: readonly MediaImage[]): string {
  return JSON.stringify(images.map((image) => [image.url, image.width, image.height, image.source, image.credit, image.license, image.sourcePage, image.clean, image.generated, image.author?.name, image.author?.url]));
}

function snapshot(image: MediaImage): MediaImage {
  return Object.freeze({ ...image, ...(image.author ? { author: Object.freeze({ ...image.author }) } : {}) });
}

function request(state: SlideshowState, index: number): SlideshowState {
  const record: SlideRecord = Object.freeze({ epoch: state.epoch, attempt: state.nextAttempt, index, image: state.images[index]! });
  return { ...state, cursor: index, nextAttempt: state.nextAttempt + 1, candidate: { record, phase: "pending" } };
}

export function createSlideshow(images: readonly MediaImage[], epoch = 1): SlideshowState {
  const state: SlideshowState = { signature: slideshowSignature(images), epoch, nextAttempt: 1, images: images.map(snapshot), cursor: -1, failed: [] };
  return images.length ? request(state, 0) : state;
}

/** No already-shown or proven-failed image needs another full-size request in this deck. */
export function nextSlideshowIndex(state: SlideshowState): number | undefined {
  for (let offset = 1; offset <= state.images.length; offset += 1) {
    const index = (state.cursor + offset) % state.images.length;
    if (index !== state.shown?.index && !state.failed.includes(index)) return index;
  }
  return undefined;
}

export function slideshowReducer(state: SlideshowState, event: SlideshowEvent): SlideshowState {
  if (event.type === "deck") {
    return slideshowSignature(event.images) === state.signature ? state : createSlideshow(event.images, state.epoch + 1);
  }
  if (event.type === "tick") {
    // Readiness locks the attempt immediately, before the animation effect starts. No deferred queue.
    if (event.epoch !== state.epoch || state.candidate?.phase === "fading") return state;
    const index = nextSlideshowIndex(state);
    return index === undefined ? state : request(state, index);
  }
  const candidate = state.candidate;
  if (!candidate || event.record.epoch !== state.epoch || event.record.attempt !== candidate.record.attempt || event.record.image.url !== candidate.record.image.url) return state;
  if (event.type === "display") {
    return candidate.phase === "pending" ? { ...state, candidate: { ...candidate, phase: "fading" } } : state;
  }
  if (event.type === "error") return { ...state, candidate: undefined, failed: [...state.failed, candidate.record.index] };
  if (event.type === "cancel") return { ...state, candidate: undefined };
  if (event.type !== "finish" || candidate.phase !== "fading") return state;
  // Each immutable attempt owns exactly one fade, so its identity also identifies that transition.
  return event.finished ? { ...state, shown: candidate.record, candidate: undefined } : { ...state, candidate: undefined };
}
