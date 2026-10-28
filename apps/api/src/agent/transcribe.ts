/**
 * Say your wish: the app records a short clip and the API sends it to Muse Voice Transcribe. Meta accepts only a mono
 * 16-bit PCM WAV at 16 or 24 kHz, so the clip is checked here before any paid call, and anything else is refused.
 */

/** One minute of 16 kHz mono 16-bit audio plus its header; a wish is a sentence, so this is generous. */
export const MAX_CLIP_SECONDS = 60;
export const MAX_CLIP_BYTES = 44 + MAX_CLIP_SECONDS * 24_000 * 2;
/** Shorter than this is a tap, not a wish. */
export const MIN_CLIP_MS = 300;
export const TRANSCRIBES_PER_USER_PER_DAY = 60;
/** Names people say about their wishes that a speech model tends to mishear; Meta biases recognition toward them. */
export const WISH_KEYWORDS = ["Porsche", "Leica", "Rolex", "Peloton", "Rimowa", "Range Rover", "Eames", "Vision Pro", "Amanzoe", "Amalfi", "Kyoto", "Lisbon", "Airbnb", "Tesla"];

export interface WavFormat {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  durationMs: number;
}

/** Reads a RIFF/WAVE header, walking the chunks, and returns its format; null when the bytes are not a PCM WAV. */
export function readWav(bytes: Uint8Array): WavFormat | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let fmt: Omit<WavFormat, "durationMs"> | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > bytes.length || view.getUint16(body, true) !== 1) return null;
      fmt = { channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bitsPerSample: view.getUint16(body + 14, true) };
    } else if (id === "data") {
      if (!fmt) return null;
      const dataBytes = Math.min(size, bytes.length - body);
      const bytesPerSecond = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8);
      return { ...fmt, durationMs: bytesPerSecond ? Math.round((dataBytes / bytesPerSecond) * 1000) : 0 };
    }
    at = body + size + (size % 2);
  }
  return null;
}

/** Why Meta would refuse this clip, in words for the person; null when it can be sent. */
export function clipProblem(f: WavFormat | null): string | null {
  if (!f) return "That recording didn't come through. Try again.";
  if (f.channels !== 1 || f.bitsPerSample !== 16 || (f.sampleRate !== 16_000 && f.sampleRate !== 24_000)) return "That recording format isn't supported.";
  if (f.durationMs < MIN_CLIP_MS) return "Hold on a moment longer, then say your wish.";
  if (f.durationMs > MAX_CLIP_SECONDS * 1000) return "Keep it under a minute.";
  return null;
}

/** The transcript as a wish: one line, a capital to start (Meta returns "a week at..."), within the field's limit. */
export function cleanTranscript(text: string, max = 300): string {
  const one = text.replace(/\s+/g, " ").trim();
  const cut = one.length > max ? one.slice(0, max).trimEnd() : one;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}
