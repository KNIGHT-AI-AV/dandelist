import { describe, expect, it } from "vitest";
import { NOTHING_MS, PAUSE_MS, downsample, encodeWav, levelOf, shouldStop } from "./wav";

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
