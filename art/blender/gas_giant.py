"""Hero gas giant ("plynny obor", M5b): ring system.

The planet texture itself is `gas_giant` in planets.py (4096x2048).  This
module writes

  public/assets/planets/gas_giant_ring.png        2048x64 RGBA radial profile:
      u = 0 inner edge -> 1 outer edge (constant along v), sRGB colour,
      alpha = ring opacity (gaps = 0)
  public/assets/models/planets/gas_giant_rings.glb
      root `Gas_Giant_Rings`: flat annulus in the planet's equatorial plane
      (glTF XZ, normal +Y), radii RING_INNER..RING_OUTER in PLANET RADII
      (scale the node with the planet radius), 256 segments, UV u = radial
      t, v = angle / 360 deg.  Own material `AF_GasGiantRing` (texture
      above, alpha BLEND, double-sided) - not the palette atlas.

  blender --background --factory-startup --python art/blender/gas_giant.py
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import paths  # noqa: E402
from lib import tex2d as T  # noqa: E402

PL = os.path.join(paths.ROOT, 'public', 'assets', 'planets')
RING_TEX = os.path.join(PL, 'gas_giant_ring.png')
RING_GLB = os.path.join(paths.MODELS, 'planets', 'gas_giant_rings.glb')
RING_INNER, RING_OUTER = 1.28, 2.35
SEGMENTS = 256


def _smooth(t, a, b):
    x = np.clip((t - a) / (b - a), 0, 1)
    return x * x * (3 - 2 * x)


def ring_profile(n=2048, seed=7):
    """Radial colour + opacity, Saturn-like: faint inner C ring, dense bright
    B ring, a clean Cassini division, A ring with an Encke gap, thin outer F."""
    rng = np.random.default_rng(seed)
    t = (np.arange(n) + 0.5) / n
    alpha = np.zeros(n)
    # C ring (faint, translucent)
    alpha += 0.28 * _smooth(t, 0.0, 0.03) * (1 - _smooth(t, 0.17, 0.2))
    # B ring (dense, brightest)
    alpha += 0.92 * _smooth(t, 0.19, 0.23) * (1 - _smooth(t, 0.53, 0.545))
    # A ring
    alpha += 0.7 * _smooth(t, 0.59, 0.61) * (1 - _smooth(t, 0.86, 0.88))
    # Encke gap
    alpha *= 1 - 0.95 * np.exp(-((t - 0.8) / 0.0045) ** 2)
    # F ring
    alpha += 0.55 * np.exp(-((t - 0.95) / 0.004) ** 2)
    # fine ringlet striations (multi-octave 1D noise)
    stri = np.zeros(n)
    for k, amp in ((40, 0.5), (130, 0.3), (420, 0.2)):
        x = np.linspace(0, k, n)
        pts = rng.random(k + 2)
        stri += amp * np.interp(x, np.arange(k + 2), pts)
    stri = (stri - stri.min()) / (stri.max() - stri.min())
    alpha *= 0.7 + 0.45 * stri
    alpha = np.clip(alpha, 0, 1)
    # colour: grey-brown C ring -> cream/gold B -> beige A -> pale F
    stops = [(0.0, (0.42, 0.38, 0.34)), (0.18, (0.55, 0.5, 0.44)), (0.25, (0.86, 0.78, 0.62)),
             (0.4, (0.95, 0.88, 0.72)), (0.53, (0.82, 0.72, 0.56)), (0.6, (0.74, 0.68, 0.6)),
             (0.85, (0.8, 0.75, 0.66)), (1.0, (0.9, 0.88, 0.84))]
    col = np.zeros((n, 3))
    for c in range(3):
        col[:, c] = np.interp(t, [s[0] for s in stops], [s[1][c] for s in stops])
    col *= (0.85 + 0.25 * stri)[:, None]
    return np.clip(col, 0, 1), alpha


def write_ring_texture(h=64):
    col, a = ring_profile()
    n = len(a)
    img = np.zeros((h, n, 4), np.float32)
    img[..., :3] = col[None]
    img[..., 3] = a[None]
    os.makedirs(PL, exist_ok=True)
    T.write_png(RING_TEX, img)
    return RING_TEX


def ring_material():
    m = bpy.data.materials.new('AF_GasGiantRing')
    m.use_backface_culling = False
    try:
        m.surface_render_method = 'BLENDED'
    except Exception:
        m.blend_method = 'BLEND'
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.9
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(RING_TEX, check_existing=True)
    tex.extension = 'EXTEND'
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], b.inputs['Alpha'])
    return m


def build_rings():
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    radii = [RING_INNER + (RING_OUTER - RING_INNER) * k / 4 for k in range(5)]   # 4 radial rows
    rows = [[bm.verts.new((r * math.cos(2 * math.pi * i / SEGMENTS), r * math.sin(2 * math.pi * i / SEGMENTS), 0))
             for i in range(SEGMENTS)] for r in radii]
    for k in range(4):
        for i in range(SEGMENTS):
            j = (i + 1) % SEGMENTS
            f = bm.faces.new((rows[k][i], rows[k][j], rows[k + 1][j], rows[k + 1][i]))
            for loop, (kk, ii) in zip(f.loops, ((k, i), (k, i + 1), (k + 1, i + 1), (k + 1, i))):
                loop[uv].uv = (kk / 4, ii / SEGMENTS)
    me = bpy.data.meshes.new('Gas_Giant_Rings')
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        if p.normal.z < 0:
            p.flip()
    me.materials.append(ring_material())
    ob = bpy.data.objects.new('Gas_Giant_Rings', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def build_all():
    from lib import geo as G
    from lib import export as E
    write_ring_texture()
    G.reset_scene()
    ob = build_rings()
    E.export_glb(ob, RING_GLB)
    return [RING_TEX, RING_GLB]


if __name__ == '__main__':
    for f in build_all():
        print('GASGIANT', f)
    from lib import optimize
    optimize.run(['models'])
