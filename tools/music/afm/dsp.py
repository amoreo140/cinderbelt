"""Low-level DSP: filters, envelopes, effects and dynamics.

All buffers are float64 numpy arrays; stereo buffers have shape (2, n).
Loop-safe processing: every song is a circular buffer of length L. Linear
time-invariant effects (reverb, delay) are applied circularly; stateful
processors (IIR filters, compressors, limiters) are run over a pre-rolled copy
(`circular`) so their state at the loop start equals their state at the loop end.
"""
from __future__ import annotations

import math

import numpy as np
from numba import njit
from scipy import signal

SR = 48000  # Opus works natively at 48 kHz: loops stay sample-exact


# ---------------------------------------------------------------- helpers

def db(x: float) -> float:
    return 10 ** (x / 20.0)


def to_db(x: float) -> float:
    return 20 * math.log10(max(x, 1e-12))


def circular(fn, x: np.ndarray, pre: float = 6.0, post: float = 0.5) -> np.ndarray:
    """Run a stateful processor over a loop so that the seam is continuous.

    The last `pre` seconds of the loop are prepended (warm-up) and the first
    `post` seconds appended (look-ahead), then the middle part is returned.
    """
    n = x.shape[-1]
    p = min(int(pre * SR), n)
    q = min(int(post * SR), n)
    ext = np.concatenate([x[..., n - p:], x, x[..., :q]], axis=-1)
    y = fn(ext)
    return y[..., p:p + n]


def pan_gains(pan: float) -> tuple[float, float]:
    """Constant-power pan, pan in -1..1."""
    a = (pan + 1) * math.pi / 4
    return math.cos(a), math.sin(a)


def stereo(mono: np.ndarray, pan: float = 0.0) -> np.ndarray:
    gl, gr = pan_gains(pan)
    return np.stack([mono * gl, mono * gr])


# ---------------------------------------------------------------- filters (static)

def _sos(kind: str, freq, order: int = 2):
    return signal.butter(order, freq, btype=kind, fs=SR, output="sos")


def highpass(x: np.ndarray, f: float, order: int = 2) -> np.ndarray:
    return signal.sosfilt(_sos("highpass", f, order), x, axis=-1)


def lowpass(x: np.ndarray, f: float, order: int = 2) -> np.ndarray:
    return signal.sosfilt(_sos("lowpass", min(f, SR * 0.45), order), x, axis=-1)


def bandpass(x: np.ndarray, lo: float, hi: float, order: int = 2) -> np.ndarray:
    return signal.sosfilt(_sos("bandpass", [lo, min(hi, SR * 0.45)], order), x, axis=-1)


def _biquad(kind: str, f: float, gain_db: float = 0.0, q: float = 0.707):
    """RBJ cookbook biquad as an sos row."""
    a = 10 ** (gain_db / 40)
    w0 = 2 * math.pi * f / SR
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2 * q)
    if kind == "peak":
        b = [1 + alpha * a, -2 * cw, 1 - alpha * a]
        aa = [1 + alpha / a, -2 * cw, 1 - alpha / a]
    elif kind == "lowshelf":
        sa = 2 * math.sqrt(a) * alpha
        b = [a * ((a + 1) - (a - 1) * cw + sa), 2 * a * ((a - 1) - (a + 1) * cw), a * ((a + 1) - (a - 1) * cw - sa)]
        aa = [(a + 1) + (a - 1) * cw + sa, -2 * ((a - 1) + (a + 1) * cw), (a + 1) + (a - 1) * cw - sa]
    elif kind == "highshelf":
        sa = 2 * math.sqrt(a) * alpha
        b = [a * ((a + 1) + (a - 1) * cw + sa), -2 * a * ((a - 1) + (a + 1) * cw), a * ((a + 1) + (a - 1) * cw - sa)]
        aa = [(a + 1) - (a - 1) * cw + sa, 2 * ((a - 1) - (a + 1) * cw), (a + 1) - (a - 1) * cw - sa]
    else:
        raise ValueError(kind)
    b = np.array(b) / aa[0]
    aa = np.array(aa) / aa[0]
    return np.concatenate([b, aa])[None, :]


def eq(x: np.ndarray, bands: list[tuple]) -> np.ndarray:
    """bands: ("peak", f, gain_db, q) | ("lowshelf"/"highshelf", f, gain_db) | ("hp"/"lp", f[, order])."""
    y = x
    for band in bands:
        kind = band[0]
        if kind == "hp":
            y = highpass(y, band[1], band[2] if len(band) > 2 else 2)
        elif kind == "lp":
            y = lowpass(y, band[1], band[2] if len(band) > 2 else 2)
        elif kind == "peak":
            y = signal.sosfilt(_biquad("peak", band[1], band[2], band[3] if len(band) > 3 else 1.0), y, axis=-1)
        else:
            y = signal.sosfilt(_biquad(kind, band[1], band[2], 0.707), y, axis=-1)
    return y


# ---------------------------------------------------------------- time-varying filter

@njit(cache=True)
def svf_lowpass(x, cutoff, q):
    """Zero-delay-feedback state-variable lowpass with per-sample cutoff (Hz).

    q is kept low by callers (<= 0.8) – no audible resonance.
    """
    n = x.shape[0]
    y = np.zeros(n)
    ic1 = 0.0
    ic2 = 0.0
    k = 1.0 / q
    for i in range(n):
        fc = cutoff[i]
        if fc > 18000.0:
            fc = 18000.0
        if fc < 20.0:
            fc = 20.0
        g = math.tan(math.pi * fc / 48000.0)
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        y[i] = v2
    return y


# ---------------------------------------------------------------- envelopes

def adsr(n: int, a: float, d: float, s: float, r: float, note_len: float, curve: float = 4.0) -> np.ndarray:
    """Exponential-ish ADSR (seconds), released at note_len; n = total samples."""
    t = np.arange(n) / SR
    env = np.empty(n)
    a = max(a, 0.001)
    att = t < a
    env[att] = (t[att] / a) ** 1.5
    dec = ~att
    env[dec] = s + (1 - s) * np.exp(-(t[dec] - a) * curve / max(d, 1e-3))
    if note_len < t[-1]:
        rel_start = int(note_len * SR)
        level = env[min(rel_start, n - 1)]
        tr = t[rel_start:] - note_len
        env[rel_start:] = level * np.exp(-tr * 5.0 / max(r, 1e-3))
    return env


def fade_tail(x: np.ndarray, seconds: float = 0.01) -> np.ndarray:
    m = min(int(seconds * SR), x.shape[-1])
    if m > 1:
        x[..., -m:] *= np.linspace(1, 0, m)
    return x


# ---------------------------------------------------------------- reverb

def make_ir(seconds: float, rng: np.random.Generator, rt_low: float, rt_high: float,
            predelay: float = 0.02, early: int = 14, width: float = 1.0,
            hp: float = 180.0, lp: float = 7500.0) -> np.ndarray:
    """Synthetic hall impulse response (stereo, unit energy).

    Late tail = decorrelated noise shaped in 6 bands with their own decay times
    (rt_low for the bottom band down to rt_high for the top), plus sparse early
    reflections. The wet return is band-limited (hp/lp) so the reverb never
    builds up mud or fizz.
    """
    n = int(seconds * SR)
    t = np.arange(n) / SR
    edges = [0, 250, 600, 1500, 3500, 7000, 20000]
    rts = np.geomspace(rt_low, rt_high, len(edges) - 1)
    ir = np.zeros((2, n))
    for ch in range(2):
        noise = rng.standard_normal(n)
        tail = np.zeros(n)
        for i in range(len(edges) - 1):
            lo, hi = edges[i], edges[i + 1]
            if lo == 0:
                band = lowpass(noise, hi, 4)
            elif hi >= 20000:
                band = highpass(noise, lo, 4)
            else:
                band = bandpass(noise, lo, hi, 3)
            tail += band * np.exp(-6.91 * t / rts[i])
        # gentle onset of the late tail (diffusion build-up)
        tail *= 1 - np.exp(-t / 0.035)
        er = np.zeros(n)
        for _ in range(early):
            d = rng.uniform(0.004, 0.075)
            er[int(d * SR)] += rng.uniform(0.25, 0.7) * (1 if rng.random() < 0.5 else -1) * math.exp(-d * 18)
        er = lowpass(er, 6000, 2)
        sig = tail / np.sqrt(np.sum(tail ** 2)) + 0.6 * er / max(np.sqrt(np.sum(er ** 2)), 1e-9)
        pd = int(predelay * SR)
        sig = np.concatenate([np.zeros(pd), sig[: n - pd]])
        ir[ch] = sig
    # width: blend towards mono
    mid = ir.mean(axis=0)
    ir = mid + (ir - mid) * width
    ir = eq(ir, [("hp", hp, 2), ("lp", lp, 2)])
    ir /= np.sqrt(np.sum(ir ** 2) / 2)
    return ir


def circ_convolve(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    """Circular convolution (period = len(x)) of a stereo signal with a stereo IR."""
    n = x.shape[-1]
    m = ir.shape[-1]
    if m > n:
        ir = ir[..., :n]
    nfft = 1 << (n - 1).bit_length()
    if nfft != n:
        # linear convolution, then wrap the tail onto the start (exactly circular)
        out = np.zeros_like(x)
        for ch in range(x.shape[0]):
            y = signal.fftconvolve(x[ch], ir[ch % ir.shape[0]])
            out[ch] = y[:n]
            tail = y[n:]
            out[ch, : tail.shape[0]] += tail
        return out
    X = np.fft.rfft(x, n, axis=-1)
    H = np.fft.rfft(ir, n, axis=-1)
    return np.fft.irfft(X * H, n, axis=-1)


# ---------------------------------------------------------------- delay / chorus

def pingpong_delay(x: np.ndarray, delay_s: float, feedback: float, taps: int = 6,
                   hp: float = 350.0, lp: float = 4200.0) -> np.ndarray:
    """Tempo delay bouncing between channels, circular (wraps around the loop)."""
    mono = x.mean(axis=0)
    src = circular(lambda s: eq(s, [("hp", hp, 2), ("lp", lp, 2)]), mono)
    out = np.zeros_like(x)
    d = int(round(delay_s * SR))
    g = 1.0
    cur = src
    for i in range(1, taps + 1):
        g *= feedback
        cur = np.roll(cur, d)
        # each repeat gets a little darker
        if i > 1:
            cur = circular(lambda s: lowpass(s, max(lp * (0.82 ** i), 1200), 1), cur)
        ch = (i + 1) % 2
        out[ch] += g * cur
        out[1 - ch] += g * cur * 0.25
    return out


def chorus(x: np.ndarray, depth_ms: float = 3.0, rate: float = 0.35, mix: float = 0.35,
           base_ms: float = 14.0) -> np.ndarray:
    """Two modulated taps (one per side), circular."""
    n = x.shape[-1]
    t = np.arange(n) / SR
    out = x * (1 - mix * 0.5)
    mono = x.mean(axis=0)
    idx = np.arange(n, dtype=np.float64)
    # rates are snapped so that an integer number of LFO cycles fits the loop
    for ch, (r, ph) in enumerate([(rate, 0.0), (rate * 1.23, 1.7)]):
        cycles = max(1, round(r * n / SR))
        rr = cycles * SR / n
        d = (base_ms + depth_ms * np.sin(2 * np.pi * rr * t + ph)) * SR / 1000
        pos = (idx - d) % n
        i0 = np.floor(pos).astype(np.int64)
        frac = pos - i0
        i1 = (i0 + 1) % n
        tap = mono[i0] * (1 - frac) + mono[i1] * frac
        out[ch] += mix * tap
    return out


def loop_lfo(n: int, rate_hz: float, phase: float = 0.0) -> np.ndarray:
    """Sine LFO with an integer number of cycles per loop (seamless)."""
    cycles = max(1, round(rate_hz * n / SR))
    t = np.arange(n) / n
    return np.sin(2 * np.pi * cycles * t + phase)


# ---------------------------------------------------------------- dynamics

@njit(cache=True)
def _follow(level, att, rel):
    n = level.shape[0]
    out = np.empty(n)
    a = math.exp(-1.0 / (att * 48000.0))
    r = math.exp(-1.0 / (rel * 48000.0))
    s = 0.0
    for i in range(n):
        v = level[i]
        if v > s:
            s = a * s + (1 - a) * v
        else:
            s = r * s + (1 - r) * v
        out[i] = s
    return out


def compressor_gain(x: np.ndarray, threshold_db: float, ratio: float, attack: float = 0.02,
                    release: float = 0.25, knee_db: float = 6.0) -> np.ndarray:
    """Gain curve (linear) of an RMS-ish feed-forward compressor, linked stereo."""
    level = np.sqrt(_follow((x ** 2).max(axis=0), 0.005, 0.06) + 1e-12)
    ldb = 20 * np.log10(level + 1e-12)
    over = ldb - threshold_db
    gr = np.where(over <= -knee_db / 2, 0.0,
                  np.where(over >= knee_db / 2, over * (1 - 1 / ratio),
                           (1 - 1 / ratio) * (over + knee_db / 2) ** 2 / (2 * knee_db)))
    gr_s = _follow(gr, attack, release)
    return 10 ** (-gr_s / 20)


@njit(cache=True)
def _limiter_gain(peak, ceiling, look, release):
    """Look-ahead brickwall limiter gain on a peak signal (mono, linked)."""
    n = peak.shape[0]
    target = np.empty(n)
    for i in range(n):
        p = peak[i]
        target[i] = ceiling / p if p > ceiling else 1.0
    # min over the look-ahead window [i, i+look]
    held = np.empty(n)
    # simple O(n*look) is too slow for look ~ 220; use a monotonic deque
    dq = np.empty(n, dtype=np.int64)
    head = 0
    tail = 0
    j = 0
    for i in range(n):
        while j < n and j <= i + look:
            while tail > head and target[dq[tail - 1]] >= target[j]:
                tail -= 1
            dq[tail] = j
            tail += 1
            j += 1
        while dq[head] < i:
            head += 1
        held[i] = target[dq[head]]
    # attack: linear ramp towards lower values within `look` samples; release: one-pole
    g = np.empty(n)
    r = math.exp(-1.0 / (release * 48000.0))
    cur = 1.0
    for i in range(n):
        h = held[i]
        if h < cur:
            cur = cur + (h - cur) * (1.0 / look) * 4.0
            if cur < h:
                cur = h
        else:
            cur = r * cur + (1 - r) * h
        g[i] = cur
    return g


def limiter(x: np.ndarray, ceiling_db: float = -1.5, look_ms: float = 5.0, release: float = 0.12) -> np.ndarray:
    """Return the limiter gain curve for a stereo signal."""
    look = int(look_ms * SR / 1000)
    peak = np.abs(x).max(axis=0)
    g = _limiter_gain(peak, db(ceiling_db), look, release)
    # the ramp can lag the target – enforce the ceiling exactly with a short min filter
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    tgt = np.minimum(1.0, db(ceiling_db) / np.maximum(peak, 1e-9))
    hard = minimum_filter1d(tgt, size=2 * look + 1)
    hard = uniform_filter1d(hard, size=look)
    hard = np.minimum(hard, tgt)
    return np.minimum(g, hard)


def soft_clip(x: np.ndarray, drive: float = 1.0) -> np.ndarray:
    return np.tanh(x * drive) / math.tanh(drive)


def true_peak_db(x: np.ndarray) -> float:
    """True peak (dBTP) via 4x oversampling."""
    up = signal.resample_poly(x, 4, 1, axis=-1)
    return to_db(float(np.abs(up).max()))
