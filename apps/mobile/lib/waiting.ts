import { useIsFocused } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { haptic } from "./motion";
import { WAIT_LEVEL, dropLoop, loopPlayer, mayPlay, play, preloadLoop, preloadSounds, soundsNow, watchSounds } from "./sound";
import { useTheme } from "./theme";
import { songFor, type SongId } from "./theme-songs";
import { waitingMusic } from "./waiting-core";

/**
 * The waiting music on the phone: the theme's own song while a picture is being made (lib/theme-songs.ts, or the ballad
 * from scripts/make-sounds.py for a theme it doesn't know), and the ramp and chime when it lands (owner, 2026-10-30). The
 * rules are in lib/waiting-core.ts; this connects them to expo-audio, the haptics, the theme, the app coming and going,
 * the sounds switch and the microphone.
 */
const listened = new WeakSet<object>();

/**
 * A song's player. Going to the background, expo-audio pauses a player itself and resumes it on the way back: it plays
 * on only if the music still wants that song.
 */
function loop(song: string) {
  const player = loopPlayer(song as SongId);
  if (player && !listened.has(player)) {
    listened.add(player);
    try {
      player.addListener("playbackStatusUpdate", (status) => {
        if (status.playing && !music.running(song)) player.pause();
      });
    } catch {}
  }
  return player;
}

const music = waitingMusic(
  {
    loop,
    drop: (song) => dropLoop(song as SongId),
    chime: () => play("done"),
    tap: (kind) => (kind === "success" ? haptic.success() : haptic.impact(kind)),
    mayPlay,
    now: Date.now,
    later: (fn, ms) => setTimeout(fn, ms),
    cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  },
  WAIT_LEVEL,
);

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  preloadSounds("done");
  const active = (state: string | null | undefined) => state !== "background" && state !== "inactive";
  music.set({ appActive: active(AppState.currentState), ...soundsNow() });
  AppState.addEventListener("change", (state) => music.set({ appActive: active(state) }));
  watchSounds(() => music.set(soundsNow()));
}

/** Where a picture stands: still being made, just landed, or neither (not started, failed, or given up). */
export type WaitPhase = "waiting" | "landed" | "idle";

let serial = 0;

/**
 * The music for one picture being made. It plays while `phase` is "waiting" and this screen is in front (`watched` is
 * false for a page of the home ring that has been swiped away); when `phase` turns "landed" in front of the person, the
 * ramp and the chime. Each turn into "waiting" is a new wait: the song starts from its top, with its own 90 s. The song
 * is the person's theme's, and follows it when it changes.
 */
export function useWaitingMusic(phase: WaitPhase, watched = true): void {
  const focused = useIsFocused();
  const seen = watched && focused;
  const theme = useTheme().chosen;
  const key = useRef<string | null>(null);
  useEffect(() => {
    wire();
    const song = songFor(theme);
    music.song(song);
    preloadLoop(song);
  }, [theme]);
  useEffect(() => {
    wire();
    if (phase === "waiting") {
      key.current ??= `wait-${++serial}`;
      music.wait(key.current, seen);
      return;
    }
    const ended = key.current;
    key.current = null;
    if (ended && phase === "landed") music.land(ended);
    else if (ended) music.release(ended);
  }, [phase, seen]);
  // A screen that goes away mid-wait ends it quietly.
  useEffect(
    () => () => {
      if (key.current) music.release(key.current);
    },
    [],
  );
}
