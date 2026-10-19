"""Greeble kit (detail pass "dtl"): small hull-style details at SHIP-PART scale,
placed procedurally (seeded, deterministic) over large structures so a 28-unit
station carries the same visual frequency of detail per unit area as a 1x1
ship part (panels, vents, grilles, pipes, lamps, hatches, racks ...).

Three layers, all writing into ONE mesh (one draw call, shared AF_Palette):

  Kit          a light-weight mesh builder (boxes, prisms, cylinders, decals)
               in local "surface frames" (Matrix: x = u, y = v, z = surface
               normal, origin = surface point).  Faces hidden against the host
               surface (greeble bottoms) are skipped.  Per-vertex 'af_dirt'
               (0..1) marks soot/scorch for the weathering pass.
  scatter()    walks the faces of a joined host mesh (logical PAL_ materials
               still assigned, identity transform), samples points at a target
               density per unit area, picks a greeble type for the face class
               (top / side), and validates every footprint with ray casts
               (must sit flat on the host, nothing above it), a spatial hash
               (no overlaps) and Zones (clear areas: dock path, rotor sweep,
               attach points ...).
  weather()    COLOR_0 pass on the final mesh: ray-cast ambient occlusion
               (near + far), subtle per-face panel fade, grime blotches,
               darker undersides, soot from 'af_dirt'.  Emissive faces stay 1.

FUNCTIONAL SURFACES STAY CLEAR (README "Greeble kit"): nothing is placed on
landing / drone pads, dock cradle floors, the hangar build floor, walkways and
decks meant to be used, glowing guide markings / chevrons, or any surface where
something lands or docks.  Mechanisms: (1) 'floor_dark' (pad / bay / cradle
floors) is never a host; (2) every builder declares Zones.functional(...) /
Zones.pad(...) over such surfaces; (3) Scatter refuses top greebles next to
small emissive guide faces (runway lights, chevrons).  Detail goes on the
rim, sides, undersides and supporting structure instead.

Density rule (README "Greeble kit"): a 1x1 ship part shows ~4-6 distinct
features; at station scale we aim for ~1.0-1.6 greebles per unit^2 on tops and
~1.2-2.0 on walls (plus panel insets), features 0.1-0.9 units.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

from . import materials as M
from . import palette as P

DIRT = 'af_dirt'

# ----------------------------------------------------------------------------
# styles: role -> palette key.  'hosts' = host swatches greebles may sit on;
# 'shade' = host swatch -> panel-inset shades (first = most common).
# ----------------------------------------------------------------------------
_BASE = dict(
    plate='hull_light', plate2='hull_white', mid='hull_mid', dark='hull_dark', trim='trim_black',
    metal='metal_bare', accent='accent_iron', accent2='accent_iron_dark', window='window_warm',
    frame='glass_frame', glass='glass_cockpit', lamp='light_amber', lamp2='light_white',
    red='light_red', green='light_green', tech='engine_glow', solar='solar_cell',
    cargo=('accent_iron', 'accent_titanium', 'fuel_yellow', 'hull_light', 'accent_trader', 'hull_mid'),
    hosts=('hull_light', 'hull_white', 'hull_mid', 'hull_dark', 'hull_ti', 'hull_dark_ti', 'base_concrete'),
    shade={'hull_light': ('hull_light', 'hull_white', 'hull_light', 'hull_mid'),
           'hull_white': ('hull_white', 'hull_light'),
           'hull_mid': ('hull_mid', 'hull_light', 'hull_mid', 'hull_dark'),
           'hull_dark': ('hull_dark', 'hull_mid', 'trim_black'),
           'floor_dark': ('floor_dark', 'hull_dark'),
           'hull_ti': ('hull_ti', 'hull_white'),
           'hull_dark_ti': ('hull_dark_ti', 'hull_mid'),
           'base_concrete': ('base_concrete', 'base_concrete_dark', 'hull_mid')},
    weights={}, lit=1.0, dead=False, rust=0.0,
)


def _style(**kw):
    s = dict(_BASE)
    s.update(kw)
    return s


STYLES = {
    'home': _style(),
    'trade': _style(accent='accent_trader', weights={'rack': 2.5, 'lights': 1.3}),
    'refinery': _style(tech='vein_ice', weights={'pipes': 2.2, 'tank': 2.0, 'radiator': 1.6, 'rack': 0.4}),
    'shipyard': _style(weights={'truss': 2.2, 'unit': 1.6, 'rack': 1.2, 'lights': 1.4}),
    'outpost': _style(weights={'antenna': 1.6, 'tank': 1.4}),
    'pirate': _style(
        plate='pir_plate_worn', plate2='pir_gunmetal', mid='pir_gunmetal', dark='pir_gunmetal_dark',
        trim='pir_gunmetal_dark', accent='pir_hazard', accent2='pir_rust', window='pir_glass_red',
        frame='pir_gunmetal_dark', glass='pir_glass_red', lamp='pir_glow_red', lamp2='light_amber', green='light_amber',
        tech='pir_glow_red', cargo=('pir_rust', 'pir_hazard', 'pir_gunmetal', 'pir_plate_worn', 'pir_rust_dark'),
        hosts=('pir_gunmetal', 'pir_gunmetal_dark', 'pir_plate_worn', 'pir_rust', 'pir_rust_dark', 'hull_mid',
               'hull_dark', 'pir_hazard'),
        shade={'pir_gunmetal': ('pir_gunmetal', 'pir_plate_worn', 'pir_rust', 'pir_gunmetal_dark'),
               'pir_gunmetal_dark': ('pir_gunmetal_dark', 'pir_gunmetal', 'pir_rust_dark'),
               'pir_plate_worn': ('pir_plate_worn', 'pir_gunmetal', 'pir_rust'),
               'pir_rust': ('pir_rust', 'pir_rust_dark', 'pir_gunmetal'),
               'pir_rust_dark': ('pir_rust_dark', 'pir_rust'),
               'pir_hazard': ('pir_hazard', 'pir_gunmetal_dark'),
               'hull_mid': ('hull_mid', 'pir_gunmetal'), 'hull_dark': ('hull_dark', 'pir_gunmetal_dark')},
        weights={'scorch': 2.5, 'window': 0.35, 'skylight': 0.3, 'rack': 1.4, 'pipes': 1.4, 'cables': 1.8,
                 'patch': 3.0, 'lights': 0.6},
        lit=0.7, rust=0.6),
    'derelict': _style(
        plate='der_plate', plate2='hull_mid', mid='hull_mid', dark='der_dark', trim='trim_black',
        accent='der_rust', accent2='der_rust', window='der_window', frame='der_dark', glass='der_window',
        lamp='der_window', lamp2='der_window', red='der_window', green='der_window', tech='der_window',
        cargo=('der_rust', 'hull_mid', 'der_plate', 'fuel_yellow'),
        hosts=('der_plate', 'der_dark', 'hull_mid', 'der_rust', 'hull_dark', 'hull_light'),
        shade={'der_plate': ('der_plate', 'hull_mid', 'der_plate', 'der_dark'),
               'der_dark': ('der_dark', 'hull_mid', 'trim_black'),
               'hull_mid': ('hull_mid', 'der_plate'), 'der_rust': ('der_rust', 'der_dark'),
               'hull_dark': ('hull_dark', 'der_dark'), 'hull_light': ('hull_light', 'der_plate')},
        weights={'scorch': 3.0, 'hole': 2.0, 'patch': 1.0, 'lights': 0.5, 'antenna': 0.5},
        lit=0.0, dead=True, rust=1.0),
    'base': _style(weights={'unit': 1.4, 'pipes': 1.3, 'scorch': 0.5}),
}

EMISSIVE = {s.key for s in P.SWATCHES if s.emit}


# ----------------------------------------------------------------------------
# frames
# ----------------------------------------------------------------------------
def frame(p, n, u):
    """4x4 surface frame: x = u, y = n x u, z = n, origin p (right-handed)."""
    n = Vector(n).normalized()
    u = Vector(u)
    u = (u - n * u.dot(n))
    if u.length < 1e-6:
        u = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
        u = (u - n * u.dot(n))
    u.normalize()
    v = n.cross(u)
    p = Vector(p)
    return Matrix(((u.x, v.x, n.x, p.x), (u.y, v.y, n.y, p.y), (u.z, v.z, n.z, p.z), (0, 0, 0, 1)))


def top_frame(p, u=(1, 0, 0)):
    return frame(p, (0, 0, 1), u)


def wall_frame(p, outward):
    """Vertical wall at p facing `outward` (horizontal): x = horizontal, y = up."""
    o = Vector(outward)
    o.z = 0
    o.normalize()
    return frame(p, o, Vector((0, 0, 1)).cross(o))


# ----------------------------------------------------------------------------
# Kit - mesh builder
# ----------------------------------------------------------------------------
_BOX_FACES = ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5))


class Kit:
    """Collects greeble geometry; `obj(name)` turns it into one mesh object
    with logical palette materials (finalised later with the host)."""

    def __init__(self):
        self.bm = bmesh.new()
        self.dl = self.bm.verts.layers.float.new(DIRT)
        self.keys = []
        self.kidx = {}
        self.tris = 0

    def _mi(self, key):
        if key not in self.kidx:
            P.BY_KEY[key]   # KeyError on typos
            self.kidx[key] = len(self.keys)
            self.keys.append(key)
        return self.kidx[key]

    def _v(self, m, co, dirt=0.0):
        v = self.bm.verts.new(m @ Vector(co))
        if dirt:
            v[self.dl] = dirt
        return v

    def _f(self, vs, key):
        f = self.bm.faces.new(vs)
        f.material_index = self._mi(key)
        self.tris += len(vs) - 2
        return f

    # -- solids --------------------------------------------------------------
    def box(self, m, x0, x1, y0, y1, z0, z1, key, bottom=False, top=None, dirt=0.0):
        vs = [self._v(m, ((x0, x1)[i & 1], (y0, y1)[(i >> 1) & 1], (z0, z1)[i >> 2]), dirt) for i in range(8)]
        for k, f in enumerate(_BOX_FACES):
            if k == 0 and not bottom:
                continue
            self._f([vs[i] for i in f], top if (k == 1 and top) else key)

    def prism(self, m, pts, z0, z1, key, top=None, bottom=False):
        """CCW outline pts [(x, y)] extruded z0..z1 in frame m."""
        vb = [self._v(m, (x, y, z0)) for x, y in pts]
        vt = [self._v(m, (x, y, z1)) for x, y in pts]
        n = len(pts)
        self._f(vt, top or key)
        if bottom:
            self._f(list(reversed(vb)), key)
        for i in range(n):
            j = (i + 1) % n
            self._f((vb[i], vb[j], vt[j], vt[i]), key)

    def plate(self, m, hx, hy, z0, z1, key, c=None, cx=0.0, cy=0.0):
        """Chamfered plate (panel inset look)."""
        c = min(hx, hy) * 0.3 if c is None else c
        self.prism(m, chamfer_rect(cx - hx, cx + hx, cy - hy, cy + hy, c), z0, z1, key)

    def cyl(self, m, a, b, r, key, n=6, caps=(True, True), r2=None):
        """Cylinder between local points a and b (n sides)."""
        a, b = Vector(a), Vector(b)
        w = (b - a)
        if w.length < 1e-6:
            return
        w.normalize()
        p1 = w.cross(Vector((0, 0, 1)))
        if p1.length < 1e-3:
            p1 = w.cross(Vector((1, 0, 0)))
        p1.normalize()
        p2 = w.cross(p1)
        r2 = r if r2 is None else r2
        ra, rb = [], []
        for k in range(n):
            t = 2 * math.pi * (k + 0.5) / n
            d = p1 * math.cos(t) + p2 * math.sin(t)
            ra.append(self._v(m, a + d * r))
            rb.append(self._v(m, b + d * r2) if r2 > 1e-6 else None)
        if r2 <= 1e-6:
            tip = self._v(m, b)
            for k in range(n):
                self._f((ra[k], ra[(k + 1) % n], tip), key)
        else:
            for k in range(n):
                j = (k + 1) % n
                self._f((ra[k], rb[k], rb[j], ra[j]), key)
            if caps[1]:
                self._f(rb, key)
        if caps[0]:
            self._f(list(reversed(ra)), key)

    def lathe(self, m, prof, key_of, n=10):
        """Revolve [(z, r)] around local +Z (open ends; r == 0 -> pole).
        key_of: key or list of keys per band."""
        rings = []
        for z, r in prof:
            if r < 1e-6:
                rings.append([self._v(m, (0, 0, z))] * n)
            else:
                rings.append([self._v(m, (r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n), z))
                              for k in range(n)])
        for i in range(len(rings) - 1):
            A, B = rings[i], rings[i + 1]
            key = key_of[i] if isinstance(key_of, (list, tuple)) else key_of
            for k in range(n):
                j = (k + 1) % n
                q = [A[k], A[j], B[j], B[k]]
                vs = []
                for v in q:
                    if v not in vs:
                        vs.append(v)
                if len(vs) >= 3:
                    self._f(vs, key)

    def decal(self, m, rx, ry, key, rng, lift=0.006, dirt=0.9, n=8):
        """Soft soot/scorch decal: a flat disc in the HOST swatch whose vertex
        'af_dirt' fades from `dirt` (centre) to 0 (rim) -> blends into the host."""
        c = self._v(m, (0, 0, lift), dirt)
        inner, outer = [], []
        for k in range(n):
            t = 2 * math.pi * k / n
            j = rng.uniform(0.75, 1.0)
            inner.append(self._v(m, (0.45 * rx * j * math.cos(t), 0.45 * ry * j * math.sin(t), lift), dirt * 0.8))
            j2 = rng.uniform(0.8, 1.0)
            outer.append(self._v(m, (rx * j2 * math.cos(t), ry * j2 * math.sin(t), lift), 0.0))
        for k in range(n):
            j = (k + 1) % n
            self._f((c, inner[k], inner[j]), key)
            self._f((inner[k], outer[k], outer[j], inner[j]), key)

    # -- output ----------------------------------------------------------------
    def obj(self, name):
        me = bpy.data.meshes.new(name)
        bm = self.bm
        bm.normal_update()
        bm.to_mesh(me)
        bm.free()
        self.bm = None
        for k in self.keys:
            me.materials.append(M.mat(k))
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def chamfer_rect(x0, x1, y0, y1, c):
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c),
            (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]


# ----------------------------------------------------------------------------
# greeble types: builder(kit, m, hx, hy, rng, S, host) in a surface frame.
# Each entry: classes, base weight, hx range, hy range, height (for checks).
# ----------------------------------------------------------------------------
def _shade(S, host, rng):
    opts = S['shade'].get(host, (host,))
    return opts[rng.randrange(len(opts))]


def g_panel(k, m, hx, hy, rng, S, host):
    sh = _shade(S, host, rng)
    k.plate(m, hx, hy, 0.0, rng.choice((0.025, 0.035)), sh)
    if rng.random() < 0.55:   # bolt pair / lamp
        for sx in (-1, 1):
            k.box(m, sx * (hx - 0.09) - 0.025, sx * (hx - 0.09) + 0.025, -hy + 0.05, -hy + 0.1, 0.03, 0.055, S['trim'])
    if rng.random() < 0.25:
        k.box(m, -hx * 0.7, hx * 0.7, hy - 0.08, hy - 0.04, 0.03, 0.05, S['accent'])


def g_patch(k, m, hx, hy, rng, S, host):
    """Welded patch plate, slightly tilted (scrap look)."""
    sh = _shade(S, host, rng)
    t = Matrix.Rotation(math.radians(rng.uniform(-14, 14)), 4, 'Z')
    k.box(m @ t, -hx, hx, -hy, hy, 0.0, 0.04, sh)
    for sx in (-1, 1):
        for sy in (-1, 1):
            if rng.random() < 0.6:
                k.box(m @ t, sx * (hx - 0.06) - 0.022, sx * (hx - 0.06) + 0.022,
                      sy * (hy - 0.06) - 0.022, sy * (hy - 0.06) + 0.022, 0.04, 0.06, S['metal'])


def g_vent(k, m, hx, hy, rng, S, host):
    k.box(m, -hx, hx, -hy, hy, 0.0, 0.035, S['trim'])
    n = max(2, int(hx / 0.07))
    for i in range(n):
        x = -hx + 0.05 + (2 * hx - 0.1) * (i + 0.5) / n
        k.box(m, x - 0.018, x + 0.018, -hy + 0.035, hy - 0.035, 0.03, 0.06, S['mid'])
    if rng.random() < 0.35:
        k.decal(m @ Matrix.Translation((0, -hy * 2.2, 0)), hx * 1.2, hy * 1.6, host, rng, lift=0.004, dirt=0.55)


def g_grille(k, m, hx, hy, rng, S, host):
    """Raised housing with a dark grille window (ship-part style)."""
    k.box(m, -hx, hx, -hy, hy, 0.0, 0.07, S['mid'], top=S['plate'] if rng.random() < 0.5 else None)
    k.box(m, -hx + 0.05, hx - 0.05, -hy + 0.05, hy - 0.05, 0.07, 0.08, S['trim'])
    n = max(2, int((hx - 0.05) / 0.06))
    for i in range(n):
        x = -hx + 0.05 + (2 * hx - 0.1) * (i + 0.5) / n
        k.box(m, x - 0.012, x + 0.012, -hy + 0.06, hy - 0.06, 0.075, 0.095, S['metal'])


def g_hatch(k, m, hx, hy, rng, S, host):
    k.plate(m, hx, hy, 0.0, 0.025, S['dark'])
    k.plate(m, hx - 0.045, hy - 0.045, 0.02, 0.045, _shade(S, host, rng) if S['dead'] else S['plate2'])
    k.box(m, -hx * 0.35, hx * 0.35, -0.025, 0.025, 0.045, 0.07, S['metal'])
    if rng.random() < 0.6:   # hazard ticks on one edge
        for i in range(3):
            x = -hx + 0.1 + i * (2 * hx - 0.2) / 2
            k.box(m, x - 0.035, x + 0.035, -hy - 0.05, -hy - 0.01, 0.0, 0.02, S['accent'])


def g_unit(k, m, hx, hy, rng, S, host):
    """Machinery block: dark body, light lid, status lamp."""
    h = rng.uniform(0.1, 0.28)
    k.box(m, -hx, hx, -hy, hy, 0.0, h, S['dark'] if rng.random() < 0.6 else S['mid'])
    k.plate(m, hx - 0.03, hy - 0.03, h, h + 0.03, _shade(S, host, rng) if rng.random() < 0.4 else S['plate'])
    if rng.random() < 0.6 * (1 if not S['dead'] else 0.4):
        lk = (S['lamp'], S['tech'], S['green'], S['lamp2'])[rng.randrange(4)]
        k.box(m, hx - 0.09, hx - 0.03, -hy - 0.012, -hy + 0.0, h * 0.5, h * 0.5 + 0.06, lk)
    if rng.random() < 0.4:   # side pipe stub
        k.cyl(m, (-hx - 0.12, 0, h * 0.4), (-hx + 0.02, 0, h * 0.4), 0.035, S['metal'], n=6)


def g_pipes(k, m, hx, hy, rng, S, host):
    n = 1 + (hy > 0.09) + (hy > 0.12)
    z = rng.uniform(0.09, 0.14)
    for i in range(n):
        y = -hy + 0.05 + (2 * hy - 0.1) * (i + 0.5) / n
        r = min(0.05, (2 * hy - 0.06) / n / 2.2)
        key = (S['metal'], S['mid'], S['accent'], S['tech'] if not S['dead'] else S['mid'])[
            0 if i == 0 else rng.randrange(3 if rng.random() < 0.9 else 4)]
        k.cyl(m, (-hx, y, z), (hx, y, z), r, key, n=6)
    nb = max(2, int(hx / 0.35) + 1)
    for i in range(nb):
        x = -hx + 0.06 + (2 * hx - 0.12) * i / (nb - 1)
        k.box(m, x - 0.03, x + 0.03, -hy, hy, 0.0, z + 0.03, S['dark'])


def g_cables(k, m, hx, hy, rng, S, host):
    n = 2 + (rng.random() < 0.5)
    z = 0.04
    for i in range(n):
        y = -hy + (2 * hy) * (i + 0.5) / n
        k.cyl(m, (-hx, y, z), (hx, y, z + rng.uniform(-0.01, 0.01)), 0.022, (S['trim'], S['dark'], S['accent2'])[i % 3],
              n=4)
    for x in (-hx, hx):
        k.box(m, x - 0.04, x + 0.04, -hy - 0.02, hy + 0.02, 0.0, 0.075, S['mid'])


def g_lights(k, m, hx, hy, rng, S, host):
    n = max(2, int(hx / 0.12))
    key = S['window'] if rng.random() < 0.55 else S['lamp']
    if S['dead']:
        key = S['window']
    for i in range(n):
        x = -hx + (2 * hx) * (i + 0.5) / n
        k.box(m, x - 0.035, x + 0.035, -0.035, 0.035, 0.0, 0.035, key)


def g_skylight(k, m, hx, hy, rng, S, host):
    k.box(m, -hx, hx, -hy, hy, 0.0, 0.03, S['trim'])
    key = S['window'] if rng.random() < 0.7 * S['lit'] + (0.7 if S['dead'] else 0) else S['glass']
    n = max(1, int(hx / 0.16))
    for i in range(n):
        x0 = -hx + 0.035 + (2 * hx - 0.07) * i / n
        x1 = -hx + 0.035 + (2 * hx - 0.07) * (i + 1) / n
        k.box(m, x0 + 0.012, x1 - 0.012, -hy + 0.035, hy - 0.035, 0.02, 0.04, key)


def g_rack(k, m, hx, hy, rng, S, host):
    """Cargo rack with small containers."""
    k.box(m, -hx, hx, -hy, hy, 0.0, 0.03, S['dark'])
    nx = max(1, int(hx / 0.17))
    ny = 1 + (hy > 0.22)
    for i in range(nx):
        for j in range(ny):
            if rng.random() < 0.18:
                continue
            x0 = -hx + 0.03 + (2 * hx - 0.06) * i / nx
            x1 = -hx + 0.03 + (2 * hx - 0.06) * (i + 1) / nx
            y0 = -hy + 0.03 + (2 * hy - 0.06) * j / ny
            y1 = -hy + 0.03 + (2 * hy - 0.06) * (j + 1) / ny
            h = rng.uniform(0.12, 0.2) * (1 + (rng.random() < 0.25))
            c = S['cargo'][rng.randrange(len(S['cargo']))]
            k.box(m, x0 + 0.012, x1 - 0.012, y0 + 0.012, y1 - 0.012, 0.03, 0.03 + h, c)
            k.box(m, (x0 + x1) / 2 - 0.012, (x0 + x1) / 2 + 0.012, y0 + 0.004, y1 - 0.004, 0.035, 0.035 + h * 0.96,
                  S['dark'])
    for sx in (-1, 1):   # corner posts
        k.box(m, sx * hx - 0.025, sx * hx + 0.025, -hy, -hy + 0.05, 0.0, 0.3, S['mid'])
        k.box(m, sx * hx - 0.025, sx * hx + 0.025, hy - 0.05, hy, 0.0, 0.3, S['mid'])


def g_radiator(k, m, hx, hy, rng, S, host):
    k.box(m, -hx, hx, -hy, hy, 0.0, 0.04, S['dark'])
    n = max(3, int(hx / 0.065))
    h = rng.uniform(0.14, 0.22)
    for i in range(n):
        x = -hx + 0.03 + (2 * hx - 0.06) * (i + 0.5) / n
        k.box(m, x - 0.014, x + 0.014, -hy + 0.02, hy - 0.02, 0.04, 0.04 + h, S['plate2'] if i % 4 else S['accent'])


def g_truss(k, m, hx, hy, rng, S, host):
    z = 0.07
    for y in (-hy + 0.03, hy - 0.03):
        k.box(m, -hx, hx, y - 0.025, y + 0.025, z - 0.025, z + 0.025, S['mid'])
    n = max(2, int(hx / 0.16))
    for i in range(n + 1):
        x = -hx + 0.03 + (2 * hx - 0.06) * i / n
        k.box(m, x - 0.018, x + 0.018, -hy + 0.03, hy - 0.03, z - 0.02, z + 0.02, S['dark'])
        k.box(m, x - 0.03, x + 0.03, -hy, hy, 0.0, z - 0.02, S['dark'])


def g_tank(k, m, hx, hy, rng, S, host):
    r = hy - 0.02
    key = rng.choice(('fuel_yellow', S['plate'], S['plate2'], S['mid'])) if not S['dead'] else S['accent2']
    k.cyl(m, (-hx + r * 0.6, 0, r + 0.05), (hx - r * 0.6, 0, r + 0.05), r, key, n=8)
    for x in (-hx + r * 0.6, hx - r * 0.6):
        k.cyl(m, (x - 0.001, 0, r + 0.05), (x - 0.06 if x < 0 else x + 0.06, 0, r + 0.05), r * 0.98, key, n=8,
              r2=r * 0.55)
    for x in (-hx * 0.45, hx * 0.45):
        k.box(m, x - 0.04, x + 0.04, -hy, hy, 0.0, r * 0.8, S['dark'])
        k.box(m, x - 0.045, x + 0.045, -0.015, 0.015, 0.0, 2 * r + 0.07, S['trim'])


def g_antenna(k, m, hx, hy, rng, S, host):
    h = rng.uniform(0.45, 0.85)
    k.box(m, -hx, hx, -hy, hy, 0.0, 0.05, S['dark'])
    k.cyl(m, (0, 0, 0.04), (0, 0, h), 0.022, S['metal'], n=4)
    for t in (0.45, 0.7):
        w = 0.14 * (1.2 - t)
        k.box(m, -w, w, -0.01, 0.01, h * t - 0.01, h * t + 0.01, S['metal'])
    lk = S['red'] if rng.random() < 0.6 else S['lamp2']
    k.box(m, -0.035, 0.035, -0.035, 0.035, h, h + 0.06, lk)


def g_dish(k, m, hx, hy, rng, S, host):
    r = min(hx, hy) * 0.95
    k.box(m, -0.07, 0.07, -0.07, 0.07, 0.0, 0.12, S['dark'])
    t = Matrix.Translation((0, 0, 0.16)) @ Matrix.Rotation(math.radians(rng.uniform(25, 50)), 4, 'X') \
        @ Matrix.Rotation(math.radians(rng.uniform(0, 360)), 4, 'Z')
    mm = m @ t
    k.lathe(mm, [(-0.03, 0.0), (0.0, r * 0.3), (0.07, r), (0.09, r * 0.96)],
            [S['mid'], S['plate2'], S['accent']], n=10)
    k.lathe(mm, [(0.09, r * 0.96), (0.03, r * 0.5), (0.02, 0.0)], [S['plate2'], S['plate2']], n=10)
    k.cyl(mm, (0, 0, 0.02), (0, 0, r * 0.7), 0.015, S['metal'], n=4)


def g_scorch(k, m, hx, hy, rng, S, host):
    k.decal(m, hx, hy, host, rng, lift=0.005, dirt=rng.uniform(0.6, 0.95))


def g_hole(k, m, hx, hy, rng, S, host):
    """Missing panel (derelict): dark hole with a few exposed ribs."""
    k.box(m, -hx, hx, -hy, hy, 0.0, 0.012, 'char_black')
    for i in range(2):
        x = -hx * 0.5 + i * hx
        k.box(m, x - 0.02, x + 0.02, -hy - 0.03, hy + 0.03, 0.008, 0.04, 'metal_bare')
    k.decal(m, hx * 1.6, hy * 1.6, host, rng, lift=0.004, dirt=0.7)


# wall types (frame: x = horizontal, y = up, z = outward)
def w_window(k, m, hx, hy, rng, S, host):
    k.box(m, -hx, hx, -hy, hy, 0.0, 0.025, S['frame'])
    lit = S['lit'] > 0 and rng.random() < 0.85 * S['lit'] + 0.1
    n = max(1, int(hx / 0.13))
    for i in range(n):
        x0 = -hx + 0.03 + (2 * hx - 0.06) * i / n
        x1 = -hx + 0.03 + (2 * hx - 0.06) * (i + 1) / n
        key = S['window'] if (lit and rng.random() < 0.9) or S['dead'] else S['glass']
        k.box(m, x0 + 0.012, x1 - 0.012, -hy + 0.025, hy - 0.025, 0.015, 0.035, key)
    if rng.random() < 0.5:   # hood over the strip
        k.box(m, -hx - 0.02, hx + 0.02, hy, hy + 0.035, 0.0, 0.07, S['mid'])


def w_door(k, m, hx, hy, rng, S, host):
    k.box(m, -hx, hx, -hy, hy, 0.0, 0.03, S['accent'] if rng.random() < 0.5 else S['mid'])
    k.box(m, -hx + 0.04, hx - 0.04, -hy + 0.04, hy - 0.06, 0.02, 0.045, S['dark'])
    k.box(m, -hx + 0.06, hx - 0.06, -0.01, 0.01, 0.045, 0.06, S['trim'])
    if not S['dead'] or rng.random() < 0.5:
        k.box(m, -0.04, 0.04, hy + 0.02, hy + 0.07, 0.0, 0.05, S['lamp'] if rng.random() < 0.6 else S['green'])


def w_lights(k, m, hx, hy, rng, S, host):
    n = max(2, int(hx / 0.14))
    key = S['window'] if rng.random() < 0.6 else S['lamp']
    for i in range(n):
        x = -hx + (2 * hx) * (i + 0.5) / n
        k.box(m, x - 0.035, x + 0.035, -0.03, 0.03, 0.0, 0.03, key)


def w_pipes(k, m, hx, hy, rng, S, host):
    n = 1 + (hy > 0.1)
    for i in range(n):
        y = -hy + 0.05 + (2 * hy - 0.1) * (i + 0.5) / n
        k.cyl(m, (-hx, y, 0.075), (hx, y, 0.075), 0.04, (S['metal'], S['mid'], S['accent'])[rng.randrange(3)], n=6)
    nb = max(2, int(hx / 0.4) + 1)
    for i in range(nb):
        x = -hx + 0.05 + (2 * hx - 0.1) * i / (nb - 1)
        k.box(m, x - 0.025, x + 0.025, -hy, hy, 0.0, 0.1, S['dark'])


def w_unit(k, m, hx, hy, rng, S, host):
    k.box(m, -hx, hx, -hy, hy, 0.0, rng.uniform(0.06, 0.14), S['dark'] if rng.random() < 0.5 else S['mid'],
          top=S['plate'])
    if rng.random() < 0.5 and not S['dead']:
        k.box(m, -hx + 0.03, -hx + 0.08, hy - 0.08, hy - 0.03, 0.1, 0.16, S['tech'] if rng.random() < 0.5 else S['lamp'])


def w_streak(k, m, hx, hy, rng, S, host):
    k.decal(m @ Matrix.Translation((0, -hy * 0.4, 0)), hx, hy, host, rng, lift=0.004, dirt=rng.uniform(0.45, 0.75))


#            name        builder     class   weight   hx          hy          height
TYPES = [
    ('panel', g_panel, 'top', 3.0, (0.22, 0.55), (0.18, 0.42), 0.06),
    ('vent', g_vent, 'top', 1.6, (0.14, 0.32), (0.1, 0.22), 0.07),
    ('grille', g_grille, 'top', 1.2, (0.16, 0.3), (0.14, 0.24), 0.1),
    ('hatch', g_hatch, 'top', 1.0, (0.18, 0.3), (0.18, 0.3), 0.08),
    ('unit', g_unit, 'top', 1.6, (0.12, 0.28), (0.1, 0.24), 0.36),
    ('pipes', g_pipes, 'top', 1.0, (0.35, 0.85), (0.06, 0.15), 0.2),
    ('cables', g_cables, 'top', 0.5, (0.3, 0.7), (0.05, 0.08), 0.08),
    ('lights', g_lights, 'top', 0.9, (0.14, 0.4), (0.04, 0.04), 0.05),
    ('skylight', g_skylight, 'top', 0.8, (0.18, 0.42), (0.09, 0.18), 0.05),
    ('rack', g_rack, 'top', 0.7, (0.28, 0.5), (0.16, 0.32), 0.45),
    ('radiator', g_radiator, 'top', 0.6, (0.18, 0.38), (0.16, 0.32), 0.28),
    ('truss', g_truss, 'top', 0.45, (0.35, 0.8), (0.09, 0.15), 0.12),
    ('tank', g_tank, 'top', 0.45, (0.2, 0.36), (0.1, 0.16), 0.4),
    ('antenna', g_antenna, 'top', 0.22, (0.07, 0.09), (0.07, 0.09), 0.95),
    ('dish', g_dish, 'top', 0.2, (0.2, 0.3), (0.2, 0.3), 0.5),
    ('scorch', g_scorch, 'top', 0.6, (0.3, 0.7), (0.25, 0.55), 0.02),
    ('patch', g_patch, 'top', 0.0, (0.2, 0.45), (0.16, 0.35), 0.07),
    ('hole', g_hole, 'top', 0.0, (0.18, 0.4), (0.14, 0.3), 0.05),
    ('window', w_window, 'side', 3.0, (0.2, 0.7), (0.06, 0.11), 0.08),
    ('wvent', g_vent, 'side', 1.2, (0.12, 0.28), (0.08, 0.16), 0.07),
    ('wpanel', g_panel, 'side', 1.6, (0.2, 0.45), (0.12, 0.3), 0.06),
    ('door', w_door, 'side', 0.5, (0.14, 0.2), (0.2, 0.28), 0.07),
    ('wpipes', w_pipes, 'side', 0.8, (0.35, 0.8), (0.07, 0.14), 0.13),
    ('wlights', w_lights, 'side', 1.0, (0.14, 0.4), (0.04, 0.04), 0.04),
    ('wunit', w_unit, 'side', 0.7, (0.1, 0.22), (0.08, 0.18), 0.17),
    ('wcables', g_cables, 'side', 0.4, (0.3, 0.7), (0.05, 0.08), 0.08),
    ('streak', w_streak, 'side', 0.4, (0.15, 0.3), (0.3, 0.6), 0.02),
    ('wpatch', g_patch, 'side', 0.0, (0.16, 0.35), (0.12, 0.28), 0.07),
    ('whole', g_hole, 'side', 0.0, (0.14, 0.3), (0.12, 0.24), 0.05),
]
TYPE = {t[0]: t for t in TYPES}
# style weight keys also apply to the wall variant ('window' -> window, 'patch' -> wpatch ...)
_WALL_ALIAS = {'wvent': 'vent', 'wpanel': 'panel', 'wpipes': 'pipes', 'wlights': 'lights', 'wunit': 'unit',
               'wcables': 'cables', 'wpatch': 'patch', 'whole': 'hole', 'streak': 'scorch'}


def _weights(S, cls, only=None, extra=None):
    out = []
    for name, fn, c, w, hxr, hyr, h in TYPES:
        if c != cls:
            continue
        key = _WALL_ALIAS.get(name, name)
        if only is not None and key not in only and name not in only:
            continue
        if w == 0 and (key in S['weights'] or (extra and key in extra)):
            w = 1.0        # opt-in types (patch, hole) are enabled by a style/extra weight
        w = w * S['weights'].get(key, 1.0)
        if extra:
            w *= extra.get(key, 1.0)
        if w > 0:
            out.append((name, w))
    return out


def _pick(rng, wl):
    tot = sum(w for _, w in wl)
    x = rng.random() * tot
    for n, w in wl:
        x -= w
        if x <= 0:
            return n
    return wl[-1][0]


# ----------------------------------------------------------------------------
# zones (clear areas) - world/object space of the host
# ----------------------------------------------------------------------------
class Zones:
    def __init__(self):
        self.items = []

    def cyl(self, x, y, r, z0=-1e9, z1=1e9):
        self.items.append(('c', x, y, r, z0, z1))
        return self

    def annulus(self, r0, r1, z0, z1, cx=0.0, cy=0.0):
        self.items.append(('a', cx, cy, r0, r1, z0, z1))
        return self

    def box(self, x0, x1, y0, y1, z0=-1e9, z1=1e9):
        self.items.append(('b', x0, x1, y0, y1, z0, z1))
        return self

    def functional(self, x0, x1, y0, y1, z, up=9.0):
        """Functional surface (walkway / cradle floor / build floor) at height z:
        keep everything above it clear."""
        return self.box(x0, x1, y0, y1, z - 0.05, z + up)

    def pad(self, x, y, r, z, up=9.0):
        """Round landing / drone pad (incl. its guide ring) at height z."""
        return self.cyl(x, y, r, z - 0.05, z + up)

    def blocked(self, pts):
        for it in self.items:
            for p in pts:
                if it[0] == 'c':
                    _, x, y, r, z0, z1 = it
                    if z0 <= p.z <= z1 and (p.x - x) ** 2 + (p.y - y) ** 2 < r * r:
                        return True
                elif it[0] == 'a':
                    _, cx, cy, r0, r1, z0, z1 = it
                    if z0 <= p.z <= z1 and r0 * r0 < (p.x - cx) ** 2 + (p.y - cy) ** 2 < r1 * r1:
                        return True
                else:
                    _, x0, x1, y0, y1, z0, z1 = it
                    if x0 <= p.x <= x1 and y0 <= p.y <= y1 and z0 <= p.z <= z1:
                        return True
        return False


# ----------------------------------------------------------------------------
# scatter
# ----------------------------------------------------------------------------
def bvh_of(objs):
    """BVH over several mesh objects (their world transforms applied)."""
    verts, polys = [], []
    for o in objs:
        if o is None or o.type != 'MESH':
            continue
        mw = o.matrix_world
        base = len(verts)
        verts += [mw @ v.co for v in o.data.vertices]
        polys += [[base + i for i in p.vertices] for p in o.data.polygons]
    return BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)


class _Hash:
    def __init__(self, cell=1.0):
        self.cell = cell
        self.d = {}

    def _k(self, p):
        c = self.cell
        return (int(math.floor(p.x / c)), int(math.floor(p.y / c)), int(math.floor(p.z / c)))

    def free(self, p, r):
        kx, ky, kz = self._k(p)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for q, rq in self.d.get((kx + dx, ky + dy, kz + dz), ()):
                        if (p - q).length < r + rq:
                            return False
        return True

    def add(self, p, r):
        self.d.setdefault(self._k(p), []).append((p.copy(), r))


def _poly_key(ob, poly):
    """Palette key of a face: the logical PAL_ material, or - for faces that
    are already baked to the AF_Palette atlas - the swatch under its UV."""
    sl = ob.material_slots[poly.material_index] if poly.material_index < len(ob.material_slots) else None
    m = sl.material if sl else None
    if m is None:
        return None
    k = m.get('palette_key')
    if k is not None:
        return k
    if m.name.startswith(M.ATLAS_MAT) and ob.data.uv_layers:
        u, v = ob.data.uv_layers[0].data[poly.loop_start].uv
        idx = int(v * P.ROWS) * P.COLS + int(u * P.COLS)
        if 0 <= idx < len(P.SWATCHES):
            return P.SWATCHES[idx].key
    return None


def _sample_in_poly(rng, co):
    """Area-weighted random point inside a (convex-ish) polygon via a fan."""
    tris = []
    tot = 0.0
    for i in range(1, len(co) - 1):
        a = ((co[i] - co[0]).cross(co[i + 1] - co[0])).length * 0.5
        tris.append((a, co[0], co[i], co[i + 1]))
        tot += a
    x = rng.random() * tot
    for a, p0, p1, p2 in tris:
        x -= a
        if x <= 0:
            break
    r1, r2 = rng.random(), rng.random()
    if r1 + r2 > 1:
        r1, r2 = 1 - r1, 1 - r2
    return p0 + (p1 - p0) * r1 + (p2 - p0) * r2


class Scatter:
    """Stateful scatter over one or more hosts (shared overlap hash, kit and
    zones) so several passes (static, rotor, hand-placed areas) never collide."""

    def __init__(self, rng, style='home', zones=None, kit=None):
        self.rng = rng
        self.S = STYLES[style] if isinstance(style, str) else style
        self.zones = zones or Zones()
        self.kit = kit or Kit()
        self.hash = _Hash(1.0)
        self.count = {}

    def reserve(self, p, r):
        """Mark an area as taken (hand-placed details)."""
        self.hash.add(Vector(p), r)

    def place(self, name, m, hx, hy, host='hull_light'):
        """Build greeble `name` in frame m without checks (hand placement)."""
        TYPE[name][1](self.kit, m, hx, hy, self.rng, self.S, host)
        self.count[name] = self.count.get(name, 0) + 1

    def run(self, host, bvh=None, density=1.0, top=1.0, side=1.0, center=(0.0, 0.0), only=None, extra=None,
            min_area=0.12, z_min=-1e9, z_max=1e9, row=0.42, keys=None, region=None, max_size=1.0, gap=0.05,
            align='radial'):
        """Dress the faces of `host` (mesh with logical materials, identity
        transform).  density scales the per-class rates (TOP_RATE / SIDE_RATE
        greebles per unit^2).  region: optional fn(p) -> bool to limit areas.
        align: 'radial' (u tangential around `center`) or 'axis' (u = world X/Y
        whichever is closer to the face's long edge)."""
        rng, S, kit = self.rng, self.S, self.kit
        bvh = bvh or bvh_of([host])
        me = host.data
        hosts = set(keys or S['hosts'])
        wt = {'top': _weights(S, 'top', only, extra), 'side': _weights(S, 'side', only, extra)}
        rates = {'top': TOP_RATE * density * top, 'side': SIDE_RATE * density * side}
        cx, cy = center
        placed = 0
        # small emissive faces = guide lights / chevrons / runway lamps: keep a clear margin around them
        glow = _Hash(1.0)
        for poly in me.polygons:
            if poly.area < 0.6 and _poly_key(host, poly) in EMISSIVE and poly.normal.z > 0.5:
                glow.add(poly.center.copy(), 0.0)
        self.glow = glow
        for poly in me.polygons:
            key = _poly_key(host, poly)
            if key not in hosts:
                continue
            n = poly.normal.copy()
            if n.z > 0.45:
                cls = 'top'
            elif abs(n.z) < 0.4:
                cls = 'side'
            else:
                continue
            if not wt[cls] or rates[cls] <= 0:
                continue
            area = poly.area
            if area < min_area:
                continue
            exp = area * rates[cls]
            cnt = int(exp) + (rng.random() < exp - int(exp))
            if not cnt:
                continue
            co = [me.vertices[i].co.copy() for i in poly.vertices]
            # longest edge direction (for 'axis' alignment and walls)
            edge = max(((co[(i + 1) % len(co)] - co[i]) for i in range(len(co))), key=lambda e: e.length)
            tries = cnt * 5 + 2          # extra tries: many samples land under other geometry
            while cnt > 0 and tries > 0:
                tries -= 1
                p = _sample_in_poly(rng, co)
                if not (z_min <= p.z <= z_max) or (region and not region(p)):
                    continue
                name = _pick(rng, wt[cls])
                _, fn, _, _, hxr, hyr, h = TYPE[name]
                hx = min(rng.uniform(*hxr), max_size)
                hy = min(rng.uniform(*hyr), max_size)
                if cls == 'top':
                    if align == 'radial':
                        t = Vector((-(p.y - cy), p.x - cx, 0.0))
                        if t.length < 0.3:
                            t = Vector((1, 0, 0))
                    else:
                        t = edge.copy()
                    if rng.random() < 0.35 and name not in ('lights', 'pipes', 'truss', 'cables'):
                        t = n.cross(t)
                    m = frame(p, n, t)
                else:
                    if row and name in ('window', 'wlights', 'wpipes'):
                        # snap rows so window strips on one wall line up
                        dz = round(p.z / row) * row - p.z
                        v = n.cross(Vector((0, 0, 1)).cross(n))
                        if abs(v.z) > 0.3:
                            p = p + v * (dz / v.z)
                    m = frame(p, n, Vector((0, 0, 1)).cross(n))
                if cls == 'top' and not glow.free(m.translation, math.hypot(hx, hy) + 0.3):
                    continue
                if not self._fits(m, hx, hy, h, bvh, gap, poly_n=n):
                    continue
                cnt -= 1
                fn(kit, m, hx, hy, rng, S, key)
                self.count[name] = self.count.get(name, 0) + 1
                placed += 1
        return placed

    def _fits(self, m, hx, hy, h, bvh, gap, poly_n):
        p = m.translation
        r = math.hypot(hx, hy) + gap
        if not self.hash.free(p, r):
            return False
        lift = h + 0.06
        pts = [(0, 0), (-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]
        wpts = []
        nrm = Vector((m[0][2], m[1][2], m[2][2]))
        for x, y in pts:
            q = m @ Vector((x * 0.97, y * 0.97, 0.0))
            wpts.append(q)
            wpts.append(q + nrm * h)
            hit = bvh.ray_cast(q + nrm * lift, -nrm, lift + 0.08)
            if hit[0] is None or abs(hit[3] - lift) > 0.04:
                return False
            if hit[1].dot(nrm) < 0.95:     # sits across a bend
                return False
        if self.zones.blocked(wpts):
            return False
        self.hash.add(p, r)
        return True


TOP_RATE = 1.8     # greebles per unit^2 on upward faces at density 1
SIDE_RATE = 1.6     # on walls


# ----------------------------------------------------------------------------
# structured helpers (hand-placed rhythm on top of the random scatter)
# ----------------------------------------------------------------------------
def panel_grid(kit, host, rng, S, cell=1.1, keys=None, bvh=None, zones=None, z_min=-1e9, z_max=1e9,
               center=(0.0, 0.0), min_area=1.2, h=0.03, inset=0.05, prob=0.85, hash_=None, region=None,
               seam='panel_line'):
    """Panel insets: large top faces get a grid of slightly raised chamfered
    plates (shades vary) - the gaps read as panel seams (a thin dark
    `seam` underlay shows through them, like the dark seams between ship
    parts).  Grid aligned to the face's longest edge.  Returns the number of plates."""
    me = host.data
    hosts = set(keys or S['hosts'])
    bvh = bvh or bvh_of([host])
    out = 0
    for poly in me.polygons:
        key = _poly_key(host, poly)
        if key not in hosts or poly.normal.z < 0.9 or poly.area < min_area:
            continue
        co = [me.vertices[i].co.copy() for i in poly.vertices]
        if not (z_min <= co[0].z <= z_max):
            continue
        n = poly.normal.copy()
        edge = max(((co[(i + 1) % len(co)] - co[i]) for i in range(len(co))), key=lambda e: e.length)
        m0 = frame(co[0], n, edge)
        inv = m0.inverted()
        loc = [inv @ c for c in co]
        xs = [c.x for c in loc]
        ys = [c.y for c in loc]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        nx = max(1, round((x1 - x0) / cell))
        ny = max(1, round((y1 - y0) / cell))
        gx, gy = (x1 - x0) / nx, (y1 - y0) / ny
        for i in range(nx):
            for j in range(ny):
                if rng.random() > prob:
                    continue
                # merge some cells into double panels
                wx = 2 if (i + 1 < nx and rng.random() < 0.25) else 1
                cxl = x0 + (i + wx / 2) * gx
                cyl = y0 + (j + 0.5) * gy
                hx = wx * gx / 2 - inset
                hy = gy / 2 - inset
                if hx < 0.15 or hy < 0.15:
                    continue
                c = m0 @ Vector((cxl, cyl, 0.0))
                if region and not region(c):
                    continue
                m = frame(c, n, edge)
                ok = True
                for sx, sy in ((0, 0), (-1, -1), (1, -1), (1, 1), (-1, 1)):
                    q = m @ Vector((sx * hx, sy * hy, 0.0))
                    hit = bvh.ray_cast(q + n * 0.2, -n, 0.3)
                    if hit[0] is None or abs(hit[3] - 0.2) > 0.02:
                        ok = False
                        break
                if not ok or (zones and zones.blocked([m @ Vector((sx * hx, sy * hy, h)) for sx in (-1, 1)
                                                         for sy in (-1, 1)])):
                    continue
                sh = _shade(S, key, rng)
                if seam:
                    e = inset * 0.85
                    kit.box(m, -hx - e, hx + e, -hy - e, hy + e, 0.0, 0.012, seam)
                kit.plate(m, hx, hy, 0.0, h, sh, c=min(hx, hy) * 0.18)
                out += 1
    return out


def wall_rows(kit, host, rng, S, rows, keys=None, bvh=None, zones=None, min_w=0.6, kinds=('window',),
              lit=None, region=None, hx_max=0.9):
    """Continuous window/light bands on vertical faces at given world heights
    `rows` [(z, half_height)] - the 'inhabited' rhythm (gaps for ribs)."""
    me = host.data
    hosts = set(keys or S['hosts'])
    bvh = bvh or bvh_of([host])
    out = 0
    for poly in me.polygons:
        key = _poly_key(host, poly)
        if key not in hosts or abs(poly.normal.z) > 0.25:
            continue
        co = [me.vertices[i].co.copy() for i in poly.vertices]
        zlo, zhi = min(c.z for c in co), max(c.z for c in co)
        n = poly.normal.copy()
        u = Vector((0, 0, 1)).cross(n).normalized()
        us = [c.dot(u) for c in co]
        u0, u1 = min(us), max(us)
        if u1 - u0 < min_w:
            continue
        cen = sum(co, Vector()) / len(co)
        for z, hh in rows:
            if z - hh < zlo + 0.05 or z + hh > zhi - 0.05:
                continue
            w = (u1 - u0) - 0.25
            nseg = max(1, math.ceil(w / (2 * hx_max)))
            for s in range(nseg):
                hx = w / nseg / 2 - 0.05
                uc = u0 + 0.125 + (s + 0.5) * w / nseg
                p = cen + u * (uc - cen.dot(u))
                p.z = z
                # project onto the face plane
                p = p - n * (p - co[0]).dot(n)
                if region and not region(p):
                    continue
                m = frame(p, n, u)
                ok = True
                for sx in (-1, 0, 1):
                    q = m @ Vector((sx * hx, 0, 0))
                    hit = bvh.ray_cast(q + n * 0.15, -n, 0.3)
                    if hit[0] is None or abs(hit[3] - 0.15) > 0.03:
                        ok = False
                        break
                if not ok or (zones and zones.blocked([m @ Vector((sx * hx, 0, 0.08)) for sx in (-1, 1)])):
                    continue
                kind = kinds[rng.randrange(len(kinds))]
                TYPE[kind][1](kit, m, hx, hh, rng, S, key)
                out += 1
    return out


# ----------------------------------------------------------------------------
# weathering: AO + grime -> COLOR_0 ('Col', BYTE_COLOR, CORNER)
# ----------------------------------------------------------------------------
_DIRS = None


def _hemi(nr=14):
    global _DIRS
    if _DIRS is None or len(_DIRS) != nr:
        out = []
        ga = math.pi * (3 - math.sqrt(5))
        for i in range(nr):
            z = 1 - (i + 0.5) / nr          # cosine-ish distribution on the hemisphere
            z = math.sqrt(z)
            r = math.sqrt(max(0.0, 1 - z * z))
            out.append(Vector((r * math.cos(ga * i), r * math.sin(ga * i), z)))
        _DIRS = out
    return _DIRS


def weather(ob, rng, extra=(), ao=0.62, ao_near=0.45, near=0.45, far=2.6, grime=0.35, panel=0.06, under=0.2,
            soot=0.55, rust=0.0, scale=1.0, floor=0.3, existing=False):
    """Write COLOR_0 on `ob` (logical materials still assigned): ray-cast AO
    against ob + `extra` objects, per-face panel fade, grime blotches, darker
    undersides, soot from the 'af_dirt' point attribute.  Emissive faces stay
    bright.  existing=True multiplies into an existing 'Col' attribute."""
    me = ob.data
    bvh = bvh_of([ob] + list(extra))
    dirs = _hemi()
    dattr = me.attributes.get(DIRT)
    dv = [d.value for d in dattr.data] if dattr is not None and dattr.domain == 'POINT' else None
    attr = me.color_attributes.get('Col') if existing else None
    old = None
    if attr is not None:
        old = [tuple(d.color) for d in attr.data]
    else:
        attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    o = Vector((rng.uniform(-50, 50), rng.uniform(-50, 50), rng.uniform(-50, 50)))
    cache = {}
    verts = me.vertices
    loops = me.loops
    for poly in me.polygons:
        key = _poly_key(ob, poly)
        emissive = key in EMISSIVE
        n = poly.normal
        nk = (round(n.x * 6), round(n.y * 6), round(n.z * 6))
        fj = 1.0 - rng.uniform(0.0, panel)
        if n.z < -0.5:
            fj *= 1.0 - under
        # tangent frame for the hemisphere
        t1 = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized()
        t2 = n.cross(t1)
        for li in poly.loop_indices:
            vi = loops[li].vertex_index
            if emissive:
                k = 1.0
            else:
                ck = (vi, nk)
                a = cache.get(ck)
                if a is None:
                    p = verts[vi].co + n * 0.012
                    # pull slightly toward the face centre so rays don't graze edges
                    p = p + (poly.center - verts[vi].co) * 0.04
                    occ_n = occ_f = 0.0
                    for d in dirs:
                        w = t1 * d.x + t2 * d.y + n * d.z
                        hit = bvh.ray_cast(p, w, far)
                        if hit[0] is not None:
                            occ_f += 1.0
                            if hit[3] < near:
                                occ_n += 1.0
                    a = 1.0 - ao * (occ_f / len(dirs)) * 0.55 - ao_near * (occ_n / len(dirs))
                    cache[ck] = a
                k = a * fj
                pco = verts[vi].co
                if grime:
                    g = noise.fractal(pco * (0.45 / scale) + o, 0.6, 2.0, 3)
                    blot = max(0.0, min(1.0, (g + 0.15) * 1.4))
                    k *= 1.0 - grime * 0.35 * blot
                if dv is not None and dv[vi] > 0:
                    k *= 1.0 - soot * dv[vi]
                k = max(floor, min(1.0, k))
            r_ = g_ = b_ = k
            if rust and not emissive:
                rr = max(0.0, min(1.0, (noise.noise(verts[vi].co * (0.8 / scale) - o) - 0.1) * 2.2)) * rust
                g_ *= 1.0 - 0.18 * rr
                b_ *= 1.0 - 0.3 * rr
            if old is not None:
                oc = old[li]
                r_, g_, b_ = r_ * oc[0], g_ * oc[1], b_ * oc[2]
            attr.data[li].color = (r_, g_, b_, 1.0)
    me.color_attributes.active_color = attr
    if dattr is not None:
        me.attributes.remove(me.attributes.get(DIRT))
    return ob


def strip_dirt(ob):
    a = ob.data.attributes.get(DIRT)
    if a is not None:
        ob.data.attributes.remove(a)


def ensure_col(ob, value=1.0):
    """Plain white COLOR_0 (beacons / small nodes that need no weathering), so
    every primitive of a weathered asset has the same attribute set."""
    me = ob.data
    if me.color_attributes.get('Col') is None:
        a = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
        for d in a.data:
            d.color = (value, value, value, 1.0)
        me.color_attributes.active_color = a
    return ob
