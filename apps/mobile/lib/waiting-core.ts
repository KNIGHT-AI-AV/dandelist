/**
 * The waiting music's rules, with nothing of the phone in them so they can be tested; lib/waiting.ts connects them to
 * the speaker, the haptics and the screen.
 *
 * Owner, 2026-10-30: "a nice, cute, little artistic and beautiful ballad while the users are waiting for that first
 * picture ... And then a slow ramp, vibration, and then a ding when it's done ... Only if they're actively looking at a
 * picture being made."
 *
 * There is one loop for the whole app, so two waits never stack. It plays while some wait is being watched (its screen
 * in front, the app open), sounds are on, the microphone is closed and, on the web, the page has been touched. It fades
 * in over a second; it fades out when the picture lands, the screen is left or sounds are turned off; it stops at once
 * when the app goes to the background or the microphone opens, so none of it is recorded; and it drifts away once a
 * wait has gone on for 90 s. A landing that was being watched gets a slow haptic ramp, then the done chime with a
 * success tap.
 */

export const FADE_IN_MS = 1000;
export const FADE_OUT_MS = 600;
/** Past the cap the loop doesn't stop, it drifts away. */
export const CAP_FADE_MS = 3000;
export const CAP_MS = 90_000;
/** How often a fade moves the volume. */
export const STEP_MS = 50;

export type Tap = "light" | "medium" | "heavy" | "success";
/** The ramp as a picture lands: light, light, medium, heavy over about 0.8 s, then the chime with a success tap. */
export const RAMP: readonly { at: number; tap: "light" | "medium" | "heavy" }[] = [
  { at: 0, tap: "light" },
  { at: 260, tap: "light" },
  { at: 500, tap: "medium" },
  { at: 720, tap: "heavy" },
];
export const CHIME_AT = 940;

/** How many waits' start times are kept after they end, so a screen that comes back keeps its own 90 s. */
const REMEMBER = 48;

/** The loop's player, as much of it as the rules use. */
export interface Loop {
  volume: number;
  play(): void;
  pause(): void;
  seekTo(seconds: number): unknown;
}

export interface WaitingDeps {
  /** The loop's player, made on first use; null when it can't be made. */
  loop(): Loop | null;
  /** The done chime (it follows the sounds switch by itself). */
  chime(): void;
  tap(kind: Tap): void;
  /** A browser lets a page play sound only after the person has touched it. */
  mayPlay(): boolean;
  now(): number;
  later(fn: () => void, ms: number): unknown;
  cancel(timer: unknown): void;
}

/** What around the app decides whether anything may sound. */
export interface Surroundings {
  appActive: boolean;
  soundsOn: boolean;
  micOpen: boolean;
}

export type WaitingMusic = ReturnType<typeof waitingMusic>;

/** `level` is the volume the loop fades up to. */
export function waitingMusic(deps: WaitingDeps, level: number) {
  /** The waits under way, each with whether it is being watched. */
  const waits = new Map<string, boolean>();
  /** When each wait began, kept for a while after it ends. */
  const began = new Map<string, number>();
  /** Waits the loop has already played for: a new one starts the ballad from its top. */
  const heard = new Map<string, true>();
  let around: Surroundings = { appActive: true, soundsOn: false, micOpen: false };
  /** The player is playing, including while it fades out. */
  let running = false;
  let volume = 0;
  let fade: unknown = null;
  let cap: unknown = null;
  let landing = false;

  const remember = <T>(map: Map<string, T>, key: string, value: T) => {
    map.delete(key);
    map.set(key, value);
    for (const old of map.keys()) {
      if (map.size <= REMEMBER) break;
      if (!waits.has(old)) map.delete(old);
    }
  };
  const fresh = (key: string, t: number) => t - (began.get(key) ?? t) < CAP_MS;
  const allowed = () => around.appActive && around.soundsOn && !around.micOpen && deps.mayPlay();

  /** The waits the loop plays for right now: watched and under the cap, with sound allowed at all. */
  function audible(): string[] {
    if (!allowed()) return [];
    const t = deps.now();
    return [...waits].filter(([key, watched]) => watched && fresh(key, t)).map(([key]) => key);
  }

  function setVolume(v: number) {
    volume = v;
    try {
      const player = deps.loop();
      if (player) player.volume = v;
    } catch {}
  }

  function stopFade() {
    if (fade === null) return;
    deps.cancel(fade);
    fade = null;
  }

  /** Moves the volume to `target` on a raised cosine; `ms` is the time for a full swing, so a part swing is quicker. */
  function fadeTo(target: number, ms: number, then?: () => void) {
    stopFade();
    const from = volume;
    if (from === target) return then?.();
    const steps = Math.max(1, Math.round((ms * Math.abs(target - from)) / Math.max(level, 0.01) / STEP_MS));
    let i = 0;
    const step = () => {
      i++;
      setVolume(from + (target - from) * (0.5 - 0.5 * Math.cos((Math.PI * i) / steps)));
      if (i < steps) fade = deps.later(step, STEP_MS);
      else {
        fade = null;
        then?.();
      }
    };
    fade = deps.later(step, STEP_MS);
  }

  function start(keys: string[]) {
    const player = deps.loop();
    if (!player) return;
    const fromTop = keys.some((key) => !heard.has(key));
    keys.forEach((key) => remember(heard, key, true));
    if (!running) {
      try {
        if (fromTop) Promise.resolve(player.seekTo(0)).catch(() => {});
        setVolume(0);
        player.play();
      } catch {
        return;
      }
      running = true;
    }
    fadeTo(level, FADE_IN_MS);
  }

  function stop(ms: number) {
    if (!running) return;
    const end = () => {
      running = false;
      try {
        deps.loop()?.pause();
      } catch {}
    };
    if (ms > 0) return fadeTo(0, ms, end);
    stopFade();
    setVolume(0);
    end();
  }

  /** Why the loop goes quiet decides how: at once for the microphone or the background, slowly past the cap. */
  function quietMs(): number {
    if (around.micOpen || !around.appActive) return 0;
    const t = deps.now();
    const capped = allowed() && [...waits].some(([key, watched]) => watched && !fresh(key, t));
    return capped ? CAP_FADE_MS : FADE_OUT_MS;
  }

  function update() {
    const keys = audible();
    if (keys.length) start(keys);
    else stop(quietMs());
    if (cap !== null) deps.cancel(cap);
    cap = null;
    if (!keys.length) return;
    // Look again when the first of these waits reaches the cap.
    const t = deps.now();
    const next = Math.min(...keys.map((key) => (began.get(key) ?? t) + CAP_MS)) - t;
    cap = deps.later(() => {
      cap = null;
      update();
    }, Math.max(0, next) + 1);
  }

  return {
    /** A picture is being made for `key`; `watched` when its screen is the one in front. */
    wait(key: string, watched: boolean) {
      waits.set(key, watched);
      if (!began.has(key)) remember(began, key, deps.now());
      update();
    },
    /** The wait ended without a picture (it failed, or its screen went away). */
    release(key: string) {
      if (waits.delete(key)) update();
    },
    /** The picture landed: the loop fades, and if the person was watching, the ramp and then the chime. */
    land(key: string) {
      const watched = waits.get(key);
      if (watched === undefined) return;
      waits.delete(key);
      update();
      if (!watched || !around.appActive || around.micOpen || landing) return;
      landing = true;
      // Each step looks again: the app may have gone, or the microphone opened, since the picture landed.
      const quiet = () => !around.appActive || around.micOpen;
      for (const { at, tap } of RAMP) {
        deps.later(() => {
          if (!quiet()) deps.tap(tap);
        }, at);
      }
      deps.later(() => {
        landing = false;
        if (quiet()) return;
        deps.chime();
        deps.tap("success");
      }, CHIME_AT);
    },
    /** The app came or went, sounds were turned on or off, or the microphone opened or closed. */
    set(next: Partial<Surroundings>) {
      around = { ...around, ...next };
      update();
    },
    /** Whether the player should be running (a fade out still counts), so a player resumed behind its back can be paused. */
    running: () => running,
  };
}
