"""Technical validation of rendered tracks + diagnostic PNGs."""
from __future__ import annotations

import math

import numpy as np
from scipy import signal
from scipy.ndimage import median_filter

from .dsp import SR, to_db, true_peak_db
from .render import loudness

BANDS = [("sub", 20, 60), ("bass", 60, 200), ("lowmid", 200, 500), ("mid", 500, 2000),
         ("presence", 2000, 5000), ("brilliance", 5000, 10000), ("air", 10000, 16000)]


def short_term_max(x: np.ndarray) -> float:
    import pyloudnorm as pyln
    meter = pyln.Meter(SR, block_size=3.0)
    hop = SR
    vals = []
    for s in range(0, x.shape[-1] - 3 * SR, hop * 2):
        v = meter.integrated_loudness(x[:, s:s + 3 * SR].T)
        if math.isfinite(v):
            vals.append(v)
    return max(vals) if vals else -70.0


def ltas(x: np.ndarray):
    mono = x.mean(axis=0)
    f, p = signal.welch(mono, SR, nperseg=32768, noverlap=16384)
    return f, p


def band_report(f, p) -> dict:
    """Band energies (dB) plus their residual against a straight-line trend in log-f (100 Hz–10 kHz)."""
    out = {}
    pdb = 10 * np.log10(p + 1e-20)
    # 1/3-octave smoothing on a log grid
    grid = np.geomspace(40, 16000, 200)
    sm = np.array([pdb[(f > g / 1.12) & (f < g * 1.12)].mean() if np.any((f > g / 1.12) & (f < g * 1.12)) else -200
                   for g in grid])
    fit_mask = (grid >= 100) & (grid <= 10000)
    coef = np.polyfit(np.log2(grid[fit_mask]), sm[fit_mask], 1)
    trend = np.polyval(coef, np.log2(grid))
    for name, lo, hi in BANDS:
        m = (f >= lo) & (f < hi)
        e = 10 * np.log10(np.sum(p[m]) + 1e-20)
        gm = (grid >= lo) & (grid < hi)
        resid = float(np.mean(sm[gm] - trend[gm])) if np.any(gm) else 0.0
        out[name] = dict(energy_db=float(e), resid_db=resid)
    out["slope_db_per_oct"] = float(coef[0])
    return out, grid, sm, trend


def narrow_peaks(f, p, top=6):
    """Semitone bands (MIDI 40–100) that stick out of their ±6-semitone neighbourhood.

    Pure partials are always narrow in a fine FFT, so instead of bin-level peaks this
    measures whether a single *note* (or a resonance) dominates the long-term spectrum.
    Returns [(centre Hz, prominence dB, band dB)].
    """
    notes = np.arange(40, 101)
    e = []
    for m in notes:
        lo = 440 * 2 ** ((m - 69.5) / 12)
        hi = 440 * 2 ** ((m - 68.5) / 12)
        sel = (f >= lo) & (f < hi)
        e.append(10 * np.log10(np.sum(p[sel]) + 1e-20))
    e = np.array(e)
    out = []
    for i, m in enumerate(notes):
        nb = np.concatenate([e[max(0, i - 6):i], e[i + 1:i + 7]])
        prom = e[i] - np.median(nb)
        out.append((440 * 2 ** ((m - 69) / 12), float(prom), float(e[i])))
    out.sort(key=lambda r: -r[1])
    return out[:top]


def static_tones(x: np.ndarray, thresh_db: float = 18.0) -> tuple[float, float]:
    """Longest time (s) any bin above 150 Hz stays within `thresh_db` of the frame maximum."""
    mono = x.mean(axis=0)
    f, t, z = signal.stft(mono, SR, nperseg=8192, noverlap=4096)
    s = 20 * np.log10(np.abs(z) + 1e-9)
    s = s[f > 150]
    fb = f[f > 150]
    frame_max = s.max(axis=0)
    mask = (s > frame_max[None, :] - thresh_db) & (frame_max[None, :] > -70)
    best = 0
    best_f = 0.0
    hop = t[1] - t[0]
    for i in range(mask.shape[0]):
        row = mask[i]
        if not row.any():
            continue
        # run lengths
        d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
        starts = np.where(d == 1)[0]
        ends = np.where(d == -1)[0]
        ln = (ends - starts).max()
        if ln > best:
            best = ln
            best_f = fb[i]
    return float(best * hop), float(best_f)


def chroma_share(x: np.ndarray) -> tuple[float, list[float]]:
    mono = x.mean(axis=0)
    f, p = signal.welch(mono, SR, nperseg=16384)
    m = (f > 60) & (f < 4000)
    pcs = np.round(12 * np.log2(f[m] / 440.0)).astype(int) % 12
    e = np.bincount((pcs + 9) % 12, weights=p[m], minlength=12)  # index 0 = C
    share = e / e.sum()
    return float(share.max()), [float(v) for v in share]


def stereo_report(x: np.ndarray) -> dict:
    l, r = x[0], x[1]
    corr = float(np.corrcoef(l, r)[0, 1])
    mid = (l + r) / 2
    side = (l - r) / 2
    sm = to_db(np.sqrt(np.mean(side ** 2))) - to_db(np.sqrt(np.mean(mid ** 2)))
    lo = signal.sosfilt(signal.butter(4, 120, fs=SR, output="sos"), x, axis=-1)
    corr_lo = float(np.corrcoef(lo[0], lo[1])[0, 1])
    return dict(correlation=corr, side_minus_mid_db=sm, low_correlation=corr_lo)


SIDE_BANDS = [("250-2k", 250, 2000), ("2k-8k", 2000, 8000), ("8k-20k", 8000, 20000)]


def side_report(x: np.ndarray) -> dict:
    """How much stereo image a signal has: side energy relative to mid (dB), overall and per band above
    250 Hz (the low end is mono by mastering). Bands whose mid is more than 40 dB under the loudest band
    are left out – a side/mid ratio of near-silence says nothing about the image."""
    mid = (x[0] + x[1]) / 2
    side = (x[0] - x[1]) / 2
    e = lambda v: float(np.mean(v ** 2)) + 1e-20  # noqa: E731
    out = {"all": 10 * np.log10(e(side) / e(mid))}
    mids = {}
    for name, lo, hi in SIDE_BANDS:
        sos = signal.butter(4, [lo, min(hi, SR / 2 - 100)], btype="band", fs=SR, output="sos")
        mids[name] = (e(signal.sosfilt(sos, mid)), e(signal.sosfilt(sos, side)))
    top = max(m for m, _ in mids.values())
    for name, (m, s) in mids.items():
        if m > top * 1e-4:
            out[name] = 10 * np.log10(s / m)
    return out


def seam_report(x: np.ndarray) -> dict:
    """Discontinuity at the loop point compared with typical sample-to-sample motion."""
    d = np.abs(np.diff(x, axis=-1))
    typical = float(np.percentile(d, 99.9))
    jump = float(np.abs(x[:, 0] - x[:, -1]).max())
    w = int(0.05 * SR)
    rms_end = to_db(float(np.sqrt(np.mean(x[:, -w:] ** 2))))
    rms_start = to_db(float(np.sqrt(np.mean(x[:, :w] ** 2))))
    return dict(jump=jump, typical_p999=typical, ratio=jump / max(typical, 1e-9),
                rms_end_db=rms_end, rms_start_db=rms_start)


def analyze(x: np.ndarray) -> dict:
    f, p = ltas(x)
    bands, grid, sm, trend = band_report(f, p)
    st_s, st_f = static_tones(x)
    chroma_max, chroma = chroma_share(x)
    return dict(
        lufs=loudness(x),
        short_term_max=short_term_max(x),
        true_peak=true_peak_db(x),
        sample_peak=to_db(float(np.abs(x).max())),
        clipped=int(np.sum(np.abs(x) >= 0.999)),
        dc=[float(x[0].mean()), float(x[1].mean())],
        bands=bands,
        peaks=narrow_peaks(f, p),
        static_tone_s=st_s,
        static_tone_hz=st_f,
        chroma_max_share=chroma_max,
        chroma=chroma,
        stereo=stereo_report(x),
        seam=seam_report(x),
        _ltas=(grid, sm, trend),
    )


def plot(x: np.ndarray, rep: dict, path: str, title: str, sections=None, spb=None) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig = plt.figure(figsize=(16, 10), dpi=100)
    gs = fig.add_gridspec(3, 2, height_ratios=[1, 2.2, 1.6], width_ratios=[3, 1])
    # waveform envelope
    ax = fig.add_subplot(gs[0, :])
    hop = int(0.05 * SR)
    mono = x.mean(axis=0)
    n = mono.shape[0] // hop
    seg = mono[: n * hop].reshape(n, hop)
    tt = np.arange(n) * hop / SR
    ax.fill_between(tt, seg.min(axis=1), seg.max(axis=1), color="#4a78c8", lw=0)
    rms = np.sqrt((seg ** 2).mean(axis=1))
    ax.plot(tt, rms, color="#f0a040", lw=0.8)
    ax.plot(tt, -rms, color="#f0a040", lw=0.8)
    ax.set_xlim(0, tt[-1])
    ax.set_ylim(-1, 1)
    if sections and spb:
        for label, bar in sections:
            ts = bar * spb
            ax.axvline(ts, color="#888", lw=0.6)
            ax.text(ts + 0.3, 0.85, label, fontsize=8)
    ax.set_title(f"{title} — {rep['lufs']:.1f} LUFS, TP {rep['true_peak']:.2f} dBTP, "
                 f"static tone {rep['static_tone_s']:.1f}s @ {rep['static_tone_hz']:.0f} Hz, "
                 f"corr {rep['stereo']['correlation']:.2f}")
    # spectrogram (log frequency)
    ax = fig.add_subplot(gs[1, :])
    f, t, z = signal.stft(mono, SR, nperseg=4096, noverlap=3072)
    s = 20 * np.log10(np.abs(z) + 1e-7)
    keep = (f >= 30) & (f <= 16000)
    ax.pcolormesh(t, f[keep], s[keep], shading="auto", vmin=s.max() - 90, vmax=s.max(), cmap="magma")
    ax.set_yscale("log")
    ax.set_ylim(30, 16000)
    ax.set_ylabel("Hz")
    # LTAS
    ax = fig.add_subplot(gs[2, 0])
    grid, sm, trend = rep["_ltas"]
    ax.semilogx(grid, sm, color="#4a78c8", label="LTAS (1/3 oct)")
    ax.semilogx(grid, trend, color="#aaa", ls="--", label=f"trend {rep['bands']['slope_db_per_oct']:.1f} dB/oct")
    for name, lo, hi in [("lowmid", 200, 500), ("presence", 2000, 5000)]:
        ax.axvspan(lo, hi, color="#f0a040", alpha=0.12)
    for fpk, prom, _ in rep["peaks"]:
        ax.axvline(fpk, color="#d04040", lw=0.6)
    ax.set_xlim(30, 16000)
    ax.legend(fontsize=8)
    ax.set_title("long-term spectrum; shaded = mud / harshness zones; red = narrow peaks")
    # chroma
    ax = fig.add_subplot(gs[2, 1])
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    ax.bar(names, rep["chroma"], color="#6aa86a")
    ax.set_title("pitch-class energy")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def plot_chroma(x: np.ndarray, path: str, title: str, sections=None, bar_s=None, t0=0.0, t1=None) -> None:
    """Chromagram over time (bass band and upper band separately) – checks the harmony."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    mono = x.mean(axis=0)
    f, t, z = signal.stft(mono, SR, nperseg=8192, noverlap=6144)
    p = np.abs(z) ** 2
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    fig, axes = plt.subplots(2, 1, figsize=(16, 7), dpi=100, sharex=True)
    for ax, (lo, hi, lab) in zip(axes, [(250, 2500, "upper 250–2500 Hz"), (90, 300, "bass (harmonics) 90–300 Hz")]):
        sel = (f >= lo) & (f < hi)
        pcs = (np.round(12 * np.log2(f[sel] / 440.0)).astype(int) + 9) % 12
        ch = np.zeros((12, p.shape[1]))
        for k in range(12):
            ch[k] = p[sel][pcs == k].sum(axis=0)
        ch = ch / (ch.max(axis=0, keepdims=True) + 1e-12)
        ax.pcolormesh(t, np.arange(12), ch, shading="nearest", cmap="viridis")
        ax.set_yticks(range(12))
        ax.set_yticklabels(names)
        ax.set_ylabel(lab)
        if sections and bar_s:
            for label, bar in sections:
                ax.axvline(bar * bar_s, color="w", lw=0.8)
        if bar_s:
            for b in range(int(t[-1] / bar_s) + 1):
                ax.axvline(b * bar_s, color="w", lw=0.2, alpha=0.5)
        ax.set_xlim(t0, t1 or t[-1])
    axes[0].set_title(title)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def summary_line(name: str, rep: dict) -> str:
    b = rep["bands"]
    pk = ", ".join(f"{f:.0f}Hz+{p:.0f}dB" for f, p, _ in rep["peaks"][:3])
    return (f"{name:<28} {rep['lufs']:6.2f} LUFS  STmax {rep['short_term_max']:6.2f}  TP {rep['true_peak']:6.2f}  "
            f"DC {max(abs(d) for d in rep['dc']):.1e}  lowmid {b['lowmid']['resid_db']:+.1f}  "
            f"pres {b['presence']['resid_db']:+.1f}  slope {b['slope_db_per_oct']:+.1f}  "
            f"static {rep['static_tone_s']:.1f}s  chroma {rep['chroma_max_share']:.2f}  "
            f"corr {rep['stereo']['correlation']:.2f}/{rep['stereo']['low_correlation']:.2f}  "
            f"seam x{rep['seam']['ratio']:.2f}  peaks [{pk}]")
