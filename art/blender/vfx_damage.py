"""Damage decal atlas (art audit 2026-10-16 batch B7) - plain numpy.

  python art/blender/vfx_damage.py            (or via batch_b.py --only decals)

public/assets/vfx/damage_decals.png: 512 x 512 RGBA, straight alpha, sRGB,
4 x 4 cells of 128 px (row 0 = TOP of the image):

  row 0  scorch blotch      L | S (pair) | L variant | L FRESH (hot rim)
  row 1  torn plate         L | S        | L slash   | L FRESH
  row 2  bullet holes       3 large | 5 small | 1 large | 3 large FRESH
  row 3  burn streak (+u)   L | S (pair) | L variant | L FRESH (hot head)

Dark charred centres, soot halo fading to alpha 0 at ~8 px from the cell edge
(no bleeding with mipmaps). The FRESH column = the same shapes with a faint hot
orange rim: code can cross-fade col 3 -> col 0 as the damage cools.  Torn-plate
cells carry a lighter bent-lip highlight so they read on dark AND light hulls.
Preview: art/out/previews/batch-b-decals.png (over a light hull plate, over a
dark hull and over a part at game scale).
"""
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from lib import tex2d as T  # noqa: E402

N = 128
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'public', 'assets', 'vfx', 'damage_decals.png')
PREVIEW = os.path.join(ROOT, 'art', 'out', 'previews', 'batch-b-decals.png')

CHAR = np.array([0.08, 0.065, 0.055])      # charred centre
SOOT = np.array([0.20, 0.155, 0.125])      # soot halo
CORE = np.array([0.07, 0.08, 0.095])       # exposed dark core inside a tear
RIB = np.array([0.22, 0.24, 0.27])         # structure seen through a tear
LIP = np.array([0.62, 0.65, 0.70])         # bent plate lip highlight
HOT = np.array([1.0, 0.48, 0.12])          # hot rim
HOT2 = np.array([1.0, 0.78, 0.38])         # hottest


def _grid(n=N):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    return (x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1


def _noise(seed, base=4, octaves=4, n=N):
    return T.fbm(n, n, base, octaves=octaves, seed=seed)


def _edge_fade(n=N, margin=8):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    d = np.minimum(np.minimum(x, n - 1 - x), np.minimum(y, n - 1 - y))
    return T.smoothstep(2, margin, d)


def _polar_radius(x, y, cx, cy, r0, seed, wob=0.25, lobes=7):
    """Noisy blob radius as a function of angle."""
    rng = np.random.RandomState(seed)
    a = np.arctan2(y - cy, x - cx)
    rr = np.ones_like(a)
    for k in range(1, lobes):
        rr += wob / k ** 0.8 * np.sin(k * a + rng.uniform(0, 6.28))
    return r0 * rr


def _compose(layers, n=N):
    """layers: [(rgb HxWx3 or 3-vector, alpha HxW)] painted in order (over)."""
    col = np.zeros((n, n, 3), np.float32)
    al = np.zeros((n, n), np.float32)
    for rgb, a in layers:
        a = np.clip(a, 0, 1)
        rgb = np.broadcast_to(np.asarray(rgb, np.float32), (n, n, 3)) if np.ndim(rgb) == 1 else rgb
        out_a = a + al * (1 - a)
        col = (rgb * a[..., None] + col * (al * (1 - a))[..., None]) / np.maximum(out_a, 1e-6)[..., None]
        al = out_a
    return np.concatenate([col, al[..., None]], -1)


# ----------------------------------------------------------------------------
# shapes
# ----------------------------------------------------------------------------
def scorch(blobs, seed, fresh=False):
    x, y = _grid()
    nz = _noise(seed, 5, 5)
    layers_halo, layers_core, hot = [], [], np.zeros((N, N), np.float32)
    for k, (cx, cy, r) in enumerate(blobs):
        rad = _polar_radius(x, y, cx, cy, r, seed + k, wob=0.3)
        d = np.hypot(x - cx, y - cy) / rad + nz * 0.25
        halo = (1 - T.smoothstep(0.55, 1.0, d)) * 0.8
        core = (1 - T.smoothstep(0.15, 0.55, d)) * 0.95
        layers_halo.append(halo)
        layers_core.append(core)
        if fresh:
            hot = np.maximum(hot, np.exp(-((d - 0.42) / 0.07) ** 2) * (0.55 + 0.45 * T.smoothstep(-0.2, 0.4, nz)))
    halo = np.max(layers_halo, 0)
    core = np.max(layers_core, 0)
    speck = (T.smoothstep(0.35, 0.6, _noise(seed + 7, 16, 2)) * halo * 0.6)
    lay = [(SOOT, halo), (CHAR, core), (CHAR * 0.6, speck)]
    if fresh:
        lay.append((HOT, hot * 0.9))
    return _compose(lay)


def torn(cx, cy, r, seed, fresh=False, slash=False):
    x, y = _grid()
    nz = _noise(seed, 6, 4)
    if slash:   # elongated diagonal tear
        a = math.radians(-32)
        u = (x - cx) * math.cos(a) + (y - cy) * math.sin(a)
        v = -(x - cx) * math.sin(a) + (y - cy) * math.cos(a)
        d = np.hypot(u / 1.0, v / 0.32) / r
    else:
        rad = _polar_radius(x, y, cx, cy, r, seed, wob=0.22, lobes=8)
        d = np.hypot(x - cx, y - cy) / rad
    d = d + nz * 0.12
    # jagged petals: angular sawtooth on the hole edge
    ang = np.arctan2(y - cy, x - cx)
    saw = (np.abs(((ang * 9 / np.pi + seed * 0.37) % 2) - 1) - 0.5) * 0.1 + nz * 0.06
    dh = d + saw
    hole = 1 - T.smoothstep(0.66, 0.72, dh)
    lip = np.exp(-((dh - 0.78) / 0.07) ** 2)
    halo = (1 - T.smoothstep(0.8, 1.35, d)) * 0.75
    # structure ribs visible inside the hole
    ribs = (np.abs(((x * 3.5 + seed * 0.1) % 1.0) - 0.5) < 0.08) * hole * 0.8
    shade = T.smoothstep(-1, 1, (x - cx) - (y - cy))      # lip lit from the top-left
    lip_col = LIP[None, None, :] * (0.55 + 0.45 * (1 - shade))[..., None]
    lay = [(SOOT, halo), (lip_col, lip * 0.95), (CORE, hole), (RIB, ribs)]
    if fresh:
        hot = np.exp(-((dh - 0.7) / 0.05) ** 2) * (0.6 + 0.4 * T.smoothstep(-0.3, 0.3, nz))
        lay.append((HOT, hot * 0.9))
    return _compose(lay)


def holes(pts, seed, fresh=False):
    x, y = _grid()
    nz = _noise(seed, 8, 3)
    lays = []
    halo_all = np.zeros((N, N), np.float32)
    hole_all = np.zeros((N, N), np.float32)
    lip_all = np.zeros((N, N), np.float32)
    hot_all = np.zeros((N, N), np.float32)
    crack_all = np.zeros((N, N), np.float32)
    rng = np.random.RandomState(seed)
    for (cx, cy, r) in pts:
        d = np.hypot(x - cx, y - cy) / r + nz * 0.08
        hole_all = np.maximum(hole_all, 1 - T.smoothstep(0.85, 1.0, d))
        lip_all = np.maximum(lip_all, np.exp(-((d - 1.15) / 0.16) ** 2))
        halo_all = np.maximum(halo_all, (1 - T.smoothstep(1.2, 2.6, d)) * 0.7)
        hot_all = np.maximum(hot_all, np.exp(-((d - 1.05) / 0.12) ** 2))
        ang = np.arctan2(y - cy, x - cx)
        for k in range(rng.randint(3, 6)):
            a0 = rng.uniform(-math.pi, math.pi)
            da = np.abs(np.angle(np.exp(1j * (ang - a0))))
            crack_all = np.maximum(crack_all, (da < 0.06) * (d > 1.0) * (d < 1.0 + rng.uniform(0.8, 1.6)) * 0.85)
    shade = T.smoothstep(-1, 1, x - y)
    lip_col = LIP[None, None, :] * (0.5 + 0.5 * (1 - shade))[..., None]
    lays = [(SOOT, halo_all), (CHAR, crack_all), (lip_col, lip_all * 0.85), (CHAR * 0.5, hole_all)]
    if fresh:
        lays.append((HOT2, hot_all * 0.8))
    return _compose(lays)


def streak(lines, seed, fresh=False):
    x, y = _grid()
    out_a = np.zeros((N, N), np.float32)
    head = np.zeros((N, N), np.float32)
    fib = _noise(seed, 3, 3)
    for k, (x0, yc, length, w) in enumerate(lines):
        t = (x - x0) / length                          # 0 at the head, 1 at the tail
        yy = (y - yc - 0.08 * np.sin(t * 3 + k)) / (w * (0.7 + 0.9 * np.clip(t, 0, 1)))
        body = np.exp(-yy ** 2 * 1.6) * (1 - T.smoothstep(0.6, 1.0, t)) * T.smoothstep(-0.08, 0.04, t)
        # fibrous streaks along +u
        fibre = 0.65 + 0.35 * T.smoothstep(-0.3, 0.5, np.sin(yy * 9 + fib * 4))
        out_a = np.maximum(out_a, body * fibre)
        head = np.maximum(head, np.exp(-((x - x0 - 0.05) / 0.08) ** 2 - (yy * 0.9) ** 2))
    core = T.smoothstep(0.45, 0.9, out_a)
    lays = [(SOOT, out_a * 0.85), (CHAR, core * 0.9), (CHAR, head * 0.9)]
    if fresh:
        lays.append((HOT2, np.clip(head * 1.3 - 0.25, 0, 1) * 0.9))
        lays.append((HOT, np.clip(out_a - 0.5, 0, 1) * head.clip(0, 1) * 0.6))
    return _compose(lays)


def build():
    cells = [
        [scorch([(0, 0, 0.62)], 11), scorch([(-0.35, -0.3, 0.36), (0.32, 0.3, 0.42)], 12),
         scorch([(-0.1, 0.05, 0.5), (0.35, -0.3, 0.3)], 13), scorch([(0, 0, 0.62)], 11, fresh=True)],
        [torn(0, 0, 0.62, 21), torn(0.05, 0.0, 0.38, 22), torn(0, 0, 0.62, 23, slash=True),
         torn(0, 0, 0.62, 21, fresh=True)],
        [holes([(-0.35, -0.25, 0.13), (0.3, -0.05, 0.11), (-0.05, 0.38, 0.12)], 31),
         holes([(-0.4, -0.35, 0.07), (-0.1, -0.1, 0.06), (0.35, -0.3, 0.07), (0.2, 0.3, 0.06), (-0.35, 0.35, 0.065)],
               32),
         holes([(0, 0, 0.2)], 33),
         holes([(-0.35, -0.25, 0.13), (0.3, -0.05, 0.11), (-0.05, 0.38, 0.12)], 31, fresh=True)],
        [streak([(-0.8, 0.0, 1.6, 0.26)], 41), streak([(-0.8, -0.3, 1.3, 0.15), (-0.6, 0.35, 1.2, 0.13)], 42),
         streak([(-0.8, 0.1, 1.5, 0.32), (-0.5, -0.35, 1.0, 0.12)], 43), streak([(-0.8, 0.0, 1.6, 0.26)], 41, fresh=True)],
    ]
    fade = _edge_fade()
    atlas = np.zeros((4 * N, 4 * N, 4), np.float32)
    for r, row in enumerate(cells):
        for c, cell in enumerate(row):
            cell = cell.copy()
            cell[..., 3] *= fade
            atlas[r * N:(r + 1) * N, c * N:(c + 1) * N] = cell
    return atlas


def preview(atlas, path):
    """Atlas over a light hull plate | over a dark hull | the atlas itself."""
    H, W = atlas.shape[:2]
    rgb, a = atlas[..., :3], atlas[..., 3:4]
    plate = np.ones((H, W, 3), np.float32) * np.array([0.86, 0.87, 0.89])
    # plate seams every cell
    plate[::N, :] = plate[:, ::N] = 0.35
    dark = np.ones((H, W, 3), np.float32) * np.array([0.18, 0.2, 0.24])
    check = ((np.indices((H, W)).sum(0) // 16) % 2)[..., None] * 0.08 + 0.12
    panels = [rgb * a + plate * (1 - a), rgb * a + dark * (1 - a), rgb * a + check * (1 - a)]
    gap = np.zeros((H, 8, 3), np.float32)
    img = np.concatenate([panels[0], gap, panels[1], gap, panels[2]], 1)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    T.write_png(path, img)
    return path


def main():
    atlas = build()
    T.write_png(OUT, atlas)
    preview(atlas, PREVIEW)
    print('BB decals', OUT, os.path.getsize(OUT), 'bytes;', PREVIEW)
    return [OUT]


if __name__ == '__main__':
    main()
