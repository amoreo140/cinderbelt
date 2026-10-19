"""Guild relay mast (M4d task A1, "Guild relay"): the Guild-livery
variant of derelicts/derelict_relay.glb that the player repairs, powers and
holds to turn a Contested lane sector into a Guarded one.

Same footprint, receiver head and node contract as the derelict relay (the
render reuses the relay code path), dressed in the Guild language of
guild.py: a deep NAVY band (hub band, battery box, legs, wing edge), ORANGE
chevrons pointing forward (+X), the drill-bit emblem flat on the battery lid
(reads from the game camera above) and a navy / orange banded mast.  Clean
Guild hull: light AO + panel fade in COLOR_0, almost no grime.

guild_relay_mast.glb (origin = base centre on the plane, +X = forward, the
game turns it to face the lane):
  Guild_Relay_Mast   static mast: tripod, hub, banded mast, battery box with
                     the emblem, intact solar wing (the REPAIRED look)
    Relay_Receiver   receiver head; pivot on the mast axis at z 2.35 (Blender);
                     may turn around +Y (glTF) - same as the derelict relay
      power_target   EMPTY at the receiver lens (aim the laser here)
    relay_lamp       lamp MESH (der_window: dark until the game lights it)
    Relay_Broken     the BROKEN state: torn wing section hanging off the wing
                     tip, ash / burnt cells over the intact wing, a dangling
                     power cable with a hot torn end (hot_edge, emissive),
                     scorch on the hub and the battery.  Shown while the
                     relay is broken, hidden once repaired.

Collision circles: derelicts.LAYOUTS['guild_relay_mast'] (same as the
derelict relay) -> art/blender/data/derelict_layouts.json.
Budget: <= 2k triangles in total (Relay_Broken included).
"""
import math
import random

from mathutils import Matrix, Vector

from lib import geo as G
from lib import greebles as GR
import guild as GU
import pirates as PI

NAVY = GU.NAVY
ORANGE = GU.ORANGE

# same as derelicts.RELAY_PIVOT_Z (kept literal to avoid a circular import)
PIVOT_Z = 2.35
LAMP = (1.0, 0.0, 0.96)
WING = (-2.25, -1.0, -0.62, 0.62, 1.2)     # x0, x1, y0, y1, z of the solar wing


def _solar_wing(name, x0, x1, y0, y1, z, skip=()):
    """Intact Guild solar wing: hull_mid frame, 2 x 2 cells, navy outer edge
    cap with two orange chevrons (pointing +X)."""
    out = [G.box(name + 'Frame', x0, x1, y0, y1, z - 0.07, z + 0.03, 'hull_mid', bevel=0.02, seg=1)]
    cols, rows = 2, 2
    gx, gy = (x1 - 0.22 - x0) / cols, (y1 - y0) / rows
    for i in range(cols):
        for j in range(rows):
            if (i, j) in skip:
                continue
            out.append(G.box(f'{name}Cell{i}{j}', x0 + 0.22 + i * gx + 0.05, x0 + 0.22 + (i + 1) * gx - 0.05,
                             y0 + j * gy + 0.05, y0 + (j + 1) * gy - 0.05, z + 0.02, z + 0.06, 'solar_cell'))
    # navy edge cap on the outer (-X) end with orange chevrons
    out.append(G.box(name + 'Cap', x0 - 0.02, x0 + 0.2, y0 - 0.02, y1 + 0.02, z - 0.08, z + 0.07, NAVY, bevel=0.015,
                     seg=1))
    for k, yy in enumerate((0.3, -0.3)):
        out += GU.chevron(f'{name}Chev{k}', x0 + 0.17, z + 0.07, 0.17, 0.09, 0.05, ORANGE, y=yy, h=0.015)
    return out


def _cable(name, pts, r=0.028, mat='trim_black'):
    """Thin cable through the points (one 6-sided cylinder per segment)."""
    out = []
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        d = b - a
        c = G.cyl(f'{name}{i}', r, d.length + r, mat, verts=6)
        G.apply_modifiers(c)
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        c.data.transform(Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4())
        out.append(c)
    return out


def _bar(name, p0, p1, w, mat):
    """Plain square bar from p0 to p1 (12 triangles, no bevel)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    ob = G.box(name, 0.0, d.length, -w / 2, w / 2, -w / 2, w / 2, mat)
    q = Vector((1, 0, 0)).rotation_difference(d.normalized())
    ob.data.transform(Matrix.Translation(p0) @ q.to_matrix().to_4x4())
    return ob


def _sag(p0, p1, sag, n):
    """Points of a hanging cable from p0 to p1, sagging by `sag` at the middle."""
    p0, p1 = Vector(p0), Vector(p1)
    return [p0.lerp(p1, t) - Vector((0, 0, sag * 4 * t * (1 - t))) for t in (k / n for k in range(n + 1))]


def _static(rng):
    st = []
    # tripod: navy legs on dark pads with an orange collar
    for k in range(3):
        a = math.radians(90 + k * 120)
        foot = Vector((1.15 * math.cos(a), 1.15 * math.sin(a), -0.55))
        st.append(G.cyl(f'Pad{k}', 0.26, 0.12, 'hull_dark', loc=foot, verts=8))
        st.append(PI.strut(f'Leg{k}', foot + Vector((0, 0, 0.05)), Vector((0, 0, 0.55)), 0.13, NAVY))
    st.append(G.cyl('Hub', 0.38, 0.5, 'hull_light', loc=(0, 0, 0.55), verts=10))
    st.append(G.ring_band('HubBand', 0.41, 0.36, 0.42, 0.64, NAVY, verts=10, smooth=False))
    # mast, banded like the Guild picket mast (navy / orange insulators)
    st.append(G.cyl('Mast', 0.09, 1.55, 'metal_bare', loc=(0, 0, 1.55), verts=8))
    for k, z in enumerate((1.15, 1.5, 1.85)):
        st.append(G.cyl(f'Insulator{k}', 0.24 - 0.03 * k, 0.07, NAVY if k != 1 else ORANGE, loc=(0, 0, z), verts=10))
    st.append(G.cyl('MastCollar', 0.13, 0.12, 'hull_light', loc=(0, 0, 2.22), verts=8))
    # battery box (navy) with a light lid; the Guild emblem lies flat on the lid
    st.append(G.box('Battery', 0.3, 1.12, -0.31, 0.31, 0.2, 0.75, NAVY, bevel=0.04, seg=1))
    st.append(G.box('BatteryLid', 0.33, 1.09, -0.28, 0.28, 0.74, 0.8, 'hull_light', bevel=0.02, seg=1))
    st += GU.drill_emblem('Emblem', 0.64, 0.0, 0.8, s=0.5, h=0.012)
    # forward chevron on the battery front face (stands up, reads from the side)
    for k, z in enumerate((0.36, 0.56)):
        ch = GU.chevron(f'FrontChev{k}', 0.12, -0.012, 0.2, 0.1, 0.05, ORANGE, h=0.024)
        for o in ch:   # tip up (+Z) on the vertical front face
            o.matrix_basis = Matrix.Translation((1.132, 0, z)) @ Matrix.Rotation(math.radians(-90), 4, 'Y') @ o.matrix_basis
        st += ch
    # lamp post on the front of the lid
    st.append(G.cyl('LampPost', 0.06, 0.1, 'hull_dark', loc=(LAMP[0], LAMP[1], 0.84), verts=8))
    # solar wing on its arm (-X), intact
    x0, x1, y0, y1, z = WING
    st.append(PI.strut('WingArm', (-0.2, 0, 0.95), (x1 + 0.05, 0, z - 0.06), 0.08, 'metal_bare'))
    st.append(G.box('WingSpar', x0 + 0.2, x1, -0.05, 0.05, z - 0.12, z - 0.06, 'metal_bare'))
    st += _solar_wing('Wing', x0, x1, y0, y1, z)
    # a short whip antenna beside the receiver (Guild comm cue) with an orange tip
    st.append(G.cyl('Whip', 0.018, 0.9, 'metal_bare', loc=(-0.12, 0.12, 2.65), verts=5))
    st.append(G.cyl('WhipTip', 0.035, 0.06, ORANGE, loc=(-0.12, 0.12, 3.1), verts=6))
    del rng
    return st


def _receiver():
    hp = [G.cyl('HeadBase', 0.2, 0.14, 'hull_dark', loc=(0, 0, 0.07), verts=10),
          G.box('Yoke', -0.08, 0.08, -0.22, 0.22, 0.1, 0.42, NAVY, bevel=0.03, seg=1)]
    prof = [(0.0, 0.0), (0.04, 0.22), (0.12, 0.42), (0.11, 0.45), (0.02, 0.2), (-0.06, 0.0)]
    hp.append(G.lathe('Receiver', prof, [0, 0, 1, 2, 2], ['hull_white', ORANGE, 'hull_mid'],
                      loc=(0.06, 0, 0.42), axis='X', verts=14, closed=False))
    hp.append(G.ring_band('LensRim', 0.13, 0.09, -0.02, 0.02, 'hull_dark', loc=(0.2, 0, 0.42), axis='X', verts=12))
    hp.append(G.cyl('Lens', 0.09, 0.03, 'der_window', loc=(0.2, 0, 0.42), axis='X', verts=12))
    return hp


def _broken(rng):
    """Damage overlay (Relay_Broken), in the root frame."""
    br = []
    x0, x1, y0, y1, z = WING
    # 1) torn outer wing section hanging off the wing tip: a frame piece with one cell left, the other
    #    gone, hinged on the cap at x0 and swung down; its torn inner edge glows (hot_edge)
    flap = [G.box('FlapFrame', -0.62, 0.0, -0.55, 0.42, -0.05, 0.03, 'hull_mid', bevel=0.015, seg=1),
            G.box('FlapCell', -0.56, -0.08, -0.5, -0.06, 0.02, 0.05, 'solar_cell'),
            G.box('FlapAsh', -0.5, -0.12, 0.02, 0.36, 0.0, 0.045, 'ash'),
            G.box('FlapTorn', -0.64, -0.56, -0.5, 0.4, -0.04, 0.04, 'hot_edge')]
    for o in flap:
        o.matrix_basis = (Matrix.Translation((x0 - 0.02, 0.0, z - 0.02)) @ Matrix.Rotation(math.radians(-8), 4, 'Z')
                          @ Matrix.Rotation(math.radians(-62), 4, 'Y') @ Matrix.Rotation(math.radians(9), 4, 'X')
                          @ o.matrix_basis)
    br += flap
    # 2) burnt / smashed cells on the intact wing: ash and char plates lying over two cells
    gx = (x1 - 0.22 - x0) / 2
    cx0 = x0 + 0.22
    br.append(G.box('AshCell', cx0 + 0.04, cx0 + gx - 0.03, 0.02, y1 - 0.03, z + 0.055, z + 0.075, 'ash'))
    br.append(G.box('CharCell', cx0 + gx + 0.06, x1 - 0.06, y0 + 0.04, -0.04, z + 0.055, z + 0.07, 'char_black'))
    burn = [G.prism('WingBurn', [(cx0 + gx - 0.2, -0.25), (cx0 + gx + 0.15, -0.38), (cx0 + gx + 0.25, 0.05),
                                 (cx0 + gx - 0.05, 0.2)], z + 0.07, z + 0.082, 'scorch')]
    br += burn
    # 3) dangling power cable: from the top insulator, sagging past the wing arm, down below the base;
    #    the torn end glows (hot_edge)
    pts = _sag((-0.08, -0.1, 1.95), (-0.55, -0.55, 1.1), 0.18, 3) + \
        [Vector((-0.7, -0.62, 0.55)), Vector((-0.75, -0.66, 0.05)), Vector((-0.68, -0.7, -0.35))]
    br += _cable('Cable', pts)
    tip = Vector(pts[-1])
    br.append(G.cyl('CableEnd', 0.05, 0.1, 'hot_edge', loc=tip - Vector((0, 0, 0.05)), verts=6))
    for k, (dx, dy, dz) in enumerate(((0.09, 0.02, -0.12), (-0.07, 0.08, -0.1), (0.02, -0.09, -0.14))):
        br.append(_bar(f'Spark{k}', tip - Vector((0, 0, 0.08)), tip + Vector((dx, dy, dz - 0.08)), 0.018,
                       'hot_edge'))
    # 4) scorch on the hub top and a burst panel on the battery side
    hub = [(0.05 + 0.28 * math.cos(a), 0.28 * math.sin(a) * rng.uniform(0.7, 1.0))
           for a in (math.radians(v) for v in range(100, 400, 45))]
    br.append(G.prism('HubScorch', hub, 0.8, 0.812, 'char_black'))
    br.append(G.box('BatBurst', 0.5, 0.86, -0.335, -0.3, 0.3, 0.62, 'char_black'))
    br.append(G.box('BatBurstEdge', 0.52, 0.84, -0.345, -0.33, 0.6, 0.63, 'hot_edge'))
    br.append(G.box('LidAsh', 0.34, 0.42, -0.27, -0.04, 0.8, 0.83, 'ash'))
    # 5) a snapped insulator disc lying askew on the hub
    disc = G.cyl('LooseDisc', 0.17, 0.05, NAVY, verts=10)
    G.transform(disc, loc=(-0.18, 0.2, 0.86), rot=(18, -12, 0))
    br.append(disc)
    return br


def build(atlas_dir, seed=606):
    import bpy
    rng = random.Random(seed)
    root = G.join(_static(rng), 'Guild_Relay_Mast')
    head = G.join(_receiver(), 'Relay_Receiver')
    head.location = (0, 0, PIVOT_Z)
    head.parent = root
    broken = G.join(_broken(rng), 'Relay_Broken')
    broken.parent = root
    for ob in (root, broken):
        for p in ob.data.polygons:
            p.use_smooth = False
    bpy.context.view_layer.update()
    # clean Guild hull: AO + light panel fade (COLOR_0, logical materials still assigned); the head
    # turns, so it is weathered on its own; the damage overlay is dirtier
    GU.light_weather(root, seed + 1, extra=(head, broken), grime=0.1)
    GU.light_weather(head, seed + 2, grime=0.08)
    GR.weather(broken, random.Random(seed + 3), extra=(root,), ao=0.5, near=0.3, far=1.2, grime=0.35,
               panel=0.08, under=0.2, soot=0.6)
    for ob in (root, head, broken):
        G.finalize(ob, atlas_dir)
    tgt = G.empty('power_target', loc=(0.22, 0, 0.42), size=0.2)
    tgt.parent = head
    lamp = G.ellipsoid('relay_lamp', 0.1, 0.1, 0.1, 'der_window', seg=10, rings=6)
    G.finalize(lamp, atlas_dir)
    GR.ensure_col(lamp)
    lamp.location = LAMP
    lamp.parent = root
    return root
