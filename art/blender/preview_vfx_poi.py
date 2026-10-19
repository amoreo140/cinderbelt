"""Contact sheet of the M4/M5a VFX textures (vfx_poi.py) over a dark
background: art/out/previews/m5a-vfx.png.

  blender --background --factory-startup --python art/blender/preview_vfx_poi.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

import paths  # noqa: E402
from lib import render as R  # noqa: E402

FILES = [('nebula_core.png', 1.0), ('nebula_rays.png', 1.0), ('nebula_cloud.png', 1.0),
         ('comet_coma.png', 1.0), ('comet_tail.png', 1.0), ('warden_telegraph.png', 1.0)]


def sheet(out_png):
    W, H = 1600, 900
    bg = np.zeros((H, W, 4), np.float32)
    bg[..., :3] = (0.02, 0.025, 0.04)
    bg[..., 3] = 1
    slots = [(40, 40, 480), (560, 40, 480), (1080, 40, 480), (40, 560, 300), (380, 600, 0), (380, 800, 0)]
    tints = [(1, 1, 1), (0.6, 1.0, 0.55), (0.45, 0.9, 0.6), (1, 1, 1), (1, 1, 1), (0.65, 0.95, 0.35)]
    for (fn, _), (x0, ytop, size), tint in zip(FILES, slots, tints):
        a = R.read_png(os.path.join(paths.VFX, fn))     # rows bottom-up
        h, w, _ = a.shape
        if size:
            k = size / max(h, w)
            ys = (np.arange(int(h * k)) / k).astype(int)
            xs = (np.arange(int(w * k)) / k).astype(int)
            a = a[ys][:, xs]
        else:  # strips: scale to 1180 px wide
            k = 1180 / w
            ys = (np.arange(int(h * k * (0.6 if 'telegraph' in fn else 1.0))) / (k * (0.6 if 'telegraph' in fn else 1.0))).astype(int)
            xs = (np.arange(int(w * k)) / k).astype(int)
            a = a[np.clip(ys, 0, h - 1)][:, np.clip(xs, 0, w - 1)]
        h, w, _ = a.shape
        y0 = H - ytop - h
        reg = bg[y0:y0 + h, x0:x0 + w, :3]
        rgb = a[..., :3] * np.array(tint)
        bg[y0:y0 + h, x0:x0 + w, :3] = np.clip(reg + rgb * a[..., 3:4], 0, 1)     # additive preview
    R.write_png(bg, out_png)


if __name__ == '__main__':
    sheet(os.path.join(paths.PREVIEWS, 'm5a-vfx.png'))
