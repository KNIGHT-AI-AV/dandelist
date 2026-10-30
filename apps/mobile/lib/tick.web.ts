/**
 * The fader's notch on the web: a short, quiet mechanical tick, synthesised (a few milliseconds of filtered noise
 * with a fast decay), so there is no sound file. The audio context opens on the first tick, which always follows a
 * touch, so browsers allow it. Silent while sounds are off, like every other sound.
 */
import { soundsEnabled } from "./sound";

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let last = 0;

export function tick(): void {
  if (!soundsEnabled()) return;
  try {
    const now = performance.now();
    if (now - last < 28) return; // a fast drag across many notches still reads as ticks, not a buzz
    last = now;
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    if (!noise) {
      noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.012), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    }
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 3200;
    band.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = 0.22;
    src.connect(band).connect(gain).connect(ctx.destination);
    src.start();
  } catch {
    // No audio (a locked-down browser): the haptic-free web simply stays quiet.
  }
}
