"""Pitch names, chord symbols and voice leading."""
from __future__ import annotations

import itertools
import re

PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

CHORD_QUALITIES: dict[str, list[int]] = {
    "": [0, 4, 7],
    "m": [0, 3, 7],
    "5": [0, 7],
    "7": [0, 4, 7, 10],
    "maj7": [0, 4, 7, 11],
    "m7": [0, 3, 7, 10],
    "mmaj7": [0, 3, 7, 11],
    "6": [0, 4, 7, 9],
    "m6": [0, 3, 7, 9],
    "69": [0, 4, 7, 9, 14],
    "add9": [0, 4, 7, 14],
    "madd9": [0, 3, 7, 14],
    "maj9": [0, 4, 7, 11, 14],
    "m9": [0, 3, 7, 10, 14],
    "m11": [0, 3, 7, 10, 14, 17],
    "9": [0, 4, 7, 10, 14],
    "sus2": [0, 2, 7],
    "sus4": [0, 5, 7],
    "7sus4": [0, 5, 7, 10],
    "9sus4": [0, 5, 7, 10, 14],
    "dim": [0, 3, 6],
    "m7b5": [0, 3, 6, 10],
    "aug": [0, 4, 8],
    "maj7#11": [0, 4, 7, 11, 18],
    "7b9": [0, 4, 7, 10, 13],
}


def pc(name: str) -> int:
    base = PC[name[0].upper()]
    for ch in name[1:]:
        if ch == "#":
            base += 1
        elif ch == "b":
            base -= 1
    return base % 12


def midi(name: str) -> int:
    """'F#4' -> 66 (C4 = 60)."""
    m = re.fullmatch(r"([A-Ga-g][#b]*)(-?\d)", name)
    if not m:
        raise ValueError(name)
    letters, octave = m.group(1), int(m.group(2))
    base = PC[letters[0].upper()]
    for ch in letters[1:]:
        base += 1 if ch == "#" else -1
    return base + 12 * (octave + 1)


def hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


class Chord:
    def __init__(self, symbol: str):
        self.symbol = symbol
        main, _, bass = symbol.partition("/")
        m = re.fullmatch(r"([A-G][#b]?)(.*)", main)
        if not m:
            raise ValueError(symbol)
        self.root = pc(m.group(1))
        q = m.group(2)
        if q not in CHORD_QUALITIES:
            raise ValueError(f"unknown chord quality {q!r} in {symbol}")
        self.intervals = CHORD_QUALITIES[q]
        self.bass = pc(bass) if bass else self.root

    @property
    def pcs(self) -> list[int]:
        return sorted({(self.root + i) % 12 for i in self.intervals})

    def guide_tones(self) -> set[int]:
        """Third and seventh (or sus tone) – must be present in a voicing."""
        out = set()
        for i in self.intervals:
            if i % 12 in (3, 4, 10, 11, 5, 2) and i < 12:
                out.add((self.root + i) % 12)
        return out

    def tensions(self) -> set[int]:
        return {(self.root + i) % 12 for i in self.intervals if i >= 12}


def voice(chord: Chord, prev: list[int] | None, low: int = 52, high: int = 76, n: int = 4,
          mud_floor: int = 55, held: dict[int, int] | None = None) -> list[int]:
    """Choose an n-note voicing of `chord` in [low, high] with smooth voice leading.

    Rules: guide tones must be present, tensions are welcome, no seconds below
    `mud_floor` (muddy), no interval < 3 semitones between the two lowest notes,
    minimal total motion from `prev`.
    """
    pcs = set(chord.pcs)
    cands = [p for p in range(low, high + 1) if p % 12 in pcs]
    guide = chord.guide_tones()
    best = None
    best_cost = 1e9
    for combo in itertools.combinations(cands, n):
        notes = list(combo)
        present = {p % 12 for p in notes}
        if not guide <= present:
            continue
        if len(present) < min(n, len(pcs)) - 1:
            continue
        bad = False
        for a, b in zip(notes, notes[1:]):
            if b - a < 3 and a < mud_floor:
                bad = True
            if b - a == 1:
                bad = True  # minor seconds inside a pad sound like a clash
            if b - a > 9:
                bad = True  # keep the voicing compact
        if notes[1] - notes[0] < 3:
            bad = True
        if bad:
            continue
        if prev:
            cost = sum(abs(a - b) for a, b in zip(sorted(prev), notes))
        else:
            center = (low + high) / 2
            cost = abs(sum(notes) / n - center) * 2
        # prefer tensions present (colour) and a root not doubled at the top
        cost -= 0.6 * len(present & chord.tensions())
        if notes[-1] % 12 == chord.root:
            cost += 0.8
        if held:
            # avoid pedal tones: a pitch already held over 2+ chords should move
            cost += 5.0 * sum(1 for p in notes if held.get(p, 0) >= 2)
            # and keep the top voice moving
            if prev and notes[-1] == sorted(prev)[-1] and held.get(notes[-1], 0) >= 1:
                cost += 1.5
        if cost < best_cost:
            best_cost = cost
            best = notes
    if best is None:
        # fall back: closest chord tones
        best = sorted(cands[: n])
    return best


def bass_note(chord: Chord, prev: int | None, low: int = 33, high: int = 47) -> int:
    opts = [p for p in range(low, high + 1) if p % 12 == chord.bass]
    if prev is None:
        return opts[len(opts) // 2] if len(opts) > 1 else opts[0]
    return min(opts, key=lambda p: (abs(p - prev), p))


def scale(root: str, mode: str) -> list[int]:
    steps = {
        "major": [0, 2, 4, 5, 7, 9, 11],
        "minor": [0, 2, 3, 5, 7, 8, 10],
        "dorian": [0, 2, 3, 5, 7, 9, 10],
        "mixolydian": [0, 2, 4, 5, 7, 9, 10],
        "lydian": [0, 2, 4, 6, 7, 9, 11],
        "harmonic": [0, 2, 3, 5, 7, 8, 11],
        "phrygian_dom": [0, 1, 4, 5, 7, 8, 10],
    }[mode]
    r = pc(root)
    return [(r + s) % 12 for s in steps]
