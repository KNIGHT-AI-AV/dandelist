import { describe, expect, it, vi } from "vitest";
import { startRateUpdates } from "./fx-cache";
import { initialRateObservations, storeRateObservations, type RateObservations } from "./fx-rates";

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const body = (rate: number, date: string) => ({
  base: "USD", date, rates: { EUR: rate },
  observations: { EUR: { rate, source: "ecb", referenceDate: date, fetchedAt: date + "T16:00:00.000Z", retained: false } },
});

function session() {
  const cache = deferred<string | null>(), network = deferred<unknown>();
  const writes: RateObservations[] = [], changes: RateObservations[] = [];
  let signal: AbortSignal | undefined;
  const stop = startRateUpdates({
    readCache: () => cache.promise,
    fetchRates: (s) => { signal = s; return network.promise; },
    writeCache: async (v) => { writes.push(JSON.parse(v).observations); },
    onChange: (v) => changes.push(v),
  });
  return { cache, network, writes, changes, stop, signal: () => signal! };
}

describe("FX cache hydration and refresh", () => {
  it.each(["cache-first", "network-first"])("ends with the newer accepted rate in either order: %s", async (order) => {
    const s = session();
    if (order === "cache-first") {
      s.cache.resolve(JSON.stringify(body(0.9, "2026-10-28"))); await flush();
      s.network.resolve(body(0.8, "2026-10-29"));
    } else {
      s.network.resolve(body(0.8, "2026-10-29")); await flush();
      expect(s.changes.at(-1)!.EUR.rate).toBe(0.8);
      // No persistence before hydration can erase the still-unread cache.
      expect(s.writes).toHaveLength(0);
      s.cache.resolve(JSON.stringify(body(0.9, "2026-10-28")));
    }
    await flush();
    expect(s.changes.at(-1)!.EUR.rate).toBe(0.8);
    expect(s.writes.at(-1)!.EUR).toEqual(s.changes.at(-1)!.EUR);
    expect(s.writes.at(-1)!.EUR.referenceDate).toBe("2026-10-29");
    s.stop();
  });

  it("a live older-API response wins a same-date cache tie without invented fetch times", async () => {
    const s = session();
    const olderApi = (rate: number) => ({ base: "USD", date: "2026-10-28", rates: { EUR: rate } });
    s.network.resolve(olderApi(0.8)); await flush();
    const cache = initialRateObservations();
    cache.EUR = { rate: 0.9, source: "ecb", referenceDate: "2026-10-28", fetchedAt: null, retained: true };
    s.cache.resolve(storeRateObservations(cache)); await flush();
    expect(s.changes.at(-1)!.EUR.rate).toBe(0.8);
    expect(s.changes.at(-1)!.EUR.fetchedAt).toBeNull();
    s.stop();
  });

  it("a partial network result arriving first still gains omitted currencies from the cache", async () => {
    const prior = initialRateObservations();
    prior.GBP = { rate: 0.75, source: "ecb", referenceDate: "2026-10-28", fetchedAt: "2026-10-28T16:00:00.000Z", retained: false };
    const s = session();
    s.network.resolve(body(0.8, "2026-10-29")); await flush();
    s.cache.resolve(storeRateObservations(prior)); await flush();
    expect(s.changes.at(-1)!.EUR.rate).toBe(0.8);
    expect(s.changes.at(-1)!.GBP).toEqual({ ...prior.GBP, retained: true });
    expect(s.writes.at(-1)!.GBP.rate).toBe(0.75);
    s.stop();
  });

  it.each(["cache-first", "failure-first"])("retains offline cached dates in either order: %s", async (order) => {
    const s = session();
    if (order === "cache-first") {
      s.cache.resolve(JSON.stringify(body(0.9, "2026-10-28"))); await flush();
      s.network.reject(new Error("offline"));
    } else {
      s.network.reject(new Error("offline")); await flush();
      s.cache.resolve(JSON.stringify(body(0.9, "2026-10-28")));
    }
    await flush();
    expect(s.changes.at(-1)!.EUR).toMatchObject({ rate: 0.9, referenceDate: "2026-10-28", retained: true });
    s.stop();
  });

  it("keeps a never-online install usable and explicitly fallback", async () => {
    const s = session();
    s.cache.resolve(null); s.network.reject(new Error("offline")); await flush();
    expect(s.changes.at(-1)!.EUR).toMatchObject({ source: "fallback", referenceDate: null, fetchedAt: null });
    expect(s.changes.at(-1)!.USD.rate).toBe(1);
    s.stop();
  });

  it("survives malformed storage and an invalid response without a rejected background promise", async () => {
    const s = session();
    s.cache.resolve("{"); s.network.resolve({ rates: { EUR: -1 } }); await flush();
    expect(s.changes.at(-1)!.EUR.source).toBe("fallback");
    s.stop();
  });

  it("does not publish or write after retirement and aborts the network request", async () => {
    const s = session(); s.stop();
    s.cache.resolve(JSON.stringify(body(0.9, "2026-10-28")));
    s.network.resolve(body(0.8, "2026-10-29")); await flush();
    expect(s.signal().aborted).toBe(true);
    expect(s.changes).toHaveLength(0);
    expect(s.writes).toHaveLength(0);
  });

  it("hydrates a remount after an already-started old-instance write settles", async () => {
    let disk = JSON.stringify(body(0.9, "2026-10-27"));
    let writing: string | null = null;
    const pendingWrite = deferred<void>();
    const first = startRateUpdates({
      readCache: async () => disk,
      fetchRates: async () => body(0.8, "2026-10-29"),
      writeCache: async (value) => { writing = value; await pendingWrite.promise; disk = value; },
      onChange: () => {},
    });
    await flush();
    expect(writing).not.toBeNull();
    expect(JSON.parse(writing!).observations.EUR.rate).toBe(0.8);
    first();
    const changes: RateObservations[] = [];
    const readCache = vi.fn(async () => disk);
    const second = startRateUpdates({
      readCache,
      fetchRates: async () => { throw new Error("offline"); },
      writeCache: async (value) => { disk = value; },
      onChange: (value) => changes.push(value),
    });
    await flush();
    expect(readCache).not.toHaveBeenCalled();
    pendingWrite.resolve(); await flush();
    expect(readCache).toHaveBeenCalledOnce();
    expect(changes.at(-1)!.EUR.rate).toBe(0.8);
    expect(JSON.parse(disk).observations.EUR).toMatchObject({ rate: 0.8, referenceDate: "2026-10-29", retained: true });
    second();
  });

  it("handles a refused persistence write without losing the in-memory rate", async () => {
    const change = vi.fn();
    const stop = startRateUpdates({
      readCache: async () => null, fetchRates: async () => body(0.8, "2026-10-29"),
      writeCache: async () => { throw new Error("storage refused"); }, onChange: change,
    });
    await flush();
    expect(change.mock.calls.at(-1)![0].EUR.rate).toBe(0.8);
    stop();
  });
});
