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
 *
 * The loop is the theme's own song (owner, 2026-10-30: "Different beautiful music for every different theme"). A theme
 * changed while it plays fades the old song out and starts the new one from its top.
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
  /** A song's loop player, made on first use; null when it can't be made. */
  loop(song: string): Loop | null;
  /** A song that is no longer the one chosen has stopped: its player can be let go. */
  drop?(song: string): void;
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

/** `level` is the volume the loop fades up to; `first` the song it plays until it is told the theme's. */
export function waitingMusic(deps: WaitingDeps, level: number, first = "wait") {
  /** The waits under way, each with whether it is being watched. */
  const waits = new Map<string, boolean>();
  /** When each wait began, kept for a while after it ends. */
  const began = new Map<string, number>();
  /** Songs each wait has already heard: a new wait, or a new song, starts from its top. */
  const heard = new Map<string, true>();
  let around: Surroundings = { appActive: true, soundsOn: false, micOpen: false };
  /** The song the theme asks for. */
  let chosen = first;
  /** The song whose player is playing, including while it fades out; null when none is. */
  let playing: string | null = null;
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
  const hearing = (key: string) => `${chosen}\n${key}`;

  /** The waits the loop plays for right now: watched and under the cap, with sound allowed at all. */
  function audible(): string[] {
    if (!allowed()) return [];
    const t = deps.now();
    return [...waits].filter(([key, watched]) => watched && fresh(key, t)).map(([key]) => key);
  }

  function setVolume(v: number) {
    volume = v;
    try {
      const player = deps.loop(playing ?? chosen);
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
    const player = deps.loop(chosen);
    if (!player) return;
    const fromTop = keys.some((key) => !heard.has(hearing(key)));
    keys.forEach((key) => remember(heard, hearing(key), true));
    if (playing === null) {
      try {
        if (fromTop) Promise.resolve(player.seekTo(0)).catch(() => {});
        setVolume(0);
        player.play();
      } catch {
        return;
      }
      playing = chosen;
    }
    fadeTo(level, FADE_IN_MS);
  }

  /** Fades the playing song out over `ms` (at once for 0), pauses it, then calls `then`. */
  function stop(ms: number, then?: () => void) {
    if (playing === null) return then?.();
    const end = () => {
      const song = playing!;
      playing = null;
      try {
        deps.loop(song)?.pause();
      } catch {}
      if (song !== chosen) deps.drop?.(song);
      then?.();
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
    // The theme changed under the music: the old song fades away, then this looks again and starts the new one.
    if (keys.length && playing !== null && playing !== chosen) stop(FADE_OUT_MS, update);
    else if (keys.length) start(keys);
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
    /** The theme's song (lib/theme-songs.ts). One that isn't playing is let go at once; one that is, once it fades. */
    song(next: string) {
      if (next === chosen) return;
      const old = chosen;
      chosen = next;
      if (playing !== old) deps.drop?.(old);
      update();
    },
    /**
     * Whether a player should be running (a fade out still counts): any, or `song`'s. So a player resumed behind the
     * music's back can be paused.
     */
    running: (song?: string) => playing !== null && (song === undefined || song === playing),
  };
}
