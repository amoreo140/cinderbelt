"""Synthesized instruments (no samples).

Every instrument has the signature ``inst(f, dur, vel, rng, **kw) -> ndarray``
returning mono (n,) or stereo (2, n) audio at SR. ``dur`` is the held length in
seconds; the returned buffer also contains the release tail.

Most voices are additive (a numba kernel sums partials with per-partial
envelopes at a control rate), which gives exact pitch, no aliasing and a
"filter" that is just a smooth per-partial weight – no resonant peaks.
"""
from __future__ import annotations

import math

import numpy as np
from numba import njit

from .dsp import SR, adsr, bandpass, highpass, lowpass, stereo

CTRL = 32  # control-rate step (samples)
NYQ_CAP = 15000.0


@njit(cache=True)
def _additive(inc, ratios, amps, phase0, step):
    """inc: fundamental phase increment per sample (rad); amps: (K, m) control-rate."""
    n = inc.shape[0]
    k_count = ratios.shape[0]
    m = amps.shape[1]
    out = np.zeros(n)
    for k in range(k_count):
        r = ratios[k]
        ph = phase0[k]
        for i in range(n):
            ph += r * inc[i]
            c = i / step
            c0 = int(c)
            if c0 >= m - 1:
                a = amps[k, m - 1]
            else:
                fr = c - c0
                a = amps[k, c0] * (1.0 - fr) + amps[k, c0 + 1] * fr
            if a > 1e-7 or a < -1e-7:
                out[i] += a * math.sin(ph)
    return out


def _ctrl_times(n: int) -> np.ndarray:
    return np.arange(n // CTRL + 2) * CTRL / SR


def _inc(f: float, n: int, cents: np.ndarray | float = 0.0) -> np.ndarray:
    c = np.broadcast_to(np.asarray(cents, dtype=np.float64), (n,))
    return 2 * np.pi * f * (2 ** (c / 1200.0)) / SR


def _ctrl_to_samples(x: np.ndarray, n: int) -> np.ndarray:
    return np.interp(np.arange(n), np.arange(x.shape[0]) * CTRL, x)


def _drift(rng: np.random.Generator, m: int, cents: float, smooth: int = 400) -> np.ndarray:
    """Slow random pitch wander (control rate)."""
    w = rng.standard_normal(m + smooth)
    k = np.hanning(smooth)
    w = np.convolve(w, k / k.sum(), mode="valid")[:m]
    w = w / (np.abs(w).max() + 1e-9)
    return w * cents


def _vibrato(tc: np.ndarray, rate: float, depth_cents: float, delay: float, rng) -> np.ndarray:
    onset = np.clip((tc - delay) / 0.4, 0, 1)
    ph = rng.uniform(0, 2 * np.pi)
    return depth_cents * onset * np.sin(2 * np.pi * rate * tc + ph)


def _lp_weight(freqs: np.ndarray, cutoff: np.ndarray) -> np.ndarray:
    """2-pole Butterworth magnitude (no resonance). freqs (K,1), cutoff (m,)."""
    return 1.0 / np.sqrt(1.0 + (freqs / cutoff[None, :]) ** 4)


def _env_ctrl(tc: np.ndarray, a: float, d: float, s: float, r: float, held: float) -> np.ndarray:
    env = np.where(tc < a, (tc / max(a, 1e-3)) ** 1.5, s + (1 - s) * np.exp(-(tc - a) * 4.0 / max(d, 1e-3)))
    rel = tc >= held
    if rel.any():
        i = int(np.argmax(rel))
        lvl = env[i]
        env[rel] = lvl * np.exp(-(tc[rel] - held) * 5.0 / max(r, 1e-3))
    return env


# ---------------------------------------------------------------- pads / ensembles

def pad(f, dur, vel, rng, voices=3, detune=7.0, attack=0.9, decay=2.0, sustain=0.8, release=2.0,
        bright=3.0, motion=0.3, motion_rate=0.11, saw=True, spread=0.7, max_cut=5000.0):
    """Warm moving pad: detuned saw/square partials under a slowly breathing lowpass."""
    n = int((dur + release + 0.05) * SR)
    tc = _ctrl_times(n)
    m = tc.shape[0]
    env = _env_ctrl(tc, attack, decay, sustain, release, dur) * (0.55 + 0.45 * vel)
    # partials far above the (gentle) lowpass are inaudible: skip them
    kmax = int(max(4, min(40, NYQ_CAP / f, 6 * min(f * bright * (1 + motion), max_cut) / f + 2)))
    k = np.arange(1, kmax + 1, dtype=np.float64)
    base = 1.0 / k if saw else np.where(k % 2 == 1, 1.0 / k, 0.12 / k)
    out = np.zeros((2, n))
    pans = np.linspace(-spread, spread, voices) if voices > 1 else np.array([0.0])
    dets = np.linspace(-detune, detune, voices) if voices > 1 else np.array([0.0])
    for v in range(voices):
        ph = rng.uniform(0, 2 * np.pi)
        opening = 0.55 + 0.45 * np.clip(tc / (attack * 1.5 + 0.1), 0, 1)
        breathe = 1 + motion * np.sin(2 * np.pi * motion_rate * (1 + 0.15 * v) * tc + ph)
        cutoff = np.clip(f * bright * opening * breathe, 250, max_cut)
        amps = (base[:, None] * _lp_weight(k[:, None] * f, cutoff)) * env[None, :]
        cents = dets[v] + _ctrl_to_samples(_drift(rng, m, 2.5), n)
        y = _additive(_inc(f, n, cents), k, amps, rng.uniform(0, 2 * np.pi, kmax), CTRL)
        out += stereo(y, float(pans[v]))
    return out / math.sqrt(voices) * 0.35


def strings(f, dur, vel, rng, attack=0.35, release=0.9, bright=5.0, voices=4, vib=6.0):
    """Ensemble strings: detuned saws, delayed vibrato, bow-like swell."""
    n = int((dur + release + 0.05) * SR)
    tc = _ctrl_times(n)
    m = tc.shape[0]
    env = _env_ctrl(tc, attack, 1.0, 0.85, release, dur) * (0.4 + 0.6 * vel)
    kmax = int(max(4, min(36, NYQ_CAP / f, 6 * min(f * bright, 4500) / f + 2)))
    k = np.arange(1, kmax + 1, dtype=np.float64)
    base = 1.0 / k ** 1.1
    out = np.zeros((2, n))
    for v in range(voices):
        swell = 0.6 + 0.4 * np.clip(tc / (attack + 0.2), 0, 1)
        cutoff = np.clip(f * bright * swell * (0.7 + 0.3 * vel), 300, 4500)
        amps = (base[:, None] * _lp_weight(k[:, None] * f, cutoff)) * env[None, :]
        cents = (rng.uniform(-9, 9) + _vibrato(tc, rng.uniform(4.6, 5.6), vib, 0.25, rng)
                 + _drift(rng, m, 2.0))
        y = _additive(_inc(f, n, _ctrl_to_samples(cents, n)), k, amps, rng.uniform(0, 2 * np.pi, kmax), CTRL)
        out += stereo(y, rng.uniform(-0.6, 0.6))
    return out / math.sqrt(voices) * 0.4


VOWELS = {
    # (centre Hz, bandwidth Hz, gain)
    "oo": [(320, 90, 1.0), (800, 110, 0.35), (2300, 160, 0.08)],
    "oh": [(450, 100, 1.0), (850, 110, 0.5), (2500, 170, 0.1)],
    "ah": [(700, 120, 1.0), (1150, 130, 0.55), (2650, 180, 0.15)],
    "eh": [(520, 100, 1.0), (1750, 140, 0.4), (2550, 170, 0.18)],
}


def _vowel_weight(freqs: np.ndarray, vowel: str) -> np.ndarray:
    w = np.zeros_like(freqs)
    for c, bw, g in VOWELS[vowel]:
        w += g / np.sqrt(1 + ((freqs - c) / bw) ** 2)
    return w


def choir(f, dur, vel, rng, vowel_a="oo", vowel_b="ah", attack=0.7, release=1.6, voices=4, morph_rate=0.08):
    """Soft synthetic choir: glottal partials through broad, moving vowel formants."""
    n = int((dur + release + 0.05) * SR)
    tc = _ctrl_times(n)
    m = tc.shape[0]
    env = _env_ctrl(tc, attack, 1.5, 0.85, release, dur) * (0.45 + 0.55 * vel)
    kmax = int(min(30, 6000 / f))
    k = np.arange(1, kmax + 1, dtype=np.float64)
    fk = (k * f)[:, None]
    wa = _vowel_weight(fk, vowel_a)
    wb = _vowel_weight(fk, vowel_b)
    out = np.zeros((2, n))
    for v in range(voices):
        mix = 0.5 + 0.5 * np.sin(2 * np.pi * morph_rate * tc + rng.uniform(0, 6.28))
        spec = (wa * (1 - mix)[None, :] + wb * mix[None, :]) / k[:, None] ** 0.6
        amps = spec * env[None, :]
        cents = rng.uniform(-10, 10) + _vibrato(tc, rng.uniform(4.3, 5.4), 11, 0.2, rng) + _drift(rng, m, 3)
        y = _additive(_inc(f, n, _ctrl_to_samples(cents, n)), k, amps, rng.uniform(0, 2 * np.pi, kmax), CTRL)
        out += stereo(y, rng.uniform(-0.7, 0.7))
    # a breath of air
    air = highpass(rng.standard_normal(n), 2500, 2) * _ctrl_to_samples(env, n) * 0.004
    out += np.stack([air, np.roll(air, 211)])
    return out / math.sqrt(voices) * 0.5


# ---------------------------------------------------------------- keys / plucks / mallets

def epiano(f, dur, vel, rng, decay=2.2, release=0.25, bark=1.0):
    """FM electric piano (ratio 1:1 with a decaying index, faint tine)."""
    tau = float(np.clip(decay * (261.6 / f) ** 0.55, 0.6, 4.5))
    n = int((min(dur, tau * 3) + release + 0.05) * SR)
    t = np.arange(n) / SR
    idx = (0.35 + 1.1 * vel * bark) * np.exp(-t / 0.5) + 0.12
    ph = 2 * np.pi * f * t
    y = np.sin(ph + idx * np.sin(ph))
    y += 0.03 * vel * np.exp(-t / 0.025) * np.sin(2 * np.pi * f * 7.0 * t) if f < 1500 else 0
    env = np.minimum(t / 0.003, 1.0) * np.exp(-t / tau)
    off = int(dur * SR)
    if off < n:
        env[off:] *= np.exp(-(t[off:] - dur) * 5 / release)
    return y * env * (0.35 + 0.65 * vel) * 0.5


def pluck(f, dur, vel, rng, pick=0.2, decay=1.4, bright=1.0, rolloff=1.0, release=0.12):
    """Plucked string (additive): higher partials decay faster; pick-position comb."""
    tau1 = decay * (220.0 / f) ** 0.35
    n = int((min(dur + release, tau1 * 4) + 0.05) * SR)
    tc = _ctrl_times(n)
    kmax = int(min(32, NYQ_CAP / f))
    k = np.arange(1, kmax + 1, dtype=np.float64)
    a0 = np.abs(np.sin(np.pi * k * pick)) / k ** rolloff
    taus = tau1 / (1 + 0.45 * (k - 1) / max(bright, 0.05))
    amps = a0[:, None] * np.exp(-tc[None, :] / taus[:, None])
    amps *= np.minimum(tc / 0.002, 1.0)[None, :]
    rel = tc > dur
    amps[:, rel] *= np.exp(-(tc[rel] - dur) * 5 / release)[None, :]
    cents = 4.0 * np.exp(-tc / 0.03)
    y = _additive(_inc(f, n, _ctrl_to_samples(cents, n)), k, amps, np.zeros(kmax), CTRL)
    return y * (0.3 + 0.7 * vel) * 0.45


MALLETS = {
    # ratios, amps, decays (s at 440 Hz)
    "marimba": ([1.0, 3.98, 9.9], [1.0, 0.22, 0.05], [0.9, 0.2, 0.06]),
    "vibes": ([1.0, 3.93, 9.1], [1.0, 0.16, 0.035], [3.0, 0.8, 0.25]),
    "kalimba": ([1.0, 5.93, 15.1], [1.0, 0.14, 0.04], [1.5, 0.22, 0.07]),
    "glock": ([1.0, 2.76, 5.40, 8.93], [1.0, 0.25, 0.08, 0.03], [2.2, 0.7, 0.25, 0.12]),
    "bell": ([0.5, 1.0, 1.19, 1.5, 2.0, 2.52, 3.0], [0.35, 1.0, 0.4, 0.28, 0.45, 0.14, 0.08],
             [7.0, 4.5, 3.4, 2.6, 2.2, 1.4, 0.9]),
    "glass": ([1.0, 2.32, 4.25, 6.63], [1.0, 0.3, 0.1, 0.035], [3.5, 1.4, 0.6, 0.3]),
}


def mallet(f, dur, vel, rng, kind="marimba", decay_scale=1.0, tremolo=0.0, release=0.3):
    ratios, amps0, decs = MALLETS[kind]
    ratios = np.array(ratios)
    keep = ratios * f < NYQ_CAP
    ratios = ratios[keep]
    amps0 = np.array(amps0)[keep]
    decs = np.array(decs)[keep] * decay_scale * (440.0 / f) ** 0.4
    longest = float(decs.max())
    n = int((min(dur + release, longest * 4.5) + 0.05) * SR)
    tc = _ctrl_times(n)
    # harder hits bring out the upper modes
    amps0 = amps0 * np.where(np.arange(len(amps0)) == 0, 1.0, 0.4 + 0.8 * vel)
    amps = amps0[:, None] * np.exp(-tc[None, :] / decs[:, None])
    amps *= np.minimum(tc / 0.0015, 1.0)[None, :]
    if tremolo > 0:
        amps *= (1 - tremolo * 0.5 * (1 + np.sin(2 * np.pi * 5.2 * tc)))[None, :]
    rel = tc > dur + 0.05
    amps[:, rel] *= np.exp(-(tc[rel] - dur - 0.05) * 5 / release)[None, :]
    y = _additive(_inc(f, n), ratios, amps, rng.uniform(0, 0.3, len(ratios)), CTRL)
    # mallet contact: a tiny lowpassed click
    click_n = int(0.006 * SR)
    click = lowpass(rng.standard_normal(click_n), min(f * 6, 5000), 2) * np.exp(-np.arange(click_n) / (0.0015 * SR))
    y[:click_n] += click * 0.05 * vel
    return y * (0.3 + 0.7 * vel) * 0.5


# ---------------------------------------------------------------- bass

def bass(f, dur, vel, rng, style="round", release=0.08, drive=1.4):
    n = int((dur + release + 0.03) * SR)
    tc = _ctrl_times(n)
    kmax = int(min(16, 5000 / f))
    k = np.arange(1, kmax + 1, dtype=np.float64)
    if style == "sub":
        base = np.array([1.0, 0.32, 0.12, 0.05] + [0.0] * max(0, kmax - 4))[:kmax]
        cutoff = np.full_like(tc, f * 6)
        env = _env_ctrl(tc, 0.012, 0.6, 0.85, release, dur)
    elif style == "pluck":
        base = 1.0 / k
        cutoff = f * (2.2 + 9.0 * vel * np.exp(-tc / 0.09))
        env = _env_ctrl(tc, 0.004, 0.5, 0.55, release, dur)
    else:  # round
        base = 1.0 / k ** 1.5
        cutoff = f * (2.8 + 4.0 * np.exp(-tc / 0.18))
        env = _env_ctrl(tc, 0.006, 0.9, 0.75, release, dur)
    amps = base[:, None] * _lp_weight(k[:, None] * f, np.minimum(cutoff, 2500)) * env[None, :]
    y = _additive(_inc(f, n), k, amps, np.zeros(kmax), CTRL)
    y = np.tanh(y * drive * 2.0) / math.tanh(drive * 2.0) * 0.5
    return y * (0.5 + 0.5 * vel)


# ---------------------------------------------------------------- leads

def lead_soft(f, dur, vel, rng, vib=12.0, attack=0.06, release=0.25, breath=0.015, bright=1.0):
    """Ocarina / soft flute synth: few partials, delayed vibrato, a little breath."""
    n = int((dur + release + 0.03) * SR)
    tc = _ctrl_times(n)
    m = tc.shape[0]
    spec = np.array([1.0, 0.28 * bright, 0.16 * bright, 0.06 * bright, 0.035 * bright, 0.015 * bright])
    keep = np.arange(1, 7) * f < NYQ_CAP
    spec = spec[keep]
    k = np.arange(1, len(spec) + 1, dtype=np.float64)
    env = _env_ctrl(tc, attack, 0.6, 0.85, release, dur)
    amps = spec[:, None] * env[None, :]
    cents = _vibrato(tc, 5.2, vib, 0.28, rng) + _drift(rng, m, 2.0) - 8 * np.exp(-tc / 0.04)
    y = _additive(_inc(f, n, _ctrl_to_samples(cents, n)), k, amps, np.zeros(len(k)), CTRL)
    if breath > 0:
        noise = bandpass(rng.standard_normal(n), max(f * 1.5, 400), min(f * 5, 6000), 1)
        y += noise * _ctrl_to_samples(env, n) * breath * (1 + 2 * np.exp(-np.arange(n) / (0.05 * SR)))
    return y * (0.4 + 0.6 * vel) * 0.45


def lead_saw(f, dur, vel, rng, voices=2, detune=6.0, bright=4.5, swell=0.08, vib=10.0, release=0.2,
             max_cut=4200.0, square=False):
    """Brighter synth lead / brass: detuned saws, cutoff opens with a short swell."""
    n = int((dur + release + 0.03) * SR)
    tc = _ctrl_times(n)
    m = tc.shape[0]
    kmax = int(min(30, NYQ_CAP / f))
    k = np.arange(1, kmax + 1, dtype=np.float64)
    base = np.where(k % 2 == 1, 1.0 / k, 0.25 / k) if square else 1.0 / k
    env = _env_ctrl(tc, 0.02, 0.5, 0.8, release, dur) * (0.45 + 0.55 * vel)
    out = np.zeros((2, n))
    for v in range(voices):
        rise = 0.45 + 0.55 * np.clip(tc / swell, 0, 1)
        cutoff = np.clip(f * bright * rise * (0.7 + 0.3 * vel), 200, max_cut)
        amps = base[:, None] * _lp_weight(k[:, None] * f, cutoff) * env[None, :]
        d = (v - (voices - 1) / 2) * detune * 2 / max(voices - 1, 1)
        cents = d + _vibrato(tc, 5.4, vib, 0.3, rng) + _drift(rng, m, 1.5)
        y = _additive(_inc(f, n, _ctrl_to_samples(cents, n)), k, amps, rng.uniform(0, 6.28, kmax), CTRL)
        out += stereo(y, (v - (voices - 1) / 2) * 0.35)
    return out / math.sqrt(voices) * 0.3


def arp(f, dur, vel, rng, decay=0.22, bright=10.0, square=True, release=0.06):
    """Synth pluck for arpeggios: fast filter decay."""
    n = int((min(dur, decay * 5) + release + 0.03) * SR)
    tc = _ctrl_times(n)
    kmax = int(min(28, NYQ_CAP / f))
    k = np.arange(1, kmax + 1, dtype=np.float64)
    base = np.where(k % 2 == 1, 1.0 / k, 0.3 / k) if square else 1.0 / k
    cutoff = np.minimum(f * (1.6 + bright * vel * np.exp(-tc / (decay * 0.45))), 5500)
    env = np.exp(-tc / decay) * np.minimum(tc / 0.002, 1)
    rel = tc > dur
    env[rel] *= np.exp(-(tc[rel] - dur) * 5 / release)
    amps = base[:, None] * _lp_weight(k[:, None] * f, cutoff) * env[None, :]
    y = _additive(_inc(f, n), k, amps, np.zeros(kmax), CTRL)
    return y * (0.35 + 0.65 * vel) * 0.4


INSTRUMENTS = {
    "pad": pad,
    "strings": strings,
    "choir": choir,
    "epiano": epiano,
    "pluck": pluck,
    "mallet": mallet,
    "bass": bass,
    "lead_soft": lead_soft,
    "lead_saw": lead_saw,
    "arp": arp,
}
