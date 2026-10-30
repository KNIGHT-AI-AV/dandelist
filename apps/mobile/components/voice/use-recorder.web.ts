import { useCallback, useEffect, useRef, useState } from "react";
import { holdSounds, resumeSounds } from "../../lib/sound";
import { SPEECH_LEVEL, downsample, encodeWav, levelOf, shouldStop } from "../../lib/wav";
import { BARS, MAX_LISTEN_MS, type Recorder, type RecorderOptions, type StopReason } from "./recorder-types";

type Live = { ctx: AudioContext; stream: MediaStream; recorder: MediaRecorder; analyser: AnalyserNode; source: MediaStreamAudioSourceNode; chunks: Blob[]; timer: ReturnType<typeof setInterval>; startedAt: number; spokeAt: number | null };

/** How often the level bars and the pause check read the microphone. */
const READ_MS = 50;

/**
 * The browser's microphone. The browser's own recorder keeps the audio off the main thread (a ScriptProcessor on
 * the main thread doubled syllables whenever the page was busy animating; QA 2026-10-28), an analyser feeds the
 * level bars and the pause check, and when listening ends the recording is decoded, averaged down to 16 kHz mono
 * and written as the WAV Muse Voice Transcribe takes. It ends on a tap, after a pause once the wish is said, when
 * nothing is said for a while, or at the one-minute limit. Echo cancellation and noise suppression are the
 * browser's own.
 */
export function useRecorder({ onClip, onError, maxMs = MAX_LISTEN_MS }: RecorderOptions): Recorder {
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window !== "undefined" && "AudioContext" in window && "MediaRecorder" in window;
  const [listening, setListening] = useState(false);
  const [levels, setLevels] = useState<number[]>([]);
  const [elapsedMs, setElapsed] = useState(0);
  const live = useRef<Live | null>(null);
  const handlers = useRef({ onClip, onError });
  handlers.current = { onClip, onError };

  const end = useCallback((why: StopReason | "cancel") => {
    const l = live.current;
    if (!l) return;
    live.current = null;
    clearInterval(l.timer);
    // The microphone has stopped taking sound: the app's sounds may play again.
    void resumeSounds();
    setListening(false);
    setLevels([]);
    setElapsed(0);
    const close = () => {
      l.source.disconnect();
      l.stream.getTracks().forEach((t) => t.stop());
      void l.ctx.close().catch(() => {});
    };
    if (why === "cancel" || why === "silent") {
      l.recorder.onstop = close;
      if (l.recorder.state !== "inactive") l.recorder.stop();
      else close();
      if (why === "silent") handlers.current.onError("Didn't hear anything. Try again a little closer.");
      return;
    }
    l.recorder.onstop = async () => {
      try {
        const blob = new Blob(l.chunks, { type: l.recorder.mimeType || "audio/webm" });
        const audio = await l.ctx.decodeAudioData(await blob.arrayBuffer());
        // Mono: the channels averaged, so a stereo device doesn't lose a side.
        const mono = new Float32Array(audio.length);
        for (let c = 0; c < audio.numberOfChannels; c++) {
          const data = audio.getChannelData(c);
          for (let i = 0; i < data.length; i++) mono[i]! += data[i]! / audio.numberOfChannels;
        }
        handlers.current.onClip(encodeWav(downsample([mono], audio.sampleRate)), why);
      } catch {
        handlers.current.onError("That recording didn't come through. Try again, or type it.");
      } finally {
        close();
      }
    };
    if (l.recorder.state !== "inactive") l.recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (!supported || live.current) return;
    // Nothing the app plays may go into the recording: the waiting music stops at once, until resumeSounds.
    holdSounds();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      void resumeSounds();
      const denied = (e as DOMException)?.name === "NotAllowedError" || (e as DOMException)?.name === "SecurityError";
      return handlers.current.onError(denied ? "Allow the microphone to say your wish, or type it." : "Couldn't open a microphone. Type it instead.");
    }
    let l: Live;
    try {
      const ctx = new AudioContext();
      await ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const recorder = new MediaRecorder(stream);
      const made: Live = { ctx, stream, recorder, analyser, source, chunks: [], timer: 0 as never, startedAt: performance.now(), spokeAt: null };
      recorder.ondataavailable = (e) => e.data.size && made.chunks.push(e.data);
      recorder.start(250);
      l = made;
    } catch {
      // The browser gave the microphone but couldn't record it: close it, and let the app's sounds play again.
      stream.getTracks().forEach((t) => t.stop());
      void resumeSounds();
      return handlers.current.onError("Couldn't open a microphone. Type it instead.");
    }
    live.current = l;
    const { analyser } = l;
    const buf = new Float32Array(analyser.fftSize);
    const ring: number[] = [];
    l.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      const now = performance.now();
      const level = levelOf(buf);
      if (level > SPEECH_LEVEL) l.spokeAt = now;
      ring.push(level);
      if (ring.length > BARS) ring.shift();
      setLevels(ring.slice());
      setElapsed(now - l.startedAt);
      const why = shouldStop(now, l.startedAt, l.spokeAt, maxMs);
      if (why) end(why);
    }, READ_MS);
    setListening(true);
  }, [supported, maxMs, end]);

  useEffect(() => () => end("cancel"), [end]);

  return { supported, listening, levels, elapsedMs, start, stop: () => end("tap"), cancel: () => end("cancel") };
}
