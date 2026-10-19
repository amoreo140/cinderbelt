"""Repair module 1x1 (game id "repairModule", spec 3.3, M4) - repairs the
neighbouring parts (1 HP/s) using Fe from the cargo.

A swivelling two-segment robot arm with a glowing welding tip on a
turntable, an iron-wire feed spool at the rear and four green repair
emitters pointing at the four neighbouring cells (mid-edges).  Reads
top-down as: green "+" of four edge emitters around a slim arm.

Node layout (pivots = node origins):
  RepairModule_<Tier>     root, static (cell centre, z = 0)
    Repair_Arm            arm on the turntable; pivot (0, 0, ARM_Z); the game
                          swings it around local Z (Blender) = glTF local +Y
                          toward the part being repaired (rest = +X).
      Repair_Tip          empty at the welding tip (spark / beam origin).
Level 2: glowing emitter rims, accent arm joints, tier glow line, corner
brackets.  Level 3: crystal welding focus.
"""
import math
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'repair_module'

ARM_Z = C.DECK_TOP + 0.06


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    top = C.DECK_TOP
    pcs = C.hull_base(t)
    # turntable
    pcs.append(G.ring_band('Turntable', 0.22, 0.10, top - 0.01, top + 0.05, 'hull_mid', verts=24, top_mat=t['plate']))
    pcs.append(G.cyl('TurnWell', 0.105, 0.03, 'trim_black', loc=(0, 0, top + 0.03), verts=16))
    # four edge emitters (one per neighbour): wedge housing + green lens
    for i in range(4):
        a = i * 90
        ar = math.radians(a)
        hous = [(0.30, -0.075), (0.43, -0.055), (0.43, 0.055), (0.30, 0.075)]
        h = G.prism(f'Emitter{i}', hous, top - 0.01, top + 0.09, t['core'], bevel=0.01, seg=1)
        G.transform(h, rot=(0, 0, a))
        pcs.append(h)
        lens = G.cyl(f'Lens{i}', 0.038, 0.02, 'repair_glow', loc=(0.435 * math.cos(ar), 0.435 * math.sin(ar), top + 0.045),
                     axis='X' if i % 2 == 0 else 'Y', verts=12)
        pcs.append(lens)
        if lvl >= 2:
            rim = G.ring_band(f'LensRim{i}', 0.052, 0.038, -0.008, 0.008, t['glow'],
                              loc=(0.425 * math.cos(ar), 0.425 * math.sin(ar), top + 0.045),
                              axis='X' if i % 2 == 0 else 'Y', verts=12)
            pcs.append(rim)
        stripe = G.box(f'EmStripe{i}', 0.32, 0.40, -0.02, 0.02, top + 0.085, top + 0.10, t['accent'])
        G.transform(stripe, rot=(0, 0, a))
        pcs.append(stripe)
    # rear-left corner: iron-wire feed spool on a cradle
    sx, sy = -0.30, 0.30
    pcs.append(G.box('SpoolCradle', sx - 0.11, sx + 0.11, sy - 0.07, sy + 0.07, top - 0.01, top + 0.07, 'hull_dark',
                     bevel=0.01, seg=1))
    pcs.append(G.cyl('Spool', 0.085, 0.13, 'rust', loc=(sx, sy, top + 0.13), axis='X', verts=14))
    for k, dx in enumerate((-0.07, 0.07)):
        pcs.append(G.cyl(f'SpoolFlange{k}', 0.11, 0.014, t['accent'], loc=(sx + dx, sy, top + 0.13), axis='X', verts=14))
    # front-right corner: status light block, rear-right: tool rack
    pcs.append(G.box('StatusBox', 0.25, 0.37, -0.37, -0.25, top - 0.01, top + 0.06, 'hull_mid', bevel=0.01, seg=1))
    pcs.append(G.box('StatusLed', 0.28, 0.34, -0.34, -0.28, top + 0.055, top + 0.07, 'repair_glow'))
    pcs.append(G.box('ToolRack', -0.38, -0.24, -0.38, -0.24, top - 0.01, top + 0.05, t['core'], bevel=0.01, seg=1))
    for k in range(3):
        pcs.append(G.cyl(f'Tool{k}', 0.012, 0.10, 'metal_bare', loc=(-0.35 + k * 0.04, -0.31, top + 0.09), verts=6))
    pcs += C.bolts('Bolt', [(0.37, 0.37), (-0.42, -0.10)], top + 0.005, r=0.02)
    pcs += C.corner_brackets(t, top, corners=(0, 3) if lvl < 3 else (0, 2, 3))
    root = G.join(pcs, f'RepairModule_{tier.capitalize()}')
    G.finalize(root, atlas_dir)

    # ---- arm (modelled around the turntable pivot), rest pointing +X --------
    ap = [G.cyl('Base', 0.10, 0.06, t['core'], loc=(0, 0, 0.03), verts=16, bevel=0.01, seg=1)]
    ap.append(G.box('Shoulder', -0.06, 0.06, -0.055, 0.055, 0.05, 0.16, t['plate'], bevel=0.015, seg=1))
    # upper arm rising forward, forearm reaching down to the tip
    from mathutils import Vector

    def seg(name, p0, p1, w, mat):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        b = G.box(name, 0.0, d.length, -w, w, -w * 0.8, w * 0.8, mat, bevel=0.01, seg=1)
        G.apply_modifiers(b)
        from mathutils import Matrix
        q = Vector((1, 0, 0)).rotation_difference(d.normalized())
        b.data.transform(Matrix.Translation(p0) @ q.to_matrix().to_4x4())
        return b
    j1 = (0.0, 0.0, 0.14)
    j2 = (0.13, 0.0, 0.29)
    tip = (0.30, 0.0, 0.17)
    ap.append(seg('Upper', j1, j2, 0.035, t['plate']))
    ap.append(seg('Fore', j2, tip, 0.026, t['plate']))
    for k, p in enumerate((j1, j2)):
        ap.append(G.cyl(f'Joint{k}', 0.042, 0.10, t['accent'] if lvl >= 2 else 'hull_dark', loc=p, axis='Y', verts=12))
    ap.append(G.cyl('Torch', 0.022, 0.07, 'metal_bare', loc=(0.30 + 0.02, 0, 0.17 - 0.03), axis='Z', verts=8))
    if lvl < 3:
        ap.append(G.ellipsoid('Spark', 0.03, 0.03, 0.03, 'engine_core', loc=(0.33, 0, 0.12), seg=10, rings=6))
    else:
        g = C.gem('TipGem', 0.08, 0.024, sides=6)
        C.place(g, (0.32, 0, 0.16), (0.3, 0, -1.0))
        ap.append(g)
        ap.append(G.ellipsoid('Spark', 0.022, 0.022, 0.022, 'engine_core', loc=(0.345, 0, 0.085), seg=8, rings=6))
    ap.append(G.box('ShoulderLed', -0.045, -0.015, -0.03, 0.03, 0.155, 0.17, 'repair_glow'))
    arm = G.join(ap, 'Repair_Arm')
    G.finalize(arm, atlas_dir)
    arm.location = (0, 0, ARM_Z)
    arm.parent = root
    tipe = G.empty('Repair_Tip', loc=(0.335, 0, 0.11 if lvl < 3 else 0.085))
    tipe.parent = arm
    return root
