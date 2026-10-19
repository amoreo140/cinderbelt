"""Combat 1 – "Pirate Run" (stems for adaptive intensity).

D minor (harmonic minor dominant), 132 BPM, 4/4, 48 bars (~87 s), circular loop.
Form: A (8, i–VI–iv–V) – B (8, Andalusian descent) – C (8, half-time, Neapolitan bII) – D (8, heroic lift
to the relative major) – A' (8) – B' (8).
Stems (sum = full mix):
  base  – galloping bass, spiccato string ostinato, dark pad, low pulse  (tension: pirates near)
  drive – drums, taiko, tom fills, high sequencer arp                     (fight)
  lead  – brass-like lead melody, high strings, impacts                   (intense fight)
"""
from afm import instruments as I
from afm.song import Song, arpeggio, bars, bassline, drum_line, harmony, offset, pad_chords, phrase, progression

from .common import (EQ_BASS, EQ_HAT, EQ_KICK, EQ_LEAD, EQ_PAD, EQ_PLUCK, FRAME, HAT, HAT_OPEN, IMPACT,
                     KICK_PUNCH, SNARE, SWELL, TAIKO, TOM, with_kw)


def build() -> Song:
    s = Song("combat-pirate-run", "Pirate Run", "combat", 132, "D minor", bars=48, seed=71)
    s.notes = "Galloping ostinato; three stems so the game can add drums and the lead with the threat."
    s.reverb.update(seconds=2.4, rt_low=1.9, rt_high=0.9, wet_lu=-12.0)
    s.delay.update(beats=0.75, feedback=0.3, wet_lu=-17)
    s.master.update(comp_threshold=-15.0, comp_ratio=2.2)
    B = lambda bar: bar * 4  # noqa: E731

    a = progression("Dm | Bb | Gm | A | Dm | Bb | Gm | A7")
    b = progression("Dm | C | Bb | A | Dm7 | C | Bb | A7")
    c = progression("Gm | Dm/F | Eb | A7 | Gm | Dm/F | Eb | A7sus4:2 A7:2")
    d = progression("Bb | C | F | A/C# | Bb | C | Dm | A")
    sections = [("A", 0, a), ("B", 8, b), ("C", 16, c), ("D", 24, d), ("A'", 32, a), ("B'", 40, b)]
    for label, bar, _ in sections:
        s.section(label, bar)
    harmony(s, [(bar, prog) for _, bar, prog in sections])
    s.lint_parts = ["lead", "strings_hi"]

    # ---- base stem
    pad = s.part("pad", with_kw(I.pad, bright=1.8, attack=0.5, release=1.2, motion=0.35), -13, stem="base",
                 rev=0.4, eq=EQ_PAD, width=1.2, duck=0.25)
    spic = s.part("ostinato", with_kw(I.arp, decay=0.13, bright=5.0, square=False), -7, stem="base", rev=0.2,
                  eq=EQ_PLUCK, human_ms=2, human_vel=0.05, width=1.2)
    bass = s.part("bass", with_kw(I.bass, style="pluck", drive=1.8), -7, stem="base", rev=0.02, eq=EQ_BASS,
                  human_ms=2)
    pulse = s.part("pulse", FRAME, -15, stem="base", rev=0.2, human_ms=2)
    # ---- drive stem
    kick = s.part("kick", KICK_PUNCH, -7, stem="drive", rev=0.04, eq=EQ_KICK, human_ms=1)
    snare = s.part("snare", SNARE, -10, stem="drive", rev=0.25, human_ms=2)
    hats = s.part("hats", HAT, -19, stem="drive", rev=0.08, eq=EQ_HAT, pan=0.25, human_ms=2, human_vel=0.12)
    ohat = s.part("open_hat", HAT_OPEN, -21, stem="drive", rev=0.12, eq=EQ_HAT, pan=-0.2, human_ms=2)
    taiko = s.part("taiko", TAIKO, -9, stem="drive", rev=0.3, human_ms=3)
    toms = s.part("toms", TOM, -11, stem="drive", rev=0.2, human_ms=2)
    seq = s.part("seq", with_kw(I.arp, decay=0.16, bright=9.0), -12, stem="drive", rev=0.2, dly=0.3,
                 eq=EQ_PLUCK, human_ms=1, pan=0.2, duck=0.2)
    swell = s.part("swell", SWELL, -18, stem="drive", rev=0.3, human_ms=0)
    # ---- lead stem
    lead = s.part("lead", with_kw(I.lead_saw, bright=3.8, swell=0.1, vib=10, voices=3, max_cut=3800), 0,
                  stem="lead", rev=0.28, dly=0.2, eq=EQ_LEAD, human_ms=5)
    strings_hi = s.part("strings_hi", with_kw(I.strings, attack=0.25, release=0.8, bright=5.0, voices=5), -3,
                        stem="lead", rev=0.4, eq=EQ_LEAD, width=1.2)
    impact = s.part("impact", IMPACT, -8, stem="lead", rev=0.45, human_ms=0)
    s.kick_part = "kick"

    prev = None
    for label, bar, prog in sections:
        prev = pad_chords(pad, offset(prog, B(bar)), low=50, high=69, n=3, vel=0.6, prev=prev)

    # spiccato ostinato: 16ths in A/B/D, 8ths in the half-time C
    oprev = None
    for label, bar, prog in sections:
        if label == "C":
            oprev = arpeggio(spic, offset(prog, B(bar)), [0, 1, 2, 1], step=0.5, low=50, high=70, vel=0.6,
                             accent=0.15, gate=0.6, n=3, prev=oprev)
        else:
            oprev = arpeggio(spic, offset(prog, B(bar)), [0, 1, 0, 2, 0, 1, 0, 3], step=0.25, low=50, high=70,
                             vel=0.55, accent=0.2, gate=0.6, n=3, prev=oprev)

    gallop = [(0, 0.4, 0.9, 0), (0.5, 0.2, 0.55, 0), (0.75, 0.2, 0.6, 0), (1, 0.4, 0.75, 12), (1.5, 0.2, 0.55, 0),
              (1.75, 0.2, 0.6, 0), (2, 0.4, 0.85, 0), (2.5, 0.2, 0.55, 0), (2.75, 0.2, 0.6, 0), (3, 0.4, 0.75, 12),
              (3.5, 0.2, 0.55, 0), (3.75, 0.2, 0.6, 0)]
    half = [(0, 2.8, 0.85, 0), (3, 0.4, 0.7, 0), (3.5, 0.2, 0.55, 0), (3.75, 0.2, 0.6, 0)]
    bprev = None
    for label, bar, prog in sections:
        bprev = bassline(bass, offset(prog, B(bar)), half if label == "C" else gallop, low=26, high=38,
                         prev=bprev)
    for label, bar, prog in sections:
        drum_line(pulse, B(bar), 8, "x.......x......." if label != "C" else "x...............", vel=0.6,
                  pitch=70)

    # ---- drive
    for label, bar, prog in sections:
        st = B(bar)
        if label == "C":
            drum_line(kick, st, 8, "x.........x.....", vel=0.85)
            drum_line(snare, st, 8, "........x.......", vel=0.8)
            drum_line(hats, st, 8, "x.x.x.x.x.x.x.x.", vel=0.5)
            drum_line(taiko, st, 8, "x.....x.........", vel=0.75, pitch=58)
        else:
            drum_line(kick, st, 8, "x.....x.x.....x.", vel=0.85)
            drum_line(snare, st, 8, "....x.......x...", vel=0.78)
            drum_line(hats, st, 8, "xoxoxoxoxoxoxoxo", vel=0.5)
            drum_line(ohat, st, 8, "..............x.", vel=0.45)
            drum_line(taiko, st, 4, "x...............x.......x.......", beats_per_bar=8, vel=0.7, pitch=62)
        # tom fill on the last bar of every section
        for i, (bt, pt) in enumerate([(2, 150), (2.25, 150), (2.5, 120), (2.75, 120), (3, 95), (3.25, 95),
                                      (3.5, 75), (3.75, 75)]):
            toms.hit(st + B(7) + bt, 0.6 + 0.04 * i, pitch=pt)
    sq = None
    for label, bar, prog in sections:
        if label in ("B", "D", "B'"):
            sq = arpeggio(seq, offset(prog, B(bar)), [0, 2, 4, 2, 5, 4, 2, 1], step=0.25, low=62, high=88,
                          vel=0.5, accent=0.1, gate=0.7, prev=sq)
    for bar in (15, 23, 31, 47):
        swell.note(B(bar), 4, None, 0.75)

    # ---- lead
    mel_a = ["D5:.75 D5:.25 A5:1 F5:1 D5:1", "D5:.75 D5:.25 Bb5:1 F5:1 D5:1", "G5:1.5 A5:.5 Bb5:1 D6:1",
             "C#6:2 A5:2", "F5:.75 E5:.25 F5:1 A5:1 D6:1", "D6:1.5 C6:.5 Bb5:1 F5:1", "G5:1 Bb5:1 A5:1 G5:1",
             "A5:2 E5:1 C#5:1"]
    mel_b = ["A5:3 F5:1", "G5:3 E5:1", "F5:3 D5:1", "E5:2 C#5:2", "A5:1 D6:1 C6:1 A5:1", "G5:1 C6:1 E6:1 C6:1",
             "D6:1.5 C6:.5 Bb5:1 F5:1", "E5:1 G5:1 C#6:2"]
    mel_d = ["F5:.5 Bb5:.5 D6:3", "G5:.5 C6:.5 E6:3", "C6:2 A5:2", "C#6:2 E5:2", "D6:1.5 C6:.5 Bb5:1 D6:1",
             "E6:1.5 D6:.5 C6:1 G5:1", "A5:1 D6:1 F5:1 A5:1", "A5:2 C#6:2"]
    bars(lead, B(0), mel_a, vel=0.75)
    bars(lead, B(8), mel_b, vel=0.78)
    bars(lead, B(24), mel_d, vel=0.85)
    bars(lead, B(32), mel_a, vel=0.82)
    bars(lead, B(40), mel_b, vel=0.85)
    mel_c = ["Bb5:4", "A5:4", "G5:2 Bb5:2", "A5:2 C#6:2", "D6:4", "D6:2 A5:2", "Eb6:2 Bb5:2", "D6:2 C#6:2"]
    bars(strings_hi, B(16), mel_c, vel=0.75, legato=1.0)
    # strings double the melody an octave below in A' (sustained skeleton)
    phrase(strings_hi, B(32), "D5:4 D5:4 G4:4 C#5:4 F4:4 D5:4 G4:4 A4:4", vel=0.55, legato=1.0)
    for bar in (0, 16, 24, 32):
        impact.hit(B(bar), 0.8)
    return s
