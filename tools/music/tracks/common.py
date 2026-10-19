"""Shared instrument presets for the track scripts."""
from __future__ import annotations

from functools import partial

from afm import drums as D
from afm import instruments as I
from afm.dsp import stereo


def mono_drum(fn, **fixed):
    def inner(f, dur, vel, rng, **kw):
        return fn(f, dur, vel, rng, **{**fixed, **kw})
    return inner


def with_kw(fn, **fixed):
    return partial(fn, **fixed)


# EQ presets (bands for dsp.eq)
EQ_PAD = [("hp", 170.0, 2), ("peak", 320.0, -2.5, 0.8), ("lp", 9000.0, 1)]
EQ_KEYS = [("hp", 110.0, 2), ("peak", 280.0, -2.0, 0.9)]
EQ_PLUCK = [("hp", 220.0, 2), ("peak", 3500.0, -1.5, 1.0)]
EQ_LEAD = [("hp", 180.0, 2), ("lp", 10000.0, 1)]
EQ_BASS = [("hp", 32.0, 2), ("lp", 2200.0, 2)]
EQ_BELL = [("hp", 300.0, 2), ("peak", 3000.0, -2.0, 1.0)]
EQ_HAT = [("hp", 6000.0, 2), ("highshelf", 11000.0, -3.0)]
EQ_KICK = [("hp", 30.0, 2), ("lp", 4000.0, 2)]
EQ_CHOIR = [("hp", 200.0, 2), ("peak", 350.0, -2.0, 0.8), ("peak", 2600.0, -2.0, 1.0)]

KICK_SOFT = mono_drum(D.kick, style="soft")
KICK_PUNCH = mono_drum(D.kick, style="punch")
KICK_DEEP = mono_drum(D.kick, style="deep")
SNARE = mono_drum(D.snare)
BRUSH = mono_drum(D.snare, style="brush", snap=0.6, decay=0.2)
CLAP = mono_drum(D.clap)
RIM = mono_drum(D.rim)
HAT = mono_drum(D.hat)
HAT_OPEN = mono_drum(D.hat, open_=True)
SHAKER = mono_drum(D.shaker)
TOM = mono_drum(D.tom)
TAIKO = mono_drum(D.taiko)
FRAME = mono_drum(D.frame_drum)
SWELL = D.swell
IMPACT = mono_drum(D.impact)

__all__ = ["I", "D", "stereo"]
