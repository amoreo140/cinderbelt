"""Armor plate 1x1 - the neutral filler block of the hull.
Kept deliberately calm on top (it is the most repeated part) so a ship reads
as one hull; the tier accent runs around the side skirt.
Level 2: double chevron, split pad with a glowing seam, corner brackets."""
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'armor'

CHEVRON = [(-0.04, 0.10), (0.05, 0.0), (-0.04, -0.10), (-0.10, -0.10), (-0.01, 0.0), (-0.10, 0.10)]


def _chevron(name, dx, z0, z1, mat):
    pts = [(x + dx, y) for x, y in reversed(CHEVRON)]
    return G.prism(name, pts, z0, z1, mat, bevel=0.004, seg=1)


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    pcs = C.core_block(tier=t)
    top = C.DECK_TOP
    pcs.append(C.deck_plate('Plate', z1=top, mat=t['plate']))
    # raised armour pad with a dark panel-line groove around it
    pcs.append(G.prism('PadGroove', G.chamfer_rect(-0.30, 0.30, -0.30, 0.30, 0.09),
                       top - 0.01, top + 0.006, 'panel_line'))
    if lvl < 2:
        pcs.append(G.prism('Pad', G.chamfer_rect(-0.28, 0.28, -0.28, 0.28, 0.08),
                           top - 0.01, top + 0.04, 'hull_white', bevel=0.014, seg=2))
        pcs.append(_chevron('Chevron', 0.0, top + 0.03, top + 0.05, t['accent']))
    else:
        # pad split in two by a glowing seam, sleeker double chevron
        for s, nm in ((1, 'L'), (-1, 'R')):
            y0, y1 = (0.012, 0.28) if s > 0 else (-0.28, -0.012)
            pts = G.chamfer_rect(-0.28, 0.28, y0, y1, 0.0)
            c = 0.08
            if s > 0:
                pts = [(-0.28, y0), (0.28, y0), (0.28, y1 - c), (0.28 - c, y1), (-0.28 + c, y1), (-0.28, y1 - c)]
            else:
                pts = [(-0.28 + c, y0), (0.28 - c, y0), (0.28, y0 + c), (0.28, y1), (-0.28, y1), (-0.28, y0 + c)]
            pcs.append(G.prism('Pad' + nm, pts, top - 0.01, top + 0.045, 'hull_white', bevel=0.012, seg=2))
        pcs.append(G.box('PadSeamGlow', -0.27, 0.27, -0.012, 0.012, top + 0.0, top + 0.03, t['glow']))
        if lvl < 3:
            pcs.append(_chevron('Chevron0', -0.07, top + 0.035, top + 0.055, t['accent']))
            pcs.append(_chevron('Chevron1', 0.08, top + 0.035, top + 0.055, t['accent']))
        else:   # T3: one bold chevron at the bow end of the crystal bar
            pcs.append(_chevron('Chevron0', 0.19, top + 0.035, top + 0.06, t['accent']))
        if lvl >= 3:  # T3: cut-crystal bar set into the glowing seam
            pcs.append(C.gem_bar('SeamGem', (-0.26, 0, top + 0.04), (0.08, 0, top + 0.04), 0.075, 0.06))
        pcs += C.corner_brackets(t, top)
    pcs += C.bolts('Bolt', [(x, y) for x in (-0.39, 0.39) for y in (-0.39, 0.39)],
                   top + 0.005, r=0.022)
    root = G.join(pcs, f'Armor_{tier.capitalize()}')
    G.finalize(root, atlas_dir)
    return root
