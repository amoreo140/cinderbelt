"""Main menu theme – "Cinderbelt".

D major, 92 BPM, 4/4, 40 bars (~104 s), circular loop.
Form: Intro (4) – A theme (8) – B theme (8) – C breakdown with bells (8) – A' full (8) – Tag (4).
The leitmotif (A4 D5 E5 F#5 – rising fourth then steps up, "setting out") returns in other tracks.
"""
from afm import instruments as I
from afm.song import Song, arpeggio, harmony, bassline, comp_chords, drum_line, offset, pad_chords, phrase, progression

from .common import (EQ_BASS, EQ_BELL, EQ_HAT, EQ_KEYS, EQ_KICK, EQ_LEAD, EQ_PAD, EQ_PLUCK, KICK_SOFT, RIM,
                     SHAKER, SWELL, with_kw)

LEITMOTIF = "A4:.5 D5:.5 E5:.5 F#5:1.5 E5:.5 D5:.5"


def build() -> Song:
    s = Song("menu-cinderbelt", "Cinderbelt", "menu", 92, "D major", bars=40, seed=11)
    s.notes = "Leitmotif theme; I–V6–vi7–IVmaj7 loop with a deceptive turn into the breakdown."
    s.reverb.update(seconds=3.4, rt_low=2.8, rt_high=1.3, wet_lu=-8.5)
    s.delay.update(beats=0.75, feedback=0.35, wet_lu=-15)
    B = lambda bar: bar * 4  # noqa: E731

    intro = progression("D | A/C# | Bm7 | Gmaj7")
    a = progression("D | A/C# | Bm7 | Gmaj7 | D/F# | Gmaj7 | Em7 | Asus4:2 A:2")
    b = progression("Gmaj7 | A | F#m7 | Bm7 | Em7 | F#m7 | Gmaj7 | Asus4:2 A7:2")
    c = progression("Bm7 | Gmaj7 | D/F# | Asus4:2 A:2 | Bm7 | Gmaj7 | Em9 | A7sus4")
    tag = progression("Gmaj7 | A | Bm7 | Asus4:2 A:2")
    sections = [("Intro", 0, intro), ("A", 4, a), ("B", 12, b), ("C", 20, c), ("A'", 28, a), ("Tag", 36, tag)]
    for label, bar, _ in sections:
        s.section(label, bar)
    harmony(s, [(bar, prog) for _, bar, prog in sections])
    s.lint_parts = ["lead", "bells", "strings"]

    pad = s.part("pad", with_kw(I.pad, bright=2.6, attack=1.1, release=2.2, motion=0.25), -10,
                 rev=0.5, eq=EQ_PAD, chorus=0.2, width=1.2)
    keys = s.part("epiano", with_kw(I.epiano, decay=2.0), -8, rev=0.3, eq=EQ_KEYS, chorus=0.2,
                  tremolo=0.35, tremolo_rate=3.8, human_ms=7)
    arp = s.part("arp", with_kw(I.pluck, pick=0.23, decay=1.1, bright=0.8), -12, rev=0.35, dly=0.3,
                 eq=EQ_PLUCK, human_ms=4, pan=0.15)
    bass = s.part("bass", with_kw(I.bass, style="round"), -7, rev=0.05, eq=EQ_BASS, human_ms=5)
    lead = s.part("lead", with_kw(I.lead_soft, vib=11), 0, rev=0.32, dly=0.22, eq=EQ_LEAD, human_ms=9)
    bells = s.part("bells", with_kw(I.mallet, kind="glock", decay_scale=1.2), -3, rev=0.5, dly=0.3,
                   eq=EQ_BELL, pan=-0.1)
    strings = s.part("strings", with_kw(I.strings, attack=0.6, release=1.2, bright=4.0), -9, rev=0.45,
                     eq=EQ_PAD, width=1.3)
    kick = s.part("kick", KICK_SOFT, -11, rev=0.08, eq=EQ_KICK, human_ms=2)
    rim = s.part("rim", RIM, -16, rev=0.25, pan=0.12, human_ms=4)
    shaker = s.part("shaker", SHAKER, -22, rev=0.15, eq=EQ_HAT, pan=-0.25, human_ms=5, swing=0.12)
    swell = s.part("swell", SWELL, -19, rev=0.3, human_ms=0)
    s.kick_part = "kick"

    # ---- harmony bed
    prev = None
    for label, bar, prog in sections:
        vel = {"Intro": 0.5, "A": 0.55, "B": 0.6, "C": 0.72, "A'": 0.65, "Tag": 0.5}[label]
        prev = pad_chords(pad, offset(prog, B(bar)), low=50, high=72, n=4, vel=vel, prev=prev)

    comp = [(0, 1.4, 0.55), (1.5, 0.45, 0.42), (2.5, 1.4, 0.5)]
    kprev = None
    for label, bar, prog in sections:
        if label in ("A", "B", "A'"):
            kprev = comp_chords(keys, offset(prog, B(bar)), comp, low=53, high=72, prev=kprev)
        elif label == "Tag":
            kprev = comp_chords(keys, offset(prog, B(bar)), [(0, 3.5, 0.45)], low=53, high=72, prev=kprev)

    aprev = None
    for label, bar, prog in sections:
        if label in ("Intro", "A", "C", "A'", "Tag"):
            pattern = [0, 2, 1, 3, 2, 4, 3, 5] if label != "C" else [0, 3, 5, 6, 4, 5, 3, 2]
            low = 62 if label != "C" else 66
            aprev = arpeggio(arp, offset(prog, B(bar)), pattern, step=0.5, low=low, high=86,
                             vel=0.5 if label in ("Intro", "Tag") else 0.58, prev=aprev)

    # ---- bass
    bprev = None
    for label, bar, prog in sections:
        rhythm = {
            "Intro": [(0, 3.8, 0.65, 0)],
            "A": [(0, 2.4, 0.8, 0), (2.5, 1.4, 0.62, 0)],
            "B": [(0, 1.4, 0.85, 0), (1.5, 0.45, 0.6, 0), (2, 0.9, 0.68, 12), (3, 0.9, 0.62, 0)],
            "C": [(0, 3.9, 0.7, 0)],
            "A'": [(0, 1.4, 0.85, 0), (1.5, 0.45, 0.6, 0), (2, 0.9, 0.68, 12), (3, 0.9, 0.62, 0)],
            "Tag": [(0, 2.4, 0.7, 0), (2.5, 1.4, 0.55, 0)],
        }[label]
        bprev = bassline(bass, offset(prog, B(bar)), rhythm, low=33, high=45, prev=bprev)

    # ---- melodies
    melody_a = [
        LEITMOTIF,
        "E5:1.5 B4:.5 A4:2",
        "F#5:.5 A5:.5 B5:.5 A5:1.5 F#5:.5 E5:.5",
        "D5:1.5 E5:.5 F#5:2",
        "A4:.5 D5:.5 E5:.5 F#5:1 G5:.5 A5:1",
        "B5:1.5 A5:.5 G5:.5 F#5:.5 E5:1",
        "G5:1 F#5:.5 E5:.5 D5:1 B4:1",
        "D5:2 C#5:1 A4:1",
    ]
    for i, line in enumerate(melody_a):
        phrase(lead, B(4 + i), line, vel=0.72)
    ending = ["G5:1 A5:.5 B5:.5 D6:1 B5:1", "A5:2 E5:1 C#5:1"]
    for i, line in enumerate(melody_a[:6] + ending):
        phrase(lead, B(28 + i), line, vel=0.8)
    melody_b = [
        "D5:1.5 B4:.5 F#5:2",
        "E5:1.5 C#5:.5 A5:2",
        "F#5:1.5 E5:.5 C#5:1 A4:1",
        "B4:1.5 C#5:.5 D5:1 F#5:1",
        "G5:1.5 F#5:.5 E5:1 B4:1",
        "A5:1.5 E5:.5 F#5:1 C#5:1",
        "B5:1 A5:.5 G5:.5 F#5:1 D5:1",
        "D5:2 C#5:1 E5:1",
    ]
    for i, line in enumerate(melody_b):
        phrase(lead, B(12 + i), line, vel=0.76)

    # bells: the leitmotif augmented over the breakdown, and a farewell in the tag
    phrase(bells, B(20), "A5:1 D6:1 E6:1 F#6:3 E6:1 D6:1 E6:3 B5:1 A5:4", vel=0.62, legato=1.0)
    phrase(bells, B(24), "F#5:1 A5:1 B5:1 A5:3 F#5:1 E5:1 D5:3 E5:1 D5:2 A5:2", vel=0.6, legato=1.0)
    phrase(bells, B(36), "A5:.5 D6:.5 E6:.5 F#6:2.5 E6:2 C#6:2 D6:4", vel=0.55, legato=1.0)
    # call-and-response: bells answer the B melody at phrase ends
    phrase(bells, B(12) + 2.5, "A5:.5 B5:.5 D6:.5", vel=0.42)
    phrase(bells, B(13) + 2.5, "C#6:.5 E6:.5 A6:.5", vel=0.42)

    # strings: counter-line under A'
    phrase(strings, B(28), "F#4:4 E4:2 A4:2 D5:2 C#5:2 B4:4 A4:2 F#4:2 D5:4 B4:2 G4:2 D5:2 C#5:2",
           vel=0.6, legato=1.0)
    phrase(strings, B(20), "D4:4 B3:4 A3:4 A3:2 C#4:2 D4:4 B3:4 B3:4 D4:4", vel=0.5, legato=1.0)

    # ---- drums
    drum_line(shaker, B(4), 8, "o.x.o.x.o.x.o.x.", vel=0.55)
    drum_line(kick, B(4), 8, "x.........x.....", vel=0.7)
    drum_line(shaker, B(12), 8, "o.x.o.x.o.x.oox.", vel=0.62)
    drum_line(kick, B(12), 8, "x.....x...x.....", vel=0.78)
    drum_line(rim, B(12), 8, "....x.......x...", vel=0.6)
    drum_line(shaker, B(24), 4, "....o.x.....o.x.", vel=0.45)
    drum_line(shaker, B(28), 8, "o.x.o.x.o.x.oox.", vel=0.66)
    drum_line(kick, B(28), 8, "x.....x...x.....", vel=0.82)
    drum_line(rim, B(28), 8, "....x.......x..o", vel=0.66)
    drum_line(shaker, B(36), 4, "o.x.o.x.o.x.o.x.", vel=0.45)
    drum_line(kick, B(36), 4, "x...............", vel=0.6)
    for bar in (11, 27):
        swell.note(B(bar), 4, None, 0.7)
    return s
