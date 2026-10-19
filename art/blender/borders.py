"""Art batch C4 + Guild Lane buoys (art audit 2026-10-16 §6 C, sectors design
2026-10-18 §2.3 / §5.2): in-flight markers for sector borders and Guild Lanes.
Everything here is RENDER ONLY (scenery, no collision, no sim/save state) and
meant to be INSTANCED along curves computed by code.

Marker frame (Blender; glTF in brackets): origin = the anchor point on the
gameplay plane, the marker rises along +Z (+Y). The border runs along local
+-Y (glTF -+Z): `fence_l` (+Y side) and `fence_r` (-Y side) are EMPTIES at the
emitter tips, their local +X points outward along the border, so code draws the
light fence from one marker's `fence_l` to the next marker's `fence_r`.
Local +X faces INTO the sector whose security the marker announces.

borders/lane_buoy.glb         Guild Lane corridor buoy (Cechova cesta, +-250 u corridor)
borders/border_guarded.glb    Strazeny / Guarded: Guild pylon, green security lamps
borders/border_quiet.glb      Quiet: small calm light marker, pale blue-grey lamp
borders/border_contested.glb  Contested: the Guild pylon scorched and snapped, one flickering amber lamp
borders/border_pirate.glb     Pirate: "Rust markers" scrap totem, red lamp,
                              clan banners Banner_rust / Banner_cauldron / Banner_slantedStar (show ONE)
Manifest: borders/borders.json (also the Guild picket layout and the border VFX textures).
"""
import json
import math
import os
import random

from mathutils import Matrix, Vector

from lib import geo as G
from lib import greebles as GR
import guild as GU
import paths

NAVY, ORANGE = GU.NAVY, GU.ORANGE
OUT = os.path.join(paths.MODELS, 'borders')

# YZ-plane helper: a 2D outline (u, v) drawn on a plane facing +-X, u -> +Y, v -> +Z
_YZ = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def face_prism(name, pts, x0, x1, mat, loc=(0, 0, 0)):
    ob = G.prism(name, pts, x0, x1, mat)
    ob.matrix_basis = Matrix.Translation(loc) @ _YZ
    return ob


def oct_float(name, r, z0, z1, body, band, cap='hull_dark', verts=8):
    h = z1 - z0
    prof = [(z0, 0.0), (z0, r * 0.6), (z0 + h * 0.22, r * 0.96), (z0 + h * 0.4, r), (z0 + h * 0.6, r),
            (z0 + h * 0.78, r * 0.96), (z1, r * 0.62), (z1, 0.0)]
    return G.lathe(name, prof, [0, 1, 2, 3, 4, 5, 6], [cap, body, band, body, band, body, cap], axis='Z',
                   verts=verts, closed=False, smooth=False)


def _finish(st, name, seed, atlas_dir, grime=0.15, rust=0.0, ao=0.5):
    root = G.join(st, name)
    GR.weather(root, random.Random(seed), ao=ao, near=0.3, far=1.4, grime=grime, panel=0.06, under=0.2, soot=0.4,
               rust=rust)
    G.finalize(root, atlas_dir)
    return root


def _fences(root, y, z, x=0.0):
    GU.empty('fence_l', (x, y, z), root, yaw_deg=90)
    GU.empty('fence_r', (x, -y, z), root, yaw_deg=-90)


# ----------------------------------------------------------------------------
# Guild Lane buoy
# ----------------------------------------------------------------------------
def build_lane_buoy(atlas_dir):
    """Corridor buoy along a Guild Lane. +X = along the lane, AWAY from home (the orange
    arrowhead on top points that way). Bold top-down read: navy float inside a light halo
    ring + an orange arrowhead, amber lamp on a short mast."""
    st = [oct_float('Float', 0.5, -0.4, 0.42, NAVY, ORANGE)]
    st.append(G.cyl('Keel', 0.2, 0.6, 'hull_dark', loc=(0, 0, -0.68), verts=8, r2=0.06))
    # halo ring on four struts
    st.append(G.ring_band('Halo', 1.05, 0.9, 0.0, 0.14, 'hull_light', verts=24, top_mat=None, smooth=False))
    for k in range(8):   # navy / orange ticks on the halo top
        a = math.radians(22.5 + 45 * k)
        b = G.box(f'HaloTick{k}', -0.07, 0.07, -0.1, 0.1, 0.0, 0.03, ORANGE if k in (0, 7) else NAVY)
        G.transform(b, loc=(0.975 * math.cos(a), 0.975 * math.sin(a), 0.14), rot=(0, 0, math.degrees(a)))
        st.append(b)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        b = G.box(f'Strut{k}', 0.42, 0.92, -0.04, 0.04, 0.02, 0.1, 'hull_mid')
        G.transform(b, rot=(0, 0, math.degrees(a)))
        st.append(b)
    # orange arrowhead plate across the top (points +X = along the lane, away from home)
    arrow = [(0.88, 0.0), (0.05, 0.62), (0.05, 0.3), (-0.6, 0.3), (-0.6, -0.3), (0.05, -0.3), (0.05, -0.62)]
    st.append(G.prism('Arrow', arrow, 0.42, 0.5, ORANGE, bevel=0.012, seg=1))
    st.append(G.prism('ArrowBase', GU._inset([(0.82, 0.0), (0.05, 0.58), (0.05, -0.58)], -0.04), 0.38, 0.43,
                      'hull_dark'))
    # mast + lamp cage
    st.append(G.cyl('Mast', 0.05, 1.05, 'metal_bare', loc=(-0.25, 0, 0.98), verts=8))
    st.append(G.cyl('LampBase', 0.13, 0.08, 'hull_dark', loc=(-0.25, 0, 1.52), verts=8))
    for k in range(3):
        a = math.radians(60 + 120 * k)
        st.append(G.box(f'Cage{k}', -0.012, 0.012, -0.012, 0.012, 1.55, 1.85, 'trim_black'))
        G.transform(st[-1], loc=(-0.25 + 0.15 * math.cos(a), 0.15 * math.sin(a), 0))
    st.append(G.cyl('LampCap', 0.12, 0.04, 'hull_dark', loc=(-0.25, 0, 1.87), verts=8))
    root = _finish(st, 'Lane_Buoy', 11, atlas_dir, grime=0.1)
    GU.lamp('beacon_0', (-0.25, 0, 1.7), 'light_amber', r=0.12, atlas_dir=atlas_dir, parent=root, col=True)
    GU.empty('glow_0', (-0.25, 0, 1.7), root)
    GU.empty('link_fwd', (1.05, 0, 0.07), root, yaw_deg=0)
    GU.empty('link_back', (-1.05, 0, 0.07), root, yaw_deg=180)
    return root


# ----------------------------------------------------------------------------
# Guarded (Guild pylon) and Contested (the same pylon, damaged)
# ----------------------------------------------------------------------------
PYLON_H = 2.55          # crossbar centre height
ARM = 1.15              # crossbar half length (emitter pod centres)


def _pylon(st, mats, broken=False):
    """Guild pylon body into st. mats: role -> swatch (lets the contested pylon reuse it)."""
    m = mats
    st.append(oct_float('Base', 0.55, -0.35, 0.4, m['body'], m['band']))
    st.append(G.cyl('Keel', 0.22, 0.7, m['dark'], loc=(0, 0, -0.68), verts=8, r2=0.05))
    col = G.cyl('Column', 0.2, PYLON_H - 0.35, m['column'], loc=(0, 0, 0.4 + (PYLON_H - 0.4) / 2), verts=8,
                r2=0.15)
    st.append(col)
    for k, z in enumerate((0.95, 1.55)):
        st.append(G.ring_band(f'ColBand{k}', 0.215, 0.12, z, z + 0.14, m['band'] if k == 0 else m['navy'],
                              verts=8, smooth=False))
    zc = PYLON_H
    if not broken:
        st.append(G.box('Bar', -0.16, 0.16, -ARM, ARM, zc - 0.12, zc + 0.12, m['bar'], bevel=0.03, seg=1))
        st.append(G.box('BarTop', -0.12, 0.12, -ARM + 0.1, ARM - 0.1, zc + 0.12, zc + 0.16, m['navy']))
        ends = (1, -1)
    else:
        # +Y half intact, -Y half snapped and drooping
        st.append(G.box('Bar', -0.16, 0.16, -0.18, ARM, zc - 0.12, zc + 0.12, m['bar'], bevel=0.03, seg=1))
        st.append(G.box('BarTop', -0.12, 0.12, -0.1, ARM - 0.1, zc + 0.12, zc + 0.16, m['navy']))
        stub = G.box('BarStub', -0.15, 0.15, -0.62, 0.0, -0.11, 0.11, m['bar'], bevel=0.02, seg=1)
        stub.matrix_basis = Matrix.Translation((0, -0.18, zc)) @ Matrix.Rotation(math.radians(-28), 4, 'X')
        st.append(stub)
        # torn end: jagged girder ends + a cable hanging down
        tip = Matrix.Translation((0, -0.18, zc)) @ Matrix.Rotation(math.radians(-28), 4, 'X') @ Vector((0, -0.62, 0))
        for k, (dx, dl) in enumerate(((-0.09, 0.22), (0.0, 0.32), (0.09, 0.16))):
            b = G.box(f'Torn{k}', dx - 0.03, dx + 0.03, -dl, 0.0, -0.03, 0.03, 'metal_bare')
            b.matrix_basis = Matrix.Translation(tip) @ Matrix.Rotation(math.radians(-28 - 25 * k), 4, 'X')
            st.append(b)
        pts = [tip + Vector((0.04, 0.0, -0.05)), tip + Vector((0.07, -0.12, -0.5)), tip + Vector((0.02, -0.05, -0.95)),
               tip + Vector((-0.04, 0.1, -1.25))]
        for k in range(len(pts) - 1):
            a, b = pts[k], pts[k + 1]
            d = b - a
            c = G.cyl(f'Cable{k}', 0.025, d.length, 'trim_black', verts=6)
            c.matrix_basis = Matrix.Translation((a + b) / 2) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
            st.append(c)
        ends = (1,)
    for s in ends:
        st.append(G.cyl(f'Pod{s}', 0.2, 0.28, m['dark'], loc=(0, s * ARM, zc), axis='Y', verts=10))
        st.append(G.ring_band(f'PodBand{s}', 0.22, 0.17, -0.04, 0.04, m['band'], loc=(0, s * (ARM - 0.06), zc),
                              axis='Y', verts=10, smooth=False))
    # emblem plate on top of the crossbar centre (reads from above)
    if m.get('emblem'):
        st += GU.drill_emblem('Emblem', 0.0, 0.0, zc + 0.16, s=0.52)
    else:
        # scorched remains of the emblem plate
        st.append(G.box('EmblemScorch', -0.22, 0.22, -0.22, 0.22, zc + 0.16, zc + 0.19, 'scorch'))
    return zc


GUARDED_MATS = dict(body='hull_mid', band=ORANGE, dark='hull_dark', column='hull_light', navy=NAVY, bar='hull_light',
                    emblem=True)
CONTESTED_MATS = dict(body='der_plate', band='der_rust', dark='der_dark', column='der_plate', navy='der_dark',
                      bar='der_plate', emblem=False)


def build_guarded(atlas_dir):
    st = []
    zc = _pylon(st, GUARDED_MATS)
    root = _finish(st, 'Border_Guarded', 21, atlas_dir, grime=0.12)
    for i, s in enumerate((1, -1)):
        GU.lamp(f'beacon_{i}', (0, s * (ARM + 0.17), zc), 'light_green', r=0.15, atlas_dir=atlas_dir, parent=root,
                col=True)
        GU.empty(f'glow_{i}', (0, s * (ARM + 0.17), zc), root)
    _fences(root, ARM + 0.3, zc)
    return root


def build_contested(atlas_dir):
    st = []
    zc = _pylon(st, CONTESTED_MATS, broken=True)
    # scorch + welded patches on the base and column
    for k, (z, a) in enumerate(((0.75, 20), (1.3, 160), (1.9, 250))):
        p = G.box(f'Scorch{k}', 0.0, 0.03, -0.12, 0.12, -0.16, 0.16, 'scorch')
        G.transform(p, loc=(0.19 * math.cos(math.radians(a)), 0.19 * math.sin(math.radians(a)), z), rot=(0, 0, a))
        st.append(p)
    st.append(G.box('Patch', 0.5, 0.58, -0.25, 0.1, -0.1, 0.2, 'hull_mid'))
    root = G.join(st, 'Border_Contested')
    # the whole pylon leans 7 deg (no attitude control any more); bake into the mesh
    root.data.transform(Matrix.Rotation(math.radians(7), 4, 'X') @ Matrix.Rotation(math.radians(-4), 4, 'Y'))
    GR.weather(root, random.Random(31), ao=0.55, near=0.3, far=1.4, grime=0.45, panel=0.1, under=0.25, soot=0.8,
               rust=0.4)
    G.finalize(root, atlas_dir)
    tilt = Matrix.Rotation(math.radians(7), 4, 'X') @ Matrix.Rotation(math.radians(-4), 4, 'Y')
    lp = tilt @ Vector((0, ARM + 0.17, zc))
    GU.lamp('beacon_0', tuple(lp), 'light_amber', r=0.15, atlas_dir=atlas_dir, parent=root, col=True)
    GU.empty('glow_0', tuple(lp), root)
    fl = tilt @ Vector((0, ARM + 0.3, zc))
    fr = tilt @ (Matrix.Translation((0, -0.18, zc)) @ Matrix.Rotation(math.radians(-28), 4, 'X')
                 @ Vector((0, -0.62, 0)))
    GU.empty('fence_l', tuple(fl), root, yaw_deg=90)
    GU.empty('fence_r', tuple(fr), root, yaw_deg=-90)
    return root


# ----------------------------------------------------------------------------
# Quiet: small calm light marker
# ----------------------------------------------------------------------------
def build_quiet(atlas_dir):
    st = [oct_float('Float', 0.36, -0.28, 0.3, 'hull_mid', 'hull_dark')]
    st.append(G.cyl('Keel', 0.14, 0.45, 'hull_dark', loc=(0, 0, -0.5), verts=8, r2=0.04))
    st.append(G.cyl('Mast', 0.06, 1.2, 'hull_mid', loc=(0, 0, 0.9), verts=8, r2=0.045))
    st.append(G.ring_band('MastBand', 0.075, 0.03, 0.75, 0.85, 'accent_titanium_dark', verts=8, smooth=False))
    # horizontal halo ring at the top: a calm circle from above
    st.append(G.ring_band('Halo', 0.52, 0.44, 1.48, 1.54, 'hull_light', verts=20, smooth=False))
    for k in range(3):
        a = math.radians(90 + 120 * k)
        b = G.box(f'Spoke{k}', 0.05, 0.46, -0.02, 0.02, 1.49, 1.53, 'hull_mid')
        G.transform(b, rot=(0, 0, math.degrees(a)))
        st.append(b)
    st.append(G.cyl('LampSeat', 0.1, 0.06, 'hull_dark', loc=(0, 0, 1.53), verts=8))
    root = _finish(st, 'Border_Quiet', 41, atlas_dir, grime=0.08)
    GU.lamp('beacon_0', (0, 0, 1.66), GU.STROBE, r=0.11, atlas_dir=atlas_dir, parent=root, col=True)
    GU.empty('glow_0', (0, 0, 1.66), root)
    _fences(root, 0.52, 1.51)
    return root


# ----------------------------------------------------------------------------
# Pirate: "Hrdzave znacky / Rust markers" scrap totem with clan banners
# ----------------------------------------------------------------------------
TOTEM_BAR = 2.5          # crossbar height
BANNER = dict(y0=-0.45, y1=0.45, z0=1.0, z1=TOTEM_BAR - 0.08, x=0.16, t=0.025)


def _spike(name, base, direction, length, r, mat='pir_gunmetal'):
    d = Vector(direction).normalized()
    c = G.cyl(name, r, length, mat, verts=6, r2=0.005)
    c.matrix_basis = Matrix.Translation(Vector(base) + d * length / 2) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    return c


def _tatter(y0, y1, z0, z1, teeth=5, depth=0.16, seed=0):
    """Banner outline (u = y, v = z) with a tattered (zigzag) bottom edge, CCW."""
    rng = random.Random(seed)
    pts = [(y1, z1), (y0, z1)]
    n = teeth * 2
    for k in range(n + 1):
        u = y0 + (y1 - y0) * k / n
        v = z0 + (0 if k % 2 == 0 else depth * rng.uniform(0.7, 1.3))
        pts.append((u, v))
    return pts


def _banner(name, cloth, emblem, seed, atlas_dir, crown):
    """One clan banner node: cloth with the emblem on BOTH faces + a clan-colour crown cap."""
    b = BANNER
    parts = []
    outline = _tatter(b['y0'], b['y1'], b['z0'], b['z1'], seed=seed)
    # _tatter is clockwise in (u, v) -> reverse for a CCW prism outline
    parts.append(face_prism(name + 'Cloth', list(reversed(outline)), b['x'] - b['t'], b['x'] + b['t'], cloth))
    cy, cz = 0.0, (b['z0'] + b['z1']) / 2 + 0.05
    for side in (1, -1):
        x0 = b['x'] + side * b['t']
        x1 = x0 + side * 0.02
        for k, (pts, mat) in enumerate(emblem):
            pts2 = [(cy + u, cz + v) for u, v in pts]
            if side < 0:     # seen from -X the outline is mirrored: keep it readable from both faces
                pts2 = [(cy - (u - cy), v) for u, v in pts2][::-1]
            parts.append(face_prism(f'{name}E{side}{k}', pts2, min(x0, x1), max(x0, x1), mat))
    # hanging rod
    parts.append(G.cyl(name + 'Rod', 0.03, b['y1'] - b['y0'] + 0.2, 'pir_gunmetal_dark', loc=(b['x'], 0, b['z1'] + 0.03),
                       axis='Y', verts=6))
    # crown cap on the totem top in the clan colour (the top-down clan read)
    parts += crown
    ob = G.join(parts, name)
    GR.weather(ob, random.Random(seed), ao=0.4, near=0.2, far=1.0, grime=0.3, panel=0.08, soot=0.5, rust=0.3)
    G.finalize(ob, atlas_dir)
    return ob


def _crown(name, mat, accent):
    """Clan-colour plate + spikes on the totem top."""
    pts = [(0.32, 0.0), (0.16, 0.3), (-0.2, 0.26), (-0.32, 0.0), (-0.18, -0.28), (0.18, -0.3)]
    out = [G.prism(name + 'Cap', pts, 3.0, 3.08, mat, bevel=0.01, seg=1)]
    for k in range(5):
        a = math.radians(20 + 72 * k)
        out.append(_spike(f'{name}Sp{k}', (0.24 * math.cos(a), 0.24 * math.sin(a), 3.06),
                          (math.cos(a) * 0.6, math.sin(a) * 0.6, 1.0), 0.32, 0.04, accent))
    return out


def _emblem_rust():
    # three claw slashes (Rust)
    out = []
    for k in range(3):
        u = -0.22 + k * 0.2
        out.append(([(u - 0.04, 0.38), (u + 0.03, 0.38), (u + 0.12, -0.36), (u + 0.04, -0.36)][::-1], 'pir_plate_worn'))
    return out


def _emblem_cauldron():
    bowl = [(-0.3, 0.02)] + [(0.3 * math.cos(math.radians(a)), 0.02 - 0.26 * math.sin(math.radians(a)))
                             for a in range(180, 361, 30)][1:]
    bowl = [(-0.32, 0.06), (0.32, 0.06)] + [(0.3 * math.cos(math.radians(a)), -0.26 * math.sin(math.radians(-a)) + 0.02)
                                             for a in range(0, -181, -30)]
    out = [([(-0.34, 0.02), (0.34, 0.02), (0.34, 0.1), (-0.34, 0.1)][::-1], 'kot_iron_dark')]
    out.append((list(reversed([(0.3 * math.cos(math.radians(a)), 0.02 - 0.24 * math.sin(math.radians(a)))
                               for a in range(0, 181, 30)])), 'kot_iron_dark'))
    del bowl
    for k, u in enumerate((-0.16, 0.0, 0.16)):
        h = 0.3 if k == 1 else 0.22
        out.append(([(u - 0.06, 0.13), (u + 0.06, 0.13), (u, 0.13 + h)][::-1], 'kot_furnace'))
    return out


def _emblem_star():
    out = []
    pts = []
    for k in range(8):
        a = math.radians(90 + 45 * k)
        r = 0.44 if k % 2 == 0 else 0.13
        x, y = r * math.cos(a), r * math.sin(a)
        pts.append((x + y * 0.3, y))      # sheared four-point star
    out.append((list(reversed(pts)), 'fuel_yellow'))     # non-metal: metallic gold reads black in space
    out.append(([(-0.34, -0.3), (0.3, 0.32), (0.36, 0.26), (-0.28, -0.36)], 'pir_glow_red'))
    return out


CLANS = {
    'rust': dict(cloth='pir_rust', emblem=_emblem_rust, crown=('pir_rust', 'pir_gunmetal'), light='#ff5a4a'),
    'cauldron': dict(cloth='kot_paint', emblem=_emblem_cauldron, crown=('kot_paint', 'kot_copper'), light='#ff8a3a'),
    'slantedStar': dict(cloth='sst_lacquer', emblem=_emblem_star, crown=('fuel_yellow', 'sst_gold_dark'), light='#ffd36b'),
}


def build_pirate(atlas_dir):
    rng = random.Random(61)
    st = []
    # welded scrap base: mismatched slabs with small random tilts
    for k, (sx, sy, sz, x, y, z, rz) in enumerate(((1.1, 0.9, 0.35, 0.0, 0.0, -0.2, 8), (0.8, 1.0, 0.3, 0.1, -0.05, 0.1, -14),
                                                   (0.55, 0.6, 0.25, -0.15, 0.1, 0.35, 22))):
        b = G.box(f'Slab{k}', -sx / 2, sx / 2, -sy / 2, sy / 2, -sz / 2, sz / 2,
                  ('pir_gunmetal_dark', 'pir_plate_worn', 'pir_rust_dark')[k], bevel=0.02, seg=1)
        G.transform(b, loc=(x, y, z), rot=(rng.uniform(-6, 6), rng.uniform(-6, 6), rz))
        st.append(b)
    st.append(G.cyl('Keel', 0.18, 0.6, 'pir_gunmetal_dark', loc=(0, 0, -0.62), verts=6, r2=0.03))
    # girder spine: two posts + rungs, slightly tilted
    for s in (1, -1):
        st.append(G.box(f'Post{s}', -0.06, 0.06, s * 0.13 - 0.05, s * 0.13 + 0.05, 0.2, 3.02, 'pir_gunmetal',
                        bevel=0.01, seg=1))
    for k in range(6):
        z = 0.55 + k * 0.4
        b = G.box(f'Rung{k}', -0.04, 0.04, -0.15, 0.15, -0.025, 0.025, 'pir_gunmetal_dark')
        G.transform(b, loc=(0, 0, z), rot=(25 if k % 2 else -25, 0, 0))
        st.append(b)
    # welded hull plates on the girder (scrap shield), hazard plate, rust patches
    for k, (z, mat, rot) in enumerate(((0.75, 'pir_plate_worn', 6), (1.35, 'pir_hazard', -9), (1.9, 'pir_rust', 4))):
        b = G.box(f'Plate{k}', -0.13, -0.08, -0.3, 0.3, -0.22, 0.22, mat, bevel=0.01, seg=1)
        G.transform(b, loc=(0, 0, z), rot=(rot, 0, 0))
        st.append(b)
    # crossbar (skewed) with spiked ends
    bar = G.box('Bar', -0.07, 0.07, -0.95, 0.95, -0.07, 0.07, 'pir_gunmetal', bevel=0.012, seg=1)
    G.transform(bar, loc=(0, 0, TOTEM_BAR), rot=(5, 0, 0))
    st.append(bar)
    for s in (1, -1):
        st.append(_spike(f'BarSpike{s}', (0, s * 0.95, TOTEM_BAR + s * 0.08), (0, s, 0.25), 0.42, 0.06))
        st.append(_spike(f'BarSpikeU{s}', (0, s * 0.7, TOTEM_BAR + 0.05), (0, s * 0.3, 1.0), 0.3, 0.035))
    # claw "jaw" brackets around the lamp
    for k in range(3):
        a = math.radians(90 + 120 * k)
        st.append(_spike(f'Claw{k}', (0.18 * math.cos(a), 0.18 * math.sin(a), 2.72),
                         (math.cos(a) * 0.5, math.sin(a) * 0.5, 1.0), 0.32, 0.04, 'pir_rust_dark'))
    st.append(G.cyl('LampSeat', 0.16, 0.12, 'pir_gunmetal_dark', loc=(0, 0, 2.78), verts=6))
    # chains / hanging scrap on the -X face
    for k in range(4):
        b = G.box(f'Chain{k}', -0.02, 0.02, -0.03, 0.03, -0.09, 0.09, 'metal_bare')
        G.transform(b, loc=(-0.12, 0.3, TOTEM_BAR - 0.15 - k * 0.17), rot=(0, 0, 90 * (k % 2)))
        st.append(b)
    st.append(G.box('HangPlate', -0.14, -0.12, 0.18, 0.46, 1.6, 1.82, 'pir_rust'))
    root = G.join(st, 'Border_Pirate')
    GR.weather(root, random.Random(62), ao=0.55, near=0.3, far=1.3, grime=0.45, panel=0.1, under=0.25, soot=0.7,
               rust=0.6)
    G.finalize(root, atlas_dir)
    for i, (clan, c) in enumerate(CLANS.items()):
        crown = _crown(f'Crown_{clan}', c['crown'][0], c['crown'][1])
        b = _banner(f'Banner_{clan}', c['cloth'], c['emblem'](), 70 + i, atlas_dir, crown)
        b.parent = root
        b.hide_render = False
    GU.lamp('beacon_0', (0, 0, 2.95), 'pir_glow_red', r=0.14, atlas_dir=atlas_dir, parent=root, col=True)
    GU.empty('glow_0', (0, 0, 2.95), root)
    _fences(root, 1.2, TOTEM_BAR + 0.1)
    return root


BUILDERS = {'lane_buoy': build_lane_buoy, 'border_guarded': build_guarded, 'border_quiet': build_quiet,
            'border_contested': build_contested, 'border_pirate': build_pirate}


# ----------------------------------------------------------------------------
# manifest
# ----------------------------------------------------------------------------
def _node(rep, name, node):
    for n in rep[name]['nodes']:
        if n['name'] == node:
            return n['pos']
    return None


def write_manifest(rep):
    import guild as GD
    sec = {
        'guarded': dict(file='border_guarded.glb', labelSk='Strážený', labelEn='Guarded', token='--af-ok',
                        color='#6be38a', lamp='light_green', fence='border_fence_guarded.png',
                        lamps={'beacon_0': 'steady slow pulse 0.5 Hz (both ends in phase)',
                               'beacon_1': 'same as beacon_0'},
                        look='Guild pylon: navy/orange float, light column, crossbar with two green emitter pods, '
                             'Cech emblem on the crossbar top (reads from above)'),
        'quiet': dict(file='border_quiet.glb', labelSk='Pokojný', labelEn='Quiet', token='(map border grey-blue)',
                      color='#9fb4cc', lamp='strobe_blue', fence='border_fence_quiet.png',
                      lamps={'beacon_0': 'very slow breathing 0.25 Hz, low intensity (calm)'},
                      look='small grey float, slim mast, horizontal halo ring with a pale blue-grey lamp'),
        'contested': dict(file='border_contested.glb', labelSk='Sporný', labelEn='Contested', token='--af-warn',
                          color='#ffb547', lamp='light_amber', fence='border_fence_contested.png',
                          lamps={'beacon_0': 'irregular flicker (hash-based on/off 40-120 ms), mostly on'},
                          look='the Guild pylon faded, scorched, leaning 7 deg, -Y crossbar half snapped with a '
                               'hanging cable, one amber lamp left'),
        'pirate': dict(file='border_pirate.glb', labelSk='Pirátsky', labelEn='Pirate', token='--af-bad',
                       color='#ff5a4a', lamp='pir_glow_red', fence='border_fence_pirate.png',
                       lamps={'beacon_0': 'slow menacing pulse 0.7 Hz'},
                       banners={k: dict(node=f'Banner_{k}', light=v['light']) for k, v in CLANS.items()},
                       look='"Rust markers": welded scrap totem, girder spine, spiked crossbar, '
                            'claw crown around a red lamp; Banner_<clan> = clan cloth + emblem on both faces + a '
                            'clan-colour crown cap on the top (the top-down clan read). Show exactly ONE banner '
                            '(clan owning the pirate sector; unknown clan -> rust).'),
    }
    markers = {}
    for k, v in sec.items():
        name = v['file'][:-4]
        r = rep[name]
        v.update(tris=r['tris'], size=r['size'], bounds=dict(min=r['min'], max=r['max']),
                 nodes=[n['name'] for n in r['nodes']],
                 fenceL=_node(rep, name, 'fence_l'), fenceR=_node(rep, name, 'fence_r'))
        markers[k] = v
    lane = rep['lane_buoy']
    data = {
        '_schema': {
            'about': 'Render-only sector border + Guild Lane markers (art batch C, sectors design 2026-10-18 §2.3, '
                     '§5.2). glTF axes: +Y up, origin = anchor on the gameplay plane. No collision, no sim state.',
            'markerFrame': 'The border runs along the marker local Z axis (glTF): fence_l sits at -Z, fence_r at +Z '
                           '(see fenceL/fenceR). Local +X faces INTO the sector whose security the marker shows. '
                           'Orient each instance so +X points into that sector and -Z points along the border in the '
                           'direction of the next marker (fence_l(i) -> fence_r(i+1)).',
            'fences': 'fence_l / fence_r are EMPTIES at the emitter tips (their local +X points outward along the '
                      'border). Draw the light fence from marker i fence_l to marker i+1 fence_r (a camera-facing '
                      'ribbon with border_fence_<security>.png, additive, tinted by color, u along the border, '
                      'repeat every fenceRepeat units).',
            'glow': 'glow_<i> EMPTIES = lamp centres for an additive halo sprite (vfx/glow_soft.png, size glowSize, '
                    'lamp colour): at distance 140 the lamps are 1-2 px, the halo keeps the border readable.',
            'lamps': 'beacon_<i> = lamp MESH nodes (clone the material, animate emissiveIntensity) - same as the '
                     'station/trader beacons; the per-security rhythm is in lamps.',
            'spacing': 'Guild border / Rust markers every spacing units along the sector boundary (organic spline, '
                       'never a circle); only where the boundary is within ~600 u of the camera. jitter = random '
                       'offset along the border and yaw wobble per instance (deterministic hash of the position).',
            'colors': 'color = the UI token (src/ui/theme/tokens.css) for the security level - use the same value '
                      'for fences, ribbon and halo tints so the world matches the map legend (sectors §5.1).',
        },
        'security': markers,
        'placement': dict(spacing=[60, 90], jitter=dict(along=8, yawDeg=12), scaleRange=[0.95, 1.1],
                          suggestedY=-0.6, glowSize=2.6, fenceRepeat=6.0, fenceHeightNote='fence emitters sit '
                          '~1.5-2.6 u above the anchor; ships fly at y 0, so the fence runs just above them',
                          visibleRange=900,
                          whichMarker='Place the marker of the sector being ENTERED on each side: along a boundary '
                                      'between A and B put A-markers facing A and B-markers facing B, alternating, '
                                      'or only the more dangerous side (Pirate > Contested > Guarded > Quiet). Spec '
                                      '§5.2: Guild buoys on Guarded borders, Rust markers on Pirate borders; Quiet / '
                                      'Contested markers are optional extras.'),
        'ribbon': dict(file='vfx/border_ribbon.png', size=[256, 64], blending='additive', wrap='u repeat',
                       width=14.0, repeat=40.0, opacity=0.35,
                       notes='soft volumetric haze band lying in the plane (or a low vertical curtain) along the '
                             'boundary spline; v across (core at v 0.5, no hard edges), u along. Tint with the '
                             'security color; scroll u slowly (0.02/s) so it breathes.'),
        'fenceTextures': {k: f'vfx/border_fence_{k}.png' for k in ('guarded', 'quiet', 'contested', 'pirate')},
        'fenceStyle': {'guarded': 'evenly spaced solid dashes (= solid fill on the map)',
                       'quiet': 'sparse soft dots',
                       'contested': 'irregular broken dashes (flicker by scrolling u)',
                       'pirate': 'zigzag barbed-wire line with barbs'},
        'laneBuoy': dict(file='lane_buoy.glb', tris=lane['tris'], size=lane['size'],
                         bounds=dict(min=lane['min'], max=lane['max']), nodes=[n['name'] for n in lane['nodes']],
                         frame='+X = along the Guild Lane, AWAY from home (the orange arrowhead points that way)',
                         placement='on the lane centre line every 120-160 u (the player flying the lane always sees '
                                   '1-2), plus optional pairs on the corridor edges (+-250 u) every 200 u at the same '
                                   'arc length; lamp beacon_0 amber, chase blink along the lane: phase = index * 0.25 s '
                                   '(a slow "runway" sweep outward), period 2 s, on-time 0.35 s',
                         links='link_fwd / link_back EMPTIES on the halo ring: optional faint dashed line to the next '
                               'buoy (border_fence_guarded.png tinted lane color)',
                         color='#f27a2c', token='--af-trim', glowSize=3.0, suggestedY=-0.4),
        'picket': dict(file='../stations/guild_picket.glb', radius=GD.PICKET_R,
                       circles=GD.PICKET_CIRCLES, clearRadius=GD.PICKET_R + 7,
                       tris=rep['guild_picket']['tris'], size=rep['guild_picket']['size'],
                       nodes=[n['name'] for n in rep['guild_picket']['nodes']],
                       dockPort=dict(x=GD.PICKET_R, y=0.0),
                       notes='checkpoint post at Guarded sector entrances / on Guild Lanes (C3). Local frame like '
                             'station_layouts.json (+X = dock direction, +Y = left, grid units). dock_port at '
                             '(R, 0, 0) for a future dockable variant - no arm/cradle yet. Picket_Dish spins around '
                             '+Y (glTF, 0.25 rev/s), Turret_0 yaws (rest aim +X), strobes alternate. If it collides, '
                             'the sim needs a copy of circles.'),
    }
    path = os.path.join(OUT, 'borders.json')
    os.makedirs(OUT, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return path
