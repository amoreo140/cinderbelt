"""VFX textures for the game (public/assets/vfx/).

Numpy-generated sprites (tileable where noted) + Blender Cycles volume
explosion flipbooks.  All PNG: RGBA, straight (un-premultiplied) alpha,
sRGB-encoded colour.  Row 0 of each image = top.

  blender --background --factory-startup --python art/blender/vfx.py -- [--only sprites|explosions]
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

import paths  # noqa: E402
from lib import tex2d as T  # noqa: E402

OUT = os.path.join(paths.ROOT, 'public', 'assets', 'vfx')


def _save(name, img):
    os.makedirs(OUT, exist_ok=True)
    return T.write_png(os.path.join(OUT, name), img)


# ----------------------------------------------------------------------------
# engine flame
# ----------------------------------------------------------------------------
def flame_gradient():
    """64x256: top = nozzle (hot white), bottom = tail (transparent).
    Horizontal profile is soft so it works directly on a ribbon / cone."""
    x, _ = T.grid(64, 256)
    _, v = T.grid(64, 256, centered=False)
    hw = 0.18 + 0.82 * (1 - v) ** 0.55              # flame narrows toward the tail
    prof = np.exp(-(x / hw) ** 2 * 2.2)
    t = v * 0.9 + (1 - prof) * 0.35
    col = T.ramp(t, [(0.0, (1.0, 1.0, 0.97)), (0.18, (1.0, 0.93, 0.6)), (0.4, (1.0, 0.66, 0.2)),
                     (0.65, (0.98, 0.36, 0.08)), (0.9, (0.6, 0.1, 0.04)), (1.0, (0.3, 0.04, 0.02))])
    alpha = prof * (1 - T.smoothstep(0.5, 1.0, v)) * T.smoothstep(0.0, 0.03, v + 0.02)
    return _save('flame_gradient.png', T.rgba(col, alpha))


def flame_noise():
    """256x256 tileable: R = soft fBm, G = finer fBm, B = ridged fBm, A = 1."""
    r = T.normalize(T.fbm(256, 256, 4, 5, seed=1))
    g = T.normalize(T.fbm(256, 256, 8, 4, seed=7))
    b = T.normalize(T.fbm(256, 256, 6, 4, seed=13, ridged=True))
    return _save('flame_noise.png', np.dstack([r, g, b, np.ones_like(r)]))


# ----------------------------------------------------------------------------
# soft sprites
# ----------------------------------------------------------------------------
def smoke_puff():
    x, y = T.grid(256)
    r = np.sqrt(x * x + y * y)
    n = T.normalize(T.fbm(256, 256, 4, 5, seed=21))
    soft = T.smoothstep(1.0, 0.25, r)
    alpha = T.smoothstep(0.18, 0.75, soft * (0.45 + 0.75 * n)) * 0.92
    shade = 0.72 + 0.22 * (n - 0.5) + 0.12 * np.clip(-(x + y) * 0.5, -1, 1)
    rgb = np.dstack([shade, shade, shade * 1.02])
    return _save('smoke_puff.png', T.rgba(np.clip(rgb, 0, 1), alpha))


def shockwave_ring():
    x, y = T.grid(512)
    r = np.sqrt(x * x + y * y)
    r0 = 0.8
    ring = np.exp(-((r - r0) / 0.022) ** 2)
    inner = T.smoothstep(0.35, r0, r) * (r < r0) * 0.28
    outer = np.exp(-((r - r0) / 0.07) ** 2) * 0.35
    a = np.clip(ring + inner + outer, 0, 1) * (1 - T.smoothstep(0.93, 1.0, r))
    return _save('shockwave_ring.png', T.rgba((1, 1, 1), a))


def spark():
    x, y = T.grid(64)
    core = np.exp(-(x / 0.75) ** 2 * 3.0 - (y / 0.07) ** 2)
    glow = np.exp(-(x / 0.9) ** 2 * 2.0 - (y / 0.22) ** 2) * 0.35
    a = np.clip(core + glow, 0, 1) * (1 - T.smoothstep(0.85, 1.0, np.abs(x)))
    return _save('spark.png', T.rgba((1, 1, 1), a))


def glow_soft():
    x, y = T.grid(128)
    r = np.sqrt(x * x + y * y)
    a = np.exp(-r * r * 4.5) * (1 - T.smoothstep(0.75, 1.0, r))
    return _save('glow_soft.png', T.rgba((1, 1, 1), a))


def flare_star():
    x, y = T.grid(256)
    r = np.sqrt(x * x + y * y)
    a = np.exp(-r * r * 60) + np.exp(-r * r * 7) * 0.35
    for ang, length, width in ((0, 0.95, 0.012), (60, 0.55, 0.01), (120, 0.55, 0.01)):
        c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        para = x * c + y * s
        perp = -x * s + y * c
        a += np.exp(-(perp / width) ** 2) * np.exp(-(para / length) ** 2 * 3.0) * 0.9
    a = np.clip(a, 0, 1) * (1 - T.smoothstep(0.9, 1.0, r))
    return _save('flare_star.png', T.rgba((1, 1, 1), a))


def ember():
    x, y = T.grid(32)
    r = np.sqrt(x * x + y * y)
    t = T.smoothstep(0.0, 0.9, r)
    col = T.ramp(t, [(0.0, (1.0, 0.98, 0.85)), (0.35, (1.0, 0.75, 0.3)), (0.7, (1.0, 0.4, 0.08)),
                     (1.0, (0.8, 0.15, 0.03))])
    a = np.exp(-r * r * 5) * (1 - T.smoothstep(0.8, 1.0, r))
    return _save('ember.png', T.rgba(col, np.clip(a * 1.2, 0, 1)))


def bolt():
    """128x32 projectile glow travelling toward +x (head on the right)."""
    x, y = T.grid(128, 32)
    xs = x * 4.0                                    # aspect-correct: 128 x 32 px
    px = np.clip(xs, -2.4, 2.4)
    d = np.sqrt((xs - px) ** 2 + y ** 2)
    core = np.exp(-(d / 0.22) ** 2)
    glow = np.exp(-(d / 0.7) ** 2) * 0.45
    head = 0.45 + 0.55 * T.smoothstep(-1.0, 0.9, x)
    a = np.clip((core + glow) * head, 0, 1) * (1 - T.smoothstep(0.9, 1.0, np.abs(x)))
    a *= 1 - T.smoothstep(0.8, 1.0, np.abs(y))
    return _save('bolt.png', T.rgba((1, 1, 1), a))


def beam():
    """32x64: beam ribbon cross-section along the IMAGE HEIGHT (v), constant
    along the width (u) so it tiles along the beam length."""
    _, y = T.grid(32, 64)
    core = np.exp(-(y / 0.11) ** 2)
    glow = np.exp(-(y / 0.42) ** 2) * 0.55
    a = np.clip(core + glow, 0, 1) * (1 - T.smoothstep(0.85, 1.0, np.abs(y)))
    return _save('beam.png', T.rgba((1, 1, 1), a))


def shield_hex():
    """512x512 tileable hex grid (pointy-top, 7 hexes across, 8 rows down;
    the ~1 % vertical stretch that makes it tile is invisible).  Edge
    distance = Voronoi bisector distance between the two nearest centres."""
    W = 512
    n_x, n_rows = 7, 8
    s3 = math.sqrt(3)
    y, x = np.mgrid[0:W, 0:W].astype(np.float32) + 0.5
    hx = x / W * n_x * s3                    # side = 1 units
    hy = y / W * n_rows * 1.5
    row0 = np.floor(hy / 1.5).astype(int)
    best = [np.full(hx.shape, 1e9, np.float32), np.full(hx.shape, 1e9, np.float32)]
    cell = [np.zeros(hx.shape, int), np.zeros(hx.shape, int)]
    for dr in (-1, 0, 1, 2):
        row = row0 + dr
        odd = np.mod(row, 2)
        col0 = np.floor(hx / s3 - 0.5 * odd).astype(int)
        for dc in (-1, 0, 1, 2):
            col = col0 + dc
            cx = s3 * (col + 0.5 * odd)
            cy = 1.5 * row
            d2 = (hx - cx) ** 2 + (hy - cy) ** 2
            cid = np.mod(col, n_x) * 100 + np.mod(row, n_rows)
            closer = d2 < best[0]
            second = (~closer) & (d2 < best[1])
            best[1] = np.where(closer, best[0], np.where(second, d2, best[1]))
            cell[1] = np.where(closer, cell[0], np.where(second, cid, cell[1]))
            best[0] = np.where(closer, d2, best[0])
            cell[0] = np.where(closer, cid, cell[0])
    edge = (best[1] - best[0]) / (2 * s3)                 # distance to the nearest hex edge (side units)
    dist_px = edge * (W / (n_x * s3))
    line = 1 - T.smoothstep(0.7, 2.0, dist_px)
    h = np.sin(cell[0] * 12.9898 + 7.0) * 43758.5453
    var = 0.55 + 0.45 * (h - np.floor(h))
    glow = (1 - T.smoothstep(0.0, 10.0, dist_px)) * 0.16
    a = np.clip(line * (0.75 + 0.25 * var) + glow * var, 0, 1)
    return _save('shield_hex.png', T.rgba((1, 1, 1), a))


def muzzle_flash():
    """4 frames of 128x128 in a horizontal strip (512x128); flash points +x."""
    frames = []
    rng = np.random.RandomState(5)
    for f in range(4):
        x, y = T.grid(128)
        ox = -0.62
        xx, yy = x - ox, y
        r = np.sqrt(xx * xx + yy * yy)
        ang = np.arctan2(yy, xx)
        scale = (1.0, 0.85, 0.6, 0.35)[f]
        fade = (1.0, 0.85, 0.6, 0.3)[f]
        petals = np.zeros_like(r)
        for a0, L, w in ((0.0, 1.45, 0.16), (0.42 + rng.uniform(-0.1, 0.1), 0.75, 0.13),
                         (-0.42 + rng.uniform(-0.1, 0.1), 0.75, 0.13), (0.9, 0.38, 0.12), (-0.9, 0.38, 0.12)):
            L *= scale * rng.uniform(0.85, 1.1)
            da = np.angle(np.exp(1j * (ang - a0)))
            petals = np.maximum(petals, np.exp(-(da / w) ** 2) * np.clip(1 - r / L, 0, 1))
        core = np.exp(-(r / (0.22 * scale + 0.05)) ** 2)
        inten = np.clip(core + petals * 1.1, 0, 1)
        col = T.ramp(1 - inten, [(0.0, (1.0, 1.0, 0.92)), (0.3, (1.0, 0.86, 0.45)), (0.6, (1.0, 0.55, 0.15)),
                                 (1.0, (0.9, 0.25, 0.05))])
        a = np.clip(inten * 1.3, 0, 1) * fade * (1 - T.smoothstep(0.9, 1.0, np.abs(x)))
        a *= 1 - T.smoothstep(0.9, 1.0, np.abs(y))
        frames.append(T.rgba(col, a))
    return _save('muzzle_flash.png', np.concatenate(frames, axis=1))


def impact_dust():
    """4x4 flipbook (512x512, 128 px frames, row-major from the top-left):
    rocky chips + dust burst, neutral grey (tint by resource colour)."""
    rng = np.random.RandomState(11)
    chips = [(rng.uniform(0, 2 * np.pi), rng.uniform(0.6, 1.05), rng.uniform(0.035, 0.07), rng.uniform(0.55, 0.9))
             for _ in range(18)]
    puffs = [(rng.uniform(0, 2 * np.pi), rng.uniform(0.1, 0.45), rng.uniform(0.25, 0.42)) for _ in range(8)]
    noise = T.normalize(T.fbm(128, 128, 4, 4, seed=3))
    sheet = np.zeros((512, 512, 4), np.float32)
    for f in range(16):
        t = f / 15.0
        x, y = T.grid(128)
        dust_a = np.zeros_like(x)
        for ang, dist, size in puffs:
            cx = math.cos(ang) * dist * (0.35 + 1.1 * t)
            cy = math.sin(ang) * dist * (0.35 + 1.1 * t)
            rr = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / (size * (0.55 + 1.1 * t))
            dust_a = np.maximum(dust_a, np.exp(-rr * rr * 2.5))
        dust_a *= (0.55 + 0.6 * noise) * (1 - t) ** 1.3 * 0.9
        chip_a = np.zeros_like(x)
        for ang, speed, size, grey in chips:
            d = speed * (t ** 0.7) * 0.85
            cx, cy = math.cos(ang) * d, math.sin(ang) * d
            c, s = math.cos(ang), math.sin(ang)
            px, py = (x - cx) * c + (y - cy) * s, -(x - cx) * s + (y - cy) * c
            chip_a = np.maximum(chip_a, np.exp(-((px / (size * 1.8)) ** 2 + (py / size) ** 2) * 2.0) * grey)
        chip_a *= (1 - T.smoothstep(0.6, 1.0, t))
        a = np.clip(np.maximum(dust_a, chip_a * 1.2), 0, 1)
        shade = np.where(chip_a > dust_a, 0.62, 0.86) + 0.08 * (noise - 0.5)
        frame = T.rgba(np.dstack([shade, shade, shade]), a)
        r, c = divmod(f, 4)
        sheet[r * 128:(r + 1) * 128, c * 128:(c + 1) * 128] = frame
    return _save('impact_dust.png', sheet)


SPRITES = [flame_gradient, flame_noise, smoke_puff, shockwave_ring, spark, glow_soft, flare_star, ember,
           bolt, beam, shield_hex, muzzle_flash, impact_dust]


def build_sprites():
    return [f() for f in SPRITES]


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = argv[argv.index('--only') + 1] if '--only' in argv else 'all'
    if only in ('all', 'sprites'):
        for p in build_sprites():
            print('VFX', p)
    if only in ('all', 'explosions'):
        import vfx_explosion
        for p in vfx_explosion.build_all(OUT):
            print('VFX', p)
        # the flipbooks ship as WebP (README §2.9)
        from lib import optimize
        optimize.run(['vfx'])
