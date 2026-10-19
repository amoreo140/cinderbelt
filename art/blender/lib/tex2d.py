"""Small numpy toolkit for procedural 2D textures (VFX, UI): periodic
(tileable) gradient noise, fBm, signed-distance helpers and a dependency-free
PNG writer (straight alpha, sRGB-encoded 8-bit)."""
import struct
import zlib

import numpy as np


# ----------------------------------------------------------------------------
# PNG I/O
# ----------------------------------------------------------------------------
def write_png(path, img):
    """img: float array HxWx{3,4} in [0,1], row 0 = TOP of the image."""
    a = np.clip(img, 0.0, 1.0)
    h, w, c = a.shape
    data = (a * 255.0 + 0.5).astype(np.uint8)
    color_type = 6 if c == 4 else 2
    raw = b''.join(b'\x00' + data[y].tobytes() for y in range(h))

    def chunk(tag, payload):
        return (struct.pack('>I', len(payload)) + tag + payload +
                struct.pack('>I', zlib.crc32(tag + payload) & 0xffffffff))
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, color_type, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    return path


def rgba(rgb, alpha):
    """Combine an HxWx3 colour (or a 3-tuple) with an HxW alpha."""
    h, w = alpha.shape
    if not hasattr(rgb, 'shape'):
        rgb = np.broadcast_to(np.array(rgb, np.float32), (h, w, 3))
    return np.concatenate([rgb, alpha[..., None]], -1)


# ----------------------------------------------------------------------------
# coordinates / shapes
# ----------------------------------------------------------------------------
def grid(w, h=None, centered=True):
    """Pixel-centre coordinates in [-1,1] (centered) or [0,1]. y grows DOWN."""
    h = h or w
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    x = (x + 0.5) / w
    y = (y + 0.5) / h
    if centered:
        return x * 2 - 1, y * 2 - 1
    return x, y


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def ramp(t, stops):
    """Colour ramp: stops = [(pos, (r,g,b,a)), ...] sorted by pos."""
    t = np.clip(t, 0.0, 1.0)
    pos = np.array([p for p, _ in stops], np.float32)
    cols = np.array([c for _, c in stops], np.float32)
    out = np.empty(t.shape + (cols.shape[1],), np.float32)
    for k in range(cols.shape[1]):
        out[..., k] = np.interp(t, pos, cols[:, k])
    return out


# ----------------------------------------------------------------------------
# tileable gradient noise
# ----------------------------------------------------------------------------
def _fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def perlin(w, h, px, py, seed=0, offset=(0.0, 0.0)):
    """Periodic 2D Perlin noise on a w x h image with px x py lattice cells
    (tiles seamlessly).  Returns values ~[-1, 1]."""
    rng = np.random.RandomState(seed)
    ang = rng.uniform(0, 2 * np.pi, (py, px))
    gx, gy = np.cos(ang), np.sin(ang)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    fx = (x + 0.5) / w * px + offset[0]
    fy = (y + 0.5) / h * py + offset[1]
    x0 = np.floor(fx).astype(int)
    y0 = np.floor(fy).astype(int)
    tx, ty = fx - x0, fy - y0
    x0m, y0m = x0 % px, y0 % py
    x1m, y1m = (x0 + 1) % px, (y0 + 1) % py

    def dot(ix, iy, dx, dy):
        return gx[iy, ix] * dx + gy[iy, ix] * dy
    n00 = dot(x0m, y0m, tx, ty)
    n10 = dot(x1m, y0m, tx - 1, ty)
    n01 = dot(x0m, y1m, tx, ty - 1)
    n11 = dot(x1m, y1m, tx - 1, ty - 1)
    u, v = _fade(tx), _fade(ty)
    return ((n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v) * 1.41


def fbm(w, h, base, octaves=5, seed=0, gain=0.5, ridged=False):
    """Tileable fBm; base = lattice cells across the image for octave 0."""
    total = np.zeros((h, w), np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        n = perlin(w, h, base * 2 ** o, base * 2 ** o, seed + 17 * o)
        if ridged:
            n = 1.0 - np.abs(n) * 2.0
        total += amp * n
        norm += amp
        amp *= gain
    return total / norm


def normalize(a):
    lo, hi = a.min(), a.max()
    return (a - lo) / max(1e-6, hi - lo)
