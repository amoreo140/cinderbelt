"""Render a Song to mastered stems: parts -> buses -> reverb/delay -> master -> loudness."""
from __future__ import annotations

import math
import time

import numpy as np
import pyloudnorm as pyln

from . import dsp
from .dsp import SR, circular, db
from .theory import hz

REF_LUFS = -24.0  # loudness a part with level 0 is normalized to before mixing


def loudness(x: np.ndarray) -> float:
    meter = pyln.Meter(SR)
    if x.shape[-1] < SR:
        return -70.0
    v = meter.integrated_loudness(x.T)
    return float(v) if math.isfinite(v) else -70.0


def _place(buf: np.ndarray, y: np.ndarray, start: int) -> None:
    """Add y into the circular buffer at `start` (wraps around)."""
    L = buf.shape[-1]
    n = y.shape[-1]
    pos = start % L
    done = 0
    while done < n:
        chunk = min(L - pos, n - done)
        buf[:, pos:pos + chunk] += y[:, done:done + chunk]
        done += chunk
        pos = 0


def _swing(beat: float, amount: float) -> float:
    if amount <= 0:
        return beat
    sixteenth = beat * 4
    i = round(sixteenth)
    if abs(sixteenth - i) < 1e-6 and i % 2 == 1:
        return beat + amount * 0.25 * 0.5
    return beat


def render_part(song, part, L: int) -> np.ndarray:
    rng = song.rng("part:" + part.name)
    buf = np.zeros((2, L))
    spb = song.spb
    for ev in part.events:
        beat = _swing(ev.beat, part.swing)
        t = beat * spb + rng.normal(0, part.human_ms / 1000.0) if part.human_ms > 0 else beat * spb
        vel = float(np.clip(ev.vel * (1 + rng.normal(0, part.human_vel)), 0.05, 1.0))
        f = hz(ev.pitch) if ev.pitch is not None else 0.0
        kw = {**part.kw, **ev.kw}
        y = part.inst(f, ev.dur * spb, vel, rng, **kw)
        if y.ndim == 1:
            y = dsp.stereo(y, part.pan)
        elif part.pan != 0:
            gl, gr = dsp.pan_gains(part.pan)
            y = y * np.array([[gl * math.sqrt(2)], [gr * math.sqrt(2)]])
        _place(buf, dsp.fade_tail(y.copy(), 0.004), int(round(t * SR)))
    return buf


def kick_envelope(song, L: int, depth: float, release: float = 0.16) -> np.ndarray:
    """Sidechain-style gain curve from the kick part's hit times (circular)."""
    kp = next((p for p in song.parts if p.name == song.kick_part), None)
    g = np.ones(L)
    if kp is None or depth <= 0:
        return g
    n = int(release * 6 * SR)
    tt = np.arange(n) / SR
    shape = depth * np.minimum(tt / 0.006, 1) * np.exp(-tt / release)
    duck = np.zeros(L)
    for ev in kp.events:
        start = int(round(ev.beat * song.spb * SR)) % L
        seg = shape * ev.vel
        idx = (start + np.arange(n)) % L
        duck[idx] = np.maximum(duck[idx], seg)
    return 1 - duck


def process_part(song, part, x: np.ndarray, L: int) -> np.ndarray:
    if part.eq:
        x = circular(lambda s: dsp.eq(s, part.eq), x)
    if part.chorus > 0:
        x = dsp.chorus(x, mix=part.chorus)
    if part.tremolo > 0:
        lfo = dsp.loop_lfo(L, part.tremolo_rate)
        x = x * np.stack([1 + part.tremolo * 0.5 * lfo, 1 - part.tremolo * 0.5 * lfo])
    if part.width != 1.0:
        mid = (x[0] + x[1]) / 2
        side = (x[0] - x[1]) / 2 * part.width
        x = np.stack([mid + side, mid - side])
    lv = loudness(x)
    if lv > -69:
        x = x * db(REF_LUFS + part.level - lv)
    if part.duck > 0:
        x = x * kick_envelope(song, L, part.duck)[None, :]
    return x


def render_song(song, log=print) -> dict:
    """Returns dict(stems={name: (2, L)}, full=(2, L), info=...)."""
    t0 = time.time()
    L = int(round(song.seconds * SR))
    stems: dict[str, dict[str, np.ndarray]] = {}
    part_report = []
    for part in song.parts:
        if not part.events:
            continue
        x = render_part(song, part, L)
        x = process_part(song, part, x, L)
        st = stems.setdefault(part.stem, {"dry": np.zeros((2, L)), "rev": np.zeros((2, L)), "dly": np.zeros((2, L))})
        st["dry"] += x
        st["rev"] += x * part.rev
        st["dly"] += x * part.dly
        part_report.append((part.name, part.stem, part.level, len(part.events)))
    log(f"  [{song.id}] parts rendered in {time.time() - t0:.1f}s")

    # ---- effects (linear, per stem; gains derived from the full mix)
    rcfg = song.reverb
    ir = dsp.make_ir(rcfg["seconds"], song.rng("reverb"), rcfg["rt_low"], rcfg["rt_high"],
                     rcfg["predelay"], width=rcfg["width"], hp=rcfg["hp"], lp=rcfg["lp"])
    dcfg = song.delay
    for st in stems.values():
        st["dly_out"] = (dsp.pingpong_delay(st["dly"], dcfg["beats"] * song.spb, dcfg["feedback"])
                         if np.any(st["dly"]) else np.zeros((2, L)))
        st["rev_out"] = dsp.circ_convolve(st["rev"] + st["dly_out"] * dcfg["into_reverb"], ir)
    dry_full = sum(st["dry"] for st in stems.values())
    rev_full = sum(st["rev_out"] for st in stems.values())
    dly_full = sum(st["dly_out"] for st in stems.values())
    l_dry = loudness(dry_full)
    g_rev = db(l_dry + rcfg["wet_lu"] - loudness(rev_full)) if np.any(rev_full) else 0.0
    g_dly = db(l_dry + dcfg["wet_lu"] - loudness(dly_full)) if np.any(dly_full) else 0.0
    mixes = {name: st["dry"] + g_rev * st["rev_out"] + g_dly * st["dly_out"] for name, st in stems.items()}

    # ---- master (linear EQ per stem, linked dynamics from the full mix)
    mcfg = song.master
    bands = [("hp", 28.0, 2)] + list(mcfg.get("eq", []))

    def mono_lows(s):
        mid = (s[0] + s[1]) / 2
        side = (s[0] - s[1]) / 2
        side = dsp.highpass(side, 140.0, 2)
        return np.stack([mid + side, mid - side])

    for name in mixes:
        mixes[name] = circular(lambda s: mono_lows(dsp.eq(s, bands)), mixes[name])
    full = sum(mixes.values())
    pre = db(mcfg["lufs"] + 0.8 - loudness(full))
    for name in mixes:
        mixes[name] *= pre
    full = full * pre
    comp = circular(lambda s: dsp.compressor_gain(s, mcfg["comp_threshold"], mcfg["comp_ratio"], 0.03, 0.35), full)
    gain = comp
    for it in range(3):
        limited = full * gain[None, :]
        lim = circular(lambda s: dsp.limiter(s, mcfg["ceiling"])[None, :], limited)[0]
        out = limited * lim[None, :]
        lv = loudness(out)
        err = mcfg["lufs"] - lv
        if abs(err) < 0.15:
            break
        gain = gain * db(err)
    total = gain * lim
    out_stems = {name: m * total[None, :] for name, m in mixes.items()}
    out_full = full * total[None, :]
    info = dict(
        seconds=L / SR,
        lufs=loudness(out_full),
        gr_comp_max_db=-dsp.to_db(float(comp.min())),
        gr_lim_max_db=-dsp.to_db(float(lim.min())),
        parts=part_report,
        render_s=time.time() - t0,
    )
    log(f"  [{song.id}] mastered: {info['lufs']:.2f} LUFS, comp GR max {info['gr_comp_max_db']:.1f} dB, "
        f"limiter GR max {info['gr_lim_max_db']:.1f} dB ({info['render_s']:.1f}s)")
    return dict(stems=out_stems, full=out_full, info=info)
