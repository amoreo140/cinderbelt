"""Space clutter props (art audit 2026-10-16 batch B4 + B5, README 2.7.23).
Imported by props.py (props.CLUTTER / props.build); exported by batch_b.py
with vertex colours into public/assets/models/props/ + props.json.

Human hull language, chunky, each prop has ONE bold top-down marker (dish,
solar cross, reflector collar + strobe mast, hazard band, crate grid, yellow
sphere, glowing ore slot, orange pod stripes, orange claim plate, blue
panel).  Bodies stay mid/dark grey - clutter must never out-shine ships or
minable rocks (greyscale check in batch-b-props-gamecam-grey.png).

Origins: body centre (props tumble/drift), except claim_marker (root
`Claim_Base`, origin at the spike foot, local glTF +Y = out of the rock).
"""
import json
import math
import os
import random

from mathutils import Matrix, Vector

from lib import geo as G
from lib import greebles as GR
from lib import palette as P
import station_kit as SK
import wreck_kit as W

# accent_institute arrives with palette step 0 (audit §5); until then the T2 blue stands in
ACC_INST = 'accent_institute' if 'accent_institute' in P.BY_KEY else 'accent_titanium'


def _weather(ob, rng, extra=(), grime=0.25, ao=0.55):
    GR.weather(ob, rng, extra=extra, ao=ao, ao_near=0.35, near=0.25, far=1.2, grime=grime, panel=0.05,
               under=0.15, floor=0.35, scale=0.35)


def _root(name, pcs, atlas_dir, rng, grime=0.25):
    root = G.join(pcs, name)
    _weather(root, rng, grime=grime)
    G.finalize(root, atlas_dir)
    return root


def _node(root, name, pcs, pivot, atlas_dir, rng, grime=0.2):
    """Child node from objects modelled in ROOT space; origin = pivot."""
    nd = G.join(pcs, name)
    _weather(nd, rng, extra=[root], grime=grime)
    G.finalize(nd, atlas_dir)
    nd.data.transform(Matrix.Translation([-c for c in pivot]))
    nd.location = pivot
    nd.parent = root
    return nd


def _lamp(root, name, loc, key, atlas_dir, r=0.05):
    b = G.ellipsoid(name, r, r, r, key, seg=10, rings=6)
    G.finalize(b, atlas_dir)
    GR.ensure_col(b)
    b.location = loc
    b.parent = root
    return b


def _recentre(root):
    """bbox centre of the whole prop -> origin (props tumble around it)."""
    import bpy
    bpy.context.view_layer.update()
    pts = []
    for o in [root] + list(root.children_recursive):
        if o.type == 'MESH':
            pts += [o.matrix_world @ v.co for v in o.data.vertices]
    mn = Vector([min(p[i] for p in pts) for i in range(3)])
    mx = Vector([max(p[i] for p in pts) for i in range(3)])
    c = (mn + mx) / 2
    root.data.transform(Matrix.Translation(-c))
    for ch in root.children:
        ch.location -= c
    return root


def _cage(name, loc, r, h, n=3, key='trim_black'):
    out = [G.cyl(name + 'Base', r * 1.2, 0.04, 'hull_dark', loc=(loc[0], loc[1], loc[2] - 0.01), verts=10)]
    for i in range(n):
        a = math.radians(i * 360 / n + 30)
        out.append(G.box(f'{name}Bar{i}', -0.008, 0.008, -0.008, 0.008, 0.0, h, key))
        W.place(out[-1], loc=(loc[0] + r * math.cos(a), loc[1] + r * math.sin(a), loc[2]))
    out.append(G.ring_band(name + 'Top', r + 0.012, r - 0.012, h - 0.012, h + 0.004, key, loc=loc, verts=10,
                           smooth=False))
    return out


# ============================================================================
# B4 - human clutter
# ============================================================================
def sat_comm(atlas_dir, seed=1201):
    """Comm satellite: dark bus wrapped in copper foil, orange belt, two
    solar wings on a boom (`Sat_Solar`, turns about the boom axis) and a big
    dish on top (`Sat_Dish`, slow spin) = the top-down marker."""
    rng = random.Random(seed)
    p = [G.box('Bus', -0.4, 0.4, -0.4, 0.4, -0.35, 0.35, 'hull_dark', bevel=0.03, seg=1)]
    for s in (1, -1):
        p.append(G.box(f'FoilX{s}', s * 0.4 - 0.01, s * 0.4 + 0.012, -0.32, 0.32, -0.28, 0.22, 'kot_copper'))
        p.append(G.box(f'FoilY{s}', -0.32, 0.32, s * 0.4 - 0.01, s * 0.4 + 0.012, -0.28, -0.08, 'kot_copper'))
        p.append(G.cyl(f'Boom{s}', 0.055, 0.34, 'metal_bare', loc=(0, s * 0.55, 0.05), axis='Y', verts=8))
    p.append(G.prism('Deck', G.chamfer_rect(-0.38, 0.38, -0.38, 0.38, 0.08), 0.35, 0.41, 'hull_mid', bevel=0.01,
                     seg=1))
    p.append(G.box('Belt', -0.415, 0.415, -0.415, 0.415, -0.02, 0.06, 'accent_iron'))
    for i, (x, y) in enumerate(((0.3, 0.3), (-0.3, 0.3), (0.3, -0.3), (-0.3, -0.3))):
        p.append(G.cyl(f'Rcs{i}', 0.03, 0.08, 'nozzle_in', loc=(x, y, -0.39), verts=6, r2=0.05))
    p.append(G.cyl('Whip', 0.012, 0.5, 'metal_bare', loc=(-0.3, -0.3, 0.65), verts=5))
    root = _root('Sat_Comm', p, atlas_dir, rng)
    # solar wings (turn about the boom = glTF local Z)
    sol = []
    for s in (1, -1):
        y0, y1 = (0.72, 2.05) if s > 0 else (-2.05, -0.72)
        sol += SK.solar_array(f'W{s}', -0.42, 0.42, y0, y1, 0.05, cols=2, rows=3, frame='hull_mid')
        sol.append(G.box(f'Yoke{s}', -0.05, 0.05, min(s * 0.68, s * 0.74), max(s * 0.68, s * 0.74), -0.05, 0.13,
                         'hull_dark'))
    _node(root, 'Sat_Solar', sol, (0, 0, 0.05), atlas_dir, rng)
    # dish on top (spin about the up axis)
    d = [G.cyl('Mount', 0.07, 0.24, 'hull_dark', loc=(0, 0, 0.53), verts=8),
         G.lathe('Dish', [(0.0, 0.0), (0.03, 0.25), (0.11, 0.55), (0.2, 0.78), (0.17, 0.8), (0.07, 0.5),
                          (0.0, 0.2)], [0, 0, 0, 1, 2, 2], ['hull_light', 'accent_iron', 'hull_mid'],
                 loc=(0, 0, 0.66), axis='Z', verts=20, closed=False, rot=(0, 24, 0))]
    for i in range(3):
        a = math.radians(i * 120)
        tip = Vector((0.2, 0, 1.25))
        base = Vector((0.55 * math.cos(a), 0.55 * math.sin(a), 0.0))
        m = Matrix.Translation((0, 0, 0.66)) @ G._euler((0, 24, 0))
        d.append(SK.bar(f'Strut{i}', m @ base, m @ Vector((0, 0, 0.62)), 0.025, 'metal_bare'))
    m = Matrix.Translation((0, 0, 0.66)) @ G._euler((0, 24, 0))
    d.append(G.cyl('Feed', 0.06, 0.14, 'accent_iron', loc=tuple(m @ Vector((0, 0, 0.66))), verts=8))
    _node(root, 'Sat_Dish', d, (0, 0, 0.45), atlas_dir, rng)
    _lamp(root, 'beacon_0', (0.36, 0.36, 0.45), 'light_red', atlas_dir)
    return _recentre(root)


def sat_survey(atlas_dir, seed=1202):
    """Institute survey satellite: octagonal drum with Institute trim, a
    sensor boom with a lens head and a big rotating solar CROSS on top
    (`Sat_Solar`, spin about up) = the top-down marker; cyan beacon."""
    rng = random.Random(seed)
    prof = [(-0.42, 0.0), (-0.42, 0.34), (-0.34, 0.45), (0.32, 0.45), (0.4, 0.36), (0.4, 0.0)]
    p = [G.lathe('Drum', prof, [0, 0, 1, 1, 2], ['hull_dark', 'hull_mid', 'hull_light'], axis='Z', verts=8,
                 closed=False, smooth=False)]
    for z in (-0.3, 0.22):
        p.append(G.ring_band(f'Trim{z}', 0.465, 0.4, z, z + 0.08, ACC_INST, verts=8, smooth=False))
    p.append(G.box('Boom', 0.4, 1.3, -0.035, 0.035, -0.06, 0.0, 'metal_bare'))
    p.append(G.cyl('Head', 0.12, 0.26, 'hull_dark', loc=(1.38, 0, -0.03), axis='X', verts=10))
    p.append(G.ring_band('HeadTrim', 0.13, 0.1, -0.03, 0.03, ACC_INST, loc=(1.3, 0, -0.03), axis='X', verts=10,
                         smooth=False))
    p.append(G.ellipsoid('Lens', 0.05, 0.1, 0.1, 'glass_cockpit', loc=(1.52, 0, -0.03), seg=10, rings=6))
    p.append(G.lathe('SmallDish', [(0.0, 0.0), (0.02, 0.12), (0.06, 0.24), (0.045, 0.25), (0.0, 0.1)], [0, 0, 1, 1],
                     ['hull_light', ACC_INST], loc=(-0.52, 0, -0.1), axis='Z', verts=12, closed=False,
                     rot=(0, -70, 0)))
    root = _root('Sat_Survey', p, atlas_dir, rng)
    sol = [G.cyl('Hub', 0.13, 0.12, 'hull_dark', loc=(0, 0, 0.46), verts=8)]
    for k in range(4):
        a = 45 + 90 * k
        arr = SK.solar_array(f'P{k}', 0.45, 1.55, -0.24, 0.24, 0.5, cols=3, rows=1, frame='hull_mid')
        arr.append(G.box(f'Arm{k}', 0.1, 0.48, -0.03, 0.03, 0.47, 0.51, 'metal_bare'))
        arr.append(G.box(f'Tip{k}', 1.5, 1.6, -0.26, 0.26, 0.47, 0.53, ACC_INST))
        W.place_all(arr, rot=(0, 0, a))
        sol += arr
    _node(root, 'Sat_Solar', sol, (0, 0, 0.46), atlas_dir, rng)
    _lamp(root, 'beacon_0', (1.38, 0, 0.13), 'shield_glow', atlas_dir, r=0.05)
    return _recentre(root)


def nav_beacon(atlas_dir, seed=1203):
    """Trade-lane nav beacon: orange-belted float, a white reflector collar
    (bold ring from above), stabilizer fins, a strobe mast with a green lamp
    (`beacon_0`) and a white strobe on top (`beacon_1`)."""
    rng = random.Random(seed)
    prof = [(-0.55, 0.0), (-0.55, 0.16), (-0.35, 0.34), (0.2, 0.36), (0.32, 0.22), (0.34, 0.0)]
    p = [G.lathe('Float', prof, [0, 1, 1, 2, 2], ['hull_dark', 'hull_mid', 'hull_light'], axis='Z', verts=8,
                 closed=False, smooth=False)]
    p.append(G.ring_band('Belt', 0.375, 0.33, -0.12, 0.0, 'accent_iron', verts=8, smooth=False))
    for i in range(0, 8, 2):
        a = i * 45 + 22.5
        st = G.box(f'Haz{i}', -0.01, 0.01, -0.1, 0.1, -0.12, 0.0, 'trim_black')
        W.place(st, loc=(0.37 * math.cos(math.radians(a)), 0.37 * math.sin(math.radians(a)), 0), rot=(0, 0, a))
        p.append(st)
    p.append(G.ring_band('Collar', 0.62, 0.42, 0.06, 0.12, 'hull_light', verts=16, smooth=False))
    for k in range(4):
        a = 45 + k * 90
        gap = G.box(f'Gap{k}', -0.07, 0.07, 0.4, 0.64, 0.055, 0.125, 'trim_black')
        W.place(gap, rot=(0, 0, a))
        p.append(gap)
        spoke = G.box(f'Spoke{k}', 0.3, 0.45, -0.03, 0.03, 0.05, 0.1, 'hull_dark')
        W.place(spoke, rot=(0, 0, a))
        p.append(spoke)
    for k in range(3):
        fin = G.box(f'Fin{k}', 0.12, 0.45, -0.02, 0.02, -0.75, -0.3, 'hull_dark', bevel=0.01, seg=1)
        W.place(fin, rot=(0, 0, 90 + k * 120))
        p.append(fin)
    p.append(G.cyl('Mast', 0.035, 1.25, 'metal_bare', loc=(0, 0, 0.95), verts=6))
    p.append(G.box('Arm', -0.02, 0.22, -0.02, 0.02, 1.0, 1.04, 'metal_bare'))
    p += _cage('Cage', (0, 0, 1.56), 0.075, 0.18)
    root = _root('Nav_Beacon', p, atlas_dir, rng)
    _lamp(root, 'beacon_0', (0.24, 0, 1.02), 'light_green', atlas_dir, r=0.055)
    _lamp(root, 'beacon_1', (0, 0, 1.65), 'light_white', atlas_dir, r=0.06)
    return _recentre(root)


def cargo_pod_small(atlas_dir, seed=1204):
    """Small drifting cargo pod: grey capsule with a bold orange/black hazard
    band, tow ring at the nose, skids, amber lamp (`beacon_0`)."""
    rng = random.Random(seed)
    prof = [(-0.5, 0.0), (-0.5, 0.16), (-0.42, 0.27), (0.38, 0.27), (0.48, 0.18), (0.5, 0.0)]
    p = [G.lathe('Body', prof, [0, 1, 1, 0, 0], ['hull_dark', 'hull_mid'], axis='X', verts=12, closed=False,
                 smooth=False)]
    p.append(G.ring_band('Band', 0.29, 0.25, -0.13, 0.13, 'accent_iron', axis='X', verts=12, smooth=False))
    for k in range(6):
        a = k * 60 + 15
        st = G.box(f'Haz{k}', -0.13, 0.13, -0.035, 0.035, 0.275, 0.295, 'trim_black')
        W.place(st, rot=(a, 0, 0))
        W.place(st, rot=(0, 0, 0))
        p.append(st)
    for s in (1, -1):
        p.append(G.box(f'Rib{s}', s * 0.3 - 0.03, s * 0.3 + 0.03, -0.285, 0.285, -0.285, 0.285, 'hull_dark'))
        p.append(G.box(f'Skid{s}', -0.36, 0.36, s * 0.16 - 0.025, s * 0.16 + 0.025, -0.33, -0.27, 'hull_dark'))
    p.append(G.torus('TowRing', 0.11, 0.025, 'metal_bare', loc=(0.58, 0, 0), rot=(0, 90, 0), maj=12, mnr=4))
    p.append(G.cyl('TowPost', 0.04, 0.12, 'hull_dark', loc=(0.52, 0, 0), axis='X', verts=6))
    p += _cage('Cage', (-0.25, 0, 0.27), 0.05, 0.11)
    root = _root('Cargo_Pod_Small', p, atlas_dir, rng)
    _lamp(root, 'beacon_0', (-0.25, 0, 0.34), 'light_amber', atlas_dir, r=0.04)
    return _recentre(root)


def cargo_pallet(atlas_dir, seed=1205):
    """Cargo pallet: a flat dark frame with a 3 x 2 grid of strapped crates
    (crate grid = marker), corner bumpers, amber corner lamp (`beacon_0`)."""
    rng = random.Random(seed)
    p = []
    for s in (1, -1):
        p.append(G.box(f'Rail{s}', -0.9, 0.9, s * 0.55 - 0.05, s * 0.55 + 0.05, -0.12, 0.0, 'hull_dark'))
        p.append(G.box(f'End{s}', s * 0.9 - 0.05, s * 0.9 + 0.05, -0.6, 0.6, -0.12, 0.0, 'hull_dark'))
    for k in range(3):
        x = -0.55 + k * 0.55
        p.append(G.box(f'Cross{k}', x - 0.04, x + 0.04, -0.55, 0.55, -0.1, -0.02, 'hull_mid'))
    keys = ('accent_iron_dark', 'hull_mid', 'fuel_yellow', 'accent_trader', 'hull_light', 'accent_titanium_dark')
    k = 0
    for i, x in enumerate((-0.57, 0.0, 0.57)):
        for j, y in enumerate((-0.27, 0.27)):
            h = rng.uniform(0.3, 0.48)
            p.append(G.box(f'Crate{i}{j}', x - 0.25, x + 0.25, y - 0.23, y + 0.23, 0.0, h, keys[k % 6], bevel=0.02,
                           seg=1))
            p.append(G.box(f'Lid{i}{j}', x - 0.2, x + 0.2, y - 0.18, y + 0.18, h, h + 0.02, 'hull_dark'))
            k += 1
    for j, y in enumerate((-0.27, 0.27)):
        for s in (1, -1):
            p.append(G.box(f'Strap{j}{s}', -0.86, 0.86, y + s * 0.12 - 0.02, y + s * 0.12 + 0.02, 0.0, 0.5,
                           'trim_black'))
    for sx in (1, -1):
        for sy in (1, -1):
            p.append(G.box(f'Bump{sx}{sy}', sx * 0.9 - 0.08, sx * 0.9 + 0.08, sy * 0.55 - 0.08, sy * 0.55 + 0.08,
                           -0.14, 0.04, 'accent_iron', bevel=0.02, seg=1))
    p.append(G.cyl('Post', 0.025, 0.4, 'metal_bare', loc=(0.9, 0.55, 0.22), verts=6))
    root = _root('Cargo_Pallet', p, atlas_dir, rng)
    _lamp(root, 'beacon_0', (0.9, 0.55, 0.45), 'light_amber', atlas_dir, r=0.045)
    return _recentre(root)


def fuel_canister(atlas_dir, seed=1206):
    """Fuel canister: a yellow sphere tank (marker) in a dark cage, valve with
    an orange hand wheel, hose stub."""
    rng = random.Random(seed)
    p = [G.ellipsoid('Tank', 0.3, 0.3, 0.3, 'fuel_yellow', seg=14, rings=8)]
    p.append(G.torus('Equator', 0.31, 0.022, 'hull_dark', maj=20, mnr=4))
    for a in (0, 90):
        p.append(G.torus(f'Meridian{a}', 0.31, 0.018, 'hull_dark', rot=(90, 0, a), maj=20, mnr=4))
    p.append(G.cyl('Valve', 0.05, 0.14, 'metal_bare', loc=(0, 0, 0.36), verts=8))
    p.append(G.torus('Wheel', 0.08, 0.014, 'accent_iron', loc=(0, 0, 0.44), maj=12, mnr=4))
    p.append(G.box('Label', -0.12, 0.12, -0.315, -0.29, -0.06, 0.06, 'trim_black'))
    p.append(W.tube('Hose', [(0.2, 0.0, -0.22), (0.32, 0.05, -0.32), (0.42, -0.04, -0.36)], 0.025, 'trim_black',
                    sides=5))
    p.append(G.cyl('Foot', 0.12, 0.08, 'hull_dark', loc=(0, 0, -0.32), verts=8))
    root = _root('Fuel_Canister', p, atlas_dir, rng)
    return _recentre(root)


def ore_canister(atlas_dir, seed=1207):
    """Ore canister: grey cylinder with dark end caps, grab handles and a
    long glowing ore slot (`Ore_Window`, near-white - code tints it with the
    resource colour)."""
    rng = random.Random(seed)
    p = [G.cyl('Body', 0.26, 0.92, 'hull_mid', axis='X', verts=12, smooth=False)]
    for s in (1, -1):
        p.append(G.cyl(f'Cap{s}', 0.28, 0.12, 'hull_dark', loc=(s * 0.46, 0, 0), axis='X', verts=12, smooth=False))
        p.append(G.ring_band(f'Ring{s}', 0.285, 0.24, -0.025, 0.025, 'accent_iron', loc=(s * 0.33, 0, 0), axis='X',
                             verts=12, smooth=False))
        p.append(G.torus(f'Handle{s}', 0.09, 0.018, 'metal_bare', loc=(s * 0.56, 0, 0), rot=(0, 90, 0), maj=10,
                         mnr=4))
    p.append(G.box('SlotFrame', -0.3, 0.3, -0.1, 0.1, 0.2, 0.275, 'trim_black'))
    root = _root('Ore_Canister', p, atlas_dir, rng)
    win = [G.box('Glass', -0.27, 0.27, -0.07, 0.07, 0.23, 0.28, 'vein_titanium')]
    _node(root, 'Ore_Window', win, (0, 0, 0.255), atlas_dir, rng, grime=0.0)
    return _recentre(root)


def escape_pod(atlas_dir, seed=1208):
    """Escape pod: light capsule with two orange stripes, a scorched heat
    shield, a lit porthole (someone is inside), RCS nubs and a red distress
    lamp (`beacon_0`)."""
    rng = random.Random(seed)
    prof = [(-0.62, 0.0), (-0.62, 0.3), (-0.5, 0.4), (0.35, 0.4), (0.6, 0.26), (0.75, 0.1), (0.76, 0.0)]
    p = [G.lathe('Body', prof, [0, 1, 1, 1, 1, 1], ['hull_dark', 'hull_light'], axis='X', verts=14, closed=False,
                 smooth=False)]
    p.append(G.lathe('Shield', [(-0.62, 0.0), (-0.66, 0.2), (-0.66, 0.36), (-0.6, 0.42), (-0.6, 0.0)],
                     [0, 0, 1, 1], ['scorch', 'char_black'], axis='X', verts=14, closed=False, smooth=False))
    for x in (-0.3, 0.12):
        p.append(G.ring_band(f'Stripe{x}', 0.415, 0.37, x - 0.06, x + 0.06, 'accent_iron', axis='X', verts=14,
                             smooth=False))
    for k in range(4):
        a = math.radians(45 + 90 * k)
        p.append(G.box(f'Rcs{k}', 0.4, 0.5, -0.04, 0.04, -0.04, 0.04, 'hull_dark'))
        W.place(p[-1], loc=(0, 0.33 * math.cos(a), 0.33 * math.sin(a)))
    p.append(G.cyl('PortRim', 0.1, 0.06, 'hull_dark', loc=(-0.08, 0, 0.39), verts=10))
    p.append(G.cyl('Port', 0.075, 0.07, 'window_warm', loc=(-0.08, 0, 0.395), verts=10))
    p.append(G.cyl('PortS', 0.07, 0.06, 'window_warm', loc=(-0.08, 0.39, 0.0), axis='Y', verts=10))
    p.append(G.cyl('Antenna', 0.012, 0.35, 'metal_bare', loc=(0.4, -0.12, 0.45), verts=5))
    p += _cage('Cage', (0.3, 0.0, 0.38), 0.05, 0.11)
    root = _root('Escape_Pod', p, atlas_dir, rng, grime=0.35)
    _lamp(root, 'beacon_0', (0.3, 0.0, 0.45), 'light_red', atlas_dir, r=0.045)
    return _recentre(root)


def claim_marker(atlas_dir, seed=1209):
    """Guild mining-claim spike: drilled into an asteroid. Root `Claim_Base`
    = the spike foot (origin), glTF +Y = out of the rock. Orange claim plate
    with hazard wedges (marker from above), mast, Guild drill-bit flag,
    amber lamp (`beacon_0`)."""
    rng = random.Random(seed)
    p = [G.cyl('Spike', 0.08, 0.7, 'metal_bare', loc=(0, 0, -0.35), verts=6, r2=0.08)]
    p[-1].data.transform(Matrix.Identity(4))
    p.append(G.cyl('Tip', 0.08, 0.2, 'metal_bare', loc=(0, 0, -0.8), verts=6, r2=0.0))
    W.place(p[-1], rot=(180, 0, 0))
    p.append(G.cyl('Plate', 0.36, 0.05, 'accent_iron', loc=(0, 0, 0.03), verts=12, smooth=False))
    for k in range(6):
        wd = G.prism(f'Wedge{k}', [(0.18, -0.05), (0.35, -0.08), (0.35, 0.08), (0.18, 0.05)], 0.055, 0.065,
                     'trim_black')
        W.place(wd, rot=(0, 0, k * 60))
        p.append(wd)
    p.append(G.cyl('Collar', 0.14, 0.16, 'hull_dark', loc=(0, 0, 0.13), verts=8))
    p.append(G.cyl('Mast', 0.04, 1.25, 'hull_mid', loc=(0, 0, 0.82), verts=6))
    # flag panel with the Guild drill bit (white) on both faces
    p.append(G.box('Flag', 0.04, 0.62, -0.02, 0.02, 0.98, 1.38, 'accent_iron', bevel=0.01, seg=1))
    # drill bit through the flag (visible on both faces): outline in (x, z), extruded across y
    bit = G.prism('Bit', [(0.16, 1.1), (0.4, 1.1), (0.5, 1.18), (0.4, 1.26), (0.16, 1.26)], -0.03, 0.03,
                  'hull_white')
    W.place(bit, rot=(90, 0, 0))
    p.append(bit)
    for k, x in enumerate((0.22, 0.3)):
        p.append(G.box(f'Groove{k}', x, x + 0.025, -0.031, 0.031, 1.1, 1.26, 'accent_iron'))
    p += _cage('Cage', (0, 0, 1.45), 0.05, 0.11)
    root = _root('Claim_Base', p, atlas_dir, rng)
    _lamp(root, 'beacon_0', (0, 0, 1.52), 'light_amber', atlas_dir, r=0.05)
    return root


def solar_wing_drift(atlas_dir, seed=1210):
    """Torn solar wing drifting free: framed blue cells (marker) with a few
    missing/cracked, bent tip, a ripped hinge drum and spar stub."""
    rng = random.Random(seed)
    arr = SK.solar_array('Wing', -1.3, 1.3, -0.55, 0.55, 0.0, cols=5, rows=2, frame='hull_mid')
    p = []
    for o in arr:
        if o.name.startswith('WingC') and rng.random() < 0.2:
            import bpy
            bpy.data.objects.remove(o)
            continue
        p.append(o)
    for o in p:
        W.subdiv_long(o, 0.5)
        W.bend(o, (0.6, 0, 0), (0, 1, 0), -22, (1, 0, 0), ramp=0.6)
    W.torn(p[0], rng, 1.15, n=3, span=(-0.55, 0.55))
    p += SK.rotator('Hinge', (-1.42, 0, -0.05), r=0.14, L=0.3, axis='Y')
    p.append(W.tube('Spar', [(-1.42, 0, -0.05), (-1.75, 0.1, -0.1), (-1.95, 0.05, -0.2)], 0.05, 'metal_bare',
                    sides=6))
    p.append(G.box('Burn', -1.99, -1.9, -0.06, 0.08, -0.28, -0.12, 'char_black'))
    root = _root('Solar_Wing_Drift', p, atlas_dir, rng, grime=0.4)
    return _recentre(root)


# ============================================================================
# B5 - pirate-space dressing (decoration only: no hazard mechanics decided)
# ============================================================================
def pirate_mine(atlas_dir, seed=1301):
    """Dormant pirate mine: spiked gunmetal sphere on a hazard band, a red
    lamp (`beacon_0`) and a slowly turning sensor core band (`Mine_Core`).
    Not a buoy (no float/mast) and not a totem."""
    rng = random.Random(seed)
    p = [G.ellipsoid('Shell', 0.36, 0.36, 0.34, 'pir_gunmetal', seg=12, rings=8, smooth=False)]
    dirs = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1),
            (0.7, 0.7, 0.4), (-0.7, 0.7, -0.4), (0.7, -0.7, -0.4), (-0.7, -0.7, 0.4)]
    for k, d in enumerate(dirs):
        d = Vector(d).normalized()
        sp = G.cyl(f'Spike{k}', 0.05, 0.28, 'pir_gunmetal_dark', verts=4, r2=0.0)
        sp.data.transform(Matrix.Translation((0, 0, 0.14)))
        q = Vector((0, 0, 1)).rotation_difference(d)
        sp.data.transform(Matrix.Translation(d * 0.3) @ q.to_matrix().to_4x4())
        p.append(sp)
        p.append(G.cyl(f'Det{k}', 0.06, 0.05, 'pir_rust', loc=tuple(d * 0.33), verts=6))
        q2 = Vector((0, 0, 1)).rotation_difference(d)
        p[-1].data.transform(Matrix.Translation(-d * 0.33))
        p[-1].data.transform(Matrix.Translation(d * 0.33) @ q2.to_matrix().to_4x4())
    root = _root('Pirate_Mine', p, atlas_dir, rng, grime=0.4)
    core = [G.ring_band('Band', 0.4, 0.33, -0.05, 0.05, 'pir_hazard', verts=12, smooth=False)]
    for k in range(6):
        st = G.box(f'Haz{k}', -0.012, 0.012, -0.05, 0.05, -0.052, 0.052, 'trim_black')
        W.place(st, loc=(0.4, 0, 0))
        W.place(st, rot=(0, 0, k * 60))
        core.append(st)
    core.append(G.box('Eye', 0.39, 0.43, -0.05, 0.05, -0.03, 0.03, 'pir_glass_red'))
    _node(root, 'Mine_Core', core, (0, 0, 0), atlas_dir, rng)
    _lamp(root, 'beacon_0', (0, 0, 0.42), 'pir_glow_red', atlas_dir, r=0.05)
    return root


def pirate_stash(atlas_dir, seed=1302):
    """Pirate stash: welded crate stack (rust/gunmetal), chained, claw paint,
    a hazard-ochre lid, a dim red lamp (`beacon_0`)."""
    rng = random.Random(seed)
    p = []
    boxes = [(-0.35, -0.2, 0.0, 0.7, 0.6, 0.55, 'pir_rust', 5), (0.4, 0.05, 0.0, 0.6, 0.7, 0.5, 'pir_gunmetal', -8),
             (0.0, 0.0, 0.55, 0.65, 0.55, 0.4, 'pir_plate_worn', 14), (-0.45, 0.45, 0.0, 0.45, 0.4, 0.4,
                                                                       'pir_hazard', 30)]
    for k, (x, y, z, sx, sy, sz, key, rot) in enumerate(boxes):
        b = [G.box(f'Box{k}', -sx / 2, sx / 2, -sy / 2, sy / 2, 0, sz, key, bevel=0.02, seg=1),
             G.box(f'Band{k}', -sx / 2 - 0.01, sx / 2 + 0.01, -0.04, 0.04, -0.01, sz + 0.01, 'pir_gunmetal_dark')]
        W.place_all(b, loc=(x, y, z - 0.45), rot=(0, 0, rot))
        p += b
    for k in range(5):
        y = -0.25 + k * 0.12
        w = G.box(f'Weld{k}', 0.05, 0.11, y, y + 0.05, 0.0, 0.06, 'pir_weld')
        W.place(w, loc=(-0.05, 0, -0.45 + 0.52))
        p.append(w)
    for k in range(3):
        cl = G.box(f'Claw{k}', -0.18, 0.18, -0.012, 0.012, 0.0, 0.012, 'pir_rust_dark')
        W.place(cl, loc=(0.0, -0.08 + k * 0.08, 0.5 + 0.0), rot=(0, 0, 30))
        p.append(cl)
    for k in range(7):
        lk = G.torus(f'Link{k}', 0.05, 0.012, 'metal_bare', maj=8, mnr=4, smooth=False)
        W.place(lk, loc=(-0.65 + k * 0.08, -0.52, -0.1 - 0.03 * math.sin(k)), rot=(90 * (k % 2), 0, 0))
        p.append(lk)
    root = _root('Pirate_Stash', p, atlas_dir, rng, grime=0.5)
    _lamp(root, 'beacon_0', (0.0, 0.0, 0.53), 'pir_glow_red', atlas_dir, r=0.045)
    return _recentre(root)


def scrap_raft(atlas_dir, seed=1303):
    """Scrap raft where pirate groups idle: mismatched welded plates on a
    girder frame, a crate pile, a fuel drum rack, a lamp mast with red
    (`beacon_0`) and amber (`beacon_1`) lamps, spikes on the rim."""
    import pirates as PI
    rng = random.Random(seed)
    p = []
    for k in range(9):
        x, y = rng.uniform(-1.6, 1.6), rng.uniform(-1.1, 1.1)
        sx, sy = rng.uniform(0.9, 1.6), rng.uniform(0.7, 1.2)
        key = ('pir_plate_worn', 'pir_gunmetal', 'pir_rust_patch', 'pir_gunmetal_dark')[k % 4]
        p.append(PI.plate(f'Plate{k}', (x, y, rng.uniform(-0.05, 0.05)), (sx, sy, 0.1),
                          rot=(rng.uniform(-3, 3), rng.uniform(-3, 3), rng.uniform(-20, 20)), mat=key, bevel=0.02))
    p += PI.truss('TrA', (-2.3, -0.9, -0.2), (2.3, -0.9, -0.2), w=0.35, bar=0.07)
    p += PI.truss('TrB', (-2.3, 0.9, -0.2), (2.3, 0.9, -0.2), w=0.35, bar=0.07)
    for k in range(5):
        c = (rng.uniform(-1.2, 0.2), rng.uniform(-0.6, 0.6), 0.25 + 0.0)
        s = rng.uniform(0.22, 0.32)
        b = G.box(f'Crate{k}', -s, s, -s, s, -s * 0.8, s * 0.8, ('pir_rust', 'pir_hazard', 'pir_gunmetal')[k % 3],
                  bevel=0.02, seg=1)
        W.place(b, loc=c, rot=(0, 0, rng.uniform(0, 90)))
        p.append(b)
    for k in range(3):
        p.append(G.cyl(f'Drum{k}', 0.16, 0.42, 'pir_rust_dark' if k != 1 else 'pir_hazard',
                       loc=(1.2, -0.45 + k * 0.4, 0.26), verts=8))
    p.append(G.cyl('Mast', 0.05, 1.6, 'pir_gunmetal_dark', loc=(1.8, 0.7, 0.85), verts=6))
    p.append(G.box('MastArm', 1.8, 2.2, 0.68, 0.72, 1.5, 1.54, 'pir_gunmetal_dark'))
    p += PI.spikes('Spk', (0, 0), 2.1, 9, 0.0, 0.5, rng)
    p += _cables_flat(rng)
    root = _root('Scrap_Raft', p, atlas_dir, rng, grime=0.5)
    _lamp(root, 'beacon_0', (1.8, 0.7, 1.7), 'pir_glow_red', atlas_dir, r=0.08)
    _lamp(root, 'beacon_1', (2.2, 0.7, 1.46), 'light_amber', atlas_dir, r=0.06)
    return _recentre(root)


def _cables_flat(rng):
    out = []
    for k in range(3):
        p0 = Vector((rng.uniform(-1.5, 1.0), rng.uniform(-0.9, 0.9), 0.08))
        p1 = p0 + Vector((rng.uniform(0.6, 1.2), rng.uniform(-0.4, 0.4), 0.0))
        pts = W.sag(p0, p1, -0.06, n=5, wobble=0.1, rng=rng)
        out.append(W.tube(f'Cable{k}', pts, 0.03, 'trim_black', sides=5))
    return out


CLUTTER = {
    'sat_comm': sat_comm, 'sat_survey': sat_survey, 'nav_beacon': nav_beacon, 'cargo_pod_small': cargo_pod_small,
    'cargo_pallet': cargo_pallet, 'fuel_canister': fuel_canister, 'ore_canister': ore_canister,
    'escape_pod': escape_pod, 'claim_marker': claim_marker, 'solar_wing_drift': solar_wing_drift,
    'pirate_mine': pirate_mine, 'pirate_stash': pirate_stash, 'scrap_raft': scrap_raft,
}

# manifest metadata (suggestions for the clutter layer - code decides)
META = {
    'sat_comm': dict(set='B4', rings=[1, 2], contexts=['station', 'lane'], count=[1, 3], scale=[0.9, 1.3],
                     marker='big dish + two solar wings',
                     nodes={'Sat_Dish': 'spin around local +Y, ~6 deg/s', 'Sat_Solar': 'turn around local +Z '
                            '(the boom axis), ~2 deg/s or track the star', 'beacon_0': 'red blink 1 Hz'},
                     drift='slow tumble 2-4 deg/s around one random axis'),
    'sat_survey': dict(set='B4', rings=[1, 2, 3], contexts=['station', 'field'], count=[0, 2], scale=[0.9, 1.3],
                       marker='rotating solar cross (Institute)',
                       nodes={'Sat_Solar': 'spin around local +Y, ~5 deg/s', 'beacon_0': 'cyan pulse 0.5 Hz'},
                       drift='keep upright, slow yaw'),
    'nav_beacon': dict(set='B4', rings=[1, 2], contexts=['lane'], count=[1, 1], scale=[1.0, 1.4],
                       marker='white reflector collar + strobe mast',
                       nodes={'beacon_0': 'green, steady or slow blink', 'beacon_1': 'white strobe: 80 ms flash '
                              'every 1.5 s, offset per beacon along the lane'},
                       drift='keep upright (mast = local +Y), slow bob', spacing='every 60-120 u along trade lanes'),
    'cargo_pod_small': dict(set='B4', rings=[1, 2], contexts=['station', 'wreck', 'lane'], count=[1, 4],
                            scale=[0.9, 1.2], marker='orange/black hazard band',
                            nodes={'beacon_0': 'amber blink 0.8 Hz'}, drift='tumble 5-15 deg/s'),
    'cargo_pallet': dict(set='B4', rings=[1, 2], contexts=['station', 'wreck'], count=[0, 2], scale=[0.9, 1.2],
                         marker='strapped crate grid', nodes={'beacon_0': 'amber blink 0.8 Hz'},
                         drift='tumble 2-6 deg/s'),
    'fuel_canister': dict(set='B4', rings=[1, 2, 3], contexts=['station', 'wreck', 'lane'], count=[1, 4],
                          scale=[0.9, 1.3], marker='yellow sphere', nodes={}, drift='tumble 5-15 deg/s'),
    'ore_canister': dict(set='B4', rings=[1, 2, 3, 4], contexts=['field', 'wreck'], count=[1, 3], scale=[0.9, 1.2],
                         marker='glowing ore slot',
                         nodes={'Ore_Window': 'near-white glowing glass: clone its material and set color + '
                                'emissive to RESOURCES[res].color (emissiveIntensity ~1)'},
                         drift='tumble 5-15 deg/s'),
    'escape_pod': dict(set='B4', rings=[1, 2, 3], contexts=['wreck', 'lane'], count=[0, 1], scale=[1.0, 1.0],
                       marker='orange stripes + red distress lamp + lit porthole',
                       nodes={'beacon_0': 'red distress blink: 3 short + pause'},
                       drift='tumble 3-8 deg/s', note='salvage/event hook - needs sim if it becomes interactive'),
    'claim_marker': dict(set='B4', rings=[1, 2, 3], contexts=['field'], count=[0, 1], scale=[1.0, 1.4],
                         marker='orange claim plate + Guild flag',
                         nodes={'Claim_Base': 'ROOT: origin = spike foot, local +Y = out of the rock; place on '
                                'the asteroid surface along its normal, spike buried', 'beacon_0': 'amber blink 0.5 Hz'},
                         drift='none (stuck in a rock - rotates with it)'),
    'solar_wing_drift': dict(set='B4', rings=[1, 2], contexts=['wreck', 'derelict', 'lane'], count=[0, 2],
                             scale=[0.9, 1.4], marker='blue solar cells', nodes={}, drift='tumble 2-6 deg/s'),
    'pirate_mine': dict(set='B5', rings=[2, 3, 4], contexts=['pirate'], count=[3, 9], scale=[0.9, 1.2],
                        marker='spiked sphere + hazard band + red eye',
                        nodes={'Mine_Core': 'spin around local +Y, ~30 deg/s', 'beacon_0': 'red slow pulse'},
                        drift='bob, no tumble', note='DECORATION ONLY (decision 2026-10-16: no hazard mechanics)'),
    'pirate_stash': dict(set='B5', rings=[2, 3, 4], contexts=['pirate'], count=[0, 2], scale=[1.0, 1.3],
                         marker='welded crate stack', nodes={'beacon_0': 'red dim blink'},
                         drift='slow tumble 1-3 deg/s', note='decoration only'),
    'scrap_raft': dict(set='B5', rings=[2, 3, 4], contexts=['pirate'], count=[0, 1], scale=[1.0, 1.2],
                       marker='welded plate raft with a lamp mast',
                       nodes={'beacon_0': 'red blink', 'beacon_1': 'amber blink'}, drift='slow yaw only',
                       note='decoration only; pirate groups may idle around it'),
}

SCHEMA = {
    'about': 'Batch B space clutter props (art/README 2.7.23). Render-only; no collision unless code adds one '
             '(use `radius`).',
    'file': 'model path relative to public/',
    'size': 'bounding box [x, y(up), z] in glTF axes (model units = game units)',
    'radius': 'bounding sphere radius around the origin',
    'tris': 'triangles incl. child nodes',
    'set': 'B4 human clutter (rings 1-2 mostly) | B5 pirate dressing (decoration only)',
    'contexts': 'station (within ~20-60 u of stations), lane (along trade lanes between stations), field (asteroid '
                'fields), wreck (around wrecks / container drops), derelict (around derelict stations), pirate '
                '(pirate space / near the fortress)',
    'count': '[min, max] per context site',
    'scale': 'suggested uniform scale range',
    'nodes': 'animated / lamp nodes and what code does with them (beacon_<i> blink like station beacons)',
    'drift': 'suggested motion',
    'marker': 'the one bold top-down shape that identifies the prop at the game camera',
}


def describe(name, root):
    import bpy
    bpy.context.view_layer.update()
    objs = [root] + list(root.children_recursive)
    pts = []
    for o in objs:
        if o.type == 'MESH':
            pts += [o.matrix_world @ v.co for v in o.data.vertices]
    mn = [min(p[i] for p in pts) for i in range(3)]
    mx = [max(p[i] for p in pts) for i in range(3)]
    meta = META[name]
    e = {
        'file': f'assets/models/props/{name}.glb',
        'set': meta['set'],
        'tris': sum(G.tri_count(o) for o in objs if o.type == 'MESH'),
        'size': [round(mx[0] - mn[0], 2), round(mx[2] - mn[2], 2), round(mx[1] - mn[1], 2)],
        'radius': round(max(p.length for p in pts), 2),
        'root': root.name,
        'nodes': meta['nodes'],
        'marker': meta['marker'],
        'rings': meta['rings'],
        'contexts': meta['contexts'],
        'count': meta['count'],
        'scale': meta['scale'],
        'drift': meta['drift'],
    }
    for k in ('spacing', 'note'):
        if k in meta:
            e[k] = meta[k]
    return e


def write_manifest(entries, out_dir):
    path = os.path.join(out_dir, 'props.json')
    data = {}
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    data['_schema'] = SCHEMA
    data.update(entries)
    data = {k: data[k] for k in ['_schema'] + [n for n in CLUTTER if n in data]}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    print('BB manifest', path)
    return path
