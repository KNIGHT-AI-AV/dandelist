import { useCallback, useEffect, useRef, useState } from "react";
import { SPEECH_LEVEL, downsample, encodeWav, levelOf, shouldStop } from "../../lib/wav";
import { BARS, MAX_LISTEN_MS, type Recorder, type RecorderOptions, type StopReason } from "./recorder-types";

type Live = { ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode; source: MediaStreamAudioSourceNode; chunks: Float32Array[]; startedAt: number; spokeAt: number | null };

/**
 * The browser's microphone, read as raw samples: floats at the device rate, kept in memory, averaged down to 16 kHz
 * and written as a WAV when listening ends. It ends on a tap, after a pause once the wish is said, when nothing is
 * said for a while, or at the one-minute limit. Echo cancellation and noise suppression are the browser's own.
 */
export function useRecorder({ onClip, onError, maxMs = MAX_LISTEN_MS }: RecorderOptions): Recorder {
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window !== "undefined" && "AudioContext" in window;
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
    l.node.onaudioprocess = null;
    l.source.disconnect();
    l.node.disconnect();
    l.stream.getTracks().forEach((t) => t.stop());
    void l.ctx.close().catch(() => {});
    setListening(false);
    setLevels([]);
    setElapsed(0);
    if (why === "cancel") return;
    if (why === "silent") return handlers.current.onError("Didn't hear anything. Try again a little closer.");
    handlers.current.onClip(encodeWav(downsample(l.chunks, l.ctx.sampleRate)), why);
  }, []);

  const start = useCallback(async () => {
    if (!supported || live.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const denied = (e as DOMException)?.name === "NotAllowedError" || (e as DOMException)?.name === "SecurityError";
      return handlers.current.onError(denied ? "Allow the microphone to say your wish, or type it." : "Couldn't open a microphone. Type it instead.");
    }
    const ctx = new AudioContext();
    await ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    // A ScriptProcessor still runs everywhere an AudioWorklet does, without shipping a separate worklet file.
    const node = ctx.createScriptProcessor(2048, 1, 1);
    const l: Live = { ctx, stream, node, source, chunks: [], startedAt: performance.now(), spokeAt: null };
    live.current = l;
    const ring: number[] = [];
    node.onaudioprocess = (e) => {
      const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
      l.chunks.push(chunk);
      const now = performance.now();
      const level = levelOf(chunk);
      if (level > SPEECH_LEVEL) l.spokeAt = now;
      ring.push(level);
      if (ring.length > BARS) ring.shift();
      setLevels(ring.slice());
      setElapsed(now - l.startedAt);
      const why = shouldStop(now, l.startedAt, l.spokeAt, maxMs);
      if (why) end(why);
    };
    source.connect(node);
    // The node only runs while connected to an output; it writes nothing, so the speakers stay silent.
    node.connect(ctx.destination);
    setListening(true);
  }, [supported, maxMs, end]);

  useEffect(() => () => end("cancel"), [end]);

  return { supported, listening, levels, elapsedMs, start, stop: () => end("tap"), cancel: () => end("cancel") };
}
