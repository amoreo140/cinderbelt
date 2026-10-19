"""Combat 2 – "Rust Fortress" (fortress fights, raids; stems for adaptive intensity).

F minor (Phrygian bII colour), 120 BPM, 4/4, 40 bars (80 s), circular loop.
Form: A (8, i–VI–VII–V) – B (8, iv–i6–bII–V) – C (8, half-time chorale) – D (8, climax) – A' (8).
Rhythmic identity: 3-3-2 sixteenth groupings in bass, ostinato, taikos and the forge "anvil".
Stems: base (ostinato, bass, pad, low pulse) / drive (taiko ensemble, kit, anvil) / lead (low brass
melody, high strings, impacts).
"""
from afm import instruments as I
from afm.song import Song, bars, drum_line, harmony, offset, pad_chords, phrase, progression
from afm.theory import Chord, voice

from .common import (CLAP, EQ_BASS, EQ_BELL, EQ_HAT, EQ_KICK, EQ_LEAD, EQ_PAD, EQ_PLUCK, FRAME, HAT, IMPACT,
                     KICK_DEEP, SWELL, TAIKO, TOM, with_kw)

GROUP = [0, 3, 6, 8, 11, 14]  # 3-3-2 | 3-3-2 sixteenth accents in a bar


def ostinato(part, prog, low=50, high=67, vel=0.55, half=False):
    """16th ostinato on the chord's root/fifth/octave with 3-3-2 accents (8ths when half)."""
    prev = None
    for b, l, c in prog:
        v = voice(c, prev, low, high, 3)
        prev = v
        cells = [v[0], v[0], v[1], v[0], v[0], v[2], v[0], v[1]]
        step = 0.5 if half else 0.25
        for i in range(int(round(l / step))):
            pos = i % 16
            acc = (pos in GROUP) if not half else (i % 2 == 0)
            part.note(b + i * step, step * 0.6, cells[i % len(cells)], vel + (0.25 if acc else 0.0))


def build() -> Song:
    s = Song("combat-rust-fortress", "Rust Fortress", "combat", 120, "F minor", bars=40, seed=91)
    s.notes = "Heavier taiko-driven combat cue with a low brass theme and a forge anvil."
    s.reverb.update(seconds=2.6, rt_low=2.2, rt_high=1.0, wet_lu=-12.0)
    s.delay.update(beats=0.75, feedback=0.3, wet_lu=-18)
    s.master.update(comp_threshold=-15.0, comp_ratio=2.2)
    B = lambda bar: bar * 4  # noqa: E731

    a = progression("Fm | Db | Eb | C | Fm | Db | Bbm | C7")
    b = progression("Bbm | Fm/Ab | Gb | C7 | Bbm | Fm/Ab | Gb | Csus4:2 C:2")
    c = progression("Db | Eb | Cm/Eb | Fm | Db | Eb | Gb | C7")
    d = progression("Fm | Eb | Db | C | Fm | Eb | Db | C7")
    sections = [("A", 0, a), ("B", 8, b), ("C", 16, c), ("D", 24, d), ("A'", 32, a)]
    for label, bar, _ in sections:
        s.section(label, bar)
    harmony(s, [(bar, prog) for _, bar, prog in sections])
    s.lint_parts = ["lead", "strings_hi"]

    pad = s.part("pad", with_kw(I.pad, bright=1.6, attack=0.4, release=1.0, motion=0.35), -14, stem="base",
                 rev=0.4, eq=EQ_PAD, width=1.2, duck=0.25)
    ost = s.part("ostinato", with_kw(I.arp, decay=0.12, bright=4.5, square=False), -8, stem="base", rev=0.2,
                 eq=EQ_PLUCK, human_ms=2, human_vel=0.05, width=1.3)
    bass = s.part("bass", with_kw(I.bass, style="pluck", drive=1.9), -5, stem="base", rev=0.02, eq=EQ_BASS,
                  human_ms=2)
    pulse = s.part("pulse", FRAME, -13, stem="base", rev=0.25, human_ms=2)

    kick = s.part("kick", KICK_DEEP, -7, stem="drive", rev=0.04, eq=EQ_KICK, human_ms=1)
    clap = s.part("clap", CLAP, -12, stem="drive", rev=0.3, human_ms=2)
    hats = s.part("hats", HAT, -20, stem="drive", rev=0.08, eq=EQ_HAT, pan=0.2, human_ms=2, human_vel=0.12)
    taiko = s.part("taiko", TAIKO, -7, stem="drive", rev=0.35, human_ms=3)
    taiko_hi = s.part("taiko_hi", TOM, -11, stem="drive", rev=0.3, pan=0.25, human_ms=3)
    anvil = s.part("anvil", with_kw(I.mallet, kind="glock", decay_scale=0.35), -20, stem="drive", rev=0.35,
                   eq=EQ_BELL + [("lp", 6000.0, 2)], pan=-0.3, human_ms=3)
    swell = s.part("swell", SWELL, -18, stem="drive", rev=0.3, human_ms=0)

    lead = s.part("lead", with_kw(I.lead_saw, bright=3.2, swell=0.14, vib=8, voices=3, max_cut=3200), 0,
                  stem="lead", rev=0.3, dly=0.15, eq=EQ_LEAD, human_ms=5)
    strings_hi = s.part("strings_hi", with_kw(I.strings, attack=0.3, release=0.9, bright=5.0, voices=5), -3,
                        stem="lead", rev=0.45, eq=EQ_LEAD, width=1.2)
    impact = s.part("impact", IMPACT, -8, stem="lead", rev=0.45, human_ms=0)
    s.kick_part = "kick"

    prev = None
    for label, bar, prog in sections:
        prev = pad_chords(pad, offset(prog, B(bar)), low=48, high=67, n=3, vel=0.6, prev=prev)
    for label, bar, prog in sections:
        ostinato(ost, offset(prog, B(bar)), half=(label == "C"))
    for label, bar, prog in sections:
        for b0, ln, ch in offset(prog, B(bar)):
            root = 29 + (ch.bass - 29) % 12
            if label == "C":
                bass.note(b0, ln * 0.95, root, 0.85)
                continue
            for i in range(int(ln * 4)):
                if i % 16 in GROUP:
                    bass.note(b0 + i * 0.25, 0.6 if i % 16 not in (6, 14) else 0.4, root + (12 if i % 16 == 11 else 0),
                              0.9 if i % 16 in (0, 8) else 0.7)
    for label, bar, prog in sections:
        drum_line(pulse, B(bar), 8, "x.......x......." if label != "C" else "x...............", vel=0.6, pitch=62)

    for label, bar, prog in sections:
        st = B(bar)
        if label == "C":
            drum_line(taiko, st, 8, "x.........x.....", vel=0.8, pitch=55)
            drum_line(kick, st, 8, "x...............", vel=0.8)
            drum_line(clap, st, 8, "........x.......", vel=0.75)
            drum_line(hats, st, 8, "x...x...x...x...", vel=0.45)
        else:
            drum_line(taiko, st, 8, "x..x..x.x.......", vel=0.8, pitch=58)
            drum_line(taiko_hi, st, 8, "........x..x..x.", vel=0.6, pitch=120)
            drum_line(kick, st, 8, "x.....x.x.....x.", vel=0.85)
            drum_line(clap, st, 8, "....x.......x...", vel=0.75)
            drum_line(hats, st, 8, "x.xxx.xxx.xxx.xx", vel=0.45)
            if label in ("D", "A'"):
                drum_line(anvil, st, 8, "...x.....x....x.", vel=0.5)
        for i, (bt, pt) in enumerate([(2, 140), (2.25, 140), (2.5, 110), (2.75, 110), (3, 85), (3.25, 85),
                                      (3.5, 65), (3.75, 65)]):
            taiko_hi.hit(st + B(7) + bt, 0.6 + 0.04 * i, pitch=pt)
    # the anvil rings on C6 – the one pitch that sits in (or colours) every chord of the piece
    for ev in anvil.events:
        ev.pitch = 84
    for bar in (15, 23, 31, 39):
        swell.note(B(bar), 4, None, 0.75)

    mel_a = ["F4:1.5 Ab4:.5 C5:2", "Db5:1.5 C5:.5 Ab4:2", "Bb4:1.5 C5:.5 Eb5:2", "E5:2 C5:1 G4:1",
             "F5:1.5 Eb5:.5 C5:2", "Db5:1 F5:1 Ab5:2", "F5:1.5 Db5:.5 Bb4:2", "C5:1 E5:1 G5:1 Bb5:1"]
    mel_b = ["Db5:3 F5:1", "C5:3 Ab4:1", "Bb4:2 Db5:2", "E5:2 G5:1 E5:1", "F5:3 Db5:1", "C5:2 F5:2",
             "Gb5:2 Db5:2", "F5:2 E5:2"]
    mel_d = ["C6:1.5 Ab5:.5 F5:2", "G5:1.5 Bb5:.5 G5:2", "Ab5:1.5 F5:.5 Db5:2", "E5:1 G5:1 C6:2",
             "C6:1.5 Ab5:.5 F5:1 C6:1", "Bb5:1.5 G5:.5 Eb5:1 Bb5:1", "Ab5:1 F5:1 Db5:1 F5:1", "E5:1 G5:1 Bb5:1 C6:1"]
    bars(lead, B(0), mel_a, vel=0.75)
    bars(lead, B(8), mel_b, vel=0.78)
    bars(lead, B(24), mel_d, vel=0.85)
    bars(lead, B(32), mel_a, vel=0.82)
    mel_c = ["Ab5:4", "G5:4", "G5:2 Eb5:2", "F5:4", "Ab5:4", "Bb5:4", "Bb5:2 Db6:2", "C6:2 Bb5:2"]
    bars(strings_hi, B(16), mel_c, vel=0.75, legato=1.0)
    phrase(strings_hi, B(32), "C6:4 Ab5:4 G5:4 G5:4 C6:4 F5:4 F5:4 E5:4", vel=0.5, legato=1.0)
    for bar in (0, 16, 24, 32):
        impact.hit(B(bar), 0.85)
    return s
