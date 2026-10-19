"""World shader: faint background haze, galaxy band and a multi-layer
procedural starfield (all evaluated on the 3D view direction, so the
panorama is seamless and has no pole pinching by construction)."""
import math

import bpy
from mathutils import Euler, Vector

from .nodes import NB
from . import geom

PX = 2.0 * math.pi / 4096.0      # angular size of one final-panorama pixel (rad)

STAR_COLORS = [  # (pos, linear rgb) - temperature ramp, mostly white/blue-white
    (0.00, (1.00, 0.55, 0.30)),
    (0.12, (1.00, 0.78, 0.55)),
    (0.30, (1.00, 0.93, 0.85)),
    (0.55, (0.88, 0.93, 1.00)),
    (0.80, (0.70, 0.82, 1.00)),
    (1.00, (0.60, 0.72, 1.00)),
]


def _star_layer(nb, rd, up, L, density_mod):
    """One Voronoi star layer.  rd: rotated unit direction.  Returns colour socket."""
    vor = nb.voronoi(rd, L['scale'], randomness=L.get('randomness', 0.92))
    sd = nb.normalize(vor.outputs['Position'])            # star direction on the sphere
    off = nb.vsub(rd, sd)
    chord = nb.length(off)                                  # ~ angular distance (rad)
    rx, ry, rz = nb.separate(vor.outputs['Color'])
    dens = nb.mul(density_mod, L['density']) if density_mod is not None else L['density']
    keep = nb.lt(rx, dens)
    if L.get('radial_max'):
        # drop cells whose feature point lies far off the unit sphere: their
        # region on the sphere is a sliver, which would clip the glow into a polygon
        radial = nb.mul(nb.absf(nb.sub(nb.length(vor.outputs['Position']), 1.0)), L['scale'])
        keep = nb.mul(keep, nb.lt(radial, L['radial_max']))
    mag = nb.mul(nb.pow(ry, L['bpow']), L['bright'])
    mag = nb.mul(mag, keep)
    shape = nb.gauss(chord, L['radius'] * PX)
    # halo / glow / spikes are windowed to a fraction of the Voronoi cell so
    # they never get clipped by a neighbouring cell's border
    cell = 1.0 / L['scale']
    win = nb.sub(1.0, nb.smooth(chord, 0.12 * cell, L.get('window', 0.28) * cell))
    extra = 0.0
    if L.get('halo'):
        h_amp, h_rad = L['halo']
        extra = nb.add(extra, nb.mul(nb.exp(nb.mul(nb.div(chord, h_rad * PX), -1.0)), h_amp))
    if L.get('glow'):
        g_amp, g_rad = L['glow']
        extra = nb.add(extra, nb.mul(nb.gauss(chord, g_rad * PX), g_amp))
    if L.get('spikes'):
        s_amp, s_len, s_wid = L['spikes']
        e1 = nb.normalize(nb.cross(sd, up))
        e2 = nb.cross(sd, e1)
        a = nb.absf(nb.dot(off, e1))
        b = nb.absf(nb.dot(off, e2))
        sp1 = nb.mul(nb.exp(nb.mul(nb.div(a, s_len * PX), -1.0)), nb.gauss(b, s_wid * PX))
        sp2 = nb.mul(nb.exp(nb.mul(nb.div(b, s_len * PX), -1.0)), nb.gauss(a, s_wid * PX))
        # only the brighter stars of the layer get spikes
        sfac = nb.smooth(ry, 0.55, 0.95)
        extra = nb.add(extra, nb.mul(nb.mul(nb.add(sp1, sp2), s_amp), sfac))
    shape = nb.add(shape, nb.mul(extra, win))
    col = nb.ramp(rz, L.get('colors', STAR_COLORS), interp='LINEAR')
    return nb.cscale(col, nb.mul(mag, shape))


def hero_star(nb, d, up, direction, H):
    """Explicit bright star at a fixed direction (core + halo + spikes)."""
    sd = geom.dir_vec(*direction)
    off = nb.vsub(d, tuple(sd))
    chord = nb.length(off)
    shape = nb.gauss(chord, H['radius'] * PX)
    shape = nb.add(shape, nb.mul(nb.exp(nb.mul(nb.div(chord, H['halo'][1] * PX), -1.0)), H['halo'][0]))
    shape = nb.add(shape, nb.mul(nb.gauss(chord, H['glow'][1] * PX), H['glow'][0]))
    e1 = Vector(sd).cross(Vector(up)).normalized()
    e2 = Vector(sd).cross(e1)
    a = nb.absf(nb.dot(off, tuple(e1)))
    b = nb.absf(nb.dot(off, tuple(e2)))
    s_amp, s_len, s_wid = H['spikes']
    sp1 = nb.mul(nb.exp(nb.mul(nb.div(a, s_len * PX), -1.0)), nb.gauss(b, s_wid * PX))
    sp2 = nb.mul(nb.exp(nb.mul(nb.div(b, s_len * PX), -1.0)), nb.gauss(a, s_wid * PX))
    shape = nb.add(shape, nb.mul(nb.add(sp1, sp2), s_amp))
    return nb.cscale(H['color'], nb.mul(shape, H['intensity']))


def build_world(mood):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('Skybox_' + mood['name'])
    sc.world = w
    nt = w.node_tree
    nt.nodes.clear()
    nb = NB(nt)

    tc = nb.node('ShaderNodeTexCoord')
    d = nb.normalize(tc.outputs['Generated'])

    # ---------------- background haze (very faint, large scale) -------------
    H = mood['haze']
    hn = nb.noise(d, scale=H['scale'], detail=3, rough=0.55, distortion=0.4, w=mood['seed'] + 1.0)
    hc = nb.noise(d, scale=H['scale'] * 0.6, detail=2, rough=0.5, w=mood['seed'] + 7.0)
    haze_col = nb.ramp(hc, H['colors'])
    haze = nb.cscale(haze_col, nb.mul(nb.smooth(hn, 0.3, 0.75), H['strength']))
    haze = nb.cadd(haze, H['floor'])

    # ---------------- galaxy band ---------------------------------------------
    G = mood['band']
    n_band = geom.band_normal(G['through'][0], G['through'][1])
    wob = nb.noise(d, scale=2.2, detail=3, w=mood['seed'] + 3.0)
    bdist = nb.add(nb.dot(d, tuple(n_band)), nb.mul(nb.sub(wob, 0.5), G['wobble']))
    band = nb.gauss(bdist, G['width'])
    band_core = nb.gauss(bdist, G['width'] * 0.45)
    # bulge: brighter section of the band
    bulge = nb.gauss(nb.dist(d, tuple(geom.dir_vec(*G['bulge']))), G['bulge_size'])
    cloud = nb.noise(d, scale=G['cloud_scale'], detail=7, rough=0.62, distortion=0.25,
                     w=mood['seed'] + 5.0)
    clump = nb.pow(nb.smooth(cloud, 0.3, 0.8), 1.4)
    glow_amt = nb.mul(nb.add(nb.mul(band, 0.55), nb.mul(band_core, 0.45)), nb.add(0.25, nb.mul(clump, 1.2)))
    glow_amt = nb.mul(glow_amt, nb.add(G['base'], nb.mul(bulge, G['bulge_gain'])))
    # dark dust lane along the band centre
    lane_n = nb.noise(d, scale=G['cloud_scale'] * 1.6, detail=6, rough=0.6, distortion=0.4,
                      w=mood['seed'] + 9.0)
    lane_off = nb.add(bdist, nb.mul(nb.sub(lane_n, 0.5), G['width'] * 0.6))
    lane = nb.mul(nb.gauss(lane_off, G['width'] * G['lane_width']), nb.smooth(lane_n, 0.35, 0.6))
    lane = nb.mul(lane, G['lane_depth'])
    transmit = nb.sub(1.0, lane)
    band_col = nb.ramp(nb.noise(d, scale=3.0, detail=2, w=mood['seed'] + 11.0), G['colors'])
    band_rgb = nb.cscale(band_col, nb.mul(glow_amt, transmit))

    # ---------------- stars ------------------------------------------------------
    rot = mood['star_rotation']
    rn = nb.node('ShaderNodeVectorRotate', rotation_type='EULER_XYZ')
    nb._set(rn.inputs['Vector'], d)
    nb._set(rn.inputs['Rotation'], tuple(math.radians(a) for a in rot))
    rd = rn.outputs[0]
    up = Vector(geom.GAME_UP)
    up.rotate(Euler(tuple(math.radians(a) for a in rot), 'XYZ'))
    density_mod = nb.add(mood['stars_base'], nb.mul(band, mood['stars_band']))
    density_mod = nb.mul(density_mod, nb.sub(1.0, nb.mul(lane, 0.8)))
    stars = None
    for L in mood['star_layers']:
        s = _star_layer(nb, rd, tuple(up), L, density_mod)
        stars = s if stars is None else nb.cadd(stars, s)

    for hs in mood.get('hero_stars', []):
        stars = nb.cadd(stars, hero_star(nb, d, geom.GAME_UP, hs['dir'], hs))

    total = nb.cadd(nb.cadd(haze, band_rgb), stars)
    bg = nb.node('ShaderNodeBackground')
    nb._set(bg.inputs['Color'], total)
    bg.inputs['Strength'].default_value = 1.0
    out = nb.node('ShaderNodeOutputWorld')
    nt.links.new(bg.outputs[0], out.inputs['Surface'])
    return w
