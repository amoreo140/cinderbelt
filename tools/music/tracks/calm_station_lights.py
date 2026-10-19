"""Calm 3 – "Station Lights" (docked / home station; mellow, jazzy).

A major, 76 BPM, 4/4 with swung sixteenths, 48 bars (~152 s), circular loop.
Form: Intro (4) – A (8, vibes) – B (8, flute) – A2 (8) – C (8, bridge, vibes solo line) – B2 (8)
– Outro (4).
Harmony: Imaj9–vi11–IVmaj9–V9sus4 / iii7–vi9–ii9–V (A), IV–iii–ii–I (B), vi–IV–ii–iii (C).
"""
from afm import instruments as I
from afm.song import Song, bars, comp_chords, drum_line, harmony, offset, pad_chords, phrase, progression, walking_bass
from afm.theory import scale

from .common import BRUSH, EQ_BASS, EQ_BELL, EQ_HAT, EQ_KEYS, EQ_KICK, EQ_LEAD, EQ_PAD, HAT, KICK_SOFT, with_kw


def build() -> Song:
    s = Song("calm-station-lights", "Station Lights", "calm", 76, "A major", bars=48, seed=41)
    s.notes = "Lo-fi jazz flavour for the station: Rhodes comping, vibes and flute, brushes."
    s.reverb.update(seconds=2.6, rt_low=2.0, rt_high=0.9, wet_lu=-10.0, predelay=0.018)
    s.delay.update(beats=0.75, feedback=0.3, wet_lu=-17)
    B = lambda bar: bar * 4  # noqa: E731

    a = progression("Amaj9 | F#m11 | Dmaj9 | E9sus4 | C#m7 | F#m9 | Bm9 | E9sus4:2 E7:2")
    b = progression("Dmaj9 | C#m7 | Bm9 | Amaj9 | Dmaj9 | C#m7 | F#m9 | E9sus4")
    c = progression("F#m9 | Dmaj9 | Bm9 | C#m7 | F#m9 | Dmaj9 | Bm11 | E9sus4:2 E7:2")
    outro = progression("Dmaj9 | C#m7 | Bm9 | E9sus4")
    sections = [("Intro", 0, a[:4]), ("A", 4, a), ("B", 12, b), ("A2", 20, a), ("C", 28, c), ("B2", 36, b),
                ("Outro", 44, outro)]
    for label, bar, _ in sections:
        s.section(label, bar)
    harmony(s, [(bar, prog) for _, bar, prog in sections])
    s.lint_parts = ["lead", "vibes"]

    pad = s.part("pad", with_kw(I.pad, bright=2.0, attack=1.5, release=2.5, motion=0.25), -15, rev=0.5,
                 eq=EQ_PAD, chorus=0.3, width=1.3)
    keys = s.part("epiano", with_kw(I.epiano, decay=2.6, bark=0.9), -5, rev=0.25, eq=EQ_KEYS, chorus=0.3,
                  tremolo=0.45, tremolo_rate=3.6, human_ms=10, swing=0.35)
    vibes = s.part("vibes", with_kw(I.mallet, kind="vibes", tremolo=0.3), -1, rev=0.35, dly=0.15, eq=EQ_BELL,
                   pan=0.15, human_ms=10, swing=0.35)
    lead = s.part("lead", with_kw(I.lead_soft, vib=12, breath=0.03, attack=0.07), 0, rev=0.3, dly=0.2,
                  eq=EQ_LEAD, human_ms=14, swing=0.35)
    bass = s.part("bass", with_kw(I.bass, style="round", release=0.05), -7, rev=0.04, eq=EQ_BASS, human_ms=8,
                  swing=0.35)
    kick = s.part("kick", KICK_SOFT, -11, rev=0.06, eq=EQ_KICK, human_ms=4, swing=0.35)
    brush = s.part("brush", BRUSH, -15, rev=0.3, pan=0.1, human_ms=6)
    hats = s.part("hats", HAT, -21, rev=0.12, eq=EQ_HAT, pan=-0.25, human_ms=5, swing=0.35, human_vel=0.15)

    prev = None
    for label, bar, prog in sections:
        prev = pad_chords(pad, offset(prog, B(bar)), low=52, high=72, n=4, vel=0.5, prev=prev)

    comp_lofi = [(0, 0.9, 0.52), (1.75, 0.5, 0.42), (2.5, 1.2, 0.48), (3.75, 0.25, 0.34)]
    comp_soft = [(0, 1.9, 0.48), (2.5, 1.4, 0.42)]
    kprev = None
    for label, bar, prog in sections:
        rhythm = {"Intro": comp_soft, "A": comp_lofi, "B": comp_lofi, "A2": comp_lofi, "C": comp_soft,
                  "B2": comp_lofi, "Outro": comp_soft}[label]
        kprev = comp_chords(keys, offset(prog, B(bar)), rhythm, low=52, high=71, n=4, prev=kprev, roll=0.02)

    amaj = scale("A", "major")
    walk_half = [(0, 1.9, 0.8, 0), (2, 1.4, 0.62, 7), (3.5, 0.45, 0.55, "ap")]
    walk_q = [(0, 0.9, 0.8, 0), (1, 0.9, 0.6, 7), (2, 0.9, 0.66, 12), (3, 0.9, 0.6, "ap")]
    bprev = None
    for label, bar, prog in sections:
        rhythm = {"Intro": [(0, 3.8, 0.6, 0)], "A": walk_half, "B": walk_q, "A2": walk_half, "C": walk_q,
                  "B2": walk_q, "Outro": [(0, 3.8, 0.6, 0)]}[label]
        bprev = walking_bass(bass, offset(prog, B(bar)), rhythm, amaj, low=33, high=45, prev=bprev)

    mel_a = ["E5:.75 C#5:.25 E5:.5 G#5:1 B5:1.5", "A5:1.5 G#5:.5 E5:2", "F#5:.75 E5:.25 F#5:.5 A5:1 C#6:1.5",
             "B5:2 A5:1 F#5:1", "G#5:.75 E5:.25 G#5:.5 B5:1 E6:1.5", "C#6:1.5 B5:.5 A5:1 G#5:1",
             "F#5:1 A5:.5 C#6:.5 B5:2", "A5:1.5 G#5:.5 E5:2"]
    mel_b = ["A5:2 F#5:1 E5:1", "E5:1.5 G#5:.5 B5:2", "D6:1 C#6:1 A5:1 F#5:1", "E5:4",
             "F#5:1 A5:1 C#6:1.5 B5:.5", "B5:1.5 G#5:.5 E5:2", "A5:1 G#5:1 F#5:1 C#5:1", "D5:2 B4:2"]
    mel_c = ["C#5:.5 E5:.5 G#5:.5 A5:1 C#6:1.5", "C#6:.5 A5:.5 F#5:.5 E5:1 A5:1.5",
             "F#5:.5 A5:.5 C#6:.5 D6:1 B5:1.5", "G#5:2 E5:2", "A5:.5 C#6:.5 E6:1 C#6:1 A5:1",
             "F#5:1.5 E5:.5 C#6:2", "B5:1 A5:1 E5:1 D5:1", "D5:2 G#5:2"]
    bars(vibes, B(4), mel_a, vel=0.66, legato=1.0)
    bars(vibes, B(20), mel_a[:4] + ["G#5:.5 B5:.5 E6:1 B5:.5 G#5:.5 E5:1"] + mel_a[5:], vel=0.7, legato=1.0)
    bars(vibes, B(28), mel_c, vel=0.68, legato=1.0)
    bars(vibes, B(44), ["E5:.75 C#5:.25 E5:.5 G#5:1 B5:1.5", "G#5:4", "r:4", "r:4"], vel=0.55, legato=1.0)
    bars(lead, B(12), mel_b, vel=0.7)
    bars(lead, B(36), mel_b[:6] + ["A5:1 C#6:1 B5:1 A5:.5 F#5:.5", "E5:2 B4:2"], vel=0.75)
    # vibes answers in B: short fills in the flute's long notes
    phrase(vibes, B(15) + 1, "C#6:.5 B5:.5 G#5:.5 E5:.5 C#5:1", vel=0.45)
    phrase(vibes, B(39) + 1, "C#6:.5 B5:.5 G#5:.5 E5:.5 C#5:1", vel=0.45)

    for label, bar, prog in sections:
        n = {"Intro": 4, "Outro": 4}.get(label, 8)
        if label in ("A", "B", "A2", "B2"):
            drum_line(kick, B(bar), n, "x......x..x.....", vel=0.66)
            drum_line(brush, B(bar), n, "....x.......x...", vel=0.62)
            drum_line(hats, B(bar), n, "x.ox.ox.x.ox.oxo", vel=0.5)
        elif label == "C":
            drum_line(kick, B(bar), n, "x.........x.....", vel=0.55)
            drum_line(hats, B(bar), n, "x...x...x...x...", vel=0.4)
        elif label == "Outro":
            drum_line(hats, B(bar), n, "x...x...x...x.o.", vel=0.35)
    return s
