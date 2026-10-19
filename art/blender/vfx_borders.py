"""Art batch C4 textures (art audit 2026-10-16 §6 C, sectors design §5.1/§5.2):
border ribbon + light-fence strips, plain numpy (runs inside Blender or as
`python art/blender/vfx_borders.py`).

All WHITE (code tints with the security colour = UI token), straight alpha,
tileable along u (RepeatWrapping on u), v = across the strip (core at v 0.5).
Additive-friendly: RGB stays white where alpha > 0, so additive blending of
colour * alpha gives the glow and normal blending also works.

  vfx/border_ribbon.png            256 x 64  soft volumetric haze band with slow wisps (no hard edges)
  vfx/border_fence_guarded.png     128 x 32  evenly spaced solid dashes   (map: solid fill)
  vfx/border_fence_quiet.png       128 x 32  sparse soft dots            (map: no fill, grey-blue line)
  vfx/border_fence_contested.png   128 x 32  irregular broken dashes     (map: dotted fill)
  vfx/border_fence_pirate.png      128 x 32  zigzag barbed-wire line     (map: diagonal hatching)
The fence patterns differ by SHAPE as well as colour (sectors §5.1: colour + pattern, colour-blind safe).
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from lib import tex2d as T  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'public', 'assets', 'vfx')


def _px(w, h):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    return x + 0.5, y + 0.5


def _seg_dist(px, py, ax, ay, bx, by, period):
    """Distance from pixels to segment a-b, periodic in x with `period`."""
    best = None
    for off in (-period, 0.0, period):
        x0, x1 = ax + off, bx + off
        dx, dy = x1 - x0, by - ay
        L2 = dx * dx + dy * dy
        t = np.clip(((px - x0) * dx + (py - ay) * dy) / max(L2, 1e-6), 0, 1)
        d = np.hypot(px - (x0 + t * dx), py - (ay + t * dy))
        best = d if best is None else np.minimum(best, d)
    return best


def _glow(d, core, halo):
    """Bright core (radius core px, soft edge) + soft halo falloff."""
    c = 1.0 - T.smoothstep(core * 0.6, core, d)
    g = np.exp(-(d / halo) ** 2) * 0.45
    return np.clip(np.maximum(c, g), 0, 1)


def _edge_fade(py, h):
    """Alpha -> 0 at the strip's long edges (no hard border)."""
    v = py / h
    return T.smoothstep(0.0, 0.18, v) * T.smoothstep(0.0, 0.18, 1.0 - v)


def ribbon(w=256, h=64):
    px, py = _px(w, h)
    v = py / h
    band = np.exp(-((v - 0.5) / 0.2) ** 2)
    n1 = T.perlin(w, h, 4, 2, seed=3)
    n2 = T.perlin(w, h, 9, 3, seed=7)
    n3 = T.perlin(w, h, 17, 4, seed=11)
    wisps = 0.5 + 0.5 * (0.6 * n1 + 0.3 * n2 + 0.1 * n3)
    # wisps drift across v a little: offset the core by low-frequency noise
    shift = T.perlin(w, h, 3, 1, seed=21) * 0.07
    core = np.exp(-((v - 0.5 - shift) / 0.045) ** 2) * (0.55 + 0.45 * (0.5 + 0.5 * n2))
    a = band * (0.35 + 0.65 * wisps) * 0.75 + core * 0.3
    a *= _edge_fade(py, h)
    a = np.clip(a, 0, 1)
    rgb = np.ones((h, w, 3), np.float32)
    rgb[..., 2] *= 1.0
    return T.rgba(rgb, a)


def fence_guarded(w=128, h=32):
    px, py = _px(w, h)
    d = np.minimum(_seg_dist(px, py, 8, h / 2, 54, h / 2, w), _seg_dist(px, py, 72, h / 2, 118, h / 2, w))
    return _finish(_glow(d, 3.2, 7.0), py, h)


def fence_quiet(w=128, h=32):
    px, py = _px(w, h)
    d = np.minimum(_seg_dist(px, py, 32, h / 2, 32, h / 2, w), _seg_dist(px, py, 96, h / 2, 96, h / 2, w))
    return _finish(_glow(d, 3.0, 6.0) * 0.8, py, h)


def fence_contested(w=128, h=32):
    px, py = _px(w, h)
    a = np.zeros((h, w), np.float32)
    for x0, x1, k in ((4, 36, 1.0), (44, 52, 0.75), (60, 90, 1.0), (97, 101, 0.6), (108, 120, 0.9)):
        a = np.maximum(a, _glow(_seg_dist(px, py, x0, h / 2, x1, h / 2, w), 3.0, 6.5) * k)
    return _finish(a, py, h)


def fence_pirate(w=128, h=32):
    px, py = _px(w, h)
    a = np.zeros((h, w), np.float32)
    amp = h * 0.2
    zig = [(i * 16.0, h / 2 + (amp if i % 2 else -amp)) for i in range(9)]   # 4 zigs per tile, period 128
    for (x0, y0), (x1, y1) in zip(zig[:-1], zig[1:]):
        a = np.maximum(a, _glow(_seg_dist(px, py, x0, y0, x1, y1, w), 2.2, 5.0))
    # barbs: short ticks crossing each peak
    for i in range(8):
        x, y = zig[i]
        a = np.maximum(a, _glow(_seg_dist(px, py, x - 4, y - 4, x + 4, y + 4, w), 1.6, 3.0) * 0.9)
        a = np.maximum(a, _glow(_seg_dist(px, py, x - 4, y + 4, x + 4, y - 4, w), 1.6, 3.0) * 0.9)
    return _finish(a, py, h)


def _finish(a, py, h):
    a = np.clip(a, 0, 1) * _edge_fade(py, h) ** 0.5
    return T.rgba((1.0, 1.0, 1.0), a.astype(np.float32))


TEXTURES = {'border_ribbon': ribbon, 'border_fence_guarded': fence_guarded, 'border_fence_quiet': fence_quiet,
            'border_fence_contested': fence_contested, 'border_fence_pirate': fence_pirate}


def main():
    os.makedirs(OUT, exist_ok=True)
    out = []
    for name, fn in TEXTURES.items():
        img = fn()
        # tileability check along u: first and last column must continue each other
        seam = float(np.abs(img[:, 0, 3] - img[:, -1, 3]).max())
        p = T.write_png(os.path.join(OUT, name + '.png'), img)
        print(f'BC vfx {name}: {img.shape[1]}x{img.shape[0]}, max alpha {img[..., 3].max():.2f}, '
              f'u-seam step {seam:.3f}')
        out.append(p)
    return out


if __name__ == '__main__':
    main()
