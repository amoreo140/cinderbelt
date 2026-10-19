"""Ship building 2.0 (design doc) - E0 mock-up geometry.

Pure mock-up code (nothing here is exported to public/assets):
  * shape polygons (spec 2.2) and part polygons in grid coordinates,
  * the hull-shell outline by edge cancellation on the half grid (spec 3.2),
  * shell geometry: side band, trim lip, armour bevels, corner guards, seam strips,
    panel grooves, filled notches, nav lights, torn edges (spec 3.3-3.8),
  * shaped armour parts built from any polygon (a stand-in for hull_base_poly, spec 6.6),
  * superstructure top modules: the part head on a round pedestal (spec 4.10).

Coordinates: Blender world, 1 unit = 1 cell, +X = bow, +Y = port, cell (x, y) centred at (x, y).
"""
import math
import os

import bmesh
import bpy
from mathutils import Vector

from lib import geo as G
from lib import materials as M
from lib import palette as P
from parts import common as C

import paths

# ---------------------------------------------------------------------------
# shell profile (spec 3.2 / 9.1) - every value here is a knob the report talks about
# ---------------------------------------------------------------------------
BAND_OUT = 0.012          # band face this far outside the cell edge
BAND_IN = -0.03           # band inner face (hidden inside the parts)
STRIPE_OUT = 0.018
LIP_W = 0.07              # trim lip width (inward)
LIP_Z0, LIP_Z1 = 0.20, 0.235
BEVEL = 0.25              # shaved armour corner (legs)
GUARD_ARM, GUARD_T = 0.30, 0.06
GUARD_Z0, GUARD_Z1 = -0.15, 0.25
SEAM_W, SEAM_Z0, SEAM_Z1 = 0.05, 0.17, 0.206
GROOVE_IN, GROOVE_W = 0.16, 0.022
LIGHT_R = 0.07            # spec says 0.045 - see report
TOP_R, TOP_H = 0.36, 0.25  # superstructure pedestal

ENGINE = 'engine'
WEAPONS = {'cannon', 'mining_laser', 'tractor_beam', 'heavy_laser'}
FLAT = {'armor', 'cargo', 'large_cargo', 'battery'}
CELLS = {'large_cargo': (2, 2), 'heavy_laser': (2, 1), 'refinery': (2, 1), 'large_reactor': (2, 2),
         'cruise_drive': (2, 1)}

# owner styles: player tiers and the two pirate clans used by composition 5
CLAN_DIR = os.path.join(paths.MODELS, 'parts_pirate')


def style(owner, tier):
    """Swatch roles for the shell / shaped parts of one ship."""
    if owner == 'player':
        t = P.TIERS[tier]
        return dict(core=t['core'], plate=t['plate'], accent=t['accent'], accent_dark=t['accent_dark'],
                    glow=t['glow'], pad='hull_white', seam=t['core'], lip=t['accent'], lvl=t['level'],
                    red='light_red', green='light_green', white='light_white', amber='light_amber',
                    gem=t.get('gem'), clan=None)
    if owner == 'slantedStar':
        return dict(core='sst_lacquer', plate='sst_lacquer', accent='sst_gold_dark', accent_dark='sst_gold_dark',
                    glow='sst_glow' if tier != 'iron' else None, pad='sst_graphite', seam='sst_gold',
                    lip='sst_lacquer', lvl=2 if tier != 'iron' else 1, red='sst_glow', green='sst_glow',
                    white='sst_glow', amber='sst_glow', gem=None, clan='slantedStar')
    if owner == 'rust':
        return dict(core='pir_gunmetal_dark', plate='pir_gunmetal', accent='pir_rust', accent_dark='pir_rust_dark',
                    glow='pir_glow_red' if tier != 'iron' else None, pad='pir_plate_worn', seam='pir_weld',
                    lip='pir_rust_patch', lvl=2 if tier != 'iron' else 1, red='pir_glow_red', green='pir_glow_red',
                    white='pir_glow_red', amber='pir_glow_red', gem=None, clan='rust')
    raise ValueError(owner)


def part_file(owner, module, tier):
    if owner != 'player':
        p = os.path.join(CLAN_DIR, owner, f'{module}_{tier}.glb')
        if os.path.exists(p):
            return p
    return os.path.join(paths.PARTS, f'{module}_{tier}.glb')


def connector_file(owner, kind):
    if owner != 'player':
        p = os.path.join(CLAN_DIR, owner, f'hull_connector_{kind}.glb')
        if os.path.exists(p):
            return p
    return os.path.join(paths.PARTS, f'hull_connector_{kind}.glb')


# ---------------------------------------------------------------------------
# shapes (spec 2.2): local polygons at rot 0, centred on the footprint, CCW
# ---------------------------------------------------------------------------
def _arc(cx, cy, r, a0, a1, n):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * k / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(1, n)]


def _ogive(L, R, n=10):
    """Parabolic ogive y = R (1 - (x/L)^2), x in 0..L (tip at (L, 0)); returns lower + upper side."""
    low = [(L * k / n, -R * (1 - (k / n) ** 2)) for k in range(1, n)]
    up = [(x, -y) for x, y in reversed(low)]
    return low + [(L, 0.0)] + up


SHAPES = {
    'wedge': ((1, 1), [(-.5, -.5), (.5, -.5), (-.5, .5)]),
    'chamfer': ((1, 1), [(-.5, -.5), (.5, -.5), (.5, 0), (0, .5), (-.5, .5)]),
    'round': ((1, 1), [(-.5, -.5), (.5, -.5), (.5, 0)] + _arc(0, 0, .5, 0, 90, 8) + [(0, .5), (-.5, .5)]),
    'arc': ((1, 1), [(-.5, -.5), (.5, -.5)] + _arc(-.5, -.5, 1.0, 0, 90, 14) + [(-.5, .5)]),
    'half': ((1, 1), [(-.5, -.5), (.5, -.5), (.5, 0), (-.5, 0)]),
    'nose': ((1, 1), [(-.5, -.5), (.5, 0), (-.5, .5)]),
    'wedge2x1': ((2, 1), [(-1, -.5), (1, -.5), (-1, .5)]),
    # critic M6: the wing moves to E2 as two shapes without flip
    'wingL': ((2, 1), [(-1, -.5), (1, -.5), (-1, .5)]),
    'wingR': ((2, 1), [(-1, -.5), (1, .5), (-1, .5)]),
    'nose2x1': ((2, 1), [(-1, -.5), (0, -.5)] + _ogive(1.0, 0.5) + [(0, .5), (-1, .5)]),
    'nose2x2': ((2, 2), [(-1, -1), (0, -1)] + _ogive(1.0, 1.0) + [(0, 1), (-1, 1)]),
}


def rot_pt(p, r):
    x, y = p
    for _ in range(r % 4):
        x, y = -y, x
    return (x, y)


class Part:
    """One placed part. x, y = centre of the footprint (cell centre for 1x1)."""

    def __init__(self, module, x, y, rot=0, shape=None, flip=False, top=None, tier=None, owner=None):
        self.m, self.x, self.y, self.rot = module, float(x), float(y), rot
        self.shape, self.flip, self.top = shape, flip, top
        self.tier, self.owner = tier, owner

    def size(self):
        w, h = SHAPES[self.shape][0] if self.shape else CELLS.get(self.m, (1, 1))
        return (h, w) if self.rot % 2 else (w, h)

    def cells(self):
        w, h = self.size()
        return [(round(self.x - (w - 1) / 2 + i), round(self.y - (h - 1) / 2 + j)) for i in range(w) for j in range(h)]

    def poly(self):
        if self.shape:
            pts = list(SHAPES[self.shape][1])
        else:
            w, h = CELLS.get(self.m, (1, 1))
            pts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
        if self.flip:
            pts = [(x, -y) for x, y in reversed(pts)]
        return [(self.x + q[0], self.y + q[1]) for q in (rot_pt(p, self.rot) for p in pts)]

    def dir(self, local):
        return rot_pt(local, self.rot)

    @property
    def functional(self):
        return self.m not in ('armor', 'frame', 'fill')


def P_(module, x, y, rot=0, **kw):
    return Part(module, x, y, rot, **kw)


# ---------------------------------------------------------------------------
# polygon helpers
# ---------------------------------------------------------------------------
def area(pts):
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
                     for i in range(len(pts)))


def _norm(v):
    L = math.hypot(*v)
    return (v[0] / L, v[1] / L) if L > 1e-12 else (0.0, 0.0)


def offset_point(prev, p, nxt, d, closed=True):
    """Miter offset of vertex p; d > 0 = to the RIGHT of the travel direction (outward of a CCW loop)."""
    d1 = _norm((p[0] - prev[0], p[1] - prev[1]))
    d2 = _norm((nxt[0] - p[0], nxt[1] - p[1]))
    n1, n2 = (d1[1], -d1[0]), (d2[1], -d2[0])
    k = 1 + n1[0] * n2[0] + n1[1] * n2[1]
    if k < 0.25:
        k = 0.25
    return (p[0] + d * (n1[0] + n2[0]) / k, p[1] + d * (n1[1] + n2[1]) / k)


def inset(pts, d):
    """Inset a CCW polygon by d (> 0 shrinks)."""
    n = len(pts)
    return [offset_point(pts[i - 1], pts[i], pts[(i + 1) % n], -d) for i in range(n)]


def point_in_poly(pt, pts):
    x, y = pt
    inside = False
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if xi > x:
                inside = not inside
    return inside


# ---------------------------------------------------------------------------
# mesh accumulator: many closed shells -> one object per call to build()
# ---------------------------------------------------------------------------
class Acc:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def _mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def prism(self, pts, z0, z1, mat, top_mat=None):
        if len(pts) < 3:
            return
        if area(pts) < 0:
            pts = list(reversed(pts))
        if abs(area(pts)) < 1e-6:
            return
        bm = self.bm
        vb = [bm.verts.new((x, y, z0)) for x, y in pts]
        vt = [bm.verts.new((x, y, z1)) for x, y in pts]
        mi = self._mi(mat)
        f = bm.faces.new(list(reversed(vb)))
        f.material_index = mi
        f = bm.faces.new(vt)
        f.material_index = self._mi(top_mat) if top_mat else mi
        n = len(pts)
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((vb[i], vb[j], vt[j], vt[i]))
            f.material_index = mi

    def dome(self, c, r, z, mat, seg=10):
        bm = self.bm
        mi = self._mi(mat)
        rings = []
        for k in range(0, 4):
            a = math.radians(90 * k / 4)
            rr, zz = r * math.cos(a), z + r * math.sin(a) * 0.8
            rings.append([bm.verts.new((c[0] + rr * math.cos(2 * math.pi * s / seg),
                                        c[1] + rr * math.sin(2 * math.pi * s / seg), zz)) for s in range(seg)])
        top = bm.verts.new((c[0], c[1], z + r * 0.8))
        f = bm.faces.new(list(reversed(rings[0])))
        f.material_index = mi
        for a_, b_ in zip(rings[:-1], rings[1:]):
            for s in range(seg):
                t = (s + 1) % seg
                f = bm.faces.new((a_[s], a_[t], b_[t], b_[s]))
                f.material_index = mi
        for s in range(seg):
            f = bm.faces.new((rings[-1][s], rings[-1][(s + 1) % seg], top))
            f.material_index = mi

    def build(self, bevel=0.0, smooth=False):
        if not self.bm.faces:
            self.bm.free()
            return None
        ob = G.obj_from_bm(self.name, self.bm, self.mats)
        if bevel:
            G.add_bevel(ob, bevel, 1, angle=50)
        else:
            G.set_smooth(ob, smooth)
        return ob


def quad_strip(acc, a, b, n, d0, d1, z0, z1, mat, ext0=0.0, ext1=0.0):
    """Box along segment a->b, offsets d0..d1 along normal n (unit), extended along the segment."""
    t = _norm((b[0] - a[0], b[1] - a[1]))
    a2 = (a[0] - t[0] * ext0, a[1] - t[1] * ext0)
    b2 = (b[0] + t[0] * ext1, b[1] + t[1] * ext1)
    pts = [(a2[0] + n[0] * d0, a2[1] + n[1] * d0), (b2[0] + n[0] * d0, b2[1] + n[1] * d0),
           (b2[0] + n[0] * d1, b2[1] + n[1] * d1), (a2[0] + n[0] * d1, a2[1] + n[1] * d1)]
    acc.prism(pts, z0, z1, mat)


# ---------------------------------------------------------------------------
# outline by edge cancellation (spec 3.2)
# ---------------------------------------------------------------------------
def _hq(v):
    return (round(v[0] * 2), round(v[1] * 2))


def _on_half(v):
    return abs(v[0] * 2 - round(v[0] * 2)) < 1e-6 and abs(v[1] * 2 - round(v[1] * 2)) < 1e-6


class Edge:
    __slots__ = ('a', 'b', 'part', 'kind')

    def __init__(self, a, b, part, kind='raw'):
        self.a, self.b, self.part, self.kind = a, b, part, kind

    @property
    def d(self):
        return _norm((self.b[0] - self.a[0], self.b[1] - self.a[1]))

    @property
    def n(self):           # outward normal (solid is on the left of a->b)
        d = self.d
        return (d[1], -d[0])

    @property
    def mid(self):
        return ((self.a[0] + self.b[0]) / 2, (self.a[1] + self.b[1]) / 2)


def split_edges(parts):
    """All directed polygon edges, axis-aligned half-grid edges split into 1/2 pieces."""
    out = []
    for pi, p in enumerate(parts):
        pts = p.poly()
        n = len(pts)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            axis = abs(a[0] - b[0]) < 1e-9 or abs(a[1] - b[1]) < 1e-9
            if axis and _on_half(a) and _on_half(b):
                L = math.hypot(b[0] - a[0], b[1] - a[1])
                k = max(1, round(L * 2))
                for s in range(k):
                    p0 = (a[0] + (b[0] - a[0]) * s / k, a[1] + (b[1] - a[1]) * s / k)
                    p1 = (a[0] + (b[0] - a[0]) * (s + 1) / k, a[1] + (b[1] - a[1]) * (s + 1) / k)
                    out.append(Edge(p0, p1, pi))
            else:
                out.append(Edge(a, b, pi))
    return out


def _pk(v):
    """Point key: half-grid points as integer pairs, others (curves) rounded."""
    if _on_half(v):
        return _hq(v)
    return (round(v[0], 5), round(v[1], 5))


def _key(e):
    return (_pk(e.a), _pk(e.b))


def outline(parts):
    """Returns (loops, seams).  loops: list of [Edge] (CCW around solid), seams: [(Edge, other part)]."""
    edges = split_edges(parts)
    table = {}
    for e in edges:
        table[_key(e)] = e
    seams, keep = [], []
    for e in edges:
        k = _key(e)
        rk = (k[1], k[0])
        if rk in table:
            if id(e) < id(table[rk]):
                seams.append((e, table[rk].part))
        else:
            keep.append(e)
    start = {}
    for e in keep:
        start.setdefault(_key(e)[0], []).append(e)
    used, loops = set(), []
    for e in keep:
        if id(e) in used:
            continue
        loop, cur = [], e
        while cur is not None and id(cur) not in used:
            used.add(id(cur))
            loop.append(cur)
            nxt = [c for c in start.get(_key(cur)[1], []) if id(c) not in used]
            if len(nxt) > 1:      # pinch vertex: take the sharpest right turn
                d = cur.d
                nxt.sort(key=lambda c: d[0] * c.d[1] - d[1] * c.d[0])
            cur = nxt[0] if nxt else None
        loops.append(loop)
    return loops, seams


def classify(loops, parts, cell_owner, original_cells=None):
    """Set Edge.kind: raw | shaped | nozzle | muzzle | torn | fill."""
    for loop in loops:
        for e in loop:
            p = parts[e.part]
            n = e.n
            m = e.mid
            across = (round(m[0] + n[0] * 0.3), round(m[1] + n[1] * 0.3))
            if original_cells is not None and across in original_cells and across not in cell_owner:
                e.kind = 'torn'
                continue
            if p.m == 'fill':
                e.kind = 'fill'
                continue
            if p.shape:
                e.kind = 'shaped'
                continue
            if p.m == ENGINE:
                nd = p.dir((-1, 0))
                if abs(n[0] - nd[0]) < 1e-6 and abs(n[1] - nd[1]) < 1e-6:
                    e.kind = 'nozzle'
                    continue
                # rear half of the side edges: the bell sits there
                if (m[0] - p.x) * nd[0] + (m[1] - p.y) * nd[1] > 0.01:
                    e.kind = 'nozzle'
                    continue
            if p.m in WEAPONS:
                md = p.dir((1, 0))
                if abs(n[0] - md[0]) < 1e-6 and abs(n[1] - md[1]) < 1e-6:
                    e.kind = 'muzzle'
                    continue
            e.kind = 'raw'


# ---------------------------------------------------------------------------
# notch filling (spec 3.5)
# ---------------------------------------------------------------------------
def find_notches(parts, cell_owner, original_cells=None):
    edges = split_edges(parts)
    keys = {_key(e) for e in edges}
    cells = set(cell_owner)
    xs = [c[0] for c in cells]
    ys = [c[1] for c in cells]
    banned = set()
    for p in parts:
        if p.m == ENGINE:
            d = p.dir((-1, 0))
            banned.add((round(p.x + d[0]), round(p.y + d[1])))
        if p.m in WEAPONS:
            d = p.dir((1, 0))
            banned.add((round(p.x + d[0]), round(p.y + d[1])))
    sides = ((0, -1), (1, 0), (0, 1), (-1, 0))

    def solid_sides(x, y):
        sq = [(x - .5, y - .5), (x + .5, y - .5), (x + .5, y + .5), (x - .5, y + .5)]
        out = []
        for i in range(4):
            a, b = sq[i], sq[(i + 1) % 4]
            m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            out.append((_hq(m), _hq(a)) in keys and (_hq(b), _hq(m)) in keys)
        return out
    cand = {}
    for x in range(min(xs), max(xs) + 1):
        for y in range(min(ys), max(ys) + 1):
            if (x, y) in cells or (x, y) in banned:
                continue
            if original_cells is not None and (x, y) in original_cells:
                continue
            s = solid_sides(x, y)
            if sum(s) >= 2:
                cand[(x, y)] = s
    # mock rule (refines spec 3.5): a group of <= 2 empty cells whose only open sides form ONE
    # mouth (all open sides face the same way, at most one per cell) is a notch or a hole
    out, seen = [], set()
    for c in cand:
        if c in seen:
            continue
        grp, stack = [], [c]
        while stack:
            q = stack.pop()
            if q in seen:
                continue
            seen.add(q)
            grp.append(q)
            for d in sides:
                r = (q[0] + d[0], q[1] + d[1])
                if r in cand:
                    stack.append(r)
        if len(grp) > 2:
            continue
        g = set(grp)
        open_dirs = []
        for q in grp:
            for i, d in enumerate(sides):
                if not cand[q][i] and (q[0] + d[0], q[1] + d[1]) not in g:
                    open_dirs.append(d)
        if len(open_dirs) <= len(grp) and len(set(open_dirs)) <= 1:
            out += grp
    return out


# ---------------------------------------------------------------------------
# shell builder
# ---------------------------------------------------------------------------
class Shell:
    def __init__(self, parts, st, original_cells=None, fill=True, nav=True, grooves=True,
                 bevels=True, guards=True, lip_mode='accent', lip_w=LIP_W, fill_style='recessed'):
        self.st = st
        self.fill_style = fill_style
        self.lip_w = lip_w
        self.parts = list(parts)
        self.original = original_cells
        self.cell_owner = {}
        for i, p in enumerate(self.parts):
            for c in p.cells():
                self.cell_owner[c] = i
        self.fills = find_notches(self.parts, self.cell_owner, original_cells) if fill else []
        for c in self.fills:
            self.parts.append(Part('fill', c[0], c[1]))
            self.cell_owner[c] = len(self.parts) - 1
        self.loops, self.seams = outline(self.parts)
        classify(self.loops, self.parts, self.cell_owner, original_cells)
        self.bevel_cuts = {}          # part index -> list of corner points cut
        self.guards = []              # (v, d1, d2, part)
        self.nav, self.grooves, self.do_bevels, self.do_guards = nav, grooves, bevels, guards
        self.lip_mode = lip_mode
        self.points = []              # final loops: list of [(pt, kind_of_edge_from_pt)]
        self._corners()

    # convex / concave corners -> bevels and guards (spec 3.3)
    def _corners(self):
        for loop in self.loops:
            pts = []
            n = len(loop)
            for i, e in enumerate(loop):
                prev = loop[i - 1]
                cr = prev.d[0] * e.d[1] - prev.d[1] * e.d[0]
                v = e.a
                inside = (v[0] - prev.d[0] * 0.25 + e.d[0] * 0.25, v[1] - prev.d[1] * 0.25 + e.d[1] * 0.25)
                cell = (round(inside[0]), round(inside[1]))
                pi = self.cell_owner.get(cell)
                part = self.parts[pi] if pi is not None else None
                convex = cr > 1e-6
                axis = abs(cr) > 0.99
                if (convex and axis and part is not None and prev.kind == 'raw' and e.kind == 'raw'
                        and prev.part == pi and e.part == pi):
                    if part.m == 'armor' and not part.shape and self.do_bevels:
                        a = (v[0] - prev.d[0] * BEVEL, v[1] - prev.d[1] * BEVEL)
                        b = (v[0] + e.d[0] * BEVEL, v[1] + e.d[1] * BEVEL)
                        pts.append((a, 'raw'))
                        pts.append((b, e.kind))
                        self.bevel_cuts.setdefault(pi, []).append(v)
                        continue
                    if part.functional and self.do_guards:
                        self.guards.append((v, prev.d, e.d, pi))
                pts.append((v, e.kind))
            self.points.append(pts)
            del n

    # -- geometry ---------------------------------------------------------------
    def build(self, name='Shell'):
        st = self.st
        objs = []
        band = Acc(name + '_Band')
        lip = Acc(name + '_Lip')
        deco = Acc(name + '_Deco')
        lights = Acc(name + '_Lights')
        banded = {'raw', 'shaped', 'muzzle', 'fill'}
        lipped = {'raw', 'shaped', 'fill'}
        for pts in self.points:
            n = len(pts)
            P_ = [p for p, _ in pts]
            for i in range(n):
                a, kind = pts[i]
                b = pts[(i + 1) % n][0]
                if kind not in banded:
                    if kind == 'torn':
                        self._torn(deco, a, b)
                    continue
                pa, pb = P_[i - 1], P_[(i + 2) % n]
                layers = [(BAND_IN, BAND_OUT, -0.20, 0.10, st['core']),
                          (BAND_IN + 0.01, STRIPE_OUT, -0.115, -0.055, st['accent']),
                          (BAND_IN, BAND_OUT, 0.10, 0.20, st['plate'])]
                if st['glow']:
                    layers.append((BAND_IN + 0.01, BAND_OUT + 0.004, 0.0, 0.018, st['glow']))
                for d0, d1, z0, z1, mat in layers:
                    self._seg(band, pa, a, b, pb, d0, d1, z0, z1, mat)
                if kind in lipped:
                    self._seg(lip, pa, a, b, pb, -self.lip_w, BAND_OUT, LIP_Z0, LIP_Z1, st['lip'])
                    if st['clan'] == 'slantedStar':
                        self._slashes(deco, a, b)
                    elif st['clan'] == 'rust':
                        self._welds(deco, a, b)
                    elif self.lip_mode == 'accent+line':
                        self._seg(lip, pa, a, b, pb, -self.lip_w + 0.012, -self.lip_w + 0.03, LIP_Z1, LIP_Z1 + 0.006,
                                  st['core'])
        self._guards(deco)
        self._seams(deco, objs)
        if self.grooves:
            self._grooves(deco)
        self._fills(deco, lights)
        if self.nav:
            self._lights(lights)
        for acc, bev in ((band, 0.0), (lip, 0.006), (deco, 0.0), (lights, 0.0)):
            ob = acc.build(bevel=bev)
            if ob:
                objs.append(ob)
        return objs

    def _seg(self, acc, pa, a, b, pb, d0, d1, z0, z1, mat):
        """One band piece between a and b with miter ends shared with the neighbours pa / pb."""
        a0 = offset_point(pa, a, b, d0)
        a1 = offset_point(pa, a, b, d1)
        b0 = offset_point(a, b, pb, d0)
        b1 = offset_point(a, b, pb, d1)
        acc.prism([a0, b0, b1, a1], z0, z1, mat)

    def _slashes(self, acc, a, b):
        """Slanted Star: short raked gold bars across the lip on long straight runs."""
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.45:
            return
        t = _norm((b[0] - a[0], b[1] - a[1]))
        n = (t[1], -t[0])
        for s in (0.5,):
            c = (a[0] + t[0] * L * s, a[1] + t[1] * L * s)
            w, sk = 0.035, 0.05
            pts = []
            for (u, v) in ((-w - sk, BAND_OUT), (w - sk, BAND_OUT), (w + sk, -self.lip_w), (-w + sk, -self.lip_w)):
                pts.append((c[0] + t[0] * u + n[0] * v, c[1] + t[1] * u + n[1] * v))
            acc.prism(pts, LIP_Z1 - 0.004, LIP_Z1 + 0.008, 'sst_gold')

    def _welds(self, acc, a, b):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        t = _norm((b[0] - a[0], b[1] - a[1]))
        n = (t[1], -t[0])
        k = max(1, int(L / 0.11))
        for s in range(k):
            u = (s + 0.5) / k * L
            c = (a[0] + t[0] * u + n[0] * -0.035, a[1] + t[1] * u + n[1] * -0.035)
            r = 0.022
            acc.prism([(c[0] - r, c[1] - r), (c[0] + r, c[1] - r), (c[0] + r, c[1] + r), (c[0] - r, c[1] + r)],
                      LIP_Z1 - 0.004, LIP_Z1 + 0.012, 'pir_weld')

    def _guards(self, acc):
        st = self.st
        for v, d1, d2, pi in self.guards:
            n1, n2 = (d1[1], -d1[0]), (d2[1], -d2[0])
            pa = (v[0] - d1[0] * GUARD_ARM, v[1] - d1[1] * GUARD_ARM)
            pb = (v[0] + d2[0] * GUARD_ARM, v[1] + d2[1] * GUARD_ARM)
            pts = []
            for d in (BAND_OUT, BAND_OUT - GUARD_T):
                pts.append([(pa[0] + n1[0] * d, pa[1] + n1[1] * d), offset_point(pa, v, pb, d),
                            (pb[0] + n2[0] * d, pb[1] + n2[1] * d)])
            outer, inner = pts
            poly = outer + list(reversed(inner))
            acc.prism(poly, GUARD_Z0, GUARD_Z1 - 0.03, st['core'])
            acc.prism(poly, GUARD_Z1 - 0.03, GUARD_Z1, st['accent'] if st['clan'] is None else st['seam'])

    def _seams(self, acc, objs):
        """Merged seam strips along straight runs (spec 3.4); edge connectors on 1-cell runs and
        corner connectors at interior T-junctions are imported by the caller (self.connectors)."""
        st = self.st
        runs = {}
        deg = {}
        outline_pts = {_hq(p) for pts in self.points for p, _ in pts}
        for loop in self.loops:
            for e in loop:
                outline_pts.add(_hq(e.a))
        for e, other in self.seams:
            if self.parts[e.part].m == 'fill' or self.parts[other].m == 'fill':
                continue
            if not (_on_half(e.a) and _on_half(e.b)):
                continue
            a, b = _hq(e.a), _hq(e.b)
            if a[0] == b[0]:
                runs.setdefault(('v', a[0]), []).append(tuple(sorted((a[1], b[1]))))
            else:
                runs.setdefault(('h', a[1]), []).append(tuple(sorted((a[0], b[0]))))
            for q in (a, b):
                deg.setdefault(q, []).append('v' if a[0] == b[0] else 'h')
        self.connectors = []
        for (axis, c), segs in runs.items():
            segs.sort()
            merged = []
            for s0, s1 in segs:
                if merged and merged[-1][1] == s0:
                    merged[-1][1] = s1
                else:
                    merged.append([s0, s1])
            for s0, s1 in merged:
                L = (s1 - s0) / 2
                if axis == 'v':
                    a, b = (c / 2, s0 / 2), (c / 2, s1 / 2)
                else:
                    a, b = (s0 / 2, c / 2), (s1 / 2, c / 2)
                aligned = (s0 % 2 == 1)        # run from cell edge to cell edge
                if abs(L - 1) < 1e-6 and aligned and st['clan'] is None:
                    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                    self.connectors.append(('edge', mid, 0 if axis == 'v' else 90))
                    continue
                t = _norm((b[0] - a[0], b[1] - a[1]))
                n = (t[1], -t[0])
                if st['clan'] == 'rust':
                    k = max(1, int(L / 0.09))
                    for s in range(k):
                        u = (s + 0.5) / k * L
                        q = (a[0] + t[0] * u, a[1] + t[1] * u)
                        r = 0.024
                        acc.prism([(q[0] - r, q[1] - r), (q[0] + r, q[1] - r), (q[0] + r, q[1] + r),
                                   (q[0] - r, q[1] + r)], SEAM_Z0, SEAM_Z1 + 0.01, 'pir_weld')
                elif st['clan'] == 'slantedStar':
                    quad_strip(acc, a, b, n, -0.009, 0.009, SEAM_Z0, SEAM_Z1 + 0.002, 'sst_gold')
                else:
                    quad_strip(acc, a, b, n, -SEAM_W / 2, SEAM_W / 2, SEAM_Z0, SEAM_Z1, st['seam'])
        if st['clan'] is None:
            for q, axes in deg.items():
                if q in outline_pts or q[0] % 2 == 0 or q[1] % 2 == 0:
                    continue
                cnt = len(axes) // 2 if len(axes) >= 2 else len(axes)
                hv = {'h': axes.count('h'), 'v': axes.count('v')}
                # T junction: one axis passes through (2 half-edges), the other ends (1)
                if (hv['h'] == 2 and hv['v'] == 1) or (hv['v'] == 2 and hv['h'] == 1) or \
                        (hv['h'] == 1 and hv['v'] == 1):
                    self.connectors.append(('corner', (q[0] / 2, q[1] / 2), 0))
                del cnt

    def _grooves(self, acc):
        """Panel groove GROOVE_IN inside the outline over flat parts (spec 3.6)."""
        for pts in self.points:
            if area([p for p, _ in pts]) < 0:
                continue
            n = len(pts)
            P_ = [p for p, _ in pts]
            ins = [offset_point(P_[i - 1], P_[i], P_[(i + 1) % n], -GROOVE_IN) for i in range(n)]
            for i in range(n):
                kind = pts[i][1]
                if kind not in ('raw', 'shaped'):
                    continue
                a, b = ins[i], ins[(i + 1) % n]
                L = math.hypot(b[0] - a[0], b[1] - a[1])
                if L < 0.05:
                    continue
                t = _norm((b[0] - a[0], b[1] - a[1]))
                nn = (t[1], -t[0])
                k = max(1, round(L / 0.25))
                for s in range(k):
                    p0 = (a[0] + t[0] * L * s / k, a[1] + t[1] * L * s / k)
                    p1 = (a[0] + t[0] * L * (s + 1) / k, a[1] + t[1] * L * (s + 1) / k)
                    m = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
                    pi = self.cell_owner.get((round(m[0]), round(m[1])))
                    if pi is None:
                        continue
                    part = self.parts[pi]
                    if part.m not in FLAT or not point_in_poly(m, part.poly()):
                        continue
                    if part.shape:      # shaped models carry their own groove
                        continue
                    z = 0.20 if part.m != 'armor' else 0.20
                    quad_strip(acc, p0, p1, nn, -GROOVE_W / 2, GROOVE_W / 2, z - 0.004, z + 0.008, 'panel_line')

    def _fills(self, acc, lights):
        st = self.st
        for c in self.fills:
            x, y = c
            h = 0.5 - 0.015
            acc.prism([(x - h, y - h), (x + h, y - h), (x + h, y + h), (x - h, y + h)], -0.20, 0.10, st['core'])
            if self.fill_style == 'flush':     # mock option: a plain deck plate, flush with the deck
                q = 0.5 - 0.022
                acc.prism([(x - q, y - q), (x + q, y - q), (x + q, y + q), (x - q, y + q)], 0.06, 0.195,
                          st['plate'])
                for gy in (-0.2, 0.2):
                    acc.prism([(x - 0.36, y + gy - 0.01), (x + 0.36, y + gy - 0.01), (x + 0.36, y + gy + 0.01),
                               (x - 0.36, y + gy + 0.01)], 0.195, 0.2, 'panel_line')
                continue
            for gy in (-0.16, 0.16):
                acc.prism([(x - 0.34, y + gy - 0.012), (x + 0.34, y + gy - 0.012), (x + 0.34, y + gy + 0.012),
                           (x - 0.34, y + gy + 0.012)], 0.10, 0.108, 'panel_line')
            lights.dome((x + 0.25, y), 0.05, 0.10, st['amber'])

    def nav_points(self):
        """(pos, swatch) for the nav lights (spec 3.6), on the biggest loop."""
        st = self.st
        loop = max(self.points, key=lambda pts: area([p for p, _ in pts]))
        cand = []
        n = len(loop)
        for i, (p, kind) in enumerate(loop):
            prev_kind = loop[i - 1][1]
            if kind in ('raw', 'shaped', 'fill') or prev_kind in ('raw', 'shaped', 'fill'):
                cand.append(p)
        if not cand:
            return []
        cx = sum(p[0] for p in cand) / len(cand)
        out = []
        maxy = max(p[1] for p in cand)
        miny = min(p[1] for p in cand)
        left = max((p for p in cand if p[1] > maxy - 0.05), key=lambda p: p[0])
        right = max((p for p in cand if p[1] < miny + 0.05), key=lambda p: p[0])
        maxx = max(p[0] for p in cand)
        front = max(cand, key=lambda p: p[0] - 0.6 * abs(p[1]))
        del maxx
        out += [(left, st['red']), (right, st['green']), (front, st['white'])]
        for s in (1, -1):
            side = [p for p in cand if s * p[1] > 0.3 and p[0] < cx]
            if side:
                q = min(side, key=lambda p: p[0] - 0.6 * s * p[1])
                out.append((q, st['amber']))
        del n
        return out

    def _lights(self, acc):
        # pull each light slightly inside the outline onto the lip
        cen = self._centroid()
        for p, mat in self.nav_points():
            d = _norm((cen[0] - p[0], cen[1] - p[1]))
            q = (p[0] + d[0] * 0.075, p[1] + d[1] * 0.075)
            acc.dome(q, LIGHT_R, LIP_Z1 - 0.01, mat)

    def _centroid(self):
        cells = list(self.cell_owner)
        return (sum(c[0] for c in cells) / len(cells), sum(c[1] for c in cells) / len(cells))

    def _torn(self, acc, a, b):
        """Torn edge (spec v2 3.8 / critic S5): no band, no lip - only soot on the deck and the
        exposed side, with a ragged inner edge (stable per edge)."""
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        t = _norm((b[0] - a[0], b[1] - a[1]))
        n = (t[1], -t[0])
        h = (round(a[0] * 2) * 73856093) ^ (round(a[1] * 2) * 19349663) ^ (round(b[0] * 2) * 83492791)
        k = 4
        for s in range(k):
            u0, u1 = s / k * L, (s + 1) / k * L
            r = ((h >> (s * 4)) & 15) / 15.0
            depth = 0.10 + 0.18 * r
            pts = [(a[0] + t[0] * u0 + n[0] * 0.004, a[1] + t[1] * u0 + n[1] * 0.004),
                   (a[0] + t[0] * u1 + n[0] * 0.004, a[1] + t[1] * u1 + n[1] * 0.004),
                   (a[0] + t[0] * u1 - n[0] * depth * 0.8, a[1] + t[1] * u1 - n[1] * depth * 0.8),
                   (a[0] + t[0] * (u0 + u1) / 2 - n[0] * depth, a[1] + t[1] * (u0 + u1) / 2 - n[1] * depth),
                   (a[0] + t[0] * u0 - n[0] * depth * 0.7, a[1] + t[1] * u0 - n[1] * depth * 0.7)]
            acc.prism(pts, 0.19, 0.212 + 0.02 * r, 'char_black' if r > 0.4 else 'scorch')
        quad_strip(acc, a, b, n, -0.01, 0.006, -0.16, 0.19, 'char_black')


def terrace(acc, cells, st, z_top, inset0=0.14, slope=0.12):
    """Raised spine / terrace (critic S9): one slab with sloped sides over a group of flat cells.
    Bottom outline = union of the cells inset by inset0 at deck level, top = inset0 + slope."""
    parts = [Part('armor', c[0], c[1]) for c in cells]
    loops, _ = outline(parts)
    for loop in loops:
        pts = [e.a for e in loop]
        # drop collinear half-grid points
        clean = []
        n = len(pts)
        for i in range(n):
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % n]
            if abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > 1e-9:
                clean.append(b)
        if area(clean) <= 0:
            continue
        lo = inset(clean, inset0)
        hi = inset(clean, inset0 + slope)
        z0 = C.DECK_TOP - 0.01
        bm = acc.bm
        vb = [bm.verts.new((x, y, z0)) for x, y in lo]
        vt = [bm.verts.new((x, y, z_top)) for x, y in hi]
        side = acc._mi(st['plate'])
        top = acc._mi(st['plate'])
        f = bm.faces.new(list(reversed(vb)))
        f.material_index = side
        f = bm.faces.new(vt)
        f.material_index = top
        m = len(lo)
        for i in range(m):
            j = (i + 1) % m
            f = bm.faces.new((vb[i], vb[j], vt[j], vt[i]))
            f.material_index = acc._mi('hull_mid') if st['clan'] is None else side
        # accent line along the top edge + a dark panel groove on the top
        edge = inset(clean, inset0 + slope + 0.035)
        groove = inset(clean, inset0 + slope + 0.2)
        for ring, w, mat, dz in ((edge, 0.03, st['accent'] if st['clan'] is None else st['seam'], 0.004),
                                 (groove, 0.02, 'panel_line', 0.003)):
            if area(ring) <= 0.02:
                continue
            mm = len(ring)
            for i in range(mm):
                a2, b2 = ring[i], ring[(i + 1) % mm]
                tt = _norm((b2[0] - a2[0], b2[1] - a2[1]))
                quad_strip(acc, a2, b2, (tt[1], -tt[0]), -w / 2, w / 2, z_top - 0.004, z_top + dz, mat,
                           w / 2, w / 2)


# game rule (src/sim/combat/arcs.ts): +-60 deg sampled every 2 deg; a direction is usable only when the
# whole ray (30 cells) crosses no other part of the ship (boundary solid - a grazing ray is blocked);
# usable directions merge into intervals, slivers under 4 deg are dropped
ARC_HALF_DEG = 60
ARC_STEP_DEG = 2
ARC_RAY = 30.0


def _ray_blocked(c, d, polys):
    for pts in polys:
        if point_in_poly(c, pts):
            return True
        n = len(pts)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            ex, ey = b[0] - a[0], b[1] - a[1]
            den = d[0] * ey - d[1] * ex
            if abs(den) < 1e-12:
                continue
            t = ((a[0] - c[0]) * ey - (a[1] - c[1]) * ex) / den
            u = ((a[0] - c[0]) * d[1] - (a[1] - c[1]) * d[0]) / den
            if 1e-6 < t <= ARC_RAY and -1e-9 <= u <= 1 + 1e-9:
                return True
    return False


def arc_intervals(c, aim_deg, blockers=(), half_deg=ARC_HALF_DEG, step_deg=ARC_STEP_DEG):
    """Usable intervals [a, b] (degrees relative to the aim) of a deck cannon at `c`."""
    steps = round(2 * half_deg / step_deg)
    out, start, last = [], None, 0.0
    for k in range(steps + 1):
        a = -half_deg + 2 * half_deg * k / steps
        r = math.radians(aim_deg + a)
        if not _ray_blocked(c, (math.cos(r), math.sin(r)), blockers):
            if start is None:
                start = a
            last = a
        elif start is not None:
            out.append((start, last))
            start = None
    if start is not None:
        out.append((start, last))
    return [(a, b) for a, b in out if b - a >= 2 * step_deg - 1e-9]


def _sector(acc, c, aim_deg, a0, a1, r, z, mat, w, spokes=True):
    n = max(2, int(abs(a1 - a0) / 3) + 1)
    pts = [(c[0] + r * math.cos(math.radians(aim_deg + a0 + (a1 - a0) * i / n)),
            c[1] + r * math.sin(math.radians(aim_deg + a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
    segs = list(zip(pts[:-1], pts[1:]))
    if spokes:
        segs += [(c, pts[0]), (c, pts[-1])]
    for p0, p1 in segs:
        if math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1e-4:
            continue
        t = _norm((p1[0] - p0[0], p1[1] - p0[1]))
        quad_strip(acc, p0, p1, (t[1], -t[0]), -w / 2, w / 2, z, z + 0.01, mat, w / 2, w / 2)


def arc_fan(acc, c, aim_deg, blockers=(), half_deg=ARC_HALF_DEG, r=3.0, z=0.66, mat='radar_glow',
            blocked_mat='light_red', w=0.03, r_blocked=1.3):
    """Firing-arc overlay (shipyard layer V) as the game computes it (arc_intervals): usable sectors out
    to `r` in `mat`; the blocked rest of the +-half_deg fan as a short `blocked_mat` rim at `r_blocked`.
    Returns the usable intervals."""
    ivs = arc_intervals(c, aim_deg, blockers, half_deg)
    for a0, a1 in ivs:
        _sector(acc, c, aim_deg, a0, a1, r, z, mat, w)
    # blocked complement (rim only, no spokes: reads as "cut")
    edges = [-half_deg] + [v for iv in ivs for v in iv] + [half_deg]
    for i in range(0, len(edges), 2):
        b0, b1 = edges[i], edges[i + 1]
        if i > 0:
            b0 += ARC_STEP_DEG / 2
        if i + 2 < len(edges):
            b1 -= ARC_STEP_DEG / 2
        if b1 - b0 > 1e-6:
            _sector(acc, c, aim_deg, b0, b1, r_blocked, z, blocked_mat, w * 1.3, spokes=False)
    return ivs


# ---------------------------------------------------------------------------
# shaped / bevelled armour (stand-in for hull_base_poly, spec 6.6)
# ---------------------------------------------------------------------------
def armor_poly(name, poly, st, lvl=1):
    """Armour part with an arbitrary CCW polygon outline (deck profile of parts/common.py)."""
    acc = Acc(name)
    core = inset(poly, C.MARGIN)
    acc.prism(core, C.CORE_Z0, C.CORE_Z1, st['core'])
    acc.prism(inset(poly, C.MARGIN - C.SKIRT_OUT), C.SKIRT_Z0, C.SKIRT_Z1, st['accent'])
    if st['glow']:
        acc.prism(inset(poly, C.MARGIN - 0.004), C.GLOW_Z0, C.GLOW_Z1, st['glow'])
    plate = inset(poly, C.PLATE_MARGIN)
    ob_core = acc.build()
    pl = G.prism(name + '_Plate', plate, C.PLATE_Z0, C.DECK_TOP, st['plate'], bevel=0.012, seg=2)
    top = Acc(name + '_Top')
    groove = inset(poly, 0.18)
    pad = inset(poly, 0.205)
    if area(pad) > 0.01 and area(groove) > 0:
        top.prism(groove, C.DECK_TOP - 0.01, C.DECK_TOP + 0.006, 'panel_line')
        top.prism(pad, C.DECK_TOP - 0.01, C.DECK_TOP + 0.04, st['pad'])
        if st['clan'] == 'slantedStar':
            # gold slash along the longest pad edge
            n = len(pad)
            i = max(range(n), key=lambda k: math.hypot(pad[(k + 1) % n][0] - pad[k][0], pad[(k + 1) % n][1] - pad[k][1]))
            a, b = pad[i], pad[(i + 1) % n]
            t = _norm((b[0] - a[0], b[1] - a[1]))
            nn = (-t[1], t[0])
            quad_strip(top, a, b, nn, 0.02, 0.045, C.DECK_TOP + 0.03, C.DECK_TOP + 0.05, 'sst_gold', -0.06, -0.06)
        elif st['clan'] == 'rust':
            cx = sum(p[0] for p in pad) / len(pad)
            cy = sum(p[1] for p in pad) / len(pad)
            r = 0.07
            top.prism([(cx - r, cy - r * 0.6), (cx + r, cy - r), (cx + r * 0.7, cy + r), (cx - r, cy + r * 0.8)],
                      C.DECK_TOP + 0.03, C.DECK_TOP + 0.05, 'pir_rust_patch')
        elif lvl >= 2:
            cx = sum(p[0] for p in pad) / len(pad)
            cy = sum(p[1] for p in pad) / len(pad)
            r = min(0.06, math.sqrt(abs(area(pad))) * 0.25)
            top.prism([(cx - r, cy), (cx, cy - r), (cx + r, cy), (cx, cy + r)], C.DECK_TOP + 0.03,
                      C.DECK_TOP + 0.055, st['glow'] if lvl == 2 else (st['gem'] or st['glow']))
    # bolts at convex corners
    ins = inset(poly, 0.10)
    n = len(poly)
    for i in range(n):
        a, b, c = poly[i - 1], poly[i], poly[(i + 1) % n]
        cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        d1 = math.hypot(b[0] - a[0], b[1] - a[1])
        d2 = math.hypot(c[0] - b[0], c[1] - b[1])
        if cr > 1e-4 and d1 > 0.2 and d2 > 0.2:
            q = ins[i]
            top.prism([(q[0] + 0.022 * math.cos(k * math.pi / 4), q[1] + 0.022 * math.sin(k * math.pi / 4))
                       for k in range(8)], C.DECK_TOP - 0.005, C.DECK_TOP + 0.025, 'trim_black')
    ob_top = top.build(bevel=0.008)
    return [o for o in (ob_core, pl, ob_top) if o]


def bevel_poly(part, corners):
    """Full cell polygon with BEVEL x BEVEL cuts at the given outline vertices."""
    sq = part.poly()
    out = []
    n = len(sq)
    for i, v in enumerate(sq):
        if any(abs(v[0] - c[0]) < 1e-6 and abs(v[1] - c[1]) < 1e-6 for c in corners):
            a, b = sq[i - 1], sq[(i + 1) % n]
            da = _norm((a[0] - v[0], a[1] - v[1]))
            db = _norm((b[0] - v[0], b[1] - v[1]))
            out.append((v[0] + da[0] * BEVEL, v[1] + da[1] * BEVEL))
            out.append((v[0] + db[0] * BEVEL, v[1] + db[1] * BEVEL))
        else:
            out.append(v)
    return out


# ---------------------------------------------------------------------------
# superstructure top module (spec 4.10)
# ---------------------------------------------------------------------------
def host_top(objs, x, y, r=TOP_R):
    """Highest vertex of the host model inside the pedestal radius (world)."""
    zmax = C.DECK_TOP
    for o in objs:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            w = mw @ v.co
            if (w.x - x) ** 2 + (w.y - y) ** 2 < r * r and w.z > zmax:
                zmax = w.z
    return zmax


def top_module(import_glb, path, x, y, rot_deg, st, ped_top, mast_dx=0.0, name='Top'):
    """Import a deck part, keep only what stands above the deck inside the pedestal radius and
    lift it onto a round pedestal (pedestal top = ped_top).  mast_dx: pedestal offset along the
    part's local -X (radar mast behind a cockpit canopy)."""
    ca, sa = math.cos(math.radians(rot_deg)), math.sin(math.radians(rot_deg))
    px, py = x - mast_dx * ca, y - mast_dx * sa
    roots, objs = import_glb(path, loc=(px, py, 0), rot_z=rot_deg)
    root = roots[0]
    bm = bmesh.new()
    bm.from_mesh(root.data)
    kill = [f for f in bm.faces
            if all(v.co.z < C.DECK_TOP + 0.006 for v in f.verts)
            or any(v.co.x * v.co.x + v.co.y * v.co.y > 0.40 * 0.40 for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(root.data)
    bm.free()
    root.location.z = ped_top - C.DECK_TOP
    acc = Acc(name + '_Pedestal')
    r = TOP_R if not mast_dx else 0.13
    seg = 20

    def ring(rr):
        return [(px + rr * math.cos(2 * math.pi * k / seg), py + rr * math.sin(2 * math.pi * k / seg))
                for k in range(seg)]
    body = st['plate'] if st['clan'] is None else st['core']
    acc.prism(ring(r), C.DECK_TOP - 0.01, ped_top - 0.03, body)
    acc.prism(ring(r + 0.006), C.DECK_TOP - 0.01, C.DECK_TOP + 0.03, st['core'])
    zm = (C.DECK_TOP + ped_top) / 2
    acc.prism(ring(r + 0.012), zm - 0.025, zm + 0.025, st['accent'] if st['clan'] is None else st['seam'])
    if mast_dx:
        acc.prism(ring(0.25), ped_top - 0.05, ped_top, st['plate'])
        acc.prism(ring(0.2), C.DECK_TOP - 0.01, C.DECK_TOP + 0.04, st['core'])
    else:
        acc.prism(ring(r - 0.01), ped_top - 0.03, ped_top, st['core'])
    ped = acc.build(bevel=0.01)
    bpy.context.view_layer.update()
    return objs + [ped]


def tri_count(objs):
    return sum(G.tri_count(o) for o in objs if o.type == 'MESH')
