"""Score model (Song / Part / Event) and composition helpers."""
from __future__ import annotations

import re
import zlib
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from .theory import Chord, bass_note, midi, voice


@dataclass
class Event:
    beat: float
    dur: float  # beats
    pitch: float | None  # MIDI number (None for unpitched drums)
    vel: float = 0.8
    kw: dict = field(default_factory=dict)


@dataclass
class Part:
    name: str
    inst: Callable
    level: float  # target loudness in LU relative to the song's reference (lead ~ 0)
    stem: str = "full"
    pan: float = 0.0
    rev: float = 0.25  # reverb send 0..1
    dly: float = 0.0  # delay send 0..1
    eq: list = field(default_factory=list)
    chorus: float = 0.0  # chorus mix (0 = off)
    tremolo: float = 0.0  # autopan depth (Rhodes-like), 0..1
    tremolo_rate: float = 4.0
    width: float = 1.0  # stereo width (M/S)
    duck: float = 0.0  # sidechain depth from the song's kick, 0..1
    human_ms: float = 8.0
    human_vel: float = 0.06
    swing: float = 0.0  # 0..1 delay of off-beat 16ths (fraction of a 16th)
    kw: dict = field(default_factory=dict)
    events: list[Event] = field(default_factory=list)

    def note(self, beat: float, dur: float, pitch, vel: float = 0.8, **kw) -> "Part":
        if isinstance(pitch, str):
            pitch = midi(pitch)
        self.events.append(Event(beat, dur, pitch, vel, kw))
        return self

    def hit(self, beat: float, vel: float = 0.8, dur: float = 0.25, **kw) -> "Part":
        self.events.append(Event(beat, dur, None, vel, kw))
        return self


class Song:
    def __init__(self, id: str, title: str, mood: str, bpm: float, key: str, bars: int,
                 beats_per_bar: int = 4, seed: int = 1, beat_unit: str = "quarter"):
        self.id = id
        self.title = title
        self.mood = mood
        self.bpm = bpm
        self.key = key
        self.bars = bars
        self.bpb = beats_per_bar
        self.beat_unit = beat_unit
        self.seed = seed
        self.parts: list[Part] = []
        self.reverb = dict(seconds=3.2, rt_low=2.6, rt_high=1.2, predelay=0.025, width=1.0,
                           hp=200.0, lp=7000.0, wet_lu=-9.0)
        self.delay = dict(beats=0.75, feedback=0.38, wet_lu=-15.0, into_reverb=0.35)
        # default master tilt: a little less sub, a touch of presence, softer fizz on top
        self.master = dict(lufs=-16.0, ceiling=-2.0, comp_threshold=-17.0, comp_ratio=1.8,
                           eq=[("lowshelf", 90.0, -1.5), ("peak", 2600.0, 1.5, 0.7), ("highshelf", 9500.0, -1.5)])
        self.kick_part: str | None = None
        self.sections: list[tuple[str, int]] = []  # (label, bar) – documentation only
        self.notes: str = ""

    @property
    def spb(self) -> float:
        return 60.0 / self.bpm

    @property
    def beats(self) -> int:
        return self.bars * self.bpb

    @property
    def seconds(self) -> float:
        return self.beats * self.spb

    def part(self, name: str, inst: Callable, level: float, **opts) -> Part:
        p = Part(name=name, inst=inst, level=level, **opts)
        self.parts.append(p)
        return p

    def rng(self, salt: str) -> np.random.Generator:
        return np.random.default_rng([self.seed, zlib.crc32(f"{self.id}:{salt}".encode())])

    def section(self, label: str, bar: int) -> None:
        self.sections.append((label, bar))


# ---------------------------------------------------------------- composition helpers

TOKEN = re.compile(r"^(r|[A-G][#b]?-?\d)(?::([\d./]+))?([!?]*)$")


def _dur(text: str) -> float:
    if "/" in text:
        a, b = text.split("/")
        return float(a) / float(b)
    return float(text)


def phrase(part: Part, start: float, text: str, vel: float = 0.75, legato: float = 0.95,
           transpose: int = 0, **kw) -> float:
    """Write a melody: tokens 'D5:1 E5:.5 r:.5 F#5:2!' (duration in beats; '!' accent, '?' ghost).

    Returns the beat after the phrase.
    """
    beat = start
    for tok in text.split():
        m = TOKEN.match(tok)
        if not m:
            raise ValueError(f"bad token {tok!r}")
        name, d, marks = m.group(1), _dur(m.group(2) or "1"), m.group(3)
        if name != "r":
            v = vel * (1.18 if "!" in marks else 1.0) * (0.6 if "?" in marks else 1.0)
            part.note(beat, d * legato, midi(name) + transpose, min(v, 1.0), **kw)
        beat += d
    return beat


def progression(spec: str, beats_per_bar: int = 4) -> list[tuple[float, float, Chord]]:
    """'Dmaj9 Bm7 | Gmaj7:2 A:2' -> [(start_beat, length_beats, Chord)].

    Bars are separated by '|'; chords in a bar share it equally unless ':beats' is given.
    """
    out = []
    beat = 0.0
    for bar in spec.split("|"):
        toks = bar.split()
        if not toks:
            continue
        fixed = [t for t in toks if ":" in t]
        used = sum(float(t.split(":")[1]) for t in fixed)
        free = [t for t in toks if ":" not in t]
        each = (beats_per_bar - used) / len(free) if free else 0
        for t in toks:
            sym, _, ln = t.partition(":")
            length = float(ln) if ln else each
            out.append((beat, length, Chord(sym)))
            beat += length
    return out


def offset(prog, beats: float):
    return [(b + beats, l, c) for b, l, c in prog]


def pad_chords(part: Part, prog, low=52, high=74, n=4, vel=0.6, overlap=0.15, prev=None, **kw):
    """Sustained voicings with smooth voice leading (no pedal tones). Returns the last voicing."""
    held: dict[int, int] = getattr(part, "_held", {})
    for b, l, c in prog:
        v = voice(c, prev, low, high, n, held=held)
        held = {p: held.get(p, 0) + 1 for p in v}
        for p in v:
            part.note(b, l + overlap, p, vel, **kw)
        prev = v
    part._held = held
    return prev


def comp_chords(part: Part, prog, rhythm: list[tuple[float, float, float]], low=53, high=74, n=4,
                prev=None, roll=0.012, **kw):
    """Rhythmic comping. rhythm: [(beat_in_chord, dur, vel)] repeated per chord span (wraps by bar)."""
    held: dict[int, int] = getattr(part, "_held", {})
    for b, l, c in prog:
        v = voice(c, prev, low, high, n, held=held)
        held = {p: held.get(p, 0) + 1 for p in v}
        prev = v
        part._held = held
        for rb, rd, rv in rhythm:
            if rb >= l:
                continue
            for i, p in enumerate(v):
                part.note(b + rb + i * roll, min(rd, l - rb), p, rv, **kw)
    return prev


def arpeggio(part: Part, prog, pattern: list[int], step: float = 0.5, low=60, high=84, vel=0.6,
             accent: float = 0.15, gate: float = 0.9, octaves: int = 2, n=4, prev=None, **kw):
    """Arpeggiate each chord: pattern indexes into the ascending chord-tone ladder."""
    for b, l, c in prog:
        v = voice(c, prev, low, min(high, low + 16), n)
        prev = v
        ladder = sorted({p + 12 * o for p in v for o in range(octaves) if p + 12 * o <= high})
        steps = int(round(l / step))
        for i in range(steps):
            idx = pattern[i % len(pattern)]
            if idx < 0:
                continue
            p = ladder[idx % len(ladder)]
            acc = accent if (i * step) % 1.0 == 0 else 0
            part.note(b + i * step, step * gate, p, min(1.0, vel + acc), **kw)
    return prev


def bassline(part: Part, prog, rhythm: list[tuple[float, float, float, int]], low=31, high=45, prev=None,
             **kw):
    """rhythm: [(beat_in_chord, dur, vel, interval)] where interval is semitones above the bass note
    (0 root, 7 fifth, 12 octave, -5 fourth below…); entries past the chord length are skipped."""
    for b, l, c in prog:
        root = bass_note(c, prev, low, high)
        prev = root
        for rb, rd, rv, iv in rhythm:
            if rb >= l:
                continue
            part.note(b + rb, min(rd, l - rb), root + iv, rv, **kw)
    return prev


def drum_line(part: Part, start_beat: float, bars: int, pattern: str, beats_per_bar: int = 4,
              vel: float = 0.8, accents: str | None = None, **kw):
    """pattern: one char per 16th per bar ('x' hit, 'o' soft, '.' rest), repeated for `bars`."""
    steps = len(pattern)
    step = beats_per_bar / steps
    for bar in range(bars):
        for i, ch in enumerate(pattern):
            if ch in "xXo":
                v = vel * (1.15 if ch == "X" else 0.55 if ch == "o" else 1.0)
                part.hit(start_beat + bar * beats_per_bar + i * step, min(v, 1.0), **kw)


# ---------------------------------------------------------------- theory lint

def harmony(song: Song, timeline: list[tuple[int, list]]) -> list[tuple[float, float, "Chord"]]:
    """Register the song's chord timeline [(bar, progression)] (absolute beats) for linting."""
    out = []
    for bar, prog in timeline:
        out.extend(offset(prog, bar * song.bpb))
    song.harmony = out
    return out


def lint(song: Song, part_names: list[str], strong_min: float = 0.75) -> list[str]:
    """Flag melody notes that clash with the chord under them.

    A note is checked when it is long (>= strong_min beats) or starts on a beat. Allowed:
    chord tones plus 9th, 11th on minor/sus chords, 13th (6th) on major chords and #11 on maj7.
    Flagged: minor 9ths against chord tones and the natural 11th held over a major third.
    """
    chords = getattr(song, "harmony", [])
    warnings = []
    if not chords:
        return warnings
    for part in song.parts:
        if part.name not in part_names:
            continue
        for ev in part.events:
            if ev.pitch is None:
                continue
            if song.bpb in (6, 12) and song.beat_unit == "eighth":
                on_beat = abs(ev.beat / 3 - round(ev.beat / 3)) < 1e-6  # compound meter: dotted quarters
            else:
                on_beat = abs(ev.beat - round(ev.beat)) < 1e-6
            min_len = strong_min * (2 if song.beat_unit == "eighth" else 1)
            if ev.dur < min_len and not on_beat:
                continue
            ch = next((c for b, l, c in chords if b <= ev.beat + 1e-6 < b + l), None)
            if ch is None:
                continue
            pcn = int(round(ev.pitch)) % 12
            rel = (pcn - ch.root) % 12
            tones = {i % 12 for i in ch.intervals} | {(ch.bass - ch.root) % 12}
            major = 4 in tones
            minor = 3 in tones
            ok = set(tones) | {2}
            if minor or (4 not in tones and 3 not in tones):
                ok |= {5}
            if major:
                ok |= {9}
            if 11 in tones:
                ok |= {6}
            if minor:
                ok |= {9} if 10 in tones else set()
            if rel in ok:
                continue
            bad = any((rel - t) % 12 == 1 for t in tones)
            if ev.dur >= min_len or bad:
                bar = ev.beat / song.bpb
                warnings.append(f"{song.id}:{part.name} bar {int(bar)} beat {ev.beat % song.bpb:.2f} "
                                f"pitch {int(ev.pitch)} over {ch.symbol}" + (" (b9 clash)" if bad else ""))
    return warnings


def walking_bass(part: Part, prog, rhythm, scale_pcs: list[int], low=31, high=45, prev=None, **kw):
    """Like bassline, but an interval of 'ap' plays a diatonic approach note into the next chord's
    bass (a step above or below, whichever is closer to the current note)."""
    roots = []
    for b, l, c in prog:
        prev = bass_note(c, prev, low, high)
        roots.append(prev)
    for i, (b, l, c) in enumerate(prog):
        root = roots[i]
        nxt = roots[(i + 1) % len(roots)]
        for rb, rd, rv, iv in rhythm:
            if rb >= l:
                continue
            if iv == "ap":
                cands = [nxt + d for d in (-2, -1, 1, 2) if (nxt + d) % 12 in scale_pcs]
                p = min(cands, key=lambda q: (abs(q - root), abs(q - nxt))) if cands else nxt - 1
            else:
                p = root + iv
            part.note(b + rb, min(rd, l - rb), p, rv, **kw)
    return prev


def bars(part: Part, start_beat: float, lines: list[str], bpb: int = 4, **kw) -> float:
    """One melody line per bar; asserts every line fills exactly one bar."""
    beat = start_beat
    for i, line in enumerate(lines):
        end = phrase(part, beat, line, **kw)
        if abs(end - beat - bpb) > 1e-6:
            raise ValueError(f"{part.name}: bar {i} of the block at beat {start_beat} lasts {end - beat} beats: {line}")
        beat = end
    return beat
