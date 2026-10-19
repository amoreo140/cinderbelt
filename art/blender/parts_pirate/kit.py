"""Shared kit for the pirate clan part sets.

Contract with the player's parts (the game swaps the model, never the gameplay):
  * same 1x1 footprint: core block + skirt from parts/common.core_block() (x, y in
    [-0.485, 0.485], skirt z -0.115..-0.055) and a deck surface at DECK_TOP near every edge
    and corner, so hull_connector_edge / _corner sit exactly as on the player's parts;
  * engines: core block only from x = -0.12, nozzle in the rear half, axis z = AXIS_Z,
    exit at x = -0.465 (the game puts the flame at 0.47 behind the cell centre);
  * the same node names, pivots and empties (imported from the player modules below, so
    they can never drift): Cannon_Turret/Cannon_Muzzle, Tractor_Head/Tractor_Emitter,
    Gyro_Ring_Outer/Gyro_Ring_Inner, Shield_Emitter.
Clan swatches never use a key the 'pirate' livery overrides, so applying that livery to a
clan part changes nothing (the derelict livery remaps everything).
"""
import math
import random

import bmesh
from mathutils import Matrix, Vector

from lib import geo as G
from parts import common as C
from parts import cannon as _cannon
from parts import engine as _engine
from parts import gyroscope as _gyro
from parts import shield_generator as _shield
from parts import tractor_beam as _tractor

TOP = C.DECK_TOP
HALF = C.HALF
PH = C.PLATE_HALF

# sockets / pivots - identical to the player parts
CANNON_HEAD_Z = _cannon.HEAD_Z
CANNON_BARREL_Z = _cannon.BARREL_Z
CANNON_MUZZLE_X = _cannon.MUZZLE_X
TRACTOR_HEAD_Z = _tractor.HEAD_Z
TRACTOR_AXIS_Z = _tractor.AXIS_Z
TRACTOR_EMITTER_X = _tractor.EMITTER_X
GYRO_RING_Z = _gyro.RING_Z
SHIELD_EMITTER_Z = _shield.EMITTER_Z
ENGINE_AXIS_Z = _engine.AXIS_Z
ENGINE_CORE_X0 = -0.12          # engine core block starts here (open rear half)
ENGINE_BELL_X = -0.25           # bell base (player: loc x of the lathe)
ENGINE_EXIT_X = -0.465          # nozzle exit plane (bell base - 0.215)

TIER_LEVEL = {'iron': 1, 'titanium': 2}

# per clan: hull swatches + the role colours every part draws from
CLANS = {
    'rust': dict(label='HRDZA', core='pir_gunmetal_dark', skirt='pir_rust', glow='pir_glow_red',
                 plate='pir_gunmetal', light='pir_glow_red', glass='pir_glass_red', trim='pir_weld'),
    'cauldron': dict(label='KOTOL', core='kot_iron_dark', skirt='kot_paint', glow='kot_furnace',
                     plate='kot_iron', light='light_amber', glass='kot_glass', trim='kot_iron_dark'),
    'slantedStar': dict(label='SIKMA HVIEZDA', core='sst_lacquer', skirt='sst_gold_dark', glow='sst_glow',
                        plate='sst_lacquer', light='sst_glow', glass='sst_glass', trim='sst_gold'),
}


def clan_tier(clan, tier):
    """Tier dict in the shape parts/common.core_block() expects (+ clan role keys)."""
    c = CLANS[clan]
    lvl = TIER_LEVEL[tier]
    return dict(c, core=c['core'], accent=c['skirt'], glow=c['glow'] if lvl >= 2 else None, level=lvl,
                tier=tier, clan=clan, role_glow=c['glow'])


def rng_for(clan, part, tier):
    """Deterministic per-file RNG (scrap layouts differ per part but never between builds)."""
    return random.Random(f'{clan}/{part}/{tier}')


# ---------------------------------------------------------------------------
# hull
# ---------------------------------------------------------------------------
def hull(ct, x0=-HALF, plate=None, deck=True):
    """Core block + skirt (+ T2 clan glow line) + a deck plate at DECK_TOP."""
    pcs = C.core_block(x0=x0, tier=ct)
    if deck:
        px0 = -PH if x0 <= -HALF + 1e-6 else x0 + 0.005
        pcs.append(C.deck_plate('Plate', x0=px0, mat=plate or ct['plate']))
    return pcs


# ---------------------------------------------------------------------------
# primitives
# ---------------------------------------------------------------------------
def _ccw(pts):
    a = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
            for i in range(len(pts)))
    return pts if a > 0 else list(reversed(pts))


def poly(name, pts, z0, z1, mat, bevel=0.0, seg=1, top_mat=None):
    """Extruded 2D outline (any winding)."""
    return G.prism(name, _ccw(list(pts)), z0, z1, mat, bevel=bevel, seg=seg, top_mat=top_mat)


def rot2(pts, ang_deg, cx=0.0, cy=0.0):
    a = math.radians(ang_deg)
    ca, sa = math.cos(a), math.sin(a)
    return [(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in pts]


def scrap_plate(name, cx, cy, w, h, ang, z0, z1, mat, rng, jit=0.025, bevel=0.006):
    """Mismatched welded plate: a jittered rectangle, rotated by `ang` deg."""
    pts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    pts = [(x + rng.uniform(-jit, jit), y + rng.uniform(-jit, jit)) for x, y in pts]
    # one clipped corner on most plates
    if rng.random() < 0.7:
        k = rng.randrange(4)
        x, y = pts[k]
        px, py = pts[(k - 1) % 4]
        nx, ny = pts[(k + 1) % 4]
        c = rng.uniform(0.25, 0.4)
        pts = pts[:k] + [(x + (px - x) * c, y + (py - y) * c), (x + (nx - x) * c, y + (ny - y) * c)] + pts[k + 1:]
    return poly(name, rot2(pts, ang, cx, cy), z0, z1, mat, bevel=bevel)


def convex(name, pts, mat, bevel=0.0, seg=1):
    """Convex hull of 3D points (angular armour shapes), flat shaded."""
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    res = bmesh.ops.convex_hull(bm, input=vs)
    drop = {g for g in res['geom_interior'] + res['geom_unused'] if isinstance(g, bmesh.types.BMVert)}
    if drop:
        bmesh.ops.delete(bm, geom=list(drop), context='VERTS')
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), verts=bm.verts[:], edges=bm.edges[:])
    ob = G.obj_from_bm(name, bm, [mat])
    G.set_smooth(ob, False)
    if bevel:
        G.add_bevel(ob, bevel, seg)
    return ob


def frustum(name, x0, x1, y0, y1, z0, top_x0, top_x1, top_y0, top_y1, z1, mat, bevel=0.0, seg=1):
    """Box whose top rectangle differs from the bottom (wedges, cabs, hoppers)."""
    pts = [(x, y, z0) for x in (x0, x1) for y in (y0, y1)] + \
          [(x, y, z1) for x in (top_x0, top_x1) for y in (top_y0, top_y1)]
    return convex(name, pts, mat, bevel, seg)


def spike(name, base, direction, L, r, mat, sides=4, roll=45.0):
    """Pyramid spike / tooth: base centre `base`, pointing along `direction`."""
    bm = bmesh.new()
    ring = [bm.verts.new((r * math.cos(2 * math.pi * k / sides), r * math.sin(2 * math.pi * k / sides), 0))
            for k in range(sides)]
    tip = bm.verts.new((0, 0, L))
    bm.faces.new(list(reversed(ring)))
    for k in range(sides):
        bm.faces.new((ring[k], ring[(k + 1) % sides], tip))
    ob = G.obj_from_bm(name, bm, [mat])
    G.set_smooth(ob, False)
    C.place(ob, base, direction, roll)
    return ob


def bar(name, p0, p1, hw, mat, hh=None, bevel=0.0):
    """Rectangular bar from p0 to p1 (half width hw, half height hh)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    hh = hw if hh is None else hh
    ob = G.box(name, 0.0, d.length, -hw, hw, -hh, hh, mat, bevel=bevel, seg=1)
    G.apply_modifiers(ob)
    q = Vector((1, 0, 0)).rotation_difference(d.normalized())
    ob.data.transform(Matrix.Translation(p0) @ q.to_matrix().to_4x4())
    return ob


def fin(name, profile, thick, loc, yaw, mat, tilt=0.0, bevel=0.0):
    """Standing fin: `profile` = [(x, z), ...] outline in the fin plane, thickness along
    local Y; stood up, tilted `tilt` deg about its long (X) axis, then yawed about Z."""
    f = poly(name, profile, -thick / 2, thick / 2, mat, bevel=bevel)
    G.transform(f, loc=loc, rot=(90 + tilt, 0, yaw))
    return f


def lamp(name, loc, mat, r=0.028, h=0.03, verts=8):
    return G.cyl(name, r, h, mat, loc=loc, verts=verts)


def rivets(name, pts, z, mat, r=0.014, h=0.022, verts=6):
    return [G.cyl(f'{name}{i}', r, h, mat, loc=(x, y, z), verts=verts) for i, (x, y) in enumerate(pts)]


def hazard(name, x0, x1, y0, y1, z0, z1, n, mats, along='y', slant=0.4):
    """Diagonal hazard stripes: the band [x0,x1]x[y0,y1] cut into n slanted stripes
    alternating `mats`. `along` = the band's long axis."""
    out = []
    if along == 'y':
        L, s0, s1, w0, w1 = y1 - y0, y0, y1, x0, x1
    else:
        L, s0, s1, w0, w1 = x1 - x0, x0, x1, y0, y1
    step = L / n
    sh = slant * (w1 - w0)
    k = 0
    a = s0 - sh
    while a < s1 - 1e-6:
        b = a + step

        def cl(v):
            return min(s1, max(s0, v))
        q = [(cl(a), w0), (cl(b), w0), (cl(b + sh), w1), (cl(a + sh), w1)]
        if (q[1][0] - q[0][0]) + (q[2][0] - q[3][0]) > 0.004:
            # drop duplicate corners (clipped ends become triangles)
            qq = []
            for p in q:
                if not qq or abs(p[0] - qq[-1][0]) + abs(p[1] - qq[-1][1]) > 1e-6:
                    qq.append(p)
            if abs(qq[0][0] - qq[-1][0]) + abs(qq[0][1] - qq[-1][1]) < 1e-6:
                qq.pop()
            if len(qq) >= 3:
                if along == 'y':
                    qq = [(w, s) for s, w in qq]
                out.append(poly(f'{name}{k}', qq, z0, z1, mats[k % len(mats)]))
        k += 1
        a = b
    return out


def stack(name, x, y, z0, z1, r, body='kot_iron_dark', band='kot_copper', glow='kot_furnace', verts=10):
    """Smokestack: dark pipe, copper bands, sooty lip, glowing throat (reads as a lit
    furnace stack from above)."""
    out = [G.cyl(name, r, z1 - z0, body, loc=(x, y, (z0 + z1) / 2), verts=verts)]
    for i, z in enumerate((z0 + 0.35 * (z1 - z0), z1 - 0.05)):
        out.append(G.ring_band(f'{name}Band{i}', r + 0.012, r - 0.004, z - 0.012, z + 0.012, band,
                               loc=(x, y, 0), verts=verts))
    out.append(G.ring_band(f'{name}Lip', r + 0.016, r - 0.014, z1 - 0.004, z1 + 0.02, 'char_black',
                           loc=(x, y, 0), verts=verts))
    out.append(G.cyl(f'{name}Throat', r - 0.012, 0.01, glow, loc=(x, y, z1 - 0.012), verts=verts))
    return out


def star4(name, r_out, r_in, z0, z1, mat, shear=0.35, rot=0.0, loc=(0, 0, 0)):
    """Four-pointed star, sheared along X (the Slanted Star emblem), extruded."""
    pts = []
    for k in range(8):
        a = math.radians(rot + 45 * k)
        rr = r_out if k % 2 == 0 else r_in
        x, y = rr * math.cos(a), rr * math.sin(a)
        pts.append((x + shear * y, y))
    pts = [(x + loc[0], y + loc[1]) for x, y in pts]
    return poly(name, pts, z0 + loc[2], z1 + loc[2], mat)


def capsule(name, L, R, mats, loc, axis_rot=0.0, verts=16, n=4):
    """Capsule along X (|x| <= L + R), body mats[0], caps mats[1]; yawed by axis_rot."""
    prof = []
    for i in range(n + 1):
        a = math.pi / 2 * i / n
        prof.append((-L - R * math.cos(a), R * math.sin(a)))
    prof.append((L, R))
    for i in range(1, n + 1):
        a = math.pi / 2 * i / n
        prof.append((L + R * math.sin(a), R * math.cos(a)))
    segs = [1] * n + [0] + [1] * n
    ob = G.lathe(name, prof, segs, list(mats), loc=(0, 0, 0), axis='X', verts=verts, closed=False)
    ob.data.transform(Matrix.Translation(loc) @ Matrix.Rotation(math.radians(axis_rot), 4, 'Z'))
    return ob


def finish(pcs, name, atlas_dir):
    root = G.join(pcs, name)
    G.finalize(root, atlas_dir)
    return root


def child(pcs, name, atlas_dir, parent, loc):
    node = G.join(pcs, name)
    G.finalize(node, atlas_dir)
    node.location = loc
    node.parent = parent
    return node


# ---------------------------------------------------------------------------
# clan hull connectors: the player's connector builders with a material remap, so the geometry is
# bit-identical (parts/connectors.py) and only the swatches change
# ---------------------------------------------------------------------------
CONNECTOR_REMAP = {
    'rust': {'hull_dark': 'pir_gunmetal_dark', 'trim_black': 'pir_rust_dark', 'hull_mid': 'pir_gunmetal',
             'panel_line': 'pir_weld', 'metal_bare': 'metal_bare'},
    'cauldron': {'hull_dark': 'kot_iron_dark', 'trim_black': 'kot_paint', 'hull_mid': 'kot_iron',
                 'panel_line': 'char_black', 'metal_bare': 'kot_copper'},
    'slantedStar': {'hull_dark': 'sst_lacquer', 'trim_black': 'sst_gold_dark', 'hull_mid': 'sst_graphite',
                    'panel_line': 'sst_gold', 'metal_bare': 'sst_gold'},
}


def build_connector(clan, kind, atlas_dir):
    from lib import materials as M
    from parts import connectors as CN
    remap = CONNECTOR_REMAP[clan]
    original = M.mat
    M.mat = lambda key: original(remap.get(key, key))
    try:
        # trim_black is also the bolts' default swatch: the strap bolts take the skirt colour
        root = (CN.build_edge if kind == 'edge' else CN.build_corner)('iron', atlas_dir)
    finally:
        M.mat = original
    root.name = f'Hull_Connector_{kind.capitalize()}_{clan[0].upper() + clan[1:]}'
    return root
