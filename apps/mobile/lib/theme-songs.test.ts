import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_ORDER } from "./palette";
import { THEME_SONGS, songFor } from "./theme-songs";

const sounds = join(__dirname, "..", "assets", "sounds");

/** An MP4's length in seconds, from its movie header, which encode_loop's edit list sets to the loop itself. */
function seconds(file: string): number {
  const mp4 = readFileSync(file);
  const at = mp4.indexOf("mvhd");
  if (at < 0) throw new Error(`${file} has no movie header`);
  return mp4[at + 4] === 1 ? Number(mp4.readBigUInt64BE(at + 28)) / mp4.readUInt32BE(at + 24) : mp4.readUInt32BE(at + 20) / mp4.readUInt32BE(at + 16);
}

describe("each theme's own song (owner, 2026-10-30)", () => {
  it("gives every theme a song with a name of its own, one to three words", () => {
    expect(Object.keys(THEME_SONGS).sort()).toEqual([...THEME_ORDER].sort());
    const names = THEME_ORDER.map((id) => THEME_SONGS[id].name);
    for (const name of names) {
      expect(name).toMatch(/^\S+( \S+){0,2}$/);
      // A hint, never a label: it doesn't say what it is.
      expect(name).not.toMatch(/song|music|tune|theme/i);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("ships each song as a loop of 40 to 70 s, under 1 MB, a whole number of AAC frames long", () => {
    for (const id of THEME_ORDER) {
      const file = join(sounds, THEME_SONGS[id].file);
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size).toBeLessThan(1_000_000);
      const length = seconds(file);
      expect(length).toBeGreaterThanOrEqual(40);
      expect(length).toBeLessThanOrEqual(70);
      // A loop ending inside a frame ticks at its seam on some players (scripts/make-theme-songs.py).
      expect(Math.round(length * 48_000) % 1_024).toBe(0);
    }
  });

  it("is loaded by lib/sound.ts, file for file", () => {
    const sound = readFileSync(join(__dirname, "sound.ts"), "utf8");
    for (const id of THEME_ORDER) expect(sound).toContain(`${id}: require("../assets/sounds/${THEME_SONGS[id].file}")`);
    expect(sound).toContain('wait: require("../assets/sounds/wait.m4a")');
  });

  it("waits to the theme's song, and to the ballad for a theme it doesn't know", () => {
    for (const id of THEME_ORDER) expect(songFor(id)).toBe(id);
    for (const unknown of ["teal", "", null, undefined, "constructor", "toString"]) expect(songFor(unknown)).toBe("wait");
  });
});
