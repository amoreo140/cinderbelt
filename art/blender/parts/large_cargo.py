"""Large cargo hold 2x2 (game id "largeCargo") - one big ribbed hold with two
long container bays (sliding hatches along X), a central spine and a gantry
crane bridging the bays.

Footprint: x, y in [-1, 1] (centred on the footprint centre, see
parts/common.py multi-cell convention).  No animated nodes.
Level 2: accent post caps, glowing hatch grooves and belt line, corner
brackets, tier glow line.
"""
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'large_cargo'
CELLS = (2, 2)


def _hatch(name, x0, x1, y0, y1, z, t, lvl):
    """Long bay hatch (sliding door) with hazard ends, handle and seams."""
    out = []
    c = 0.06
    out.append(G.prism(name + 'Groove', G.chamfer_rect(x0 - 0.02, x1 + 0.02, y0 - 0.02, y1 + 0.02, c), z - 0.01,
                       z + (0.016 if lvl < 2 else 0.02), 'panel_line' if lvl < 2 else t['glow']))
    out.append(G.prism(name, G.chamfer_rect(x0, x1, y0, y1, c - 0.01), z - 0.01, z + 0.035,
                       'hull_white', bevel=0.01, seg=1))
    # two door leaves meeting in the middle: seam + reinforcing ribs
    xm = (x0 + x1) / 2
    out.append(G.box(name + 'Seam', xm - 0.008, xm + 0.008, y0 + 0.03, y1 - 0.03, z + 0.03, z + 0.04, 'panel_line'))
    for i, x in enumerate((x0 + (xm - x0) * 0.5, xm + (x1 - xm) * 0.5)):
        out.append(G.box(f'{name}Rib{i}', x - 0.02, x + 0.02, y0 + 0.05, y1 - 0.05, z + 0.03, z + 0.05,
                         t['plate'], bevel=0.006, seg=1))
    # hazard stripes at both ends
    yc = (y0 + y1) / 2
    for e, xe in enumerate((x0 + 0.09, x1 - 0.09)):
        out.append(G.box(f'{name}HazBack{e}', xe - 0.05, xe + 0.05, y0 + 0.04, y1 - 0.04, z + 0.03, z + 0.042,
                         t['accent'], bevel=0.003, seg=1))
        for k, o in enumerate((-0.16, -0.05, 0.06, 0.17)):
            st = G.box(f'{name}Haz{e}{k}', -0.014, 0.014, -0.05, 0.05, z + 0.038, z + 0.048, 'trim_black')
            G.transform(st, loc=(xe, yc + o, 0), rot=(0, 0, 35))
            out.append(st)
    # handles beside the seam
    for k, x in enumerate((xm - 0.06, xm + 0.06)):
        out.append(G.box(f'{name}Handle{k}', x - 0.018, x + 0.018, yc - 0.07, yc + 0.07, z + 0.035, z + 0.065,
                         'metal_bare', bevel=0.006, seg=1))
    return out


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    top = C.DECK_TOP
    pcs = C.hull_base(t, *CELLS)
    z0, z1 = top - 0.01, 0.48
    s = 0.86
    # hold body + corrugation ribs on all four walls
    pcs.append(G.box('Hold', -s, s, -s, s, z0, z1, 'hull_mid', bevel=0.02, seg=1))
    ribs = [-0.62 + i * 0.155 for i in range(9)]
    for i, p in enumerate(ribs):
        if abs(p) < 0.05:
            continue
        pcs.append(G.box(f'RibY{i}', p - 0.024, p + 0.024, -s - 0.016, s + 0.016, z0 + 0.03, z1 - 0.05,
                         'hull_dark', bevel=0.006, seg=1))
        pcs.append(G.box(f'RibX{i}', -s - 0.016, s + 0.016, p - 0.024, p + 0.024, z0 + 0.03, z1 - 0.05,
                         'hull_dark', bevel=0.006, seg=1))
    # mid-wall pilasters (where the ribs skip) in plate colour
    for i, (x, y, ax) in enumerate(((0, s, 'y'), (0, -s, 'y'), (s, 0, 'x'), (-s, 0, 'x'))):
        hw = (0.06, 0.03) if ax == 'y' else (0.03, 0.06)
        pcs.append(G.box(f'Pilaster{i}', x - hw[0] - (0.0 if ax == 'y' else 0.0), x + hw[0], y - hw[1], y + hw[1],
                         z0, z1 + 0.01, t['plate'], bevel=0.01, seg=1))
    # corner posts
    for i, (x, y) in enumerate(((s, s), (-s, s), (-s, -s), (s, -s))):
        pcs.append(G.box(f'Post{i}', x - 0.07, x + 0.07, y - 0.07, y + 0.07, z0, z1 + 0.035,
                         t['plate'], bevel=0.018, seg=2))
        if lvl >= 2:
            pcs.append(G.box(f'PostCap{i}', x - 0.075, x + 0.075, y - 0.075, y + 0.075, z1 + 0.025, z1 + 0.06,
                             t['accent'], bevel=0.012, seg=1))
        if lvl >= 3:
            g = C.gem(f'PostGem{i}', 0.12, 0.04, sides=4, base=0.0)
            C.place(g, (x, y, z1 + 0.055), (0, 0, 1), roll=45)
            pcs.append(g)
    # accent belt around the hold (+ glowing line on level 2)
    pcs.append(G.box('Belt', -s - 0.024, s + 0.024, -s - 0.024, s + 0.024, 0.33, 0.37,
                     t['accent'], bevel=0.006, seg=1))
    if lvl >= 2:
        pcs.append(G.box('BeltGlow', -s - 0.02, s + 0.02, -s - 0.02, s + 0.02, 0.285, 0.298, t['glow']))
    # roof
    pcs.append(G.prism('Roof', G.chamfer_rect(-s + 0.01, s - 0.01, -s + 0.01, s - 0.01, 0.07), z1 - 0.01,
                       z1 + 0.02, t['plate'], bevel=0.01, seg=1))
    zr = z1 + 0.02
    # two long bays with sliding hatches (along X), port and starboard
    for k, (y0, y1) in enumerate(((0.12, 0.70), (-0.70, -0.12))):
        pcs += _hatch(f'Hatch{k}', -0.70, 0.70, y0, y1, zr, t, lvl)
    # central spine with crane rail
    pcs.append(G.box('Spine', -0.80, 0.80, -0.065, 0.065, zr - 0.01, zr + 0.05, t['core'], bevel=0.012, seg=1))
    pcs.append(G.box('Rail', -0.76, 0.76, -0.018, 0.018, zr + 0.045, zr + 0.065, 'metal_bare', bevel=0.004, seg=1))
    # gantry crane bridging both bays: legs on the side walls, beam across Y,
    # hoist trolley in the middle
    gx = -0.36
    gz = zr + 0.20
    for sgn in (1, -1):
        pcs.append(G.box(f'GantryLeg{sgn}', gx - 0.05, gx + 0.05, sgn * 0.80 - 0.05, sgn * 0.80 + 0.05,
                         zr - 0.01, gz + 0.02, t['core'], bevel=0.012, seg=1))
        pcs.append(G.box(f'GantryFoot{sgn}', gx - 0.075, gx + 0.075, sgn * 0.80 - 0.065, sgn * 0.80 + 0.065,
                         zr - 0.01, zr + 0.04, 'hull_dark', bevel=0.008, seg=1))
    pcs.append(G.box('GantryBeam', gx - 0.055, gx + 0.055, -0.86, 0.86, gz - 0.03, gz + 0.05, t['accent'],
                     bevel=0.012, seg=1))
    for k, y in enumerate((-0.6, -0.3, 0.3, 0.6)):   # beam stencil stripes
        pcs.append(G.box(f'BeamStripe{k}', gx - 0.057, gx + 0.057, y - 0.025, y + 0.025, gz + 0.045,
                         gz + 0.053, 'trim_black'))
    if lvl >= 3:  # T3: crystal seals on the gantry beam
        for s in (1, -1):
            pcs.append(C.gem_bar(f'BeamGem{s}', (gx, 0.18 * s, gz + 0.05), (gx, 0.72 * s, gz + 0.05), 0.05, 0.04))
    pcs.append(G.box('Trolley', gx - 0.09, gx + 0.09, -0.11, 0.11, gz - 0.08, gz + 0.085, t['plate'],
                     bevel=0.015, seg=1))
    pcs.append(G.box('TrolleyTop', gx - 0.06, gx + 0.06, -0.07, 0.07, gz + 0.08, gz + 0.1, t['core'],
                     bevel=0.008, seg=1))
    pcs.append(G.cyl('Hook', 0.02, 0.10, 'metal_bare', loc=(gx, 0, gz - 0.12), verts=8))
    pcs.append(G.box('TrolleyLight', gx + 0.07, gx + 0.095, -0.03, 0.03, gz + 0.03, gz + 0.065, 'light_amber'))
    # status lights on the front corners + rear
    for k, (x, y) in enumerate(((0.80, 0.80), (0.80, -0.80))):
        pcs.append(G.box(f'Light{k}', x - 0.03, x + 0.03, y - 0.03, y + 0.03, z1 + 0.035, z1 + 0.06,
                         'light_amber', bevel=0.008, seg=1))
    # deck bolts on the perimeter
    px, py = C.plate_half(*CELLS)
    e = px - 0.048
    pcs += C.bolts('Bolt', [(sx * e, sy * 0.45) for sx in (1, -1) for sy in (1, -1)], top + 0.005, r=0.022)
    pcs += C.corner_brackets(t, top, hx=px, hy=py, arm=0.16)
    root = G.join(pcs, f'LargeCargo_{tier.capitalize()}')
    G.finalize(root, atlas_dir)
    return root
