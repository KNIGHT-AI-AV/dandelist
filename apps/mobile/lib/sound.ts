import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { getSecret, setSecret } from "./storage";

/**
 * Dandelist's few sounds (owner, 2026-10-29: "high-quality felted cinematic sound effects, luxury"), made from scratch
 * by scripts/make-sounds.py: a felt piano chord as the name appears, three soft rising notes when a first card lands,
 * and air opening over the list's reveal. They follow the phone's silent switch, play under whatever else is playing
 * without stopping it, and can be turned off in settings. A sound never throws: it is never worth an error.
 */
export type SoundId = "title" | "land" | "swell";

const SOURCES: Record<SoundId, number> = {
  title: require("../assets/sounds/title.m4a"),
  land: require("../assets/sounds/land.m4a"),
  swell: require("../assets/sounds/swell.m4a"),
};
/** Each one sits under the phone's own sounds, so it reads as texture, never as an alert. */
const LEVEL: Record<SoundId, number> = { title: 0.7, land: 0.55, swell: 0.45 };
const KEY = "dandelist.sounds";

let enabled = true;
let ready: Promise<void> | null = null;
const players = new Map<SoundId, AudioPlayer>();
const listeners = new Set<(on: boolean) => void>();

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
  })();
  return ready;
}

/** Puts the phone's audio back the way the sounds play, after the microphone has set it up for recording. */
export async function resumeSounds(): Promise<void> {
  try {
    await setAudioModeAsync(MODE);
  } catch {}
}

function playerOf(id: SoundId): AudioPlayer | null {
  try {
    let player = players.get(id);
    if (!player) {
      player = createAudioPlayer(SOURCES[id]);
      player.volume = LEVEL[id];
      players.set(id, player);
    }
    return player;
  } catch {
    return null;
  }
}

/** A browser refuses sound until the person has touched the page; asking anyway only fills its console. */
const mayPlay = () => Platform.OS !== "web" || (globalThis.navigator as { userActivation?: { hasBeenActive: boolean } } | undefined)?.userActivation?.hasBeenActive !== false;

/** Loads sounds ahead of their moment, so the first one plays on time. */
export function preloadSounds(...ids: SoundId[]): void {
  void prepare().then(() => ids.forEach(playerOf));
}

/** Plays a sound from its start; nothing when sounds are off. */
export function play(id: SoundId): void {
  void prepare().then(async () => {
    if (!enabled || !mayPlay()) return;
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
  };
  return [on, set];
}
