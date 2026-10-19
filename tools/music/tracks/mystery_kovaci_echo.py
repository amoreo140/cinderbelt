"""Mystery 1 – "Forge-smith Echo" (Echo beacons, the ancient smiths).

C Lydian / modal mixture with chromatic mediants, 66 BPM, 4/4, 40 bars (~145 s), circular loop.
Form: Intro (4) – A (8, bell "signal" call + choir) – B (8, flute melody, bells respond) – C (8, shift to
Eb/Cm and back through the Neapolitan Db) – A' (8, flute theme over the signal) – Outro (4).
The beacon "signal" is a 4-note cell (1–5–#4–2): Lydian on every major chord it is transposed to.
Wonder rather than gloom: every chord is major-seventh / ninth coloured; no pedal longer than a bar.
"""
from afm import instruments as I
from afm.song import Song, arpeggio, bars, bassline, drum_line, harmony, offset, pad_chords, phrase, progression

from .common import EQ_BASS, EQ_BELL, EQ_CHOIR, EQ_LEAD, EQ_PLUCK, FRAME, SWELL, with_kw


def signal(part, beat, chord, octave_base=72, step=0.5, vel=0.6):
    """The Echo cell on a chord: root, fifth above, augmented (major chords) or perfect fourth, ninth."""
    root = octave_base + (chord.root - octave_base) % 12
    lydian = 4 in chord.intervals and 10 not in chord.intervals  # major, not dominant/sus/minor
    cell = [0, 7, 6 if lydian else 5, 2]
    for i, iv in enumerate(cell):
        part.note(beat + i * step, step * (1 if i < 3 else 4), root + iv, vel * (1.0 if i == 0 else 0.85))


def build() -> Song:
    s = Song("mystery-kovaci-echo", "Kováči Echo", "mystery", 66, "C Lydian", bars=40, seed=81)
    s.notes = "Choir, glass bells and harp triplets; the Echo signal answered by a low flute."
    s.reverb.update(seconds=5.5, rt_low=4.4, rt_high=2.0, predelay=0.035, wet_lu=-6.5, hp=220.0, lp=9000.0)
    s.delay.update(beats=1.0, feedback=0.42, wet_lu=-13, into_reverb=0.5)
    s.master.update(comp_threshold=-18.0, comp_ratio=1.6,
                    eq=[("lowshelf", 90.0, -1.5), ("peak", 750.0, -2.0, 0.8), ("highshelf", 6000.0, 2.0)])
    B = lambda bar: bar * 4  # noqa: E731

    intro = progression("Cmaj9 | Abmaj7 | Fm9 | G7sus4")
    a = progression("Cmaj9 | Abmaj7 | Fm9 | G7sus4 | Cmaj9 | Ebmaj7 | Abmaj7 | G7sus4:2 G:2")
    b = progression("Am9 | Fmaj7#11 | Cmaj7/E | D/F# | Am9 | Fmaj7#11 | Abmaj7 | G7sus4")
    c = progression("Ebmaj9 | Cm9 | Abmaj7 | Bbsus2 | Ebmaj9 | Cm9 | Dbmaj7#11 | G7sus4")
    outro = progression("Fm9 | Abmaj7 | Dbmaj7#11 | G7sus4")
    sections = [("Intro", 0, intro), ("A", 4, a), ("B", 12, b), ("C", 20, c), ("A'", 28, a), ("Outro", 36, outro)]
    for label, bar, _ in sections:
        s.section(label, bar)
    harmony(s, [(bar, prog) for _, bar, prog in sections])
    s.lint_parts = ["lead"]

    choir = s.part("choir", with_kw(I.choir, attack=1.0, release=2.0, morph_rate=0.07), -11, rev=0.6,
                   eq=EQ_CHOIR, width=1.3)
    harp = s.part("harp", with_kw(I.pluck, pick=0.3, decay=2.2, bright=0.5, rolloff=1.3), -11, rev=0.5, dly=0.2,
                  eq=EQ_PLUCK, pan=-0.25, human_ms=8)
    bells = s.part("signal", with_kw(I.mallet, kind="glass", decay_scale=1.2), -3, rev=0.55, dly=0.45,
                   eq=EQ_BELL, pan=0.2, human_ms=4)
    twinkle = s.part("twinkle", with_kw(I.mallet, kind="glock", decay_scale=1.5), -12, rev=0.7, dly=0.4,
                     eq=EQ_BELL, pan=-0.4, human_ms=15)
    deep_bell = s.part("deep_bell", with_kw(I.mallet, kind="bell", decay_scale=0.8), -9, rev=0.6, eq=EQ_BELL,
                       human_ms=0)
    lead = s.part("lead", with_kw(I.lead_soft, vib=9, breath=0.035, attack=0.12, bright=0.8), 0, rev=0.45,
                  dly=0.25, eq=EQ_LEAD, human_ms=14)
    bass = s.part("bass", with_kw(I.bass, style="sub", drive=1.0), -9, rev=0.08, eq=EQ_BASS, human_ms=8)
    frame = s.part("frame", FRAME, -15, rev=0.35, human_ms=4)
    swell = s.part("swell", SWELL, -20, rev=0.4, human_ms=0)

    prev = None
    for label, bar, prog in sections:
        vel = {"Intro": 0.5, "A": 0.55, "B": 0.6, "C": 0.7, "A'": 0.62, "Outro": 0.5}[label]
        prev = pad_chords(choir, offset(prog, B(bar)), low=52, high=72, n=3, vel=vel, prev=prev)

    hprev = None
    for label, bar, prog in sections:
        if label != "Intro":
            pat = [0, 2, 4, 5, 4, 2] if label != "C" else [0, 1, 2, 4, 2, 1]
            hprev = arpeggio(harp, offset(prog, B(bar)), pat, step=1 / 3, low=55, high=84, vel=0.45, accent=0.1,
                             prev=hprev)

    bprev = None
    for label, bar, prog in sections:
        rhythm = [(0, 3.8, 0.7, 0)] if label != "C" else [(0, 2.8, 0.75, 0), (3, 0.9, 0.55, 12)]
        bprev = bassline(bass, offset(prog, B(bar)), rhythm, low=28, high=41, prev=bprev)

    # the signal: A – every other bar, C – every bar but quieter, A' – under the flute, on beat 3
    for label, bar, prog in sections:
        for i, (b0, ln, ch) in enumerate(prog):
            at = B(bar) + b0
            if label in ("Intro",) and i in (0, 2):
                signal(bells, at + 1, ch, vel=0.5)
            elif label == "A" and i % 2 == 0:
                signal(bells, at, ch, vel=0.62)
            elif label == "B" and i % 2 == 1:
                signal(bells, at + 2, ch, octave_base=74, vel=0.5)
            elif label == "C":
                signal(bells, at + 2, ch, octave_base=74, step=1 / 3, vel=0.42)
            elif label == "A'" and i % 2 == 1:
                signal(bells, at + 2, ch, octave_base=79, vel=0.45)
            elif label == "Outro" and i == 0:
                signal(bells, at, ch, vel=0.55)

    mel_b = ["E4:1.5 G4:.5 B4:2", "A4:1.5 B4:.5 C5:2", "G4:3 E4:1", "F#4:2 A4:2", "C5:1.5 B4:.5 E5:2",
             "E5:1.5 C5:.5 A4:2", "Eb5:2 C5:2", "D5:4"]
    mel_a = ["E5:1.5 D5:.5 G5:2", "C5:1.5 Eb5:.5 G5:2", "Ab5:3 G5:1", "F5:2 C5:2", "B4:1 D5:1 E5:2",
             "G5:1.5 F5:.5 Bb5:2", "C6:2 Bb5:1 G5:1", "C5:2 B4:2"]
    bars(lead, B(12), mel_b, vel=0.66)
    bars(lead, B(28), mel_a, vel=0.7)

    # twinkles: sparse high chord tones, seeded
    rng = s.rng("twinkles")
    for b0, ln, ch in s.harmony:
        for _ in range(2):
            pos = b0 + rng.integers(0, int(ln * 2)) / 2
            pcs = ch.pcs
            p = 84 + (pcs[rng.integers(0, len(pcs))] - 84) % 12 + 12 * int(rng.integers(0, 2))
            twinkle.note(pos, 0.5, int(p), float(rng.uniform(0.3, 0.6)))

    for bar in (0, 4, 20, 24, 28):
        root = next(c for b0, l, c in s.harmony if b0 == B(bar)).root
        deep_bell.note(B(bar), 4, 48 + (root - 48) % 12, 0.7)
    # heartbeat: "lub-dub" on beat 1 (C section adds beat 3)
    for label, bar, prog in sections:
        if label in ("A", "B", "A'"):
            drum_line(frame, B(bar), len(prog), "x.o.............", vel=0.55, pitch=70)
        elif label == "C":
            drum_line(frame, B(bar), len(prog), "x.o.....x.o.....", vel=0.6, pitch=66)
    for bar in (11, 19, 27):
        swell.note(B(bar), 4, None, 0.6)
    return s
