import { describe, expect, it } from "vitest";
import { MAX_GAIN, NOTHING_MS, PAUSE_MS, QUIET_LEVEL, SPEECH_LEVEL, downsample, encodeWav, levelOf, louder, monoOf, shouldStop, speechBar } from "./wav";

describe("voice clips", () => {
  it("averages 48 kHz chunks down to 16 kHz, across chunk edges", () => {
    const a = new Float32Array([0.3, 0.3, 0.3, 0.6]);
    const b = new Float32Array([0.6, 0.6]);
    expect(Array.from(downsample([a, b], 48_000))).toEqual([expect.closeTo(0.3, 6), expect.closeTo(0.6, 6)]);
    expect(downsample([a], 16_000)).toHaveLength(4);
    expect(downsample([new Float32Array(44_100)], 44_100)).toHaveLength(16_000);
  });

  it("writes the mono 16-bit PCM WAV Meta accepts", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]));
    const v = new DataView(wav.buffer);
    const tag = (at: number) => String.fromCharCode(...wav.slice(at, at + 4));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect([1, 2, 3, 4].map((i) => v.getInt16(42 + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });

  it("measures loudness and stops like a person would", () => {
    expect(levelOf(new Float32Array(10))).toBe(0);
    expect(levelOf(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    const max = 60_000;
    expect(shouldStop(1000, 0, null, max)).toBeNull();
    expect(shouldStop(NOTHING_MS, 0, null, max)).toBe("silent");
    expect(shouldStop(3000, 0, 2500, max)).toBeNull();
    expect(shouldStop(2500 + PAUSE_MS, 0, 2500, max)).toBe("done");
    expect(shouldStop(max, 0, max - 10, max)).toBe("limit");
  });
});

describe("phone clips", () => {
  it("draws the line between speech and the room from the room", () => {
    // Before anything is heard, the browser's line; a quiet room lowers it, never below the floor.
    expect(speechBar(Infinity)).toBe(SPEECH_LEVEL);
    expect(speechBar(0.001)).toBeCloseTo(0.003, 9);
    expect(speechBar(0)).toBe(QUIET_LEVEL);
    expect(speechBar(0.5)).toBe(SPEECH_LEVEL);
  });

  it("averages interleaved channels into one, and copies a mono buffer", () => {
    expect(Array.from(monoOf(new Float32Array([0.2, 0.4, -0.2, 0.2]), 2))).toEqual([expect.closeTo(0.3, 6), expect.closeTo(0, 6)]);
    const mono = new Float32Array([0.1, 0.2]);
    const copy = monoOf(mono, 1);
    copy[0] = 0.9;
    expect(mono[0]).toBeCloseTo(0.1);
  });

  it("brings a quiet clip up to a clear level, by at most MAX_GAIN, and never turns one down", () => {
    expect(Math.max(...louder(new Float32Array([0.09, -0.045])))).toBeCloseTo(0.9);
    expect(Math.max(...louder(new Float32Array([0.001])))).toBeCloseTo(0.001 * MAX_GAIN);
    const loud = new Float32Array([0.95, -0.5]);
    expect(louder(loud)).toBe(loud);
    expect(Array.from(louder(new Float32Array(3)))).toEqual([0, 0, 0]);
  });
});
