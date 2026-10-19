"""Large reactor 2x2 (game id "largeReactor", spec 3.3, M4) - 45 energy/s,
EXPLODES when destroyed (40 dmg to neighbours), so it wears hazard
markings.

A tokamak: a big torus of segmented magnet coils around a glowing plasma
ring, a central glowing core column, four hyperboloid cooling towers on the
corners, hazard chevrons on the deck rim.  Reads top-down as a glowing teal
ring inside a square with four round towers.

Footprint x, y in [-1, 1] (centred on the footprint centre, see
parts/common.py multi-cell convention).

Node layout (pivots = node origins):
  LargeReactor_<Tier>     root, static (footprint centre, z = 0)
    Reactor_Plasma        plasma ring with bright hot spots; pivot (0, 0, TOR_Z);
                          spin around local Z (Blender) = glTF local +Y (fast).
Level 2: glowing coil caps, glowing tower rims, tier glow line, corner
brackets.  Level 3: crystal containment prisms on the core cap.
"""
import math
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'large_reactor'
CELLS = (2, 2)

TOR_Z = 0.46           # torus centre height
TOR_R = 0.50           # major radius
TOWERS = ((0.68, 0.68), (-0.68, 0.68), (-0.68, -0.68), (0.68, -0.68))


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    top = C.DECK_TOP
    px, py = C.plate_half(*CELLS)
    pcs = C.hull_base(t, *CELLS)
    # round plinth + dark well under the torus
    pcs.append(G.ring_band('Plinth', 0.80, 0.24, top - 0.01, top + 0.08, 'hull_mid', verts=40, top_mat=t['plate']))
    pcs.append(G.cyl('Well', 0.25, 0.04, 'trim_black', loc=(0, 0, top + 0.06), verts=24))
    pcs.append(G.ring_band('PlinthGlow', 0.74, 0.70, top + 0.08, top + 0.09, 'reactor_glow', verts=40))
    # torus shell segments (coils) - 12 blocks with gaps that show the plasma
    n = 8
    for i in range(n):
        a = 360.0 * i / n
        # rectangular-ish coil block around the tube, built as a short loft
        span = 360.0 / n - 20.0
        ring = []
        steps = 3
        for k in range(steps + 1):
            ang = math.radians(a - span / 2 + span * k / steps)
            ring.append(ang)
        from mathutils import Vector
        import bmesh
        bm = bmesh.new()
        secs = []
        for ang in ring:
            rad = Vector((math.cos(ang), math.sin(ang), 0))
            c = rad * TOR_R + Vector((0, 0, TOR_Z))
            hw, hh = 0.19, 0.17
            sec = [c - rad * hw - Vector((0, 0, hh)), c + rad * hw - Vector((0, 0, hh)),
                   c + rad * hw + Vector((0, 0, hh)), c - rad * hw + Vector((0, 0, hh))]
            secs.append([bm.verts.new(p) for p in sec])
        for A, B in zip(secs[:-1], secs[1:]):
            for k in range(4):
                j = (k + 1) % 4
                bm.faces.new((A[k], A[j], B[j], B[k]))
        bm.faces.new(list(reversed(secs[0])))
        bm.faces.new(secs[-1])
        blk = G.obj_from_bm(f'Coil{i}', bm, [t['plate'] if i % 2 == 0 else t['core']])
        G.add_bevel(blk, 0.02, 1)
        pcs.append(blk)
        # accent cap on top of every other coil (level 2: glowing)
        if i % 2 == 0:
            ca = math.radians(a)
            cap = G.box(f'CoilCap{i}', -0.10, 0.10, -0.035, 0.035, TOR_Z + 0.165, TOR_Z + 0.19,
                        t['glow'] if lvl >= 2 else t['accent'], bevel=0.006, seg=1)
            G.transform(cap, loc=(TOR_R * math.cos(ca), TOR_R * math.sin(ca), 0), rot=(0, 0, a))
            pcs.append(cap)
    # dark containment rails under the plasma (between the coils)
    pcs.append(G.torus('Rail', TOR_R, 0.035, 'hull_dark', loc=(0, 0, TOR_Z - 0.13), maj=40, mnr=6))
    # central core column + cap
    pcs.append(G.cyl('CoreCol', 0.12, 0.62, 'reactor_glow', loc=(0, 0, top + 0.06 + 0.31), verts=16))
    for i, z in enumerate((0.40, 0.56)):
        pcs.append(G.ring_band(f'CoreBand{i}', 0.14, 0.115, z - 0.015, z + 0.015, t['accent'], verts=16))
    pcs.append(G.ring_band('CoreCap', 0.20, 0.07, 0.86, 0.91, 'hull_mid', verts=20, top_mat=t['plate']))
    pcs.append(G.cyl('CoreTop', 0.075, 0.03, 'reactor_glow', loc=(0, 0, 0.90), verts=14))
    if lvl >= 3:
        for i in range(4):
            a = math.radians(45 + i * 90)
            g = C.gem(f'CapGem{i}', 0.18, 0.035, sides=6)
            C.place(g, (0.13 * math.cos(a), 0.13 * math.sin(a), 0.89), (0.5 * math.cos(a), 0.5 * math.sin(a), 1.0))
            pcs.append(g)
    # four hyperboloid cooling towers on the corners
    for i, (x, y) in enumerate(TOWERS):
        prof = [(top - 0.01, 0.0), (top - 0.01, 0.20), (top + 0.18, 0.15), (0.62, 0.135), (0.74, 0.17),
                (0.74, 0.13), (0.66, 0.10), (0.66, 0.0)]
        pcs.append(G.lathe(f'Tower{i}', prof, [0, 1, 1, 1, 2, 3, 3],
                           ['hull_dark', t['plate'], t['accent'], 'trim_black'], loc=(x, y, 0), axis='Z',
                           verts=16, closed=False))
        pcs.append(G.cyl(f'TowerGlow{i}', 0.10, 0.012, 'reactor_glow', loc=(x, y, 0.668), verts=14))
        pcs.append(G.ring_band(f'TowerBand{i}', 0.16, 0.14, 0.42, 0.45, t['core'], loc=(x, y, 0), verts=16))
        if lvl >= 2:
            pcs.append(G.ring_band(f'TowerRim{i}', 0.172, 0.15, 0.74, 0.75, t['glow'], loc=(x, y, 0), verts=16))
        # coolant pipe tower -> torus
        a = math.atan2(y, x)
        pipe = G.box(f'Pipe{i}', 0.0, 0.26, -0.03, 0.03, -0.03, 0.03, 'metal_bare', bevel=0.008, seg=1)
        G.transform(pipe, loc=(x - 0.16 * math.cos(a) - 0.26 * math.cos(a), y - 0.16 * math.sin(a) - 0.26 * math.sin(a),
                               top + 0.14), rot=(0, 0, math.degrees(a)))
        pcs.append(pipe)
    # hazard chevrons on the deck edges (explosive!) + amber warning lamps
    for side in range(4):
        rot = side * 90
        for k in range(4):
            u = -0.30 + k * 0.2
            b = G.box(f'Haz{side}{k}', -0.018, 0.018, -0.06, 0.06, top - 0.004, top + 0.008,
                      'trim_black' if k % 2 else t['accent'])
            from mathutils import Matrix
            b.data.transform(Matrix.Rotation(math.radians(rot), 4, 'Z') @ Matrix.Translation((0.90, u, 0))
                             @ Matrix.Rotation(math.radians(35), 4, 'Z'))
            pcs.append(b)
    for i, (x, y) in enumerate(((0.90, 0.0), (-0.90, 0.0), (0.0, 0.90), (0.0, -0.90))):
        pcs.append(G.box(f'Warn{i}', x - 0.03, x + 0.03, y - 0.03, y + 0.03, top, top + 0.035, 'light_amber',
                         bevel=0.008, seg=1))
    pcs += C.bolts('Bolt', [(sx * (px - 0.06), sy * 0.42) for sx in (1, -1) for sy in (1, -1)], top + 0.005, r=0.022)
    pcs += C.corner_brackets(t, top, hx=px, hy=py, arm=0.16)
    root = G.join(pcs, f'LargeReactor_{tier.capitalize()}')
    G.finalize(root, atlas_dir)

    # ---- spinning plasma ring (pivot on the torus centre) ------------------
    pp = [G.torus('Plasma', TOR_R, 0.105, 'reactor_glow', maj=40, mnr=10)]
    for i in range(4):
        a = math.radians(i * 90 + 20)
        pp.append(G.ellipsoid(f'HotSpot{i}', 0.12, 0.12, 0.115, 'engine_core',
                              loc=(TOR_R * math.cos(a), TOR_R * math.sin(a), 0), seg=10, rings=6))
    plasma = G.join(pp, 'Reactor_Plasma')
    G.finalize(plasma, atlas_dir)
    plasma.location = (0, 0, TOR_Z)
    plasma.parent = root
    return root
