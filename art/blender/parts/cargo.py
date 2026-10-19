"""Cargo hold 1x1 - ribbed container block with a top hatch."""
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'cargo'


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    top = C.DECK_TOP
    lvl = C.level(t)
    pcs = C.core_block(tier=t)
    pcs.append(C.deck_plate('Plate', mat=t['plate']))
    z0, z1 = top - 0.01, 0.44
    s = 0.36
    # container body + corrugation ribs
    pcs.append(G.box('Box', -s, s, -s, s, z0, z1, 'hull_mid', bevel=0.015, seg=1))
    ribs = (-0.24, -0.12, 0.0, 0.12, 0.24)
    for i, p in enumerate(ribs):
        pcs.append(G.box(f'RibY{i}', p - 0.022, p + 0.022, -s - 0.015, s + 0.015, z0 + 0.03, z1 - 0.04,
                         'hull_dark', bevel=0.006, seg=1))
        pcs.append(G.box(f'RibX{i}', -s - 0.015, s + 0.015, p - 0.022, p + 0.022, z0 + 0.03, z1 - 0.04,
                         'hull_dark', bevel=0.006, seg=1))
    # corner posts
    for i, (x, y) in enumerate(((s, s), (-s, s), (-s, -s), (s, -s))):
        pcs.append(G.box(f'Post{i}', x - 0.05, x + 0.05, y - 0.05, y + 0.05, z0, z1 + 0.03,
                         t['plate'], bevel=0.014, seg=2))
        if lvl >= 2:  # accent corner caps
            pcs.append(G.box(f'PostCap{i}', x - 0.055, x + 0.055, y - 0.055, y + 0.055, z1 + 0.02, z1 + 0.05,
                             t['accent'], bevel=0.01, seg=1))
    # accent belt around the container
    pcs.append(G.box('Belt', -s - 0.022, s + 0.022, -s - 0.022, s + 0.022, 0.30, 0.335,
                     t['accent'], bevel=0.006, seg=1))
    if lvl >= 2:  # second, glowing belt line
        pcs.append(G.box('BeltGlow', -s - 0.018, s + 0.018, -s - 0.018, s + 0.018, 0.255, 0.268, t['glow']))
    # lid with hatch
    pcs.append(G.prism('Lid', G.chamfer_rect(-s + 0.01, s - 0.01, -s + 0.01, s - 0.01, 0.05), z1 - 0.01, z1 + 0.02,
                       t['plate'], bevel=0.01, seg=1))
    pcs.append(G.prism('HatchGroove', G.chamfer_rect(-0.22, 0.22, -0.22, 0.22, 0.05), z1 + 0.01,
                       z1 + (0.026 if lvl < 2 else 0.03), 'panel_line' if lvl < 2 else t['glow']))
    pcs.append(G.prism('Hatch', G.chamfer_rect(-0.20, 0.20, -0.20, 0.20, 0.045), z1 + 0.01, z1 + 0.045,
                       'hull_white', bevel=0.01, seg=1))
    # hatch hinge bar + handle + status light
    pcs.append(G.cyl('Hinge', 0.018, 0.30, 'metal_bare', loc=(-0.205, 0, z1 + 0.045), axis='Y', verts=8))
    pcs.append(G.box('Handle', 0.12, 0.16, -0.08, 0.08, z1 + 0.04, z1 + 0.07, t['accent'], bevel=0.008, seg=1))
    # diagonal hazard stripes on the hatch
    for i, o in enumerate((-0.09, 0.0, 0.09)):
        st = G.box(f'Hazard{i}', -0.016, 0.016, -0.07, 0.07, z1 + 0.04, z1 + 0.05, 'trim_black')
        G.transform(st, loc=(o - 0.02, 0, 0), rot=(0, 0, 35))
        pcs.append(st)
    pcs.append(G.box('Light', -0.30, -0.26, 0.26, 0.30, z1 + 0.02, z1 + 0.045, 'light_amber', bevel=0.006, seg=1))
    if lvl >= 3:  # T3: crystal seal bar across the hatch + gem caps on the posts
        pcs.append(C.gem_bar('SealGem', (-0.16, -0.19, z1 + 0.05), (-0.16, 0.19, z1 + 0.05), 0.065, 0.06))
        for i, (x, y) in enumerate(((s, s), (-s, s), (-s, -s), (s, -s))):
            g = C.gem(f'PostGem{i}', 0.09, 0.03, sides=4, base=0.0)
            C.place(g, (x, y, z1 + 0.05), (0, 0, 1), roll=45)
            pcs.append(g)
    root = G.join(pcs, f'Cargo_{tier.capitalize()}')
    G.finalize(root, atlas_dir)
    return root
