import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAP_FADE_MS, CAP_MS, CHIME_AT, FADE_IN_MS, FADE_OUT_MS, RAMP, waitingMusic, type Tap } from "./waiting-core";

const LEVEL = 0.6;

/** A loop player that only remembers what it was told. */
function fakePlayer() {
  return {
    volume: 0,
    playing: false,
    plays: 0,
    seeks: [] as number[],
    play() {
      this.playing = true;
      this.plays++;
    },
    pause() {
      this.playing = false;
    },
    seekTo(s: number) {
      this.seeks.push(s);
    },
  };
}

/** The waiting music with a fake loop player, fake haptics and chime, and vitest's clock. */
function setup({ touched = true } = {}) {
  const player = fakePlayer();
  const taps: { at: number; kind: Tap }[] = [];
  const chimes: number[] = [];
  const start = Date.now();
  const music = waitingMusic(
    {
      loop: () => player,
      chime: () => chimes.push(Date.now() - start),
      tap: (kind) => taps.push({ at: Date.now() - start, kind }),
      mayPlay: () => touched,
      now: Date.now,
      later: (fn, ms) => setTimeout(fn, ms),
      cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    },
    LEVEL,
  );
  // As lib/waiting.ts does once the sounds setting has been read.
  music.set({ appActive: true, soundsOn: true, micOpen: false });
  return { music, player, taps, chimes, tick: (ms: number) => vi.advanceTimersByTime(ms) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 30, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

describe("the waiting ballad (owner, 2026-10-30)", () => {
  it("plays from its top while a watched picture is being made, fading in over about a second", () => {
    const { music, player, tick } = setup();
    music.wait("a", true);
    expect(player.playing).toBe(true);
    expect(player.seeks).toEqual([0]);
    expect(player.volume).toBe(0);
    let last = 0;
    for (let ms = 100; ms < FADE_IN_MS; ms += 100) {
      tick(100);
      expect(player.volume).toBeGreaterThan(last);
      expect(player.volume).toBeLessThan(LEVEL);
      last = player.volume;
    }
    tick(100);
    expect(player.volume).toBeCloseTo(LEVEL, 5);
  });

  it("stays silent when nobody is watching, sounds are off, the app is away, the microphone is open, or the page is untouched", () => {
    const unwatched = setup();
    unwatched.music.wait("a", false);
    expect(unwatched.player.plays).toBe(0);

    const off = setup();
    off.music.set({ soundsOn: false });
    off.music.wait("a", true);
    expect(off.player.plays).toBe(0);

    const away = setup();
    away.music.set({ appActive: false });
    away.music.wait("a", true);
    expect(away.player.plays).toBe(0);

    const mic = setup();
    mic.music.set({ micOpen: true });
    mic.music.wait("a", true);
    expect(mic.player.plays).toBe(0);

    const web = setup({ touched: false });
    web.music.wait("a", true);
    expect(web.player.plays).toBe(0);
  });

  it("never stacks: every wait shares the one loop", () => {
    const { music, player, tick } = setup();
    music.wait("a", true);
    tick(400);
    music.wait("b", true);
    tick(2_000);
    expect(player.plays).toBe(1);
    expect(player.volume).toBeCloseTo(LEVEL, 5);
    // One picture lands while the other is still being made: the loop plays on for it.
    music.land("a");
    tick(FADE_OUT_MS + 100);
    expect(player.playing).toBe(true);
    expect(player.volume).toBeCloseTo(LEVEL, 5);
    music.land("b");
    tick(FADE_OUT_MS + 100);
    expect(player.playing).toBe(false);
  });

  it("fades out as the picture lands, then ramps light, light, medium, heavy and chimes with a success tap", () => {
    const { music, player, taps, chimes, tick } = setup();
    music.wait("a", true);
    tick(3_000);
    const landedAt = 3_000;
    music.land("a");
    tick(FADE_OUT_MS / 2);
    expect(player.volume).toBeGreaterThan(0);
    expect(player.volume).toBeLessThan(LEVEL);
    tick(FADE_OUT_MS);
    expect(player.volume).toBe(0);
    expect(player.playing).toBe(false);
    tick(1_000);
    expect(taps).toEqual([...RAMP.map((r) => ({ at: landedAt + r.at, kind: r.tap })), { at: landedAt + CHIME_AT, kind: "success" }]);
    expect(chimes).toEqual([landedAt + CHIME_AT]);
    // The ramp is slow, rising and over in about 0.8 s, and the chime follows it.
    expect(RAMP.map((r) => r.tap)).toEqual(["light", "light", "medium", "heavy"]);
    expect(RAMP.at(-1)!.at).toBeLessThanOrEqual(800);
    expect(CHIME_AT).toBeGreaterThan(RAMP.at(-1)!.at);
  });

  it("gives a landing nobody was watching no ramp and no chime", () => {
    const { music, taps, chimes, tick } = setup();
    music.wait("a", true);
    tick(1_000);
    music.wait("a", false); // swiped to another page
    music.land("a");
    tick(2_000);
    expect(taps).toEqual([]);
    expect(chimes).toEqual([]);
    // A picture that lands with the app in the background is quiet too.
    const away = setup();
    away.music.wait("b", true);
    away.music.set({ appActive: false });
    away.music.land("b");
    away.tick(2_000);
    expect(away.taps).toEqual([]);
    expect(away.chimes).toEqual([]);
  });

  it("ends a wait that failed or whose screen went away quietly", () => {
    const { music, player, taps, chimes, tick } = setup();
    music.wait("a", true);
    tick(2_000);
    music.release("a");
    tick(FADE_OUT_MS + 100);
    expect(player.playing).toBe(false);
    expect(taps).toEqual([]);
    expect(chimes).toEqual([]);
    // A landing for a wait that already ended does nothing.
    music.land("a");
    tick(2_000);
    expect(chimes).toEqual([]);
  });

  it("drifts away once a wait passes 90 s, and the landing after it still chimes", () => {
    const { music, player, chimes, tick } = setup();
    music.wait("a", true);
    tick(CAP_MS - 1_000);
    expect(player.volume).toBeCloseTo(LEVEL, 5);
    tick(1_000 + CAP_FADE_MS / 2);
    expect(player.playing).toBe(true);
    expect(player.volume).toBeGreaterThan(0);
    expect(player.volume).toBeLessThan(LEVEL);
    tick(CAP_FADE_MS);
    expect(player.playing).toBe(false);
    // Leaving and coming back doesn't start it again for the same wait.
    music.wait("a", false);
    music.wait("a", true);
    expect(player.playing).toBe(false);
    music.land("a");
    tick(1_000);
    expect(chimes).toHaveLength(1);
  });

  it("gives every new wait its own 90 s, from the top of the ballad", () => {
    const { music, player, tick } = setup();
    music.wait("a", true);
    tick(CAP_MS + CAP_FADE_MS + 100);
    expect(player.playing).toBe(false);
    music.wait("b", true);
    expect(player.playing).toBe(true);
    expect(player.seeks).toEqual([0, 0]);
  });

  it("keeps a wait's own start when its screen comes back, so the 90 s don't begin again", () => {
    const { music, player, tick } = setup();
    music.wait("a", true);
    tick(60_000);
    music.release("a"); // the screen remounted
    music.wait("a", true);
    tick(31_000 + CAP_FADE_MS);
    expect(player.playing).toBe(false);
  });

  it("stops at once when the microphone opens, and comes back where it was when it closes", () => {
    const { music, player, tick } = setup();
    music.wait("a", true);
    tick(2_000);
    music.set({ micOpen: true });
    expect(player.playing).toBe(false);
    expect(player.volume).toBe(0);
    tick(5_000);
    music.set({ micOpen: false });
    expect(player.playing).toBe(true);
    expect(player.seeks).toEqual([0]); // the same wait carries on, not from the top
    tick(FADE_IN_MS + 100);
    expect(player.volume).toBeCloseTo(LEVEL, 5);
  });

  it("stops at once when the app goes to the background, and quiets a ramp under way", () => {
    const { music, player, taps, chimes, tick } = setup();
    music.wait("a", true);
    tick(2_000);
    music.set({ appActive: false });
    expect(player.playing).toBe(false);
    expect(player.volume).toBe(0);
    music.set({ appActive: true });
    expect(player.playing).toBe(true);
    tick(2_000);
    music.land("a");
    tick(300);
    music.set({ appActive: false });
    tick(2_000);
    expect(taps.map((t) => t.kind)).toEqual(["light", "light"]);
    expect(chimes).toEqual([]);
  });

  it("fades out when the screen is left, and back in where it was when it returns", () => {
    const { music, player, tick } = setup();
    music.wait("a", true);
    tick(2_000);
    music.wait("a", false);
    expect(music.running()).toBe(true); // still fading, so a resumed player isn't paused mid-fade
    tick(FADE_OUT_MS + 100);
    expect(player.playing).toBe(false);
    expect(music.running()).toBe(false);
    music.wait("a", true);
    expect(player.playing).toBe(true);
    expect(player.seeks).toEqual([0]);
  });

  it("fades out when sounds are turned off, while a landing still gets its ramp", () => {
    const { music, player, taps, chimes, tick } = setup();
    music.wait("a", true);
    tick(2_000);
    music.set({ soundsOn: false });
    tick(FADE_OUT_MS + 100);
    expect(player.playing).toBe(false);
    music.land("a");
    tick(1_000);
    expect(taps.map((t) => t.kind)).toEqual(["light", "light", "medium", "heavy", "success"]);
    // The chime is asked for; lib/sound.ts keeps it silent while sounds are off.
    expect(chimes).toHaveLength(1);
  });

  it("starts no second ramp while one is under way", () => {
    const { music, taps, chimes, tick } = setup();
    music.wait("a", true);
    music.wait("b", true);
    tick(2_000);
    music.land("a");
    tick(200);
    music.land("b");
    tick(2_000);
    expect(chimes).toHaveLength(1);
    expect(taps.filter((t) => t.kind === "success")).toHaveLength(1);
  });
});

describe("each theme's own song (owner, 2026-10-30)", () => {
  /** The waiting music with a fake player for each song, made when first asked for, as lib/sound.ts makes them. */
  function songs() {
    const players = new Map<string, ReturnType<typeof fakePlayer>>();
    const dropped: string[] = [];
    const music = waitingMusic(
      {
        loop: (song) => {
          if (!players.has(song)) players.set(song, fakePlayer());
          return players.get(song)!;
        },
        drop: (song) => dropped.push(song),
        chime: () => {},
        tap: () => {},
        mayPlay: () => true,
        now: Date.now,
        later: (fn, ms) => setTimeout(fn, ms),
        cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      },
      LEVEL,
    );
    music.set({ appActive: true, soundsOn: true, micOpen: false });
    return { music, players, dropped, tick: (ms: number) => vi.advanceTimersByTime(ms) };
  }

  it("plays the song of the theme it is given, and the ballad until it is given one", () => {
    const { music, players } = songs();
    music.song("noir");
    music.wait("a", true);
    expect([...players.keys()]).toEqual(["noir"]);
    expect(players.get("noir")!.playing).toBe(true);
    expect(players.get("noir")!.seeks).toEqual([0]);

    const before = songs();
    before.music.wait("a", true);
    expect([...before.players.keys()]).toEqual(["wait"]);
    expect(before.players.get("wait")!.playing).toBe(true);
  });

  it("follows a theme changed mid-wait: the old song fades out, the new one starts from its top, and the old player goes", () => {
    const { music, players, dropped, tick } = songs();
    music.song("emerald");
    music.wait("a", true);
    tick(2_000);
    const emerald = players.get("emerald")!;
    expect(emerald.volume).toBeCloseTo(LEVEL, 5);
    music.song("cognac");
    tick(FADE_OUT_MS / 2);
    expect(emerald.playing).toBe(true);
    expect(emerald.volume).toBeGreaterThan(0);
    expect(emerald.volume).toBeLessThan(LEVEL);
    // A player resumed behind the music's back is paused unless its song is the one fading or playing.
    expect(music.running("emerald")).toBe(true);
    expect(music.running("cognac")).toBe(false);
    expect(players.has("cognac")).toBe(false);
    tick(FADE_OUT_MS);
    expect(emerald.playing).toBe(false);
    const cognac = players.get("cognac")!;
    expect(cognac.playing).toBe(true);
    expect(cognac.seeks).toEqual([0]);
    expect(dropped).toEqual(["wait", "emerald"]);
    tick(FADE_IN_MS + 100);
    expect(cognac.volume).toBeCloseTo(LEVEL, 5);
    expect(music.running("cognac")).toBe(true);
    expect(music.running("emerald")).toBe(false);
  });

  it("carries on where it was if the theme comes back before the old song has gone", () => {
    const { music, players, dropped, tick } = songs();
    music.song("emerald");
    music.wait("a", true);
    tick(2_000);
    music.song("noir");
    tick(FADE_OUT_MS / 2);
    music.song("emerald");
    tick(FADE_IN_MS + 100);
    const emerald = players.get("emerald")!;
    expect(emerald.playing).toBe(true);
    expect(emerald.seeks).toEqual([0]);
    expect(emerald.volume).toBeCloseTo(LEVEL, 5);
    expect(players.has("noir")).toBe(false);
    expect(dropped).toEqual(["wait", "noir"]);
  });

  it("changes song quietly between waits, and makes the new one's player only when a wait needs it", () => {
    const { music, players, dropped, tick } = songs();
    music.song("ivory");
    music.wait("a", true);
    tick(2_000);
    music.land("a");
    tick(FADE_OUT_MS + 100);
    music.song("riviera");
    expect(dropped).toEqual(["wait", "ivory"]);
    expect(players.has("riviera")).toBe(false);
    music.wait("b", true);
    expect(players.get("riviera")!.playing).toBe(true);
    expect(players.get("ivory")!.playing).toBe(false);
  });
});
