"""Adventure 1 – "Far Ring" (exploring the outer rings).

E minor with Dorian colour (C#), 108 BPM, 4/4, 56 bars (~124 s), circular loop.
Form: Intro (4, Dorian vamp i–IV) – A (8) – B (8) – A2 (8) – C (8, half-time bridge in G) – B2 (8)
– A3 (8, climax) – Break (4).
The A theme opens with the game's leitmotif in minor (B4 E5 F#5 G5).
"""
from afm import instruments as I
from afm.song import Song, arpeggio, bars, bassline, drum_line, harmony, offset, pad_chords, phrase, progression

from .common import (EQ_BASS, EQ_HAT, EQ_KICK, EQ_LEAD, EQ_PAD, EQ_PLUCK, HAT, HAT_OPEN, KICK_PUNCH, SNARE,
                     SWELL, TOM, with_kw)


def tom_fill(part, start_beat, vel=0.7):
    for beat, pitch in [(0, 140), (0.5, 140), (1, 115), (1.5, 115), (2, 95), (2.5, 95), (2.75, 80), (3, 80),
                        (3.5, 70)]:
        part.hit(start_beat + beat, vel * (0.85 + 0.15 * (beat / 3.5)), pitch=pitch)


def build() -> Song:
    s = Song("adventure-far-ring", "Far Ring", "adventure", 108, "E minor (Dorian)", bars=56, seed=51)
    s.notes = "Sequenced 16th arpeggio and pulsing bass under a heroic minor-key theme."
    s.reverb.update(seconds=2.8, rt_low=2.2, rt_high=1.0, wet_lu=-11.0)
    s.delay.update(beats=0.75, feedback=0.38, wet_lu=-14)
    s.master.update(comp_threshold=-16.0, comp_ratio=2.0)
    B = lambda bar: bar * 4  # noqa: E731

    intro = progression("Em9 | A/E | Em9 | A/E")
    a = progression("Em9 | Cmaj7 | G | D/F# | Em9 | Cmaj7 | Am7 | Bsus4:2 B:2")
    b = progression("Cmaj7 | D | Bm7 | Em7 | Am7 | D | Gmaj7 | Bsus4:2 B7:2")
    c = progression("G | D/F# | Em7 | Cmaj7 | G | D/F# | Am7 | Cmaj7:2 D:2")
    brk = progression("Em9 | A/E | Cmaj7 | Bsus4:2 B:2")
    sections = [("Intro", 0, intro), ("A", 4, a), ("B", 12, b), ("A2", 20, a), ("C", 28, c), ("B2", 36, b),
                ("A3", 44, a), ("Break", 52, brk)]
    for label, bar, _ in sections:
        s.section(label, bar)
    harmony(s, [(bar, prog) for _, bar, prog in sections])
    s.lint_parts = ["lead", "strings_mel"]

    pad = s.part("pad", with_kw(I.pad, bright=2.8, attack=0.8, release=1.8, motion=0.3), -12, rev=0.45,
                 eq=EQ_PAD, chorus=0.2, width=1.2, duck=0.3)
    strings = s.part("strings", with_kw(I.strings, attack=0.5, release=1.0, bright=4.5), -10, rev=0.45,
                     eq=EQ_PAD, width=1.3, duck=0.2)
    strings_mel = s.part("strings_mel", with_kw(I.strings, attack=0.35, release=1.0, bright=5.0, voices=5), -2,
                         rev=0.45, eq=EQ_LEAD, width=1.1)
    seq = s.part("arp", with_kw(I.arp, decay=0.2, bright=8.0), -9, rev=0.25, dly=0.35, eq=EQ_PLUCK,
                 human_ms=2, human_vel=0.04, duck=0.2)
    bass = s.part("bass", with_kw(I.bass, style="pluck", drive=1.5), -6, rev=0.03, eq=EQ_BASS, human_ms=3)
    lead = s.part("lead", with_kw(I.lead_saw, bright=4.0, vib=12, max_cut=3800), 0, rev=0.3, dly=0.25,
                  eq=EQ_LEAD, human_ms=7)
    kick = s.part("kick", KICK_PUNCH, -8, rev=0.05, eq=EQ_KICK, human_ms=2)
    snare = s.part("snare", SNARE, -12, rev=0.25, human_ms=3)
    hats = s.part("hats", HAT, -20, rev=0.1, eq=EQ_HAT, pan=0.25, human_ms=3, human_vel=0.12)
    ohat = s.part("open_hat", HAT_OPEN, -22, rev=0.15, eq=EQ_HAT, pan=-0.2, human_ms=3)
    toms = s.part("toms", TOM, -11, rev=0.2, human_ms=3)
    swell = s.part("swell", SWELL, -18, rev=0.3, human_ms=0)
    s.kick_part = "kick"

    prev = None
    for label, bar, prog in sections:
        prev = pad_chords(pad, offset(prog, B(bar)), low=50, high=71, n=4, vel=0.6, prev=prev)
    sprev = None
    for label, bar, prog in sections:
        if label in ("B", "B2", "A3"):
            sprev = pad_chords(strings, offset(prog, B(bar)), low=55, high=76, n=3, vel=0.6, prev=sprev)

    aprev = None
    for label, bar, prog in sections:
        vel = {"Intro": 0.4, "A": 0.5, "B": 0.55, "A2": 0.58, "C": 0.5, "B2": 0.6, "A3": 0.62, "Break": 0.45}[label]
        pattern = [0, 2, 4, 2, 5, 2, 4, 2] if label not in ("B", "B2") else [0, 3, 1, 4, 2, 5, 3, 4]
        aprev = arpeggio(seq, offset(prog, B(bar)), pattern, step=0.25, low=59, high=86, vel=vel, accent=0.12,
                         gate=0.8, prev=aprev)

    drive = [(i * 0.5, 0.42, v, iv) for i, (v, iv) in
             enumerate([(0.85, 0), (0.5, 0), (0.7, 12), (0.55, 0), (0.8, 0), (0.5, 0), (0.7, 12), (0.55, 0)])]
    half = [(0, 1.4, 0.8, 0), (1.5, 0.45, 0.6, 0), (2, 1.9, 0.75, 0)]
    bprev = None
    for label, bar, prog in sections:
        rhythm = {"Intro": [(0, 3.8, 0.6, 0)], "C": half, "Break": [(0, 3.8, 0.6, 0)]}.get(label, drive)
        bprev = bassline(bass, offset(prog, B(bar)), rhythm, low=28, high=40, prev=bprev)

    mel_a = ["B4:.5 E5:.5 F#5:.5 G5:2.5", "E5:1 G5:1 B5:2", "D6:1.5 B5:.5 G5:1 A5:1", "F#5:3 r:1",
             "B4:.5 E5:.5 F#5:.5 G5:1.5 A5:.5 B5:.5", "C6:1.5 B5:.5 G5:1 E5:1", "A5:1.5 G5:.5 E5:1 C5:1",
             "E5:2 D#5:2"]
    mel_b = ["G5:3 E5:1", "F#5:2 A5:2", "B5:3 D6:1", "B5:2 G5:2", "C6:3 A5:1", "F#5:1.5 G5:.5 A5:2",
             "B5:1 A5:1 G5:1 F#5:1", "E5:2 D#5:1 F#5:1"]
    bars(lead, B(4), mel_a, vel=0.72)
    bars(lead, B(12), mel_b, vel=0.75)
    bars(lead, B(20), mel_a, vel=0.78)
    bars(lead, B(36), mel_b[:6] + ["B5:1 D6:1 E6:1 D6:1", "E5:2 D#5:1 F#5:1"], vel=0.82)
    bars(lead, B(44), mel_a[:6] + ["A5:1 C6:1 E6:2", "E6:2 D#6:2"], vel=0.85)
    mel_c = ["D5:4", "A4:2 D5:2", "E5:2 G5:2", "G5:3 E5:1", "B5:4", "A5:2 F#5:2", "C6:2 A5:2", "G5:2 F#5:2"]
    bars(strings_mel, B(28), mel_c, vel=0.7, legato=1.0)
    # strings echo the leitmotif in the break
    phrase(strings_mel, B(52), "B4:1 E5:1 F#5:1 G5:5 E5:4 E5:2 D#5:2", vel=0.55, legato=1.0)

    for label, bar, prog in sections:
        n = len(prog) if label not in ("Intro", "Break") else 4
        start = B(bar)
        if label == "Intro":
            drum_line(hats, start + 4, 3, "o.o.o.o.o.o.o.o.", vel=0.45)
        elif label == "A":
            drum_line(kick, start, n, "x.......x.......", vel=0.75)
            drum_line(hats, start, n, "x.o.x.o.x.o.x.o.", vel=0.55)
        elif label in ("B", "A2", "B2", "A3"):
            drum_line(kick, start, n, "x.......x.x.....", vel=0.82)
            drum_line(snare, start, n, "....x.......x...", vel=0.7)
            drum_line(hats, start, n, "xoxoxoxoxoxoxoxo", vel=0.5)
            if label in ("B2", "A3"):
                drum_line(ohat, start, n, "..............x.", vel=0.5)
        elif label == "C":
            drum_line(kick, start, n, "x.........x.....", vel=0.75)
            drum_line(snare, start, n, "........x.......", vel=0.72)
            drum_line(hats, start, n, "x...x...x...x...", vel=0.5)
            drum_line(toms, start, n, "...x.....x...x..", vel=0.45, pitch=110)
        if label in ("B", "A2", "B2"):
            tom_fill(toms, start + B(n - 1), 0.7)
    for bar in (11, 27, 43, 55):
        swell.note(B(bar), 4, None, 0.7)
    return s
