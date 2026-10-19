"""Mystery 2 – "Forge Ruins" (ancient Forge-smith halls; curiosity, not dread).

A minor with E Phrygian-dominant turns (F over the E chord), 3/4 at 78 BPM, 48 bars (~111 s), loop.
Form: Intro (4) – A (8) – B (8) – C (8, warm turn to C major, glass bells) – A' (8) – B' (8) – Outro (4).
Marimba ostinato in waltz time, hand drum, choir, ocarina-like flute; the Echo signal cell from
"Forge-smith Echo" (1–5–4–2) returns on the bells over A minor and F major chords.
"""
from afm import instruments as I
from afm.song import Song, arpeggio, bars, bassline, drum_line, harmony, offset, pad_chords, progression

from .common import EQ_BASS, EQ_BELL, EQ_CHOIR, EQ_HAT, EQ_LEAD, EQ_PLUCK, FRAME, SHAKER, SWELL, with_kw

BPB = 3


def build() -> Song:
    s = Song("mystery-forge-ruins", "Forge Ruins", "mystery", 78, "A minor / E Phrygian dominant", bars=48,
             beats_per_bar=BPB, seed=101)
    s.meter = "3/4"
    s.notes = "Waltz-time marimba and hand drum, choir, flute; warm C-major interlude with glass bells."
    s.reverb.update(seconds=4.5, rt_low=3.6, rt_high=1.7, predelay=0.03, wet_lu=-7.5, hp=220.0, lp=9000.0)
    s.delay.update(beats=1.5, feedback=0.35, wet_lu=-15, into_reverb=0.5)
    s.master.update(comp_threshold=-18.0, comp_ratio=1.6,
                    eq=[("lowshelf", 90.0, -1.5), ("peak", 750.0, -2.0, 0.8), ("highshelf", 6000.0, 2.0)])
    B = lambda bar: bar * BPB  # noqa: E731
    P = lambda spec: progression(spec, BPB)  # noqa: E731

    intro = P("Am | Fmaj7 | Dm9 | E")
    a = P("Am | F | Dm | E | Am | F | G | E7")
    b = P("F | G | Em7 | Am | Dm9 | G | Cmaj7 | E7")
    c = P("C | G/B | Am7 | Fmaj7 | C/E | Dm7 | Fmaj7 | Esus4:1.5 E:1.5")
    outro = P("Am | Fmaj7 | Dm9 | Esus4:1.5 E:1.5")
    sections = [("Intro", 0, intro), ("A", 4, a), ("B", 12, b), ("C", 20, c), ("A'", 28, a), ("B'", 36, b),
                ("Outro", 44, outro)]
    for label, bar, _ in sections:
        s.section(label, bar)
    harmony(s, [(bar, prog) for _, bar, prog in sections])
    s.lint_parts = ["lead", "bells"]

    choir = s.part("choir", with_kw(I.choir, vowel_a="oh", vowel_b="ah", attack=0.8, release=1.6), -12, rev=0.55,
                   eq=EQ_CHOIR, width=1.3)
    marimba = s.part("marimba", with_kw(I.mallet, kind="marimba"), -7, rev=0.35, dly=0.15, eq=EQ_BELL, pan=0.2,
                     human_ms=7)
    harp = s.part("harp", with_kw(I.pluck, pick=0.3, decay=2.0, bright=0.5, rolloff=1.3), -12, rev=0.5,
                  eq=EQ_PLUCK, pan=-0.3, human_ms=8)
    bells = s.part("bells", with_kw(I.mallet, kind="glass", decay_scale=1.1), -3, rev=0.55, dly=0.35,
                   eq=EQ_BELL, pan=-0.15, human_ms=6)
    lead = s.part("lead", with_kw(I.lead_soft, vib=10, breath=0.04, attack=0.09, bright=0.9), 0, rev=0.4,
                  dly=0.2, eq=EQ_LEAD, human_ms=12)
    bass = s.part("bass", with_kw(I.bass, style="sub", drive=1.1), -9, rev=0.06, eq=EQ_BASS, human_ms=6)
    frame = s.part("frame", FRAME, -12, rev=0.3, human_ms=5)
    shaker = s.part("shaker", SHAKER, -24, rev=0.2, eq=EQ_HAT, pan=0.35, human_ms=6)
    swell = s.part("swell", SWELL, -21, rev=0.4, human_ms=0)

    prev = None
    for label, bar, prog in sections:
        vel = {"Intro": 0.5, "C": 0.7}.get(label, 0.58)
        prev = pad_chords(choir, offset(prog, B(bar)), low=52, high=72, n=3, vel=vel, prev=prev)

    mprev = None
    for label, bar, prog in sections:
        if label == "C":
            continue
        pattern = [0, 2, 3, 2, 4, 2] if label not in ("B", "B'") else [0, 3, 2, 4, 3, 1]
        mprev = arpeggio(marimba, offset(prog, B(bar)), pattern, step=0.5, low=57, high=81, vel=0.52,
                         accent=0.12, prev=mprev)
    hprev = None
    for label, bar, prog in sections:
        if label in ("C", "B'"):
            hprev = arpeggio(harp, offset(prog, B(bar)), [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1], step=0.25, low=55,
                             high=86, vel=0.42, accent=0.05, prev=hprev)

    bprev = None
    for label, bar, prog in sections:
        rhythm = [(0, 2.8, 0.75, 0)] if label != "C" else [(0, 1.9, 0.75, 0), (2, 0.9, 0.55, 12)]
        bprev = bassline(bass, offset(prog, B(bar)), rhythm, low=28, high=40, prev=bprev)

    mel_a = ["E5:1.5 D5:.5 C5:1", "A4:2 C5:1", "D5:1 F5:1 A5:1", "G#5:2.5 F5:.5", "C5:1.5 B4:.5 A4:1",
             "C5:1 F5:1 A5:1", "B5:1.5 A5:.5 G5:1", "E5:1 G#5:1 B5:1"]
    mel_b = ["A5:2 C6:1", "B5:2 D6:1", "G5:2 E5:1", "A5:3", "F5:1.5 E5:.5 D5:1", "D5:1 G5:1 B5:1",
             "B5:1.5 G5:.5 E5:1", "G#5:2 E5:1"]
    bars(lead, B(4), mel_a, BPB, vel=0.68)
    bars(lead, B(12), mel_b, BPB, vel=0.7)
    bars(lead, B(28), mel_a[:6] + ["B5:1 D6:1 B5:1", "G#5:1.5 F5:.5 E5:1"], BPB, vel=0.72)
    bars(lead, B(36), mel_b, BPB, vel=0.74)
    mel_c = ["E6:2 G5:1", "D6:2 B5:1", "C6:1.5 B5:.5 A5:1", "A5:2 E5:1", "G5:1 C6:1 E6:1", "D6:2 A5:1",
             "C6:1.5 A5:.5 F5:1", "A5:1.5 G#5:1.5"]
    bars(bells, B(20), mel_c, BPB, vel=0.62, legato=1.0)
    # the Echo signal (1–5–4–2) on A minor and F major bars of A / A'
    for label, bar, prog in sections:
        if label not in ("A", "A'", "Intro"):
            continue
        for b0, ln, ch in offset(prog, B(bar)):
            if ch.symbol in ("Am", "F", "Fmaj7"):
                root = 76 + (ch.root - 76) % 12
                cell = [0, 7, 6 if ch.symbol.startswith("F") else 5, 2]
                for i, iv in enumerate(cell):
                    bells.note(b0 + 1 + i * 0.5, 0.5 if i < 3 else 1.5, root + iv, 0.42 if i else 0.5)

    for label, bar, prog in sections:
        n = len(prog)
        if label in ("A", "B", "A'", "B'"):
            drum_line(frame, B(bar), n, "x...o.o.x...", beats_per_bar=BPB, vel=0.6, pitch=82)
            drum_line(shaker, B(bar), n, "x.o.x.o.x.o.", beats_per_bar=BPB, vel=0.45)
        elif label == "C":
            drum_line(frame, B(bar), n, "x...........", beats_per_bar=BPB, vel=0.45, pitch=76)
    for bar in (11, 19, 27):
        swell.note(B(bar), 3, None, 0.6)
    return s
