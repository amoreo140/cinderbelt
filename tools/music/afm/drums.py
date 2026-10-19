"""Synthesized percussion (sine/noise only). Signature like instruments: (f, dur, vel, rng, **kw).

`f` is ignored by most drums (the score passes pitch None -> f = 0).
"""
from __future__ import annotations

import numpy as np

from .dsp import SR, bandpass, highpass, lowpass, stereo


def _t(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * SR)) / SR


def kick(f, dur, vel, rng, style="soft"):
    if style == "punch":
        f0, f1, tp, ta, click = 150.0, 48.0, 0.032, 0.30, 0.18
    elif style == "deep":
        f0, f1, tp, ta, click = 110.0, 42.0, 0.05, 0.45, 0.06
    else:  # soft
        f0, f1, tp, ta, click = 95.0, 50.0, 0.045, 0.24, 0.03
    t = _t(ta * 3.5)
    freq = f1 + (f0 - f1) * np.exp(-t / tp)
    ph = 2 * np.pi * np.cumsum(freq) / SR
    y = np.sin(ph) * np.exp(-t / ta) * np.minimum(t / 0.0015, 1)
    if click > 0:
        c = lowpass(rng.standard_normal(t.shape[0]), 3500, 2) * np.exp(-t / 0.003)
        y += c * click
    return y * vel * 0.9


def snare(f, dur, vel, rng, tone=185.0, snap=0.5, decay=0.16, style="normal"):
    t = _t(decay * 4)
    body = (np.sin(2 * np.pi * tone * t) + 0.5 * np.sin(2 * np.pi * tone * 1.72 * t)) * np.exp(-t / 0.05)
    noise = rng.standard_normal(t.shape[0])
    noise = bandpass(noise, 900, 7500, 2) * np.exp(-t / decay)
    if style == "brush":
        noise = lowpass(noise, 4000, 2)
        body *= 0.3
    y = body * 0.5 + noise * snap * 1.2
    return y * vel * 0.5


def clap(f, dur, vel, rng):
    t = _t(0.35)
    env = np.zeros_like(t)
    for i, off in enumerate([0.0, 0.011, 0.022, 0.031]):
        m = t >= off
        env[m] += np.exp(-(t[m] - off) / (0.006 if i < 3 else 0.12)) * (0.7 if i < 3 else 1.0)
    y = bandpass(rng.standard_normal(t.shape[0]), 1000, 5000, 2) * env
    return y * vel * 0.35


def rim(f, dur, vel, rng, tone=520.0):
    """Soft woody click (low wood block) – gentle backbeat for calm tracks."""
    t = _t(0.18)
    y = (np.sin(2 * np.pi * tone * t) * np.exp(-t / 0.035)
         + 0.4 * np.sin(2 * np.pi * tone * 2.31 * t) * np.exp(-t / 0.015))
    return y * vel * 0.4


def hat(f, dur, vel, rng, open_=False, tone=7500.0):
    decay = 0.22 if open_ else 0.032
    t = _t(decay * 5)
    y = highpass(rng.standard_normal(t.shape[0]), tone, 4)
    y = lowpass(y, 13500, 2) * np.exp(-t / decay) * np.minimum(t / 0.0008, 1)
    return y * vel * 0.25


def shaker(f, dur, vel, rng):
    t = _t(0.16)
    env = (1 - np.exp(-t / 0.012)) * np.exp(-t / 0.04)
    y = bandpass(rng.standard_normal(t.shape[0]), 5000, 11000, 2) * env
    return y * vel * 0.35


def tom(f, dur, vel, rng, pitch=95.0, decay=0.35):
    t = _t(decay * 4)
    freq = pitch * (1 + 0.6 * np.exp(-t / 0.04))
    y = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t / decay)
    skin = lowpass(rng.standard_normal(t.shape[0]), 900, 2) * np.exp(-t / 0.02) * 0.25
    return (y + skin) * vel * 0.7


def taiko(f, dur, vel, rng, pitch=62.0):
    t = _t(1.4)
    freq = pitch * (1 + 0.5 * np.exp(-t / 0.05))
    y = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t / 0.42)
    skin = lowpass(rng.standard_normal(t.shape[0]), 1200, 2) * np.exp(-t / 0.03) * 0.35
    return (y + skin) * vel * 0.8


def frame_drum(f, dur, vel, rng, pitch=80.0):
    """Soft hand drum: low thump plus a damped slap."""
    t = _t(0.8)
    y = np.sin(2 * np.pi * np.cumsum(pitch * (1 + 0.25 * np.exp(-t / 0.03))) / SR) * np.exp(-t / 0.22)
    slap = bandpass(rng.standard_normal(t.shape[0]), 300, 2500, 1) * np.exp(-t / 0.018) * 0.3
    return (y + slap) * vel * 0.6


def swell(f, dur, vel, rng, lo=2500.0, hi=11000.0):
    """Reverse-cymbal-like noise swell of length dur, ending at the next downbeat."""
    t = _t(dur + 0.05)
    env = (t / max(dur, 1e-3)) ** 3
    env[t > dur] = np.exp(-(t[t > dur] - dur) / 0.02)
    noise = np.stack([rng.standard_normal(t.shape[0]), rng.standard_normal(t.shape[0])])
    y = bandpass(noise, lo, hi, 2) * env
    return y * vel * 0.25


def impact(f, dur, vel, rng):
    """Low boom for section downbeats (combat)."""
    t = _t(2.0)
    freq = 38 + 50 * np.exp(-t / 0.08)
    y = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t / 0.6)
    y += lowpass(rng.standard_normal(t.shape[0]), 600, 2) * np.exp(-t / 0.1) * 0.3
    return y * vel * 0.8


def stereoize(fn, spread=0.0):
    """Wrap a mono drum so the score can pan it."""
    def inner(f, dur, vel, rng, **kw):
        y = fn(f, dur, vel, rng, **kw)
        return y if y.ndim == 2 else stereo(y, 0.0)
    return inner


DRUMS = {
    "kick": kick,
    "snare": snare,
    "clap": clap,
    "rim": rim,
    "hat": hat,
    "shaker": shaker,
    "tom": tom,
    "taiko": taiko,
    "frame": frame_drum,
    "swell": swell,
    "impact": impact,
}
