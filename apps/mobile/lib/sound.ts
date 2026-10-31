import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { getSecret, setSecret } from "./storage";
import type { SongId } from "./theme-songs";

/**
 * Dandelist's few sounds (owner, 2026-10-29: "high-quality felted cinematic sound effects, luxury"), made from scratch
 * by scripts/make-sounds.py: a felt piano chord as the name appears, air opening over the list's reveal, music that loops
 * while a picture is being made (lib/waiting.ts), and a felted bell when it lands. The waiting music is the theme's own
 * song, from scripts/make-theme-songs.py, or the felt piano ballad. They follow the phone's silent switch, play under
 * whatever else is playing without stopping it, never play into the microphone, and can be turned off in settings. A
 * sound never throws: it is never worth an error.
 */
export type SoundId = "title" | "swell" | "done";

const SOURCES: Record<SoundId, number> = {
  title: require("../assets/sounds/title.m4a"),
  swell: require("../assets/sounds/swell.m4a"),
  done: require("../assets/sounds/done.m4a"),
};
/** The waiting loops, file for file with lib/theme-songs.ts. */
const LOOPS: Record<SongId, number> = {
  wait: require("../assets/sounds/wait.m4a"),
  emerald: require("../assets/sounds/theme-emerald.m4a"),
  bordeaux: require("../assets/sounds/theme-bordeaux.m4a"),
  noir: require("../assets/sounds/theme-noir.m4a"),
  ivory: require("../assets/sounds/theme-ivory.m4a"),
  delina: require("../assets/sounds/theme-delina.m4a"),
  sapphire: require("../assets/sounds/theme-sapphire.m4a"),
  cognac: require("../assets/sounds/theme-cognac.m4a"),
  amethyst: require("../assets/sounds/theme-amethyst.m4a"),
  riviera: require("../assets/sounds/theme-riviera.m4a"),
};
/** Each one sits under the phone's own sounds, so it reads as texture, never as an alert. */
const LEVEL: Record<SoundId, number> = { title: 0.7, swell: 0.45, done: 0.45 };
/** Where the waiting music fades to. Every song is made at the ballad's loudness, so one level serves them all. */
export const WAIT_LEVEL = 0.6;
const KEY = "dandelist.sounds";

let enabled = true;
/** The setting has been read and the audio mode set: until then, nothing long starts. */
let loaded = false;
/** The microphone is open (a wish being said): nothing plays until it closes. */
let micOpen = false;
let ready: Promise<void> | null = null;
const players = new Map<SoundId, AudioPlayer>();
const loops = new Map<SongId, AudioPlayer>();
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

/** False once sounds are turned off: for the web fader's tick, which is synthesised rather than played from a file. */
export const soundsEnabled = (): boolean => enabled;

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
      player.volume = LEVEL[id];
      players.set(id, player);
    }
    return player;
  } catch {
    return null;
  }
}

/** A waiting loop's player (lib/waiting.ts), made on first use. It loops, and starts silent for lib/waiting.ts to fade. */
export function loopPlayer(song: SongId): AudioPlayer | null {
  try {
    let player = loops.get(song);
    if (!player) {
      player = createAudioPlayer(LOOPS[song]);
      player.loop = true;
      player.volume = 0;
      loops.set(song, player);
    }
    return player;
  } catch {
    return null;
  }
}

/** Lets a waiting loop's player go, once the theme has moved on to another song. */
export function dropLoop(song: SongId): void {
  const player = loops.get(song);
  if (!player) return;
  loops.delete(song);
  try {
    player.remove();
  } catch {}
}

/** A browser refuses sound until the person has touched the page; asking anyway only fills its console. */
export const mayPlay = () => Platform.OS !== "web" || (globalThis.navigator as { userActivation?: { hasBeenActive: boolean } } | undefined)?.userActivation?.hasBeenActive !== false;

/** Loads sounds ahead of their moment, so the first one plays on time. */
export function preloadSounds(...ids: SoundId[]): void {
  void prepare().then(() => ids.forEach(playerOf));
}

/** Loads a waiting loop ahead of its wait. */
export function preloadLoop(song: SongId): void {
  void prepare().then(() => loopPlayer(song));
}

/** Plays a sound from its start; nothing when sounds are off or the microphone is open. The loops have their own way in. */
export function play(id: SoundId): void {
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
