"""Adventure 2 – "Long Burn" (long travel between rings).

G Mixolydian (F natural, borrowed D major), 116 BPM, 4/4, 56 bars (~116 s), circular loop.
Form: Intro (4, pedal G: I–bVII–IV) – A (8) – B (8) – A2 (8) – C (8, half-time bridge with bIII) – B2 (8)
– A3 (8) – Outro (4).
Rhythmic identity: tresillo (3+3+2 eighths) in bass, kick, chord stabs and the melody itself.
"""
from afm import instruments as I
from afm.song import (Song, arpeggio, bars, bassline, comp_chords, drum_line, harmony, offset, pad_chords,
                      progression)

from .common import (CLAP, EQ_BASS, EQ_HAT, EQ_KICK, EQ_LEAD, EQ_PAD, EQ_PLUCK, HAT, KICK_PUNCH, SHAKER, SWELL,
                     TOM, with_kw)


def build() -> Song:
    s = Song("adventure-long-burn", "Long Burn", "adventure", 116, "G Mixolydian", bars=56, seed=61)
    s.notes = "Tresillo-driven travel theme; bVII and bIII colours, brass-like synth lead."
    s.reverb.update(seconds=2.6, rt_low=2.0, rt_high=0.9, wet_lu=-11.5)
    s.delay.update(beats=0.75, feedback=0.35, wet_lu=-15)
    s.master.update(comp_threshold=-16.0, comp_ratio=2.0)
    B = lambda bar: bar * 4  # noqa: E731

    intro = progression("G | F/G | C/G | G")
    a = progression("G | F | C/E | Dm7 | Em7 | F | C | Dsus4:2 D:2")
    b = progression("Em7 | C | G | D | Em7 | C | F | Dsus4:2 D:2")
    c = progression("Am7 | F | C | G | Am7 | F | Bb | Dsus4:2 D:2")
    outro = progression("G | F/G | C/G | Dsus4:2 D:2")
    sections = [("Intro", 0, intro), ("A", 4, a), ("B", 12, b), ("A2", 20, a), ("C", 28, c), ("B2", 36, b),
                ("A3", 44, a), ("Outro", 52, outro)]
    for label, bar, _ in sections:
        s.section(label, bar)
    harmony(s, [(bar, prog) for _, bar, prog in sections])
    s.lint_parts = ["lead", "strings_mel"]

    pad = s.part("pad", with_kw(I.pad, bright=2.6, attack=0.7, release=1.6, motion=0.3), -13, rev=0.45,
                 eq=EQ_PAD, chorus=0.2, width=1.2, duck=0.25)
    strings = s.part("strings", with_kw(I.strings, attack=0.4, release=0.9, bright=4.5), -10, rev=0.4,
                     eq=EQ_PAD, width=1.3, duck=0.15)
    strings_mel = s.part("strings_mel", with_kw(I.strings, attack=0.3, release=0.9, bright=5.0, voices=5), -2,
                         rev=0.4, eq=EQ_LEAD)
    stabs = s.part("stabs", with_kw(I.arp, decay=0.28, bright=6.0, square=False), -9, rev=0.25, dly=0.2,
                   eq=EQ_PLUCK, human_ms=3, width=1.3)
    guitar = s.part("guitar", with_kw(I.pluck, pick=0.14, decay=0.9, bright=1.3), -12, rev=0.3, dly=0.25,
                    eq=EQ_PLUCK, pan=-0.35, human_ms=4)
    bass = s.part("bass", with_kw(I.bass, style="pluck", drive=1.6), -6, rev=0.03, eq=EQ_BASS, human_ms=3)
    lead = s.part("lead", with_kw(I.lead_saw, bright=3.6, swell=0.12, vib=11, max_cut=3600, voices=3), 0,
                  rev=0.3, dly=0.22, eq=EQ_LEAD, human_ms=7)
    kick = s.part("kick", KICK_PUNCH, -8, rev=0.05, eq=EQ_KICK, human_ms=2)
    clap = s.part("clap", CLAP, -13, rev=0.3, human_ms=3)
    hats = s.part("hats", HAT, -20, rev=0.1, eq=EQ_HAT, pan=0.25, human_ms=3, human_vel=0.12)
    shaker = s.part("shaker", SHAKER, -22, rev=0.12, eq=EQ_HAT, pan=-0.3, human_ms=4)
    toms = s.part("toms", TOM, -12, rev=0.2, human_ms=3)
    swell = s.part("swell", SWELL, -18, rev=0.3, human_ms=0)
    s.kick_part = "kick"

    prev = None
    for label, bar, prog in sections:
        prev = pad_chords(pad, offset(prog, B(bar)), low=50, high=71, n=4, vel=0.6, prev=prev)
    sprev = None
    for label, bar, prog in sections:
        if label in ("B", "C", "B2"):
            sprev = pad_chords(strings, offset(prog, B(bar)), low=55, high=76, n=3, vel=0.6, prev=sprev)

    tresillo = [(0, 0.4, 0.62), (1.5, 0.4, 0.55), (3, 0.4, 0.6)]
    tresillo_plus = tresillo + [(2.5, 0.2, 0.4), (3.75, 0.2, 0.38)]
    kprev = None
    for label, bar, prog in sections:
        if label == "C":
            rhythm = [(0, 1.8, 0.5), (2, 1.8, 0.45)]
        elif label in ("A2", "B2", "A3"):
            rhythm = tresillo_plus
        else:
            rhythm = tresillo
        kprev = comp_chords(stabs, offset(prog, B(bar)), rhythm, low=55, high=74, n=4, prev=kprev, roll=0.0)
    gprev = None
    for label, bar, prog in sections:
        if label in ("A", "B", "A2", "B2", "A3"):
            gprev = arpeggio(guitar, offset(prog, B(bar)), [0, 2, 1, 3, 2, 4, 3, 2], step=0.5, low=55, high=79,
                             vel=0.5, prev=gprev)

    trem_bass = [(0, 1.4, 0.85, 0), (1.5, 1.4, 0.72, 0), (3, 0.9, 0.75, 12)]
    bprev = None
    for label, bar, prog in sections:
        rhythm = {"Intro": [(0, 1.4, 0.7, 0), (1.5, 1.4, 0.6, 0), (3, 0.9, 0.6, 0)],
                  "C": [(0, 1.9, 0.8, 0), (2, 1.9, 0.7, 0)]}.get(label, trem_bass)
        bprev = bassline(bass, offset(prog, B(bar)), rhythm, low=31, high=43, prev=bprev)

    mel_a = ["D5:1.5 G5:1.5 A5:1", "C6:1.5 A5:1.5 F5:1", "G5:1.5 E5:1.5 C5:1", "D5:2 F5:1 A5:1",
             "B5:1.5 G5:1.5 E5:1", "A5:1.5 C6:1.5 A5:1", "G5:1 E5:1 G5:1 C6:1", "A5:2 F#5:2"]
    mel_b = ["E5:.5 G5:.5 B5:3", "C6:1.5 G5:.5 E5:2", "D6:3 B5:1", "A5:2 F#5:2", "G5:.5 B5:.5 E6:3",
             "E6:1.5 D6:.5 C6:2", "C6:1 A5:1 F5:1 A5:1", "G5:2 F#5:2"]
    bars(lead, B(4), mel_a, vel=0.72)
    bars(lead, B(12), mel_b, vel=0.75)
    bars(lead, B(20), mel_a, vel=0.78)
    bars(lead, B(36), mel_b, vel=0.82)
    bars(lead, B(44), mel_a[:6] + ["G5:1 C6:1 E6:2", "D6:2 F#5:2"], vel=0.85)
    mel_c = ["E5:4", "F5:2 A5:2", "G5:4", "B5:2 D6:2", "C6:4", "A5:2 F5:2", "F5:2 D5:2", "A5:2 F#5:2"]
    bars(strings_mel, B(28), mel_c, vel=0.7, legato=1.0)

    for label, bar, prog in sections:
        n = 4 if label in ("Intro", "Outro") else 8
        start = B(bar)
        if label == "Intro":
            drum_line(shaker, start, n, "x.o.x.o.x.o.x.o.", vel=0.45)
            drum_line(toms, start + 8, 2, "x.....x.....x...", vel=0.4, pitch=85)
        elif label == "A":
            drum_line(kick, start, n, "x.....x.....x...", vel=0.75)
            drum_line(shaker, start, n, "x.o.x.o.x.o.x.o.", vel=0.5)
            drum_line(hats, start, n, "..x...x...x...x.", vel=0.45)
        elif label in ("B", "A2", "B2", "A3"):
            drum_line(kick, start, n, "x.....x.....x...", vel=0.82)
            drum_line(clap, start, n, "....x.......x...", vel=0.7)
            drum_line(hats, start, n, "xoxoxoxoxoxoxoxo", vel=0.5)
            drum_line(toms, start, n, "......x.....x.x.", vel=0.35, pitch=95)
        elif label == "C":
            drum_line(kick, start, n, "x...............", vel=0.75)
            drum_line(clap, start, n, "........x.......", vel=0.68)
            drum_line(toms, start, n, "x.....x.....x...", vel=0.5, pitch=75)
            drum_line(hats, start, n, "x...x...x...x...", vel=0.45)
        elif label == "Outro":
            drum_line(shaker, start, n, "x.o.x.o.x.o.x.o.", vel=0.45)
            drum_line(kick, start, n, "x.....x.....x...", vel=0.55)
    for bar in (11, 27, 35, 51):
        swell.note(B(bar), 4, None, 0.7)
    return s
