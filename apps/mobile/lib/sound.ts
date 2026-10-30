import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { getSecret, setSecret } from "./storage";

/**
 * Dandelist's few sounds (owner, 2026-10-29: "high-quality felted cinematic sound effects, luxury"), made from scratch
 * by scripts/make-sounds.py: a felt piano chord as the name appears, air opening over the list's reveal, a felt piano
 * ballad that loops while a picture is being made (lib/waiting.ts), and a felted bell when it lands. They follow the
 * phone's silent switch, play under whatever else is playing without stopping it, never play into the microphone, and
 * can be turned off in settings. A sound never throws: it is never worth an error.
 */
export type SoundId = "title" | "swell" | "wait" | "done";

const SOURCES: Record<SoundId, number> = {
  title: require("../assets/sounds/title.m4a"),
  swell: require("../assets/sounds/swell.m4a"),
  wait: require("../assets/sounds/wait.m4a"),
  done: require("../assets/sounds/done.m4a"),
};
/** Each one sits under the phone's own sounds, so it reads as texture, never as an alert. The wait's is where it fades to. */
const LEVEL: Record<SoundId, number> = { title: 0.7, swell: 0.45, wait: 0.6, done: 0.45 };
export const WAIT_LEVEL = LEVEL.wait;
const KEY = "dandelist.sounds";

let enabled = true;
/** The setting has been read and the audio mode set: until then, nothing long starts. */
let loaded = false;
/** The microphone is open (a wish being said): nothing plays until it closes. */
let micOpen = false;
let ready: Promise<void> | null = null;
const players = new Map<SoundId, AudioPlayer>();
const listeners = new Set<(on: boolean) => void>();
const watchers = new Set<() => void>();
const changed = () => watchers.forEach((w) => w());

/** How the sounds play: under whatever else is playing, following the silent switch, never in the background. */
const MODE = { playsInSilentMode: false, interruptionMode: "mixWithOthers", shouldPlayInBackground: false, allowsRecording: false } as const;

function prepare(): Promise<void> {
  ready ??= (async () => {
    try {
      enabled = (await getSecret(KEY)) !== "off";
    } catch {}
    try {
      await setAudioModeAsync(MODE);
    } catch {}
    loaded = true;
    changed();
  })();
  return ready;
}

/** The microphone is about to open: the waiting music stops at once and nothing plays until resumeSounds. */
export function holdSounds(): void {
  if (micOpen) return;
  micOpen = true;
  changed();
}

/** Puts the phone's audio back the way the sounds play, after the microphone has set it up for recording. */
export async function resumeSounds(): Promise<void> {
  try {
    await setAudioModeAsync(MODE);
  } catch {}
  if (!micOpen) return;
  micOpen = false;
  changed();
}

/** What the waiting music needs to know now: whether sounds may play, and whether the microphone is open. */
export function soundsNow(): { soundsOn: boolean; micOpen: boolean } {
  return { soundsOn: loaded && enabled, micOpen };
}

/** Calls `fn` whenever soundsNow() may have changed. */
export function watchSounds(fn: () => void): () => void {
  watchers.add(fn);
  void prepare();
  return () => void watchers.delete(fn);
}

function playerOf(id: SoundId): AudioPlayer | null {
  try {
    let player = players.get(id);
    if (!player) {
      player = createAudioPlayer(SOURCES[id]);
      // The waiting loop starts silent and loops; lib/waiting.ts fades it.
      if (id === "wait") player.loop = true;
      player.volume = id === "wait" ? 0 : LEVEL[id];
      players.set(id, player);
    }
    return player;
  } catch {
    return null;
  }
}

/** The waiting loop's player (lib/waiting.ts), made on first use. */
export const loopPlayer = (): AudioPlayer | null => playerOf("wait");

/** A browser refuses sound until the person has touched the page; asking anyway only fills its console. */
export const mayPlay = () => Platform.OS !== "web" || (globalThis.navigator as { userActivation?: { hasBeenActive: boolean } } | undefined)?.userActivation?.hasBeenActive !== false;

/** Loads sounds ahead of their moment, so the first one plays on time. */
export function preloadSounds(...ids: SoundId[]): void {
  void prepare().then(() => ids.forEach(playerOf));
}

/** Plays a sound from its start; nothing when sounds are off or the microphone is open. The loop has its own way in. */
export function play(id: Exclude<SoundId, "wait">): void {
  void prepare().then(async () => {
    if (!enabled || micOpen || !mayPlay()) return;
    const player = playerOf(id);
    if (!player) return;
    try {
      await player.seekTo(0);
      player.play();
    } catch {}
  });
}

/** Whether sounds are on, for the switch in settings; changing it applies at once and is remembered. */
export function useSoundsOn(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(enabled);
  useEffect(() => {
    void prepare().then(() => setOn(enabled));
    listeners.add(setOn);
    return () => void listeners.delete(setOn);
  }, []);
  const set = (next: boolean) => {
    enabled = next;
    void setSecret(KEY, next ? null : "off");
    listeners.forEach((l) => l(next));
    changed();
  };
  return [on, set];
}
