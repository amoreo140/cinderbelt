"""Abandoned stations (spec 5.3.2, M4): four derelict variants + the power
relay the player re-activates (3 relays around a station, 60-120 u away).

Weathered/derelict version of the human station language: the same light
decks over dark structure with orange belts, but faded and dirty
(der_* swatches + COLOR_0 grime: per-panel fade, blotches, streaks), with
missing ring segments, snapped spokes, torn solar wings, exposed girders,
scorch marks, dead dark windows and a few drifting pieces.

Files: public/assets/models/derelicts/derelict_<a|b|c|d>.glb, derelict_relay.glb
(AF_Palette + COLOR_0 -> export with vertex colours); M4d adds guild_relay_mast.glb
(built by guild_relay.py, same relay node contract + Relay_Broken).

Node layout of every derelict_<x>.glb (origin = station centre, z = 0 = plane):
  Derelict_<X>         static weathered structure
    Derelict_Windows   all (dead) window strips in one node - the game raises
                       its emissive intensity once 3 relays are powered
    beacon_<i>         beacon lamps: 0/1 = dock-arm red/green (port/starboard), the
                       rest are dead (der_window) - blink in code once powered
    Derelict_Drift     (a, b, d) loose drifting pieces; slow tumble in code
                       (pivot = node origin)
    dock_port          empty at (R, 0, 0): tip of the docking arm (same rule as
                       stations, dock_clamp not used - the arm has its own cradle)
derelict_relay.glb (origin = base centre on the plane):
  Derelict_Relay       tripod mast with insulators, solar wing, battery box
    Relay_Receiver     receiver head; pivot on the mast axis; may turn (+Y glTF)
      power_target     empty at the receiver lens (aim the laser here, 5 s)
    relay_lamp         lamp mesh, dark until powered (game lights it)

Collision circles: LAYOUTS -> art/blender/data/derelict_layouts.json.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

from lib import geo as G
from lib import materials as M
import structures as S
import pirates as PI
import kovaci as K

# radius R (dock_port at (R, 0)), collision circles (x, y, r)
LAYOUTS = {
    'derelict_a': dict(R=11.0, circles=[(0, 0, 8.0), (8.6, 0, 1.2), (10.2, 0, 1.0), (-1.2, -8.3, 1.4),
                                        (1.2, -8.3, 1.4), (-2.6, 2.4, 1.0)]),
    'derelict_b': dict(R=10.0, circles=[(-2.6, 3.0, 1.6), (0.6, 3.0, 1.6), (-2.6, -3.0, 1.6), (0.6, -3.0, 1.6),
                                        (-0.7, 0, 1.4), (-5.0, 0, 1.5), (2.2, 0, 1.0), (4.4, 0, 1.0),
                                        (6.6, 0, 1.0), (8.6, 0, 1.0), (-5.0, 5.8, 1.6), (2.4, -6.3, 1.1),
                                        (1.4, -4.6, 0.8)]),
    'derelict_c': dict(R=10.0, circles=[(-1.0, 0, 4.9), (4.6, 0, 1.0), (6.6, 0, 1.0), (8.6, 0, 1.0),
                                        (-6.0, 4.0, 2.4), (-5.3, -4.6, 1.6), (4.3, 3.7, 0.9), (5.4, 4.4, 0.8)]),
    'derelict_d': dict(R=9.0, circles=[(0, 0, 3.0), (3.8, 0, 1.0), (5.6, 0, 1.0), (7.6, 0, 1.0),
                                       (-3.5, 3.5, 2.0), (-3.5, -3.5, 2.0), (3.5, -3.5, 2.0), (2.6, 2.6, 0.8),
                                       (3.8, 3.8, 0.7), (-2.2, 0, 1.0)]),
    'derelict_relay': dict(R=0.0, circles=[(0, 0, 1.5)]),
    # M4d: the Guild relay mast (guild_relay.py) - same footprint and receiver as the derelict relay
    'guild_relay_mast': dict(R=0.0, circles=[(0, 0, 1.5)]),
}
CLEAR_MARGIN = 10.0

# station swatches -> weathered derelict swatches
WEATHER = {
    'hull_light': 'der_plate', 'hull_white': 'der_plate', 'accent_iron': 'der_rust',
    'accent_iron_dark': 'der_rust', 'hull_dark': 'der_dark', 'window_warm': 'der_window',
    'glass_cockpit': 'der_window', 'engine_glow': 'der_window', 'light_white': 'der_window',
}


def weather_mats(objs, keep_some=0.0, rng=None):
    """Swap station swatches for derelict ones (keep_some: fraction of
    hull_light objects that stay less faded -> mismatched panels)."""
    for o in objs:
        if o.type != 'MESH':
            continue
        for sl in o.material_slots:
            k = sl.material.get('palette_key') if sl.material else None
            if k == 'hull_light' and rng and rng.random() < keep_some:
                sl.material = M.mat('hull_mid')
                continue
            if k in WEATHER:
                sl.material = M.mat(WEATHER[k])
    return objs


def grime(ob, rng, scale=1.0, amount=1.0):
    """COLOR_0 weathering: per-face panel fade, large dirt blotches, vertical
    streaks and darker undersides.  Never black."""
    me = ob.data
    o = Vector([rng.uniform(-50, 50) for _ in range(3)])
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for poly in me.polygons:
        fj = 1.0 - rng.uniform(0.0, 0.22) * amount
        if rng.random() < 0.07 * amount:      # soot-blackened panel
            fj *= 0.55
        under = 0.75 if poly.normal.z < -0.5 else 1.0
        for li in poly.loop_indices:
            p = me.vertices[me.loops[li].vertex_index].co
            n = noise.fractal(p * 0.6 / scale + o, 0.6, 2.0, 3)
            blot = max(0.0, min(1.0, (n + 0.1) * 1.8))
            st = noise.noise(Vector((p.x * 1.6 / scale, p.y * 1.6 / scale, p.z * 0.12 / scale)) + o * 0.3)
            streak = max(0.0, st) * 0.45
            k = 0.9 * fj * under * (1.0 - 0.55 * blot * amount - streak * amount)
            k = max(0.22, k)
            rust = max(0.0, min(1.0, (noise.noise(p * 0.9 / scale - o) - 0.15) * 2.5)) * amount
            attr.data[li].color = (k * (1 - 0.05 * rust), k * (0.95 - 0.2 * rust), k * (0.88 - 0.32 * rust), 1.0)
    me.color_attributes.active_color = attr


def densify(ob, max_len):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for _ in range(2):
        long_e = [e for e in bm.edges if e.calc_length() > max_len]
        if not long_e:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_e, cuts=1, use_grid_fill=True)
    bm.to_mesh(ob.data)
    bm.free()


# ----------------------------------------------------------------------------
# derelict kit
# ----------------------------------------------------------------------------
def arc_box(name, R, w, h, z, a0, a1, mat, steps=None):
    """Rectangular-section ring arc from angle a0 to a1 (deg)."""
    steps = steps or max(2, int(abs(a1 - a0) / 7.5))
    secs = []
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        rad = Vector((math.cos(a), math.sin(a), 0))
        c = rad * R + Vector((0, 0, z))
        up = Vector((0, 0, h / 2))
        secs.append([c - rad * w / 2 - up, c + rad * w / 2 - up, c + rad * w / 2 + up, c - rad * w / 2 + up])
    ob = K.loft(name, secs, mat)
    G.set_smooth(ob, False)
    return ob


def broken_ring(name, R, w, h, z, arcs, rng, ribs_every=30):
    """Habitat ring made of arcs [(a0, a1)], torn ends charred, window line on
    the outer face (returned separately), ribs."""
    st, win = [], []
    for k, (a0, a1) in enumerate(arcs):
        st.append(arc_box(f'{name}{k}', R, w, h, z, a0, a1, 'hull_light'))
        st.append(arc_box(f'{name}Belly{k}', R, w + 0.04, h * 0.3, z - h * 0.36, a0 + 0.4, a1 - 0.4, 'hull_dark'))
        st.append(arc_box(f'{name}Top{k}', R, 0.24, 0.06, z + h / 2 + 0.03, a0 + 1, a1 - 1, 'accent_iron'))
        win.append(arc_box(f'{name}Win{k}', R + w / 2 + 0.01, 0.06, 0.16, z, a0 + 2, a1 - 2, 'der_window'))
        a = a0 + 8
        while a < a1 - 4:
            b = G.box(f'{name}Rib{k}_{int(a)}', R - w / 2 - 0.08, R + w / 2 + 0.08, -0.18, 0.18, z - h / 2 - 0.08,
                      z + h / 2 + 0.08, 'hull_mid', bevel=0.04, seg=1)
            G.transform(b, rot=(0, 0, a))
            st.append(b)
            a += ribs_every
        # charred torn ends: jagged caps
        for e, ae in enumerate((a0, a1)):
            ar = math.radians(ae)
            for j in range(3):
                sh = G.box(f'{name}Tear{k}{e}{j}', -0.12, 0.12, -w * 0.3, w * 0.3, -h * 0.3, h * 0.3, 'char_black')
                G.transform(sh, loc=(R * math.cos(ar) + rng.uniform(-0.2, 0.2), R * math.sin(ar) + rng.uniform(-0.2, 0.2),
                                     z + rng.uniform(-0.2, 0.2)),
                            rot=(rng.uniform(-30, 30), rng.uniform(-30, 30), ae + rng.uniform(-40, 40)))
                st.append(sh)
            # exposed girder stub sticking out of the break
            d = 1 if e == 1 else -1
            p0 = Vector((R * math.cos(ar), R * math.sin(ar), z))
            p1 = Vector((R * math.cos(ar + d * 0.12), R * math.sin(ar + d * 0.12), z + rng.uniform(-0.4, 0.4)))
            st.append(PI.strut(f'{name}Girder{k}{e}', p0, p1, 0.12, 'metal_bare'))
    return st, win


def torn_solar(name, x0, x1, y0, y1, z, rng, missing=0.3, tilt=0.0):
    """Solar wing with missing / broken cells, frame bent by `tilt` deg."""
    out = [G.box(name + 'Frame', x0, x1, y0, y1, z - 0.07, z + 0.03, 'hull_mid', bevel=0.02, seg=1)]
    cols, rows = max(2, int((x1 - x0) / 0.95)), max(2, int((y1 - y0) / 0.95))
    gx, gy = (x1 - x0) / cols, (y1 - y0) / rows
    for i in range(cols):
        for j in range(rows):
            if rng.random() < missing:
                continue
            c = G.box(f'{name}Cell{i}{j}', x0 + i * gx + 0.06, x0 + (i + 1) * gx - 0.06, y0 + j * gy + 0.06,
                      y0 + (j + 1) * gy - 0.06, z + 0.02, z + 0.06, 'solar_cell')
            if rng.random() < 0.25:   # cracked / askew cell
                G.transform(c, rot=(rng.uniform(-6, 6), rng.uniform(-6, 6), 0))
            out.append(c)
    if tilt:
        piv = Vector((x0 if abs(x0) < abs(x1) else x1, (y0 + y1) / 2, z))
        for o in out:
            G.apply_modifiers(o)
            G.bake_transform(o)
            o.data.transform(Matrix.Translation(piv) @ Matrix.Rotation(math.radians(tilt), 4, 'X')
                             @ Matrix.Translation(-piv))
    return out


def scorch(name, x, y, z, r, rng, mat='scorch'):
    """Irregular flat burn mark lying on a top face at height z."""
    n = 9
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        rr = r * rng.uniform(0.55, 1.0)
        pts.append((x + rr * math.cos(a), y + rr * math.sin(a)))
    out = [G.prism(name, pts, z, z + 0.012, mat)]
    pts2 = [(x + (px - x) * 0.5, y + (py - y) * 0.5) for px, py in pts]
    out.append(G.prism(name + 'In', pts2, z + 0.01, z + 0.02, 'char_black'))
    return out


def dock_arm(name, x0, x1, w=1.5, rng=None):
    """Derelict docking arm along +X with its own small cradle at the tip."""
    out = S.arm(name, x0, x1 - 1.6, z0=-0.55, z1=0.2, w=w)
    # cradle prongs at the tip (no separate dock_clamp for derelicts)
    for s in (1, -1):
        out.append(G.box(f'{name}Prong{s}', x1 - 1.8, x1, s * (w / 2 + 0.05) - 0.22, s * (w / 2 + 0.05) + 0.22,
                         -0.45, 0.15, 'accent_iron', bevel=0.05, seg=1))
    out.append(G.box(name + 'CradleBack', x1 - 1.9, x1 - 1.55, -w / 2 - 0.2, w / 2 + 0.2, -0.5, 0.25, 'hull_dark',
                     bevel=0.04, seg=1))
    return out


def _windows(win, atlas_dir):
    if not win:
        return None
    w = G.join(win, 'Derelict_Windows')
    G.finalize(w, atlas_dir)
    return w


def _finish(name, st, win, atlas_dir, R, rng, beacons=(), drift=None, drift_loc=(0, 0, 0), grime_scale=1.0,
            roll=6.0):
    """roll: the dead station has lost attitude control - everything is rolled
    `roll` deg around the dock axis (X), so dock_port stays at (R, 0, 0)."""
    rm = Matrix.Rotation(math.radians(roll), 4, 'X')
    weather_mats(st, keep_some=0.25, rng=rng)
    root = G.join(st, name)
    root.data.transform(rm)
    densify(root, 2.2)
    G.finalize(root, atlas_dir)
    grime(root, rng, grime_scale)
    for p in root.data.polygons:
        p.use_smooth = False
    if win:
        for o in win:
            G.apply_modifiers(o)
            G.bake_transform(o)
            o.data.transform(rm)
    w = _windows(win, atlas_dir)
    if w:
        grime(w, rng, grime_scale, amount=0.4)
        w.parent = root
    if drift:
        weather_mats(drift)
        d = G.join(drift, 'Derelict_Drift')
        d.data.transform(Matrix.Translation([-c for c in drift_loc]))
        G.finalize(d, atlas_dir)
        grime(d, rng, grime_scale)
        d.location = rm @ Vector(drift_loc)
        d.parent = root
    for i, (loc, key) in enumerate(beacons):
        b = S.beacon(f'beacon_{i}', (0, 0, 0), key)
        G.finalize(b, atlas_dir)
        grime(b, rng, 1.0, amount=0.2)
        b.location = rm @ Vector(loc)
        b.parent = root
    if R:
        dp = G.empty('dock_port', loc=(R, 0, 0), size=0.6)
        dp.parent = root
    return root


# ----------------------------------------------------------------------------
# A - "broken wheel": hub + habitat ring with two missing arcs, snapped spoke
# ----------------------------------------------------------------------------
def build_a(atlas_dir, seed=101):
    rng = random.Random(seed)
    R = LAYOUTS['derelict_a']['R']
    st, win = [], []
    st += S.hub('Hub', 3.2, -1.9, 1.5, verts=12, windows=False)
    win.append(G.ring_band('HubWin', 3.16, 2.9, 0.45, 0.62, 'der_window', verts=12, smooth=False))
    # cracked observation dome (dark glass + rib cage, one panel missing)
    st.append(G.ellipsoid('Dome', 1.6, 1.6, 1.1, 'der_window', loc=(0, 0, 1.5), seg=12, rings=6, upper_only=True))
    for i in range(6):
        a = i * 60
        rib = G.torus(f'DomeRib{i}', 1.62, 0.06, 'hull_mid', rot=(90, 0, a), maj=16, mnr=4)
        rib.scale = (1, 1, 1.1 / 1.62)
        rib.location = (0, 0, 1.5)
        st.append(rib)
    st += S.mast('Antenna', (0.8, -0.6, 2.4), 1.6, r=0.07, dish=0.0)
    # broken antenna: bent upper segment
    st.append(PI.strut('AntennaBent', (0.8, -0.6, 4.0), (1.7, -0.2, 4.3), 0.08, 'metal_bare'))
    # habitat ring: two big gaps, one arc segment drifting away tilted
    ring, rw = broken_ring('Ring', 6.6, 1.3, 1.0, 0.6, [(-20, 110), (150, 228), (262, 318)], rng)
    st += ring
    win += rw
    for i, a in enumerate((45, 135, 225)):
        st += S.spoke(f'Spoke{i}', 3.0, 6.0, a, 0.6, w=0.5, h=0.4)
    # snapped spoke (stub + charred end)
    st += S.spoke('SpokeStub', 3.0, 4.4, 315, 0.6, w=0.5, h=0.4)
    st += scorch('SpokeBurn', 4.4 * math.cos(math.radians(315)), 4.4 * math.sin(math.radians(315)), 0.82, 0.35, rng,
                 mat='char_black')
    # side module on -Y (habitat block), wall breached
    st += S.deck_block('Hab', -2.2, 2.2, -9.0, -6.9, -1.2, 0.3)
    st.append(G.box('Breach', 0.6, 1.6, -9.08, -8.9, -0.9, 0.0, 'char_black'))
    win.append(G.box('HabWin', -1.9, -0.2, -9.06, -8.98, -0.35, -0.2, 'der_window'))
    st += PI.truss('HabTruss', (0, -3.0, -0.4), (0, -6.9, -0.4), w=0.8, bar=0.12, mat='hull_dark')
    st += S.vtank('Tank', (-2.6, 2.4, -0.3), 0.7, 1.8, body='der_rust', cap='hull_light')
    # missing hub plates: dark holes with exposed ribs on the hub flank
    for k, a in enumerate((200, 250, 20)):
        ar = math.radians(a)
        hole = G.box(f'HubHole{k}', -0.5, 0.5, -0.12, 0.12, -0.5, 0.4, 'char_black')
        G.transform(hole, loc=(3.12 * math.cos(ar), 3.12 * math.sin(ar), -0.2), rot=(0, 0, a + 90))
        st.append(hole)
        for j in range(3):
            rib = G.box(f'HubRib{k}{j}', -0.03, 0.03, -0.16, 0.16, -0.55, 0.45, 'metal_bare')
            G.transform(rib, loc=(3.18 * math.cos(ar + (j - 1) * 0.1), 3.18 * math.sin(ar + (j - 1) * 0.1), -0.2),
                        rot=(0, 0, a + 90))
            st.append(rib)
    # scorch marks on the hub top + ring top
    for k in range(4):
        a = rng.uniform(0, 6.28)
        st += scorch(f'Burn{k}', 2.3 * math.cos(a), 2.3 * math.sin(a), 1.0 + 0.05, rng.uniform(0.35, 0.6), rng)
    st += dock_arm('Arm', 3.0, R, w=1.5)
    # drifting broken ring arc
    drift = [arc_box('DriftArc', 6.6, 1.3, 1.0, 0.0, 0, 26, 'hull_light'),
             arc_box('DriftArcTop', 6.6, 0.24, 0.06, 0.53, 1, 25, 'accent_iron')]
    for o in drift:
        G.apply_modifiers(o)
    dl = Vector((6.6 * math.cos(math.radians(128)), 6.6 * math.sin(math.radians(128)), 0.0))
    for o in drift:
        o.data.transform(Matrix.Translation(-Vector((6.6 * math.cos(math.radians(13)), 6.6 * math.sin(math.radians(13)), 0))))
        o.data.transform(Matrix.Rotation(math.radians(115), 4, 'Z') @ Matrix.Rotation(math.radians(22), 4, 'X'))
        o.data.transform(Matrix.Translation(dl * 1.12 + Vector((0, 0, 1.0))))
    beacons = [((R - 2.3, 1.0, 0.45), 'light_red'), ((R - 2.3, -1.0, 0.45), 'light_green'),
               ((0, 0, 2.75), 'der_window'), ((0.8, -0.6, 4.05), 'der_window')]
    return _finish('Derelict_A', st, win, atlas_dir, R, rng, beacons, drift, tuple(dl * 1.12 + Vector((0, 0, 1.0))))


# ----------------------------------------------------------------------------
# B - research twin pods: two capsules on a truss, bent dish, ruptured sphere
# ----------------------------------------------------------------------------
def build_b(atlas_dir, seed=202):
    rng = random.Random(seed)
    R = LAYOUTS['derelict_b']['R']
    st, win = [], []
    L, r = 2.4, 1.25
    for k, y in enumerate((3.0, -3.0)):
        prof = [(-L - r, 0.0), (-L - r * 0.7, r * 0.7), (-L, r), (L, r), (L + r * 0.5, r * 0.75), (L + r * 0.7, 0.0)]
        st.append(G.lathe(f'Pod{k}', prof, [0, 0, 1, 2, 2], ['hull_mid', 'hull_light', 'hull_dark'],
                          loc=(-1.0, y, 0), axis='X', verts=14, closed=False, smooth=False))
        for i, x in enumerate((-2.6, -1.0, 0.6)):
            st.append(G.ring_band(f'PodBand{k}{i}', r + 0.08, r - 0.05, -0.12, 0.12,
                                  'accent_iron' if i != 1 else 'hull_dark', loc=(x, y, 0), axis='X', verts=14,
                                  smooth=False))
        win.append(G.ring_band(f'PodWin{k}', r + 0.03, r - 0.02, -0.06, 0.06, 'der_window', loc=(-1.8, y, 0),
                               axis='X', verts=14, smooth=False))
        win.append(G.ring_band(f'PodWinB{k}', r + 0.03, r - 0.02, -0.06, 0.06, 'der_window', loc=(-0.2, y, 0),
                               axis='X', verts=14, smooth=False))
    # pod 1 hull breach (missing plate showing dark ribs)
    st.append(G.box('PodBreach', -0.4, 0.6, -4.3, -3.9, 0.3, 1.1, 'char_black'))
    for i in range(3):
        st.append(G.box(f'PodBreachRib{i}', -0.3 + i * 0.35, -0.24 + i * 0.35, -4.32, -3.95, 0.25, 1.15, 'metal_bare'))
    # connecting truss + central node
    st += PI.truss('Spine', (-1.0, 1.8, 0), (-1.0, -1.8, 0), w=0.9, bar=0.13, mat='hull_dark')
    st += S.deck_block('Node', -2.0, 0.6, -1.0, 1.0, -0.8, 0.6)
    # bent survey dish on -X
    st += PI.truss('DishBoom', (-2.0, 0, 0.2), (-4.8, 0, 0.6), w=0.6, bar=0.1, mat='hull_dark')
    prof = [(0.0, 0.0), (0.1, 0.6), (0.35, 1.25), (0.33, 1.32), (0.05, 0.5), (-0.1, 0.0)]
    st.append(G.lathe('Dish', prof, [0, 0, 1, 2, 2], ['hull_white', 'accent_iron', 'hull_mid'], loc=(-5.0, 0, 0.8),
                      axis='Z', verts=16, closed=False, rot=(0, 62, 18)))
    # ruptured spherical tank (half shell) on the port side + intact one
    sph = G.ellipsoid('Sphere', 1.5, 1.5, 1.4, 'der_rust', loc=(-5.0, 5.8, -0.2), seg=14, rings=8, smooth=False)
    PI_cut = [((-5.0, 5.8, 0.3), (0.3, 0.5, 1.0))]
    import debris as DB
    DB.broken(sph, PI_cut, cut_key='char_black')
    st.append(sph)
    st.append(G.ellipsoid('SphereIn', 1.38, 1.38, 1.28, 'char_black', loc=(-5.0, 5.8, -0.2), seg=14, rings=8,
                          smooth=False))
    st.append(G.box('SphereLeg', -5.4, -4.6, 4.0, 4.6, -0.6, -0.1, 'hull_dark'))
    st += S.vtank('TankB', (2.4, -6.3, -0.4), 0.85, 2.0, body='fuel_yellow', cap='hull_light')
    st += PI.truss('TankTruss', (2.4, -5.4, -0.4), (0.8, -3.9, -0.2), w=0.5, bar=0.09, mat='hull_dark')
    for k in range(3):
        st += scorch(f'Burn{k}', -1.6 + k * 1.1, 3.0 + (k - 1) * 0.4, r + 0.02, rng.uniform(0.3, 0.5), rng)
    st += dock_arm('Arm', 0.6, R, w=1.4)
    # drifting: a loose hull plate + a detached solar panel
    drift = [G.box('DriftPlate', -0.9, 0.9, -0.6, 0.6, -0.06, 0.06, 'hull_light', bevel=0.03, seg=1)]
    drift += torn_solar('DriftSolar', 1.2, 3.4, -0.8, 0.8, 0.0, rng, missing=0.35)
    for o in drift:
        G.apply_modifiers(o)
        o.data.transform(Matrix.Rotation(math.radians(35), 4, 'X') @ Matrix.Rotation(math.radians(20), 4, 'Y'))
    dl = (3.0, 5.4, 1.2)
    for o in drift:
        o.data.transform(Matrix.Translation(dl))
    beacons = [((R - 2.3, 0.95, 0.45), 'light_red'), ((R - 2.3, -0.95, 0.45), 'light_green'),
               ((-3.6, 3.0, 1.35), 'der_window'), ((-3.6, -3.0, 1.35), 'der_window')]
    return _finish('Derelict_B', st, win, atlas_dir, R, rng, beacons, drift, dl)


# ----------------------------------------------------------------------------
# C - mining platform clamped to an ore rock, toppled crane, hoppers
# ----------------------------------------------------------------------------
def build_c(atlas_dir, seed=303):
    rng = random.Random(seed)
    R = LAYOUTS['derelict_c']['R']
    st, win = [], []
    # big octagonal deck platform
    oct_pts = [(4.6 * math.cos(math.radians(22.5 + 45 * i)) - 1.0, 4.6 * math.sin(math.radians(22.5 + 45 * i)))
               for i in range(8)]
    st.append(G.prism('Deck', oct_pts, -1.2, -0.5, 'hull_dark', bevel=0.07, seg=1))
    inner = [(-1.0 + (x + 1.0) * 0.94, y * 0.94) for x, y in oct_pts]
    st.append(G.prism('DeckPlate', inner, -0.55, -0.3, 'hull_light', bevel=0.05, seg=1))
    for i in range(8):   # belt
        a0, a1 = oct_pts[i], oct_pts[(i + 1) % 8]
        st.append(PI.strut(f'Belt{i}', (a0[0], a0[1], -0.95), (a1[0], a1[1], -0.95), 0.2, 'accent_iron'))
    # control block with windows
    st += S.deck_block('Control', -4.4, -2.0, -1.4, 1.4, -0.4, 1.4)
    win.append(G.box('CtrlWin', -2.02, -1.94, -1.0, 1.0, 0.65, 0.85, 'der_window'))
    # drill derrick (lattice tower) in the middle + drill string down through the deck
    for k, (x, y) in enumerate(((-1.6, -1.0), (0.4, -1.0), (0.4, 1.0), (-1.6, 1.0))):
        st.append(PI.strut(f'Leg{k}', (x, y, -0.3), (-0.6 + (x + 0.6) * 0.35, y * 0.35, 4.2), 0.16, 'accent_iron'))
    for h in (1.2, 2.5, 3.6):
        f = (h + 0.3) / 4.5
        s = 1.0 - 0.65 * f
        st.append(G.box(f'Ring{h}', -0.6 - 1.0 * s, -0.6 + 1.0 * s, -1.0 * s, 1.0 * s, h - 0.06, h + 0.06, 'hull_mid'))
    st.append(G.box('Crown', -1.05, -0.15, -0.45, 0.45, 4.1, 4.5, 'hull_dark', bevel=0.04, seg=1))
    st.append(G.cyl('DrillPipe', 0.14, 6.0, 'metal_bare', loc=(-0.6, 0, 1.0), verts=8))
    # toppled crane boom lying across the deck edge
    st += PI.truss('CraneBoom', (1.4, 2.2, -0.2), (5.6, 4.6, -1.6), w=0.7, bar=0.12, mat='accent_iron')
    st.append(G.box('CraneCab', 0.8, 2.0, 1.6, 2.8, -0.3, 0.6, 'hull_light', bevel=0.05, seg=1))
    win.append(G.box('CabWin', 1.98, 2.04, 1.8, 2.6, 0.15, 0.4, 'der_window'))
    # ore hoppers + spilled ore boxes
    for k, (x, y) in enumerate(((1.4, -2.4), (2.6, -1.0))):
        st.append(G.lathe(f'Hopper{k}', [(-0.3, 0.0), (-0.3, 0.35), (0.7, 0.75), (0.75, 0.7), (-0.2, 0.25)],
                          [0, 1, 2, 3], ['hull_dark', 'hull_mid', 'accent_iron', 'char_black'], loc=(x, y, 0),
                          axis='Z', verts=8, closed=False, smooth=False))
    for k in range(5):
        st += S.container(f'Crate{k}', -3.8 + k * 0.55 + rng.uniform(-0.1, 0.1), -3.2 + rng.uniform(-0.3, 0.3), -0.3,
                          0.5, 0.5, 0.45, ('der_rust', 'hull_mid', 'fuel_yellow')[k % 3], rot=rng.uniform(-30, 30))
    # the ore rock the platform was clamped to (under -X, sticking out)
    import asteroids as A
    rock = A.make_rock('OreRock', 'iron', random.Random(seed), 2.4, 'chunky')
    rock.data.materials.clear()
    rock.data.materials.append(M.mat('rock_iron_3'))
    rock.location = (-6.0, 4.0, -1.6)
    G.bake_transform(rock)
    st.append(rock)
    for k in range(3):   # clamp arms reaching the rock
        st.append(PI.strut(f'Clamp{k}', (-4.0, 2.2 + k * 0.6, -0.6), (-5.0, 3.0 + k * 0.6, -1.0), 0.22, 'hull_mid'))
    # radiator wing on -Y, torn
    st += PI.truss('RadBoom', (-3.0, -2.0, -0.6), (-5.2, -4.6, -0.6), w=0.5, bar=0.1, mat='hull_dark')
    st += torn_solar('Rad', -6.4, -4.2, -5.6, -3.6, -0.6, rng, missing=0.25, tilt=-12)
    for k in range(4):
        st += scorch(f'Burn{k}', rng.uniform(-3.5, 2.5), rng.uniform(-3.0, 3.0), -0.29, rng.uniform(0.4, 0.8), rng)
    st += dock_arm('Arm', 3.3, R, w=1.4)
    beacons = [((R - 2.3, 0.9, 0.45), 'light_red'), ((R - 2.3, -0.9, 0.45), 'light_green'),
               ((-0.6, 0, 4.7), 'der_window'), ((-4.4, 1.4, 1.55), 'der_window')]
    return _finish('Derelict_C', st, win, atlas_dir, R, rng, beacons, grime_scale=1.2)


# ----------------------------------------------------------------------------
# D - comm spire: stacked drums, torn solar wings, snapped mast with cables
# ----------------------------------------------------------------------------
def build_d(atlas_dir, seed=404):
    rng = random.Random(seed)
    R = LAYOUTS['derelict_d']['R']
    st, win = [], []
    for k, (r, z0, z1) in enumerate(((2.9, -2.4, -0.4), (2.3, -0.4, 1.6), (1.6, 1.6, 3.4))):
        st += S.hub(f'Drum{k}', r, z0, z1, verts=10, windows=False)
        win.append(G.ring_band(f'DrumWin{k}', r * 0.985, r * 0.9, z0 + 0.62 * (z1 - z0), z0 + 0.7 * (z1 - z0),
                               'der_window', verts=10, smooth=False))
    st.append(G.cyl('Spire', 0.5, 2.0, 'hull_mid', loc=(0, 0, 4.4), verts=8, r2=0.3))
    # snapped mast: lower part + broken top lying sideways, hanging cables
    st.append(G.cyl('Mast', 0.12, 1.8, 'metal_bare', loc=(0, 0, 6.3), verts=8))
    st.append(PI.strut('MastBroken', (0.1, 0, 7.1), (1.9, 0.6, 6.0), 0.12, 'metal_bare'))
    for k in range(3):
        st.append(PI.strut(f'Cable{k}', (0, 0, 6.8 - k * 0.3), (0.6 + k * 0.4, 0.3 * k - 0.3, 4.6 - k * 0.5), 0.035,
                           'trim_black'))
    # four solar booms with wings, two torn / missing
    for k, a in enumerate((45, 135, 225, 315)):
        ar = math.radians(a)
        p0 = Vector((2.3 * math.cos(ar), 2.3 * math.sin(ar), 0.4))
        p1 = Vector((5.6 * math.cos(ar), 5.6 * math.sin(ar), 0.4))
        st += PI.truss(f'Boom{k}', p0, p1, w=0.5, bar=0.1, mat='hull_dark')
        if k == 0:
            continue    # wing ripped off (only charred root)
        wing = torn_solar(f'Wing{k}', 3.6, 6.4, -1.3, 1.3, 0.4, rng, missing=0.15 + 0.25 * (k == 2),
                          tilt=(0, 0, 18, -9)[k])
        for o in wing:
            G.apply_modifiers(o)
            G.bake_transform(o)
            o.data.transform(Matrix.Rotation(ar, 4, 'Z'))
        st += wing
    st += scorch('RootBurn', 2.6 * math.cos(math.radians(45)), 2.6 * math.sin(math.radians(45)), -0.38, 0.6, rng,
                 mat='char_black')
    # dish pod on the lower drum
    st += S.mast('DishMast', (-2.2, 0.0, -0.4), 1.0, r=0.08, dish=0.8)
    st += dock_arm('Arm', 2.6, R, w=1.3)
    # drifting: the missing solar wing tumbling away
    drift = torn_solar('DriftWing', -1.4, 1.4, -1.3, 1.3, 0.0, rng, missing=0.4)
    for o in drift:
        G.apply_modifiers(o)
        G.bake_transform(o)
        o.data.transform(Matrix.Rotation(math.radians(50), 4, 'X') @ Matrix.Rotation(math.radians(30), 4, 'Z'))
    dl = (6.4, 5.8, 1.6)
    for o in drift:
        o.data.transform(Matrix.Translation(dl))
    beacons = [((R - 2.3, 0.85, 0.45), 'light_red'), ((R - 2.3, -0.85, 0.45), 'light_green'),
               ((0, 0, 7.3), 'der_window'), ((-2.2, 0, 0.75), 'der_window')]
    return _finish('Derelict_D', st, win, atlas_dir, R, rng, beacons, drift, dl)


# ----------------------------------------------------------------------------
# relay - the player powers 3 of these (5 s of mining laser on the receiver)
# ----------------------------------------------------------------------------
RELAY_PIVOT_Z = 2.35


def build_relay(atlas_dir, seed=505):
    rng = random.Random(seed)
    st = []
    # tripod base on three pads
    for k in range(3):
        a = math.radians(90 + k * 120)
        foot = Vector((1.15 * math.cos(a), 1.15 * math.sin(a), -0.55))
        st.append(G.cyl(f'Pad{k}', 0.26, 0.12, 'hull_dark', loc=foot, verts=8, bevel=0.02, seg=1))
        st.append(PI.strut(f'Leg{k}', foot + Vector((0, 0, 0.05)), Vector((0, 0, 0.55)), 0.13, 'accent_iron'))
    st.append(G.cyl('Hub', 0.38, 0.5, 'hull_light', loc=(0, 0, 0.55), verts=10, bevel=0.04, seg=1))
    st.append(G.ring_band('HubBand', 0.41, 0.36, 0.45, 0.6, 'accent_iron', verts=10, smooth=False))
    # mast with three insulator discs
    st.append(G.cyl('Mast', 0.09, 1.55, 'metal_bare', loc=(0, 0, 1.55), verts=8))
    for k, z in enumerate((1.15, 1.5, 1.85)):
        st.append(G.cyl(f'Insulator{k}', 0.24 - 0.03 * k, 0.07, 'hull_mid', loc=(0, 0, z), verts=12, bevel=0.015, seg=1))
    # battery box + torn solar wing
    st.append(G.box('Battery', 0.3, 0.9, -0.3, 0.3, 0.2, 0.75, 'hull_dark', bevel=0.04, seg=1))
    st.append(G.box('BatteryLid', 0.33, 0.87, -0.27, 0.27, 0.74, 0.8, 'hull_light', bevel=0.02, seg=1))
    st.append(PI.strut('WingArm', (-0.2, 0, 0.9), (-1.0, 0, 1.2), 0.08, 'metal_bare'))
    st += torn_solar('Wing', -2.2, -1.0, -0.6, 0.6, 1.2, rng, missing=0.3, tilt=14)
    st += scorch('Burn', 0.0, 0.0, 0.81, 0.25, rng, mat='char_black')
    weather_mats(st, keep_some=0.0, rng=rng)
    root = G.join(st, 'Derelict_Relay')
    densify(root, 0.6)
    G.finalize(root, atlas_dir)
    grime(root, rng, 0.4)
    for p in root.data.polygons:
        p.use_smooth = False
    # receiver head (pivot on the mast axis)
    hp = [G.cyl('HeadBase', 0.2, 0.14, 'hull_dark', loc=(0, 0, 0.07), verts=10),
          G.box('Yoke', -0.08, 0.08, -0.22, 0.22, 0.1, 0.42, 'hull_light', bevel=0.03, seg=1)]
    prof = [(0.0, 0.0), (0.04, 0.22), (0.12, 0.42), (0.11, 0.45), (0.02, 0.2), (-0.06, 0.0)]
    hp.append(G.lathe('Receiver', prof, [0, 0, 1, 2, 2], ['hull_white', 'der_rust', 'hull_mid'],
                      loc=(0.06, 0, 0.42), axis='X', verts=14, closed=False))
    hp.append(G.ring_band('LensRim', 0.13, 0.09, -0.02, 0.02, 'hull_dark', loc=(0.2, 0, 0.42), axis='X', verts=12))
    hp.append(G.cyl('Lens', 0.09, 0.03, 'der_window', loc=(0.2, 0, 0.42), axis='X', verts=12))
    weather_mats(hp)
    head = G.join(hp, 'Relay_Receiver')
    G.finalize(head, atlas_dir)
    grime(head, rng, 0.3, amount=0.6)
    head.location = (0, 0, RELAY_PIVOT_Z)
    head.parent = root
    tgt = G.empty('power_target', loc=(0.22, 0, 0.42), size=0.2)
    tgt.parent = head
    lamp = G.ellipsoid('relay_lamp', 0.1, 0.1, 0.1, 'der_window', seg=10, rings=6)
    G.finalize(lamp, atlas_dir)
    lamp.location = (0.6, 0, 0.92)
    lamp.parent = root
    return root


def build_guild_relay_mast(atlas_dir):
    """M4d Guild relay mast (Guild livery + the Relay_Broken node), see guild_relay.py."""
    import guild_relay
    return guild_relay.build(atlas_dir)


BUILDERS = {'derelict_a': build_a, 'derelict_b': build_b, 'derelict_c': build_c, 'derelict_d': build_d,
            'derelict_relay': build_relay, 'guild_relay_mast': build_guild_relay_mast}


def layouts_json():
    out = {'_schema': {
        'units': 'game units; local frame, +X = dock direction, +Y = left, gameplay plane z = 0',
        'circles': 'list of {x, y, r} collision circles covering the solid structure (drifting pieces excluded)',
        'radius': 'station radius R; dock_port lies at (R, 0) (relay: 0 = no dock)',
        'dockPort': '{x, y} of the dock_port node (docked ship centre = dockPort + (boundingRadius + 1) along +X)',
        'clearRadius': 'no asteroids inside this radius',
        'powerTarget': 'relays only (derelict_relay, guild_relay_mast): receiver lens position {x, y, z} at rest '
                       '(aim the laser here)'}}
    for k, v in LAYOUTS.items():
        e = {'radius': v['R'], 'circles': [{'x': x, 'y': y, 'r': r} for x, y, r in v['circles']]}
        if v['R']:
            e['dockPort'] = {'x': v['R'], 'y': 0.0}
            e['clearRadius'] = v['R'] + CLEAR_MARGIN
        else:
            e['clearRadius'] = 4.0
            e['powerTarget'] = {'x': 0.22, 'y': 0.0, 'z': round(RELAY_PIVOT_Z + 0.42, 3)}
        out[k] = e
    return out
