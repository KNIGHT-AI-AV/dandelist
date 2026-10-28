/** Why listening ended on its own, or because the person tapped. "silent" means nothing was said. */
export type StopReason = "tap" | "done" | "limit" | "silent";

export interface RecorderOptions {
  /** A finished clip: a 16 kHz mono 16-bit WAV, ready for Muse Voice Transcribe. */
  onClip(wav: Uint8Array, why: StopReason): void;
  /** Something the person should read: no microphone, permission refused, nothing heard. */
  onError(message: string): void;
  maxMs?: number;
}

export interface Recorder {
  supported: boolean;
  listening: boolean;
  /** The most recent loudness readings, 0..1, oldest first, for the listening bars. */
  levels: number[];
  elapsedMs: number;
  start(): Promise<void>;
  /** Finish now and hand over the clip. */
  stop(): void;
  /** Throw the recording away. */
  cancel(): void;
}

export const BARS = 28;
export const MAX_LISTEN_MS = 60_000;
