"""Makes Dandelist's sounds from scratch: a felt piano and a soft air swell in a warm room. No samples, no downloads.

Owner, 2026-10-29: "high-quality felted cinematic sound effects, luxury". A felt piano is a piano with felt between
the hammers and the strings: the attack is soft, the top end is muted, and what is left is warm and close.

    python -I scripts/make-sounds.py <out-dir>   (needs numpy and scipy; writes 48 kHz 24-bit WAV files)

Then encode for the app: ffmpeg -i x.wav -c:a aac -b:a 160k x.m4a
"""

import sys
import wave
from pathlib import Path

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

RATE = 48_000
rng = np.random.default_rng(29_10_2026)  # fixed, so the files come out the same every time


def hz(note: str) -> float:
    """Equal-tempered frequency of a note like "D2" or "F#3" (A4 = 440 Hz)."""
    names = {"C": -9, "C#": -8, "Db": -8, "D": -7, "D#": -6, "Eb": -6, "E": -5, "F": -4, "F#": -3, "Gb": -3, "G": -2, "G#": -1, "Ab": -1, "A": 0, "A#": 1, "Bb": 1, "B": 2}
    name, octave = note[:-1], int(note[-1])
    return 440.0 * 2 ** ((names[name] + 12 * (octave - 4)) / 12)


def felt_note(f0: float, seconds: float, velocity: float) -> np.ndarray:
    """One felt piano note: slightly stretched partials, each a few detuned strings, a two-stage decay and a soft thump."""
    t = np.arange(int(seconds * RATE)) / RATE
    out = np.zeros_like(t)
    stretch = 0.00025 if f0 > 200 else 0.00012  # string stiffness: upper partials sit a little sharp
    n = 1
    while True:
        fn = n * f0 * np.sqrt(1 + stretch * n * n)
        if fn > 5_200 or n > 40:
            break
        # The felt: a soft hammer barely excites the upper partials, and less so when played softly.
        felt = 1 / (1 + (fn / (1400 + 1400 * velocity)) ** 2.0)
        amp = felt / n**1.35
        # Higher partials die away faster; low notes ring longer. Two stages: the prompt sound, then the aftersound.
        ring = (1.0 if f0 < 150 else 0.75) * (220 / max(f0, 60)) ** 0.35
        tau1 = 0.55 * ring / (1 + 0.45 * (n - 1))
        tau2 = 3.4 * ring / (1 + 0.25 * (n - 1))
        env = 0.72 * np.exp(-t / tau1) + 0.28 * np.exp(-t / tau2)
        for cents in (-0.7, 0.0, 0.8):  # three strings per note, a hair apart, so the tone breathes
            phase = rng.uniform(0, 2 * np.pi)
            out += amp * env * np.sin(2 * np.pi * fn * 2 ** (cents / 1200) * t + phase) / 3
        n += 1
    # A soft attack: felt never strikes hard.
    attack = int(0.006 * RATE)
    out[:attack] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, attack))
    # The thump of the felt hammer and the key, low and brief.
    thump_len = int(0.05 * RATE)
    noise = sosfilt(butter(2, 420, "low", fs=RATE, output="sos"), rng.standard_normal(thump_len))
    thump = noise * np.exp(-np.arange(thump_len) / (0.011 * RATE)) * 0.05
    thump += 0.04 * np.sin(2 * np.pi * min(f0, 110) * np.arange(thump_len) / RATE) * np.exp(-np.arange(thump_len) / (0.02 * RATE))
    out[:thump_len] += thump
    return out * velocity


def room(seconds: float = 3.2) -> np.ndarray:
    """A warm stereo room: decaying noise in three bands, the highs dying first, after a short pre-delay."""
    n = int(seconds * RATE)
    t = np.arange(n) / RATE
    ir = np.zeros((n, 2))
    bands = [((None, 500), 2.9), ((500, 3_000), 2.2), ((3_000, None), 1.1)]
    for side in range(2):
        for (lo, hi), rt60 in bands:
            noise = rng.standard_normal(n)
            if lo is None:
                sos = butter(2, hi, "low", fs=RATE, output="sos")
            elif hi is None:
                sos = butter(2, lo, "high", fs=RATE, output="sos")
            else:
                sos = butter(2, [lo, hi], "band", fs=RATE, output="sos")
            ir[:, side] += sosfilt(sos, noise) * np.exp(-6.91 * t / rt60)
    pre = int(0.018 * RATE)
    ir = np.vstack([np.zeros((pre, 2)), ir])[:n]
    ir[: int(0.004 * RATE)] *= np.linspace(0, 1, int(0.004 * RATE))[:, None]
    return ir / np.max(np.abs(ir))


def place(parts: list[tuple[float, np.ndarray]], seconds: float) -> np.ndarray:
    out = np.zeros(int(seconds * RATE))
    for at, sound in parts:
        i = int(at * RATE)
        out[i : i + len(sound)] += sound[: len(out) - i]
    return out


def master(dry: np.ndarray, wet: float, peak_db: float, fade: float = 0.6) -> np.ndarray:
    """Into the room, a gentle warm tilt, a soft ceiling, then a fade so nothing ends on a cut."""
    ir = room()
    left = fftconvolve(dry, ir[:, 0])[: len(dry)]
    right = fftconvolve(dry, ir[:, 1])[: len(dry)]
    reverb = np.stack([left, right], axis=1)
    reverb *= np.max(np.abs(dry)) / max(np.max(np.abs(reverb)), 1e-9)
    # A touch of width on the dry sound too, so it isn't stuck in the middle.
    mix = np.stack([dry, dry], axis=1) * (1 - wet) + reverb * wet
    mix = sosfilt(butter(1, 7_500, "low", fs=RATE, output="sos"), mix, axis=0)
    mix = sosfilt(butter(1, 120, "high", fs=RATE, output="sos"), mix, axis=0)  # no boom a phone cannot play anyway
    mix = np.tanh(mix / np.max(np.abs(mix)) * 1.1) / np.tanh(1.1)  # soft ceiling, no hard clipping
    n_fade = int(fade * RATE)
    mix[-n_fade:] *= (np.cos(np.linspace(0, np.pi / 2, n_fade)) ** 2)[:, None]
    return mix * 10 ** (peak_db / 20)


def swell(seconds: float) -> np.ndarray:
    """Air that opens and closes: pink-ish noise through a slowly opening filter, over a quiet open fifth."""
    n = int(seconds * RATE)
    t = np.arange(n) / RATE
    rise, fall = 0.55 * seconds, 0.45 * seconds
    shape = np.where(t < rise, np.sin(np.pi / 2 * t / rise) ** 2, np.cos(np.pi / 2 * np.clip((t - rise) / fall, 0, 1)) ** 2)
    white = rng.standard_normal(n)
    pink = sosfilt(butter(1, 300, "low", fs=RATE, output="sos"), white) * 0.7 + white * 0.08
    out = np.zeros(n)
    block = 1_024
    for i in range(0, n, block):  # the filter opens as the swell rises
        cutoff = 420 + 3_000 * shape[min(i + block // 2, n - 1)] ** 1.5
        sos = butter(2, cutoff, "low", fs=RATE, output="sos")
        seg = pink[max(0, i - 2_048) : i + block]
        out[i : i + block] = sosfilt(sos, seg)[-len(out[i : i + block]) :]
    pad = sum(np.sin(2 * np.pi * hz(note) * t + rng.uniform(0, 6.28)) * level for note, level in (("D4", 0.5), ("A4", 0.35), ("D5", 0.18)))
    return (out / np.max(np.abs(out)) * 0.55 + pad * 0.22) * shape


def write(path: Path, stereo: np.ndarray) -> None:
    pcm = np.clip(stereo, -1, 1)
    ints = (pcm * (2**23 - 1)).astype("<i4")
    raw = b"".join(int(s).to_bytes(4, "little", signed=True)[:3] for s in ints.reshape(-1))
    with wave.open(str(path), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(3)
        f.setframerate(RATE)
        f.writeframes(raw)


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    # The title: a D major ninth, rolled slowly upward from the bass, as the name appears.
    # Voiced above D3: phone speakers give almost nothing below 300 Hz, so the chord sits where a phone can sing it.
    chord = [("D3", 0.00, 0.32), ("A3", 0.06, 0.34), ("F#4", 0.12, 0.42), ("C#5", 0.19, 0.38), ("E5", 0.27, 0.34)]
    title = place([(at, felt_note(hz(n), 5.0, v)) for n, at, v in chord], 5.2)
    write(out / "title.wav", master(title, wet=0.34, peak_db=-6.0, fade=1.2))
    # The first card lands: E, B, E rising, quiet and sure.
    land = place([(0.0, felt_note(hz("E4"), 3.0, 0.40)), (0.08, felt_note(hz("B4"), 3.0, 0.36)), (0.16, felt_note(hz("E5"), 3.0, 0.32))], 3.0)
    write(out / "land.wav", master(land, wet=0.30, peak_db=-8.0, fade=0.8))
    # The list revealed: air opening and closing over a soft fifth, with one felt note at its height.
    air = swell(2.6)
    air = air / np.max(np.abs(air)) * 0.5 + place([(1.25, felt_note(hz("A5"), 1.35, 0.28))], 2.6)
    write(out / "swell.wav", master(air, wet=0.40, peak_db=-10.0, fade=0.5))


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "sounds-out"))
