"""Post-processing with numpy: EXR -> graded sRGB JPEG + linear Radiance HDR,
plus image I/O helpers and three.js' ACES tone mapping (for previews)."""
import os

import bpy
import numpy as np


# ---------------------------------------------------------------------------
# image I/O  (arrays are H x W x 3, top row first)
# ---------------------------------------------------------------------------
def load_float(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    return buf.reshape(h, w, 4)[::-1, :, :3].copy()


def _to_image(arr, name, float_buffer, colorspace):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=float_buffer)
    img.colorspace_settings.name = colorspace
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[:, :, :3] = arr[::-1]
    img.pixels.foreach_set(rgba.ravel())
    return img


def save_jpeg(arr_srgb, path, quality=95):
    """arr_srgb: display-referred sRGB values in 0..1."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img = _to_image(np.clip(arr_srgb, 0, 1), 'tmp_jpg', False, 'sRGB')
    img.filepath_raw = path
    img.file_format = 'JPEG'
    img.save(filepath=path, quality=quality)
    bpy.data.images.remove(img)


def save_png(arr_srgb, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img = _to_image(np.clip(arr_srgb, 0, 1), 'tmp_png', False, 'sRGB')
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save(filepath=path)
    bpy.data.images.remove(img)


def save_hdr(arr_lin, path):
    """Linear Rec.709 radiance -> Radiance .hdr (RGBE)."""
    # Written directly (flat RGBE scanlines, readable by three's RGBELoader):
    # Blender's Image.save() display-encodes float images, which breaks linearity.
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rgb = np.maximum(arr_lin.astype(np.float64), 0)
    h, w = rgb.shape[:2]
    m = rgb.max(axis=2)
    mant, ex = np.frexp(m)                       # m = mant * 2**ex, mant in [0.5, 1)
    scale = np.where(m > 1e-32, mant * 256.0 / np.maximum(m, 1e-32), 0.0)
    rgbe = np.zeros((h, w, 4), dtype=np.uint8)
    rgbe[..., :3] = np.clip(np.floor(rgb * scale[..., None]), 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(m > 1e-32, ex + 128, 0).astype(np.uint8)
    with open(path, 'wb') as f:
        f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n')
        f.write(f'-Y {h} +X {w}\n'.encode('ascii'))
        f.write(rgbe.tobytes())


# ---------------------------------------------------------------------------
# colour
# ---------------------------------------------------------------------------
def srgb_encode(x):
    x = np.clip(x, 0, None)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def srgb_decode(x):
    return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))


def luminance(x):
    return x[..., 0] * 0.2126 + x[..., 1] * 0.7152 + x[..., 2] * 0.0722


def grade(lin, exposure=1.0, shoulder=1.0, saturation=1.0):
    """Scene-linear -> display-linear.  Exponential shoulder: linear near
    black (keeps faint nebula detail), soft roll-off to white for star cores."""
    x = lin * exposure
    if saturation != 1.0:
        l = luminance(x)[..., None]
        x = np.maximum(l + (x - l) * saturation, 0)
    return (1.0 - np.exp(-x * shoulder)) / shoulder if shoulder > 0 else x


def three_aces(lin, exposure=1.0):
    """Exact port of three.js ACESFilmicToneMapping (r186) + sRGB output."""
    m_in = np.array([[0.59719, 0.07600, 0.02840],
                     [0.35458, 0.90834, 0.13383],
                     [0.04823, 0.01566, 0.83777]], dtype=np.float32)   # GLSL columns
    m_out = np.array([[1.60475, -0.10208, -0.00327],
                      [-0.53108, 1.10813, -0.07276],
                      [-0.07367, -0.00605, 1.07602]], dtype=np.float32)
    c = lin * (exposure / 0.6)
    c = c @ m_in            # row-vector form of  mat3(cols) * v
    a = c * (c + 0.0245786) - 0.000090537
    b = c * (0.983729 * c + 0.4329510) + 0.238081
    c = (a / b) @ m_out
    return srgb_encode(np.clip(c, 0, 1))


# ---------------------------------------------------------------------------
# resampling (equirect-safe: integer box filter keeps the seam intact)
# ---------------------------------------------------------------------------
def box_down(arr, factor):
    h, w, c = arr.shape
    return arr.reshape(h // factor, factor, w // factor, factor, c).mean(axis=(1, 3))


def stats(name, lin):
    l = luminance(lin)
    h = lin.shape[0]
    lower = l[int(h * 0.55):int(h * 0.95)]       # roughly what the game camera sees
    upper = l[:h // 2]
    print(f'[stats] {name}: mean {l.mean():.4f}  median {np.median(l):.4f}  p99 {np.percentile(l, 99):.3f}'
          f'  max {l.max():.2f}  upper-hemi mean {upper.mean():.4f}  game-band mean {lower.mean():.4f}')
