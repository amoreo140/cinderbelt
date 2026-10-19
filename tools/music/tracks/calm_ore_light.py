"""Calm 2 – "Ore Light" (lilting 6/8 for long mining sessions).

Eb major, 6/8 at dotted quarter = 54 (eighth = 162), 64 bars (~142 s), circular loop.
Form: Intro (4) – A (8) – B (8) – C (8, glockenspiel) – A2 (8) – B2 (8) – D (8, breakdown, vibes)
– A3 (8, climax variant) – Outro (4).
Kalimba ostinato carries the lilt; flute melody in A/B, glockenspiel and vibes take over in C/D.
"""
from afm import instruments as I
from afm.song import (Song, arpeggio, bars, drum_line, harmony, offset, pad_chords, phrase, progression,
                      walking_bass)
from afm.theory import scale

from .common import (EQ_BASS, EQ_BELL, EQ_HAT, EQ_KICK, EQ_LEAD, EQ_PAD, EQ_PLUCK, FRAME, KICK_SOFT, RIM,
                     SHAKER, SWELL, with_kw)

BPB = 6


def build() -> Song:
    s = Song("calm-ore-light", "Ore Light", "calm", 162, "Eb major", bars=64, beats_per_bar=BPB, seed=31,
             beat_unit="eighth")
    s.display_bpm = 54
    s.meter = "6/8"
    s.notes = "Lullaby-like 6/8; kalimba ostinato, flute melody, glockenspiel and vibes interludes."
    s.reverb.update(seconds=3.4, rt_low=2.8, rt_high=1.2, wet_lu=-8.5)
    s.delay.update(beats=3, feedback=0.3, wet_lu=-17)
    B = lambda bar: bar * BPB  # noqa: E731
    P = lambda spec: progression(spec, BPB)  # noqa: E731

    a = P("Ebadd9 | Bb/D | Cm7 | Abmaj7 | Ebadd9/G | Abmaj7 | Fm7 | Bbsus4:3 Bb:3")
    b = P("Abmaj7 | Bb/Ab | Gm7 | Cm7 | Fm9 | Gm7 | Abmaj7 | Bbsus4:3 Bb:3")
    c = P("Cm9 | Abmaj7 | Ebmaj7/Bb | Bb | Cm9 | Abmaj7 | Fm7 | Bb7sus4")
    d = P("Abmaj7 | Ebadd9/G | Fm9 | Ebadd9 | Abmaj7 | Ebadd9/G | Fm9 | Bbsus4:3 Bb:3")
    outro = P("Abmaj7 | Bb/Ab | Gm7 | Bbsus4:3 Bb:3")
    sections = [("Intro", 0, a[:4]), ("A", 4, a), ("B", 12, b), ("C", 20, c), ("A2", 28, a), ("B2", 36, b),
                ("D", 44, d), ("A3", 52, a), ("Outro", 60, outro)]
    for label, bar, _ in sections:
        s.section(label, bar)
    harmony(s, [(bar, prog) for _, bar, prog in sections])
    s.lint_parts = ["lead", "glock", "vibes"]

    pad = s.part("pad", with_kw(I.pad, bright=2.2, attack=1.4, release=2.6, motion=0.3, saw=False), -12,
                 rev=0.55, eq=EQ_PAD, chorus=0.25, width=1.25)
    strings = s.part("strings", with_kw(I.strings, attack=0.9, release=1.6, bright=3.5, vib=5), -11, rev=0.5,
                     eq=EQ_PAD, width=1.3)
    kalimba = s.part("kalimba", with_kw(I.mallet, kind="kalimba"), -8, rev=0.35, dly=0.2, eq=EQ_BELL,
                     pan=0.2, human_ms=7)
    harp = s.part("harp", with_kw(I.pluck, pick=0.3, decay=1.8, bright=0.5, rolloff=1.25), -13, rev=0.45,
                  eq=EQ_PLUCK, pan=-0.3, human_ms=8)
    glock = s.part("glock", with_kw(I.mallet, kind="glock", decay_scale=1.1), -4, rev=0.5, dly=0.3,
                   eq=EQ_BELL, pan=-0.1)
    vibes = s.part("vibes", with_kw(I.mallet, kind="vibes", tremolo=0.35), -3, rev=0.5, dly=0.2, eq=EQ_BELL)
    bass = s.part("bass", with_kw(I.bass, style="sub", drive=1.2), -9, rev=0.05, eq=EQ_BASS, human_ms=6)
    lead = s.part("lead", with_kw(I.lead_soft, vib=9, breath=0.025, attack=0.08), 0, rev=0.35, dly=0.18,
                  eq=EQ_LEAD, human_ms=12)
    frame = s.part("frame", FRAME, -13, rev=0.2, human_ms=4)
    kick = s.part("kick", KICK_SOFT, -14, rev=0.08, eq=EQ_KICK, human_ms=3)
    rim = s.part("rim", RIM, -18, rev=0.3, pan=-0.15, human_ms=6)
    shaker = s.part("shaker", SHAKER, -24, rev=0.15, eq=EQ_HAT, pan=0.3, human_ms=6)
    swell = s.part("swell", SWELL, -21, rev=0.3, human_ms=0)

    prev = None
    for label, bar, prog in sections:
        vel = {"Intro": 0.5, "A": 0.55, "B": 0.6, "C": 0.65, "A2": 0.58, "B2": 0.62, "D": 0.7, "A3": 0.65,
               "Outro": 0.5}[label]
        prev = pad_chords(pad, offset(prog, B(bar)), low=51, high=72, n=4, vel=vel, prev=prev)
    sprev = None
    for label, bar, prog in sections:
        if label in ("C", "D", "A3"):
            sprev = pad_chords(strings, offset(prog, B(bar)), low=55, high=76, n=3, vel=0.55, prev=sprev)

    kprev = None
    for label, bar, prog in sections:
        if label == "D":
            pattern = [0, -1, 2, -1, 4, 3]
        elif label == "Intro":
            pattern = [0, 2, 4, 3, 2, 1]
        else:
            pattern = [0, 2, 4, 3, 2, 1] if label not in ("B", "B2") else [0, 3, 2, 4, 3, 1]
        kprev = arpeggio(kalimba, offset(prog, B(bar)), pattern, step=1, low=63, high=87, vel=0.55, accent=0.0,
                         prev=kprev)
    hprev = None
    for label, bar, prog in sections:
        if label in ("B", "B2", "A3"):
            hprev = arpeggio(harp, offset(prog, B(bar)), [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3], step=0.5, low=55,
                             high=79, vel=0.42, accent=0.0, prev=hprev)

    eb = scale("Eb", "major")
    bprev = None
    for label, bar, prog in sections:
        if label in ("Intro", "D", "Outro"):
            rhythm = [(0, 5.6, 0.62, 0)]
        else:
            rhythm = [(0, 2.8, 0.8, 0), (3, 1.9, 0.62, 0), (5, 0.9, 0.5, "ap")]
        bprev = walking_bass(bass, offset(prog, B(bar)), rhythm, eb, low=31, high=44, prev=bprev)

    mel_a = ["Bb4:2 Eb5:1 G5:3", "F5:2 Eb5:1 D5:3", "Eb5:2 G5:1 Bb5:2 G5:1", "C6:3 Bb5:3",
             "G5:2 F5:1 Eb5:3", "Eb5:2 F5:1 G5:2 Ab5:1", "C6:2 Bb5:1 Ab5:2 F5:1", "Eb5:3 D5:3"]
    end_a = ["Ab5:2 C6:1 Eb6:3", "Eb6:3 D6:3"]
    mel_b = ["Eb5:1 F5:1 G5:1 Ab5:2 G5:1", "F5:3 D5:3", "D5:1 Eb5:1 F5:1 G5:2 F5:1", "Eb5:3 G5:2 Bb5:1",
             "Ab5:3 G5:3", "F5:2 D5:1 Bb4:3", "C5:2 Eb5:1 G5:2 Ab5:1", "F5:3 D5:3"]
    bars(lead, B(4), mel_a, BPB, vel=0.7)
    bars(lead, B(12), mel_b, BPB, vel=0.72)
    bars(lead, B(28), mel_a, BPB, vel=0.74)
    bars(lead, B(36), mel_b[:6] + ["C5:2 Eb5:1 Ab5:2 C6:1", "Bb5:3 F5:3"], BPB, vel=0.76)
    bars(lead, B(52), mel_a[:6] + end_a, BPB, vel=0.8)
    phrase(lead, B(60), "Eb5:2 F5:1 G5:3 F5:6", vel=0.6)

    mel_c = ["G5:3 D6:3", "C6:3 G5:3", "Bb5:3 F5:3", "D6:6", "Eb6:3 D6:3", "C6:2 Bb5:1 G5:3", "Ab5:3 C6:3",
             "Bb5:3 Eb6:3"]
    bars(glock, B(20), mel_c, BPB, vel=0.6, legato=1.0)
    mel_d = ["C6:3 Eb6:3", "Bb5:6", "Ab5:3 G5:3", "F5:3 Eb5:3", "C6:3 Eb6:3", "Bb5:3 G5:3", "Ab5:3 C6:3",
             "Bb5:6"]
    bars(vibes, B(44), mel_d, BPB, vel=0.6, legato=1.0)

    # percussion (12 sixteenths per 6/8 bar)
    for label, bar, prog in sections:
        n = len(prog) if label not in ("Intro", "Outro") else 4
        if label in ("A", "A2", "B", "B2", "A3"):
            drum_line(frame, B(bar), n, "x.....o.....", beats_per_bar=BPB, vel=0.6)
            drum_line(shaker, B(bar), n, "x.o.o.x.o.o.", beats_per_bar=BPB, vel=0.5)
        if label in ("B", "B2", "A3"):
            drum_line(kick, B(bar), n, "x...........", beats_per_bar=BPB, vel=0.6)
            drum_line(rim, B(bar), n, "......x.....", beats_per_bar=BPB, vel=0.5)
        if label == "C":
            drum_line(shaker, B(bar), n, "x.....x.....", beats_per_bar=BPB, vel=0.4)
        if label == "D":
            drum_line(frame, B(bar) + B(4), 4, "x...........", beats_per_bar=BPB, vel=0.45)
    for bar in (11, 27, 51):
        swell.note(B(bar), 6, None, 0.6)
    return s
