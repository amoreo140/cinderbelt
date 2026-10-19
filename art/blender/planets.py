"""Planet textures (M5): equirectangular maps rendered with a Cycles
panoramic camera inside an emissive sphere whose procedural shader is driven
by the view direction -> exact equirectangular projection, seamless in
longitude, poles at the top/bottom.

Outputs (public/assets/planets/; the optimizer post-step converts them to WebP and rewrites
planets.json, art/README.md 2.9):
  <type>_<v>_albedo.jpg     2048x1024 sRGB   (no atmosphere baked in)
  <type>_<v>_normal.png     1024x512 tangent-space (OpenGL, +Y = north) - not for gas giants
  volcanic_<v>_emissive.jpg 2048x1024 sRGB lava glow (black = none)
  clouds_<n>.png            2048x1024 RGBA, white, alpha = cloud density
  planets.json              suggested atmosphere / cloud parameters per planet

  blender --background --factory-startup --python art/blender/planets.py -- [--only textures,models,preview]
"""
import json
import math
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import paths  # noqa: E402
from lib import tex2d as T  # noqa: E402

OUT = os.path.join(paths.ROOT, 'public', 'assets', 'planets')
TMP = os.path.join(paths.OUT, 'tmp_planets')


def _lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# ----------------------------------------------------------------------------
# node helper
# ----------------------------------------------------------------------------
class NB:
    def __init__(self, mat):
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.N, self.L = self.nt.nodes, self.nt.links
        tc = self.N.new('ShaderNodeTexCoord')
        nrm = self.N.new('ShaderNodeVectorMath')
        nrm.operation = 'NORMALIZE'
        self.L.new(tc.outputs['Object'], nrm.inputs[0])
        self.d = nrm.outputs['Vector']
        sep = self.N.new('ShaderNodeSeparateXYZ')
        self.L.new(self.d, sep.inputs[0])
        self.x, self.y, self.z = sep.outputs['X'], sep.outputs['Y'], sep.outputs['Z']
        self.out = self.N.new('ShaderNodeOutputMaterial')
        self.em = self.N.new('ShaderNodeEmission')
        self.L.new(self.em.outputs['Emission'], self.out.inputs['Surface'])

    def link(self, a, b):
        self.L.new(a, b)

    def _in(self, node, idx, v):
        sock = node.inputs[idx]
        if isinstance(v, (int, float)):
            sock.default_value = v
        elif isinstance(v, tuple):
            sock.default_value = v
        else:
            self.L.new(v, sock)

    def math(self, op, a, b=None, clamp=False):
        n = self.N.new('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        self._in(n, 0, a)
        if b is not None:
            self._in(n, 1, b)
        return n.outputs['Value']

    def vmath(self, op, a, b=None, scale=None):
        n = self.N.new('ShaderNodeVectorMath')
        n.operation = op
        self._in(n, 0, a)
        if b is not None:
            self._in(n, 1, b)
        if scale is not None:
            n.inputs['Scale'].default_value = scale
        return n.outputs['Vector'] if op not in ('LENGTH', 'DOT_PRODUCT', 'DISTANCE') else n.outputs['Value']

    def stretch(self, vec, sx, sy, sz):
        return self.vmath('MULTIPLY', vec, (sx, sy, sz))

    def noise(self, vec, scale, detail=6.0, rough=0.55, distortion=0.0, w=None, out='Fac'):
        n = self.N.new('ShaderNodeTexNoise')
        if w is not None:
            n.noise_dimensions = '4D'
            n.inputs['W'].default_value = w
        self.L.new(vec, n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        n.inputs['Distortion'].default_value = distortion
        return n.outputs[out]

    def warp(self, vec, scale=1.5, amount=0.25, seed=0.0):
        c = self.noise(vec, scale, 4, 0.5, w=seed, out='Color')
        off = self.vmath('SUBTRACT', c, (0.5, 0.5, 0.5))
        return self.vmath('ADD', vec, self.vmath('SCALE', off, scale=amount))

    def voronoi(self, vec, scale, feature='F1', out='Distance', rand=1.0):
        n = self.N.new('ShaderNodeTexVoronoi')
        n.feature = feature
        self.L.new(vec, n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale
        n.inputs['Randomness'].default_value = rand
        return n.outputs[out]

    def voronoi2(self, vec, scale, rand=1.0):
        """F1 voronoi -> (distance, per-cell random colour)."""
        n = self.N.new('ShaderNodeTexVoronoi')
        n.feature = 'F1'
        self.L.new(vec, n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale
        n.inputs['Randomness'].default_value = rand
        return n.outputs['Distance'], n.outputs['Color']

    def channel(self, col, ch='Red'):
        n = self.N.new('ShaderNodeSeparateColor')
        self.L.new(col, n.inputs['Color'])
        return n.outputs[ch]

    def wave(self, vec, scale, distortion, detail=4.0, direction='Z'):
        n = self.N.new('ShaderNodeTexWave')
        n.wave_type = 'BANDS'
        n.bands_direction = direction
        self.L.new(vec, n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale
        n.inputs['Distortion'].default_value = distortion
        n.inputs['Detail'].default_value = detail
        return n.outputs['Fac']

    def maprange(self, v, a, b, c=0.0, d=1.0, smooth=False):
        n = self.N.new('ShaderNodeMapRange')
        if smooth:
            n.interpolation_type = 'SMOOTHSTEP'
        self._in(n, 0, v)
        n.inputs['From Min'].default_value = a
        n.inputs['From Max'].default_value = b
        n.inputs['To Min'].default_value = c
        n.inputs['To Max'].default_value = d
        return n.outputs['Result']

    def ramp(self, fac, stops):
        n = self.N.new('ShaderNodeValToRGB')
        cr = n.color_ramp
        (p0, c0), (p1, c1) = stops[0], stops[-1]
        cr.elements[0].position, cr.elements[0].color = p0, (*_lin(c0), 1)
        cr.elements[1].position, cr.elements[1].color = p1, (*_lin(c1), 1)
        for p, c in stops[1:-1]:
            e = cr.elements.new(p)
            e.color = (*_lin(c), 1)
        self.L.new(fac, n.inputs['Fac'])
        return n.outputs['Color']

    def mix(self, fac, a, b, blend='MIX'):
        n = self.N.new('ShaderNodeMix')
        n.data_type = 'RGBA'
        n.blend_type = blend
        self._in(n, 0, fac)
        for idx, v in ((6, a), (7, b)):
            if isinstance(v, str):
                n.inputs[idx].default_value = (*_lin(v), 1)
            else:
                self.L.new(v, n.inputs[idx])
        return n.outputs[2]

    def gray(self, v):
        n = self.N.new('ShaderNodeCombineColor')
        for k in ('Red', 'Green', 'Blue'):
            self._in(n, k, v)
        return n.outputs['Color']

    def show(self, col):
        for l in list(self.em.inputs['Color'].links):
            self.L.remove(l)
        self.L.new(col, self.em.inputs['Color'])


# ----------------------------------------------------------------------------
# planet definitions: each returns {'albedo': color, 'height': float,
# 'emit': color (optional)}
# ----------------------------------------------------------------------------
def rocky_a(b):           # rust-ochre desert world with craters
    w = b.warp(b.d, 1.3, 0.35, 1.0)
    h1 = b.noise(w, 1.6, 9, 0.58)
    cr = b.voronoi(b.vmath('SCALE', b.d, scale=1.0), 7.0, 'F1')
    bowl = b.maprange(cr, 0.0, 0.32, 0.0, 1.0)
    bowl2 = b.math('POWER', bowl, 0.6)
    rim = b.maprange(cr, 0.3, 0.42, 1.0, 0.0, smooth=True)
    craters = b.math('ADD', b.math('MULTIPLY', bowl2, 0.25), b.math('MULTIPLY', rim, 0.12))
    mask = b.maprange(b.noise(b.d, 1.0, 2, 0.5), 0.45, 0.6)
    h = b.math('ADD', b.math('MULTIPLY', h1, 0.8), b.math('MULTIPLY', b.math('SUBTRACT', craters, 0.2), mask))
    col = b.ramp(h, [(0.2, '#4A2620'), (0.38, '#7A3E2A'), (0.5, '#A8603A'), (0.62, '#C98E55'), (0.78, '#E2BB86')])
    streak = b.noise(b.stretch(w, 1, 1, 3), 6.0, 6, 0.6)
    col = b.mix(b.maprange(streak, 0.4, 0.7, 0.0, 0.35), col, '#5A2E22')
    col = b.mix(b.math('MULTIPLY', b.math('SUBTRACT', 1.0, bowl), mask), col, '#5E3527')
    return dict(albedo=col, height=h)


def rocky_b(b):           # temperate world: oceans, continents, polar caps
    w = b.warp(b.d, 1.2, 0.4, 3.0)
    h = b.noise(w, 1.3, 10, 0.6)
    sea = 0.5
    land = b.maprange(h, sea, 0.78)
    ocean = b.ramp(b.maprange(h, 0.3, sea), [(0.0, '#14305E'), (0.7, '#1E5590'), (1.0, '#2E8FA6')])
    landc = b.ramp(land, [(0.0, '#C9B27A'), (0.08, '#6E9A4A'), (0.4, '#4C7A3A'), (0.65, '#7A6A4A'),
                          (0.85, '#8E8A86'), (1.0, '#E8ECF0')])
    is_land = b.maprange(h, sea - 0.004, sea + 0.004)
    col = b.mix(is_land, ocean, landc)
    absz = b.math('ABSOLUTE', b.z)
    cap = b.maprange(b.math('ADD', absz, b.math('MULTIPLY', b.noise(b.d, 4, 4, 0.5), 0.1)), 0.95, 0.98)
    col = b.mix(cap, col, '#EEF4FA')
    hh = b.math('MAXIMUM', h, sea)          # oceans flat in the height map
    return dict(albedo=col, height=hh)


def ice_a(b):             # bright ice shell with blue crevasses
    w = b.warp(b.d, 1.6, 0.3, 5.0)
    h = b.noise(w, 2.2, 7, 0.55)
    cracks = b.voronoi(w, 5.0, 'DISTANCE_TO_EDGE')
    crack = b.maprange(cracks, 0.0, 0.035, 1.0, 0.0)
    cracks2 = b.voronoi(b.vmath('SCALE', w, scale=2.3), 5.0, 'DISTANCE_TO_EDGE')
    crack = b.math('MAXIMUM', crack, b.math('MULTIPLY', b.maprange(cracks2, 0.0, 0.03, 1.0, 0.0), 0.6))
    col = b.ramp(h, [(0.25, '#7FB0DA'), (0.45, '#B9DAF2'), (0.62, '#E4F2FC'), (0.8, '#F7FBFF')])
    col = b.mix(crack, col, '#3C7CC0')
    hh = b.math('SUBTRACT', h, b.math('MULTIPLY', crack, 0.12))
    return dict(albedo=col, height=hh)


def ice_b(b):             # lavender ice world with frozen dark seas
    w = b.warp(b.d, 1.2, 0.45, 7.0)
    h = b.noise(w, 1.5, 8, 0.6)
    seas = b.maprange(h, 0.4, 0.43)
    col = b.ramp(h, [(0.3, '#6E78B8'), (0.45, '#A9A6DA'), (0.6, '#CFD6F2'), (0.78, '#F2F6FF')])
    sea_c = b.ramp(b.noise(w, 4, 4, 0.5), [(0.3, '#1E3E66'), (0.7, '#2E6A86')])
    col = b.mix(b.math('SUBTRACT', 1.0, seas), col, sea_c)
    cracks = b.voronoi(w, 3.5, 'DISTANCE_TO_EDGE')
    col = b.mix(b.math('MULTIPLY', b.maprange(cracks, 0.0, 0.025, 1.0, 0.0), seas), col, '#7C8CC8')
    hh = b.math('MAXIMUM', h, 0.415)
    return dict(albedo=col, height=hh)


def _gas(b, stops, storm_col, storm_dir, seed):
    n_ = math.sqrt(sum(c * c for c in storm_dir))
    storm_dir = tuple(c / n_ for c in storm_dir)
    w = b.warp(b.stretch(b.d, 1.0, 1.0, 1.0), 2.0, 0.12, seed)
    # long turbulent streaks along the bands
    st = b.stretch(w, 1.0, 1.0, 7.0)
    turb = b.noise(st, 2.2, 8, 0.62, distortion=0.6)
    lat = b.math('ADD', b.z, b.math('MULTIPLY', b.math('SUBTRACT', turb, 0.5), 0.2))
    bands = b.wave(b.vmath('MULTIPLY', b.d, (0.0, 0.0, 1.0)), 2.6, 0.0, 0.0)
    fac = b.math('ADD', b.math('MULTIPLY', lat, 0.5), 0.5)
    fac = b.math('ADD', fac, b.math('MULTIPLY', b.math('SUBTRACT', bands, 0.5), 0.06))
    col = b.ramp(fac, stops)
    fine = b.noise(st, 6.0, 6, 0.6)
    col = b.mix(b.maprange(fine, 0.3, 0.8, 0.0, 0.32), col, '#FFFFFF', 'OVERLAY')
    # small white ovals scattered along the bands
    ov = b.voronoi(b.stretch(w, 1.0, 1.0, 2.5), 9.0, 'F1')
    col = b.mix(b.math('MULTIPLY', b.maprange(ov, 0.03, 0.07, 0.8, 0.0, smooth=True),
                       b.maprange(b.noise(b.d, 2.0, 2, 0.5), 0.5, 0.6)), col, '#FFF8EE')
    # great storm: anisotropic distance to a direction on the sphere
    diff = b.vmath('SUBTRACT', b.d, storm_dir)
    dd = b.vmath('LENGTH', b.vmath('MULTIPLY', diff, (1.0, 1.0, 2.0)))
    storm = b.maprange(dd, 0.12, 0.26, 1.0, 0.0, smooth=True)
    ring = b.math('MULTIPLY', b.maprange(dd, 0.22, 0.3, 1.0, 0.0, smooth=True),
                  b.maprange(dd, 0.16, 0.22, 0.0, 1.0, smooth=True))
    swirl = b.noise(b.vmath('SCALE', diff, scale=8.0), 3.0, 4, 0.5)
    col = b.mix(b.math('MULTIPLY', storm, b.maprange(swirl, 0.2, 0.8, 0.6, 1.0)), col, storm_col)
    col = b.mix(b.math('MULTIPLY', ring, 0.5), col, '#FFF4E4')
    return dict(albedo=col, height=None)


def gas_a(b):
    return _gas(b, [(0.0, '#7A4A2A'), (0.12, '#C88A52'), (0.2, '#EAD6B2'), (0.3, '#B86E3E'), (0.38, '#F2E2C2'),
                    (0.47, '#D49A62'), (0.53, '#F6EAD4'), (0.62, '#A85E36'), (0.7, '#EBD2A8'), (0.8, '#C07A48'),
                    (0.9, '#E6CCA2'), (1.0, '#8A5A3A')], '#C8462A', (0.62, -0.55, -0.25), 2.0)


def gas_b(b):
    return _gas(b, [(0.0, '#1E2A5E'), (0.12, '#3A5EA8'), (0.22, '#7FC8D8'), (0.32, '#2E6A9A'), (0.4, '#B6E6EA'),
                    (0.5, '#4C7EC2'), (0.56, '#D8F2F4'), (0.66, '#5A4AA8'), (0.74, '#8AD0DC'), (0.84, '#36548E'),
                    (0.92, '#9AD8E2'), (1.0, '#24306A')], '#1A2456', (-0.5, 0.7, 0.2), 4.0)


def volcanic_a(b):        # dark basalt crust with glowing lava fissures and calderas
    w = b.warp(b.d, 1.4, 0.35, 9.0)
    h = b.noise(w, 1.8, 9, 0.6)
    e1 = b.voronoi(w, 3.2, 'DISTANCE_TO_EDGE')
    e2 = b.voronoi(b.vmath('SCALE', w, scale=2.7), 3.2, 'DISTANCE_TO_EDGE')
    lava = b.math('MAXIMUM', b.maprange(e1, 0.0, 0.03, 1.0, 0.0),
                  b.math('MULTIPLY', b.maprange(e2, 0.0, 0.02, 1.0, 0.0), 0.7))
    lava = b.math('MULTIPLY', lava, b.maprange(b.noise(b.d, 1.2, 3, 0.5), 0.35, 0.55))
    cald = b.voronoi(b.d, 4.0, 'F1')
    caldera = b.maprange(cald, 0.0, 0.06, 1.0, 0.0)
    hot = b.math('MAXIMUM', lava, caldera)
    col = b.ramp(h, [(0.25, '#151210'), (0.45, '#2A2420'), (0.6, '#3E3631'), (0.78, '#6A615A')])
    col = b.mix(hot, col, '#4A1408')
    emit = b.ramp(b.math('MULTIPLY', hot, b.maprange(b.noise(w, 8, 4, 0.5), 0.3, 0.7, 0.7, 1.0)),
                  [(0.0, '#000000'), (0.25, '#5A0E02'), (0.6, '#FF4A0A'), (1.0, '#FFC060')])
    hh = b.math('SUBTRACT', h, b.math('MULTIPLY', hot, 0.1))
    return dict(albedo=col, height=hh, emit=emit)


def volcanic_b(b):        # red-black world with molten lava lakes and crust plates
    w = b.warp(b.d, 1.2, 0.4, 11.0)
    h = b.noise(w, 1.4, 9, 0.6)
    lake = b.maprange(h, 0.44, 0.41)               # 1 inside the lakes
    plates = b.voronoi(b.vmath('SCALE', w, scale=1.0), 9.0, 'DISTANCE_TO_EDGE')
    crust = b.maprange(plates, 0.0, 0.05, 0.0, 1.0)  # 0 at plate seams
    molten = b.math('MULTIPLY', lake, b.math('SUBTRACT', 1.0, b.math('MULTIPLY', crust, 0.75)))
    col = b.ramp(h, [(0.3, '#2A100C'), (0.5, '#4A2218'), (0.65, '#6E3626'), (0.82, '#9A5A3E')])
    col = b.mix(lake, col, '#3A0E06')
    emit = b.ramp(molten, [(0.0, '#000000'), (0.2, '#6A1404'), (0.55, '#FF5A12'), (1.0, '#FFD07A')])
    hh = b.math('MAXIMUM', h, 0.43)
    return dict(albedo=col, height=hh, emit=emit)


# ----------------------------------------------------------------------------
# M5b: new biomes (4 types x 3 biomes) + the hero gas giant
# ----------------------------------------------------------------------------
def _craters(b, vec, scale, radius, depth, rim_h, frac=0.55):
    """Bowl craters on a fraction `frac` of the voronoi cells.  Returns
    (height contribution, crater mask 0..1 (1 = inside the bowl), rim mask)."""
    dist, ccol = b.voronoi2(vec, scale)
    pick = b.maprange(b.channel(ccol, 'Red'), 1.0 - frac - 0.02, 1.0 - frac + 0.02)
    # per-cell size jitter
    rr = b.math('ADD', radius * 0.55, b.math('MULTIPLY', b.channel(ccol, 'Green'), radius * 0.45))
    t = b.math('DIVIDE', dist, rr)                      # 0 centre .. 1 at the rim
    bowl = b.math('POWER', b.maprange(t, 0.0, 1.0), 0.75)
    inside = b.math('MULTIPLY', b.maprange(t, 1.0, 0.85), pick)
    rim = b.math('MULTIPLY', b.math('MULTIPLY', b.maprange(t, 0.82, 1.0, 0.0, 1.0, smooth=True),
                                    b.maprange(t, 1.0, 1.22, 1.0, 0.0, smooth=True)), pick)
    h = b.math('ADD', b.math('MULTIPLY', b.math('MULTIPLY', b.math('SUBTRACT', bowl, 1.0), inside), depth),
               b.math('MULTIPLY', rim, rim_h))
    return h, inside, rim


def rocky_barren(b):      # grey airless regolith: dark maria, crater fields, faint emerald (VZ) mineral flats
    w = b.warp(b.d, 1.4, 0.3, 13.0)
    h0 = b.noise(w, 2.2, 9, 0.6)
    maria = b.maprange(b.noise(b.warp(b.d, 0.9, 0.5, 14.0), 0.9, 3, 0.5), 0.52, 0.6)
    hc1, in1, rim1 = _craters(b, b.d, 3.0, 0.34, 0.22, 0.10, 0.3)
    hc2, in2, rim2 = _craters(b, b.vmath('ADD', b.d, (3.1, 1.7, 0.4)), 8.0, 0.3, 0.12, 0.06, 0.3)
    hc3, in3, rim3 = _craters(b, b.vmath('ADD', b.d, (7.3, 2.2, 5.1)), 20.0, 0.26, 0.06, 0.03, 0.25)
    h = b.math('ADD', b.math('MULTIPLY', h0, 0.55), b.math('MULTIPLY', maria, -0.08))
    h = b.math('ADD', b.math('ADD', h, hc1), b.math('ADD', hc2, hc3))
    col = b.ramp(h0, [(0.25, '#56514A'), (0.42, '#77716A'), (0.56, '#958D82'), (0.7, '#B2AA9C'), (0.85, '#CFC7B8')])
    maria_c = b.ramp(b.noise(w, 5.0, 5, 0.5), [(0.3, '#34343A'), (0.7, '#4A4A50')])
    col = b.mix(b.math('MULTIPLY', maria, 0.85), col, maria_c)
    # fresh crater rims are brighter, floors darker
    rims = b.math('MAXIMUM', rim1, b.math('MAXIMUM', rim2, rim3))
    col = b.mix(b.math('MULTIPLY', rims, 0.3), col, '#E2DCCE')
    floors = b.math('MAXIMUM', in1, b.math('MAXIMUM', in2, in3))
    col = b.mix(b.math('MULTIPLY', floors, 0.12), col, '#2E2C2A')
    # emerald mineral flats (rare earths) + titanium glints along streaks
    mineral = b.maprange(b.noise(b.stretch(w, 1.0, 1.0, 2.0), 3.0, 6, 0.55), 0.62, 0.7)
    mineral = b.math('MULTIPLY', mineral, b.math('SUBTRACT', 1.0, maria))
    col = b.mix(b.math('MULTIPLY', mineral, 0.55), col, '#4E8A68')
    return dict(albedo=col, height=h)


def ice_cryo(b):          # cryovolcanic moon: pale cyan ice, glowing blue "tiger stripe" rifts, plume frost
    w = b.warp(b.d, 1.6, 0.25, 17.0)
    h = b.noise(w, 2.0, 8, 0.55)
    col = b.ramp(h, [(0.3, '#8FC4D2'), (0.48, '#BFE4EA'), (0.65, '#E2F6F6'), (0.82, '#F8FFFF')])
    cracks = b.voronoi(w, 4.5, 'DISTANCE_TO_EDGE')
    fine = b.maprange(cracks, 0.0, 0.02, 0.25, 0.0)
    col = b.mix(fine, col, '#8FB6C8')
    # lineae: long crisscrossing fractures over the whole moon (big warped cells -> long lines),
    # a fraction of them active (glowing cyan plume vents) in regional fields
    sw = b.warp(b.d, 1.1, 0.45, 19.0)
    e1 = b.voronoi(b.stretch(sw, 1.0, 1.0, 0.6), 1.7, 'DISTANCE_TO_EDGE')
    e2 = b.voronoi(b.stretch(b.warp(b.d, 1.4, 0.4, 20.0), 0.7, 1.0, 1.0), 2.6, 'DISTANCE_TO_EDGE')
    l1 = b.maprange(e1, 0.0, 0.012, 1.0, 0.0, smooth=True)
    l2 = b.math('MULTIPLY', b.maprange(e2, 0.0, 0.009, 1.0, 0.0, smooth=True), 0.85)
    line = b.math('MAXIMUM', l1, l2)
    halo = b.math('MAXIMUM', b.maprange(e1, 0.0, 0.05, 1.0, 0.0, smooth=True),
                  b.maprange(e2, 0.0, 0.035, 0.8, 0.0, smooth=True))
    south = b.maprange(b.noise(b.vmath('ADD', b.d, (2.0, 0.5, 1.0)), 1.6, 2, 0.5), 0.48, 0.58, 0.0, 1.0, smooth=True)
    stripe = b.math('MULTIPLY', line, b.math('ADD', 0.35, b.math('MULTIPLY', south, 0.65)))
    col = b.mix(b.math('MULTIPLY', halo, 0.45), col, '#C8A88E')           # mineral-stained ridge flanks
    col = b.mix(b.math('MULTIPLY', b.math('MULTIPLY', halo, south), 0.7), col, '#F8FFFF')   # fresh plume frost
    col = b.mix(stripe, col, '#7A3E2E')
    emit = b.ramp(b.math('MULTIPLY', b.math('MULTIPLY', line, south),
                         b.maprange(b.noise(sw, 9, 3, 0.5), 0.3, 0.7, 0.5, 1.0)),
                  [(0.0, '#000000'), (0.35, '#06304A'), (0.75, '#1EA8E0'), (1.0, '#9CF0FF')])
    hh = b.math('SUBTRACT', h, b.math('ADD', b.math('MULTIPLY', stripe, 0.14), b.math('MULTIPLY', fine, 0.05)))
    return dict(albedo=col, height=hh, emit=emit)


def gas_violet(b):        # stormy violet/rose giant with a pale storm (Kr haze)
    return _gas(b, [(0.0, '#24123A'), (0.11, '#563688'), (0.2, '#C6A6D8'), (0.29, '#7A4A9C'), (0.37, '#EAD6EC'),
                    (0.46, '#9C5AA2'), (0.53, '#F4E6F0'), (0.61, '#6A3A8A'), (0.7, '#D6AED6'), (0.79, '#4A2A72'),
                    (0.89, '#BC92CC'), (1.0, '#20103A')], '#F6ECF4', (-0.3, -0.8, 0.35), 6.0)


def volcanic_sulfur(b):   # Io-like sulfur world: yellow/ochre plains, white frost, black calderas with red halos
    w = b.warp(b.d, 1.3, 0.35, 27.0)
    h = b.noise(w, 1.7, 9, 0.6)
    plains = b.ramp(b.noise(b.warp(b.d, 1.0, 0.5, 28.0), 2.0, 7, 0.62),
                    [(0.28, '#7A4A1C'), (0.38, '#B87A26'), (0.47, '#D8B23A'), (0.55, '#E8D45E'),
                     (0.62, '#F0E6A6'), (0.7, '#D88A34'), (0.8, '#A44A22')])
    frost = b.maprange(b.noise(w, 3.5, 6, 0.55), 0.62, 0.7)
    col = b.mix(b.math('MULTIPLY', frost, 0.75), plains, '#F2EEDC')
    # large red-brown provinces + darker reddish poles (Io-like)
    prov = b.maprange(b.noise(b.warp(b.d, 1.2, 0.4, 33.0), 1.4, 4, 0.5), 0.56, 0.64)
    col = b.mix(b.math('MULTIPLY', prov, 0.7), col, '#A2502A')
    poles = b.maprange(b.math('ABSOLUTE', b.z), 0.55, 0.9, 0.0, 1.0, smooth=True)
    col = b.mix(b.math('MULTIPLY', poles, 0.65), col, '#7A4A30')
    green = b.maprange(b.noise(b.vmath('ADD', w, (5.0, 1.0, 2.0)), 2.6, 5, 0.55), 0.64, 0.7)
    col = b.mix(b.math('MULTIPLY', green, 0.45), col, '#A8B048')
    dist, ccol = b.voronoi2(b.warp(b.vmath('ADD', b.d, (1.3, 4.4, 2.2)), 2.0, 0.15, 29.0), 4.2)
    pick = b.maprange(b.channel(ccol, 'Red'), 0.2, 0.24)
    hot = b.maprange(b.channel(ccol, 'Blue'), 0.45, 0.5)                       # active calderas
    csize = b.math('ADD', 0.06, b.math('MULTIPLY', b.channel(ccol, 'Green'), 0.06))
    cd = b.math('DIVIDE', dist, csize)
    cald = b.math('MULTIPLY', b.maprange(cd, 1.0, 0.8), pick)
    halo = b.math('MULTIPLY', b.math('MULTIPLY', b.maprange(cd, 0.9, 1.4, 0.0, 1.0, smooth=True),
                                     b.maprange(cd, 1.5, 3.0, 1.0, 0.0, smooth=True)), pick)
    halo = b.math('MULTIPLY', halo, b.maprange(b.noise(b.vmath('SCALE', b.d, scale=4.0), 6, 4, 0.5), 0.25, 0.5))
    col = b.mix(b.math('MULTIPLY', halo, 0.85), col, '#B0381A')
    col = b.mix(cald, col, '#16100E')
    # dark lava flows radiating from calderas
    flows = b.maprange(b.noise(b.stretch(w, 1.0, 1.0, 1.8), 5.0, 6, 0.6), 0.66, 0.72)
    col = b.mix(b.math('MULTIPLY', flows, 0.7), col, '#3A2418')
    hot_c = b.math('MULTIPLY', cald, hot)
    emit = b.ramp(b.math('MULTIPLY', hot_c, b.maprange(b.noise(w, 14, 3, 0.5), 0.3, 0.7, 0.6, 1.0)),
                  [(0.0, '#000000'), (0.3, '#5A1004'), (0.7, '#FF5A12'), (1.0, '#FFD07A')])
    hh = b.math('SUBTRACT', h, b.math('ADD', b.math('MULTIPLY', cald, 0.12), b.math('MULTIPLY', flows, 0.03)))
    return dict(albedo=col, height=hh, emit=emit)


def gas_giant(b):         # the hero "plynny obor": pale gold / cream bands, salmon belts, slate poles, storms
    w = b.warp(b.d, 2.2, 0.08, 31.0)
    st = b.stretch(w, 1.0, 1.0, 9.0)
    turb = b.noise(st, 2.4, 10, 0.64, distortion=0.8)
    turb2 = b.noise(b.stretch(w, 1.0, 1.0, 4.0), 5.0, 8, 0.6, distortion=0.4)
    lat = b.math('ADD', b.z, b.math('MULTIPLY', b.math('SUBTRACT', turb, 0.5), 0.16))
    lat = b.math('ADD', lat, b.math('MULTIPLY', b.math('SUBTRACT', turb2, 0.5), 0.05))
    fac = b.math('ADD', b.math('MULTIPLY', lat, 0.5), 0.5)
    col = b.ramp(fac, [(0.0, '#46526E'), (0.035, '#6A7690'), (0.09, '#A8A49A'), (0.16, '#D8C49C'),
                       (0.24, '#A86848'), (0.29, '#EBDDBC'), (0.35, '#C99A68'), (0.40, '#F4EAD2'),
                       (0.45, '#D6B07A'), (0.5, '#F8F0DC'), (0.55, '#B4704A'), (0.6, '#EEDDB6'),
                       (0.66, '#965436'), (0.71, '#E2CCA2'), (0.8, '#C2A880'), (0.88, '#9C9C9A'),
                       (0.955, '#68728C'), (1.0, '#3E4A66')])
    fine = b.noise(st, 7.0, 6, 0.6)
    col = b.mix(b.maprange(fine, 0.3, 0.8, 0.0, 0.28), col, '#FFFFFF', 'OVERLAY')
    # festoons: dark streaks hanging off the equatorial belt
    fest = b.maprange(b.noise(b.stretch(w, 1.0, 1.0, 3.0), 6.0, 5, 0.55), 0.64, 0.7)
    band = b.maprange(b.math('ABSOLUTE', b.math('SUBTRACT', b.z, 0.08)), 0.12, 0.04)
    col = b.mix(b.math('MULTIPLY', b.math('MULTIPLY', fest, band), 0.5), col, '#7A4A36')
    ov = b.voronoi(b.stretch(w, 1.0, 1.0, 2.6), 11.0, 'F1')
    ovmask = b.math('MULTIPLY', b.maprange(b.noise(b.d, 2.0, 2, 0.5), 0.52, 0.6),
                    b.maprange(b.math('ABSOLUTE', b.z), 0.6, 0.45))
    col = b.mix(b.math('MULTIPLY', b.maprange(ov, 0.03, 0.065, 0.75, 0.0, smooth=True), ovmask), col, '#FFF8EC')
    # two storms: a big pale-gold oval in the southern belt + a smaller dark one in the north
    for sdir, scol, size, ring_c in (((0.55, -0.62, -0.42), '#F2D48A', 1.0, '#FFF6E0'),
                                     ((-0.72, 0.38, 0.3), '#6A3A2A', 0.6, '#E8C8A0')):
        n_ = math.sqrt(sum(c * c for c in sdir))
        sdir = tuple(c / n_ for c in sdir)
        diff = b.vmath('SUBTRACT', b.d, sdir)
        dd = b.vmath('LENGTH', b.vmath('MULTIPLY', diff, (1.0, 1.0, 2.3)))
        storm = b.maprange(dd, 0.1 * size, 0.22 * size, 1.0, 0.0, smooth=True)
        ring = b.math('MULTIPLY', b.maprange(dd, 0.2 * size, 0.27 * size, 1.0, 0.0, smooth=True),
                      b.maprange(dd, 0.14 * size, 0.2 * size, 0.0, 1.0, smooth=True))
        swirl = b.noise(b.vmath('SCALE', diff, scale=9.0), 3.0, 4, 0.5)
        col = b.mix(b.math('MULTIPLY', storm, b.maprange(swirl, 0.2, 0.8, 0.55, 1.0)), col, scol)
        col = b.mix(b.math('MULTIPLY', ring, 0.55), col, ring_c)
    return dict(albedo=col, height=None)


# name -> (shader, type, biome, labels, rings, render params, deposits)
# deposits: resource icon ids (public/assets/icons/resources/<id>.png) with relative weights;
# the game rolls depositCount of them per planet with richness 1-3 stars (spec 7.2).
PLANETS = {
    'rocky_arid': (rocky_a, dict(type='rocky', biome='arid', label='Rust desert', labelSk='Púštna', rings=[1, 2],
                                 legacy='rocky_a', atmosphere=dict(color='#E8A070', density=0.35),
                                 clouds=dict(texture='clouds_1', opacity=0.25),
                                 deposits={'iron': 3, 'copper': 2, 'rareEarth': 1})),
    'rocky_temperate': (rocky_b, dict(type='rocky', biome='temperate', label='Temperate ocean world',
                                      labelSk='Oceán a pevnina', rings=[1, 2], legacy='rocky_b',
                                      atmosphere=dict(color='#7FC4FF', density=0.75),
                                      clouds=dict(texture='clouds_2', opacity=0.85),
                                      deposits={'iron': 2, 'copper': 2, 'ice': 2})),
    'rocky_barren': (rocky_barren, dict(type='rocky', biome='barren', label='Barren regolith', labelSk='Pustá skala',
                                        rings=[1, 2, 3], legacy=None,
                                        atmosphere=dict(color='#C8C4BC', density=0.12),
                                        clouds=None,
                                        deposits={'titanium': 3, 'iron': 2, 'rareEarth': 2})),
    'ice_glacier': (ice_a, dict(type='ice', biome='glacier', label='Glacier shell', labelSk='Ľadovcová', rings=[2],
                                legacy='ice_a', atmosphere=dict(color='#BFE8FF', density=0.45),
                                clouds=dict(texture='clouds_1', opacity=0.45),
                                deposits={'ice': 4, 'titanium': 2})),
    'ice_frozen_sea': (ice_b, dict(type='ice', biome='frozen_sea', label='Frozen seas', labelSk='Zamrznuté more',
                                   rings=[2, 3], legacy='ice_b', atmosphere=dict(color='#C8B8FF', density=0.5),
                                   clouds=dict(texture='clouds_2', opacity=0.4),
                                   deposits={'ice': 3, 'copper': 1, 'helium3': 1})),
    'ice_cryo': (ice_cryo, dict(type='ice', biome='cryovolcanic', label='Cryovolcanic moon', labelSk='Kryovulkanická',
                                rings=[2, 3], legacy=None, atmosphere=dict(color='#9CF0FF', density=0.3),
                                clouds=dict(texture='clouds_1', opacity=0.2),
                                deposits={'ice': 3, 'helium3': 2, 'crystal': 1})),
    'gas_amber': (gas_a, dict(type='gas', biome='amber', label='Amber giant', labelSk='Jantárový obor', rings=[3],
                              legacy='gas_a', atmosphere=dict(color='#FFD8A8', density=0.9),
                              clouds=dict(texture='clouds_3', opacity=0.3),
                              deposits={'helium3': 4, 'ice': 1})),
    'gas_azure': (gas_b, dict(type='gas', biome='azure', label='Azure giant', labelSk='Azúrový obor', rings=[3],
                              legacy='gas_b', atmosphere=dict(color='#8FE8FF', density=0.9),
                              clouds=dict(texture='clouds_3', opacity=0.3),
                              deposits={'helium3': 3, 'ice': 2})),
    'gas_violet': (gas_violet, dict(type='gas', biome='violet_storm', label='Violet storm giant',
                                    labelSk='Fialový búrlivý obor', rings=[3], legacy=None,
                                    atmosphere=dict(color='#D8A8FF', density=0.85),
                                    clouds=dict(texture='clouds_3', opacity=0.35),
                                    deposits={'helium3': 3, 'crystal': 2})),
    'volcanic_fissure': (volcanic_a, dict(type='volcanic', biome='fissure', label='Basalt fissures',
                                          labelSk='Puklinová', rings=[3], legacy='volcanic_a',
                                          atmosphere=dict(color='#FF7A4A', density=0.55),
                                          clouds=dict(texture='clouds_1', opacity=0.35),
                                          deposits={'rareEarth': 3, 'iron': 2, 'titanium': 1})),
    'volcanic_lava_sea': (volcanic_b, dict(type='volcanic', biome='lava_sea', label='Lava seas', labelSk='Lávové more',
                                           rings=[3], legacy='volcanic_b',
                                           atmosphere=dict(color='#FF5A3A', density=0.6),
                                           clouds=dict(texture='clouds_2', opacity=0.3),
                                           deposits={'rareEarth': 3, 'copper': 2, 'crystal': 1})),
    'volcanic_sulfur': (volcanic_sulfur, dict(type='volcanic', biome='sulfur', label='Sulfur plains',
                                              labelSk='Sírna', rings=[3], legacy=None,
                                              atmosphere=dict(color='#F0B060', density=0.3),
                                              clouds=dict(texture='clouds_1', opacity=0.15),
                                              deposits={'rareEarth': 4, 'titanium': 1, 'helium3': 1})),
    # the hero gas giant (special body, larger, with a ring system - gas_giant.py builds the rings)
    'gas_giant': (gas_giant, dict(type='gas', biome='giant', label='Gas giant', labelSk='Plynný obor', rings=[3],
                                  legacy=None, atmosphere=dict(color='#FFE2B0', density=0.3),
                                  clouds=None,
                                  deposits={'helium3': 5, 'ice': 1}, size=(4096, 2048))),
}


def cloud_shader(b, kind):
    if kind == 'clouds_1':      # wispy east-west streaks
        w = b.warp(b.d, 1.5, 0.3, 21.0)
        n = b.noise(b.stretch(w, 1.0, 1.0, 4.0), 2.4, 8, 0.62, distortion=0.4)
        dens = b.maprange(n, 0.5, 0.72)
    elif kind == 'clouds_2':    # cumulus fields with clear gaps
        w = b.warp(b.d, 1.2, 0.4, 23.0)
        n = b.noise(w, 4.0, 10, 0.6)
        mask = b.maprange(b.noise(w, 1.2, 3, 0.5), 0.4, 0.6)
        dens = b.math('MULTIPLY', b.maprange(n, 0.48, 0.68), mask)
    else:                       # banded, swirly (gas giants / storms)
        w = b.warp(b.d, 2.5, 0.25, 25.0)
        n = b.noise(b.stretch(w, 1.0, 1.0, 9.0), 1.8, 8, 0.6, distortion=1.0)
        dens = b.math('MULTIPLY', b.maprange(n, 0.52, 0.75), 0.85)
    return b.gray(dens)


# ----------------------------------------------------------------------------
# rendering
# ----------------------------------------------------------------------------
def _scene(w, h, raw):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'OPTIX'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == 'OPTIX'
        sc.cycles.device = 'GPU'
    except Exception:
        pass
    sc.cycles.samples = 16
    sc.cycles.use_denoising = False
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.view_settings.view_transform = 'Raw' if raw else 'Standard'
    cd = bpy.data.cameras.new('Pano')
    cd.type = 'PANO'
    cd.panorama_type = 'EQUIRECTANGULAR'
    cam = bpy.data.objects.new('Pano', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.rotation_euler = (math.radians(90), 0, math.radians(-90))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=10)
    sph = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    # render the inside of the sphere
    sph.data.flip_normals()
    m = bpy.data.materials.new('P')
    sph.data.materials.append(m)
    return sc, m


def _render(sc, path, exr=False):
    s = sc.render.image_settings
    s.file_format = 'OPEN_EXR' if exr else 'PNG'
    s.color_mode = 'RGB'
    if exr:
        s.color_depth = '32'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def _load(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[::-1]        # top row first


def _to_jpg(png, jpg, quality=92):
    img = bpy.data.images.load(png)
    img.file_format = 'JPEG'
    img.save(filepath=jpg, quality=quality)
    bpy.data.images.remove(img)
    os.remove(png)


def normal_from_height(h, strength):
    """h: HxW (top row = north).  Tangent-space OpenGL normal map, x = east
    (increasing u), y = north (up in the image)."""
    H, W = h.shape
    lat = (0.5 - (np.arange(H) + 0.5) / H) * np.pi
    coslat = np.maximum(np.cos(lat), 0.05)[:, None]
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / 2.0 / coslat
    dy = np.zeros_like(h)
    dy[1:-1] = (h[:-2] - h[2:]) / 2.0                # north minus south
    nx, ny = -dx * strength, -dy * strength
    nz = np.ones_like(h)
    n = np.dstack([nx, ny, nz])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return np.dstack([n * 0.5 + 0.5, np.ones_like(h)])


def build_planet(name):
    fn, meta = PLANETS[name]
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(TMP, exist_ok=True)
    files = []
    # albedo (and emissive) in Standard view = sRGB-encoded colours
    W, H = meta.get('size', (2048, 1024))
    sc, m = _scene(W, H, raw=False)
    b = NB(m)
    socks = fn(b)
    b.show(socks['albedo'])
    png = _render(sc, os.path.join(TMP, f'{name}_albedo.png'))
    _to_jpg(png, os.path.join(OUT, f'{name}_albedo.jpg'))
    files.append(f'{name}_albedo.jpg')
    if socks.get('emit') is not None:
        b.show(socks['emit'])
        png = _render(sc, os.path.join(TMP, f'{name}_emissive.png'))
        _to_jpg(png, os.path.join(OUT, f'{name}_emissive.jpg'))
        files.append(f'{name}_emissive.jpg')
    if socks.get('height') is not None:
        sc.view_settings.view_transform = 'Raw'
        sc.render.resolution_x, sc.render.resolution_y = 1024, 512
        b.show(b.gray(socks['height']))
        exr = _render(sc, os.path.join(TMP, f'{name}_height.exr'), exr=True)
        hgt = _load(exr)[..., 0]
        T.write_png(os.path.join(OUT, f'{name}_normal.png'), normal_from_height(hgt, 60.0))
        files.append(f'{name}_normal.png')
    return files


def build_clouds():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(TMP, exist_ok=True)
    out = []
    for kind in ('clouds_1', 'clouds_2', 'clouds_3'):
        sc, m = _scene(2048, 1024, raw=True)
        b = NB(m)
        b.show(cloud_shader(b, kind))
        exr = _render(sc, os.path.join(TMP, kind + '.exr'), exr=True)
        dens = np.clip(_load(exr)[..., 0], 0, 1)
        img = np.dstack([np.ones_like(dens), np.ones_like(dens), np.ones_like(dens), dens])
        T.write_png(os.path.join(OUT, kind + '.png'), img)
        out.append(kind + '.png')
    return out


SCHEMA = {
    'albedo': 'sRGB WebP (lossy q92), equirectangular 2:1 (three.js SphereGeometry UVs), no atmosphere baked in',
    'normal': 'tangent-space lossless WebP, OpenGL (+Y = north / up in the image), linear (NoColorSpace); null for gas',
    'normalScale': 'suggested three.js normalScale',
    'emissive': 'sRGB lossless WebP glow map (lava, cryo rifts): emissiveMap with emissive = white, emissiveIntensity',
    'roughness': 'suggested MeshStandardMaterial roughness',
    'atmosphere': 'fresnel rim shell: color (hex), density 0..1 (rim strength), shellScale (x planet radius), '
                  'power (fresnel exponent); brighter on the lit side',
    'clouds': 'null or {texture (clouds_<n>.webp, white RGB, alpha = density), opacity, shellScale, '
              'speed (longitude scroll, revolutions per minute)}',
    'deposits': 'resource id (icons/resources/<id>.png) -> relative weight; roll depositCount distinct ones, '
                'richness 1-3 stars (x0.6 / x1 / x1.5, spec 7.2)',
    'baseMode': 'ground = base_hub with Hub_Legs; float = base_hub with Hub_Floats (gas planets, see '
                'base_modules.json); gasProbe = the Plynova sonda module is allowed (gas only)',
    'rings': 'world rings (P1-P4) where this biome spawns (spec 5.1)',
    'legacy': 'old file stem of the same texture (renamed in M5b)',
    'ringSystem': 'gas_giant only: models/planets/gas_giant_rings.glb, inner/outer radius in planet radii, '
                  'suggested tilt',
}


def write_meta():
    data = {'_schema': SCHEMA, '_types': {
        'rocky': ['arid', 'temperate', 'barren'], 'ice': ['glacier', 'frozen_sea', 'cryovolcanic'],
        'gas': ['amber', 'azure', 'violet_storm'], 'volcanic': ['fissure', 'lava_sea', 'sulfur'],
        '_special': ['gas_giant']}}
    for name, (_, meta) in PLANETS.items():
        kind = meta['type']
        has_emit = name in ('volcanic_fissure', 'volcanic_lava_sea', 'volcanic_sulfur', 'ice_cryo')
        e = dict(type=kind, biome=meta['biome'], label=meta['label'], labelSk=meta['labelSk'],
                 rings=meta['rings'], albedo=f'{name}_albedo.jpg',
                 normal=None if kind == 'gas' else f'{name}_normal.png',
                 normalScale=None if kind == 'gas' else (0.6 if kind == 'ice' else 0.85),
                 emissive=f'{name}_emissive.jpg' if has_emit else None,
                 emissiveIntensity=(2.0 if name == 'ice_cryo' else 2.5) if has_emit else 0.0,
                 roughness=0.6 if kind == 'gas' else (0.55 if kind == 'ice' else 0.88),
                 atmosphere=dict(color=meta['atmosphere']['color'], density=meta['atmosphere']['density'],
                                 shellScale=1.045 if kind != 'gas' else 1.03, power=2.2),
                 clouds=None if not meta['clouds'] else dict(texture=meta['clouds']['texture'] + '.png',
                                                             opacity=meta['clouds']['opacity'],
                                                             shellScale=1.012,
                                                             speed=0.05 if kind == 'gas' else 0.02),
                 deposits=meta['deposits'], depositCount=[2, 3] if kind == 'gas' else [2, 4],
                 baseMode='float' if kind == 'gas' else 'ground', gasProbe=kind == 'gas',
                 legacy=meta['legacy'])
        if name == 'gas_giant':
            e['size'] = 'x2.5 the radius of a normal planet (suggested)'
            e['ringSystem'] = dict(model='models/planets/gas_giant_rings.glb', texture='gas_giant_ring.png',
                                   inner=1.28, outer=2.35, tiltDeg=16.0,
                                   note='mesh is in planet radii (scale with the planet), lies in the planet '
                                        'equatorial plane (glTF XZ), double-sided, alpha-blended')
        data[name] = e
    with open(os.path.join(OUT, 'planets.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def build_textures(only=None):
    made = []
    for name in PLANETS:
        if only and name not in only:
            continue
        made += build_planet(name)
    if not only:
        made += build_clouds()
    if not only or 'gas_giant' in only:
        import gas_giant
        made += gas_giant.build_all()
    write_meta()
    shutil.rmtree(TMP, ignore_errors=True)
    return made


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    names = argv[argv.index('--planets') + 1].split(',') if '--planets' in argv else None
    for f in build_textures(names):
        print('PLANET', f)
    # ship WebP textures (planets.json is rewritten) and the optimized ring glb (README §2.9)
    from lib import optimize
    optimize.run(['planets', 'models'])
