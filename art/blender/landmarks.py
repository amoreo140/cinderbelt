"""Landmarks (readability work, part 2, research V2): huge scenery objects far
below the gameplay plane that work as a compass in each ring. No mechanics, no collision.

Every landmark is ONE far mesh (AF_Palette atlas + COLOR_0 shading) plus a few child nodes for
cheap animation (blinking lamps, pulsing glyphs, a slow ring) and `glow_<i>` EMPTIES where the
game may put an additive halo sprite (vfx/glow_soft.png) for night readability. Models are built
in MODEL units (about 100-290 across); `landmarks.json` gives the suggested world scale and the
depth below the plane. Front = Blender -Y (glTF +Z) = toward the game camera at yaw 0.

  guild_relay.glb      ring 1  old Guild relay mast: lattice spire, hub drum with orange belts and
                               a sector marker on the roof, four solar wings (one broken), dish,
                               red/amber crown lamps
  rust_ring_shard.glb  ring 2  bottom section of a huge upright broken ring: a curved band whose lit
                               habitat floor faces the camera, rim walls with pirate red lamps,
                               jagged burnt ends with girders, a snapped spoke
  crystal_spire.glb    ring 3  crystal wall: two rows of violet crystal prisms leaning apart from a
                               glowing teal cleft, slate ridge with teal fissures, floating shards
  dead_forge.glb       ring 4  "Vyhasnuta vyhen": a dead star cinder (ember crack network) in a
                               broken Forge-smith claw cage + segmented bronze ring
  echo_column.glb      Echo    vertical light column for the Echo beacons (crossed quads,
                               own additive material, vfx/echo_column.png)

  blender --background --factory-startup --python art/blender/landmarks.py -- [--only a,b] [--no-optimize]
"""
import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector, noise  # noqa: E402

import paths  # noqa: E402
from lib import export as E  # noqa: E402
from lib import geo as G  # noqa: E402
from lib import materials as M  # noqa: E402
from lib import palette as P  # noqa: E402
from lib import tex2d as T  # noqa: E402

OUT = os.path.join(paths.MODELS, 'landmarks')
COLUMN_TEX = os.path.join(paths.VFX, 'echo_column.png')


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def _clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def bar(name, p0, p1, w, mat, h=None):
    """Box beam from p0 to p1 with a w x h section."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    h = w if h is None else h
    ob = G.box(name, 0.0, d.length, -w / 2, w / 2, -h / 2, h / 2, mat)
    q = Vector((1, 0, 0)).rotation_difference(d.normalized())
    ob.data.transform(Matrix.Translation(p0) @ q.to_matrix().to_4x4())
    return ob


def octa(name, r, h, mat, loc=(0, 0, 0), rot=(0, 0, 0)):
    bm = bmesh.new()
    vs = [bm.verts.new((r * math.cos(math.radians(a)), r * math.sin(math.radians(a)), 0)) for a in (0, 90, 180, 270)]
    top = bm.verts.new((0, 0, h))
    bot = bm.verts.new((0, 0, -h * 0.8))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((vs[i], vs[j], top))
        bm.faces.new((vs[j], vs[i], bot))
    bmesh.ops.transform(bm, matrix=Matrix.Translation(loc) @ G._euler(rot), verts=bm.verts)
    ob = G.obj_from_bm(name, bm, [mat], grad=lambda v: 0.5)
    G.set_smooth(ob, False)
    return ob


def loft(name, sections, mat_keys, face_mat=None, cap_mat=0, caps=True):
    """Closed loft through sections (equal-length lists of Vectors).
    face_mat(i_section, k_edge) -> index into mat_keys (default 0)."""
    bm = bmesh.new()
    rows = [[bm.verts.new(p) for p in sec] for sec in sections]
    n = len(sections[0])
    for i, (A, B) in enumerate(zip(rows[:-1], rows[1:])):
        for k in range(n):
            j = (k + 1) % n
            f = bm.faces.new((A[k], A[j], B[j], B[k]))
            f.material_index = face_mat(i, k) if face_mat else 0
    if caps:
        for row, rev in ((rows[0], True), (rows[-1], False)):
            f = bm.faces.new(list(reversed(row)) if rev else row)
            f.material_index = cap_mat
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    ob = G.obj_from_bm(name, bm, mat_keys)
    G.set_smooth(ob, False)
    return ob


def lamp(name, r, mat, loc):
    """Big faceted lamp (a sphere with 8 x 5 facets) - reads as a dot from far away."""
    return G.ellipsoid(name, r, r, r, mat, loc=loc, seg=8, rings=5, smooth=False)


def vc_shade(ob, rng, z0, z1, floor=0.55, jitter=0.14, grime=0.0, scale=12.0, under=0.78):
    """COLOR_0: height gradient (darker toward z0), per-face facet jitter, optional grime
    blotches, darker undersides. Emissive swatches stay at 1 (never darkened)."""
    me = ob.data
    keys = [s.material.get('palette_key') if s.material else None for s in ob.material_slots]
    emis = [bool(k and P.BY_KEY[k].emit) for k in keys]
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    off = Vector([rng.uniform(-60, 60) for _ in range(3)])
    for poly in me.polygons:
        if poly.material_index < len(emis) and emis[poly.material_index]:
            for li in poly.loop_indices:
                attr.data[li].color = (1, 1, 1, 1)
            continue
        f = 1.0 - rng.uniform(0.0, jitter)
        u = under if poly.normal.z < -0.5 else 1.0
        for li in poly.loop_indices:
            p = me.vertices[me.loops[li].vertex_index].co
            h = _clamp((p.z - z0) / (z1 - z0))
            k = (floor + (1 - floor) * h) * f * u
            if grime:
                n = noise.fractal(p / scale + off, 0.6, 2.0, 3)
                k *= 1.0 - grime * _clamp((n + 0.1) * 1.6)
            k = max(0.2, min(1.0, k))
            attr.data[li].color = (k, k, k * 0.98, 1.0)
    me.color_attributes.active_color = attr


def white_vc(ob):
    """Plain white COLOR_0 (child nodes of a vertex-coloured asset)."""
    me = ob.data
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for d in attr.data:
        d.color = (1, 1, 1, 1)
    me.color_attributes.active_color = attr


def finish(objs, name, atlas_dir, rng=None, shade=None):
    ob = G.join(objs, name)
    if shade is not None:
        vc_shade(ob, rng, **shade)
    else:
        white_vc(ob)
    G.finalize(ob, atlas_dir)
    return ob


def glyph_dashes(name, pts, w, mat_long='kov_ember', mat_short='ember', lift=None):
    """Forge-smith long-short-short dash rhythm along a polyline (list of (point, normal))."""
    out = []
    pattern = (0.10, 0.04, 0.04)
    gaps = (0.035, 0.035, 0.08)
    # arc-length parametrisation
    L = [0.0]
    for a, b in zip(pts[:-1], pts[1:]):
        L.append(L[-1] + (b[0] - a[0]).length)
    total = L[-1]

    def at(s):
        for i in range(len(L) - 1):
            if L[i + 1] >= s:
                t = (s - L[i]) / max(1e-6, L[i + 1] - L[i])
                return pts[i][0].lerp(pts[i + 1][0], t), pts[i][1].lerp(pts[i + 1][1], t).normalized()
        return pts[-1]

    s, k = 0.04 * total, 0
    while s < 0.96 * total:
        ln = pattern[k % 3] * total
        e = min(0.96 * total, s + ln)
        (pa, na), (pb, nb) = at(s), at(e)
        lift_ = w * 0.4 if lift is None else lift
        out.append(bar(f'{name}{k}', pa + na * lift_, pb + nb * lift_, w,
                       mat_long if k % 3 == 0 else mat_short))
        s = e + gaps[k % 3] * total
        k += 1
    return out


def _bounds(objs):
    pts = []
    for o in objs:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        pts += [mw @ v.co for v in o.data.vertices]
    mn = Vector([min(p[i] for p in pts) for i in range(3)])
    mx = Vector([max(p[i] for p in pts) for i in range(3)])
    return mn, mx


# ----------------------------------------------------------------------------
# ring 1: old Guild relay mast
# ----------------------------------------------------------------------------
def build_guild_relay(atlas_dir, seed=11):
    rng = random.Random(seed)
    st, beacons, glows = [], [], []
    # octagonal core mast + four longerons + sparse X bracing (lattice reads as a mast, not noise)
    st.append(G.cyl('Mast', 1.8, 104, 'der_plate', loc=(0, 0, -6), verts=8, smooth=False))
    corners = [(3.4 * math.cos(math.radians(45 + 90 * i)), 3.4 * math.sin(math.radians(45 + 90 * i)))
               for i in range(4)]
    for i, (x, y) in enumerate(corners):
        st.append(bar(f'Lon{i}', (x, y, -52), (x, y, 44), 0.8, 'der_dark'))
    for lvl in range(9):
        z = -50 + lvl * 10.5
        for i in range(4):
            (x0, y0), (x1, y1) = corners[i], corners[(i + 1) % 4]
            st.append(bar(f'Br{lvl}{i}', (x0, y0, z), (x1, y1, z + 10.5), 0.4, 'der_dark'))
            st.append(bar(f'Rg{lvl}{i}', (x0, y0, z), (x1, y1, z), 0.45, 'hull_dark'))
    for z in (-34, -18, 27, 38):     # orange Guild belts on the core
        st.append(G.cyl(f'Belt{z}', 2.25, 2.6, 'accent_iron', loc=(0, 0, z), verts=8, smooth=False))
    # hub drum (wide, readable from above) with an orange belt and a window ring
    st.append(G.lathe('Hub', [(4, 0), (4, 7.5), (6, 12), (16, 12), (17.2, 11.2), (17.2, 0)],
                      [0, 0, 1, 1, 2, 2], ['hull_dark', 'der_plate', 'hull_mid'], verts=16, smooth=False))
    # Guild marker on the hub roof: 8 wedges alternating trim orange / white around the mast
    for k in range(8):
        a0_, a1_ = 2 * math.pi * k / 8 + 0.03, 2 * math.pi * (k + 1) / 8 - 0.03
        pts = [(2.6 * math.cos(a0_), 2.6 * math.sin(a0_))] + \
            [(10.4 * math.cos(a0_ + (a1_ - a0_) * t / 3), 10.4 * math.sin(a0_ + (a1_ - a0_) * t / 3)) for t in range(4)] + \
            [(2.6 * math.cos(a1_), 2.6 * math.sin(a1_))]
        st.append(G.prism(f'Mark{k}', pts, 17.1, 17.6, 'accent_iron' if k % 2 == 0 else 'hull_white'))
    st.append(G.ring_band('HubBelt', 12.25, 11.4, 8.4, 11.2, 'accent_iron', verts=16, smooth=False))
    for k in range(16):
        a = 2 * math.pi * (k + 0.5) / 16
        c = Vector((11.9 * math.cos(a), 11.9 * math.sin(a), 14.6))
        t = Vector((-math.sin(a), math.cos(a), 0))
        st.append(bar(f'Win{k}', c - t * 1.1, c + t * 1.1, 0.5, 'window_warm', h=1.0))
    # four solar wings (X seen from the camera); wing 2 lost its tip and the middle panel hangs
    for i in range(4):
        a = math.radians(45 + 90 * i)
        rad, tan = Vector((math.cos(a), math.sin(a), 0)), Vector((-math.sin(a), math.cos(a), 0))
        st.append(bar(f'Boom{i}', rad * 10 + Vector((0, 0, 12.5)), rad * (62 if i != 2 else 40) + Vector((0, 0, 12.5)),
                      1.2, 'hull_dark'))
        for s in range(3):
            if i == 2 and s == 2:
                continue
            r0, r1 = 15 + s * 15.5, 28.5 + s * 15.5
            loc = rad * ((r0 + r1) / 2) + Vector((0, 0, 12.5))
            pan = G.prism(f'Panel{i}{s}', G.chamfer_rect(-(r1 - r0) / 2, (r1 - r0) / 2, -5.4, 5.4, 0.8), -0.35, 0.35,
                          'hull_mid', top_mat='solar_cell')
            tilt = 26 if (i == 2 and s == 1) else rng.uniform(-3, 3)
            pan.data.transform(Matrix.Translation(loc) @ Matrix.Rotation(a, 4, 'Z') @
                               Matrix.Rotation(math.radians(tilt), 4, 'X'))
            st.append(pan)
            if not (i == 2 and s == 1):     # spar across the panel (frame line visible from far away)
                st.append(bar(f'Spar{i}{s}', loc - tan * 5.6 + Vector((0, 0, 0.45)),
                              loc + tan * 5.6 + Vector((0, 0, 0.45)), 0.55, 'hull_dark'))
        tip = rad * (62 if i != 2 else 40) + Vector((0, 0, 12.5))
        beacons.append(lamp(f'TipLamp{i}', 1.3, 'light_red' if i % 2 else 'light_green', tip))
    # upper equipment: dish on a yoke, tilted toward the camera
    st.append(G.lathe('Dish', [(0, 0), (0.9, 3.2), (2.4, 6.4), (4.4, 9.2), (4.9, 9.4), (3.2, 6.4), (1.6, 3.2),
                               (0.8, 0)], [0, 0, 0, 1, 2, 2, 2, 2], ['hull_mid', 'accent_iron', 'hull_light'],
                      loc=(0, -3.0, 46), verts=14, smooth=False, rot=(38, 0, 0)))
    st.append(bar('Yoke', (0, 0, 42), (0, -2.0, 46.5), 1.0, 'hull_dark'))
    st.append(G.cyl('Feed', 0.35, 7.0, 'hull_dark', loc=(0, -5.2, 48.8), verts=6, smooth=False))
    st.append(G.lathe('Dish2', [(0, 0), (0.6, 2.2), (1.6, 4.0), (1.9, 4.2), (1.0, 2.2), (0.4, 0)],
                      [0, 0, 1, 2, 2, 2], ['hull_mid', 'accent_iron', 'hull_light'],
                      loc=(4.6, 3.0, 30), verts=10, smooth=False, rot=(-30, 50, 0)))
    # crown: spire, ring of big red lamps, amber top lamp
    st.append(G.cyl('Spire', 1.2, 22, 'hull_dark', loc=(0, 0, 56), verts=8, r2=0.25, smooth=False))
    st.append(G.ring_band('Crown', 6.0, 4.2, 47.2, 48.6, 'hull_dark', verts=12, smooth=False))
    for k in range(6):
        a = 2 * math.pi * k / 6
        beacons.append(lamp(f'Crown{k}', 1.25, 'light_red', (5.1 * math.cos(a), 5.1 * math.sin(a), 49.9)))
    beacons.append(lamp('TopLamp', 2.0, 'light_amber', (0, 0, 67.5)))
    glows.append(((0, 0, 67.5), 'amber'))
    # lower drum with radiator fins + three down antennas with red tips
    st.append(G.lathe('LowDrum', [(-34, 0), (-34, 4.5), (-32, 6.5), (-24, 6.5), (-22, 4.5), (-22, 0)],
                      [0, 0, 1, 0, 0, 0], ['hull_dark', 'der_plate'], verts=12, smooth=False))
    for i in range(4):
        a = math.radians(90 * i)
        rad = Vector((math.cos(a), math.sin(a), 0))
        fin = G.box(f'Fin{i}', 6.0, 19.0, -0.35, 0.35, -32.5, -23.5, 'hull_light')
        fin.data.transform(Matrix.Rotation(a, 4, 'Z'))
        st.append(fin)
        st.append(bar(f'FinRib{i}', rad * 6 + Vector((0, 0, -28)), rad * 19 + Vector((0, 0, -28)), 0.6, 'accent_iron'))
    for i in range(3):
        a = math.radians(90 + 120 * i)
        foot = Vector((3.0 * math.cos(a), 3.0 * math.sin(a), -52))
        tip = Vector((9.0 * math.cos(a), 9.0 * math.sin(a), -80))
        st.append(bar(f'Ant{i}', foot, tip, 0.6, 'hull_dark'))
        beacons.append(lamp(f'AntLamp{i}', 1.0, 'light_red', tip))
    root = finish(st, 'Guild_Relay', atlas_dir, rng, shade=dict(z0=-80, z1=68, floor=0.6, grime=0.35, scale=14))
    bea = finish(beacons, 'Relay_Beacons', atlas_dir)
    bea.parent = root
    for i, (loc, _) in enumerate(glows):
        e = G.empty(f'glow_{i}', loc=loc, size=3)
        e.parent = root
    return root


# ----------------------------------------------------------------------------
# ring 2: shard of a broken megastructure ring (rust pirate territory)
# ----------------------------------------------------------------------------
# The shard is the BOTTOM section of a huge ring standing upright (ring axis = Y): a curved band
# whose inner floor faces up toward the game camera - a bowl ("smile") with a lit habitat floor,
# rim walls with pirate lamps, jagged burnt ends rising toward the camera and a snapped spoke.
SHARD_R = 120.0
SHARD_HALF = 52.0          # degrees each side of the bottom of the ring
SHARD_W = 24.0             # half width of the band along the ring axis
SHARD_PROFILE = [(6.0, -SHARD_W), (6.0, SHARD_W), (-9.0, SHARD_W), (-9.0, SHARD_W - 3.5), (0.0, SHARD_W - 3.5),
                 (0.0, -(SHARD_W - 3.5)), (-9.0, -(SHARD_W - 3.5)), (-9.0, -SHARD_W)]
# edges: 0 outer hull, 1 north side, 2 wall top, 3 wall inner face, 4 FLOOR, 5 wall inner face, 6 wall top,
#        7 south side (camera side)


def _ring_pt(a_deg, dr, h, R=SHARD_R):
    """Point on the upright ring (axis Y): a = angle in the XZ plane (-90 = bottom), dr > 0 = outward
    (down at the bottom), h = along the ring axis."""
    a = math.radians(a_deg)
    return Vector(((R + dr) * math.cos(a), h, (R + dr) * math.sin(a)))


def _ring_frame(a_deg):
    a = math.radians(a_deg)
    out = Vector((math.cos(a), 0, math.sin(a)))          # outward (down at the bottom)
    tan = Vector((-math.sin(a), 0, math.cos(a)))         # along the arc (+X at the bottom)
    return out, tan


def build_rust_ring_shard(atlas_dir, seed=23):
    rng = random.Random(seed)
    st, lights, glow_pts = [], [], []
    steps = 52
    a0, a1 = -90 - SHARD_HALF, -90 + SHARD_HALF
    secs = []
    for i in range(steps + 1):
        a = a0 + (a1 - a0) * i / steps
        sec = []
        for dr, h in SHARD_PROFILE:
            aa = a
            if i == 0:          # jagged, sheared broken ends
                aa = a + rng.uniform(0.0, 6.0)
            elif i == steps:
                aa = a - rng.uniform(0.0, 6.0)
            sec.append(_ring_pt(aa, dr, h))
        secs.append(sec)
    keys = ['der_plate', 'hull_mid', 'der_rust', 'pir_rust', 'der_dark', 'pir_gunmetal', 'char_black', 'pir_hazard']
    floor = [rng.choices((0, 1, 2, 3), (40, 38, 12, 10))[0] for _ in range(steps)]
    hull = [rng.choices((2, 3, 4), (40, 25, 35))[0] for _ in range(steps)]

    def fm(i, k):
        if k == 4:
            return floor[i]
        if k in (3, 5):
            return 5
        if k in (2, 6):
            return 7 if (i % 9 in (0, 1) and 6 < i < steps - 6) else 4
        return hull[i] if k == 0 else 4
    st.append(loft('Band', secs, keys, face_mat=fm, cap_mat=6))
    # rib collars every 5 degrees (outer hull + walls), one torn off
    lift = lambda dr: 1.8 if dr > 0 else (-1.2 if dr < -1 else 0.0)   # noqa: E731
    for k in range(1, int(2 * SHARD_HALF / 5)):
        a = a0 + k * 5.0
        if k == 13:
            continue
        for side, prof in (('N', SHARD_PROFILE[:4]), ('S', SHARD_PROFILE[4:] + SHARD_PROFILE[:1])):
            rib = [[_ring_pt(a + da, dr + lift(dr), h * 1.06 if abs(h) > SHARD_W - 4 else h) for dr, h in prof]
                   for da in (-0.8, 0.8)]
            st.append(loft(f'Rib{side}{k}', rib, ['der_dark']))
        # dark seam across the floor (reads as segment lines from far away)
        p0, p1 = _ring_pt(a, -0.35, -(SHARD_W - 3.5)), _ring_pt(a, -0.35, SHARD_W - 3.5)
        st.append(bar(f'Seam{k}', p0, p1, 0.9, 'der_dark', h=0.7))
    # habitat districts on the floor: window grids (warm = pirate squats, dim = dead) + blocks
    lit_zones = [(-112, -100), (-84, -76), (-62, -52)]
    for k in range(int(2 * SHARD_HALF / 2.6)):
        a = a0 + 3 + k * 2.6
        if a > a1 - 3:
            break
        out, tan = _ring_frame(a)
        lit = any(z0 <= a <= z1 for z0, z1 in lit_zones)
        for j in range(-6, 7):
            h = j * 3.0 + rng.uniform(-0.4, 0.4)
            if abs(h) < 2.0 or rng.random() > (0.55 if lit else 0.3):
                continue
            c = _ring_pt(a + rng.uniform(-0.5, 0.5), -0.55, h)
            w, d = rng.uniform(1.2, 2.2), rng.uniform(0.9, 1.6)
            mat = 'window_warm' if (lit and rng.random() < 0.7) else 'der_window'
            st.append(bar(f'Win{k}_{j}', c - tan * w / 2, c + tan * w / 2, d, mat, h=0.5))
    for k in range(14):
        a = rng.uniform(a0 + 6, a1 - 6)
        out, tan = _ring_frame(a)
        h = rng.uniform(-(SHARD_W - 7), SHARD_W - 7)
        c = _ring_pt(a, 0.0, h)
        w, d, ht = rng.uniform(4, 9), rng.uniform(4, 8), rng.uniform(2.5, 7)
        blk = G.box(f'Block{k}', -w / 2, w / 2, -d / 2, d / 2, 0, ht, rng.choice(('der_plate', 'hull_mid', 'pir_plate_worn')))
        rot = Matrix((tan, (0, 1, 0), -out)).transposed().to_4x4()      # local z = inward (up from the floor)
        blk.data.transform(Matrix.Translation(c) @ rot)
        st.append(blk)
        # window strip on the camera side of the block
        p = c - out * ht * 0.6 + Vector((0, -d / 2 - 0.05, 0))
        st.append(bar(f'BlockWin{k}', p - tan * w * 0.35, p + tan * w * 0.35, 0.3,
                      'window_warm' if any(z0 <= a <= z1 for z0, z1 in lit_zones) else 'der_window', h=0.9))
    # pirate lamps on both wall tops
    for k in range(13):
        a = a0 + 5 + k * 7.6 + rng.uniform(-1, 1)
        for side in (-1, 1):
            if rng.random() < 0.25:
                continue
            lights.append(lamp(f'Lamp{k}{side}', 1.2, 'pir_glow_red', _ring_pt(a, -9.8, side * (SHARD_W - 1.7))))
    # broken ends: protruding girders + drifting chunks
    for end, sgn in ((a0, -1), (a1, 1)):
        out, tan = _ring_frame(end)
        for k in range(9):
            p0 = _ring_pt(end - sgn * 2.5, rng.uniform(-8, 5), rng.uniform(-SHARD_W, SHARD_W))
            d = (tan * sgn + Vector((rng.uniform(-0.4, 0.4), rng.uniform(-0.3, 0.3), rng.uniform(-0.4, 0.4)))).normalized()
            st.append(bar(f'Girder{end:.0f}{k}', p0, p0 + d * rng.uniform(8, 20), rng.uniform(0.8, 1.6), 'der_dark'))
        for k in range(5):
            c = _ring_pt(end + sgn * rng.uniform(7, 20), rng.uniform(-12, 6), rng.uniform(-SHARD_W, SHARD_W))
            s = rng.uniform(3.0, 7.0)
            ch = G.box(f'Chunk{end:.0f}{k}', -s, s, -s * 0.7, s * 0.7, -s * 0.22, s * 0.22,
                       rng.choice(('der_plate', 'der_rust', 'pir_rust', 'der_dark')))
            ch.data.transform(Matrix.Translation(c) @ G._euler((rng.uniform(0, 360), rng.uniform(0, 360),
                                                                 rng.uniform(0, 360))))
            st.append(ch)
    # snapped spoke rising from the floor toward the lost hub (up toward the camera: strong parallax)
    base = _ring_pt(-84, -0.2, 2.0)
    p1 = base + Vector((0.05, 0.0, 1.0)).normalized() * 38
    p2 = p1 + Vector((0.3, -0.15, 1.0)).normalized() * 18
    st.append(bar('Spoke0', base, p1, 6.0, 'der_plate', h=5.0))
    st.append(bar('Spoke1', p1, p2, 5.0, 'der_rust', h=4.2))
    st.append(G.box('SpokeJoint', p1.x - 4, p1.x + 4, p1.y - 4, p1.y + 4, p1.z - 3, p1.z + 3, 'der_dark'))
    for k in range(5):
        d = Vector((rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), 1)).normalized()
        st.append(bar(f'SpokeWire{k}', p2, p2 + d * rng.uniform(5, 11), 0.45, 'der_dark'))
    for k, z in enumerate((10, 22)):
        st.append(bar(f'SpokeBand{k}', base + Vector((0, 0, z)), base + Vector((0, 0, z + 2.0)), 6.5, 'pir_hazard', h=5.5))
    lights.append(lamp('SpokeLamp', 1.4, 'pir_glow_red', p2 + Vector((0, 0, 1.5))))
    glow_pts += [_ring_pt(-106, -3, 0), _ring_pt(-57, -3, 0), p2 + Vector((0, 0, 1.5))]
    root = finish(st, 'Rust_Ring_Shard', atlas_dir, rng,
                  shade=dict(z0=-130, z1=-40, floor=0.7, jitter=0.12, grime=0.25, scale=10))
    li = finish(lights, 'Shard_Lights', atlas_dir)
    li.parent = root
    # centre on the bounds, tilt the bowl's opening toward the camera (south, up)
    mn, mx = _bounds([root, li])
    c = (mn + mx) / 2
    tilt = Matrix.Rotation(math.radians(18), 4, 'X') @ Matrix.Translation(-c)
    for o in (root, li):
        o.data.transform(tilt)
    for i, p in enumerate(glow_pts):
        e = G.empty(f'glow_{i}', loc=tilt @ p, size=3)
        e.parent = root
    return root


# ----------------------------------------------------------------------------
# ring 3: crystal wall
# ----------------------------------------------------------------------------
def crystal(name, r, h, mat, base, axis, sides=6, twist=0.3):
    """Hexagonal crystal prism with a pointed tip, root at `base`, growing along `axis`
    (gradient swatch: root 0 -> tip 1)."""
    bm = bmesh.new()
    lo = [bm.verts.new((r * math.cos(2 * math.pi * k / sides), r * math.sin(2 * math.pi * k / sides), -r * 0.6))
          for k in range(sides)]
    hi = [bm.verts.new((r * 0.84 * math.cos(2 * math.pi * k / sides + twist),
                        r * 0.84 * math.sin(2 * math.pi * k / sides + twist), h - r * 1.9)) for k in range(sides)]
    tip = bm.verts.new((r * 0.12, 0, h))
    bm.faces.new(list(reversed(lo)))
    for k in range(sides):
        j = (k + 1) % sides
        bm.faces.new((lo[k], lo[j], hi[j], hi[k]))
        bm.faces.new((hi[k], hi[j], tip))
    q = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized())
    bmesh.ops.transform(bm, matrix=Matrix.Translation(base) @ q.to_matrix().to_4x4(), verts=bm.verts)
    ob = G.obj_from_bm(name, bm, [mat], grad=lambda v: 0.5)
    # gradient = position along the growth axis (root 0 -> tip 1)
    ax = Vector(axis).normalized()
    layer = ob.data.attributes.get(M.GRAD_ATTR)
    b = Vector(base)
    for v in ob.data.vertices:
        layer.data[v.index].value = _clamp(((v.co - b).dot(ax) + r * 0.6) / (h + r * 0.6)) ** 0.8
    G.set_smooth(ob, False)
    return ob


def rock_blob(name, rx, ry, rz, mat, rng, loc=(0, 0, 0), subdiv=2, amp=0.22, crack_mat=None, crack=0.0):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    off = Vector([rng.uniform(-40, 40) for _ in range(3)])
    for v in bm.verts:
        n = noise.fractal(v.co * 1.3 + off, 0.55, 2.0, 3)
        s = 1.0 + amp * n
        v.co = Vector((v.co.x * rx * s, v.co.y * ry * s, v.co.z * rz * s))
    keys = [mat]
    if crack_mat:
        keys.append(crack_mat)
        for f in bm.faces:
            c = f.calc_center_median()
            d, _ = noise.voronoi(Vector((c.x / rx, c.y / ry, c.z / rz)) * 2.2 + off, distance_metric='DISTANCE',
                                 exponent=2.5)
            if d[1] - d[0] < crack:
                f.material_index = 1
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    ob = G.obj_from_bm(name, bm, keys)
    G.set_smooth(ob, False)
    return ob


def slab_xz(name, pts, t, mat):
    """Flat jagged slab: outline (x, z) extruded along Y from -t to +t."""
    bm = bmesh.new()
    fr = [bm.verts.new((x, -t, z)) for x, z in pts]
    bk = [bm.verts.new((x, t, z)) for x, z in pts]
    bm.faces.new(fr)
    bm.faces.new(list(reversed(bk)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((fr[j], fr[i], bk[i], bk[j]))
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    ob = G.obj_from_bm(name, bm, [mat])
    G.set_smooth(ob, False)
    return ob


def build_crystal_spire(atlas_dir, seed=31):
    """Crystal wall: two rows of giant crystals splitting apart along a glowing teal cleft (the
    "inner glow" - the nebula's light showing through), on a slate ridge with teal fissures."""
    rng = random.Random(seed)
    st, glows = [], []
    st.append(rock_blob('Ridge', 74, 24, 17, 'st_rock_crystal', rng, loc=(0, 0, -14), subdiv=4, amp=0.26,
                        crack_mat='reactor_glow', crack=0.05))
    st.append(rock_blob('RidgeL', 24, 17, 12, 'st_rock_crystal', rng, loc=(-66, 8, -20), subdiv=3, amp=0.3))
    st.append(rock_blob('RidgeR', 22, 15, 13, 'st_rock_crystal', rng, loc=(68, -6, -18), subdiv=3, amp=0.3))
    # glowing cleft between the rows: a jagged emissive blade
    xs = np.linspace(-46, 46, 13)
    top = [(float(x), 22 + 78 * math.exp(-(x / 26) ** 2) + rng.uniform(-14, 14)) for x in xs]
    outline = [(float(xs[0]), -6.0)] + top + [(float(xs[-1]), -6.0)]
    st.append(slab_xz('Cleft', outline[::-1], 1.6, 'reactor_glow'))
    # two rows of hero crystals leaning apart from the cleft; the back row is the tall one
    mats = ['st_ore_crystal', 'kov_crystal', 'cr_gem']
    for row, (y, ly, hk) in enumerate(((9.0, 0.16, 1.0), (-8.0, -0.2, 0.78))):
        xs_ = [-56, -42, -29, -16, -4, 8, 21, 34, 47, 58] if row == 0 else [-48, -33, -19, -6, 7, 20, 33, 46]
        for i, x in enumerate(xs_):
            h = (55 + 175 * math.exp(-(x / 34) ** 2)) * hk * rng.uniform(0.85, 1.1)
            r = 4.5 + 7.5 * math.exp(-(x / 40) ** 2) * (1.0 if row == 0 else 0.8)
            lx = x * 0.006 + rng.uniform(-0.06, 0.06)
            ly_ = ly + rng.uniform(-0.05, 0.05)
            st.append(crystal(f'Hero{row}_{i}', r, h, mats[(i + row) % 3], (x, y + rng.uniform(-2, 2), -6),
                              (lx, ly_, 1.0), twist=rng.uniform(0.15, 0.45)))
            if row == 0 and abs(x) < 20:
                # bright violet edge seam on the tallest crystals
                ax = Vector((lx, ly_, 1.0)).normalized()
                q = Vector((0, 0, 1)).rotation_difference(ax).to_matrix()
                b = Vector((x, y, -6))
                a = 2 * math.pi * 4 / 6
                p0 = b + q @ (Vector((r * math.cos(a), r * math.sin(a), 0)) * 1.03)
                p1 = b + q @ Vector((r * 0.84 * math.cos(a + 0.3), r * 0.84 * math.sin(a + 0.3), h - r * 1.9))
                st.append(bar(f'Seam{i}', p0, p1, 1.0, 'tier_glow_cr'))
    # small crystals around the root, some hanging below
    for k in range(20):
        a = rng.uniform(0, 2 * math.pi)
        x, y = 66 * math.cos(a) * rng.uniform(0.35, 1.0), 20 * math.sin(a) * rng.uniform(0.5, 1.0)
        down = k % 3 == 0
        ax = Vector((x * 0.01 + rng.uniform(-0.3, 0.3), y * 0.03 + rng.uniform(-0.3, 0.3), -1.0 if down else 1.0))
        st.append(crystal(f'Small{k}', rng.uniform(2.0, 4.2), rng.uniform(14, 36), rng.choice(mats),
                          (x, y, -24 if down else -8), ax, twist=rng.uniform(0.1, 0.5)))
    # levitating shards rising along the pillar (the crystals "sing")
    for k in range(10):
        z = 60 + k * 18 + rng.uniform(-6, 6)
        spread = 30 + k * 4
        c = (rng.choice((-1, 1)) * rng.uniform(18, spread), rng.uniform(-24, 24), z)
        st.append(octa(f'Float{k}', rng.uniform(2.5, 4.5), rng.uniform(5, 9), rng.choice(('kov_crystal', 'st_ore_crystal')),
                       loc=c, rot=(rng.uniform(-40, 40), rng.uniform(-40, 40), rng.uniform(0, 90))))
    for z in (20, 55, 90):
        glows.append(Vector((rng.uniform(-8, 8), 0, z)))
    glows.append(Vector((0, 8, 170)))
    root = finish(st, 'Crystal_Spire', atlas_dir, rng, shade=dict(z0=-40, z1=150, floor=0.6, jitter=0.18))
    for i, p in enumerate(glows):
        e = G.empty(f'glow_{i}', loc=p, size=3)
        e.parent = root
    return root


# ----------------------------------------------------------------------------
# ring 4: the extinguished forge (dead star cinder in a broken Forge-smith cage)
# ----------------------------------------------------------------------------
CAGE_R = 56.0


def _rib_frame(theta_deg, phi_deg, R=CAGE_R):
    th, ph = math.radians(theta_deg), math.radians(phi_deg)
    p = Vector((R * math.sin(th) * math.cos(ph), R * math.sin(th) * math.sin(ph), R * math.cos(th)))
    nout = p.normalized()
    side = Vector((-math.sin(ph), math.cos(ph), 0))
    return p, nout, side


def build_dead_forge(atlas_dir, seed=47):
    rng = random.Random(seed)
    st, glyph = [], []
    # cinder: faceted dark sphere with an ember crack network (a few cracks still hot)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=5, radius=38.0)
    off = Vector([rng.uniform(-40, 40) for _ in range(3)])
    for v in bm.verts:
        v.co *= 1.0 + 0.05 * noise.fractal(v.co / 38.0 * 2.0 + off, 0.6, 2.0, 3)
    for f in bm.faces:
        c = f.calc_center_median() / 38.0
        d, _ = noise.voronoi(c * 2.4 + off, distance_metric='DISTANCE', exponent=2.5)
        e = d[1] - d[0]
        hot = noise.noise(c * 1.7 - off)
        if e < 0.042:
            f.material_index = 2 if hot > 0.42 else 1
        else:
            f.material_index = 0 if noise.noise(c * 3.0 + off) > -0.15 else 3
    cinder = G.obj_from_bm('Cinder', bm, ['char_black', 'ember', 'kov_ember', 'kov_obsidian'])
    G.set_smooth(cinder, False)
    st.append(cinder)
    # three claw ribs (3-fold, Forge-smith): from below the equator up toward the pole; rib 1 is snapped
    for i in range(3):
        ph = 90 + i * 120            # one rib behind, two flanking the camera side; rib 1 is snapped
        th0, th1 = 152, 14
        steps = 12
        pieces = [(th0, th1)] if i != 1 else [(th0, 74), (68, th1)]
        for pi_, (ta, tb) in enumerate(pieces):
            secs, ridge = [], []
            for s in range(steps + 1):
                t = s / steps
                th = ta + (tb - ta) * t
                tt = (th0 - th) / (th0 - th1)               # 0 root .. 1 tip over the whole rib
                p, nout, side = _rib_frame(th, ph, CAGE_R + 6 * math.sin(math.pi * tt))
                w = 7.5 * (1 - tt) ** 0.6 + 0.6
                thk = 4.2 * (1 - tt) + 0.7
                secs.append([p + side * w, p + nout * thk, p - side * w, p - nout * thk * 0.5])
                ridge.append((p + nout * thk, nout))
            ob = loft(f'Rib{i}_{pi_}', secs, ['kov_obsidian'])
            # bronze edges
            for sgn in (1, -1):
                for s in range(steps):
                    a_, b_ = secs[s][1 - sgn], secs[s + 1][1 - sgn]
                    ob2 = bar(f'Edge{i}{pi_}{sgn}{s}', a_, b_, 1.7, 'kov_bronze')
                    st.append(ob2)
            gl = glyph_dashes(f'Gl{i}{pi_}_', ridge, 1.8)
            if i == 1 and pi_ == 1:     # the snapped upper half drifts away
                M_ = (Matrix.Translation(Vector((0, 0, 0)) + _rib_frame(70, ph)[1] * 12) @
                      Matrix.Rotation(math.radians(14), 4, _rib_frame(70, ph)[2]))
                for o in [ob] + gl + st[-2 * steps:]:
                    o.data.transform(M_)
            st.append(ob)
            glyph += gl
    # equatorial segmented bronze ring (two segments missing), slightly tilted
    ring = []
    n_seg = 9
    for s in range(n_seg):
        if s in (2, 6):
            continue
        a0 = s * 360 / n_seg + 3
        span = 360 / n_seg - 6
        secs = []
        for k in range(7):
            a = math.radians(a0 + span * k / 6)
            rad = Vector((math.cos(a), math.sin(a), 0))
            c = rad * 70.0
            secs.append([c - rad * 3.2 - Vector((0, 0, 1.6)), c + rad * 3.2 - Vector((0, 0, 1.6)),
                         c + rad * 3.2 + Vector((0, 0, 1.6)), c - rad * 3.2 + Vector((0, 0, 1.6))])
        ring.append(loft(f'RingSeg{s}', secs, ['kov_bronze']))
        for k, f in enumerate((0.3, 0.5, 0.62)):
            a = math.radians(a0 + span * f)
            rad = Vector((math.cos(a), math.sin(a), 0))
            L = 4.4 if k == 0 else 2.0
            c = rad * 70.0 + Vector((0, 0, 1.75))
            ring.append(bar(f'RingGl{s}{k}', c - rad * L / 2, c + rad * L / 2, 1.0,
                            'kov_ember' if k == 0 else 'ember', h=0.5))
    # drifting obsidian shards
    for k in range(9):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(78, 92)
        st.append(octa(f'Shard{k}', rng.uniform(2.5, 5.0), rng.uniform(5, 10), 'kov_obsidian',
                       loc=(r * math.cos(a), r * math.sin(a), rng.uniform(-22, 22)),
                       rot=(rng.uniform(0, 180), rng.uniform(0, 180), 0)))
    root = finish(st, 'Dead_Forge', atlas_dir, rng, shade=dict(z0=-60, z1=60, floor=0.55, jitter=0.12))
    gl = finish(glyph, 'Forge_Glyphs', atlas_dir)
    gl.parent = root
    rg = finish(ring, 'Forge_Ring', atlas_dir, rng, shade=dict(z0=-3, z1=3, floor=0.8, jitter=0.1))
    rg.rotation_euler = (math.radians(9), math.radians(-4), 0)
    rg.parent = root
    e = G.empty('glow_0', loc=(0, 0, 0), size=3)
    e.parent = root
    return root


# ----------------------------------------------------------------------------
# Echo beacon light column
# ----------------------------------------------------------------------------
def write_column_texture(w=64, h=512):
    """Additive beam (fixed colour): white-hot core, ember halo (map ECHO_COLOR #ff8a5c) with a
    faint violet fringe (Forge-smith crystal); u across the beam, v along it (v 0.5 = the beacon),
    soft fade toward both ends. Straight alpha = luminance (for a normal-blend fallback)."""
    u = (np.arange(w) + 0.5) / w * 2 - 1           # -1..1 across
    v = (np.arange(h) + 0.5) / h                    # 0 bottom .. 1 top (row 0 = top after flip below)
    core = np.exp(-(u / 0.13) ** 2)
    halo = np.exp(-(u / 0.42) ** 2) * (1 - np.abs(u)) ** 0.5
    fringe = np.exp(-((np.abs(u) - 0.62) / 0.2) ** 2) * (1 - np.abs(u))
    ember = np.array([1.0, 0.54, 0.36])
    violet = np.array([0.62, 0.42, 1.0])
    col = core[:, None] * np.array([1.0, 0.95, 0.88]) * 1.0 + halo[:, None] * ember * 0.75 + \
        fringe[:, None] * violet * 0.22
    # along: bright foot around the beacon (v 0.5), long fade to both ends (up fades later)
    up = np.clip((1.0 - v) / 0.45, 0, 1) ** 1.6        # top 0..1
    dn = np.clip(v / 0.6, 0, 1) ** 1.3
    along = np.minimum(up, dn) * 0.85 + 0.35 * np.exp(-((v - 0.5) / 0.03) ** 2)
    img = np.zeros((h, w, 4), np.float32)
    img[..., :3] = np.clip(col[None, :, :] * along[:, None, None], 0, 1)
    img[..., 3] = np.clip(img[..., :3].max(axis=2), 0, 1)
    img = img[::-1]          # write_png expects rows top-down? (tex2d: row 0 = top) -> top = v 1
    os.makedirs(os.path.dirname(COLUMN_TEX), exist_ok=True)
    T.write_png(COLUMN_TEX, img)
    return COLUMN_TEX


def column_material():
    m = bpy.data.materials.new('AF_EchoColumn')
    m.use_backface_culling = False
    try:
        m.surface_render_method = 'BLENDED'
    except Exception:
        m.blend_method = 'BLEND'
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    b.inputs['Roughness'].default_value = 1.0
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(COLUMN_TEX, check_existing=True)
    tex.extension = 'EXTEND'
    nt.links.new(tex.outputs['Color'], b.inputs['Emission Color'])
    nt.links.new(tex.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Emission Strength'].default_value = 1.0
    return m


def build_echo_column(atlas_dir=None):
    """Unit column: 3 crossed quads (0/60/120 deg) through the Z axis, x in [-0.5, 0.5],
    z in [-1, 1] (Blender; glTF y), 24 rows; UV u across, v = (z + 1) / 2 along."""
    write_column_texture()
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    rows = 24
    for q in range(3):
        a = math.radians(60 * q)
        d = Vector((math.cos(a), math.sin(a), 0))
        grid = [[bm.verts.new(d * (c - 0.5) + Vector((0, 0, -1 + 2 * r / rows))) for c in (0, 1)]
                for r in range(rows + 1)]
        for r in range(rows):
            f = bm.faces.new((grid[r][0], grid[r][1], grid[r + 1][1], grid[r + 1][0]))
            for loop, (cc, rr) in zip(f.loops, ((0, r), (1, r), (1, r + 1), (0, r + 1))):
                loop[uv].uv = (cc, rr / rows)
    me = bpy.data.meshes.new('Echo_Column')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(column_material())
    ob = bpy.data.objects.new('Echo_Column', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


BUILDERS = {
    'guild_relay': build_guild_relay,
    'rust_ring_shard': build_rust_ring_shard,
    'crystal_spire': build_crystal_spire,
    'dead_forge': build_dead_forge,
    'echo_column': build_echo_column,
}


# ----------------------------------------------------------------------------
# manifest
# ----------------------------------------------------------------------------
# Game camera (src/render/CameraRig.ts + readability work, part 1): pitch 55 deg from the plane,
# vertical FOV 50 deg, camera south of the target (+z three), default distance ~48, max ~210.
CAM = {'pitchDeg': 55, 'vfovDeg': 50, 'aspect': 16 / 9, 'defaultDistance': 48, 'maxDistance': 210}

PLACEMENT = {
    # id: ring, scale, depth (centre below the plane), instances, where, yaw, haze, notes
    'guild_relay': dict(
        ring=1, scale=3.4, depth=1100, count=1,
        where='1 instance at radius 900-1200 from home at a seeded angle in the eastern half (-70..+70 deg from '
              'east): the gas-giant compass sits north-west, so the two never overlap on screen and the player '
              'gets two bearings',
        yawDeg=[-30, 30],
        nameSuggestion={'sk': 'Starý stožiar Cechu', 'en': 'Old Guild relay mast'},
        emissive='Relay_Beacons: crown ring of 6 red lamps (blink 1 s, staggered), green/red wing tips (nav), '
                 'amber top lamp (slow 2.5 s pulse) and 3 red antenna tips; warm window ring on the hub stays lit '
                 '(baked in the root). glow_0 = amber halo at the top lamp.',
        glows=[{'node': 'glow_0', 'color': '#ffb347', 'size': 40, 'opacity': 0.7, 'pulse': '2.5 s'}]),
    'rust_ring_shard': dict(
        ring=2, scale=3.4, depth=1400, count=3,
        where='3 shards of the same broken ring: radius 2400-3200, angles 120 deg apart + seeded jitter '
              '(+-25 deg); give each a different yaw so they read as different pieces',
        yawDeg=[-180, 180],
        nameSuggestion={'sk': 'Zlomený prstenec', 'en': 'Broken ring shard'},
        emissive='Shard_Lights: ~20 pirate red lamps on both rim walls + one on the snapped spoke tip - blink '
                 'irregularly (0.6-1.4 s, random phase), let a few stay dark. Root: three districts of warm '
                 'windows (pirate squats, window_warm) among dim dead ones (der_window) on the habitat floor. '
                 'glow_0/1 = warm halos over the two big lit districts, glow_2 = red halo on the spoke tip.',
        glows=[{'node': 'glow_0', 'color': '#ffb060', 'size': 70, 'opacity': 0.5},
               {'node': 'glow_1', 'color': '#ffb060', 'size': 70, 'opacity': 0.5},
               {'node': 'glow_2', 'color': '#ff2a12', 'size': 40, 'opacity': 0.8}]),
    'crystal_spire': dict(
        ring=3, scale=3.0, depth=1500, count=4,
        where='4 walls at radius 5000-7200, angles 90 deg apart + seeded jitter; avoid the nebula cores '
              '(radiation sources) - a wall reads best a little off a core, never on it',
        yawDeg=[-35, 35],
        nameSuggestion={'sk': 'Kryštálová stena', 'en': 'Crystal wall'},
        emissive='Crystals use the violet gradient swatches (emissive root -> pale tip) with bright violet edge '
                 'seams on the tallest prisms (tier_glow_cr); the cleft between the two rows is a glowing teal '
                 'blade (reactor_glow) peeking between the crystals = the inner glow; teal fissures in the root '
                 'ridge. '
                 'glow_0..2 = teal halos along the cleft (slow 4-6 s breathing, out of phase), glow_3 = violet '
                 'halo at the crown.',
        glows=[{'node': f'glow_{i}', 'color': '#5ce1ff', 'size': 90, 'opacity': 0.55, 'pulse': '4-6 s'}
               for i in range(3)] + [{'node': 'glow_3', 'color': '#8a40ff', 'size': 110, 'opacity': 0.5}]),
    'dead_forge': dict(
        ring=4, scale=5.0, depth=2100, count=2,
        where='2 instances at radius 9000-11000 on opposite sides (seeded angle); it is the "Vyhasnutie" '
              'memorial of the star-smiths - keep it clear of workshops so it is never mistaken for one',
        yawDeg=[-180, 180],
        nameSuggestion={'sk': 'Vyhasnutá výheň', 'en': 'Extinguished Forge'},
        emissive='Cinder: ember crack network (ember 1.8, a few hot kov_ember 4.0) baked in the root. '
                 'Forge_Glyphs: long-short-short ember dashes on the claw ribs - slow dying pulse (6-8 s, '
                 'intensity 0.4-1.0). Forge_Ring: spin around local +Y, ~0.01 rad/s. glow_0 = big dim ember '
                 'halo behind the cinder (size ~1.6x the sphere).',
        glows=[{'node': 'glow_0', 'color': '#ff4a10', 'size': 420, 'opacity': 0.35, 'pulse': '6-8 s'}]),
}


def _visible_within(depth, half_extent, distance):
    """How far (on the gameplay plane) the camera target can be from the landmark's anchor in each screen
    direction before the landmark leaves the screen (approx. pinhole math, centre +- half_extent)."""
    p = math.radians(CAM['pitchDeg'])
    th = math.tan(math.radians(CAM['vfovDeg'] / 2))
    cam_h = distance * math.sin(p)
    cam_back = distance * math.cos(p)
    out = {}
    # camera at (0, -cam_back, cam_h) looking at the origin (Blender axes); search along +-X, +-Y
    fwd = Vector((0, cam_back, -cam_h)).normalized()
    right = Vector((1, 0, 0))
    up = right.cross(fwd).normalized()

    def on_screen(x, y):
        c = Vector((x, y, -depth)) - Vector((0, -cam_back, cam_h))
        z = c.dot(fwd)
        if z <= 0:
            return False
        sx = c.dot(right) / (z * th * CAM['aspect'])
        sy = c.dot(up) / (z * th)
        mx = half_extent / (z * th * CAM['aspect'])
        my = half_extent / (z * th)
        return abs(sx) < 1 + mx and abs(sy) < 1 + my
    # scan along x at the row where the landmark is centred on screen, and along y through x = 0
    yc = depth / math.tan(p)          # the line of sight through the target reaches depth D this far north
    for name, d in (('east', (1, 0)), ('west', (-1, 0)), ('north', (0, 1)), ('south', (0, -1))):
        r = 0
        y0 = yc if d[0] else 0.0
        while r < 20000 and on_screen(d[0] * r, y0 + d[1] * r):
            r += 10
        out[name] = r
    return {'dx': [-out['west'], out['east']], 'dy': [-out['south'], out['north']],
            'centreDy': round(yc)}


def manifest(report):
    lm = []
    for lid in BUILDERS:
        if lid == 'echo_column' or lid not in report:
            continue
        r = report[lid]
        pl = PLACEMENT[lid]
        s = pl['scale']
        world = [round(v * s, 1) for v in r['modelSize']]
        half = max(world) / 2
        lm.append({
            'id': lid, 'file': r['file'], 'ring': pl['ring'], 'tris': r['tris'], 'nodes': r['nodes'],
            'modelSize': r['modelSize'], 'modelBounds': r['modelBounds'],
            'scale': s, 'worldSize': world, 'depth': pl['depth'],
            'topClearance': round(pl['depth'] - r['modelBounds']['max'][1] * s),
            'count': pl['count'], 'where': pl['where'], 'yawDeg': pl['yawDeg'],
            'visibleWithin': {
                'default': _visible_within(pl['depth'], half, CAM['defaultDistance']),
                'max': _visible_within(pl['depth'], half, CAM['maxDistance'])},
            'haze': {'albedo': 0.5, 'emissive': 0.15},
            'emissive': pl['emissive'], 'glows': pl['glows'],
            'nameSuggestion': pl['nameSuggestion'],
        })
    # the hero gas giant (existing assets) re-used as the ring-1 compass
    lm.append({
        'id': 'gas_giant', 'file': None, 'ring': 1,
        'reuse': {'planet': 'planets.json -> gas_giant (albedo 4096x2048)',
                  'rings': 'models/planets/gas_giant_rings.glb (radii 1.28-2.35 planet radii, tilt with the planet)'},
        'radius': 520, 'depth': 2500, 'count': 1,
        'where': 'WORLD-ANCHORED (not camera-following) at home + (-1150, +2270) (sim x, y; +y = north = screen '
                 'up), depth 2500: at home it sits exactly where the current backdrop puts it (upper left, zoneLook '
                 'offset (-1150, 520) + the 0.70 x depth look-ahead), and it stays on screen from anywhere in '
                 'ring 1 while sliding with true parallax - flying toward home moves it toward its home '
                 'position. Today ZoneEnvironment keeps it at a fixed screen offset with a saturating parallax '
                 'lag (PARALLAX_LIMIT 1600) and keepOffCenter(), so it cannot work as a compass; the small moon '
                 'can stay camera-following.',
        'anchor': [-1150, 2270],
        'visibleWithin': {'default': _visible_within(2500, 520, CAM['defaultDistance']),
                          'max': _visible_within(2500, 520, CAM['maxDistance'])},
        'haze': {'albedo': 0.35, 'emissive': 0.0},
        'nameSuggestion': {'sk': 'Plynný obor', 'en': 'Gas giant'},
    })
    col = report.get('echo_column')
    return {
        '_schema': {
            'units': 'model units; world size = modelSize * scale (uniform). glTF axes: +Y up, front (camera side '
                     'at yaw 0) = +Z.',
            'depth': 'world units of the model ORIGIN below the gameplay plane (three: y = -depth). '
                     'topClearance = depth - worldSize.y / 2 (keep > ~650 so nothing pokes through the debris '
                     'layers at 420-620).',
            'visibleWithin': 'where the landmark is on screen, as its anchor minus the camera target on the plane '
                             '(+x east, +y north = screen up): dy range through dx 0, dx range at dy = centreDy '
                             '(the offset at which it sits mid-screen = depth / tan 55 = 0.70 x depth). The view '
                             'footprint at depth D is centred 0.70 D NORTH of the target, about +-0.95 D wide and '
                             '+-0.7 D deep: a deep landmark shows while it lies ahead (north) of the player and '
                             'slides out at the bottom once the player passes over it. default = camera distance '
                             '48, max = 210; pitch 55, vFOV 50, 16:9.',
            'haze': 'suggested mix toward the zone haze colour (zoneLook haze): albedo / emissive share. Do not '
                    'apply the full depth-layer haze (0.8+) - the emissive accents must survive.',
            'glows': 'optional additive sprites (vfx/glow_soft.png) at the glow_<i> empties; size in world units.',
            'nodes': 'child nodes: *_Beacons / *_Lights blink, *_Glyphs pulse emission, Forge_Ring spins.',
        },
        'camera': CAM,
        'landmarks': lm,
        'echoColumn': {
            'file': 'echo_column.glb', 'texture': 'vfx/echo_column.png', 'tris': col['tris'] if col else None,
            'mesh': 'unit column: 3 crossed quads through the axis, width 1 (x), height 2 (glTF y -1..1), origin '
                    '= the beacon; UV u across (core at u 0.5), v along (beacon at v 0.5, the top end samples '
                    'the top row of the image). Own material AF_EchoColumn (not the atlas, texture embedded).',
            'scale': {'width': 14, 'height': 700},
            'tiltDeg': {'vertical': 0, 'compass': 35},
            'note': 'Place at the Ozvena beacon (ozvena_beacon.glb origin) scaled (14, 700, 14): the column runs '
                    '700 u up and 700 u down. Rising toward the camera it is seen as a long ray from far '
                    'away even when the beacon is off-screen; the downward half shows when the beacon is north '
                    'of the view. Render additive, unlit, no depth write, double-sided (or rotate one quad '
                    'around Y to face the camera and drop the other two). Fade it out when the camera is within '
                    '~60 u horizontally of the beacon (else the beam passes the camera) and pulse it with the '
                    'Kovaci rhythm (long-short-short, 1.6 s) by modulating the colour; optionally scroll a '
                    'brightness band up along v. Hide for undiscovered Echoes or show only after the first '
                    'signal fix (design choice). GEOMETRY: with the 55 deg camera vertical lines converge to '
                    'vanishing points just above / below the frame, so a VERTICAL column only reaches the screen '
                    'for beacons ahead (north, the down-ray crosses the view) or within ~2 screen widths; beacons '
                    'far east/west or south stay invisible. COMPASS option (tiltDeg.compass): rotate the column '
                    'about three.js X by +35 deg (= 90 - pitch; the top leans toward the camera, the lower half '
                    'points down-north along the view direction) and draw only the lower half (v < 0.5): the '
                    'down-ray then converges on the screen centre from ANY beacon in front of the camera - every '
                    'Echo shoots a ray that enters from its side of the screen and points at the ship '
                    '(preview landmark-echo_column-compass.png).',
            'colors': {'core': '#fff2e0', 'halo': '#ff8a5c (= map ECHO_COLOR)', 'fringe': '#9e6bff'},
        },
    }


# ----------------------------------------------------------------------------
def build(names=None, optimize=True):
    os.makedirs(OUT, exist_ok=True)
    report = {}
    for name, builder in BUILDERS.items():
        if names and name not in names:
            continue
        G.reset_scene()
        M.build_atlas_images(paths.ATLAS)
        root = builder(paths.ATLAS)
        bpy.context.view_layer.update()
        objs = [root] + list(root.children_recursive)
        tris = sum(G.tri_count(o) for o in objs if o.type == 'MESH')
        mn, mx = _bounds([o for o in objs if o.type == 'MESH'])
        g_mn = [round(mn.x, 1), round(mn.z, 1), round(-mx.y, 1)]      # glTF (x, y up, z = -Blender y)
        g_mx = [round(mx.x, 1), round(mx.z, 1), round(-mn.y, 1)]
        out = E.export_glb(root, os.path.join(OUT, name + '.glb'), vertex_colors=name != 'echo_column')
        report[name] = {'file': os.path.basename(out), 'tris': tris,
                        'nodes': sorted(o.name for o in objs if o is not root),
                        'modelSize': [round(b - a, 1) for a, b in zip(g_mn, g_mx)],
                        'modelBounds': {'min': g_mn, 'max': g_mx}}
        print('LANDMARK', name, tris, 'tris', report[name]['modelSize'], report[name]['modelBounds'])
    # merge with an existing manifest when building a subset
    mpath = os.path.join(OUT, 'landmarks.json')
    old = {}
    if names and os.path.exists(mpath):
        with open(mpath, encoding='utf-8') as f:
            prev = json.load(f)
        for e in prev.get('landmarks', []):
            if e.get('file'):
                old[e['id']] = {k: e[k] for k in ('file', 'tris', 'nodes', 'modelSize', 'modelBounds')}
        if prev.get('echoColumn'):
            old['echo_column'] = {'tris': prev['echoColumn']['tris']}
    old.update(report)
    with open(mpath, 'w', encoding='utf-8') as f:
        json.dump(manifest(old), f, indent=2, ensure_ascii=False)
    print('MANIFEST', mpath)
    if optimize:
        from lib import optimize as O
        O.run(['models'])
    return report


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else None
    build(only, optimize='--no-optimize' not in argv)
