"""Calm 1 – "Home Belt" (mining in the home belt).

F major, 80 BPM, 4/4, 48 bars (~144 s), circular loop.
Form: Intro (4) – A (8) – B (8) – A2 (8, marimba ostinato, climax variant) – C (8, Lydian lift, vibes
melody) – B2 (8, fullest) – Outro (4, V11 back to the top).
Harmony: I–iii–IV–V (A), ii–IV–I6–ii/V (B), IV–V/IV(lydian)–iii–ii9–v9–V11–Imaj9 (C).
"""
from afm import instruments as I
from afm.song import (Song, arpeggio, comp_chords, drum_line, harmony, offset, pad_chords, phrase, progression,
                      walking_bass)
from afm.theory import scale

from .common import (EQ_BASS, EQ_BELL, EQ_HAT, EQ_KEYS, EQ_KICK, EQ_LEAD, EQ_PAD, EQ_PLUCK, KICK_SOFT, RIM,
                     SHAKER, SWELL, with_kw)


def build() -> Song:
    s = Song("calm-home-belt", "Home Belt", "calm", 80, "F major", bars=48, seed=21)
    s.notes = "Warm Rhodes-and-flute piece for mining; melody answered by marimba; Lydian lift in C."
    s.reverb.update(seconds=3.0, rt_low=2.4, rt_high=1.1, wet_lu=-9.0)
    s.delay.update(beats=0.75, feedback=0.33, wet_lu=-16)
    B = lambda bar: bar * 4  # noqa: E731

    p1 = progression("Fmaj7 | Am7 | Bbmaj7 | C6 | Fmaj7 | Am7 | Bbmaj7 | Csus4:2 C:2")
    p2 = progression("Dm7 | Bbmaj7 | Fmaj7/A | Gm7:2 C7:2 | Dm7 | Bbmaj7 | Gm7 | Bb/C")
    p3 = progression("Bbmaj7 | C/Bb | Am7 | Dm9 | Gm9 | Bb/C | Fmaj9 | Fmaj9")
    outro = progression("Bbmaj7 | Gm7 | Bb/C | Bb/C")
    sections = [("Intro", 0, p1[:4]), ("A", 4, p1), ("B", 12, p2), ("A2", 20, p1), ("C", 28, p3),
                ("B2", 36, p2), ("Outro", 44, outro)]
    for label, bar, _ in sections:
        s.section(label, bar)
    harmony(s, [(bar, prog) for _, bar, prog in sections])
    s.lint_parts = ["lead", "vibes", "marimba_answers"]

    pad = s.part("pad", with_kw(I.pad, bright=2.4, attack=1.3, release=2.4, motion=0.3), -11,
                 rev=0.5, eq=EQ_PAD, chorus=0.2, width=1.2)
    keys = s.part("epiano", with_kw(I.epiano, decay=2.4, bark=0.8), -7, rev=0.3, eq=EQ_KEYS, chorus=0.25,
                  tremolo=0.4, tremolo_rate=3.2, human_ms=9)
    harp = s.part("harp", with_kw(I.pluck, pick=0.28, decay=1.6, bright=0.6, rolloff=1.2), -13, rev=0.4,
                  dly=0.25, eq=EQ_PLUCK, pan=-0.2, human_ms=6)
    marimba = s.part("marimba", with_kw(I.mallet, kind="marimba"), -11, rev=0.3, dly=0.15, eq=EQ_BELL,
                     pan=0.25, human_ms=6)
    answers = s.part("marimba_answers", with_kw(I.mallet, kind="marimba"), -6, rev=0.35, dly=0.3, eq=EQ_BELL,
                     pan=0.3, human_ms=8)
    vibes = s.part("vibes", with_kw(I.mallet, kind="vibes", tremolo=0.3, decay_scale=0.9), -3, rev=0.45,
                   dly=0.25, eq=EQ_BELL, human_ms=10)
    bass = s.part("bass", with_kw(I.bass, style="round"), -8, rev=0.05, eq=EQ_BASS, human_ms=6)
    lead = s.part("lead", with_kw(I.lead_soft, vib=10, breath=0.02), 0, rev=0.33, dly=0.2, eq=EQ_LEAD,
                  human_ms=12)
    kick = s.part("kick", KICK_SOFT, -12, rev=0.08, eq=EQ_KICK, human_ms=3)
    rim = s.part("rim", RIM, -17, rev=0.25, pan=0.15, human_ms=6)
    shaker = s.part("shaker", SHAKER, -23, rev=0.15, eq=EQ_HAT, pan=-0.3, human_ms=6, swing=0.2)
    swell = s.part("swell", SWELL, -20, rev=0.3, human_ms=0)

    prev = None
    for label, bar, prog in sections:
        vel = {"Intro": 0.5, "A": 0.55, "B": 0.6, "A2": 0.62, "C": 0.7, "B2": 0.65, "Outro": 0.5}[label]
        prev = pad_chords(pad, offset(prog, B(bar)), low=50, high=72, n=4, vel=vel, prev=prev)

    kprev = None
    comp = [(0, 1.9, 0.55), (2.5, 1.4, 0.48)]
    comp_b = [(0, 1.4, 0.55), (1.5, 0.9, 0.42), (2.5, 0.45, 0.45), (3, 0.95, 0.4)]
    for label, bar, prog in sections:
        rhythm = {"Intro": [(0, 3.6, 0.45)], "A": comp, "B": comp_b, "A2": comp, "C": [(0, 3.6, 0.42)],
                  "B2": comp_b, "Outro": [(0, 3.6, 0.42)]}[label]
        kprev = comp_chords(keys, offset(prog, B(bar)), rhythm, low=53, high=72, prev=kprev)

    hprev = None
    for label, bar, prog in sections:
        if label in ("Intro", "A", "C", "B2"):
            step = 0.25 if label == "C" else 0.5
            pattern = [0, 1, 2, 3, 4, 3, 2, 1] if label != "C" else [0, 2, 4, 5, 6, 5, 4, 2]
            # in the intro the harp enters on the second bar
            prog_ = offset(prog[1:] if label == "Intro" else prog, B(bar))
            hprev = arpeggio(harp, prog_, pattern, step=step, low=60, high=84,
                             vel=0.42 if label == "C" else 0.5, prev=hprev)
    arpeggio(marimba, offset(p1, B(20)), [0, 2, 1, 3, 2, 4, 3, 1], step=0.5, low=62, high=84, vel=0.55)

    fmaj = scale("F", "major")
    bprev = None
    walk = [(0, 1.9, 0.8, 0), (2, 1.4, 0.62, 0), (3.5, 0.45, 0.55, "ap")]
    walk_b = [(0, 1.4, 0.82, 0), (1.5, 0.45, 0.55, 0), (2, 1.4, 0.68, 12), (3.5, 0.45, 0.55, "ap")]
    for label, bar, prog in sections:
        rhythm = {"Intro": [(0, 3.8, 0.6, 0)], "A": walk, "B": walk_b, "A2": walk, "C": [(0, 3.9, 0.65, 0)],
                  "B2": walk_b, "Outro": [(0, 3.8, 0.6, 0)]}[label]
        bprev = walking_bass(bass, offset(prog, B(bar)), rhythm, fmaj, low=29, high=43, prev=bprev)

    melody_a = ["C5:1 F5:.5 G5:.5 A5:1.5 G5:.5", "E5:2 r:1 C5:.5 D5:.5", "F5:1 D5:.5 F5:.5 A5:1.5 Bb5:.5",
                "A5:1 G5:1 E5:2", "C5:1 F5:.5 G5:.5 A5:1 C6:1", "C6:1.5 A5:.5 G5:1 E5:1",
                "F5:1 G5:.5 A5:.5 D5:2", "F5:1.5 E5:.5 C5:2"]
    variant = ["E6:1.5 D6:.5 C6:1 A5:1", "Bb5:1 A5:.5 G5:.5 F5:1 D5:1", "G5:2 E5:1 C5:1"]
    melody_b = ["A4:1.5 C5:.5 D5:1 F5:1", "F5:1.5 E5:.5 D5:2", "C5:1.5 A4:.5 C5:1 F5:1", "D5:1 F5:1 E5:1 G5:1",
                "A5:1.5 G5:.5 F5:1 D5:1", "F5:1.5 G5:.5 A5:2", "Bb5:1 A5:.5 G5:.5 F5:1 D5:1", "D5:2 C5:2"]
    variant_b = ["Bb5:1 C6:.5 Bb5:.5 A5:1 F5:1", "G5:2 F5:1 C5:1"]
    for i, line in enumerate(melody_a):
        phrase(lead, B(4 + i), line, vel=0.7)
    for i, line in enumerate(melody_a[:5] + variant):
        phrase(lead, B(20 + i), line, vel=0.76)
    for i, line in enumerate(melody_b):
        phrase(lead, B(12 + i), line, vel=0.72)
    for i, line in enumerate(melody_b[:6] + variant_b):
        phrase(lead, B(36 + i), line, vel=0.78)
    phrase(lead, B(44), "C5:1 F5:.5 G5:.5 A5:2 G5:4", vel=0.6)

    for base in (12, 36):
        phrase(answers, B(base + 1) + 2, "F5:.5 A5:.5 C6:.5", vel=0.55)
        phrase(answers, B(base + 5) + 2, "D6:.5 C6:.5 A5:.5 F5:.5", vel=0.55)
        phrase(answers, B(base + 7) + 2, "G5:.5 F5:.5 D5:1", vel=0.5)

    melody_c = ["D6:1 C6:1 A5:2", "G5:1 E5:1 C6:2", "A5:3 G5:1", "F5:2 E5:2", "D5:1 F5:1 A5:2", "G5:2 F5:2",
                "E5:1 G5:1 A5:2", "C6:4"]
    for i, line in enumerate(melody_c):
        phrase(vibes, B(28 + i), line, vel=0.62, legato=1.0)

    drum_line(shaker, B(4), 8, "o.x.o.x.o.x.o.x.", vel=0.5)
    drum_line(kick, B(4), 8, "x.......x.......", vel=0.62)
    drum_line(shaker, B(12), 8, "o.x.o.x.o.x.o.x.", vel=0.55)
    drum_line(kick, B(12), 8, "x.........x.....", vel=0.7)
    drum_line(rim, B(12), 8, "........x.......", vel=0.6)
    drum_line(shaker, B(20), 8, "o.x.o.x.o.x.ooxo", vel=0.58)
    drum_line(kick, B(20), 8, "x.......x.x.....", vel=0.72)
    drum_line(rim, B(20), 8, "....x.......x...", vel=0.55)
    drum_line(shaker, B(28), 8, "....o.x.....o.x.", vel=0.4)
    drum_line(shaker, B(36), 8, "o.x.o.x.o.x.ooxo", vel=0.6)
    drum_line(kick, B(36), 8, "x.......x.x.....", vel=0.75)
    drum_line(rim, B(36), 8, "....x.......x..o", vel=0.6)
    drum_line(shaker, B(44), 4, "o.x.o.x.o.x.o.x.", vel=0.4)
    for bar in (19, 35):
        swell.note(B(bar), 4, None, 0.65)
    return s
