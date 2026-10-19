"""VFX textures for the M4/M5a POIs (public/assets/vfx/): comet tail + coma,
ring-3 nebula cores (radiation sources, spec 6.7.1) and the Wardens beam
telegraph.  Same conventions as vfx.py: RGBA PNG, straight alpha, sRGB, row 0
= top.  Plain numpy - runs in Blender's Python or any Python with numpy:

  blender --background --factory-startup --python art/blender/vfx_poi.py
  python art/blender/vfx_poi.py
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from lib import tex2d as T  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'public', 'assets', 'vfx')


def _save(name, img):
    os.makedirs(OUT, exist_ok=True)
    return T.write_png(os.path.join(OUT, name), img)


def _polar_noise(size, n_ang, n_rad, octaves, seed, ridged=False):
    """fBm that is periodic around the angle: sample a (angle x radius) fBm
    image at each pixel's polar coordinates.  Returns (noise, r, angle)."""
    W, H = 1024, 256
    f = T.normalize(T.fbm(W, H, n_ang, octaves, seed=seed, ridged=ridged))
    x, y = T.grid(size)
    r = np.sqrt(x * x + y * y)
    a = (np.arctan2(y, x) / (2 * np.pi)) % 1.0
    fx = a * W
    fy = np.clip(np.clip(r, 0, 1) ** 0.6 * (H - 1) * n_rad / n_ang, 0, H - 1.001)
    x0 = np.floor(fx).astype(int)
    y0 = np.floor(fy).astype(int)
    tx, ty = fx - x0, fy - y0
    x0 %= W
    x1 = (x0 + 1) % W
    y1 = np.minimum(y0 + 1, H - 1)
    val = (f[y0, x0] * (1 - tx) + f[y0, x1] * tx) * (1 - ty) + (f[y1, x0] * (1 - tx) + f[y1, x1] * tx) * ty
    return val, r, a


# ----------------------------------------------------------------------------
# comet
# ----------------------------------------------------------------------------
def comet_tail():
    """512x128: x = along the tail (left = head, bright), y = across.
    Pale ion-blue core streaks with a warm dust fringe, fades to 0 at the
    right end and at the top/bottom edges.  Additive."""
    w, h = 512, 128
    u, _ = T.grid(w, h, centered=False)
    _, v = T.grid(w, h)
    streaks = T.normalize(T.fbm(w, h, 2, 4, seed=31))
    # stretch noise along u: sample columns slowly
    sx = T.normalize(T.fbm(64, h, 3, 4, seed=37))
    sx = np.repeat(sx, w // 64, axis=1)
    width = 0.22 + 0.78 * u ** 0.7
    prof = np.exp(-(v / width) ** 2 * 2.6)
    core = np.exp(-(v / (0.08 + 0.3 * u)) ** 2 * 2.0)
    fade = (1 - T.smoothstep(0.35, 1.0, u)) * T.smoothstep(0.0, 0.04, u)
    a = np.clip((prof * (0.45 + 0.55 * sx) * 0.75 + core * 0.6) * fade * (0.8 + 0.2 * streaks), 0, 1)
    dust = np.clip(np.abs(v) / width, 0, 1)
    col = T.ramp(np.clip(dust * 0.8 + u * 0.3, 0, 1),
                 [(0.0, (0.92, 0.98, 1.0)), (0.35, (0.62, 0.86, 1.0)), (0.7, (0.55, 0.72, 1.0)),
                  (1.0, (1.0, 0.86, 0.62))])
    return _save('comet_tail.png', T.rgba(col, a))


def comet_coma():
    """256x256 soft coma glow around the nucleus, cyan-white, additive."""
    n, r, _ = _polar_noise(256, 8, 4, 4, seed=41)
    a = np.exp(-r * r * 3.2) * (0.75 + 0.25 * n) + np.exp(-r * r * 30) * 0.5
    a = np.clip(a, 0, 1) * (1 - T.smoothstep(0.8, 1.0, r))
    col = T.ramp(np.clip(r * 1.3, 0, 1), [(0.0, (1.0, 1.0, 1.0)), (0.4, (0.75, 0.95, 1.0)), (1.0, (0.45, 0.75, 1.0))])
    return _save('comet_coma.png', T.rgba(col, a))


# ----------------------------------------------------------------------------
# ring-3 nebula cores (radiation sources)
# ----------------------------------------------------------------------------
NEB_STOPS = [(0.0, (1.0, 1.0, 0.92)), (0.12, (0.86, 1.0, 0.62)), (0.35, (0.45, 0.95, 0.55)),
             (0.65, (0.22, 0.7, 0.62)), (1.0, (0.32, 0.25, 0.62))]


def nebula_core():
    """512x512 coloured radiation core: white-hot centre -> acid green ->
    teal -> violet rim, radial filaments.  Additive, map-and-world sprite."""
    n, r, a = _polar_noise(512, 12, 6, 5, seed=51)
    n2, _, _ = _polar_noise(512, 28, 6, 3, seed=53, ridged=True)
    fil = np.clip((n2 - 0.45) * 2.2, 0, 1) * np.exp(-r * 2.2)
    body = np.exp(-r * r * 6.0) * (0.6 + 0.4 * n)
    hot = np.exp(-r * r * 90.0)
    alpha = np.clip(body * 0.9 + fil * 0.55 + hot, 0, 1) * (1 - T.smoothstep(0.82, 1.0, r))
    col = T.ramp(np.clip(r * 1.25 - fil * 0.2, 0, 1), NEB_STOPS)
    return _save('nebula_core.png', T.rgba(col, alpha))


def nebula_cloud():
    """512x512 TILEABLE wispy cloud (white, tint per layer), normal or
    additive blending; scroll / layer it around the core."""
    a = T.normalize(T.fbm(512, 512, 3, 6, seed=61))
    b = T.normalize(T.fbm(512, 512, 6, 4, seed=67, ridged=True))
    m = np.clip((a - 0.42) * 2.4, 0, 1) * (0.55 + 0.45 * b)
    shade = 0.82 + 0.18 * b
    return _save('nebula_cloud.png', T.rgba(np.dstack([shade, shade, shade]), np.clip(m, 0, 1)))


def nebula_rays():
    """512x512 radial god rays (white), additive; rotate slowly over the core."""
    n, r, a = _polar_noise(512, 40, 2, 3, seed=71)
    rays = np.clip((n - 0.45) * 2.4, 0, 1) ** 1.5
    alpha = rays * np.exp(-r * 1.8) * T.smoothstep(0.02, 0.12, r) * (1 - T.smoothstep(0.75, 1.0, r))
    return _save('nebula_rays.png', T.rgba((1, 1, 1), np.clip(alpha * 1.2, 0, 1)))


def warden_telegraph():
    """256x32 Wardens beam telegraph line (1.5 s charge, spec 6.2): dashed
    long-short-short rhythm (Forge-smith glyph language), white, additive.
    u along the beam (RepeatWrapping), v across."""
    w, h = 256, 32
    u, _ = T.grid(w, h, centered=False)
    _, v = T.grid(w, h)
    pat = np.zeros_like(u)
    # long-short-short dashes over one period
    for c, L in ((0.18, 0.26), (0.52, 0.09), (0.72, 0.09)):
        pat = np.maximum(pat, 1 - T.smoothstep(L * 0.5 - 0.02, L * 0.5, np.abs(u - c)))
    core = np.exp(-(v / 0.18) ** 2)
    glow = np.exp(-(v / 0.6) ** 2) * 0.35
    a = np.clip(pat * core + glow * (0.4 + 0.6 * pat), 0, 1)
    return _save('warden_telegraph.png', T.rgba((1, 1, 1), a))


ALL = [comet_tail, comet_coma, nebula_core, nebula_cloud, nebula_rays, warden_telegraph]


def build_all():
    return [f() for f in ALL]


if __name__ == '__main__':
    for p in build_all():
        print('VFX', p)
