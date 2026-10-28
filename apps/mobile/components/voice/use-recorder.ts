import type { RecorderOptions, Recorder } from "./recorder-types";

/**
 * Phones: recording needs a native audio module, which isn't in this build yet, so voice is off and the button
 * doesn't show. The web build (use-recorder.web.ts) records with the browser's own microphone API.
 */
export function useRecorder(_opts: RecorderOptions): Recorder {
  return { supported: false, listening: false, levels: [], elapsedMs: 0, start: async () => {}, stop: () => {}, cancel: () => {} };
}
