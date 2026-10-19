"""Tractor beam 1x1 (game id "tractorBeam") - a swivelling projector with a
ring/coil emitter (three stacked coils narrowing toward a violet lens)
facing +X.

Node layout (pivots = node origins):
  TractorBeam_<Tier>      root, static base (cell centre, z = 0)
    Tractor_Head          projector head; pivot (0, 0, HEAD_Z) on the cell's
                          vertical axis.  Rotate around local Z (Blender) =
                          glTF local +Y to aim (+-90 deg from +X).
      Tractor_Emitter     empty at the emitter tip = beam origin, points +X.

Level 2: an extra glowing coil, accent prongs, glowing side vents, corner
brackets, tier glow line.
"""
import math
from mathutils import Matrix, Vector
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'tractor_beam'

HEAD_Z = C.DECK_TOP + 0.05     # top of the swivel ring
AXIS_Z = 0.19                  # emitter axis height above the pivot
EMITTER_X = 0.44               # emitter tip (front face of the outer ring), local to the head


def _strut(name, p0, p1, hw, mat):
    """Square bar from p0 to p1 (half width hw)."""
    d = p1 - p0
    ob = G.box(name, 0.0, d.length, -hw, hw, -hw, hw, mat, bevel=0.007, seg=1)
    G.apply_modifiers(ob)
    q = Vector((1, 0, 0)).rotation_difference(d.normalized())
    ob.data.transform(Matrix.Translation(p0) @ q.to_matrix().to_4x4())
    return ob


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    top = C.DECK_TOP
    pcs = C.hull_base(t)
    pcs.append(G.ring_band('Swivel', 0.33, 0.27, top - 0.01, top + 0.05, 'hull_mid', verts=24,
                           top_mat=t['plate']))
    pcs.append(G.cyl('Well', 0.275, 0.03, 'trim_black', loc=(0, 0, top + 0.005), verts=24))
    for i, a in enumerate((-90, -45, 0, 45, 90)):   # +-90 deg arc ticks
        r = math.radians(a)
        b = G.box(f'Tick{i}', -0.022, 0.022, -0.009, 0.009, top - 0.004, top + 0.006,
                  'tractor_glow' if a == 0 else t['accent'])
        G.transform(b, loc=(0.39 * math.cos(r), 0.39 * math.sin(r), 0), rot=(0, 0, a))
        pcs.append(b)
    # rear power coupling (outside the head's swing on the deck corners)
    for i, (x, y) in enumerate(((-0.40, 0.40), (-0.40, -0.40))):
        pcs.append(G.box(f'Coupler{i}', x - 0.05, x + 0.05, y - 0.05, y + 0.05, top - 0.01, top + 0.05,
                         t['core'], bevel=0.01, seg=1))
        pcs.append(G.box(f'CouplerGlow{i}', x - 0.03, x + 0.03, y - 0.03, y + 0.03, top + 0.045, top + 0.058,
                         'tractor_glow'))
    pcs += C.bolts('Bolt', [(0.40, 0.40), (0.40, -0.40)], top + 0.005, r=0.022)
    pcs += C.corner_brackets(t, top)
    root = G.join(pcs, f'TractorBeam_{tier.capitalize()}')
    G.finalize(root, atlas_dir)

    # ---- projector head (around its pivot) --------------------------------
    hp = []
    hp.append(G.cyl('HeadBase', 0.25, 0.05, t['core'], loc=(0, 0, 0.02), verts=24, bevel=0.01, seg=1))
    # rounded rear housing (generator)
    hp.append(G.lathe('Housing', [(-0.27, 0.0), (-0.27, 0.10), (-0.24, 0.155), (-0.05, 0.165), (0.06, 0.14),
                                  (0.08, 0.0)],
                      [0, 0, 0, 0, 0], [t['plate']], loc=(0, 0, AXIS_Z), axis='X', verts=20))
    hp.append(G.box('Pedestal', -0.20, 0.02, -0.10, 0.10, 0.03, AXIS_Z - 0.06, t['core'], bevel=0.015, seg=1))
    hp.append(G.ring_band('HousingBand', 0.172, 0.15, -0.018, 0.018, t['accent'], loc=(-0.12, 0, AXIS_Z),
                          axis='X', verts=20))
    hp.append(G.box('TopVent', -0.22, -0.02, -0.05, 0.05, AXIS_Z + 0.15, AXIS_Z + 0.175, 'trim_black',
                    bevel=0.005, seg=1))
    hp.append(G.box('TopGlow', -0.20, -0.04, -0.025, 0.025, AXIS_Z + 0.165, AXIS_Z + 0.18, 'tractor_glow'))
    if lvl >= 2:
        for s in (1, -1):
            hp.append(G.box(f'SideVent{s}', -0.2, -0.05, s * 0.16 - 0.01, s * 0.16 + 0.01, AXIS_Z - 0.02,
                            AXIS_Z + 0.02, t['glow']))
    # coil stack: rings narrowing toward the lens, outer emitter ring at the front
    coils = ((0.13, 0.110, 0.022), (0.20, 0.095, 0.018), (0.27, 0.080, 0.016))
    if lvl >= 2:
        coils = coils + ((0.235, 0.088, 0.010),)
    hp.append(G.cyl('Spindle', 0.045, 0.30, 'metal_bare', loc=(0.21, 0, AXIS_Z), axis='X', verts=12))
    for i, (x, R, r) in enumerate(coils):
        glow = i == 3 or (i == 1)
        hp.append(G.torus(f'Coil{i}', R, r, 'tractor_glow' if glow else t['core'], loc=(x, 0, AXIS_Z),
                          rot=(0, 90, 0), maj=14, mnr=4))
    # big outer emitter ring held by three prongs
    ring_x = EMITTER_X - 0.035
    hp.append(G.torus('EmitterRing', 0.165, 0.032, t['plate'], loc=(ring_x, 0, AXIS_Z), rot=(0, 90, 0),
                      maj=20, mnr=6))
    hp.append(G.torus('EmitterGlow', 0.165, 0.014, 'tractor_glow', loc=(ring_x + 0.03, 0, AXIS_Z), rot=(0, 90, 0),
                      maj=20, mnr=4))
    for i in range(3):
        a = math.radians(90 + i * 120)
        cy, cz = math.cos(a), math.sin(a)
        p0 = Vector((-0.02, 0.135 * cy, AXIS_Z + 0.135 * cz))
        p1 = Vector((ring_x - 0.02, 0.172 * cy, AXIS_Z + 0.172 * cz))
        hp.append(_strut(f'Prong{i}', p0, p1, 0.022, t['accent'] if lvl >= 2 else t['core']))
        hp.append(G.box(f'ProngTip{i}', ring_x - 0.035, ring_x + 0.02, 0.172 * cy - 0.03, 0.172 * cy + 0.03,
                        AXIS_Z + 0.172 * cz - 0.03, AXIS_Z + 0.172 * cz + 0.03, t['core'], bevel=0.008, seg=1))
    # violet lens disc in the coil throat
    hp.append(G.ellipsoid('Lens', 0.03, 0.075, 0.075, 'tractor_glass', seg=14, rings=6))
    hp[-1].location = (0.31, 0, AXIS_Z)
    hp.append(G.ellipsoid('LensCore', 0.02, 0.035, 0.035, 'tractor_glow', seg=12, rings=6))
    hp[-1].location = (0.335, 0, AXIS_Z)
    head = G.join(hp, 'Tractor_Head')
    G.finalize(head, atlas_dir)
    head.location = (0, 0, HEAD_Z)
    head.parent = root

    tip = G.empty('Tractor_Emitter', loc=(EMITTER_X, 0, AXIS_Z))
    tip.parent = head
    return root
