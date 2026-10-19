"""Planetary base (spec 7.2, M5b): the hub/platform + the 9 slot modules.

ATTACH CONVENTION (base_modules.json is generated from the constants below)
  * base_hub.glb origin = base centre on the planet surface (z = 0 = ground,
    Blender +Z / glTF +Y = surface normal).  On a planet place the hub on the
    surface point with its up axis along the surface normal (any yaw).
  * 8 slots on a ring of radius SLOT_R, slot i at angle 45*i deg from +X.
    Each slot = octagonal pad (node Pad_<i>, incl. its bridge to the hub) and
    an EMPTY slot_<i> on the pad top (z = PAD_TOP), local +X = outward (away
    from the hub).  Level unlock order (spec 7.2: U1 = 4, U2 = 6, U3 = 8):
    U1 = slots 0, 2, 4, 6;  U2 adds 1, 5;  U3 adds 3, 7.  Hide Pad_<i> of
    locked slots.
  * Every module glb (base_module_<id>.glb): origin = centre of the pad top,
    module built along local +X = outward, z up.  Whole module (at any
    animation pose) stays inside a circle of radius MODULE_R around the
    origin, so neighbouring slots never touch.  Height budget ~4.5 (tower 4.9).
    Place: module.matrix = hub.matrix * slot_<i>.matrix.
  * Ground planets: show Hub_Legs, hide Hub_Floats.  Gas planets ("float"):
    the reverse (buoyancy envelopes; the gas probe dangles its tether below).
  * Hub_Upgrade_2 / Hub_Upgrade_3: visible hub growth at base level U2 / U3.

Same human hull language as the stations (light decks, dark structure,
orange belts, warm windows, beacons at extremities) at "seen from orbit"
scale: every module has one bold top-down marker (derrick square, turbine
ring, blue wings, radiator X, crate grid, molten crucibles, coil rail,
twin-barrel turret, glowing landing ring).
"""
import math

from mathutils import Matrix, Vector

from lib import geo as G
import structures as S
import pirates as PI

SLOT_R = 8.5
PAD_TOP = 0.6
PAD_R = 2.55            # octagon circumradius of a pad
MODULE_R = 2.25         # module footprint radius
HUB_R = 3.4
LEVEL_SLOTS = {1: [0, 2, 4, 6], 2: [0, 1, 2, 4, 5, 6], 3: list(range(8))}
ACC = 'accent_iron'


def _oct(r, rot=22.5, cx=0.0, cy=0.0):
    return [(cx + r * math.cos(math.radians(rot + 45 * i)), cy + r * math.sin(math.radians(rot + 45 * i)))
            for i in range(8)]


def _node(name, parts, atlas_dir, pivot, parent, rot_z=0.0):
    """Join parts built in the parent's frame into a child node whose origin
    (pivot) is at `pivot`, optionally rotated about Z (node yaw)."""
    ob = G.join(parts, name)
    G.finalize(ob, atlas_dir)
    m = Matrix.Rotation(math.radians(-rot_z), 4, 'Z') @ Matrix.Translation([-c for c in pivot])
    ob.data.transform(m)
    ob.location = pivot
    ob.rotation_euler = (0, 0, math.radians(rot_z))
    ob.parent = parent
    return ob


def _lamp(name, loc, key, r=0.16):
    b = G.ellipsoid(name, r, r, r, key, seg=8, rings=4)
    b.location = loc
    G.bake_transform(b)
    return b


def _rot(parts, yaw, loc=(0, 0, 0)):
    """Bake a yaw + translation into already-built parts (module-local -> slot)."""
    m = Matrix.Translation(loc) @ Matrix.Rotation(math.radians(yaw), 4, 'Z')
    for o in parts:
        G.apply_modifiers(o)
        G.bake_transform(o)
        o.data.transform(m)
    return parts


def _finish(name, st, atlas_dir, beacons=(), extra=()):
    root = G.join(st, name)
    G.finalize(root, atlas_dir)
    for i, (loc, key) in enumerate(beacons):
        b = S.beacon(f'beacon_{i}', (0, 0, 0), key, r=0.14)
        G.finalize(b, atlas_dir)
        b.location = loc
        b.parent = root
    for e in extra:
        e.parent = root
    return root


def _empty(name, loc, yaw=0.0, pitch=0.0, size=0.3):
    e = G.empty(name, loc=loc, size=size)
    e.rotation_euler = (0, math.radians(-pitch), math.radians(yaw))
    return e


# ----------------------------------------------------------------------------
# hub
# ----------------------------------------------------------------------------
def slot_xy(i):
    a = math.radians(45 * i)
    return SLOT_R * math.cos(a), SLOT_R * math.sin(a), 45.0 * i


def _pad_parts(i):
    """Octagonal pad + bridge to the hub, built in the slot-local frame (+X out), z from the ground."""
    st = []
    st.append(G.prism(f'P{i}Slab', _oct(PAD_R), 0.0, PAD_TOP - 0.16, 'base_concrete_dark', bevel=0.05, seg=1))
    st.append(G.prism(f'P{i}Belt', _oct(PAD_R + 0.04), PAD_TOP - 0.36, PAD_TOP - 0.22, ACC, bevel=0.02, seg=1))
    st.append(G.prism(f'P{i}Deck', _oct(PAD_R - 0.08), PAD_TOP - 0.17, PAD_TOP, 'hull_light', bevel=0.04, seg=1))
    st.append(G.prism(f'P{i}Inner', _oct(MODULE_R - 0.1), PAD_TOP - 0.01, PAD_TOP + 0.005, 'hull_dark'))
    st.append(G.ring_band(f'P{i}Mark', MODULE_R - 0.12, MODULE_R - 0.24, PAD_TOP, PAD_TOP + 0.012, 'hull_mid', verts=16))
    # corner lamps on 4 of the 8 octagon corners (outer side)
    for k, (x, y) in enumerate(_oct(PAD_R - 0.22)):
        if x > 0.3 and k % 2 == 0:
            st.append(_lamp(f'P{i}Lamp{k}', (x, y, PAD_TOP + 0.04), 'light_amber', 0.07))
    # bridge from the hub rim to the pad (inward = -X)
    x0, x1 = -(SLOT_R - HUB_R - 0.55), -(PAD_R - 0.2)
    st += S.deck_block(f'P{i}Bridge', x0, x1, -0.55, 0.55, 0.12, 0.5, accent='hull_mid', inset=0.1, plate_h=0.16)
    st.append(G.cyl(f'P{i}Pipe', 0.09, x1 - x0, 'metal_bare', loc=((x0 + x1) / 2, -0.68, 0.38), axis='X', verts=8))
    st.append(G.cyl(f'P{i}Pipe2', 0.07, x1 - x0, ACC, loc=((x0 + x1) / 2, 0.68, 0.38), axis='X', verts=8))
    for k in range(3):
        x = x0 + (k + 0.5) * (x1 - x0) / 3
        st.append(G.box(f'P{i}Rib{k}', x - 0.1, x + 0.1, -0.78, 0.78, 0.0, 0.52, 'hull_dark', bevel=0.03, seg=1))
        st.append(G.box(f'P{i}RunL{k}', x + 0.2, x + 0.4, -0.45, -0.35, 0.5, 0.53, 'engine_glow'))
    return st


def build_hub(atlas_dir):
    st = []
    # foundation deck (octagon) + hub drum (the unfolded landing module)
    st.append(G.prism('Found', _oct(4.3), 0.0, 0.35, 'base_concrete_dark', bevel=0.06, seg=1))
    st.append(G.prism('FoundTop', _oct(4.15), 0.3, 0.45, 'base_concrete', bevel=0.04, seg=1))
    st += S.hub('Hub', HUB_R, 0.45, 2.3, accent=ACC, verts=16)
    st.append(G.ring_band('HubRim', HUB_R * 0.74, HUB_R * 0.6, 2.28, 2.36, 'hull_mid', verts=16, smooth=False))
    # lander capsule on top (the "Vysadkovy modul")
    st.append(G.lathe('Lander', [(2.3, 0.0), (2.3, 1.65), (2.75, 1.7), (3.35, 1.5), (3.75, 1.05), (3.95, 0.0)],
                      [0, 1, 1, 2, 3], ['hull_dark', 'hull_light', 'hull_white', 'hull_light'], axis='Z',
                      verts=16, closed=False, smooth=False))
    st.append(G.ring_band('LanderBelt', 1.73, 1.6, 2.55, 2.75, ACC, verts=16, smooth=False))
    st.append(G.ring_band('LanderWin', 1.62, 1.45, 3.12, 3.24, 'window_warm', verts=16, smooth=False))
    st.append(G.cyl('Hatch', 0.5, 0.08, 'hull_dark', loc=(0, 0, 3.97), verts=12))
    st.append(G.ring_band('HatchRing', 0.58, 0.48, 3.92, 4.02, ACC, verts=12))
    # four lander thruster pods (reads "it landed here") at 45 + 90k
    for k in range(4):
        a = math.radians(45 + 90 * k)
        x, y = 1.85 * math.cos(a), 1.85 * math.sin(a)
        st.append(G.cyl(f'Thr{k}', 0.32, 0.6, 'hull_mid', loc=(x, y, 2.65), verts=10, bevel=0.03, seg=1))
        st.append(G.cyl(f'ThrBell{k}', 0.28, 0.25, 'nozzle_in', loc=(x, y, 2.25), verts=10, r2=0.2))
    # comm mast with a red beacon
    st += S.mast('Mast', (-2.2, 0.0, 2.2), 2.6, r=0.07)
    beacons = [((-2.2, 0.0, 4.9), 'light_red')]
    for k in range(4):
        a = math.radians(22.5 + 90 * k)
        beacons.append(((4.25 * math.cos(a), 4.25 * math.sin(a), 0.5), 'light_amber'))
    root = _finish('Base_Hub', st, atlas_dir, beacons)

    # pads (with bridges), each a node at its slot centre on the ground
    for i in range(8):
        x, y, yaw = slot_xy(i)
        pad = _node(f'Pad_{i}', _pad_parts(i), atlas_dir, (0, 0, 0), root)
        pad.location = (x, y, 0)
        pad.rotation_euler = (0, 0, math.radians(yaw))
        e = _empty(f'slot_{i}', (x, y, PAD_TOP), yaw, size=0.6)
        e.parent = root

    # radar dish (spins)
    rp = S.mast('RadarMast', (0, 0, 0), 0.5, r=0.06)
    prof = [(0.0, 0.0), (0.03, 0.25), (0.12, 0.62), (0.09, 0.66), (0.0, 0.3), (-0.06, 0.0)]
    rp.append(G.lathe('RadarDish', prof, [0, 0, 1, 2, 2], ['hull_white', ACC, 'hull_mid'],
                      loc=(0.0, 0, 0.55), axis='Z', verts=16, closed=False, rot=(0, 60, 0)))
    radar = _node('Hub_Radar', rp, atlas_dir, (0, 0, 0), root)
    radar.location = (0.0, -2.2, 2.2)

    # ground mode: landing legs + foot pads (between the bridges)
    lg = []
    for k in range(8):
        a = math.radians(22.5 + 45 * k)
        c, s = math.cos(a), math.sin(a)
        lg.append(PI.strut(f'Leg{k}', (3.0 * c, 3.0 * s, 1.2), (5.2 * c, 5.2 * s, 0.12), 0.22, 'hull_mid'))
        lg.append(PI.strut(f'LegB{k}', (3.4 * c, 3.4 * s, 0.6), (5.0 * c, 5.0 * s, 0.25), 0.14, ACC))
        lg.append(G.cyl(f'Foot{k}', 0.42, 0.14, 'hull_dark', loc=(5.25 * c, 5.25 * s, 0.07), verts=10, bevel=0.03, seg=1))
    _node('Hub_Legs', lg, atlas_dir, (0, 0, 0), root)

    # float mode (gas planets): four buoyancy envelopes + repulsor rings
    fl = []
    for k in range(4):
        a = math.radians(22.5 + 90 * k)
        c, s = math.cos(a), math.sin(a)
        env = G.ellipsoid(f'Env{k}', 1.45, 0.75, 0.75, 'hull_white', seg=16, rings=10)
        G.transform(env, loc=(5.0 * c, 5.0 * s, 1.15), rot=(0, 0, math.degrees(a)))
        fl.append(env)
        for j, d in enumerate((-0.7, 0.0, 0.7)):
            band = G.ring_band(f'EnvBand{k}{j}', 0.78 if j == 1 else 0.68, 0.6, -0.06, 0.06, ACC if j == 1 else 'hull_mid',
                               axis='X', verts=16)
            G.transform(band, loc=(5.0 * c + d * c, 5.0 * s + d * s, 1.15), rot=(0, 0, math.degrees(a)))
            fl.append(band)
        fl.append(PI.strut(f'EnvArm{k}', (3.1 * c, 3.1 * s, 1.2), (4.3 * c, 4.3 * s, 1.15), 0.18, 'hull_dark'))
        fl.append(G.ring_band(f'Repulsor{k}', 0.55, 0.38, 0.28, 0.36, 'engine_glow', loc=(5.0 * c, 5.0 * s, 0)))
    fl.append(G.ring_band('HubRepulsor', 3.2, 2.6, -0.04, 0.04, 'engine_glow'))
    _node('Hub_Floats', fl, atlas_dir, (0, 0, 0), root)

    # U2: habitat ring around the lander (window band) + two hab blocks on the foundation
    u2 = S.ring_hab('HabRing', 2.3, 0.5, 0.42, 2.55, accent=ACC, segs=24, ribs=8)
    for k, a_deg in enumerate((22.5, 202.5)):
        a = math.radians(a_deg)
        hab = S.deck_block(f'Hab{k}', -0.55, 0.55, -0.45, 0.45, 0.45, 1.35, accent=ACC)
        hab.append(G.box(f'HabWin{k}', 0.54, 0.58, -0.3, 0.3, 0.95, 1.08, 'window_warm'))
        u2 += _rot(hab, a_deg, (3.75 * math.cos(a), 3.75 * math.sin(a), 0))
    _node('Hub_Upgrade_2', u2, atlas_dir, (0, 0, 0), root)
    # U3: glowing command halo over the hub rim + a tall comm tower with a big dish
    u3 = S.mast('Tower3', (0.0, 2.95, 1.95), 3.6, r=0.1, dish=0.75)
    u3.append(G.ring_band('LanderHalo', 3.15, 2.95, 2.18, 2.28, 'tier_glow_ti', verts=32))
    for k in range(4):
        a = math.radians(45 + 90 * k)
        u3.append(G.cyl(f'HaloPost{k}', 0.06, 0.4, 'hull_mid', loc=(3.05 * math.cos(a), 3.05 * math.sin(a), 2.0), verts=6))
    _node('Hub_Upgrade_3', u3, atlas_dir, (0, 0, 0), root)
    return root


# ----------------------------------------------------------------------------
# modules (local frame: origin = pad top centre, +X = outward)
# ----------------------------------------------------------------------------
def _hazard_ring(name, r_out, r_in, z0, z1, n=16):
    out = []
    out.append(G.ring_band(name, r_out, r_in, z0, z1, 'trim_black', verts=24))
    for k in range(0, 24, 2):
        a = math.radians(k * 15 + 3)
        b = G.box(f'{name}Y{k}', r_in + 0.01, r_out + 0.01, -0.06, 0.06, z1 - 0.005, z1 + 0.012, 'fuel_yellow')
        G.transform(b, rot=(0, 0, math.degrees(a)))
        out.append(b)
    return out


def build_drill(atlas_dir):
    st = []
    # bore well with hazard rim
    st.append(G.cyl('Well', 0.95, 0.22, 'hull_dark', loc=(0, 0, 0.11), verts=24, bevel=0.03, seg=1))
    st += _hazard_ring('WellRim', 0.95, 0.66, 0.2, 0.26)
    st.append(G.cyl('WellHole', 0.64, 0.05, 'nozzle_in', loc=(0, 0, 0.23), verts=24))
    # derrick: 4 tapering posts + X braces + crown
    base, top, H = 0.85, 0.34, 4.0
    corners = ((1, 1), (-1, 1), (-1, -1), (1, -1))
    for k, (sx, sy) in enumerate(corners):
        st.append(PI.strut(f'Post{k}', (sx * base, sy * base, 0.0), (sx * top, sy * top, H), 0.13,
                           ACC if k % 2 == 0 else 'hull_light'))
        st.append(G.box(f'PostFoot{k}', sx * base - 0.18, sx * base + 0.18, sy * base - 0.18, sy * base + 0.18,
                        0.0, 0.14, 'hull_dark', bevel=0.02, seg=1))
    for lvl in range(3):
        z0, z1 = 0.35 + lvl * 1.2, 0.35 + (lvl + 1) * 1.2
        w0 = base + (top - base) * z0 / H
        w1 = base + (top - base) * z1 / H
        for k in range(4):
            (ax, ay), (bx, by) = corners[k], corners[(k + 1) % 4]
            st.append(PI.strut(f'BrX{lvl}{k}', (ax * w0, ay * w0, z0), (bx * w1, by * w1, z1), 0.06, 'hull_mid'))
            st.append(PI.strut(f'BrH{lvl}{k}', (ax * w1, ay * w1, z1), (bx * w1, by * w1, z1), 0.06, 'hull_mid'))
    st.append(G.box('Crown', -0.5, 0.5, -0.5, 0.5, H - 0.05, H + 0.25, 'hull_light', bevel=0.04, seg=1))
    st.append(G.box('CrownBelt', -0.52, 0.52, -0.52, 0.52, H + 0.02, H + 0.1, ACC, bevel=0.01, seg=1))
    # ore hopper toward the hub + inclined conveyor from the well
    st += S.deck_block('Hopper', -2.0, -1.15, -0.65, 0.65, 0.0, 1.05, accent=ACC, inset=0.1, plate_h=0.12)
    st.append(G.box('HopperOre', -1.9, -1.25, -0.52, 0.52, 1.0, 1.12, 'rock_copper_2'))
    for k, (x, y) in enumerate(((-1.75, -0.3), (-1.5, 0.2), (-1.4, -0.15), (-1.68, 0.3))):
        st.append(G.ellipsoid(f'Nug{k}', 0.12, 0.1, 0.08, 'ore_copper', loc=(x, y, 1.12), seg=6, rings=4))
    st.append(PI.strut('Conveyor', (-0.55, 0.0, 0.35), (-1.3, 0.0, 1.15), 0.32, 'hull_mid'))
    st.append(PI.strut('ConveyorBelt', (-0.55, 0.0, 0.53), (-1.3, 0.0, 1.33), 0.22, 'trim_black'))
    # power box + status lamp
    st.append(G.box('PowerBox', 0.95, 1.55, -1.45, -0.85, 0.0, 0.7, 'hull_dark', bevel=0.04, seg=1))
    st.append(G.box('PowerLid', 0.98, 1.52, -1.42, -0.88, 0.68, 0.76, 'hull_light', bevel=0.02, seg=1))
    st.append(G.box('PowerGlow', 1.54, 1.57, -1.35, -0.95, 0.4, 0.5, 'reactor_glow'))
    root = _finish('BaseModule_Drill', st, atlas_dir, [((0, 0, H + 0.4), 'light_red')])
    # drill string + head (spins around +Z = glTF +Y), pivot on the well axis at the pad top
    dr = [G.cyl('Shaft', 0.11, 3.7, 'metal_bare', loc=(0, 0, 1.75), verts=10),
          G.cyl('Motor', 0.36, 0.55, 'hull_dark', loc=(0, 0, 3.35), verts=12, bevel=0.03, seg=1),
          G.ring_band('MotorStripe', 0.38, 0.32, 3.3, 3.42, ACC, verts=12),
          G.cyl('Collar', 0.3, 0.2, 'hull_light', loc=(0, 0, 0.55), verts=12, bevel=0.02, seg=1)]
    for k in range(6):   # auger flights
        b = G.box(f'Flight{k}', 0.08, 0.34, -0.03, 0.03, -0.04, 0.04, ACC)
        G.transform(b, loc=(0, 0, 0.8 + k * 0.22), rot=(0, 18, k * 60))
        dr.append(b)
    for k in range(2):
        b = G.box(f'MotorFin{k}', 0.36, 0.5, -0.04, 0.04, 3.1, 3.6, 'hull_mid')
        G.transform(b, rot=(0, 0, 90 * k))
        dr.append(b)
    _node('Drill_Rotor', dr, atlas_dir, (0, 0, 0), root)
    return root


def build_gas_probe(atlas_dir):
    st = []
    # tripod holding the turbine duct
    for k in range(3):
        a = math.radians(30 + 120 * k)
        st.append(PI.strut(f'Leg{k}', (1.9 * math.cos(a), 1.9 * math.sin(a), 0.0),
                           (1.45 * math.cos(a), 1.45 * math.sin(a), 1.25), 0.16, 'hull_mid'))
        st.append(G.cyl(f'Foot{k}', 0.24, 0.12, 'hull_dark', loc=(1.9 * math.cos(a), 1.9 * math.sin(a), 0.06), verts=10))
    st.append(G.ring_band('Duct', 1.55, 1.32, 1.05, 1.75, 'hull_light', verts=24, smooth=False))
    st.append(G.ring_band('DuctBelt', 1.58, 1.5, 1.28, 1.48, ACC, verts=24, smooth=False))
    st.append(G.ring_band('DuctLip', 1.36, 1.25, 1.7, 1.78, 'he3_glow', verts=24, smooth=False))
    # central intake column (goes down through the pad: the tether)
    st.append(G.cyl('Column', 0.32, 1.4, 'hull_dark', loc=(0, 0, 0.7), verts=12, bevel=0.03, seg=1))
    st.append(G.cyl('Tether', 0.09, 6.0, 'metal_bare', loc=(0, 0, -3.0), verts=8))
    st.append(G.cyl('TetherHead', 0.26, 0.6, 'hull_mid', loc=(0, 0, -6.2), verts=10, r2=0.16))
    st.append(G.ring_band('TetherGlow', 0.27, 0.2, -6.0, -5.9, 'he3_glow', verts=10))
    for k in range(3):
        st.append(G.ring_band(f'TetherClamp{k}', 0.14, 0.08, -1.0 - 1.6 * k, -0.9 - 1.6 * k, ACC, verts=8))
    # He3 pressure spheres toward the hub
    for k, y in enumerate((0.95, -0.95)):
        st.append(G.ellipsoid(f'Sphere{k}', 0.52, 0.52, 0.52, 'hull_white', loc=(-1.25, y, 0.62), seg=16, rings=10))
        st.append(G.ring_band(f'SphereBand{k}', 0.55, 0.45, 0.58, 0.68, 'he3_glow', loc=(-1.25, y, 0), verts=16))
        st.append(G.cyl(f'SphereBase{k}', 0.3, 0.14, 'hull_dark', loc=(-1.25, y, 0.07), verts=12))
    st.append(G.cyl('Manifold', 0.07, 1.9, 'metal_bare', loc=(-1.25, 0, 0.35), axis='Y', verts=8))
    st.append(PI.strut('FeedPipe', (-1.25, 0.0, 0.35), (-0.3, 0.0, 0.5), 0.12, ACC))
    root = _finish('BaseModule_GasProbe', st, atlas_dir, [((1.55, 0, 1.85), 'light_amber')])
    # turbine rotor (spins around +Z = glTF +Y)
    rp = [G.cyl('RotorHub', 0.3, 0.32, 'hull_light', loc=(0, 0, 1.42), verts=12, bevel=0.03, seg=1),
          G.cyl('RotorCap', 0.18, 0.08, 'he3_glow', loc=(0, 0, 1.62), verts=12)]
    for k in range(5):
        bl = G.box(f'Blade{k}', 0.25, 1.28, -0.16, 0.16, -0.025, 0.025, 'hull_mid' if k % 2 else 'hull_light',
                   bevel=0.01, seg=1)
        G.transform(bl, loc=(0, 0, 1.42), rot=(24, 0, 72 * k))
        rp.append(bl)
    _node('Probe_Rotor', rp, atlas_dir, (0, 0, 1.42), root)
    return root


def build_solar(atlas_dir):
    st = []
    st.append(G.cyl('PylonBase', 0.55, 0.3, 'hull_dark', loc=(0, 0, 0.15), verts=12, bevel=0.03, seg=1))
    st.append(G.cyl('Pylon', 0.2, 1.3, 'hull_mid', loc=(0, 0, 0.9), verts=10))
    st.append(G.ring_band('PylonBelt', 0.24, 0.18, 0.55, 0.7, ACC, verts=10))
    # battery banks toward the hub
    for k, y in enumerate((0.75, -0.75)):
        st.append(G.box(f'Bat{k}', -1.85, -1.05, y - 0.32, y + 0.32, 0.0, 0.55, 'hull_dark', bevel=0.04, seg=1))
        st.append(G.box(f'BatLid{k}', -1.82, -1.08, y - 0.29, y + 0.29, 0.53, 0.6, 'hull_light', bevel=0.02, seg=1))
        for j in range(3):
            st.append(G.box(f'BatCell{k}{j}', -1.86, -1.84, y - 0.22 + j * 0.16, y - 0.12 + j * 0.16, 0.18, 0.42,
                            'battery_glow'))
    root = _finish('BaseModule_Solar', st, atlas_dir, [((-1.45, 0, 0.75), 'light_amber')])
    # tracking array: yaws around +Z (glTF +Y) at the pylon top; wings tilted 18 deg toward +X
    pz = 1.6
    ar = [G.box('Spine', -0.12, 0.12, -1.95, 1.95, pz - 0.1, pz + 0.06, 'hull_dark', bevel=0.02, seg=1),
          G.cyl('Head', 0.26, 0.24, 'hull_light', loc=(0, 0, pz), verts=12, bevel=0.02, seg=1)]
    for s in (1, -1):
        wing = S.solar_wing(f'Wing{s}', -1.0, 1.0, 0.3 if s > 0 else -1.95, 1.95 if s > 0 else -0.3, 0.0, cols=4, rows=3)
        for w in wing:
            G.transform(w, loc=(0, 0, pz + 0.1), rot=(0, -18, 0))
        ar += wing
        ar.append(G.box(f'WingTrim{s}', -1.02, 1.02, s * 1.93 - 0.04, s * 1.93 + 0.04, pz + 0.05, pz + 0.13, ACC))
    _node('Solar_Array', ar, atlas_dir, (0, 0, pz), root)
    return root


def build_reactor(atlas_dir):
    st = []
    st.append(G.cyl('Plinth', 1.3, 0.3, 'hull_dark', loc=(0, 0, 0.15), verts=16, bevel=0.04, seg=1))
    st.append(G.lathe('Drum', [(0.3, 0.0), (0.3, 1.05), (1.9, 1.05), (2.4, 0.85), (2.75, 0.45), (2.85, 0.0)],
                      [0, 1, 2, 3, 3], ['hull_dark', 'hull_light', 'hull_white', 'hull_white'], axis='Z',
                      verts=20, closed=False, smooth=False))
    st.append(G.ring_band('DrumBelt', 1.08, 0.98, 0.7, 0.9, ACC, verts=20, smooth=False))
    st.append(G.ring_band('DrumWin', 1.07, 0.98, 1.35, 1.5, 'reactor_glow', verts=20, smooth=False))
    st.append(G.cyl('Vent', 0.3, 0.2, 'hull_mid', loc=(0, 0, 2.9), verts=12))
    st.append(G.cyl('VentGlow', 0.22, 0.04, 'reactor_glow', loc=(0, 0, 3.0), verts=12))
    # four radiator fins in an X (the top-down marker)
    for k in range(4):
        a = 45 + 90 * k
        fin = [G.box(f'Rad{k}', 1.15, 2.15, -0.05, 0.05, 0.25, 1.95, 'hull_white', bevel=0.02, seg=1),
               G.box(f'RadRoot{k}', 0.95, 1.2, -0.14, 0.14, 0.25, 1.95, 'hull_dark', bevel=0.02, seg=1),
               G.box(f'RadTop{k}', 1.15, 2.15, -0.08, 0.08, 1.93, 2.0, ACC)]
        for j in range(4):
            x = 1.3 + j * 0.24
            fin.append(G.box(f'RadLine{k}{j}', x - 0.025, x + 0.025, -0.065, 0.065, 0.35, 1.85, 'panel_line'))
        for o in fin:
            G.transform(o, rot=(0, 0, a))
        st += fin
    # fuel-cell feeder (consumes 0.02 fuel cells / s)
    st += S.vtank('Feed', (-1.65, 0.0, 0.0), 0.32, 1.1, body='fuel_yellow', cap='hull_light')
    st.append(PI.strut('FeedPipe', (-1.4, 0, 0.5), (-1.0, 0, 0.6), 0.1, 'metal_bare'))
    root = _finish('BaseModule_Reactor', st, atlas_dir, [((1.62, 0, 2.1), 'light_amber'), ((-1.62, 0, 2.1), 'light_amber')])
    # plasma ring (spins around +Z) with 4 emitter pods so the spin reads
    rr = [G.torus('Ring', 1.22, 0.07, 'reactor_glow', loc=(0, 0, 2.2), maj=32, mnr=8)]
    for k in range(4):
        a = math.radians(90 * k)
        rr.append(G.box(f'Pod{k}', -0.14, 0.14, -0.1, 0.1, -0.1, 0.1, 'hull_dark', bevel=0.02, seg=1))
        G.transform(rr[-1], loc=(1.22 * math.cos(a), 1.22 * math.sin(a), 2.2), rot=(0, 0, math.degrees(a)))
    _node('Reactor_Core', rr, atlas_dir, (0, 0, 2.2), root)
    return root


CRATE_KEYS = ('accent_iron', 'accent_titanium', 'fuel_yellow', 'accent_trader', 'hull_light', 'accent_iron',
              'ore_copper', 'accent_titanium')
CRATE_POS = [(-0.75, -0.75, 0), (-0.75, 0.0, 0), (-0.75, 0.75, 0), (0.25, -0.75, 0), (0.25, 0.0, 0), (0.25, 0.75, 0),
             (-0.75, -0.38, 1), (-0.75, 0.38, 1)]   # (x, y, layer) - index = fill order


def build_storage(atlas_dir):
    st = []
    st.append(G.box('Floor', -1.5, 1.5, -1.5, 1.5, 0.0, 0.18, 'hull_dark', bevel=0.04, seg=1))
    st.append(G.box('FloorPlate', -1.42, 1.42, -1.42, 1.42, 0.17, 0.22, 'floor_dark'))
    for k, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        st.append(G.box(f'Post{k}', sx * 1.42 - 0.1, sx * 1.42 + 0.1, sy * 1.42 - 0.1, sy * 1.42 + 0.1, 0.18, 2.35,
                        ACC if k % 2 == 0 else 'hull_light', bevel=0.02, seg=1))
    for s in (1, -1):
        st.append(G.box(f'RailX{s}', -1.5, 1.5, s * 1.42 - 0.09, s * 1.42 + 0.09, 2.2, 2.4, 'hull_light', bevel=0.02, seg=1))
    # gantry crane bridge across the rails (static, parked over the front row)
    st.append(G.box('Gantry', 0.95, 1.25, -1.55, 1.55, 2.38, 2.6, ACC, bevel=0.03, seg=1))
    st.append(G.box('Trolley', 0.9, 1.3, -0.25, 0.25, 2.2, 2.42, 'hull_dark', bevel=0.02, seg=1))
    st.append(G.cyl('Hook', 0.03, 0.6, 'metal_bare', loc=(1.1, 0, 1.9), verts=6))
    # loading dock lip toward the hub
    st.append(G.box('Dock', -2.05, -1.5, -0.8, 0.8, 0.0, 0.32, 'hull_mid', bevel=0.03, seg=1))
    st.append(G.box('DockHaz', -2.03, -1.95, -0.75, 0.75, 0.31, 0.335, 'fuel_yellow'))
    # a fixed big tank at the front (base capacity)
    st += S.vtank('Tank', (1.05, 0.0, 0.22), 0.36, 1.5, body='hull_light', cap='hull_white')
    root = _finish('BaseModule_Storage', st, atlas_dir, [((1.42, 1.42, 2.5), 'light_amber'), ((1.42, -1.42, 2.5), 'light_amber')])
    # crates: separate nodes (hide by fill level)
    for i, (x, y, layer) in enumerate(CRATE_POS):
        z = 0.22 + layer * 0.8
        parts = S.container(f'C{i}', x, y, z, 0.88, 0.66, 0.78, CRATE_KEYS[i])
        _node(f'Storage_Crate_{i}', parts, atlas_dir, (x, y, z), root)
    return root


def build_refinery(atlas_dir):
    st = []
    st.append(G.box('Floor', -1.6, 1.6, -1.55, 1.55, 0.0, 0.25, 'hull_dark', bevel=0.04, seg=1))
    for k, y in enumerate((0.85, -0.85)):
        x = 0.55
        st.append(G.lathe(f'Smelter{k}', [(0.25, 0.0), (0.25, 0.68), (1.1, 0.62), (1.85, 0.42), (2.1, 0.36), (2.1, 0.0)],
                          [0, 1, 2, 3, 3], ['hull_dark', 'hull_light', 'hull_mid', 'hull_dark'], loc=(x, y, 0),
                          axis='Z', verts=12, closed=False, smooth=False))
        st.append(G.ring_band(f'SmBand{k}', 0.66, 0.6, 0.55, 0.72, ACC, loc=(x, y, 0), verts=12, smooth=False))
        st.append(G.cyl(f'Melt{k}', 0.3, 0.06, 'ember', loc=(x, y, 2.08), verts=12))
        st.append(G.ring_band(f'MeltGlow{k}', 0.62, 0.58, 1.05, 1.12, 'cannon_glow', loc=(x, y, 0), verts=12, smooth=False))
    st += S.mast('Stack', (1.45, 0.0, 0.25), 2.6, r=0.12)
    st.append(G.cyl('StackTop', 0.17, 0.12, 'trim_black', loc=(1.45, 0, 2.9), verts=10))
    # output silo + pipe rack toward the hub
    st += S.vtank('Silo', (-1.05, 0.85, 0.25), 0.42, 1.7, body='hull_mid', cap='hull_light')
    st.append(G.cyl('SiloCap', 0.2, 0.06, 'tier_glow_ti', loc=(-1.05, 0.85, 2.0), verts=12))
    st.append(G.box('Rack', -1.6, 1.0, -0.1, 0.1, 0.25, 1.25, 'hull_dark', bevel=0.02, seg=1))
    for k, z in enumerate((0.6, 0.95)):
        st.append(G.cyl(f'Pipe{k}', 0.06, 2.6, ('metal_bare', ACC)[k], loc=(-0.3, 0, z), axis='X', verts=8))
    st.append(G.box('Win', -1.62, -1.58, -1.3, -0.4, 0.08, 0.2, 'window_warm'))
    root = _finish('BaseModule_Refinery', st, atlas_dir, [((1.55, 1.5, 0.35), 'light_amber'), ((1.55, -1.5, 0.35), 'light_amber')])
    rp = [G.cyl('Drum', 0.42, 0.55, 'hull_light', verts=16, bevel=0.03, seg=1),
          G.ring_band('DrumBelt', 0.45, 0.38, -0.06, 0.06, ACC, verts=16),
          G.ring_band('DrumGlow', 0.44, 0.4, 0.19, 0.23, 'reactor_glow', verts=16)]
    for i in range(4):
        b = G.box(f'DrumFin{i}', 0.38, 0.54, -0.04, 0.04, -0.22, 0.22, 'hull_dark')
        G.transform(b, rot=(0, 0, i * 90))
        rp.append(b)
    _rot(rp, 0.0, (-1.0, -0.8, 0.6))
    _node('Refinery_Rotor', rp, atlas_dir, (-1.0, -0.8, 0.6), root)
    return root


LAUNCH_PITCH = 58.0


def build_launcher(atlas_dir):
    st = []
    p0 = Vector((-1.25, 0.0, 0.55))                  # breech (rail bottom)
    d = Vector((math.cos(math.radians(LAUNCH_PITCH)), 0.0, math.sin(math.radians(LAUNCH_PITCH))))
    L = 3.9
    p1 = p0 + d * L                                  # muzzle
    # breech block + loading bay
    st += S.deck_block('Breech', -2.0, -0.6, -0.75, 0.75, 0.0, 0.9, accent=ACC, inset=0.1, plate_h=0.14)
    # twin rails
    for s in (1, -1):
        st.append(PI.strut(f'Rail{s}', p0 + Vector((0, 0.3 * s, 0)), p1 + Vector((0, 0.3 * s, 0)), 0.12, 'hull_light'))
    st.append(PI.strut('Spine', p0 + Vector((0, 0, -0.18)), p1 + Vector((0, 0, -0.18)), 0.2, 'hull_dark'))
    # coil rings along the rail (the marker)
    n = 6
    for k in range(n):
        c = p0 + d * (0.55 + k * (L - 0.75) / (n - 1))
        ring = G.ring_band(f'Coil{k}', 0.55, 0.42, -0.07, 0.07, 'engine_glow' if k % 2 == 0 else ACC, axis='X', verts=16)
        G.transform(ring, loc=c, rot=(0, -LAUNCH_PITCH, 0))
        st.append(ring)
        st.append(G.box(f'CoilMount{k}', -0.06, 0.06, -0.06, 0.06, -0.2, 0.0, 'hull_dark'))
        G.transform(st[-1], loc=c + Vector((0, 0, -0.32)), rot=(0, -LAUNCH_PITCH, 0))
    # A-frame supports
    for s in (1, -1):
        top = p0 + d * (L * 0.62) + Vector((0, 0, -0.2))
        st.append(PI.strut(f'Leg{s}', Vector((top.x + 0.2, 0.95 * s, 0.0)), top + Vector((0, 0.25 * s, 0)), 0.16, 'hull_mid'))
        st.append(G.box(f'LegFoot{s}', top.x - 0.05, top.x + 0.45, 0.95 * s - 0.2, 0.95 * s + 0.2, 0.0, 0.12, 'hull_dark'))
    # pod rack beside the breech (more pods waiting)
    for k in range(3):
        y = -1.45 if k < 2 else 1.45
        x = -1.6 + (k % 2) * 0.55
        st.append(G.cyl(f'Waiting{k}', 0.2, 0.55, 'hull_white', loc=(x, y, 0.28), verts=10, bevel=0.03, seg=1))
        st.append(G.ring_band(f'WaitingBand{k}', 0.21, 0.17, 0.3, 0.38, ACC, loc=(x, y, 0), verts=10))
    root = _finish('BaseModule_Launcher', st, atlas_dir,
                   [((p1.x, 0.0, p1.z + 0.3), 'light_red'), ((-2.0, 0.75, 0.95), 'light_amber')])
    # cargo pod in the breech (game moves it along the rail toward launch_point)
    pod = [G.cyl('Pod', 0.27, 0.75, 'hull_white', axis='X', verts=12, bevel=0.03, seg=1),
           G.cyl('PodNose', 0.27, 0.3, 'hull_light', loc=(0.5, 0, 0), axis='X', verts=12, r2=0.08),
           G.ring_band('PodBand', 0.29, 0.22, -0.08, 0.08, ACC, axis='X', verts=12),
           G.ring_band('PodGlow', 0.24, 0.14, -0.4, -0.36, 'engine_glow', axis='X', verts=12)]
    for o in pod:
        G.apply_modifiers(o)
        G.bake_transform(o)
        o.data.transform(Matrix.Translation(p0 + d * 0.5) @ Matrix.Rotation(math.radians(-LAUNCH_PITCH), 4, 'Y'))
    _node('Launcher_Pod', pod, atlas_dir, tuple(p0 + d * 0.5), root)
    e = _empty('launch_point', tuple(p1), 0.0, LAUNCH_PITCH, size=0.5)
    e.parent = root
    return root


def build_defense_tower(atlas_dir):
    st = []
    st.append(G.prism('Base', _oct(1.55), 0.0, 0.35, 'hull_dark', bevel=0.05, seg=1))
    st.append(G.lathe('Tower', [(0.3, 1.25), (1.4, 1.1), (2.6, 0.8), (2.95, 0.85), (2.95, 0.0)], [0, 1, 2, 3],
                      ['hull_light', 'hull_mid', 'hull_dark', 'hull_dark'], axis='Z', verts=8, closed=False,
                      smooth=False, rot=(0, 0, 22.5)))
    st.append(G.ring_band('TowerBelt', 1.15, 1.0, 1.0, 1.2, 'accent_titanium', verts=8, smooth=False))
    st.append(G.ring_band('TowerGlow', 0.86, 0.8, 2.4, 2.48, 'tier_glow_ti', verts=8, smooth=False))
    # ammo boxes + sensor mast
    for k, y in enumerate((-1.2, 1.2)):
        st.append(G.box(f'Ammo{k}', -1.6, -1.0, y - 0.3, y + 0.3, 0.3, 0.75, 'hull_mid', bevel=0.03, seg=1))
        st.append(G.box(f'AmmoStripe{k}', -1.62, -0.98, y - 0.06, y + 0.06, 0.45, 0.6, 'fuel_yellow'))
    root = _finish('BaseModule_DefenseTower', st, atlas_dir,
                   [((1.3, 1.3, 0.5), 'light_red'), ((1.3, -1.3, 0.5), 'light_red')])
    tz = 2.95
    tp = [G.prism('TurretBody', G.chamfer_rect(-0.65, 0.55, -0.62, 0.62, 0.2), 0.0, 0.6, 'hull_light', bevel=0.04, seg=1),
          G.box('TurretBelt', -0.67, 0.57, -0.64, 0.64, 0.18, 0.3, 'accent_titanium', bevel=0.02, seg=1),
          G.cyl('TurretRing', 0.72, 0.15, 'hull_dark', loc=(0, 0, 0.0), verts=16, bevel=0.02, seg=1),
          G.ellipsoid('Sensor', 0.22, 0.22, 0.18, 'glass_cockpit', loc=(-0.25, 0, 0.6), seg=12, rings=6, upper_only=True)]
    muzzles = []
    for k, y in enumerate((0.26, -0.26)):
        tp.append(G.cyl(f'Barrel{k}', 0.1, 1.25, 'metal_bare', loc=(1.1, y, 0.32), axis='X', verts=10))
        tp.append(G.cyl(f'BarrelJacket{k}', 0.15, 0.45, 'hull_dark', loc=(0.7, y, 0.32), axis='X', verts=10, bevel=0.02, seg=1))
        tp.append(G.ring_band(f'MuzzleGlow{k}', 0.12, 0.07, 1.68, 1.73, 'cannon_glow', loc=(0, y, 0.32), axis='X', verts=10))
        muzzles.append((1.74, y, 0.32))
    for o in tp:
        G.transform(o, loc=(o.location.x, o.location.y, o.location.z + tz))
    tur = _node('Tower_Turret', tp, atlas_dir, (0, 0, tz), root)
    for k, (x, y, z) in enumerate(muzzles):
        e = _empty(f'Tower_Muzzle_{k}', (x, y, z), size=0.2)
        e.parent = tur
    return root


def build_drone_dock(atlas_dir):
    st = []
    pz = 1.0
    for k in range(4):
        a = math.radians(45 + 90 * k)
        st.append(PI.strut(f'Leg{k}', (1.5 * math.cos(a), 1.5 * math.sin(a), 0.0),
                           (1.0 * math.cos(a), 1.0 * math.sin(a), pz - 0.15), 0.16, 'hull_mid'))
    st.append(G.cyl('PadUnder', 1.75, 0.25, 'hull_dark', loc=(0.25, 0, pz - 0.12), verts=24, bevel=0.03, seg=1))
    st.append(G.cyl('PadTop', 1.68, 0.06, 'floor_dark', loc=(0.25, 0, pz + 0.03), verts=24))
    st.append(G.ring_band('PadBelt', 1.8, 1.7, pz - 0.12, pz - 0.02, ACC, loc=(0.25, 0, 0), verts=24))
    st.append(G.ring_band('PadRing', 1.45, 1.3, pz + 0.05, pz + 0.08, 'engine_glow', loc=(0.25, 0, 0), verts=24))
    # chevrons pointing outward (approach direction +X)
    for k in range(3):
        x = -0.35 + k * 0.4
        for s in (1, -1):
            b = G.box(f'Chev{k}{s}', -0.2, 0.2, -0.05, 0.05, pz + 0.06, pz + 0.075, 'light_white')
            G.transform(b, loc=(0.25 + x, s * 0.14, 0), rot=(0, 0, -35 * s))
            st.append(b)
    # control hut + refuel arm toward the hub
    st += S.deck_block('Hut', -2.05, -1.35, -0.6, 0.6, 0.0, 1.1, accent=ACC, inset=0.08, plate_h=0.12)
    st.append(G.box('HutWin', -1.37, -1.33, -0.4, 0.4, 0.65, 0.85, 'window_warm'))
    st += S.mast('HutMast', (-1.7, 0.35, 1.1), 0.9, r=0.05)
    st.append(PI.strut('Arm', (-1.4, -0.5, 0.95), (-0.6, -1.15, 1.25), 0.1, 'fuel_yellow'))
    st.append(G.cyl('ArmNozzle', 0.07, 0.2, 'trim_black', loc=(-0.6, -1.15, 1.2), verts=8))
    lamps = []
    for k in range(4):
        a = math.radians(90 * k)
        lamps.append(((0.25 + 1.62 * math.cos(a), 1.62 * math.sin(a), pz + 0.12), 'light_green' if k == 0 else 'light_amber'))
    root = _finish('BaseModule_DroneDock', st, atlas_dir, lamps + [((-1.7, 0.35, 2.05), 'light_red')])
    e = _empty('drone_pad', (0.25, 0, pz + 0.06), size=0.5)
    e.parent = root
    return root


# ----------------------------------------------------------------------------
# registry + JSON
# ----------------------------------------------------------------------------
MODULES = {   # id: file, label, labelSk, builder, effect (spec 7.2), power, modes, nodes
    'drill': dict(builder=build_drill, label='Drill', labelSk='Vrták', power=-4, modes=['ground'],
                  effect='0.12/0.2/0.3 u/s x deposit richness (one per deposit)',
                  nodes={'Drill_Rotor': 'drill string + motor: spin around local +Y while mining (pivot = well axis)',
                         'beacon_0': 'red lamp on the derrick crown'}),
    'gas_probe': dict(builder=build_gas_probe, label='Gas probe', labelSk='Plynová sonda', power=-3, modes=['float'],
                      effect='He3 0.15 u/s (gas giants only)',
                      nodes={'Probe_Rotor': 'turbine: spin around local +Y (pivot (0, 1.42, 0))',
                             'beacon_0': 'amber lamp on the duct'}),
    'solar': dict(builder=build_solar, label='Solar array', labelSk='Solárne pole', power=6, modes=['ground', 'float'],
                  effect='+6 energy (x0.5 in P3+)',
                  nodes={'Solar_Array': 'yaw around local +Y to face the star (pivot (0, 1.6, 0))',
                         'beacon_0': 'amber lamp'}),
    'reactor': dict(builder=build_reactor, label='Base reactor', labelSk='Reaktor základne', power=15,
                    modes=['ground', 'float'], effect='+15 energy, 0.02 fuel cell/s',
                    nodes={'Reactor_Core': 'plasma ring with pods: spin around local +Y (pivot (0, 2.2, 0))',
                           'beacon_0..1': 'amber lamps'}),
    'storage': dict(builder=build_storage, label='Storage', labelSk='Sklad', power=0, modes=['ground', 'float'],
                    effect='+2000 capacity',
                    nodes={'Storage_Crate_0..7': 'containers in fill order: show ceil(fill * 8) of them',
                           'beacon_0..1': 'amber lamps'}),
    'refinery': dict(builder=build_refinery, label='Refinery', labelSk='Rafinéria', power=-6, modes=['ground', 'float'],
                     effect='1 intermediate product from storage (recipe choice)',
                     nodes={'Refinery_Rotor': 'centrifuge: spin around local +Y while refining',
                            'beacon_0..1': 'amber lamps'}),
    'launcher': dict(builder=build_launcher, label='Launcher', labelSk='Odpaľovač', power=-2, modes=['ground', 'float'],
                     effect='cargo to orbit for drone pick-up (without it -40 % throughput)',
                     nodes={'Launcher_Pod': 'cargo pod in the breech: move along local +X of launch_point to the '
                                            'muzzle, then fly on, hide, respawn',
                            'launch_point': f'EMPTY at the rail muzzle, local +X = launch direction (pitched '
                                            f'{LAUNCH_PITCH:.0f} deg up, outward)',
                            'beacon_0': 'red lamp at the muzzle', 'beacon_1': 'amber lamp on the breech'}),
    'defense_tower': dict(builder=build_defense_tower, label='Defense tower', labelSk='Obranná veža', power=-3,
                          modes=['ground', 'float'], effect='2 T2 cannons against raids',
                          nodes={'Tower_Turret': 'yaw around local +Y (pivot (0, 2.95, 0)), rest aim = +X outward',
                                 'Tower_Muzzle_0/1': 'EMPTY projectile origins (children of the turret), +X = fire',
                                 'beacon_0..1': 'red lamps (go dark while "disabled" after a raid)'}),
    'drone_dock': dict(builder=build_drone_dock, label='Drone dock', labelSk='Dronový dok', power=-2,
                       modes=['ground', 'float'], effect='+1 drone route',
                       nodes={'drone_pad': 'EMPTY landing spot on the pad top (local (0.25, 1.06, 0)); approach '
                                           'from local +X, drone_cargo lands with its origin here',
                              'beacon_0..3': 'pad lamps (0 = green approach light at +X)', 'beacon_4': 'red mast lamp'}),
}
BUILDERS = {'base_hub': build_hub}
BUILDERS.update({f'base_module_{k}': v['builder'] for k, v in MODULES.items()})
PREVIEW_FIT = {0: 'drill', 1: 'storage', 2: 'solar', 3: 'reactor', 4: 'refinery', 5: 'drone_dock', 6: 'launcher',
               7: 'defense_tower'}
PREVIEW_FIT_FLOAT = {0: 'gas_probe', 2: 'solar', 4: 'storage', 6: 'launcher'}


def _r(v):
    return round(v, 3)


def layouts_json():
    """Coordinates: glTF frame of base_hub (x, y = up, z), i.e. Blender (x, y, z) -> (x, z, -y)."""
    out = {'_schema': {
        'frame': 'all positions in the base_hub glTF frame: +Y = surface normal (up), origin = base centre on the '
                 'ground; yawDeg = rotation about +Y (Blender +Z), 0 = +X',
        'slots': 'index, node (EMPTY on the hub), pad (mesh node incl. bridge: hide while the slot is locked), '
                 'position of the pad top centre, yawDeg (module +X = outward), level = base level that unlocks it',
        'modules': 'file (models/base/<file>.glb), label, labelSk, power (spec 7.2 energy), effect, modes '
                   '(ground / float planets where it can be built), footprintRadius (module stays inside), '
                   'height, nodes (animated / special child nodes)',
        'hub': 'nodes of base_hub.glb: show Hub_Legs on ground planets, Hub_Floats on gas planets; '
               'Hub_Upgrade_<n> visible from base level n'}}
    slots = []
    for i in range(8):
        x, y, yaw = slot_xy(i)
        lvl = 1 if i in LEVEL_SLOTS[1] else (2 if i in LEVEL_SLOTS[2] else 3)
        slots.append({'index': i, 'node': f'slot_{i}', 'pad': f'Pad_{i}', 'x': _r(x), 'y': PAD_TOP, 'z': _r(-y),
                      'yawDeg': yaw, 'level': lvl})
    out['hub'] = {'file': 'base_hub', 'slotRadius': SLOT_R, 'padTop': PAD_TOP, 'padRadius': PAD_R,
                  'footprintRadius': round(SLOT_R + PAD_R, 2), 'levels': LEVEL_SLOTS,
                  'modes': {'ground': {'show': ['Hub_Legs'], 'hide': ['Hub_Floats']},
                            'float': {'show': ['Hub_Floats'], 'hide': ['Hub_Legs']}},
                  'upgrades': {'2': 'Hub_Upgrade_2', '3': 'Hub_Upgrade_3'},
                  'nodes': {'Hub_Radar': 'dish: spin around local +Y', 'beacon_0': 'red mast lamp',
                            'beacon_1..4': 'amber foundation lamps', 'Pad_<i>': 'slot pad + bridge',
                            'slot_<i>': 'EMPTY module mount'},
                  'slots': slots}
    out['modules'] = {}
    for k, v in MODULES.items():
        out['modules'][k] = {'file': f'base_module_{k}', 'label': v['label'], 'labelSk': v['labelSk'],
                             'power': v['power'], 'effect': v['effect'], 'modes': v['modes'],
                             'footprintRadius': MODULE_R, 'nodes': v['nodes']}
    out['previewLayout'] = {'ground': {str(i): m for i, m in PREVIEW_FIT.items()},
                            'float': {str(i): m for i, m in PREVIEW_FIT_FLOAT.items()}}
    return out
