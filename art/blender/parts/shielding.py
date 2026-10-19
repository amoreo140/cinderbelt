"""Radiation shielding 1x1 (game id "shielding", spec 3.3 / 6.7.1, M5a) -
armour that absorbs radiation for the cells behind it (80 %).

Visually distinct from the armour plate: a heavy STEPPED stack of three
dense slabs (dark lead-grey) with amber absorber glow seams between the
layers, a louvred top grille, yellow/black radiation-warning corner
triangles and thick side baffles.  Reads top-down as concentric squares with
a yellow glowing frame.  No animated nodes (the game may pulse the
`rad_core` emission with the absorbed dose).

Level 2: second absorber seam, accent baffles, tier glow line (the corners
carry the warning triangles, so no brackets).  Level 3: crystal lattice bars across the grille.
"""
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'shielding'


def _tri(name, sx, sy, z, mat, s=0.11):
    """Warning triangle in a corner (right angle toward the corner)."""
    h = C.PLATE_HALF - 0.04
    pts = [(sx * h, sy * h), (sx * (h - s), sy * h), (sx * h, sy * (h - s))]
    if sx * sy > 0:
        pts = list(reversed(pts))
    return G.prism(name, pts, z - 0.01, z + 0.012, mat, bevel=0.003, seg=1)


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    top = C.DECK_TOP
    pcs = C.hull_base(t)
    # three stepped dense slabs
    slabs = ((0.40, top - 0.01, top + 0.07), (0.33, top + 0.07, top + 0.15), (0.26, top + 0.15, top + 0.22))
    for i, (s, z0, z1) in enumerate(slabs):
        pcs.append(G.prism(f'Slab{i}', G.chamfer_rect(-s, s, -s, s, 0.05), z0, z1,
                           'hull_dark' if i != 1 else 'metal_bare', bevel=0.012, seg=1))
    # absorber glow seams between the slabs
    seams = (slabs[0][2],) if lvl < 2 else (slabs[0][2], slabs[1][2])
    for i, z in enumerate(seams):
        s = slabs[i][0] - 0.018
        pcs.append(G.prism(f'Seam{i}', G.chamfer_rect(-s, s, -s, s, 0.05), z - 0.012, z + 0.006, 'rad_core'))
    # louvred grille on the top slab
    s = slabs[2][0]
    zt = slabs[2][2]
    pcs.append(G.box('GrilleWell', -s + 0.05, s - 0.05, -s + 0.05, s - 0.05, zt - 0.01, zt + 0.004, 'trim_black'))
    for k in range(6):
        y = -s + 0.08 + k * (2 * s - 0.16) / 5
        pcs.append(G.box(f'Louvre{k}', -s + 0.06, s - 0.06, y - 0.017, y + 0.017, zt - 0.005, zt + 0.022,
                         t['plate'], bevel=0.005, seg=1))
    if lvl >= 3:
        for k, x in enumerate((-0.08, 0.08)):
            pcs.append(C.gem_bar(f'LatticeGem{k}', (x, -s + 0.07, zt + 0.02), (x, s - 0.07, zt + 0.02), 0.035, 0.035))
    # thick side baffles on the four sides of the bottom slab
    for i in range(4):
        b = G.box(f'Baffle{i}', 0.40, 0.445, -0.20, 0.20, top - 0.01, top + 0.10,
                  t['accent'] if lvl >= 2 else 'hull_mid', bevel=0.01, seg=1)
        G.transform(b, rot=(0, 0, i * 90))
        pcs.append(b)
    # radiation-warning triangles (yellow with a black inner) on the plate corners
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        pcs.append(_tri(f'Warn{i}', sx, sy, top + 0.005, 'fuel_yellow'))
        pcs.append(_tri(f'WarnIn{i}', sx * 0.985, sy * 0.985, top + 0.016, 'trim_black', s=0.05))
    root = G.join(pcs, f'Shielding_{tier.capitalize()}')
    G.finalize(root, atlas_dir)
    return root
