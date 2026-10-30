import { useIsFocused } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { haptic } from "./motion";
import { WAIT_LEVEL, loopPlayer, mayPlay, play, preloadSounds, soundsNow, watchSounds } from "./sound";
import { waitingMusic } from "./waiting-core";

/**
 * The waiting music on the phone: the ballad from scripts/make-sounds.py while a picture is being made, and the ramp and
 * chime when it lands (owner, 2026-10-30). The rules are in lib/waiting-core.ts; this connects them to expo-audio, the
 * haptics, the app coming and going, the sounds switch and the microphone.
 */
const music = waitingMusic(
  {
    loop: loopPlayer,
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
  preloadSounds("wait", "done");
  const active = (state: string | null | undefined) => state !== "background" && state !== "inactive";
  music.set({ appActive: active(AppState.currentState), ...soundsNow() });
  AppState.addEventListener("change", (state) => music.set({ appActive: active(state) }));
  watchSounds(() => music.set(soundsNow()));
  // Going to the background, expo-audio pauses the loop itself and resumes it on the way back: it plays on only if the
  // music still wants it.
  try {
    loopPlayer()?.addListener("playbackStatusUpdate", (status) => {
      if (status.playing && !music.running()) loopPlayer()?.pause();
    });
  } catch {}
}

/** Where a picture stands: still being made, just landed, or neither (not started, failed, or given up). */
export type WaitPhase = "waiting" | "landed" | "idle";

let serial = 0;

/**
 * The music for one picture being made. It plays while `phase` is "waiting" and this screen is in front (`watched` is
 * false for a page of the home ring that has been swiped away); when `phase` turns "landed" in front of the person, the
 * ramp and the chime. Each turn into "waiting" is a new wait: the ballad starts from its top, with its own 90 s.
 */
export function useWaitingMusic(phase: WaitPhase, watched = true): void {
  const focused = useIsFocused();
  const seen = watched && focused;
  const key = useRef<string | null>(null);
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
