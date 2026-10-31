import type { ThemeId } from "./palette";

/**
 * Each theme's own song (owner, 2026-10-30: "Different beautiful music for every different theme"), written and played
 * from scratch by scripts/make-theme-songs.py. While a picture is being made, lib/waiting.ts plays the current theme's
 * song in place of the ballad. Its name shows in small print with a little note under the theme, in the chooser and in
 * settings (components/song-note.tsx): "a little hint that the theme contains a different song, but we don't directly
 * say it".
 */
export interface ThemeSong {
  /** What the hint says. */
  name: string;
  /** In assets/sounds, loaded by lib/sound.ts. */
  file: string;
}

export const THEME_SONGS: Record<ThemeId, ThemeSong> = {
  emerald: { name: "Moss Lantern", file: "theme-emerald.m4a" },
  bordeaux: { name: "Velvet Hour", file: "theme-bordeaux.m4a" },
  noir: { name: "Midnight Pearl", file: "theme-noir.m4a" },
  ivory: { name: "Porcelain Dawn", file: "theme-ivory.m4a" },
  delina: { name: "Rosewater", file: "theme-delina.m4a" },
  sapphire: { name: "Silver Current", file: "theme-sapphire.m4a" },
  cognac: { name: "Hearthlight", file: "theme-cognac.m4a" },
  amethyst: { name: "Plum Twilight", file: "theme-amethyst.m4a" },
  riviera: { name: "Sunlit Harbor", file: "theme-riviera.m4a" },
};

/** The loops a wait can play: the ballad from scripts/make-sounds.py, or a theme's song. */
export type SongId = "wait" | ThemeId;

/** The song to wait to: the theme's own, or the ballad for a theme this doesn't know. */
export function songFor(theme: string | null | undefined): SongId {
  return theme && Object.prototype.hasOwnProperty.call(THEME_SONGS, theme) ? (theme as ThemeId) : "wait";
}
