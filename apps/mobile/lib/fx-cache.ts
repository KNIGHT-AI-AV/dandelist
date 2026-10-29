import { initialRateObservations, mergeRateObservations, readRateObservations, retainedRates, storeRateObservations, type RateObservations } from "./fx-rates";

// Serialize writes across a provider remount; a queued retired write is skipped.
let writes = Promise.resolve();

/** Start cache hydration and refresh together without allowing completion order to lose observations. */
export function startRateUpdates(deps: {
  readCache(): Promise<string | null>;
  writeCache(value: string): Promise<void>;
  fetchRates(signal: AbortSignal): Promise<unknown>;
  onChange(value: RateObservations): void;
}): () => void {
  let live = true, hydrated = false;
  let current = initialRateObservations();
  const priorWrites = writes;
  const controller = new AbortController();
  const persist = () => {
    if (!hydrated || !live) return;
    const snapshot = storeRateObservations(current);
    writes = writes.then(async () => {
      if (live) await deps.writeCache(snapshot);
    }).catch(() => {});
  };
  const publish = () => {
    if (!live) return;
    deps.onChange(current);
    persist();
  };
  // A retired instance may have a native write already in flight. Read after it settles, while fetch stays parallel.
  void priorWrites.then(() => live ? deps.readCache() : null).then((raw) => {
    if (!live) return;
    const update = readRateObservations(JSON.parse(raw ?? "null"), "cache");
    if (update) current = mergeRateObservations(current, update, "cache");
  }).catch(() => {}).finally(() => {
    if (!live) return;
    hydrated = true;
    publish();
  });
  void deps.fetchRates(controller.signal).then((body) => {
    if (!live) return;
    const update = readRateObservations(body, "network");
    if (!update) throw new Error("Exchange rate response is unavailable");
    current = mergeRateObservations(current, update);
    publish();
  }).catch(() => {
    if (!live) return;
    current = retainedRates(current);
    publish();
  });
  return () => {
    live = false;
    controller.abort();
  };
}
