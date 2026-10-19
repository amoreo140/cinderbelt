"""Shared ship-part building blocks so every part tiles into one hull.

Grid conventions (see build_all.py docstring):
  1 BU = 1 cell, cell footprint x,y in [-0.5, 0.5].  Parts use HALF = 0.485
  (0.015 margin -> a thin 0.03 seam between neighbours that the hull
  connectors fill, see parts/connectors.py).
  +X = bow, +Y = port, +Z = up, z = 0 is the gameplay plane.

Unified deck: every part's outer deck plate tops out at DECK_TOP so seams,
edge connectors and corner caps line up across the whole ship.

Multi-cell parts (w x h cells, w along X = forward): the model is centred on
the centre of its footprint at rotation 0, so a 2x1 spans x in [-1, 1],
y in [-0.5, 0.5] and a 2x2 spans x, y in [-1, 1].  They use the same deck
profile; the 0.015 margin exists only on the OUTER perimeter (one continuous
core block + deck plate, no internal seams).  Use footprint()/plate_half().
"""
from lib import geo as G

HALF = 0.485

# Deck profile shared by all 1x1 parts
CORE_Z0, CORE_Z1 = -0.20, 0.10     # dark structural block
PLATE_Z0, PLATE_Z1 = 0.06, 0.20    # light hull plate on top
DECK_TOP = PLATE_Z1
PLATE_HALF = 0.478
PLATE_CHAMFER = 0.03
SKIRT_Z0, SKIRT_Z1 = -0.115, -0.055
SKIRT_OUT = 0.006                   # skirt protrudes this much past HALF
MARGIN = 0.5 - HALF                 # 0.015 outer margin of every footprint
PLATE_MARGIN = 0.5 - PLATE_HALF     # 0.022


def footprint(w=1, h=1):
    """Half extents (hx, hy) of the core block of a w x h part (w along X)."""
    return w / 2 - MARGIN, h / 2 - MARGIN


def plate_half(w=1, h=1):
    """Half extents of the deck plate of a w x h part."""
    return w / 2 - PLATE_MARGIN, h / 2 - PLATE_MARGIN


def core_block(name='Core', x0=-HALF, x1=HALF, y0=-HALF, y1=HALF, skirt='hull_mid', tier=None):
    """Dark structural block with a skirt stripe on the sides.  Parts pass
    their tier so the ship perimeter gets one continuous belt line (tier
    accent) and, from tier level 2, a glowing tier line above it.
    Small bevels keep the sides flat where neighbours touch."""
    core = tier['core'] if tier else 'hull_dark'
    if tier:
        skirt = tier['accent']
    parts = [G.box(name, x0, x1, y0, y1, CORE_Z0, CORE_Z1, core, bevel=0.01, seg=1)]
    o = SKIRT_OUT
    parts.append(G.box(name + '_Skirt', x0 - o, x1 + o, y0 - o, y1 + o,
                       SKIRT_Z0, SKIRT_Z1, skirt, bevel=0.006, seg=1))
    if tier and tier.get('glow'):
        g = 0.004
        parts.append(G.box(name + '_TierGlow', x0 - g, x1 + g, y0 - g, y1 + g,
                           GLOW_Z0, GLOW_Z1, tier['glow']))
    if tier and level(tier) >= 3:   # T3: crystal inlay ring around the top of the deck plate
        o, w = 0.024, 0.022
        outer = G.chamfer_rect(x0 + o, x1 - o, y0 + o, y1 - o, PLATE_CHAMFER)
        inner = G.chamfer_rect(x0 + o + w, x1 - o - w, y0 + o + w, y1 - o - w, PLATE_CHAMFER * 0.6)
        parts.append(frame_ring(name + '_Inlay', outer, inner, DECK_TOP - 0.004, DECK_TOP + 0.007, tier['glow']))
    return parts


def frame_ring(name, outer, inner, z0, z1, mat):
    """Closed flat frame between two CCW outlines with equal point counts."""
    import bmesh
    bm = bmesh.new()
    n = len(outer)
    ob_ = [bm.verts.new((x, y, z0)) for x, y in outer]
    ot_ = [bm.verts.new((x, y, z1)) for x, y in outer]
    ib_ = [bm.verts.new((x, y, z0)) for x, y in inner]
    it_ = [bm.verts.new((x, y, z1)) for x, y in inner]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((ot_[i], ot_[j], it_[j], it_[i]))       # top
        bm.faces.new((ob_[i], ob_[j], ot_[j], ot_[i]))       # outer wall
        bm.faces.new((it_[i], it_[j], ib_[j], ib_[i]))       # inner wall
        bm.faces.new((ib_[i], ib_[j], ob_[j], ob_[i]))       # bottom
    return G.obj_from_bm(name, bm, [mat])


GLOW_Z0, GLOW_Z1 = 0.0, 0.018      # tier glow line on the core sides (level >= 2)


def level(tier):
    return tier.get('level', 1)


def deck_plate(name='Plate', x0=-PLATE_HALF, x1=PLATE_HALF, y0=-PLATE_HALF, y1=PLATE_HALF,
               chamfer=PLATE_CHAMFER, z0=PLATE_Z0, z1=PLATE_Z1, mat='hull_light'):
    return G.prism(name, G.chamfer_rect(x0, x1, y0, y1, chamfer), z0, z1, mat, bevel=0.012, seg=2)


def corner_brackets(tier, z, inset=0.035, arm=0.13, w=0.026, corners=(0, 1, 2, 3),
                    hx=PLATE_HALF, hy=PLATE_HALF):
    """Level >= 2: L-shaped accent brackets on the plate corners (upgrade cue).
    hx, hy: plate half extents (multi-cell parts pass plate_half(w, h))."""
    if level(tier) < 2:
        return []
    if level(tier) >= 3:
        return crystal_corners(tier, z + 0.006, hx=hx, hy=hy, corners=corners)
    out = []
    ex, ey = hx - inset, hy - inset
    signs = ((1, 1), (-1, 1), (-1, -1), (1, -1))
    for i in corners:
        sx, sy = signs[i]
        out.append(G.box(f'BracketA{i}', min(sx * ex, sx * (ex - arm)), max(sx * ex, sx * (ex - arm)),
                         min(sy * ey, sy * (ey - w)), max(sy * ey, sy * (ey - w)), z - 0.006, z + 0.012,
                         tier['accent'], bevel=0.004, seg=1))
        out.append(G.box(f'BracketB{i}', min(sx * ex, sx * (ex - w)), max(sx * ex, sx * (ex - w)),
                         min(sy * ey, sy * (ey - arm)), max(sy * ey, sy * (ey - arm)), z - 0.006, z + 0.012,
                         tier['accent'], bevel=0.004, seg=1))
    return out


def hull_base(tier, w=1, h=1):
    """Core block + skirt (+ tier glow) + deck plate for a w x h part, one
    continuous piece (no internal seams).  Returns a list of objects."""
    t = tier
    hx, hy = footprint(w, h)
    px, py = plate_half(w, h)
    pcs = core_block(x0=-hx, x1=hx, y0=-hy, y1=hy, tier=t)
    pcs.append(deck_plate('Plate', x0=-px, x1=px, y0=-py, y1=py, mat=t['plate']))
    return pcs


def bolts(name, positions, z, r=0.026, mat='trim_black'):
    out = []
    for i, (x, y) in enumerate(positions):
        out.append(G.cyl(f'{name}{i}', r, 0.03, mat, loc=(x, y, z), verts=8, bevel=0.008, seg=1))
    return out


# ---------------------------------------------------------------------------
# T3 "crystal" tier (level 3) - premium crystal-tech cues
# ---------------------------------------------------------------------------
def gem(name, L, w, mat='cr_gem', sides=6, tip=0.38, flat=1.0, base=0.15):
    """Cut crystal prism along +Z from z = -base*L to z = L (pointed tip).
    Gradient swatch: dark violet root -> pale tip."""
    import math
    import bmesh
    bm = bmesh.new()
    rings = []
    for z, ww in ((-base * L, w * 0.82), ((1 - tip) * L, w)):
        rings.append([bm.verts.new((ww * math.cos(2 * math.pi * k / sides + 0.3),
                                    flat * ww * math.sin(2 * math.pi * k / sides + 0.3), z)) for k in range(sides)])
    tp = bm.verts.new((0, 0, L))
    bm.faces.new(list(reversed(rings[0])))
    for k in range(sides):
        j = (k + 1) % sides
        bm.faces.new((rings[0][k], rings[0][j], rings[1][j], rings[1][k]))
        bm.faces.new((rings[1][k], rings[1][j], tp))

    def grad(v):
        return max(0.0, min(1.0, (v.co.z + base * L) / ((1 + base) * L)))
    ob = G.obj_from_bm(name, bm, [mat], grad=grad)
    G.set_smooth(ob, False)
    return ob


def place(ob, loc, direction=(0, 0, 1), roll=0.0):
    """Orient an object's local +Z along `direction`, then move it to loc."""
    import math
    from mathutils import Matrix, Vector
    d = Vector(direction).normalized()
    q = Vector((0, 0, 1)).rotation_difference(d)
    ob.matrix_world = Matrix.Translation(loc) @ q.to_matrix().to_4x4() @ Matrix.Rotation(math.radians(roll), 4, 'Z')
    return ob


def gem_bar(name, p0, p1, w, h, mat='cr_gem'):
    """Elongated cut gem lying between p0 and p1 (pointed ends, faceted top).
    Gradient: base dark -> top ridge pale."""
    import bmesh
    from mathutils import Matrix, Vector
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    bm = bmesh.new()
    e = 0.22 * L
    ring = []
    for x in (e, L - e):
        ring.append([bm.verts.new((x, -w / 2, 0)), bm.verts.new((x, -w * 0.3, h)),
                     bm.verts.new((x, w * 0.3, h)), bm.verts.new((x, w / 2, 0))])
    a = bm.verts.new((0, 0, h * 0.35))
    b = bm.verts.new((L, 0, h * 0.35))
    A, B = ring
    for k in range(3):
        bm.faces.new((A[k], B[k], B[k + 1], A[k + 1]))
    bm.faces.new((A[3], B[3], B[0], A[0]))
    for k in range(3):
        bm.faces.new((a, A[k], A[k + 1]))
        bm.faces.new((b, B[k + 1], B[k]))
    bm.faces.new((a, A[3], A[0]))
    bm.faces.new((b, B[0], B[3]))

    def grad(v):
        return max(0.0, min(1.0, 0.15 + v.co.z / h * 0.85))
    ob = G.obj_from_bm(name, bm, [mat], grad=grad)
    G.set_smooth(ob, False)
    q = Vector((1, 0, 0)).rotation_difference(Vector((d.x, d.y, 0)).normalized() if d.z == 0 else d.normalized())
    ob.data.transform(Matrix.Translation(p0) @ q.to_matrix().to_4x4())
    return ob


def crystal_corners(tier, z, hx=PLATE_HALF, hy=PLATE_HALF, inset=0.085, L=0.2, corners=(0, 1, 2, 3)):
    """Level >= 3: a short 45 deg cut-gem bar across each plate corner on an
    accent mount (mirrors the UI T3 'facet' brackets)."""
    out = []
    signs = ((1, 1), (-1, 1), (-1, -1), (1, -1))
    import math
    for i in corners:
        sx, sy = signs[i]
        cx, cy = sx * (hx - inset), sy * (hy - inset)
        # bar perpendicular to the diagonal
        tx, ty = -sy / math.sqrt(2), sx / math.sqrt(2)
        p0 = (cx - tx * L / 2, cy - ty * L / 2, z)
        p1 = (cx + tx * L / 2, cy + ty * L / 2, z)
        mount = gem_bar(f'GemMount{i}', (p0[0], p0[1], z - 0.008), (p1[0], p1[1], z - 0.008), 0.075, 0.024,
                        mat=tier['accent'])
        out.append(mount)
        out.append(gem_bar(f'GemBar{i}', p0, p1, 0.052, 0.05, mat=tier.get('gem', 'cr_gem')))
    return out
