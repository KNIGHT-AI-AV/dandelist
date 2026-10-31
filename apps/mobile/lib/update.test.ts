import { afterEach, describe, expect, it, vi } from "vitest";
import shipped from "../public/latest.json";
import { AWAY_MS, LAUNCH, buildNumber, fetchLatest, offerFor, parseLatest, promptDue, promptStep, webUpdater, type Get, type Latest, type Offer, type Prompt, type PromptEvent } from "./update";

const TESTFLIGHT = "https://testflight.apple.com/join/tuh4Jxkw";
const APK = "https://expo.dev/artifacts/eas/jY2QO6YwRIM3WqoliJa7cI31jlRhpbMg1DaYaPbVLRA.apk";
const LATEST: Latest = { ios: { build: 21, url: TESTFLIGHT }, android: { build: 14, url: APK }, web: { version: "b2c3" } };
const OFFER: Offer = { kind: "store", url: TESTFLIGHT, target: "ios:21" };
const run = (s: Prompt, ...events: PromptEvent[]) => events.reduce(promptStep, s);

describe("latest.json", () => {
  // The iOS entry is the build the public TestFlight link serves (the external group's newest approved build), never a
  // newer internal-only one: a tester on the link would be offered a build the link can't give them, on every visit.
  it("ships TestFlight build 18 (the public link's build) and APK build 15, with the web version left to the deploy", () => {
    expect(parseLatest(shipped)).toEqual({ ios: { build: 18, url: TESTFLIGHT }, android: { build: 15, url: APK }, web: null });
  });

  it("keeps an entry only with a whole build and an https link", () => {
    const l = parseLatest({ ios: { build: "22", url: ` ${TESTFLIGHT} ` }, android: { build: 15.5, url: APK }, web: { version: " abc " } });
    expect(l).toEqual({ ios: { build: 22, url: TESTFLIGHT }, android: null, web: { version: "abc" } });
    for (const url of ["", "http://example.com/x.apk", "itms-beta://x", "javascript:alert(1)", "https://a b"]) {
      expect(parseLatest({ ios: { build: 22, url } })?.ios).toBeNull();
    }
    expect(parseLatest({ android: { build: 0, url: APK } })?.android).toBeNull();
  });

  it("reads anything that isn't an object as no answer", () => {
    for (const raw of [null, undefined, "x", 3, [], true]) expect(parseLatest(raw)).toBeNull();
  });

  it("reads build numbers from numbers and digit strings only", () => {
    expect([21, "21", " 7 ", 0, -1, 2.5, "21.1", "21a", "", null, Number.NaN].map(buildNumber)).toEqual([21, 21, 7, null, null, null, null, null, null, null, null]);
  });
});

describe("which update to offer", () => {
  it("offers a phone a strictly higher build of its own platform, with that platform's link", () => {
    expect(offerFor({ platform: "ios", build: 20 }, LATEST)).toEqual(OFFER);
    expect(offerFor({ platform: "android", build: 9 }, LATEST)).toEqual({ kind: "store", url: APK, target: "android:14" });
  });

  it("never offers an equal or older build", () => {
    expect(offerFor({ platform: "ios", build: 21 }, LATEST)).toBeNull();
    expect(offerFor({ platform: "ios", build: 30 }, LATEST)).toBeNull();
    expect(offerFor({ platform: "android", build: 14 }, LATEST)).toBeNull();
  });

  it("offers nothing on a platform without a link, or without an answer", () => {
    expect(offerFor({ platform: "ios", build: 1 }, parseLatest({ ios: { build: 21, url: "" }, android: { build: 14, url: APK } }))).toBeNull();
    expect(offerFor({ platform: "android", build: 1 }, null)).toBeNull();
  });

  it("offers the web a reload when the deployed version differs from the running bundle", () => {
    expect(offerFor({ platform: "web", version: "a1b2" }, LATEST)).toEqual({ kind: "reload", target: "web:b2c3" });
    expect(offerFor({ platform: "web", version: "b2c3" }, LATEST)).toBeNull();
    expect(offerFor({ platform: "web", version: "a1b2" }, { ...LATEST, web: null })).toBeNull();
  });

  it("doesn't offer the same reload twice in one tab", () => {
    expect(offerFor({ platform: "web", version: "a1b2" }, LATEST, "web:b2c3")).toBeNull();
    expect(offerFor({ platform: "web", version: "a1b2" }, { ...LATEST, web: { version: "c3d4" } }, "web:b2c3")).toEqual({ kind: "reload", target: "web:c3d4" });
  });
});

describe("Later", () => {
  const t0 = 1_000_000;
  const offered = run(LAUNCH, { type: "checked", visit: 1, offer: OFFER });

  it("shows once the launch's check finds something newer, and closes for the rest of that launch", () => {
    expect(promptDue(LAUNCH)).toBe(false);
    expect(promptDue(offered)).toBe(true);
    const later = run(offered, { type: "answered" });
    expect(promptDue(later)).toBe(false);
    // A quick look at another app is the same visit: still closed, and no new check.
    const back = run(later, { type: "background", at: t0 }, { type: "active", at: t0 + AWAY_MS - 1 });
    expect(back.visit).toBe(1);
    expect(promptDue(back)).toBe(false);
  });

  it("asks again on the next launch", () => {
    const later = run(offered, { type: "answered" });
    expect(promptDue(later)).toBe(false);
    // A new launch starts from LAUNCH, whatever the last one answered.
    const next = run(LAUNCH, { type: "checked", visit: 1, offer: OFFER });
    expect(promptDue(next)).toBe(true);
  });

  it("asks again when the app comes back after thirty minutes away, once the new check answers", () => {
    const later = run(offered, { type: "answered" });
    const back = run(later, { type: "background", at: t0 }, { type: "active", at: t0 + AWAY_MS });
    expect(back.visit).toBe(2);
    expect(promptDue(back)).toBe(false);
    expect(promptDue(run(back, { type: "checked", visit: 2, offer: OFFER }))).toBe(true);
    // The update was installed meanwhile (or withdrawn): the new check finds nothing, so nothing shows.
    expect(promptDue(run(back, { type: "checked", visit: 2, offer: null }))).toBe(false);
  });

  it("counts time away from when the app left, not from repeated background events", () => {
    const s = run(offered, { type: "background", at: t0 }, { type: "background", at: t0 + AWAY_MS - 10 }, { type: "active", at: t0 + AWAY_MS });
    expect(s.visit).toBe(2);
  });

  it("ignores a check that answers after its visit ended", () => {
    const s = run(LAUNCH, { type: "background", at: t0 }, { type: "active", at: t0 + AWAY_MS }, { type: "checked", visit: 1, offer: OFFER });
    expect(s.offer).toBeNull();
    expect(promptDue(s)).toBe(false);
  });

  it("treats Update like Later for the rest of the visit", () => {
    expect(promptDue(run(offered, { type: "answered" }))).toBe(false);
  });
});

describe("the check", () => {
  afterEach(() => void vi.useRealTimers());

  const answering = (body: unknown, ok = true) => {
    const calls: { url: string; init: Parameters<Get>[1] }[] = [];
    const get: Get = async (url, init) => {
      calls.push({ url, init });
      return { ok, json: async () => body };
    };
    return { get, calls };
  };

  it("reads the file past every cache", async () => {
    const { get, calls } = answering(shipped);
    expect(await fetchLatest("https://dandelist.knightaiav.com/latest.json", get)).toEqual(parseLatest(shipped));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://dandelist.knightaiav.com/latest.json");
    expect(calls[0]!.init.cache).toBe("no-store");
  });

  it("answers nothing for a failed request, an error page or a body that isn't JSON", async () => {
    expect(await fetchLatest("/latest.json", answering(shipped, false).get)).toBeNull();
    expect(await fetchLatest("/latest.json", async () => Promise.reject(new TypeError("Network request failed")))).toBeNull();
    expect(await fetchLatest("/latest.json", async () => ({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token <")) }))).toBeNull();
  });

  it("gives up quietly when the server is slow, and cancels the request", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const slow: Get = (_url, init) => {
      signal = init.signal;
      return new Promise(() => {});
    };
    const answer = fetchLatest("/latest.json", slow, 5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await answer).toBeNull();
    expect(signal?.aborted).toBe(true);
  });
});

describe("the web's updater", () => {
  const page = (stored: string | null = null) => {
    const store = new Map<string, string>(stored ? [["dandelist.update.tried", stored]] : []);
    const reload = vi.fn();
    return { page: { sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }, location: { reload } }, reload, store };
  };

  it("asks only from a bundle that knows its version", () => {
    expect(webUpdater(undefined, page().page).running).toBeNull();
    expect(webUpdater("  ", page().page).running).toBeNull();
    expect(webUpdater("a1b2", page().page).running).toEqual({ platform: "web", version: "a1b2" });
    expect(webUpdater("a1b2", page().page).source).toBe("/latest.json");
  });

  it("remembers the reload it tried, so the same one isn't offered again in that tab", () => {
    const { page: p, reload } = page();
    const u = webUpdater("a1b2", p);
    const offer = offerFor(u.running!, LATEST, u.tried());
    expect(offer).toEqual({ kind: "reload", target: "web:b2c3" });
    u.go(offer!);
    expect(reload).toHaveBeenCalledOnce();
    // After the reload, the same old bundle (a stale cache) isn't asked again for the same version.
    expect(offerFor(u.running!, LATEST, webUpdater("a1b2", p).tried())).toBeNull();
  });

  it("still reloads when the browser refuses storage", () => {
    const reload = vi.fn();
    const refusing = {
      sessionStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
      location: { reload },
    };
    const u = webUpdater("a1b2", refusing);
    expect(u.tried()).toBeNull();
    u.go({ kind: "reload", target: "web:b2c3" });
    expect(reload).toHaveBeenCalledOnce();
  });
});
