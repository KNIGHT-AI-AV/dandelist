/**
 * The clip Muse Voice Transcribe takes: a RIFF/WAVE file of mono 16-bit PCM at 16 kHz. Browsers record at 44.1 or
 * 48 kHz in floats, so the samples are averaged down to 16 kHz (the averaging is the low-pass that keeps the
 * downsampling from aliasing) and then written as integers behind a 44-byte header.
 */
export const CLIP_RATE = 16_000;

/** Joins recorded chunks and averages them down from `inputRate` to `outputRate`. */
export function downsample(chunks: Float32Array[], inputRate: number, outputRate = CLIP_RATE): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  if (inputRate === outputRate) return all;
  const ratio = inputRate / outputRate;
  const out = new Float32Array(Math.floor(total / ratio));
  for (let i = 0; i < out.length; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(total, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += all[j]!;
    out[i] = to > from ? sum / (to - from) : 0;
  }
  return out;
}

/** A mono 16-bit PCM WAV of `samples` (floats in -1..1) at `rate`. */
export function encodeWav(samples: Float32Array, rate = CLIP_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  tag(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** How loud a chunk is, 0..1, as a root mean square: what the listening bars draw and what decides "still talking". */
export function levelOf(chunk: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) sum += chunk[i]! * chunk[i]!;
  return Math.sqrt(sum / Math.max(1, chunk.length));
}

/**
 * When to stop listening on its own, like a person would: after the wish has been said and a pause follows, or when
 * nothing has been said for a while. `spokeAt` is the last moment the level was above speech, null before any.
 */
export const SPEECH_LEVEL = 0.02;
export const PAUSE_MS = 1600;
export const NOTHING_MS = 8000;
export function shouldStop(now: number, startedAt: number, spokeAt: number | null, maxMs: number): "done" | "silent" | "limit" | null {
  if (now - startedAt >= maxMs) return "limit";
  if (spokeAt === null) return now - startedAt >= NOTHING_MS ? "silent" : null;
  return now - spokeAt >= PAUSE_MS ? "done" : null;
}
