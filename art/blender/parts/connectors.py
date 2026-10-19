"""Hull connectors - small pieces the game drops between neighbouring cells
so a ship reads as one hull.

hull_connector_edge   origin = centre of the seam between two orthogonally
                      adjacent cells.  Modelled for a seam at x = 0 running
                      along Y (cells at x = -0.5 and x = +0.5).  Rotate 90 deg
                      about the up axis for vertical neighbours.
hull_connector_corner origin = the point where 4 cells of a 2x2 block meet.
"""
from lib import geo as G
from lib import palette as P
from parts import common as C

FILL_Z0 = C.CORE_Z0 + 0.01
FILL_Z1 = C.DECK_TOP - 0.03       # seam becomes a shallow panel-line groove


def build_edge(tier, atlas_dir):
    t = P.TIERS[tier]
    g = 1 - 2 * C.HALF                # seam width (0.03)
    pcs = []
    # fill the seam below deck level (overlaps the neighbours' cores by 1 mm)
    pcs.append(G.box('SeamFill', -g / 2 - 0.001, g / 2 + 0.001, -C.HALF + 0.001, C.HALF - 0.001,
                     FILL_Z0, FILL_Z1, 'hull_dark'))
    # bridge the skirt belt across the seam (visible at the perimeter).  Neutral
    # dark so it works between parts of any tier (reads as a belt joint).
    o = C.HALF + C.SKIRT_OUT
    pcs.append(G.box('SkirtBridge', -g / 2 - 0.004, g / 2 + 0.004, -o, o, C.SKIRT_Z0, C.SKIRT_Z1, 'trim_black'))
    # structural strap over the seam (short, so it never overhangs an engine's
    # open rear half: engine decks start 0.115 behind their cell centre)
    pcs.append(G.prism('Strap', G.chamfer_rect(-0.052, 0.052, -0.13, 0.13, 0.03),
                       C.DECK_TOP - 0.02, C.DECK_TOP + 0.022, 'hull_mid', bevel=0.008, seg=1))
    pcs.append(G.box('StrapLine', -0.008, 0.008, -0.06, 0.06, C.DECK_TOP + 0.015, C.DECK_TOP + 0.026,
                     'panel_line'))
    pcs += C.bolts('Bolt', [(0, -0.095), (0, 0.095)], C.DECK_TOP + 0.024, r=0.017)
    root = G.join(pcs, 'Hull_Connector_Edge')
    G.finalize(root, atlas_dir)
    return root


def build_corner(tier, atlas_dir):
    t = P.TIERS[tier]
    pcs = []
    pcs.append(G.box('CrossFill', -0.03, 0.03, -0.03, 0.03, FILL_Z0, FILL_Z1, 'hull_dark'))
    pcs.append(G.prism('Cap', G.chamfer_rect(-0.085, 0.085, -0.085, 0.085, 0.035),
                       C.DECK_TOP - 0.02, C.DECK_TOP + 0.026, 'hull_mid', bevel=0.008, seg=1))
    pcs.append(G.cyl('Hub', 0.03, 0.02, 'metal_bare', loc=(0, 0, C.DECK_TOP + 0.03), verts=12,
                     bevel=0.005, seg=1))
    root = G.join(pcs, 'Hull_Connector_Corner')
    G.finalize(root, atlas_dir)
    return root
