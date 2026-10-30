import { requestRecordingPermissionsAsync, useAudioStream } from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { resumeSounds } from "../../lib/sound";
import { CLIP_RATE, SPEECH_LEVEL, downsample, encodeWav, levelOf, louder, monoOf, shouldStop, speechBar } from "../../lib/wav";
import { BARS, MAX_LISTEN_MS, type Recorder, type RecorderOptions, type StopReason } from "./recorder-types";

type Live = {
  chunks: Float32Array[];
  rate: number;
  startedAt: number;
  spokeAt: number | null;
  quietest: number;
  loudest: number;
  ring: number[];
  timer?: ReturnType<typeof setInterval>;
};

/** How often the pause check runs, whether or not new sound has come in. */
const CHECK_MS = 250;

/**
 * Phones: expo-audio's microphone stream hands over mono floats about ten times a second, asked for at 16 kHz (each
 * buffer says its real rate, and anything else is averaged down as on the web). The same pause and silence rules as
 * the web end it, and the clip is the same 16 kHz WAV. A phone has no browser gain control, so the line between
 * speech and the room follows the room (speechBar), the bars are drawn against that line, and the clip is brought up
 * to a clear level before it goes.
 */
export function useRecorder({ onClip, onError, maxMs = MAX_LISTEN_MS }: RecorderOptions): Recorder {
  const [listening, setListening] = useState(false);
  const [levels, setLevels] = useState<number[]>([]);
  const [elapsedMs, setElapsed] = useState(0);
  const live = useRef<Live | null>(null);
  const handlers = useRef({ onClip, onError });
  handlers.current = { onClip, onError };

  const { stream } = useAudioStream({
    sampleRate: CLIP_RATE,
    channels: 1,
    encoding: "float32",
    onBuffer: (b) => {
      const l = live.current;
      if (!l) return;
      const chunk = monoOf(new Float32Array(b.data), b.channels);
      l.chunks.push(chunk);
      l.rate = b.sampleRate;
      const level = levelOf(chunk);
      l.quietest = Math.min(l.quietest, level);
      l.loudest = Math.max(l.loudest, level);
      const bar = speechBar(l.quietest);
      if (level > bar) l.spokeAt = Date.now();
      l.ring.push(Math.min(1, level * (SPEECH_LEVEL / bar)));
      if (l.ring.length > BARS) l.ring.shift();
      setLevels(l.ring.slice());
    },
  });

  const end = useCallback(
    (why: StopReason | "cancel") => {
      const l = live.current;
      if (!l) return;
      live.current = null;
      clearInterval(l.timer);
      try {
        stream.stop();
      } catch {}
      // The stream leaves the phone's audio set up for recording; the app's sounds need it back.
      void resumeSounds();
      setListening(false);
      setLevels([]);
      setElapsed(0);
      if (why === "cancel") return;
      // Nothing crossed the line, but something was louder than the room: let the transcription decide.
      const heard = why !== "silent" || l.loudest >= l.quietest * 2;
      if (!heard || !l.chunks.length) return handlers.current.onError("Didn't hear anything. Try again a little closer.");
      handlers.current.onClip(encodeWav(louder(downsample(l.chunks, l.rate))), why === "silent" ? "done" : why);
    },
    [stream],
  );

  const start = useCallback(async () => {
    if (live.current) return;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) return handlers.current.onError("Allow the microphone in Settings to say your wish, or type it.");
    } catch {
      return handlers.current.onError("Couldn't open a microphone. Type it instead.");
    }
    if (live.current) return;
    const l: Live = { chunks: [], rate: CLIP_RATE, startedAt: Date.now(), spokeAt: null, quietest: Infinity, loudest: 0, ring: [] };
    live.current = l;
    try {
      await stream.start();
    } catch {
      if (live.current === l) live.current = null;
      void resumeSounds();
      return handlers.current.onError("Couldn't open a microphone. Type it instead.");
    }
    // Cancelled while the microphone was opening: close it again.
    if (live.current !== l) {
      try {
        stream.stop();
      } catch {}
      void resumeSounds();
      return;
    }
    l.startedAt = Date.now();
    l.timer = setInterval(() => {
      const now = Date.now();
      setElapsed(now - l.startedAt);
      const why = shouldStop(now, l.startedAt, l.spokeAt, maxMs);
      if (why) end(why);
    }, CHECK_MS);
    setListening(true);
  }, [stream, maxMs, end]);

  useEffect(() => () => end("cancel"), [end]);

  return { supported: true, listening, levels, elapsedMs, start, stop: () => end("tap"), cancel: () => end("cancel") };
}
