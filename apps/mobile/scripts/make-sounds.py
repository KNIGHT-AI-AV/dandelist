"""Makes Dandelist's sounds from scratch: a felt piano, a felted celesta and a soft air swell in a warm room. No samples,
no downloads.

Owner, 2026-10-29: "high-quality felted cinematic sound effects, luxury". A felt piano is a piano with felt between
the hammers and the strings: the attack is soft, the top end is muted, and what is left is warm and close.

    python -I scripts/make-sounds.py <out-dir> [ffmpeg]   (needs numpy and scipy; writes 48 kHz 24-bit WAV files)

Given the path to ffmpeg, it also encodes them for the app as AAC in .m4a: 160 kbps, except the waiting loop, which is
long, at 112 kbps and encoded so that it meets itself without a seam (encode_loop).
"""

import subprocess
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


def celesta(f0: float, seconds: float, velocity: float) -> np.ndarray:
    """A felted bell: a steel bar struck by a felt hammer over a wooden resonator, which is what a celesta is. The bar's
    own overtones sit high above the note and die at once; the resonator holds the note itself, a hair apart, so it
    shimmers as it fades."""
    t = np.arange(int(seconds * RATE)) / RATE
    ring = 1.4 * (1_000 / f0) ** 0.6  # higher bars ring shorter
    out = np.sin(2 * np.pi * f0 * t + rng.uniform(0, 2 * np.pi)) * np.exp(-t / ring)
    bloom = (1 - np.exp(-t / 0.018)) * np.exp(-t / (ring * 1.25))
    out += 0.4 * bloom * np.sin(2 * np.pi * f0 * 1.0005 * t + rng.uniform(0, 2 * np.pi))
    bright = 0.5 + velocity  # a firmer stroke wakes more of the bar
    for ratio, amp, life in ((2.756, 0.14, 0.16), (5.404, 0.045, 0.06)):  # a free bar's overtones, not harmonics
        if f0 * ratio > 9_000:
            continue
        out += amp * bright * np.sin(2 * np.pi * f0 * ratio * t + rng.uniform(0, 2 * np.pi)) * np.exp(-t / (life * ring))
    attack = int(0.003 * RATE)
    out[:attack] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, attack))
    # Felt on steel: the softest tick.
    tick_len = int(0.01 * RATE)
    tick = sosfilt(butter(2, [1_800, 5_200], "band", fs=RATE, output="sos"), rng.standard_normal(tick_len))
    out[:tick_len] += tick * np.exp(-np.arange(tick_len) / (0.0015 * RATE)) * 0.03
    return out * velocity


def damped(sound: np.ndarray, hold: float) -> np.ndarray:
    """The damper falls `hold` seconds in: felt on the strings, so the note stops softly rather than at once."""
    t = np.arange(len(sound)) / RATE
    return sound * np.where(t < hold, 1.0, np.exp(-np.clip(t - hold, 0, None) / 0.09))


def wrap(parts: list[tuple[float, np.ndarray]], seconds: float) -> np.ndarray:
    """Like place, but on a circle: whatever rings past the end carries on from the start, so the loop has no seam."""
    n = int(round(seconds * RATE))
    out = np.zeros(n)
    for at, sound in parts:
        i = int(round(at * RATE)) % n
        head = min(len(sound), n - i)
        out[i : i + head] += sound[:head]
        out[: len(sound) - head] += sound[head:]
    return out


def master_loop(dry: np.ndarray, wet: float, peak_db: float) -> np.ndarray:
    """master() for a loop: the room's tail folds back to the start and the filters run three laps, keeping the middle
    one, so the end meets the beginning exactly. No fade: the app fades it in and out."""
    n = len(dry)
    ir = room()
    sides = []
    for side in range(2):
        full = fftconvolve(dry, ir[:, side])
        lap = full[:n].copy()
        lap[: len(full) - n] += full[n:]
        sides.append(lap)
    reverb = np.stack(sides, axis=1)
    reverb *= np.max(np.abs(dry)) / max(np.max(np.abs(reverb)), 1e-9)
    mix = np.stack([dry, dry], axis=1) * (1 - wet) + reverb * wet
    laps = np.concatenate([mix, mix, mix])
    laps = sosfilt(butter(1, 7_500, "low", fs=RATE, output="sos"), laps, axis=0)
    laps = sosfilt(butter(1, 120, "high", fs=RATE, output="sos"), laps, axis=0)
    mix = laps[n : 2 * n]
    mix = np.tanh(mix / np.max(np.abs(mix)) * 1.1) / np.tanh(1.1)
    return mix * 10 ** (peak_db / 20)


# The wait (owner, 2026-10-30): "a nice, cute, little artistic and beautiful ballad while the users are waiting for that
# first picture ... simple felted keys ... arpeggio, beautiful, light ... And then a slow ramp, vibration, and then a
# ding when it's done."
#
# Written for Dandelist, not borrowed: D major in 6/8 at a dotted crotchet of 50, eight bars of 2.4 s, 19.2 s that loop.
# Each bar is one arpeggio climbing from the bass under the pedal, with a quiet melody over it, two or three notes a bar
# in the lilt of 6/8. What makes it a little magical is the raised fourth over the IV chord (G major with C sharp),
# answered later by the borrowed minor iv (G minor with B flat) before the dominant leads home to the top.
BAR = 2.4
EIGHTH = BAR / 6
PEDAL = 0.12  # the pedal changes just after each downbeat, so a bar's notes ring a moment into the next one
# Peaks: the loop sits well under the other sounds, since it plays for a while; the chime sits with the title chord.
WAIT_PEAK_DB = -12.0
DONE_PEAK_DB = -7.0

# One arpeggio a bar, a note a quaver, the bass first.
ARPEGGIO = [
    ("D3", "A3", "E4", "F#4", "C#5", "A4"),  # D major 9
    ("G2", "D3", "A3", "B3", "F#4", "C#5"),  # G major 7 with the raised fourth
    ("B2", "F#3", "D4", "E4", "A4", "F#4"),  # B minor 11
    ("A2", "E3", "B3", "D4", "G4", "E4"),  # A 9 sus 4: the question at the half
    ("F#2", "D3", "A3", "C#4", "E4", "A4"),  # D major 9 over F sharp
    ("E2", "B2", "G3", "D4", "F#4", "B4"),  # E minor 9
    ("G2", "D3", "Bb3", "E4", "A4", "E4"),  # G minor 6/9, borrowed from D minor: the tender turn
    ("A2", "E3", "G3", "D4", "E4", "C#5"),  # A 7 sus 4, its last note the leading note home
]
ARP_VELOCITY = (0.34, 0.25, 0.23, 0.26, 0.29, 0.24)
BAR_VELOCITY = (1.0, 1.04, 0.98, 0.92, 1.0, 1.08, 1.0, 0.9)  # the second phrase rises to bar 6, then settles
# The melody: (bar, quaver, note). Its last three notes climb to the A that starts it again.
MELODY = [
    (0, 0, "A5"), (0, 3, "F#5"), (0, 4, "E5"),
    (1, 0, "B5"), (1, 3, "C#6"), (1, 4, "A5"),
    (2, 0, "F#5"), (2, 3, "E5"), (2, 4, "D5"),
    (3, 0, "E5"),
    (4, 0, "A5"), (4, 3, "F#5"), (4, 4, "E5"),
    (5, 0, "B5"), (5, 3, "D6"), (5, 4, "A5"),
    (6, 0, "Bb5"), (6, 3, "A5"), (6, 4, "G5"),
    (7, 0, "E5"), (7, 3, "F#5"), (7, 4, "G5"),
]
MELODY_VELOCITY = {0: 0.42, 3: 0.37, 4: 0.36}
# A felted celesta glints on the high points.
GLINTS = [(1, 3, "C#6"), (3, 3, "E6"), (5, 3, "D6")]


def ballad() -> np.ndarray:
    """The waiting loop, dry: the arpeggios, the melody a breath ahead of them as a pianist plays it, and the glints."""
    parts: list[tuple[float, np.ndarray]] = []

    def jitter(ms: float) -> float:
        """A few milliseconds either way: a hand, not a sequencer."""
        return rng.normal(0, ms / 1000)

    for bar, chord in enumerate(ARPEGGIO):
        for i, note in enumerate(chord):
            at = bar * BAR + i * EIGHTH + jitter(4)
            hold = (bar + 1) * BAR + PEDAL - at
            v = ARP_VELOCITY[i] * BAR_VELOCITY[bar] * (1 + rng.normal(0, 0.05))
            parts.append((at, damped(felt_note(hz(note), hold + 0.5, v), hold)))
    for bar, i, note in MELODY:
        at = bar * BAR + i * EIGHTH - 0.012 + jitter(3)
        hold = (bar + 1) * BAR + PEDAL - at
        v = MELODY_VELOCITY[i] * BAR_VELOCITY[bar] * (1 + rng.normal(0, 0.04))
        parts.append((at, damped(felt_note(hz(note), hold + 0.5, v), hold)))
    for bar, i, note in GLINTS:
        parts.append((bar * BAR + i * EIGHTH + jitter(3), celesta(hz(note), 2.4, 0.2)))
    return wrap(parts, len(ARPEGGIO) * BAR)


def ding() -> np.ndarray:
    """The picture has landed: one felted bell on D with its fifth a breath behind, warmed by a felt piano D below."""
    return place([(0.0, celesta(hz("D6"), 2.6, 0.62)), (0.028, celesta(hz("A6"), 2.4, 0.3)), (0.0, felt_note(hz("D5"), 2.6, 0.3))], 2.8)


def write(path: Path, stereo: np.ndarray) -> None:
    pcm = np.clip(stereo, -1, 1)
    ints = (pcm * (2**23 - 1)).astype("<i4")
    raw = b"".join(int(s).to_bytes(4, "little", signed=True)[:3] for s in ints.reshape(-1))
    with wave.open(str(path), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(3)
        f.setframerate(RATE)
        f.writeframes(raw)


LOOP_CONTEXT = 2_048  # samples of the loop's own end and start that ride along when it is encoded (encode_loop)


def encode(ffmpeg: str, wav: Path, m4a: Path, kbps: int) -> None:
    subprocess.run([ffmpeg, "-v", "error", "-y", "-i", str(wav), "-c:a", "aac", "-b:a", f"{kbps}k", str(m4a)], check=True)


def encode_loop(ffmpeg: str, loop: np.ndarray, m4a: Path, kbps: int) -> None:
    """AAC codes sound in overlapping blocks, so a file's first and last few milliseconds are coded against silence, and
    looped, its two ends no longer meet: the seam ticks. So the loop is encoded with a little of its own end before it
    and of its own start after it, and the file's edit list then tells the player where to start and stop: it plays the
    loop exactly, and each end was coded knowing what comes next. The trims stay within the first and last four AAC
    frames, which is as far as Android's player honours an edit list as gapless."""
    wav = m4a.with_name(m4a.stem + "-context.wav")
    write(wav, np.concatenate([loop[-LOOP_CONTEXT:], loop, loop[:LOOP_CONTEXT]]))
    encode(ffmpeg, wav, m4a, kbps)
    wav.unlink()
    trim_edit_list(m4a, skip=LOOP_CONTEXT, keep=len(loop))


def trim_edit_list(m4a: Path, skip: int, keep: int) -> None:
    """Moves the start of a one-track MP4's edit list `skip` samples later and makes it `keep` samples long, with the
    movie's and the track's durations to match."""
    data = bytearray(m4a.read_bytes())

    def children(start: int, end: int):
        i = start
        while i + 8 <= end:
            size, kind, head = int.from_bytes(data[i : i + 4], "big"), bytes(data[i + 4 : i + 8]), 8
            if size == 1:
                size, head = int.from_bytes(data[i + 8 : i + 16], "big"), 16
            elif size == 0:
                size = end - i
            yield kind, i + head, i + size
            i += size

    def child(kind: bytes, start: int, end: int) -> tuple[int, int]:
        found = [(a, b) for k, a, b in children(start, end) if k == kind]
        if len(found) != 1:
            raise ValueError(f"expected one {kind!r} box, found {len(found)}")
        return found[0]

    def field(at: int, wide: bool, value: int | None = None, signed: bool = False) -> int:
        n = 8 if wide else 4
        if value is not None:
            data[at : at + n] = value.to_bytes(n, "big", signed=signed)
        return int.from_bytes(data[at : at + n], "big", signed=signed)

    moov = child(b"moov", 0, len(data))
    mvhd = child(b"mvhd", *moov)
    trak = child(b"trak", *moov)
    tkhd = child(b"tkhd", *trak)
    elst = child(b"elst", *child(b"edts", *trak))
    mdhd = child(b"mdhd", *child(b"mdia", *trak))
    def v1(box: tuple[int, int]) -> bool:
        """Version 1 boxes carry 64-bit times."""
        return data[box[0]] == 1

    movie_scale = field(mvhd[0] + (20 if v1(mvhd) else 12), False)
    media_scale = field(mdhd[0] + (20 if v1(mdhd) else 12), False)
    if field(elst[0] + 4, False) != 1:
        raise ValueError("expected an edit list with one entry")
    if (keep * movie_scale) % media_scale:
        raise ValueError("the loop's length is not a whole number of movie ticks")
    duration = keep * movie_scale // media_scale
    wide = v1(elst)
    entry = elst[0] + 8
    field(entry, wide, duration)
    media_time = entry + (8 if wide else 4)
    field(media_time, wide, field(media_time, wide, signed=True) + skip, signed=True)
    field(mvhd[0] + (24 if v1(mvhd) else 16), v1(mvhd), duration)
    field(tkhd[0] + (28 if v1(tkhd) else 20), v1(tkhd), duration)
    m4a.write_bytes(bytes(data))


def main(out: Path, ffmpeg: str | None = None) -> None:
    out.mkdir(parents=True, exist_ok=True)
    # The title: a D major ninth, rolled slowly upward from the bass, as the name appears.
    # Voiced above D3: phone speakers give almost nothing below 300 Hz, so the chord sits where a phone can sing it.
    chord = [("D3", 0.00, 0.32), ("A3", 0.06, 0.34), ("F#4", 0.12, 0.42), ("C#5", 0.19, 0.38), ("E5", 0.27, 0.34)]
    title = place([(at, felt_note(hz(n), 5.0, v)) for n, at, v in chord], 5.2)
    write(out / "title.wav", master(title, wet=0.34, peak_db=-6.0, fade=1.2))
    # The first card lands: E, B, E rising, quiet and sure. (The app has used the done chime for a landing since
    # 2026-10-30; this one is still made so that the swell after it comes out the same.)
    land = place([(0.0, felt_note(hz("E4"), 3.0, 0.40)), (0.08, felt_note(hz("B4"), 3.0, 0.36)), (0.16, felt_note(hz("E5"), 3.0, 0.32))], 3.0)
    write(out / "land.wav", master(land, wet=0.30, peak_db=-8.0, fade=0.8))
    # The list revealed: air opening and closing over a soft fifth, with one felt note at its height.
    air = swell(2.6)
    air = air / np.max(np.abs(air)) * 0.5 + place([(1.25, felt_note(hz("A5"), 1.35, 0.28))], 2.6)
    write(out / "swell.wav", master(air, wet=0.40, peak_db=-10.0, fade=0.5))
    # The wait and its end start from their own seed, so nothing above changes them.
    global rng
    rng = np.random.default_rng(30_10_2026)
    wait = master_loop(ballad(), wet=0.42, peak_db=WAIT_PEAK_DB)
    write(out / "wait.wav", wait)
    write(out / "done.wav", master(ding(), wet=0.36, peak_db=DONE_PEAK_DB, fade=1.0))
    if ffmpeg:
        for name in ("title", "swell", "done"):
            encode(ffmpeg, out / f"{name}.wav", out / f"{name}.m4a", 160)
        encode_loop(ffmpeg, wait, out / "wait.m4a", 112)


if __name__ == "__main__":
    # python -I scripts/make-sounds.py <out-dir> [path to ffmpeg, to encode the .m4a files as the app ships them]
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "sounds-out"), sys.argv[2] if len(sys.argv) > 2 else None)
