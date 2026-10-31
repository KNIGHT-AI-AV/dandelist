"""Makes each theme's own song for the wait, from scratch and with make-sounds.py's own instruments: the felt piano, the
felted celesta and the warm room, joined here by a music box, a harp, soft strings and air. No samples, no downloads.

Owner, 2026-10-30: "Different beautiful music for every different theme ... keeping that legend of Zelda and Kingdom
hearts type of felted songwriting make them fit the colors, but keep them 100% original and high quality while sounding
nostalgic and soft".

Nine short pieces written for Dandelist, melody and harmony both, one for each theme in lib/palette.ts; their names are in
lib/theme-songs.ts. Each is a loop of 40 to 70 s that meets itself without a seam, set at the waiting ballad's loudness,
and lib/waiting.ts plays it in place of the ballad while a picture is being made.

    python -I scripts/make-theme-songs.py <out-dir> [ffmpeg] [theme ...]   (needs numpy and scipy; writes 48 kHz 24-bit WAV files)

Given the path to ffmpeg, it also encodes each loop for the app as theme-<id>.m4a, AAC at 112 kbps, the way make-sounds.py
encodes the ballad (encode_loop). Name themes to make only those.
"""

import importlib.util
import sys
from pathlib import Path

import numpy as np
from scipy.signal import butter, lfilter, sosfilt

sys.dont_write_bytecode = True  # borrowing make-sounds.py leaves no __pycache__ in scripts/
_spec = importlib.util.spec_from_file_location("make_sounds", Path(__file__).with_name("make-sounds.py"))
sounds = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sounds)
RATE, hz = sounds.RATE, sounds.hz

rng = np.random.default_rng(0)


def reseed(seed: int) -> None:
    """Each song draws from its own seed, here and inside make-sounds.py's instruments, so each comes out the same every
    time and changing one never changes another."""
    global rng
    rng = np.random.default_rng(seed)
    sounds.rng = rng


SEMITONE = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}


def midi(note: str) -> int:
    return SEMITONE[note[:-1]] + 12 * (int(note[-1]) + 1)


def up(note: str, octaves: int) -> str:
    return note if not octaves else f"{note[:-1]}{int(note[-1]) + octaves}"


# Instruments that make-sounds.py doesn't have, made the same way.


def music_box(f0: float, seconds: float, velocity: float) -> np.ndarray:
    """A music box: a steel tine plucked by a pin on the drum. The note rings a second or two, longer low down; the tine's
    own bending mode sparkles far above it and is gone at once; a second tine a hair sharp makes the note shimmer."""
    t = np.arange(int(seconds * RATE)) / RATE
    ring = 1.1 * (1_000 / f0) ** 0.5
    turn = 2 * np.pi
    out = np.sin(turn * f0 * t + rng.uniform(0, turn)) * np.exp(-t / ring)
    out += 0.28 * np.sin(turn * f0 * 2 ** (2.5 / 1_200) * t + rng.uniform(0, turn)) * np.exp(-t / (0.85 * ring))
    out += 0.1 * np.sin(turn * 2 * f0 * t + rng.uniform(0, turn)) * np.exp(-t / (0.3 * ring))  # the case answers an octave up
    if f0 * 5.86 < 11_000:
        out += 0.14 * (0.5 + velocity) * np.sin(turn * f0 * 5.86 * t + rng.uniform(0, turn)) * np.exp(-t / (0.035 * ring))
    attack = int(0.0015 * RATE)
    out[:attack] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, attack))
    # The pin leaving the tine: the smallest bright tick.
    tick_len = int(0.008 * RATE)
    tick = sosfilt(butter(2, [2_500, 7_000], "band", fs=RATE, output="sos"), rng.standard_normal(tick_len))
    out[:tick_len] += tick * np.exp(-np.arange(tick_len) / (0.0012 * RATE)) * 0.035
    return out * velocity / 1.3


def harp(f0: float, seconds: float, velocity: float) -> np.ndarray:
    """A harp string plucked by a fingertip near its middle: soft overtones that fade first, then a long warm ring."""
    t = np.arange(int(seconds * RATE)) / RATE
    out = np.zeros_like(t)
    body = 2.6 * (260 / f0) ** 0.45  # low strings ring longest
    total = 0.0
    for n in range(1, 25):
        fn = n * f0
        if fn > 6_000:
            break
        # Where it was plucked shapes the overtones; a fingertip, not a nail, keeps them low.
        amp = abs(np.sin(n * np.pi * 0.42)) / n**1.45 / (1 + (fn / (1_500 + 1_500 * velocity)) ** 2)
        out += amp * np.exp(-t / (body / (1 + 0.55 * (n - 1)))) * np.sin(2 * np.pi * fn * t + rng.uniform(0, 2 * np.pi))
        total += amp
    attack = int(0.004 * RATE)
    out[:attack] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, attack))
    brush_len = int(0.012 * RATE)
    brush = sosfilt(butter(2, 1_200, "low", fs=RATE, output="sos"), rng.standard_normal(brush_len))
    out[:brush_len] += brush * np.exp(-np.arange(brush_len) / (0.003 * RATE)) * 0.03 * total
    return out / total * velocity


def let_go(sound: np.ndarray, hold: float, soft: float) -> np.ndarray:
    """A hand on the harp's strings, or the celesta's damper, `hold` seconds in: softer than the piano's felt."""
    t = np.arange(len(sound)) / RATE
    return sound * np.where(t < hold, 1.0, np.exp(-np.clip(t - hold, 0, None) / soft))


def pad(seconds: float, notes: list[str], velocity: float, bright: float = 1_300, warmth: float = 0.25) -> np.ndarray:
    """A bed of soft strings: each note three voices a few cents apart, slowly wavering, slow to come and go."""
    n = int(seconds * RATE)
    t = np.arange(n) / RATE
    out = np.zeros(n)
    for note in notes:
        for cents in (-6.0, 0.0, 5.0):
            f = hz(note) * 2 ** (cents / 1_200)
            # A drift of about two cents, a few seconds a sway.
            phase = 2 * np.pi * f * t + rng.uniform(0, 2 * np.pi) + f * 0.0012 / 0.21 * np.sin(2 * np.pi * 0.21 * t + rng.uniform(0, 2 * np.pi))
            out += np.sin(phase) + warmth * np.sin(2 * phase) + 0.3 * warmth * np.sin(3 * phase)
    out = sosfilt(butter(2, bright, "low", fs=RATE, output="sos"), out)
    env = np.ones(n)
    rise, fall = int(min(1.4, seconds / 3) * RATE), int(min(1.8, seconds / 3) * RATE)
    env[:rise] = np.sin(np.linspace(0, np.pi / 2, rise)) ** 2
    env[-fall:] = np.cos(np.linspace(0, np.pi / 2, fall)) ** 2
    return out * env * velocity / (3 * len(notes))


def air(seconds: float, notes: list[str], velocity: float) -> np.ndarray:
    """make-sounds.py's swell, drawn out and on any chord: breath through a slowly opening filter over a quiet chord."""
    n = int(seconds * RATE)
    t = np.arange(n) / RATE
    rise, fall = 0.55 * seconds, 0.45 * seconds
    shape = np.where(t < rise, np.sin(np.pi / 2 * t / rise) ** 2, np.cos(np.pi / 2 * np.clip((t - rise) / fall, 0, 1)) ** 2)
    white = rng.standard_normal(n)
    pink = sosfilt(butter(1, 300, "low", fs=RATE, output="sos"), white) * 0.7 + white * 0.08
    out = np.zeros(n)
    block = 1_024
    for i in range(0, n, block):
        cutoff = 300 + 1_500 * shape[min(i + block // 2, n - 1)] ** 1.5
        seg = pink[max(0, i - 2_048) : i + block]
        out[i : i + block] = sosfilt(butter(2, cutoff, "low", fs=RATE, output="sos"), seg)[-len(out[i : i + block]) :]
    tone = sum(np.sin(2 * np.pi * hz(note) * t + rng.uniform(0, 2 * np.pi)) * 0.5**k for k, note in enumerate(notes))
    return (out / np.max(np.abs(out)) * 0.5 + tone * 0.2) * shape * velocity


# The score.

PEDAL = 0.12  # the pedal changes just after the downbeat, as in the ballad
TAIL = {"piano": 0.5, "harp": 0.9}  # how long a voice is kept past its release, for its damper or hand to quiet it
RING = {"celesta": 2.6, "box": 2.8}  # these ring out on their own


FRAME = 3_072  # 64 ms: a whole number of AAC frames (1,024 samples) and of milliseconds (48), see Song


class Song:
    """A score on a loop: notes placed in bars, played with the hand, the phrasing and the pedal a pianist brings.

    A loop lasts a whole number of 64 ms. encode_loop's edit list needs whole milliseconds, and a loop that ends inside an
    AAC frame is played with the rest of that frame by players that honour only whole frames (ffmpeg, so Chrome too),
    which ticks at the seam. The ballad, 900 frames long, never met this; a 60 s loop is 2,812.5."""

    def __init__(self, seed: int, seconds: float, bars: int, beats: int, grid: int, rubato: float = 0.03, phrase: int = 4, wet: float = 0.42, lift: float | None = None):
        samples = seconds * RATE
        if bars % phrase or abs(samples - round(samples)) > 1e-6 or round(samples) % FRAME:
            raise ValueError("the phrases must fill the loop, and the loop must last a whole number of 64 ms")
        reseed(seed)
        self.bar, self.bars, self.beats, self.grid = seconds / bars, bars, beats, grid
        self.length = seconds
        self.rubato, self.phrase, self.wet, self.lift = rubato, phrase, wet, lift
        self.dynamics = [1.0] * bars
        self.pedals = [float(b) for b in range(bars)]
        self.events: list[tuple[float, str, str, float, float]] = []
        self.beds: list[tuple[float, float, str, list[str], float, dict]] = []

    def seconds(self, t: float) -> float:
        """When `t` bars falls. Rubato: each phrase stretches a little at its ends and moves on through its middle, and the
        phrases still add up to exactly the loop, so the seam stays where it is."""
        x = t * self.bar
        span = self.phrase * self.bar
        return x + self.rubato * span / (2 * np.pi) * np.sin(2 * np.pi * x / span)

    def level(self, t: float) -> float:
        """The phrase's dynamics at `t` bars, moving smoothly from each bar's level to the next, round the loop."""
        i = int(np.floor(t))
        a, b = self.dynamics[i % self.bars], self.dynamics[(i + 1) % self.bars]
        return a + (b - a) * (t - i)

    def release(self, t: float) -> float:
        """When a note struck at `t` bars is let go: just after the next pedal change."""
        later = [p for p in self.pedals if p > t + 1e-6]
        return self.seconds(later[0] if later else self.pedals[0] + self.bars) + PEDAL

    def strike(self, t: float, inst: str, note: str, vel: float, offset: float = 0.0, until: float | None = None, jitter: float = 0.004, accent: bool = True) -> None:
        """One note at `t` bars. Its loudness follows the beat it falls on, the phrase, how high it is and a little chance;
        its time is a few milliseconds of hand either way."""
        pos = (t % 1) * self.beats
        beat = round(pos)
        metric = (1.08 if beat % self.beats == 0 else 1.0) if abs(pos - beat) < 1e-6 else 0.92
        lift = float(np.clip(1 + 0.008 * (midi(note) - 72), 0.9, 1.1))
        vel *= self.level(t) * (metric if accent else 1.0) * lift * (1 + rng.normal(0, 0.04))
        at = self.seconds(t) + offset + rng.normal(0, jitter)
        self.events.append((at, inst, note, float(vel), self.release(t) if until is None else until))

    def line(self, text: str, inst: str = "piano", vel: float = 0.4, bar: int = 0, per_bar: int | None = None, octave: int = 0, ahead: float = 0.012, legato: float | None = 0.22) -> None:
        """A tune, a bar between bars ("|") and a token a step: a note, notes sounding together ("C5,E5"), notes sharing
        the step ("D5+C5"), or "." for nothing new. ">" leans on a note, "_" lightens it. The melody sounds a breath ahead
        of the beat, as a pianist plays it, and is held until just after its next note, so passing notes don't blur."""
        per_bar = per_bar or self.grid
        onsets: list[tuple[float, list[str], float]] = []
        for i, cell in enumerate(c.split() for c in text.split("|") if c.strip()):
            if len(cell) != per_bar:
                raise ValueError(f"bar {bar + i + 1} has {len(cell)} steps, not {per_bar}: {' '.join(cell)}")
            for j, token in enumerate(cell):
                if token == ".":
                    continue
                mark = {">": 1.12, "_": 0.82}.get(token[0], 1.0)
                subs = token.lstrip(">_").split("+")
                for k, sub in enumerate(subs):
                    onsets.append((bar + i + (j + k / len(subs)) / per_bar, sub.split(","), mark))
        for n, (t, notes, mark) in enumerate(onsets):
            until = self.release(t)
            if legato is not None and n + 1 < len(onsets):
                until = min(until, self.seconds(onsets[n + 1][0]) + legato)
            for m, note in enumerate(notes):
                self.strike(t, inst, up(note, octave), vel * mark, offset=0.02 * m - ahead, until=until, jitter=0.003)

    def accompany(self, voicings: list[str], pattern: list, vel: float, shape: tuple | None = None, bar: int = 0, inst: str = "piano") -> None:
        """A voicing a bar, played to a pattern: each step names the voicing's notes, bass first, that sound on it."""
        per = len(pattern)
        for i, voicing in enumerate(voicings):
            notes = voicing.split()
            for j, step in enumerate(pattern):
                if step is None:
                    continue
                for m, k in enumerate((step,) if isinstance(step, int) else step):
                    self.strike(bar + i + j / per, inst, notes[k], vel * (shape[j] if shape else 1.0), offset=0.016 * m)

    def waltz(self, spec: list[str], vel: float, bar: int = 0, shape: tuple = (1.0, 0.74, 0.66)) -> None:
        """A waltz's left hand, a bar a string: the bass on one, then the chord on two and three, softer each time.
        "F2 / F3 Bb3 D4 / A3 C4 Eb4" changes chord on three."""
        for i, cell in enumerate(spec):
            beats = [b.split() for b in cell.split("/")]
            beats += [beats[-1]] * (self.beats - len(beats))
            for b, notes in enumerate(beats):
                for m, note in enumerate(notes):
                    self.strike(bar + i + b / self.beats, "piano", note, vel * shape[min(b, len(shape) - 1)], offset=0.014 * m)

    def rolled(self, t: float, notes: str, vel: float) -> None:
        """A chord spread upward from the bass, as a hand rolls it."""
        for m, note in enumerate(notes.split()):
            self.strike(t, "piano", note, vel * (1.08 if m == 0 else 1.0), offset=0.032 * m)

    def dots(self, inst: str, marks: list[tuple[int, int, str]], vel: float, per_bar: int | None = None) -> None:
        """Single notes here and there, (bar, step, note), counting bars from 0. They ring out undamped."""
        for b, step, note in marks:
            t = b + step / (per_bar or self.grid)
            self.strike(t, inst, note, vel, until=self.seconds(t) + 9.0, jitter=0.003)

    def gliss(self, t: float, notes: str, step: float, vel: float) -> None:
        """A harp's sweep up its strings, a few hundredths of a second apart, swelling and then thinning."""
        names = notes.split()
        for k, note in enumerate(names):
            self.strike(t, "harp", note, vel * (0.55 + 0.45 * np.sin(np.pi * (k + 0.5) / len(names))), offset=k * step, jitter=0.002, accent=False)

    def bed(self, kind: str, t: float, bars: float, notes: str, vel: float, **tone) -> None:
        """Air or strings under the music from `t` bars for `bars` bars; past the loop's end it carries on from the start."""
        start = self.seconds(t)
        self.beds.append((start, self.seconds(t + bars) - start, kind, notes.split(), vel * self.level(t), tone))


def layer(v: float) -> float:
    """The loudness a voice is made at, in steps of 1.5 dB: close enough that no ear hears the step."""
    return float(10 ** (round(20 * np.log10(max(v, 1e-3)) / 1.5) * 1.5 / 20))


def restrike(song: Song) -> list[tuple[float, str, str, float, float]]:
    """A string, bar or tine struck again stops ringing from the time before, so a pitch is never heard twice at once."""
    events = sorted(song.events)
    following: dict[tuple[str, str], float] = {}
    out = []
    for at, inst, note, vel, until in reversed(events):
        key = (inst, note)
        if key not in following:  # the last strike of a pitch meets the first one of the next time round
            following[key] = min(a for a, i, n, *_ in events if (i, n) == key) + song.length
        out.append((at, inst, note, vel, min(until, following[key] + 0.04)))
        following[key] = at
    return out[::-1]


def render(song: Song) -> np.ndarray:
    """The song, dry and mono, on a circle (make-sounds.py's wrap). Each felt piano or harp voice is made once for a pitch
    and a loudness and then reused, as a sampled instrument does, which keeps the nine songs quick to make."""
    events = restrike(song)
    longest: dict[tuple[str, str, float], float] = {}
    for at, inst, note, vel, until in events:
        if inst in TAIL:
            key = (inst, note, layer(vel))
            longest[key] = max(longest.get(key, 0.0), max(until - at, 0.2) + TAIL[inst])
    voices = {key: (sounds.felt_note if key[0] == "piano" else harp)(hz(key[1]), seconds, key[2]) for key, seconds in longest.items()}
    parts = []
    for at, inst, note, vel, until in events:
        if inst in TAIL:
            key = (inst, note, layer(vel))
            hold = max(until - at, 0.2)
            sound = voices[key][: int((hold + TAIL[inst]) * RATE)] * (vel / key[2])
            sound = sounds.damped(sound, hold) if inst == "piano" else let_go(sound, hold, 0.16)
        else:
            sound = (sounds.celesta if inst == "celesta" else music_box)(hz(note), RING[inst], vel)
            # In a tune, a note quiets soon after the next one, so neighbours a semitone apart never ring together.
            if until - at < RING[inst]:
                sound = let_go(sound, max(until - at, 0.2), 0.22)
        parts.append((at, sound))
    for at, seconds, kind, notes, vel, tone in song.beds:
        parts.append((at, air(seconds, notes, vel) if kind == "air" else pad(seconds, notes, vel, **tone)))
    return sounds.wrap(parts, song.length)


# Loudness by ITU-R BS.1770 (K-weighted, gated), to set every song where the waiting ballad sits: wait.m4a measures
# -23.3 LUFS, so a theme's song is no louder or quieter than the music it replaces.
LOUDNESS = -23.3
K_SHELF = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
K_HIGH = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def loudness(stereo: np.ndarray) -> float:
    y = lfilter(*K_HIGH, lfilter(*K_SHELF, stereo, axis=0), axis=0)
    block, hop = int(0.4 * RATE), int(0.1 * RATE)
    power = np.array([np.mean(y[i : i + block] ** 2, axis=0).sum() for i in range(0, len(y) - block + 1, hop)])

    def lufs(p):
        return -0.691 + 10 * np.log10(p + 1e-15)

    power = power[lufs(power) > -70]
    power = power[lufs(power) > lufs(power.mean()) - 10]
    return float(lufs(power.mean()))


def master(song: Song) -> np.ndarray:
    dry = render(song)
    if song.lift:
        # Thins the bass below `lift` Hz, three laps round the loop as master_loop filters, so the seam stays put.
        n = len(dry)
        dry = sosfilt(butter(2, song.lift, "high", fs=RATE, output="sos"), np.concatenate([dry, dry, dry]))[n : 2 * n]
    loop = sounds.master_loop(dry, wet=song.wet, peak_db=0.0)
    return loop * 10 ** ((LOUDNESS - loudness(loop)) / 20)


# The nine songs. Each names its key, tempo and length; bars are counted from 1 in the comments and from 0 in code.


def emerald() -> Song:
    """Moss Lantern. A forest lullaby in A dorian, 6/8 at a dotted crotchet of 48: 24 bars, 60.03 s. The left hand
    rocks through each bar's chord under the pedal. The tune leans on F sharp, the raised sixth that makes dorian sound
    like moss and lamplight rather than sorrow. A; then B, a falling sequence in the relative major that climbs back to
    the top; then A again with a music box an octave above it. Air breathes on the open fifth under all of it."""
    s = Song(seed=31_10_2026_1, seconds=60.032, bars=24, beats=2, grid=6)
    s.dynamics = [0.86, 0.9, 0.9, 0.84, 0.94, 1.02, 0.96, 0.88, 0.92, 0.96, 0.98, 0.94, 1.06, 1.0, 0.94, 0.86, 0.9, 0.94, 0.92, 0.86, 0.96, 1.02, 0.94, 0.84]
    a = ["A2 E3 A3 C4 E4", "A2 F#3 A3 D4 F#4", "A2 E3 A3 C4 E4", "G2 D3 G3 B3 E4", "C3 G3 B3 E4 G4", "D3 A3 D4 F#4 A4", "E2 B2 G3 D4 G4", "E2 B2 E3 A3 D4"]
    b = ["C3 G3 B3 E4 G4", "B2 D3 G3 D4 G4", "A2 E3 G3 C4 E4", "D3 A3 D4 F#4 A4", "C3 G3 B3 E4 G4", "B2 F#3 A3 D4 F#4", "A2 E3 G3 C4 E4", "E2 B2 E3 A3 D4"]
    s.accompany(a + b + a, [0, 1, 2, 3, 4, 3], vel=0.27, shape=(1.15, 0.92, 0.88, 0.95, 1.0, 0.86))
    tune = """
        A4 . B4 C5 . E5 | D5 . . F#5 . E5 | C5 . B4 A4 . B4 | G4 . . . . . |
        E5 . F#5 G5 . E5 | A5 . . F#5 . D5 | E5 . D5 B4 . D5 | A4 . . B4 . D5 |
        G5 . F#5 E5 . . | F#5 . E5 D5 . . | E5 . D5 C5 . . | D5 . . A4 . D5 |
        E5 . G5 B5 . A5 | F#5 . . D5 . E5 | C5 . . A4 . B4 | B4 . . . . . |"""
    again = """
        A4 . B4 C5 . E5 | D5 . . F#5 . E5 | C5 . B4 A4 . B4 | G4 . . . . . |
        E5 . F#5 G5 . E5 | A5 . . F#5 . D5 | E5 . D5 B4 . D5 | A4 . . . . B4 |"""
    s.line(tune + again, vel=0.4)
    s.line(again, inst="box", vel=0.12, bar=16, octave=1, ahead=0.0)
    s.dots("celesta", [(5, 0, "A6"), (12, 3, "B6")], vel=0.12)
    for start in range(0, 24, 4):
        s.bed("air", start, 4.6, "A3 E4 A4", vel=0.08)
    return s


def bordeaux() -> Song:
    """Velvet Hour. A slow waltz in G minor, 3/4 at 80: 24 bars, 54.02 s. The tune is a chain of sighs, each a step
    lower, over the bass on one and the chord on two and three; the minor's raised seventh pulls each phrase home, and an
    appoggiatura leans into the last chord of each. B turns to B flat major and flows in quavers; A comes back with
    candlelit celesta above it and soft strings beneath."""
    s = Song(seed=31_10_2026_2, seconds=54.016, bars=24, beats=3, grid=6)
    s.dynamics = [0.88, 0.92, 0.9, 0.86, 0.96, 1.0, 0.94, 0.86, 0.9, 0.94, 0.96, 0.9, 1.0, 1.06, 0.98, 0.9, 0.92, 0.96, 0.94, 0.92, 1.04, 1.02, 0.94, 0.86]
    a = ["G2 / G3 Bb3 D4", "C3 / G3 C4 Eb4", "A2 / G3 C4 Eb4", "D2 / F#3 A3 C4", "Eb2 / G3 Bb3 D4", "D2 / F#3 A3 C4", "D2 / G3 Bb3 D4", "D2 / F#3 C4 D4"]
    # B's G minor leaves out its D: the tune's E flat leans on that beat.
    b = ["Bb2 / F3 Bb3 D4", "C3 / G3 Bb3 Eb4", "G2 / G3 Bb3 G4", "F2 / A3 C4 Eb4", "Eb2 / G3 Bb3 Eb4", "D3 / F3 Bb3 D4", "C3 / G3 Bb3 Eb4", "D2 / F#3 A3 C4"]
    s.waltz(a + b + a, vel=0.3)
    s.line("""
        D5 . . . . . | Eb5 . . . D5 . | C5 . . . Bb4 . | A4 . . . . . |
        G5 . . . . . | F#5 . . . Eb5 . | D5 . . . C5 . | Bb4 . . . A4 . |
        F5 . G5 F5 D5 . | Eb5 . . . C5 . | D5 . Eb5 D5 Bb4 . | C5 . . . . . |
        Bb4 . C5 D5 Eb5 . | F5 . . . D5 . | Eb5 . . D5 C5 . | D5 . . . A4 C5 |
        D5 . . . C5 D5 | Eb5 . . . D5 . | C5 . . . Bb4 . | A4 . . . D5 F#5 |
        G5 . . . . . | F#5 . . . Eb5 . | D5 . . . C5 . | Bb4 . . . A4 . |""", vel=0.41)
    s.line("G5 . . . . . | F#5 . . . Eb5 . | D5 . . . C5 . | Bb4 . . . A4 . |", inst="celesta", vel=0.07, bar=20, octave=1, ahead=0.0)
    s.dots("celesta", [(7, 4, "A6"), (15, 4, "A6")], vel=0.12)
    strings = ["Bb3 D4 F4", "Bb3 Eb4 G4", "G3 Bb3 G4", "A3 C4 Eb4", "G3 Bb3 Eb4", "Bb3 D4 F4", "G3 Bb3 Eb4", "F#3 A3 C4",
               "G3 Bb3 D4", "G3 C4 Eb4", "G3 C4 Eb4", "F#3 A3 C4", "G3 Bb3 D4", "F#3 A3 C4", "G3 Bb3 D4", "F#3 C4 D4"]
    for i, notes in enumerate(strings):
        s.bed("pad", 8 + i, 1.4, notes, vel=0.055, bright=1_200, warmth=0.3)
    return s


def noir() -> Song:
    """Midnight Pearl. A nocturne in E minor, 4/4 at 60: 16 bars of 4 s, 64 s. The left hand turns wide arpeggios under
    the pedal; the right hand sings a slow line that opens on a falling sixth's answer, leaps an octave in its second
    phrase and climbs to its height through C major seven before a Neapolitan F leads home. Champagne: a celesta rises
    like bubbles at the top, and a dark breath lies under it all."""
    s = Song(seed=31_10_2026_3, seconds=64.0, bars=16, beats=4, grid=8, rubato=0.04)
    s.dynamics = [0.86, 0.9, 0.92, 0.86, 0.96, 1.0, 0.96, 0.88, 0.92, 0.96, 1.0, 1.08, 1.04, 0.96, 0.92, 0.84]
    # C major keeps its seventh for the tune: B under the tune's C would ring a minor ninth.
    left = ["E2 B2 G3 B3 E4", "C2 G2 E3 G3 D4", "A2 E3 G3 C4 E4", "B2 F#3 A3 D#4 F#4",
            "E2 B2 G3 B3 E4", "D2 B2 E3 G3 B3", "C2 G2 E3 G3 D4", "B2 F#3 A3 D#4 F#4",
            "A2 E3 G3 C4 E4", "D2 A2 F#3 A3 C4", "G2 D3 B3 D4 F#4", "C2 G2 E3 G3 D4",
            "F#2 C3 E3 A3 C4", "F2 C3 F3 A3 E4", "B2 F#3 A3 E4 F#4", "B2 F#3 A3 D#4 F#4"]
    s.accompany(left, [0, 1, 2, 3, 4, 3, 2, 1], vel=0.25, shape=(1.2, 0.9, 0.86, 0.92, 1.0, 0.88, 0.84, 0.86))
    s.line("""
        B4 . . . G5 . F#5 E5 | E5 . . . . . D5+C5 B4 | C5 . . B4 A4 . C5 . | B4 . . . A4 . D#5 . |
        B4 . . . B5 . A5 G5 | F#5 . . . E5 . D5 . | E5 . . . D5 . C5 B4 | A4 . . . . . D#5 . |
        E5 . . . A5 . G5 . | F#5 . . . . . E5 D5 | D5 . . . . . F#5 . | E5 . . . G5 . B5 . |
        A5 . . . . . E5 C5 | C5 . . . B4 . A4 . | F#5 . . . E5 . . . | D#5 . . . . . . . |""", vel=0.42)
    s.dots("celesta", [(4, 4, "B6"), (11, 4, "E6"), (11, 5, "G6"), (11, 6, "B6"), (15, 4, "F#6")], vel=0.09)
    for start in range(0, 16, 4):
        s.bed("air", start, 4.5, "E3 B3", vel=0.065)
    return s


def ivory() -> Song:
    """Porcelain Dawn. A music-box lullaby in F major, 3/4 at 75: 24 bars of 2.4 s, 57.6 s. The box sings a little
    neighbour-note tune over a felt piano that only cushions it; B rises to D and lands on the borrowed minor iv, B flat
    minor, the most nostalgic chord there is; A returns with the box's own low tines on each downbeat and thirds under
    its tune, the way a real comb plays."""
    s = Song(seed=31_10_2026_4, seconds=57.6, bars=24, beats=3, grid=6)
    s.dynamics = [0.88, 0.9, 0.92, 0.9, 0.98, 0.94, 0.92, 0.86, 0.92, 0.96, 1.0, 0.94, 0.98, 1.04, 0.96, 0.88, 0.92, 0.94, 0.94, 0.92, 1.0, 1.04, 0.94, 0.86]
    a = ["F2 / A3 C4", "E2 / G3 C4", "D2 / F3 A3", "C3 / E3 A3", "Bb2 / F3 D4", "A2 / F3 C4", "G2 / F3 Bb3", "C3 / E3 Bb3"]
    b = ["D2 / F3 A3", "A2 / E3 C4", "Bb2 / F3 D4", "F2 / A3 C4", "G2 / Bb3 D4", "Bb2 / G3 Db4", "C3 / F3 A3", "C3 / E3 Bb3"]
    end = ["F2 / A3 C4", "E2 / G3 C4", "D2 / F3 A3", "C3 / E3 A3", "Bb2 / F3 D4", "Bb2 / G3 Db4", "C3 / F3 A3", "C3 / E3 Bb3"]
    s.waltz(a + b + end, vel=0.23, shape=(1.0, 0.7, 0.62))
    s.line("""
        A5 . . Bb5 A5 . | G5 . . A5 G5 . | F5 . . G5 A5 . | C6 . . . . . |
        D6 . . C6 Bb5 . | A5 . . . F5 . | G5 . . A5 Bb5 . | C6 . . . G5 . |
        F5 . . . D6 . | C6 . . . A5 . | Bb5 . . A5 G5 . | A5 . . . . . |
        G5 . . A5 Bb5 . | Db6 . . . Bb5 . | A5 . . . . . | G5 . . . Bb5 . |
        A5,F5 . . Bb5 A5 . | G5,E5 . . A5 G5 . | F5,D5 . . G5 A5 . | C6,A5 . . . . . |
        D6,Bb5 . . C6 Bb5 . | Db6,Bb5 . . . Bb5 . | A5,F5 . . . . . | G5,E5 . . . Bb5 . |""", inst="box", vel=0.3, ahead=0.0)
    s.line("""
        F4 . . . . . | E4 . . . . . | D4 . . . . . | C4 . . . . . |
        Bb3 . . . . . | Bb3 . . . . . | C4 . . . . . | C4 . . . . . |""", inst="box", vel=0.13, bar=16, ahead=0.0)
    return s


def delina() -> Song:
    """Rosewater. A harp waltz in E flat major, 3/4 at 96: 32 bars, 60.03 s. The harp climbs through each bar's
    chord while a felt piano sings over it; each section ends with a sweep up the harp's strings. B steps down from E flat
    through the borrowed A flat minor, with a celesta an octave above the tune and soft strings under it."""
    s = Song(seed=31_10_2026_5, seconds=60.032, bars=32, beats=3, grid=6)
    s.dynamics = [0.86, 0.9, 0.9, 0.86, 0.92, 0.96, 0.94, 0.9, 0.9, 0.98, 0.94, 0.92, 0.96, 0.98, 0.92, 0.92,
                  0.98, 1.0, 1.02, 0.98, 1.06, 1.02, 0.98, 0.94, 0.92, 0.98, 0.94, 0.92, 0.94, 0.94, 0.9, 0.86]
    a = ["Eb2 Bb2 Eb3 G3 Bb3 Eb4", "Eb2 Ab2 C3 Eb3 Ab3 C4", "Eb2 Bb2 Eb3 G3 Bb3 Eb4", "Bb2 F3 Ab3 Bb3 D4 F4",
         "C2 G2 C3 Eb3 G3 C4", "Ab2 Eb3 Ab3 C4 Eb4 Ab4", "F2 C3 Eb3 A3 C4 F4", "Bb2 F3 Ab3 D4 F4 Ab4"]
    a2 = ["Eb2 Bb2 Eb3 G3 Bb3 Eb4", "Ab2 Eb3 Ab3 C4 Eb4 Ab4", "G2 D3 F3 Bb3 D4 F4", "C3 G3 Bb3 E4 G4 Bb4",
          "F2 C3 Eb3 Ab3 C4 F4", "Bb2 F3 Ab3 D4 F4 Ab4", "Eb2 Bb2 Eb3 G3 Bb3 Eb4", "Bb2 F3 Ab3 D4 F4 Ab4"]
    b = ["Ab2 Eb3 G3 C4 Eb4 G4", "G2 D3 F3 Bb3 D4 F4", "F2 C3 Eb3 Ab3 C4 F4", "Eb2 Bb2 Eb3 G3 Bb3 Eb4",
         "Ab2 Eb3 F3 B3 Eb4 F4", "G2 Bb2 Eb3 G3 Bb3 Eb4", "F2 C3 Eb3 A3 C4 F4", "Bb2 F3 Ab3 D4 F4 Ab4"]
    s.accompany(a + a2 + b + a2, [0, 1, 2, 3, 4, 5], vel=0.12, inst="harp", shape=(1.15, 0.86, 0.9, 0.94, 0.98, 1.0))
    again = "G5 . . Ab5 Bb5 . | Eb6 . . . C6 . | D6 . . . Bb5 . | G5 . . . E5 . | F5 . . . C6 . | D6 . . . Ab5 . | G5 . . . . . | F5 . . . . . |"
    high = "Eb6 . . . . . | D6 . . . Bb5 . | C6 . . . Ab5 . | Bb5 . . . G5 . | B5 . . . Ab5 . | Bb5 . . . G5 . | A5 . . . C6 . | Bb5 . . . Ab5 . |"
    s.line("G5 . . Ab5 Bb5 . | C6 . . . Ab5 . | G5 . . F5 Eb5 . | F5 . . . . . | Eb5 . . . G5 . | C6 . . Bb5 Ab5 . | A5 . . . C6 . | Bb5 . . . . . |"
           + again + high + again, vel=0.42)
    s.line(high, inst="celesta", vel=0.06, bar=16, octave=1, ahead=0.0)
    for end in (7, 15, 31):
        s.gliss(end + 1 / 3, "Bb3 D4 F4 Ab4 Bb4 D5 F5 Ab5 Bb5", step=0.075, vel=0.16)
    strings = ["C4 Eb4 G4", "Bb3 D4 F4", "Ab3 C4 Eb4", "G3 Bb3 Eb4", "B3 Eb4 F4", "G3 Bb3 Eb4", "A3 C4 Eb4", "Ab3 D4 F4"]
    for i, notes in enumerate(strings):
        s.bed("pad", 16 + i, 1.5, notes, vel=0.07, bright=1_400, warmth=0.2)
    return s


def sapphire() -> Song:
    """Silver Current. Water in E major, 4/4 at 64: 16 bars, 60.03 s. A harp runs in semiquaver waves up and down
    each bar's chord, never stopping, with the felt piano's bass under it and its slow tune floating above in long notes.
    The second half turns to C and D major, borrowed from the minor, to find home again by the old modal way up; a
    platinum celesta glints at the top and doubles the tune there."""
    s = Song(seed=31_10_2026_6, seconds=60.032, bars=16, beats=4, grid=8, rubato=0.025)
    s.dynamics = [0.88, 0.9, 0.94, 0.9, 0.94, 0.98, 0.96, 0.92, 0.96, 1.02, 1.08, 1.02, 1.04, 1.08, 0.98, 0.88]
    waves = ["E2 B2 G#3 D#4 F#4 B4", "C#2 G#2 E3 G#3 B3 E4", "A2 E3 G#3 C#4 E4 G#4", "B2 F#3 C#4 D#4 F#4 B4",
             "E2 B2 G#3 D#4 F#4 B4", "G#2 D#3 F#3 B3 D#4 F#4", "A2 E3 G#3 C#4 E4 G#4", "B2 F#3 A3 E4 F#4 A4",
             "C2 G2 E3 G3 B3 D4", "D2 A2 F#3 A3 C#4 E4", "E2 B2 G#3 D#4 F#4 B4", "C#2 G#2 E3 G#3 B3 E4",
             "A2 E3 G#3 C#4 E4 G#4", "G#2 D#3 F#3 B3 D#4 F#4", "F#2 C#3 E3 A3 C#4 E4", "B2 F#3 A3 E4 F#4 A4"]
    s.accompany(waves, [0, 1, 2, 3, 4, 5, 4, 3, 1, 2, 3, 4, 5, 4, 3, 2], vel=0.085, inst="harp",
                shape=(1.1, 0.8, 0.84, 0.88, 0.94, 1.0, 0.9, 0.82, 0.86, 0.84, 0.88, 0.94, 1.0, 0.9, 0.84, 0.8))
    s.accompany([w.split()[0] for w in waves], [0, None, None, None, None, None, None, None], vel=0.24)
    tune = """
        G#5 . . . . . F#5 . | E5 . . . . . . . | D#5 . . . C#5 . E5 . | F#5 . . . . . . . |
        G#5 . . . . . B5 . | D#6 . . . . . B5 . | G#5 . . . . . E5 . | F#5 . . . . . . . |
        G5 . . . F#5 . E5 . | A5 . . . G#5 . F#5 . | G#5 . . . . . . . | B5 . . . . . G#5 . |
        C#6 . . . . . B5 . | D#6 . . . B5 . G#5 . | A5 . . . G#5 . E5 . | F#5 . . . . . . . |"""
    s.line(tune, vel=0.42, legato=0.35)
    s.line("G#5 . . . . . . . | B5 . . . . . G#5 . | C#6 . . . . . B5 . | D#6 . . . B5 . G#5 . |", inst="celesta", vel=0.05, bar=10, octave=1, ahead=0.0)
    s.dots("celesta", [(4, 6, "B6"), (10, 2, "E6"), (10, 3, "G#6"), (10, 4, "B6"), (15, 4, "F#6")], vel=0.1)
    for start in range(0, 16, 4):
        s.bed("air", start, 4.5, "B3 E4", vel=0.07)
    return s


def cognac() -> Song:
    """Hearthlight. A fireside waltz in B flat major, 3/4 at 90: 32 bars of 2 s, 64 s. Oom-pah-pah low and warm, a tune
    in the middle of the keyboard that falls three-two-one and dips to the flat seventh, A flat, for a folk warmth. A
    again rises to G flat over the borrowed minor iv; B tells its story in G minor through a secondary dominant; the last
    A comes back with a second voice in thirds beneath the tune, like two people humming by the fire. Sparks: a few
    celesta notes."""
    s = Song(seed=31_10_2026_7, seconds=64.0, bars=32, beats=3, grid=6)
    s.dynamics = [0.88, 0.9, 0.9, 0.88, 0.94, 0.98, 0.94, 0.88, 0.9, 0.96, 0.94, 0.9, 0.96, 1.02, 0.96, 0.88,
                  0.92, 0.94, 0.98, 1.0, 1.02, 1.0, 1.04, 0.96, 0.94, 0.96, 0.94, 0.92, 0.98, 1.0, 0.92, 0.86]
    a = ["Bb2 / F3 Bb3 D4", "A2 / F3 A3 C4", "G2 / G3 Bb3 D4", "D3 / F3 Ab3 Bb3", "Eb2 / G3 Bb3 Eb4", "Ab2 / Ab3 C4 Eb4", "F2 / F3 Bb3 D4", "F2 / A3 C4 Eb4"]
    a2 = ["Bb2 / F3 Bb3 D4", "A2 / F3 A3 C4", "G2 / G3 Bb3 D4", "G2 / G3 Bb3 Eb4", "Eb2 / G3 Bb3 Eb4", "Eb2 / Gb3 Bb3 C4", "F2 / F3 Bb3 D4 / A3 C4 Eb4", "Bb2 / F3 Bb3 D4"]
    b = ["G2 / G3 Bb3 D4", "D3 / F3 A3 D4", "Eb2 / G3 Bb3 Eb4", "Bb2 / F3 Bb3 D4", "C3 / G3 Bb3 Eb4", "F2 / A3 C4 Eb4", "D3 / F3 A3 C4 / F3 B3 D4", "C3 / G3 Bb3 Eb4 / A3 C4 Eb4"]
    s.pedals = sorted(s.pedals + [14 + 2 / 3, 22 + 2 / 3, 23 + 2 / 3])  # the bars that change chord on three
    s.waltz(a + a2 + b + a, vel=0.24, shape=(1.0, 0.72, 0.64))
    first = "D5 . . C5 Bb4 . | C5 . . . F4 . | Bb4 . . A4 G4 . | Ab4 . . . F4 . | G4 . . Bb4 Eb5 . | C5 . . . Eb5 . | D5 . . C5 Bb4 . | C5 . . . . . |"
    s.line(first
           + "D5 . . C5 Bb4 . | C5 . . . F5 . | D5 . . C5 Bb4 . | Bb4 . . . G4 . | G4 . . Bb4 Eb5 . | Gb5 . . . Eb5 . | D5 . . . C5 . | Bb4 . . . . . |"
           + "G4 . A4 Bb4 C5 . | D5 . . . A4 . | Bb4 . C5 D5 Eb5 . | F5 . . . D5 . | Eb5 . D5 C5 Bb4 . | A4 . . . C5 . | F5 . . . D5 . | Eb5 . . . C5 . |"
           + first, vel=0.43)
    s.line("Bb4 . . A4 G4 . | A4 . . . . . | G4 . . F4 D4 . | F4 . . . D4 . | Eb4 . . G4 Bb4 . | Ab4 . . . C5 . | Bb4 . . A4 G4 . | A4 . . . . . |",
           vel=0.31, bar=24)
    s.dots("celesta", [(5, 4, "C6"), (13, 0, "Gb6"), (19, 0, "F6"), (29, 4, "C6")], vel=0.09)
    warm = ["G3 Bb3 D4", "F3 A3 D4", "G3 Bb3 Eb4", "F3 Bb3 D4", "G3 Bb3 Eb4", "A3 C4 Eb4", "F3 A3 D4", "G3 C4 Eb4"]
    for i, notes in enumerate(warm):
        s.bed("pad", 16 + i, 1.4, notes, vel=0.05, bright=1_000, warmth=0.45)
    return s


def amethyst() -> Song:
    """Plum Twilight. Stars in D lydian, 4/4 at 75: 16 bars of 3.2 s, 51.2 s. A celesta sings the tune, wide and slow,
    over rolled felt piano chords that rock between D and E over D, the lydian lift; its long notes rest on G sharp, the
    raised fourth, the sound of a sky that isn't quite of this world. The second half sets the piano moving in quavers;
    a velvet string bed holds it all, and tiny celesta stars come and go high above."""
    s = Song(seed=31_10_2026_8, seconds=51.2, bars=16, beats=4, grid=8, rubato=0.035)
    s.dynamics = [0.86, 0.9, 0.92, 0.88, 0.94, 0.98, 1.0, 0.94, 0.96, 1.0, 1.04, 1.08, 1.02, 0.96, 0.9, 0.86]
    chords = ["D3 A3 C#4 F#4", "D3 G#3 B3 E4", "D3 A3 C#4 F#4", "D3 G#3 B3 E4", "B2 F#3 A3 D4", "C#3 G#3 B3 E4", "F#2 C#3 E3 A3", "A2 E3 A3 D4",
              "B2 F#3 A3 D4", "F#2 C#3 E3 A3", "E2 B2 G#3 D4", "A2 E3 A3 D4", "B2 F#3 A3 D4", "C#3 G#3 B3 E4", "A2 E3 A3 D4", "D3 G#3 B3 E4"]
    after = {7: "A2 E3 A3 C#4"}  # the suspended fourth settles on three, with the pedal changed for it
    s.pedals = sorted(s.pedals + [7.5])
    for i, notes in enumerate(chords[:8]):
        s.rolled(i, notes, vel=0.3)
        s.rolled(i + 0.5, after.get(i, notes), vel=0.21)
    s.accompany(chords[8:], [0, 1, 2, 3, 2, 1, 2, 3], vel=0.24, bar=8, shape=(1.15, 0.86, 0.9, 1.0, 0.88, 0.84, 0.9, 0.86))
    s.line("""
        F#5 . . . A5 . C#6 . | B5 . . . G#5 . . . | A5 . . . F#5 . E5 . | G#5 . . . . . . . |
        F#5 . . . D6 . C#6 . | B5 . . . G#5 . E5 . | A5 . . . . . C#6 . | B5 . . . A5 . . . |
        F#5 . . . A5 . D6 . | C#6 . . . B5 . A5 . | G#5 . . . F#5 . B5 . | A5 . . . . . E6 . |
        D6 . . . C#6 . B5 . | G#5 . . . . . E5 . | D5 . . . . . E5 . | G#5 . . . . . . . |""", inst="celesta", vel=0.24, ahead=0.0, legato=0.45)
    # Stars: a high celesta note on an off-beat in each bar, some bars two, from the chord or the lydian fourth.
    stars = ["C#7", "A6", "F#6", "G#6", "E7", "B6"]
    for i in range(16):
        for step in sorted(rng.choice([1, 3, 5, 7], size=1 + (i % 3 == 1), replace=False)):
            s.dots("celesta", [(i, int(step), str(rng.choice(stars)))], vel=float(rng.uniform(0.06, 0.1)))
    velvet = ["A3 C#4 F#4", "G#3 B3 E4", "A3 C#4 F#4", "G#3 B3 E4", "F#3 A3 D4", "G#3 B3 E4", "A3 C#4 E4", "A3 E4",
              "F#3 A3 D4", "A3 C#4 E4", "G#3 B3 D4", "A3 D4 E4", "F#3 A3 D4", "G#3 B3 E4", "A3 D4 E4", "G#3 B3 E4"]
    for i, notes in enumerate(velvet):
        s.bed("pad", i, 1.3, notes, vel=0.08, bright=1_100, warmth=0.22)
    return s


def riviera() -> Song:
    """Sunlit Harbor. A seaside barcarolle in A major, 6/8 at a dotted crotchet of 60: 24 bars of 2 s, 48 s. The left
    hand rocks like a boat at its mooring; the tune skips up through the chord and floats down again. B has a music box
    an octave above it, sea glass in the sun; the last A borrows G major, the flat seventh, for a breath of salt air, and
    a breeze moves under all of it."""
    s = Song(seed=31_10_2026_9, seconds=48.0, bars=24, beats=2, grid=6, lift=140)
    s.dynamics = [0.9, 0.92, 0.94, 0.9, 0.98, 1.0, 0.94, 0.9, 0.92, 0.94, 0.98, 0.94, 1.0, 1.04, 0.96, 0.9, 0.92, 0.96, 0.94, 0.92, 1.02, 1.0, 0.94, 0.88]
    left = ["A2 E3 A3 C#4", "G#2 E3 B3 E4", "F#2 C#3 A3 C#4", "D3 A3 D4 F#4", "C#3 A3 C#4 E4", "B2 F#3 A3 D4", "E2 B2 A3 D4", "E2 B2 G#3 D4",
            "D3 A3 D4 F#4", "C#3 A3 C#4 E4", "B2 F#3 A3 D4", "E2 B2 G#3 E4", "C#3 G#3 B3 E4", "F#2 C#3 E3 A3", "B2 F#3 A3 D4", "E2 B2 A3 D4",
            "A2 E3 A3 C#4", "G2 D3 G3 B3", "F#2 D3 A3 D4", "E2 A3 C#4 E4", "D3 A3 D4 F#4", "B2 F#3 A3 D4", "E2 B2 A3 D4", "E2 B2 G#3 D4"]
    # A light hand on the bass: the boat rocks, it doesn't thud.
    s.accompany(left, [0, 1, 2, 3, 2, 1], vel=0.26, shape=(0.88, 0.82, 0.92, 1.0, 0.9, 0.8))
    middle = "A5 . . F#5 . D5 | E5 . . C#5 . A4 | D5 . . F#5 . B5 | A5 . . G#5 . . | E5 . G#5 B5 . G#5 | A5 . . C#6 . A5 | F#5 . E5 D5 . B4 | E5 . . . . . |"
    s.line("C#5 . E5 A5 . E5 | G#5 . F#5 E5 . B4 | A5 . G#5 F#5 . C#5 | A5 . . F#5 . D5 | E5 . A5 C#6 . A5 | B5 . A5 F#5 . D5 | E5 . . A5 . . | G#5 . . . . . |"
           + middle
           + "C#5 . E5 A5 . E5 | B5 . . G5 . D5 | F#5 . . A5 . F#5 | E5 . . C#5 . . | D5 . F#5 A5 . D6 | C#6 . B5 A5 . F#5 | A5 . . E5 . . | D5 . . B4 . . |",
           vel=0.39)
    s.line(middle, inst="box", vel=0.1, bar=8, octave=1, ahead=0.0)
    s.dots("celesta", [(4, 3, "C#7"), (20, 5, "A6")], vel=0.12)
    for start, notes in zip(range(0, 24, 4), ("E4 B4", "E4 B4", "D4 A4", "E4 B4", "D4 A4", "E4 B4")):
        s.bed("air", start, 4.6, notes, vel=0.075)
    return s


SONGS = {"emerald": emerald, "bordeaux": bordeaux, "noir": noir, "ivory": ivory, "delina": delina, "sapphire": sapphire, "cognac": cognac, "amethyst": amethyst, "riviera": riviera}


def main(out: Path, ffmpeg: str | None = None, only: list[str] | None = None) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for name, make in SONGS.items():
        if only and name not in only:
            continue
        song = make()
        loop = master(song)
        sounds.write(out / f"theme-{name}.wav", loop)
        if ffmpeg:
            sounds.encode_loop(ffmpeg, loop, out / f"theme-{name}.m4a", 112)
        peak = 20 * np.log10(np.max(np.abs(loop)))
        print(f"{name}: {song.length:g} s, {len(song.events)} notes, {loudness(loop):.1f} LUFS, peak {peak:.1f} dBFS", flush=True)


if __name__ == "__main__":
    # python -I scripts/make-theme-songs.py <out-dir> [path to ffmpeg] [theme ...]
    args = sys.argv[1:]
    main(Path(args[0] if args else "theme-songs-out"), args[1] if len(args) > 1 else None, args[2:])
