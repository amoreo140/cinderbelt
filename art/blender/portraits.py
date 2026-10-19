"""Comms speaker portraits (comms system design, section 3).

Stylised helmeted busts (no faces) per role / faction, rendered in Cycles on a
transparent film, then packed by `portraits_pack.py` (plain Python + Pillow):
comm-screen background, 128 px + 256 px WebP, manifest, contact sheet.

  blender --background --factory-startup --python art/blender/portraits.py -- [--only id1,id2] [--samples 48] [--no-pack]

Masters (RGBA PNG, 512 px) go to art/out/portraits/<id>.png together with
meta.json; the pack step writes public/assets/ui/portraits/ and
art/out/previews/portraits.png.

Conventions:
  * the bust faces -Y, head centre H = (0, 0, HEAD_Z); the whole figure is
    turned YAW degrees for a 3/4 view, the camera sits on -Y slightly above.
  * friendly speakers: hull-white suits, dark glass visors with a faint tint,
    trims in the faction colour.  Hostile speakers: gunmetal / rust scrap
    armour, emissive slit visors.  The rim lights carry the faction colour.
"""
import json
import math
import os
import random
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import paths  # noqa: E402
from lib import render as R  # noqa: E402

MASTERS = os.path.join(paths.OUT, 'portraits')
RES = 512
HEAD_Z = 0.44
YAW = 30.0

# ---------------------------------------------------------------------------
# colours (tokens.css / emblems.py)
# ---------------------------------------------------------------------------
TRIM, GLOW, OK, WARN, BAD = '#f27a2c', '#62d9f4', '#6be38a', '#ffb547', '#ff5a4a'
TITAN, FUEL, HULL, BAND = '#4aa8ea', '#f4c64e', '#d9dee6', '#1b222d'
RUST, EMBER, VIOLET, OBSIDIAN = '#9c2a1c', '#ff6a2a', '#8f7dff', '#17151d'
DIM = '#93a0b3'
WATCH = '#86a8ff'   # Guild Watch voice: strobe blue (between --af-titan and the strobe emit #9ccbff)
DERELICT = '#c39a5a'  # derelict station automaton: desaturated amber
GUNNER = '#ff6a2a'    # pirate Gunner: hot orange (--af-ember), hotter than the Hammer's amber


def lin(hexcol):
    h = hexcol.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------
_MATS = {}


def mat(name, color, rough=0.5, metal=0.0, emit=None, emit_strength=0.0, coat=0.0):
    key = (name, color, rough, metal, emit, emit_strength, coat)
    if key in _MATS:
        return _MATS[key]
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    p = nt.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*lin(color), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if coat:
        p.inputs['Coat Weight'].default_value = coat
        p.inputs['Coat Roughness'].default_value = 0.05
    if emit:
        p.inputs['Emission Color'].default_value = (*lin(emit), 1)
        p.inputs['Emission Strength'].default_value = emit_strength
    _MATS[key] = m
    return m


def grime(name, color, dirt='#1d1916', scale=7.0, lo=0.42, hi=0.66, rough=0.72, metal=0.15, detail=8.0):
    """Weathered paint: a noise texture (object = world coords, meshes are baked) mixes the
    base colour with dust / soot patches."""
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    p = nt.nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = scale
    nz.inputs['Detail'].default_value = detail
    nz.inputs['Roughness'].default_value = 0.62
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    e0, e1 = ramp.color_ramp.elements
    e0.position, e0.color = lo, (*lin(dirt), 1)
    e1.position, e1.color = hi, (*lin(color), 1)
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
    return m


class Pal:
    """Material set for one bust."""

    def __init__(self, accent, hostile=False, plate=HULL, suit='#2b323d', visor_glow=None, helmet=None,
                 metal='#4a4f57', rust='#6e3420', glow_strength=4.5):
        self.accent = accent
        self.hostile = hostile
        self.plate = mat('plate', plate, 0.42)
        self.helmet = mat('helmet', helmet or plate, 0.38, coat=0.3) if not hostile else \
            mat('helmet_h', helmet or metal, 0.5, 0.55)
        self.suit = mat('suit', suit, 0.85)
        self.band = mat('band', BAND, 0.6)
        self.trim = mat('trim', accent, 0.4)
        self.trim_glow = mat('trim_glow', accent, 0.4, emit=accent, emit_strength=6.0)
        self.metal = mat('metal', metal, 0.48, 0.6)
        self.metal_dark = mat('metal_dark', '#2a2c31', 0.55, 0.5)
        self.rust = mat('rust', rust, 0.85, 0.1)
        self.bone = mat('bone', '#cfc4ad', 0.6)
        self.black = mat('black', '#0b0d10', 0.5)
        self.yellow = mat('hazard_y', FUEL, 0.45)
        g = visor_glow or accent
        if hostile:
            self.visor = mat('visor_h', '#050506', 0.2, emit=g, emit_strength=glow_strength)
            self.glass = mat('glass_h', '#0b0b0d', 0.12, coat=1.0)
        else:
            self.visor = mat('visor', '#06101a', 0.08, emit=g, emit_strength=0.55, coat=1.0)
            self.glass = self.visor
        self.lamp = mat('lamp', g, 0.3, emit=g, emit_strength=8.0)


# ---------------------------------------------------------------------------
# geometry helpers (all in world space, figure facing -Y)
# ---------------------------------------------------------------------------
def _link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _bake(ob):
    ob.data.transform(ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    return ob


def _new_obj(name, bm, m, smooth):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(m)
    return _link(ob)


def sphere(name, loc, scale, m, seg=40, rings=20, smooth=True, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    ob = _new_obj(name, bm, m, smooth)
    ob.matrix_world = Matrix.LocRotScale(Vector(loc), _eul(rot), Vector(scale))
    return _bake(ob)


def box(name, loc, size, m, rot=(0, 0, 0), bevel=0.02, seg=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    ob = _new_obj(name, bm, m, False)
    ob.matrix_world = Matrix.LocRotScale(Vector(loc), _eul(rot), Vector(size))
    _bake(ob)
    if bevel:
        bv = ob.modifiers.new('bv', 'BEVEL')
        bv.width = bevel
        bv.segments = seg
        bv.limit_method = 'ANGLE'
    return ob


def cyl(name, loc, r, depth, m, rot=(0, 0, 0), verts=24, r2=None, smooth=True, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r,
                          radius2=r if r2 is None else r2, depth=depth)
    ob = _new_obj(name, bm, m, smooth)
    if smooth:
        ob.data.set_sharp_from_angle(angle=math.radians(40))
    ob.matrix_world = Matrix.LocRotScale(Vector(loc), _eul(rot), Vector(scale))
    return _bake(ob)


def torus(name, loc, R_, r, m, rot=(0, 0, 0), maj=48, mnr=12, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R_, minor_radius=r, major_segments=maj, minor_segments=mnr)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.clear()
    ob.data.materials.append(m)
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.matrix_world = Matrix.LocRotScale(Vector(loc), _eul(rot), Vector(scale))
    return _bake(ob)


def rod(name, p0, p1, r, m, verts=12, r2=None):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    q = d.to_track_quat('Z', 'Y')
    ob = cyl(name, (0, 0, 0), r, d.length, m, verts=verts, r2=r2)
    ob.data.transform(Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4())
    return ob


def cone_at(name, base, tip, r, m, verts=8, smooth=False):
    """Cone from a base point (radius r) to a tip point."""
    base, tip = Vector(base), Vector(tip)
    d = tip - base
    q = d.to_track_quat('Z', 'Y')
    ob = cyl(name, (0, 0, 0), r, d.length, m, verts=verts, r2=0.0, smooth=smooth)
    ob.data.transform(Matrix.Translation((base + tip) / 2) @ q.to_matrix().to_4x4())
    return ob


def prism(name, pts, y0, y1, m, bevel=0.0):
    """Extrude a polygon given in the XZ plane between y0 and y1 (a flat plate)."""
    bm = bmesh.new()
    vs0 = [bm.verts.new((x, y0, z)) for x, z in pts]
    vs1 = [bm.verts.new((x, y1, z)) for x, z in pts]
    n = len(pts)
    bm.faces.new(vs0[::-1])
    bm.faces.new(vs1)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((vs0[i], vs0[j], vs1[j], vs1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _new_obj(name, bm, m, False)
    if bevel:
        bv = ob.modifiers.new('bv', 'BEVEL')
        bv.width = bevel
        bv.segments = 2
    return ob


def cut(ob, planes):
    """planes: [(co, no)] - removes the part on the +normal side of each plane."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for co, no in planes:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector(co), plane_no=Vector(no).normalized(),
                               clear_outer=True)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def solidify(ob, t=0.015):
    s = ob.modifiers.new('sol', 'SOLIDIFY')
    s.thickness = t
    s.offset = 1.0
    return ob


def mirror_x(fn, *a, **kw):
    """Call fn(side) for side in (-1, 1)."""
    return [fn(s, *a, **kw) for s in (-1, 1)]


def _eul(rot):
    from mathutils import Euler
    return Euler([math.radians(a) for a in rot]).to_quaternion()


H = Vector((0, 0, HEAD_Z))


def hz(dz=0.0):
    return HEAD_Z + dz


# ---------------------------------------------------------------------------
# body parts
# ---------------------------------------------------------------------------
def torso(P, width=1.0, bulk=1.0, collar=True, collar_mat=None, cuirass=None, stripe=None):
    """Shoulders + chest. cuirass: material of the front armour shell (None = P.plate),
    False = bare suit. stripe: chest trim stripe material (None = P.trim, False = none)."""
    sc = (1.05 * width, 0.58 * bulk, 0.66)
    c = (0, 0.05, -0.66)
    sphere('torso', c, sc, P.suit)
    if cuirass is not False:
        ob = sphere('cuirass', c, (sc[0] * 1.03, sc[1] * 1.06, sc[2] * 1.04), cuirass or P.plate)
        cut(ob, [((0, -0.12, 0), (0, 1, 0)), ((0.7 * width, 0, 0), (1, 0, 0)), ((-0.7 * width, 0, 0), (-1, 0, 0))])
        solidify(ob, 0.02)
        if stripe is not False:
            st = sphere('stripe', c, (sc[0] * 1.045, sc[1] * 1.085, sc[2] * 1.06), stripe or P.trim)
            cut(st, [((0, -0.12, 0), (0, 1, 0)), ((0, 0, -0.27), (0, 0, 1)), ((0, 0, -0.34), (0, 0, -1)),
                     ((0.5 * width, 0, 0), (1, 0, 0)), ((-0.5 * width, 0, 0), (-1, 0, 0))])
            solidify(st, 0.012)
    if collar:
        cyl('neck', (0, 0, 0.02), 0.25, 0.3, P.band, verts=32)
        torus('collar', (0, 0, -0.03), 0.3, 0.07, collar_mat or P.trim)


def pads(P, kind='plate', left=None, right=None, size=1.0, tilt=24):
    """Shoulder pads. kind: plate (chamfered hull plate + trim edge), dome."""
    def one(side, k, sz, m_main, m_edge):
        x = side * 0.82 * sz ** 0.3
        rot = (0, side * tilt, 0)
        if k == 'plate':
            box('pad', (x, 0.02, -0.2), (0.46 * sz, 0.62 * sz, 0.2 * sz), m_main, rot=rot, bevel=0.07, seg=3)
            box('pad_edge', (x + side * 0.02, -0.29 * sz, -0.18), (0.46 * sz, 0.05, 0.12 * sz), m_edge, rot=rot,
                bevel=0.015)
        elif k == 'dome':
            ob = sphere('pad', (x, 0.03, -0.24), (0.36 * sz, 0.38 * sz, 0.26 * sz), m_main, rot=rot)
            cut(ob, [((0, 0, -0.36), (0, 0, -1))])
            torus('pad_rim', (x, 0.03, -0.3), 0.36 * sz, 0.035, m_edge, rot=rot)
        elif k == 'scrap':
            ob = sphere('pad', (x, 0.03, -0.22), (0.44 * sz, 0.44 * sz, 0.3 * sz), m_main, seg=7, rings=5,
                        smooth=False, rot=(8, side * tilt, 15 * side))
            cut(ob, [((0, 0, -0.36), (0, 0, -1))])
            box('pad_strap', (x, 0.03, -0.12), (0.08, 0.66 * sz, 0.32 * sz), m_edge, rot=rot, bevel=0.01)
        elif k == 'none':
            pass
    lk = left or (kind, size, P.plate, P.trim)
    rk = right or (kind, size, P.plate, P.trim)
    one(-1, *lk)
    one(1, *rk)


def helmet(P, shape='round', m=None, scale=(0.9, 1.0, 1.0), r=0.47):
    m = m or P.helmet
    if shape == 'round':
        return sphere('helmet', H, (r * scale[0], r * scale[1], r * scale[2]), m)
    if shape == 'facet':
        return sphere('helmet', H, (r * scale[0], r * scale[1], r * scale[2]), m, seg=9, rings=7, smooth=False)
    if shape == 'box':
        return box('helmet', (0, 0, hz(0.02)), (0.86 * scale[0], 0.9 * scale[1], 0.8 * scale[2]), m, bevel=0.14,
                   seg=3)
    raise ValueError(shape)


def visor(P, kind='full', r=0.47, scale=(0.9, 1.0, 1.0), z0=-0.2, z1=0.16, front=-0.08, m=None, slant=0.0,
          inflate=1.04):
    """Visor shell cut from a slightly larger copy of a round/facet helmet."""
    m = m or P.visor
    sc = (r * scale[0] * inflate, r * scale[1] * inflate, r * scale[2] * inflate)
    ob = sphere('visor', H, sc, m)
    planes = [((0, front, 0), (0, 1, 0)),
              ((0, 0, hz(z1)), (slant, 0, 1)),
              ((0, 0, hz(z0)), (-slant, 0, -1))]
    cut(ob, planes)
    return solidify(ob, 0.012)


def crest(P, m=None, r=0.47, scale=(0.9, 1.0, 1.0), w=0.07, z0=-0.05, y_front=None):
    """Raised ridge over the helmet top, front to back (centre stripe)."""
    m = m or P.trim
    rr = r * 1.02
    ob = torus('crest', H, 1.0, 0.07, m, rot=(0, 90, 0), maj=64, mnr=10,
               scale=(rr * scale[2], rr * scale[1], 1))
    # torus is in the YZ plane after the 90 deg turn: flatten the tube in X to a stripe
    for v in ob.data.vertices:
        v.co.x *= w / 0.07
    planes = [((0, 0, hz(z0)), (0, 0, -1))]
    if y_front is not None:
        planes.append(((0, y_front, 0), (0, -1, 0)))
    return cut(ob, planes)


def headset(P, mic=True, side=-1, cup=0.13, m=None):
    m = m or P.band
    for s in (-1, 1):
        cyl('earcup', (s * 0.44, 0.0, hz(-0.02)), cup, 0.12, m, rot=(0, 90, 0), verts=24)
        cyl('earcap', (s * 0.505, 0.0, hz(-0.02)), cup * 0.62, 0.03, P.trim, rot=(0, 90, 0), verts=24)
    if mic:
        x = side * 0.48
        rod('mic_boom', (x, -0.06, hz(-0.08)), (side * 0.18, -0.46, hz(-0.28)), 0.016, P.band)
        sphere('mic', (side * 0.15, -0.47, hz(-0.29)), (0.045, 0.045, 0.04), P.trim_glow if not P.hostile else P.lamp)


def antenna(P, side=1, h=0.55, lean=0.12, tip=True):
    base = (side * 0.36, 0.12, hz(0.22))
    top = (side * (0.36 + lean), 0.2, hz(0.22 + h))
    cyl('ant_base', base, 0.05, 0.1, P.band, verts=12)
    rod('antenna', base, top, 0.014, P.band)
    if tip:
        sphere('ant_tip', top, (0.035, 0.035, 0.035), P.lamp)


def peak(P, m=None, r=0.47, scale=(0.9, 1.0, 1.0)):
    """Instructor's peaked cap: a trim-colour crown over the helmet top, a dark band and a peak
    jutting out over the visor, a hull-white badge in front."""
    m = m or P.trim
    crown = sphere('cap', H, (r * scale[0] * 1.035, r * scale[1] * 1.035, r * scale[2] * 1.035), m)
    cut(crown, [((0, 0, hz(0.13)), (0, -0.25, -1))])
    ob = cyl('peak', (0, -0.24, hz(0.2)), 0.42, 0.035, P.band, rot=(-14, 0, 0), verts=48, scale=(0.9, 1.0, 1.0))
    cut(ob, [((0, -0.3, 0), (0, 1, 0))])
    pts = [(-0.075, hz(0.42)), (0.075, hz(0.42)), (0.0, hz(0.28))]
    prism('cap_badge', pts, -0.43, -0.37, P.plate)
    return ob


def chevrons(P, side=-1, n=3, size=1.0, tilt=24):
    """Rank chevrons on top of a shoulder pad (same transform as the pad)."""
    Mx = Matrix.Translation((side * 0.82 * size ** 0.3, 0.02, -0.2)) @         Matrix.Rotation(math.radians(side * tilt), 4, 'Y')
    for i in range(n):
        y = -0.18 + i * 0.12
        for s in (-1, 1):
            ob = box('chev', (s * 0.07, y + 0.04, 0.105), (0.17, 0.045, 0.02), P.trim, rot=(0, 0, s * 32), bevel=0.0)
            ob.data.transform(Mx)


def hazard_stripes(P, z=0.0, n=7):
    """Yellow/black chevron band round the helmet (mining)."""
    for i in range(n):
        a = math.radians(-60 + i * (240 / (n - 1)))
        x, y = 0.46 * math.sin(a) * 0.92, -0.46 * math.cos(a)
        box('hz', (x, y, hz(z)), (0.08, 0.04, 0.06), P.black if i % 2 else P.yellow,
            rot=(0, 0, math.degrees(a)), bevel=0.0)


def lamp(P, side=1):
    cyl('lamp_body', (side * 0.36, -0.22, hz(0.24)), 0.07, 0.16, P.band, rot=(90, 0, 0), verts=20)
    cyl('lamp_lens', (side * 0.36, -0.305, hz(0.24)), 0.055, 0.02, P.lamp, rot=(90, 0, 0), verts=20)


def sensor(P, side=1):
    """Research monocle + side sensor stack."""
    cyl('mono_ring', (side * 0.17, -0.47, hz(0.02)), 0.1, 0.05, P.trim, rot=(90, 0, side * -18), verts=28)
    cyl('mono_lens', (side * 0.17, -0.5, hz(0.02)), 0.075, 0.02, P.lamp, rot=(90, 0, side * -18), verts=28)
    rod('mono_arm', (side * 0.44, -0.05, hz(0.05)), (side * 0.25, -0.43, hz(0.03)), 0.02, P.band)
    for i in range(3):
        box('stack', (side * 0.47, 0.1, hz(0.2 + i * 0.09)), (0.08, 0.2 - i * 0.04, 0.05), P.plate if i % 2 else P.trim,
            bevel=0.01)


# ---- hostile kit ---------------------------------------------------------
def ears(P, h=0.42, m=None):
    m = m or P.metal
    for s in (-1, 1):
        base = Vector((s * 0.24, 0.06, hz(0.3)))
        tip = Vector((s * 0.38, 0.14, hz(0.3 + h)))
        cone_at('ear', base, tip, 0.12, m, verts=4)
        cone_at('ear_in', base + Vector((0, -0.05, 0.02)), tip + Vector((0, -0.04, -0.08)), 0.06, P.trim, verts=4)


def muzzle(P):
    """Rebreather snout (jackal)."""
    box('snout', (0, -0.42, hz(-0.24)), (0.26, 0.26, 0.18), P.metal, rot=(18, 0, 0), bevel=0.05)
    for i in range(3):
        box('grille', (0, -0.555, hz(-0.2 - i * 0.05)), (0.18, 0.02, 0.018), P.black, rot=(18, 0, 0), bevel=0)
    for s in (-1, 1):
        rod('hose', (s * 0.12, -0.42, hz(-0.3)), (s * 0.4, -0.12, -0.12), 0.03, P.band)


def horns(P, m=None):
    m = m or P.bone
    for s in (-1, 1):
        pts = [Vector((s * 0.36, -0.02, hz(0.22))), Vector((s * 0.56, -0.08, hz(0.36))),
               Vector((s * 0.66, -0.2, hz(0.55))), Vector((s * 0.62, -0.36, hz(0.72)))]
        rs = [0.1, 0.075, 0.05, 0.0]
        for i in range(3):
            rod('horn', pts[i], pts[i + 1], rs[i], m, verts=10, r2=max(rs[i + 1], 0.004))
            sphere('horn_j', pts[i + 1], (rs[i + 1] + 0.002,) * 3, m, seg=10, rings=6) if rs[i + 1] else None


def spikes_row(P, n=5, h=0.22, m=None):
    m = m or P.metal
    for i in range(n):
        a = math.radians(-50 + i * 100 / (n - 1))
        base = Vector((0, 0.47 * math.sin(a) * 0.98, hz(0.47 * math.cos(a))))
        d = (base - H).normalized()
        cone_at('spike', base - d * 0.04, base + d * h * (1.0 - abs(i - n // 2) * 0.12), 0.06, m, verts=6)


def pad_spikes(P, side=1, n=3, m=None):
    m = m or P.metal
    for i in range(n):
        base = Vector((side * (0.72 + i * 0.1), 0.0, -0.12 - i * 0.04))
        cone_at('pspike', base, base + Vector((side * 0.12, 0, 0.2)), 0.04, m, verts=6)


def stacks(P):
    for s in (-1, 1):
        cyl('stack', (s * 0.24, 0.42, hz(0.18)), 0.075, 0.85, P.metal_dark, rot=(-8, 0, 0), verts=16)
        cyl('stack_tip', (s * 0.24, 0.47, hz(0.6)), 0.085, 0.06, P.lamp, rot=(-8, 0, 0), verts=16)


def grille_visor(P, n=4):
    for i in range(n):
        box('slat', (0, -0.455, hz(0.1 - i * 0.075)), (0.5, 0.04, 0.032), P.visor, bevel=0.005)


def claw_marks(P, side=1):
    for i in range(3):
        box('claw', (side * 0.37, -0.22 + i * 0.12, hz(0.12)), (0.03, 0.035, 0.3), P.trim_glow,
            rot=(28, side * -40, 0), bevel=0)


def goggles(P, patch_side=None):
    for s in (-1, 1):
        cyl('gog_ring', (s * 0.16, -0.43, hz(0.04)), 0.11, 0.1, P.metal, rot=(90, 0, s * -16), verts=24)
        if patch_side == s:
            cyl('patch', (s * 0.172, -0.49, hz(0.04)), 0.115, 0.03, P.black, rot=(90, 0, s * -16), verts=24)
        else:
            cyl('gog_lens', (s * 0.17, -0.485, hz(0.04)), 0.085, 0.02, P.visor, rot=(90, 0, s * -16), verts=24)
    box('gog_bridge', (0, -0.47, hz(0.05)), (0.1, 0.04, 0.04), P.metal, bevel=0.01)
    torus('gog_strap', (0, 0, hz(0.04)), 0.46, 0.03, P.band, scale=(0.95, 1.0, 1.0))


def fur_collar(P, m=None, seed=3):
    m = m or mat('fur', '#5a4636', 0.95)
    rnd = random.Random(seed)
    for i in range(16):
        a = 2 * math.pi * i / 16
        x, y = 0.42 * math.sin(a), 0.32 * math.cos(a) + 0.04
        if y > 0.3:
            continue
        s = 0.12 + rnd.random() * 0.05
        sphere('fur', (x, y, -0.06 + rnd.random() * 0.04), (s, s, s * 0.8), m, seg=7, rings=5, smooth=False,
               rot=(rnd.random() * 40, rnd.random() * 40, rnd.random() * 90))


def bicorne(P, m=None, tilt=7):
    """Captain's bicorne: a crescent hat across the helmet, points to the sides."""
    m = m or mat('hat', '#1e1a1d', 0.7)
    W, Hh, base = 0.74, 0.4, hz(0.27)
    n = 16
    up = [(-W + 2 * W * i / n, base + Hh * (1 - abs(-1 + 2 * i / n) ** 2) ** 0.75) for i in range(n + 1)]
    lo = [(W - 2 * W * i / n, base + 0.05 * (1 - (1 - 2 * i / n) ** 2)) for i in range(1, n)]
    hat = prism('hat', up + lo, -0.42, 0.3, m, bevel=0.03)
    lo_edge = [(x, z + 0.05) for x, z in reversed(lo)]
    strip = [(-W * 0.92, base + 0.03)] + [(x, z) for x, z in reversed(lo)] + [(W * 0.92, base + 0.03)] + lo_edge[::-1]
    edge = prism('hat_edge', strip, -0.435, -0.415, P.trim)
    pts = []
    for i in range(8):
        rr = 0.1 if i % 2 == 0 else 0.025
        a = math.radians(-90 + 45 * i)
        x, z = rr * math.cos(a), rr * math.sin(a)
        pts.append((x - 0.38 * z, base + 0.26 + z))
    star = prism('hat_star', pts, -0.445, -0.42, P.trim_glow)
    Rm = Matrix.Translation((0, 0, base)) @ Matrix.Rotation(math.radians(tilt), 4, 'Y') @         Matrix.Translation((0, 0, -base))
    for o in (hat, edge, star):
        o.data.transform(Rm)


def blade_fin(P, side=1):
    pts = [(side * 0.0, hz(0.4)), (side * 0.55, hz(0.95)), (side * 0.5, hz(0.75)), (side * 0.12, hz(0.3))]
    ob = prism('fin', [(x * 0.7 + side * 0.25, z) for x, z in pts], 0.08, 0.14, P.metal, bevel=0.0)
    ob2 = prism('fin_edge', [(side * 0.62, hz(0.93)), (side * 0.66, hz(0.95)), (side * 0.48, hz(0.62)),
                             (side * 0.44, hz(0.62))], 0.07, 0.15, P.trim_glow)
    return ob, ob2


def bolts_ring(P, z=0.0, n=10, r=0.46, m=None):
    m = m or P.metal_dark
    torus('rim', (0, 0, hz(z)), r, 0.045, P.metal, maj=40)
    for i in range(n):
        a = 2 * math.pi * i / n
        sphere('bolt', (r * 1.08 * math.sin(a), -r * 1.08 * math.cos(a), hz(z)), (0.03, 0.03, 0.03), m, seg=8, rings=5)


def star_decal(P, side=1):
    pts = []
    for i in range(8):
        rr = 0.13 if i % 2 == 0 else 0.03
        a = math.radians(-90 + 45 * i)
        x, z = rr * math.cos(a), rr * math.sin(a)
        pts.append((side * 0.8 + x - 0.38 * z, -0.12 + z))
    prism('star', pts, -0.33, -0.3, P.trim_glow)


# ---------------------------------------------------------------------------
# characters
# ---------------------------------------------------------------------------
def b_instructor():
    P = Pal(TRIM, visor_glow=GLOW)
    torso(P)
    pads(P, 'plate')
    chevrons(P, side=-1, n=3)
    helmet(P)
    visor(P, z0=-0.22, z1=0.08, front=-0.1)
    peak(P)
    headset(P, mic=True, side=-1)
    return P


def traffic_base(accent, plate=HULL, helm=None):
    P = Pal(accent, plate=plate, helmet=helm)
    torso(P)
    return P


def b_traffic_home():
    P = traffic_base(TRIM)
    pads(P, 'plate')
    helmet(P)
    crest(P)
    visor(P, z0=-0.2, z1=0.12, front=-0.12)
    headset(P, side=-1)
    return P


def b_traffic_trade():
    P = traffic_base(OK)
    pads(P, 'dome', size=0.78)
    helmet(P, scale=(0.92, 1.0, 0.96))
    visor(P, z0=-0.02, z1=0.12, front=0.06, scale=(0.92, 1.0, 0.96))
    torus('hband', H + Vector((0, 0, 0.18)), 0.43, 0.03, P.trim, scale=(0.92, 1.0, 1.0))
    headset(P, side=1)
    antenna(P, side=-1, h=0.4)
    return P


def b_traffic_mining():
    P = Pal(FUEL, plate='#c9cdd3', helmet=FUEL)
    torso(P, bulk=1.05)
    pads(P, 'plate', size=1.1)
    helmet(P, scale=(0.94, 1.02, 0.98))
    visor(P, z0=-0.2, z1=0.08, front=-0.14, scale=(0.94, 1.02, 0.98), m=mat('visor_m', '#06101a', 0.08, emit=FUEL,
                                                                             emit_strength=0.35, coat=1.0))
    hazard_stripes(P, z=0.16)
    lamp(P, side=1)
    headset(P, side=-1, m=P.band)
    return P


def b_traffic_research():
    P = traffic_base(GLOW)
    pads(P, 'plate', size=0.9)
    helmet(P, scale=(0.88, 1.0, 1.06))
    visor(P, z0=-0.24, z1=0.16, front=-0.06, scale=(0.88, 1.0, 1.06))
    crest(P, w=0.04)
    sensor(P, side=1)
    headset(P, side=-1, mic=True)
    antenna(P, side=-1, h=0.62, lean=-0.05)
    return P


def b_traffic_outpost():
    P = Pal(TITAN, plate='#8d96a3', helmet='#5f6876', suit='#262b33')
    torso(P, bulk=1.05)
    pads(P, 'plate', size=1.05)
    helmet(P, scale=(0.94, 1.0, 0.94))
    visor(P, z0=-0.06, z1=0.08, front=0.02, scale=(0.94, 1.0, 0.94))
    torus('hband', H + Vector((0, 0, -0.18)), 0.44, 0.035, P.trim, scale=(0.94, 1.0, 1.0))
    headset(P, side=-1, m=P.band)
    antenna(P, side=1, h=0.62, lean=0.16)
    box('patch', (0.3, -0.34, hz(0.22)), (0.16, 0.08, 0.1), P.band, rot=(30, 0, 40), bevel=0.02)
    return P


def drill_badge(P, loc, s=0.1, y0=None, navy=None):
    """Guild drill-bit emblem facing -Y (front plate): orange-rimmed navy octagon, a white
    bit pointing up with an orange collar and navy grooves (guild.drill_emblem, stood upright)."""
    x, y, z = loc
    navy = navy or P.band

    def octa(r):
        c = r * 0.58
        pts = [(-r + c, -r), (r - c, -r), (r, -r + c), (r, r - c), (r - c, r), (-r + c, r), (-r, r - c), (-r, -r + c)]
        return [(x + px, z + pz) for px, pz in pts]
    prism('badge_rim', octa(s), y, y + 0.04, P.trim)
    prism('badge_bg', octa(s * 0.8), y - 0.012, y + 0.02, navy)
    bit = [(x - 0.4 * s, z - 0.36 * s), (x + 0.4 * s, z - 0.36 * s), (x, z + 0.7 * s)]
    prism('badge_bit', bit, y - 0.024, y, P.plate)
    prism('badge_collar', [(x - 0.46 * s, z - 0.6 * s), (x + 0.46 * s, z - 0.6 * s), (x + 0.46 * s, z - 0.38 * s),
                           (x - 0.46 * s, z - 0.38 * s)], y - 0.024, y, P.trim)


def light_bar(P, top=0.455, w=0.44, m_lens=None):
    """Patrol strobe bar across the helmet crown: navy base, two blue-white lenses, white cap."""
    m_lens = m_lens or P.lamp
    top = hz(top)
    box('bar_base', (0, 0.0, top), (w + 0.06, 0.15, 0.06), P.band, bevel=0.02)
    for s in (-1, 1):
        cyl('bar_lens', (s * w * 0.3, 0.0, top + 0.065), 0.08, 0.22, m_lens, rot=(0, 90, 0), verts=20)
        sphere('bar_cap', (s * w * 0.52, 0.0, top + 0.065), (0.05, 0.08, 0.08), m_lens, seg=16, rings=8)
    box('bar_mid', (0, 0.0, top + 0.06), (0.1, 0.12, 0.1), P.plate, bevel=0.02)


def b_guild_watch():
    """Guild Watch patrol officer: white helmet with a navy brow band, the drill-bit badge on
    the brow, a blue-white strobe bar on the crown, navy-trimmed pads, orange chevrons."""
    navy = mat('guild_navy', '#1e2c44', 0.45)
    strobe = mat('strobe', '#2a62ff', 0.65, emit='#2f6cff', emit_strength=3.2)
    P = Pal(WATCH, visor_glow='#2c4f9e')
    P.lamp = strobe
    P.band = navy
    torso(P, bulk=1.02, collar_mat=navy, stripe=navy)
    pads(P, 'plate', left=('plate', 1.05, P.plate, navy), right=('plate', 1.05, P.plate, navy), tilt=22)
    P.trim = mat('trim', TRIM, 0.4)
    chevrons(P, side=-1, n=2, size=1.05, tilt=22)
    helmet(P, scale=(0.9, 1.0, 0.98))
    visor(P, z0=-0.22, z1=0.05, front=-0.1, scale=(0.9, 1.0, 0.98))
    visor(P, z0=0.06, z1=0.22, front=0.5, scale=(0.9, 1.0, 0.98), m=navy, inflate=1.05)
    drill_badge(P, (0, -0.5, hz(0.14)), s=0.085)
    light_bar(P, w=0.5)
    headset(P, mic=True, side=-1)
    return P


def b_pirate_jackal():
    P = Pal(BAD, hostile=True, suit='#24211f', visor_glow='#ff2a14', glow_strength=3.0)
    torso(P, width=0.92, collar_mat=P.rust, cuirass=P.metal_dark, stripe=P.rust)
    pads(P, left=('scrap', 0.95, P.rust, P.metal_dark), right=('plate', 0.75, P.metal, P.rust))
    helmet(P, 'facet', scale=(0.82, 1.08, 1.0))
    # narrow T-slit
    box('slit_h', (0, -0.44, hz(0.06)), (0.42, 0.06, 0.05), P.visor, bevel=0.01)
    box('slit_v', (0, -0.47, hz(-0.06)), (0.06, 0.05, 0.22), P.visor, bevel=0.01)
    ears(P)
    muzzle(P)
    return P


def b_pirate_hammer():
    P = Pal(WARN, hostile=True, suit='#24211f', metal='#565a60')
    torso(P, width=1.12, bulk=1.1, collar_mat=P.metal_dark, cuirass=P.metal, stripe=P.rust)
    pads(P, left=('plate', 1.3, P.metal, P.rust), right=('scrap', 1.2, P.rust, P.metal_dark), tilt=14)
    pad_spikes(P, side=-1, n=2)
    helmet(P, 'box', scale=(1.18, 1.0, 0.82))
    box('slot', (0, -0.455, hz(0.02)), (0.68, 0.04, 0.07), P.visor, bevel=0.01)
    for s in (-1, 1):
        box('cheek', (s * 0.46, -0.1, hz(-0.08)), (0.12, 0.6, 0.36), P.rust, bevel=0.03)
        for k in range(3):
            sphere('rivet', (s * 0.53, -0.3 + k * 0.18, hz(0.04)), (0.025,) * 3, P.metal_dark, seg=8, rings=5)
    box('brow', (0, -0.36, hz(0.18)), (0.92, 0.2, 0.08), P.metal_dark, bevel=0.02)
    return P


def surf(d, sc, c=None, k=1.0):
    """Point on an ellipsoid (centre c, semi-axes sc) along direction d, pushed out by k."""
    c = Vector(c) if c is not None else H
    d = Vector(d).normalized()
    t = 1.0 / math.sqrt(sum((d[i] / sc[i]) ** 2 for i in range(3)))
    return c + d * t * k


def scar(d0, d1, sc, m, r=0.009, c=None):
    """A scratch over an ellipsoid surface: two rods through the surface midpoint."""
    d0, d1 = Vector(d0).normalized(), Vector(d1).normalized()
    p0, p1, pm = surf(d0, sc, c, 1.004), surf(d1, sc, c, 1.004), surf(d0 + d1, sc, c, 1.012)
    rod('scar', p0, pm, r, m, verts=6)
    rod('scar', pm, p1, r, m, verts=6)


def b_pirate_gunner():
    """Long-range artillery pirate: heavy gunmetal helmet, big ear protectors on a headband,
    a long rangefinder monocle jutting past the far side of the face, a collar of brass shells,
    scarred plates with hot-orange edges."""
    P = Pal(GUNNER, hostile=True, suit='#22201f', metal='#50555c', rust='#6a3a22', visor_glow='#ff6a1a',
            glow_strength=3.2)
    scar_m = mat('scar', '#b4bac1', 0.3, 0.85)
    brass = mat('brass', '#c99a3e', 0.32, 0.9)
    copper = mat('copper', '#b8643a', 0.35, 0.85)
    leather = mat('leather', '#3b2a1f', 0.8)
    sight = mat('rf_glow', GUNNER, 0.3, emit='#ff4a0a', emit_strength=3.0)
    P.trim = mat('trim_hot', '#cc3c0a', 0.4)
    torso(P, width=1.06, bulk=1.06, collar=False, cuirass=P.metal, stripe=P.trim)
    cyl('neck', (0, 0, 0.02), 0.25, 0.3, P.band, verts=32)
    pads(P, left=('plate', 1.25, P.metal, P.trim), right=('plate', 1.1, P.rust, P.metal_dark), tilt=18)
    # ammo-belt collar: shells standing round the neck, leaning out
    torus('belt', (0, 0.02, -0.04), 0.4, 0.06, leather, scale=(1.0, 0.92, 1.0))
    for i in range(15):
        a = math.radians(-112 + i * 16)
        out = Vector((math.sin(a), -math.cos(a), 0))
        base = Vector((0.4 * out.x, 0.4 * 0.92 * out.y + 0.02, -0.07)) + out * 0.03
        tip = base + out * 0.05 + Vector((0, 0, 0.16))
        rod('shell', base, tip, 0.033, brass, verts=10)
        cone_at('bullet', tip, tip + (tip - base).normalized() * 0.075, 0.031, copper, verts=10, smooth=True)
    # bandolier over the cuirass (left shoulder -> right hip)
    csc = (1.05 * 1.06 * 1.03, 0.58 * 1.06 * 1.06, 0.66 * 1.04)
    cc = (0, 0.05, -0.66)
    prev = None
    for k in range(7):
        t = k / 6
        x, z = -0.5 + 0.9 * t, -0.1 - 0.55 * t
        dz, dx = (z - cc[2]) / csc[2], x / csc[0]
        y = cc[1] - csc[1] * math.sqrt(max(0.0, 1 - dz * dz - dx * dx)) - 0.03
        p = Vector((x, y, z))
        if prev is not None:
            rod('strap', prev, p, 0.045, leather, verts=8)
            m_ = (prev + p) / 2 + Vector((0, -0.04, 0))
            rod('bshell', m_ + Vector((0.03, 0, 0.05)), m_ + Vector((-0.03, 0, -0.05)), 0.026, brass, verts=8)
        prev = p
    # helmet
    sc = (0.47 * 0.96, 0.47 * 1.04, 0.47 * 0.92)
    helmet(P, 'round', scale=(0.96, 1.04, 0.92))
    box('brow', (0, -0.33, hz(0.2)), (0.8, 0.26, 0.1), P.metal_dark, rot=(-12, 0, 0), bevel=0.03)
    box('slit', (-0.16, -0.455, hz(0.04)), (0.3, 0.06, 0.065), P.visor, rot=(0, 0, -14), bevel=0.01)
    box('jaw', (0, -0.33, hz(-0.27)), (0.56, 0.3, 0.2), P.metal, bevel=0.05)
    for i in range(4):
        box('jaw_slot', (-0.15 + i * 0.1, -0.485, hz(-0.27)), (0.035, 0.02, 0.12), P.black, bevel=0)
    # ear protectors on a headband
    for s in (-1, 1):
        cyl('muff', (s * 0.47, 0.0, hz(-0.02)), 0.2, 0.18, P.metal_dark, rot=(0, 90, 0), verts=32)
        cyl('muff_cap', (s * 0.565, 0.0, hz(-0.02)), 0.15, 0.04, P.trim, rot=(0, 90, 0), verts=32)
        cyl('muff_hub', (s * 0.59, 0.0, hz(-0.02)), 0.06, 0.03, P.metal, rot=(0, 90, 0), verts=16)
    band = torus('muff_band', (0, 0.04, hz(-0.02)), 0.52, 0.04, P.metal_dark, rot=(90, 0, 0), scale=(1.0, 0.98, 1.0))
    cut(band, [((0, 0, hz(-0.02)), (0, 0, -1))])
    # rangefinder monocle over the far (+X) eye: a long tube jutting forward past the profile
    RX, RZ = 0.17, hz(0.05)
    rod('rf_arm', (0.58, 0.0, hz(0.06)), (RX + 0.07, -0.42, RZ), 0.026, P.metal_dark)
    cyl('rf_tube', (RX, -0.64, RZ), 0.07, 0.5, P.metal, rot=(90, 0, 0), verts=20)
    for k in range(3):
        torus('rf_band', (RX, -0.47 - k * 0.16, RZ), 0.074, 0.018, P.trim, rot=(90, 0, 0), maj=24, mnr=8)
    cyl('rf_hood', (RX, -0.91, RZ), 0.075, 0.07, P.metal_dark, rot=(90, 0, 0), verts=20, r2=0.095)
    cyl('rf_lens', (RX, -0.94, RZ), 0.07, 0.02, sight, rot=(90, 0, 0), verts=20)
    box('rf_fin', (RX, -0.66, RZ + 0.1), (0.02, 0.26, 0.07), P.metal_dark, bevel=0.005)
    # scars on the helmet and the brow
    for k in range(3):
        o = k * 0.12
        scar((-0.55 - o, -0.55 + o, 0.62), (-0.2 - o, -0.75 + o, 0.15), sc, scar_m)
    scar((0.35, -0.6, 0.55), (0.62, -0.4, 0.2), sc, scar_m)
    rod('brow_scar', (-0.3, -0.465, hz(0.25)), (-0.05, -0.47, hz(0.17)), 0.009, scar_m, verts=6)
    return P


def b_derelict_ai():
    """Not a person: the automaton voice of an abandoned Guild station - an old terminal /
    sensor head on a console pylon. Faded-orange cracked casing with dust and soot, one big
    optical lens (dim cyan ring, amber core). Scanline flicker + faint static in the pack step."""
    casing = grime('casing_old', '#a55a28', dirt='#211a15', scale=3.2, lo=0.38, hi=0.54, detail=3.0)
    face = grime('face_old', '#30353c', dirt='#0f1011', scale=9.0, lo=0.38, hi=0.72, rough=0.6, metal=0.4)
    white = grime('stripe_old', '#bab4a4', dirt='#3a332b', scale=8.0, lo=0.36, hi=0.7)
    soot = mat('soot', '#0b0a09', 0.95)
    P = Pal(DERELICT, suit='#1f2126', metal='#4a4d52')
    P.plate = white
    P.trim = mat('trim_old', '#9a6236', 0.6)
    P.band = mat('navy_old', '#1d2633', 0.6)
    cyan = mat('lens_ring', '#0b3a40', 0.3, emit='#2fb4c4', emit_strength=1.5)
    amber = mat('lens_core', '#ff9a2a', 0.3, emit='#ff8a14', emit_strength=3.2)
    iris = mat('lens_iris', '#2a1806', 0.4, emit='#ff7a10', emit_strength=0.8)
    glass = mat('lens_glass', '#030507', 0.22, coat=0.4)
    crack_c = mat('crack', '#080706', 0.9)
    crack_g = mat('crack_glass', '#9fb2bb', 0.2, 0.3)
    # console plinth (fills the frame bottom like a pair of shoulders)
    box('plinth', (0, 0.1, -0.72), (1.75, 1.0, 0.72), casing, bevel=0.12, seg=3)
    box('plinth_top', (0, 0.05, -0.35), (1.3, 0.8, 0.08), face, bevel=0.03)
    box('plinth_panel', (0, -0.405, -0.6), (1.25, 0.04, 0.3), face, bevel=0.02)
    for i in range(4):
        box('plinth_slot', (-0.42 + i * 0.28, -0.43, -0.53), (0.18, 0.02, 0.04), soot, bevel=0)
    box('plinth_stripe', (0, -0.415, -0.4), (1.5, 0.03, 0.05), white, bevel=0)
    # neck pylon + cables
    cyl('pylon', (0, 0.05, -0.15), 0.16, 0.42, P.metal_dark, verts=24)
    torus('pylon_ring', (0, 0.05, -0.1), 0.18, 0.03, P.metal)
    for k in range(4):
        torus('pylon_rib', (0, 0.05, -0.27 + k * 0.08), 0.165, 0.022, P.metal_dark, maj=32, mnr=8)
    for a, b in (((0.24, 0.1, hz(-0.37)), (0.36, 0.0, -0.16)), ((0.36, 0.0, -0.16), (0.3, -0.05, -0.32))):
        rod('cable', a, b, 0.03, P.black, verts=8)
    sphere('cable_j', (0.36, 0.0, -0.16), (0.031, 0.031, 0.031), P.black, seg=8, rings=5)
    # head housing
    box('head', (0, 0, hz(0.0)), (1.0, 0.82, 0.76), casing, bevel=0.13, seg=3)
    box('faceplate', (0, -0.405, hz(-0.03)), (0.8, 0.04, 0.58), face, bevel=0.03)
    box('brow', (0, -0.43, hz(0.3)), (0.94, 0.16, 0.09), casing, bevel=0.03)
    # optical lens
    LX, LZ = -0.05, hz(0.02)
    cyl('lens_housing', (LX, -0.46, LZ), 0.25, 0.1, P.metal_dark, rot=(90, 0, 0), verts=40)
    torus('lens_bezel', (LX, -0.515, LZ), 0.235, 0.025, P.metal, rot=(90, 0, 0))
    torus('lens_ring', (LX, -0.52, LZ), 0.185, 0.02, cyan, rot=(90, 0, 0))
    cyl('lens_glass', (LX, -0.515, LZ), 0.168, 0.02, glass, rot=(90, 0, 0), verts=40)
    torus('lens_iris', (LX, -0.528, LZ), 0.095, 0.014, iris, rot=(90, 0, 0))
    sphere('lens_core', (LX, -0.53, LZ), (0.058, 0.03, 0.058), amber, seg=20, rings=10)
    # cracked lens glass
    for p0, p1 in (((LX + 0.03, LZ + 0.06), (LX + 0.09, LZ + 0.11)), ((LX + 0.09, LZ + 0.11), (LX + 0.15, LZ + 0.08)),
                   ((LX + 0.09, LZ + 0.11), (LX + 0.1, LZ + 0.16))):
        rod('glass_crack', (p0[0], -0.53, p0[1]), (p1[0], -0.53, p1[1]), 0.005, crack_g, verts=5)
    # speaker grille under the lens, a faded drill badge, two status LEDs (one dead)
    for i in range(3):
        box('grille', (LX, -0.43, hz(-0.26 - i * 0.045)), (0.36, 0.02, 0.022), soot, bevel=0)
    drill_badge(P, (0.29, -0.43, hz(-0.2)), s=0.07)
    sphere('led', (0.3, -0.43, hz(0.16)), (0.022, 0.015, 0.022), mat('led_on', '#3fbccb', 0.3, emit='#3fbccb',
                                                                         emit_strength=2.5), seg=10, rings=6)
    sphere('led', (0.36, -0.43, hz(0.16)), (0.022, 0.015, 0.022), soot, seg=10, rings=6)
    # cracks: front casing, brow, top and the near (-X) side
    for pts in (
            [(-0.505, -0.3, hz(0.36)), (-0.505, -0.2, hz(0.22)), (-0.505, -0.25, hz(0.1)), (-0.505, -0.1, hz(-0.04)),
             (-0.505, -0.14, hz(-0.2))],
            [(-0.505, -0.2, hz(0.22)), (-0.505, -0.05, hz(0.26)), (-0.505, 0.05, hz(0.2))],
            [(-0.36, -0.515, hz(0.33)), (-0.28, -0.515, hz(0.28)), (-0.18, -0.515, hz(0.31))],
            [(-0.42, -0.25, hz(0.385)), (-0.25, -0.1, hz(0.385)), (-0.3, 0.05, hz(0.385)), (-0.1, 0.2, hz(0.385))],
            [(0.44, -0.425, hz(0.25)), (0.44, -0.425, hz(0.1)), (0.47, -0.42, hz(-0.02))],
            [(-0.6, -0.505, -0.42), (-0.45, -0.505, -0.55), (-0.5, -0.505, -0.7)]):
        for a, b in zip(pts, pts[1:]):
            rod('crack', a, b, 0.011, crack_c, verts=5)
    # open service hatch on the near side with a dangling cable, vents, a faded stripe
    box('hatch', (-0.502, 0.16, hz(-0.12)), (0.02, 0.24, 0.22), soot, bevel=0)
    pts = [Vector((-0.52, 0.12, hz(-0.15))), Vector((-0.58, 0.08, hz(-0.3))), Vector((-0.6, 0.04, hz(-0.5)))]
    for a, b in zip(pts, pts[1:]):
        rod('loose_cable', a, b, 0.022, P.rust, verts=8)
    box('plug', pts[-1] + Vector((0, 0, -0.03)), (0.05, 0.05, 0.08), P.metal, bevel=0.01)
    for i in range(4):
        box('vent', (-0.505, -0.05 + i * 0.075, hz(0.1)), (0.02, 0.04, 0.16), soot, bevel=0)
    box('stripe', (-0.505, 0.0, hz(0.3)), (0.012, 0.66, 0.05), white, bevel=0)
    # bent, snapped antenna stub
    base = Vector((0.26, 0.14, hz(0.38)))
    cyl('ant_base', base, 0.05, 0.08, P.metal_dark, verts=12)
    rod('ant', base, base + Vector((0.02, 0.0, 0.24)), 0.016, P.metal)
    rod('ant', base + Vector((0.02, 0.0, 0.24)), base + Vector((0.18, 0.04, 0.3)), 0.014, P.metal)
    S = Matrix.Translation((0, 0, 0.3)) @ Matrix.Scale(0.9, 4) @ Matrix.Translation((0, 0, -0.3))
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH':
            ob.data.transform(S)
    return P


def b_captain_rust_a():
    """Horned warlord, claw marks."""
    P = Pal(BAD, hostile=True, suit='#2a1d1a', metal='#3d3f45', visor_glow='#ff2a14', glow_strength=3.0)
    torso(P, width=1.05, collar_mat=P.rust, cuirass=P.rust, stripe=P.metal_dark)
    pads(P, left=('scrap', 1.15, P.rust, P.metal_dark), right=('scrap', 1.05, P.metal, P.rust))
    pad_spikes(P, side=-1, n=3)
    pad_spikes(P, side=1, n=2)
    helmet(P, 'facet', scale=(0.9, 1.04, 1.02))
    box('slit_h', (0, -0.45, hz(0.04)), (0.48, 0.06, 0.055), P.visor, bevel=0.01)
    box('slit_v', (0, -0.47, hz(-0.08)), (0.06, 0.05, 0.22), P.visor, bevel=0.01)
    horns(P)
    claw_marks(P, side=1)
    return P


def b_captain_rust_b():
    """Cyclops with a spiked crest and a high scrap collar."""
    P = Pal(BAD, hostile=True, suit='#221b1b', metal='#4a4d53', rust='#7a3322', visor_glow='#ff2a14',
            glow_strength=3.0)
    torso(P, collar_mat=P.metal_dark, cuirass=P.metal_dark, stripe=P.trim_glow)
    pads(P, left=('dome', 1.05, P.metal, P.rust), right=('dome', 1.05, P.rust, P.metal_dark))
    helmet(P, 'round', scale=(0.9, 1.0, 1.0))
    cyl('eye_ring', (0, -0.44, hz(0.02)), 0.16, 0.08, P.metal_dark, rot=(90, 0, 0), verts=32)
    cyl('eye', (0, -0.485, hz(0.02)), 0.11, 0.03, P.visor, rot=(90, 0, 0), verts=32)
    spikes_row(P, n=5, h=0.26, m=P.rust)
    return P


def b_captain_cauldron_a():
    """Smokestack welder: box mask with a glowing grille and exhaust stacks."""
    P = Pal('#ff8a3a', hostile=True, suit='#262019', metal='#5a5650', visor_glow='#ff8a3a')
    torso(P, width=1.08, bulk=1.05, collar_mat=P.rust, cuirass=P.metal, stripe=P.trim_glow)
    pads(P, left=('plate', 1.2, P.rust, P.metal_dark), right=('plate', 1.0, P.metal, P.rust), tilt=16)
    helmet(P, 'box', scale=(0.95, 1.0, 1.08))
    grille_visor(P)
    stacks(P)
    box('mask_rim', (0, -0.43, hz(0.18)), (0.66, 0.06, 0.06), P.rust, bevel=0.01)
    return P


def b_captain_cauldron_b():
    """Bolted dome, goggles with one eye patched, fur collar, rebreather."""
    P = Pal('#ff8a3a', hostile=True, suit='#2b241c', metal='#6a6258', visor_glow='#ffb547')
    torso(P, collar=False, cuirass=P.rust, stripe=False)
    cyl('neck', (0, 0, 0.02), 0.27, 0.32, P.band, verts=32)
    pads(P, left=('scrap', 1.0, P.metal, P.rust), right=('none', 1, None, None))
    fur_collar(P)
    helmet(P, 'round', scale=(0.92, 1.0, 0.95), m=mat('dome', '#7a6a58', 0.45, 0.6))
    bolts_ring(P, z=0.12, n=12, r=0.44)
    goggles(P, patch_side=1)
    box('rebreather', (0, -0.42, hz(-0.22)), (0.22, 0.16, 0.14), P.metal_dark, bevel=0.04)
    cyl('filter', (-0.14, -0.45, hz(-0.27)), 0.06, 0.1, P.rust, rot=(90, 0, -30), verts=16)
    return P


def b_captain_slanted_a():
    """Slanted visor + swept blade fin, asymmetric armour."""
    P = Pal('#ffd36b', hostile=True, suit='#1f1d22', metal='#4c4f57', visor_glow='#ffa51f', glow_strength=2.2)
    torso(P, collar_mat=P.metal_dark, cuirass=P.metal_dark, stripe=mat('slash', BAD, 0.4, emit=BAD, emit_strength=3.0))
    pads(P, left=('plate', 1.15, P.metal, mat('slash2', BAD, 0.4)), right=('none', 1, None, None))
    star_decal(P, side=-1)
    helmet(P, 'facet', scale=(0.88, 1.04, 1.1))
    visor(P, z0=-0.1, z1=0.1, front=-0.18, scale=(0.88, 1.04, 1.1), slant=0.45, inflate=1.06)
    blade_fin(P, side=1)
    return P


def b_captain_slanted_b():
    """Tricorn hat over a band visor, rust coat collar."""
    P = Pal('#ffd36b', hostile=True, suit='#221f24', metal='#4c4f57', visor_glow='#ffa51f', glow_strength=2.2)
    torso(P, collar_mat=P.trim, cuirass=mat('coat', '#3a2630', 0.8), stripe=P.trim)
    pads(P, left=('dome', 0.95, P.metal, P.trim), right=('dome', 0.95, P.metal, P.trim))
    helmet(P, 'round', scale=(0.9, 1.0, 0.98))
    visor(P, z0=-0.06, z1=0.06, front=-0.1, scale=(0.9, 1.0, 0.98), inflate=1.05)
    bicorne(P)
    return P


def b_unknown():
    P = Pal(DIM, plate='#15181d', helmet='#15181d', suit='#0e1014')
    P.visor = mat('visor_u', '#0a0b0d', 0.3)
    P.trim = mat('trim_u', '#1c1f25', 0.6)
    torso(P)
    pads(P, 'plate')
    helmet(P)
    visor(P, z0=-0.2, z1=0.1, front=-0.1)
    headset(P, mic=False)
    return P


def b_echo():
    """Not a person: a floating Forge-smith crystal glyph with segmented rings.
    The glitch (slice offsets, chromatic split) is added in the pack step."""
    obs = mat('obsidian', OBSIDIAN, 0.25, 0.3)
    ember = mat('ember', EMBER, 0.4, emit=EMBER, emit_strength=2.2)
    viol = mat('crystal', '#6f5cf0', 0.18, emit='#6a55ff', emit_strength=0.45)
    viol_hi = mat('crystal_hi', '#c9bfff', 0.1, emit='#9d8cff', emit_strength=3.0)
    c = Vector((0, 0, 0.2))
    # octahedral crystal, stretched
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in ((0, 0, 0.75), (0, 0, -0.75), (0.32, 0, 0), (-0.32, 0, 0), (0, 0.32, 0), (0, -0.32, 0))]
    for a, b in ((2, 4), (4, 3), (3, 5), (5, 2)):
        bm.faces.new((v[0], v[a], v[b]))
        bm.faces.new((v[1], v[b], v[a]))
    ob = _new_obj('crystal', bm, viol, False)
    ob.matrix_world = Matrix.Translation(c) @ Matrix.Rotation(math.radians(45), 4, 'Z')
    _bake(ob)
    sphere('core', c, (0.1, 0.1, 0.1), viol_hi, seg=12, rings=8)
    for k, (z, w) in enumerate(((0.3, 0.1), (0.12, 0.16), (-0.12, 0.14), (-0.34, 0.08))):
        box('cglyph', c + Vector((0.02 * k - 0.03, -0.235 + abs(z) * 0.31, z)), (w, 0.02, 0.03), ember,
            rot=(0, 0, 0), bevel=0)
    # segmented rings (3-fold language): 3 arcs each with ember glyph notches, two tilted rings
    for k, (Rr, tilt, rot0) in enumerate(((0.78, 72, 10), (1.0, 104, 70))):
        before = set(bpy.context.scene.objects)
        for i in range(3):
            a0 = rot0 + i * 120
            ring = torus('seg', (0, 0, 0), Rr, 0.05, obs, maj=72, mnr=8)
            planes = []
            for da in (-40, 40):  # keep an 80 deg arc
                a = math.radians(a0 + 40 + da)
                n = Vector((-math.sin(a), math.cos(a), 0)) * (1 if da > 0 else -1)
                planes.append(((0, 0, 0), n))
            cut(ring, planes)
            for j in range(3):
                a = math.radians(a0 + 15 + j * 25)
                box('glyph', (Rr * math.cos(a), Rr * math.sin(a), 0), (0.07, 0.05, 0.11 if j != 1 else 0.17), ember,
                    rot=(0, 0, math.degrees(a)), bevel=0)
        M_ = Matrix.Translation(c) @ Matrix.Rotation(math.radians(tilt), 4, 'X') @             Matrix.Rotation(math.radians(k * 25), 4, 'Y')
        for o in set(bpy.context.scene.objects) - before:
            o.data.transform(M_)
    # three blades converging under the crystal (emblem echo)
    for i in range(3):
        a = math.radians(90 + i * 120)
        base = c + Vector((0.62 * math.cos(a), 0.3 * math.sin(a), -0.62))
        cone_at('blade', base, c + Vector((0.18 * math.cos(a), 0.1 * math.sin(a), -0.22)), 0.06, ember, verts=4)
    return None


CHARACTERS = [
    # id, builder, faction, role, accent, label
    ('guild_instructor', b_instructor, 'guild', 'instructor', TRIM, 'Instructor (Cech)'),
    ('traffic_home', b_traffic_home, 'guild', 'traffic', TRIM, 'Traffic: home'),
    ('traffic_trade', b_traffic_trade, 'freeTraders', 'traffic', OK, 'Traffic: trade'),
    ('traffic_mining', b_traffic_mining, 'guild', 'traffic', FUEL, 'Traffic: mining'),
    ('traffic_research', b_traffic_research, 'institute', 'traffic', GLOW, 'Traffic: research'),
    ('traffic_outpost', b_traffic_outpost, 'guild', 'traffic', TITAN, 'Traffic: outpost'),
    ('guild_watch', b_guild_watch, 'guild', 'watch', WATCH, 'Guild Watch / Straz Cechu'),
    ('derelict_ai', b_derelict_ai, 'guild', 'automaton', DERELICT, 'Derelict station AI / Hlas stanice'),
    ('pirate_jackal', b_pirate_jackal, 'pirate', 'pirate', BAD, 'Pirate: Jackal'),
    ('pirate_hammer', b_pirate_hammer, 'pirate', 'pirate', WARN, 'Pirate: Hammer'),
    ('pirate_gunner', b_pirate_gunner, 'pirate', 'pirate', GUNNER, 'Pirate: Gunner'),
    ('captain_rust_a', b_captain_rust_a, 'rust', 'captain', BAD, 'Captain Hrdza A'),
    ('captain_rust_b', b_captain_rust_b, 'rust', 'captain', BAD, 'Captain Hrdza B'),
    ('captain_cauldron_a', b_captain_cauldron_a, 'cauldron', 'captain', '#ff8a3a', 'Captain Kotol A'),
    ('captain_cauldron_b', b_captain_cauldron_b, 'cauldron', 'captain', '#ff8a3a', 'Captain Kotol B'),
    ('captain_slantedStar_a', b_captain_slanted_a, 'slantedStar', 'captain', '#ffd36b', 'Captain S. hviezda A'),
    ('captain_slantedStar_b', b_captain_slanted_b, 'slantedStar', 'captain', '#ffd36b', 'Captain S. hviezda B'),
    ('echo', b_echo, 'wardens', 'echo', VIOLET, 'Echo / Ozvena'),
    ('unknown', b_unknown, 'unknown', 'unknown', DIM, 'Unknown'),
]


# ---------------------------------------------------------------------------
# scene
# ---------------------------------------------------------------------------
def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
        for d in list(coll):
            coll.remove(d)
    _MATS.clear()


def world():
    w = bpy.data.worlds.get('AF_Portrait') or bpy.data.worlds.new('AF_Portrait')
    bpy.context.scene.world = w
    nt = w.node_tree
    bg = nt.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.02, 0.026, 0.04, 1)
    bg.inputs['Strength'].default_value = 1.0


def area(name, loc, target, energy, color, size):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = energy
    ld.color = color
    ld.size = size
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    _link(ob)
    return ob


def lights(accent, echo=False):
    rim = lin(accent)
    # normalise the rim colour so dark accents still read
    mx = max(rim)
    rim = tuple(c / mx for c in rim)
    tgt = (0, 0, 0.3)
    if not echo:
        area('key', (-2.4, -3.2, 2.6), tgt, 520, (1.0, 0.96, 0.9), 2.5)
        area('fill', (2.8, -2.6, 0.6), tgt, 90, (0.7, 0.8, 1.0), 3.0)
    else:
        area('key', (-2.4, -3.2, 2.6), tgt, 220, (0.85, 0.82, 1.0), 2.5)
    area('rimL', (-2.2, 2.4, 1.6), tgt, 900 if not echo else 300, rim, 1.2)
    area('rimR', (2.4, 2.2, 1.2), tgt, 1100 if not echo else 300, rim, 1.2)
    area('top', (0.3, 0.6, 3.4), tgt, 160, (0.85, 0.9, 1.0), 2.0)


def camera(echo=False):
    cd = bpy.data.cameras.new('Cam')
    cd.lens = 85
    cd.sensor_fit = 'VERTICAL'
    cd.sensor_height = 24
    ob = bpy.data.objects.new('Cam', cd)
    _link(ob)
    tgt = Vector((0, 0, 0.24)) if echo else Vector((0, 0, 0.31))
    elev = math.radians(7)
    dist = 7.9 if echo else 6.6
    ob.location = tgt + Vector((0, -dist * math.cos(elev), dist * math.sin(elev)))
    ob.rotation_euler = (tgt - ob.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = ob


def turn(yaw):
    Rz = Matrix.Rotation(math.radians(yaw), 4, 'Z')
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH':
            ob.matrix_world = Rz @ ob.matrix_world


def render_one(cid, builder, accent, samples):
    clear_scene()
    world()
    builder()
    turn(YAW if cid != 'echo' else 18)
    lights(accent, echo=(cid == 'echo'))
    camera(echo=(cid == 'echo'))
    sc = bpy.context.scene
    R.setup_render(RES, RES, samples=samples)
    sc.render.use_compositing = False
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    path = os.path.join(MASTERS, f'{cid}.png')
    R.render_to(path)
    print('PORTRAIT', path)
    return path


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    a = {'only': None, 'samples': 48, 'pack': True}
    i = 0
    while i < len(argv):
        if argv[i] == '--only':
            a['only'] = set(argv[i + 1].split(','))
            i += 1
        elif argv[i] == '--samples':
            a['samples'] = int(argv[i + 1])
            i += 1
        elif argv[i] == '--no-pack':
            a['pack'] = False
        i += 1
    return a


def main():
    a = parse_args()
    os.makedirs(MASTERS, exist_ok=True)
    meta = []
    for cid, fn, faction, role, accent, label in CHARACTERS:
        meta.append({'id': cid, 'faction': faction, 'role': role, 'accent': accent, 'label': label})
        if a['only'] and cid not in a['only']:
            continue
        render_one(cid, fn, accent, a['samples'])
    with open(os.path.join(MASTERS, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2)
    if a['pack']:
        py = os.environ.get('AF_PYTHON', 'python')
        cmd = [py, os.path.join(HERE, 'portraits_pack.py')]
        print('PACK', ' '.join(cmd))
        r = subprocess.run(cmd)
        if r.returncode:
            print('portraits_pack.py failed - run it manually: python art/blender/portraits_pack.py')


if __name__ == '__main__':
    main()
