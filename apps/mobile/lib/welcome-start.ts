import type { PoolItem, WelcomeState } from "./welcome";

interface WelcomeStart {
  seenTitle(): Promise<boolean>;
  loadWelcome(): Promise<WelcomeState | null>;
  fetchPool(signal: AbortSignal): Promise<PoolItem[]>;
  onLocal(seen: boolean, saved: WelcomeState | null): void;
  onPool(items: PoolItem[]): void;
}

/** The title already has its catalogue hero; only local history decides how it starts. */
export function startWelcome(deps: WelcomeStart): () => void {
  let active = true;
  const controller = new AbortController();
  void Promise.all([deps.seenTitle().catch(() => false), deps.loadWelcome().catch(() => null)]).then(([seen, saved]) => {
    if (active) deps.onLocal(seen, saved);
  });
  void deps.fetchPool(controller.signal).then(
    (items) => { if (active) deps.onPool(items); },
    () => {}, // The screen already has the catalogue fallback.
  );
  return () => {
    active = false;
    controller.abort();
  };
}
