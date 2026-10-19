"""Logo, main-menu background and app icons (public/assets/ui/).

  blender --background --factory-startup --python art/blender/ui_art.py -- [--only logo,menu,icons] [--iter tag]
  menu v2 (batch D4): --only menu2 [--options 1,2] [--iter tag], then --only none --final2 N

Logo text uses Blender's built-in font (Bfont), no system fonts.
"""
import math
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
from lib import geo as G  # noqa: E402
from lib import optimize  # noqa: E402
from lib import render as R  # noqa: E402
from lib import tex2d as T  # noqa: E402

UI = os.path.join(paths.ROOT, 'public', 'assets', 'ui')
SKY = os.path.join(paths.ROOT, 'public', 'assets', 'skybox')


def _lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def _pbr(name, hexcol, metal=0.2, rough=0.35, emit=None, strength=0.0, alpha=None):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*_lin(hexcol), 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*_lin(emit), 1)
        b.inputs['Emission Strength'].default_value = strength
    if alpha is not None:
        b.inputs['Alpha'].default_value = alpha
    return m


def _emit_alpha(name, hexcol, strength, alpha):
    """Emissive + partially transparent (survives film_transparent as alpha)."""
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*_lin(hexcol), 1)
    em.inputs['Strength'].default_value = strength
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    mix.inputs['Fac'].default_value = alpha
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(tr.outputs['BSDF'], mix.inputs[1])
    nt.links.new(em.outputs['Emission'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    return m


def _world_hdr(strength=0.6, visible=False):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('Env')
    sc.world = w
    nt = w.node_tree
    nt.nodes.clear()
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(optimize.shipped(os.path.join(SKY, 'ring1_bg.jpg')))
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    return w


def _text(body, size=1.0, extrude=0.14, bevel=0.035, offset=0.012, spacing=1.08):
    cu = bpy.data.curves.new('Txt', 'FONT')
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.bevel_resolution = 3
    cu.offset = offset
    cu.space_character = spacing
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new('Txt', cu)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _to_mesh(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    new = bpy.data.objects.new(ob.name + '_m', me)
    new.matrix_world = ob.matrix_world
    bpy.context.scene.collection.objects.link(new)
    bpy.data.objects.remove(ob)
    return new


def _union(ob, voxel):
    """Voxel-remesh a text mesh into one clean watertight shell."""
    mod = ob.modifiers.new('Remesh', 'REMESH')
    mod.mode = 'VOXEL'
    mod.voxel_size = voxel
    mod.use_smooth_shade = True
    G.apply_modifiers(ob)
    return ob


def _two_tone(ob, front, side, z_front):
    """front faces (facing +Z, near the front) -> front mat, rest -> side mat."""
    ob.data.materials.clear()
    ob.data.materials.append(front)
    ob.data.materials.append(side)
    for p in ob.data.polygons:
        p.material_index = 0 if (p.normal.z > 0.92 and p.center.z > z_front) else 1
        p.use_smooth = p.normal.z < 0.92


# ----------------------------------------------------------------------------
# logo
# ----------------------------------------------------------------------------
def build_logo_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    _world_hdr(0.5)
    sc.render.film_transparent = True
    hull = _pbr('Hull', '#F6F8FB', metal=0.15, rough=0.3)
    trim = _pbr('Trim', '#F27A1F', metal=0.2, rough=0.35)
    dark = _pbr('Dark', '#2A303B', metal=0.5, rough=0.4)
    # main lettering, facing +Z (camera looks down -Z).  Text extrusion is
    # symmetric around the curve plane, so every layer gets its own depth
    # band (letters 0..0.4, plate -0.17..-0.07, orbit -0.3) - nothing
    # intersects any more (the old dark specks were the orbit strip and the
    # backing plate cutting through the letters).
    SP = 1.24
    words = []
    for body, y in (('CINDER', 0.42), ('BELT', -0.62)):
        t = _text(body, size=1.0, extrude=0.16, bevel=0.035, offset=0.012, spacing=SP)
        t.location = (0, y, 0.2)
        m = _to_mesh(t)
        _two_tone(m, hull, trim, 0.12)          # local z (object sits at z = 0.2)
        words.append(m)
    # dark backing plate behind each word (gives the "panel" look)
    for body, y in (('CINDER', 0.42), ('BELT', -0.62)):
        t = _text(body, size=1.0, extrude=0.05, bevel=0.0, offset=0.065, spacing=SP)
        t.location = (0, y, -0.12)
        m = _to_mesh(t)
        m.data.materials.append(dark)
    # (the cyan glow is added in post: see _glow())
    # orbit swoosh + star
    bm = bmesh.new()
    seg = 160
    for i in range(seg):
        a0 = 2 * math.pi * i / seg
        a1 = 2 * math.pi * (i + 1) / seg
        th = 0.022 * (0.25 + 0.75 * abs(math.sin(a0 * 0.5)))     # tapered
        pts = []
        for a, s in ((a0, 1), (a1, 1), (a1, -1), (a0, -1)):
            r = 1.0 + s * th / 2
            pts.append(bm.verts.new((3.9 * r * math.cos(a), 1.05 * r * math.sin(a), 0.0)))
        bm.faces.new(pts)
    me = bpy.data.meshes.new('Orbit')
    bm.to_mesh(me)
    orbit = bpy.data.objects.new('Orbit', me)
    sc.collection.objects.link(orbit)
    orbit.rotation_euler = (0, 0, math.radians(-8))
    orbit.location = (0, -0.1, -0.3)
    me.materials.append(_emit_alpha('OrbitMat', '#18B4F2', 1.6, 0.95))
    star = bpy.data.objects.new('Star', bpy.data.meshes.new('Star'))
    sbm = bmesh.new()
    c = sbm.verts.new((0, 0, 0))
    ring = []
    for i in range(8):
        a = math.pi * 2 * i / 8
        r = 0.32 if i % 2 == 0 else 0.07
        ring.append(sbm.verts.new((r * math.cos(a), r * math.sin(a), 0)))
    for i in range(8):
        sbm.faces.new((c, ring[i], ring[(i + 1) % 8]))
    sbm.to_mesh(star.data)
    sc.collection.objects.link(star)
    ang = math.radians(28)
    star.location = (3.9 * math.cos(ang) * math.cos(math.radians(-8)) - 1.05 * math.sin(ang) * math.sin(math.radians(-8)),
                     3.9 * math.cos(ang) * math.sin(math.radians(-8)) + 1.05 * math.sin(ang) * math.cos(math.radians(-8)) - 0.1,
                     0.3)
    star.data.materials.append(_emit_alpha('StarMat', '#FFFFFF', 8.0, 1.0))
    # lights + camera
    for name, energy, rot, col in (('Key', 4.0, (35, -25, 0), (1, 0.96, 0.9)), ('Rim', 2.5, (-40, 30, 0), (0.6, 0.85, 1.0))):
        ld = bpy.data.lights.new(name, 'SUN')
        ld.energy = energy
        ld.color = col
        lo = bpy.data.objects.new(name, ld)
        lo.rotation_euler = [math.radians(a) for a in rot]
        sc.collection.objects.link(lo)
    cd = bpy.data.cameras.new('Cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = 8.6
    cam = bpy.data.objects.new('Cam', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.location = (0, -2.2, 12)
    cam.rotation_euler = (math.radians(10), 0, 0)
    return sc


def _blur(a, r):
    """Separable box blur x3 (~gaussian) with radius r (pixels)."""
    import numpy as np
    out = a.astype(np.float32)
    for _ in range(3):
        for axis in (0, 1):
            pad = [(0, 0)] * out.ndim
            pad[axis] = (r + 1, r)
            c = np.cumsum(np.pad(out, pad, mode='constant'), axis=axis)
            hi = np.take(c, range(2 * r + 1, c.shape[axis]), axis=axis)
            lo = np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis=axis)
            out = (hi - lo) / (2 * r + 1)
    return out


def _glow(path, radius, color=(0.25, 0.85, 1.0), strength=0.9):
    """Add a soft cyan glow under a transparent logo (keeps transparency)."""
    a = R.read_png(path)                       # bottom-up rows, straight alpha
    al = a[..., 3]
    g = np.clip(_blur(al, radius) * 1.6, 0, 1) * strength
    g2 = np.clip(_blur(al, max(1, radius // 3)) * 1.4, 0, 1) * strength * 0.6
    ga = np.clip(np.maximum(g, g2), 0, 1)
    out_a = al + ga * (1 - al)
    rgb = (a[..., :3] * al[..., None] + np.array(color) * (ga * (1 - al))[..., None]) / np.maximum(out_a, 1e-4)[..., None]
    R.write_png(np.dstack([np.clip(rgb, 0, 1), out_a]), path)
    return path


def render_logo(iter_tag=None):
    os.makedirs(UI, exist_ok=True)
    sc = build_logo_scene()
    R.setup_render(1600, 480, samples=128)
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.use_compositing = False
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    big = _glow(R.render_to(os.path.join(UI, 'logo.png')), 16)
    sc.render.resolution_x, sc.render.resolution_y = 600, 180
    small = _glow(R.render_to(os.path.join(UI, 'logo_small.png')), 6)
    PV._save_blend(os.path.join(paths.BLEND, 'ui-logo.blend'))
    # preview: logo over a dark and over the skybox-ish background
    prev = os.path.join(paths.PREVIEWS, 'ui-logo.png')
    a = R.read_png(big)
    bg = np.zeros_like(a)
    bg[..., :3] = (0.03, 0.04, 0.07)
    bg[..., 3] = 1
    al = a[..., 3:4]
    bg[..., :3] = a[..., :3] * al + bg[..., :3] * (1 - al)
    R.write_png(bg, prev)
    return big, small, prev


# ----------------------------------------------------------------------------
# icons (numpy SDF emblem)
# ----------------------------------------------------------------------------
def _sd_poly(px, py, pts):
    """Signed distance to a polygon (negative inside)."""
    d = np.full(px.shape, 1e9, np.float32)
    s = np.ones(px.shape, np.float32)
    n = len(pts)
    for i in range(n):
        (ax, ay), (bx, by) = pts[i], pts[(i + 1) % n]
        ex, ey = bx - ax, by - ay
        wx, wy = px - ax, py - ay
        t = np.clip((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1)
        dx, dy = wx - ex * t, wy - ey * t
        d = np.minimum(d, dx * dx + dy * dy)
        c1 = py >= ay
        c2 = py < by
        c3 = ex * wy > ey * wx
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s = np.where(flip, -s, s)
    return s * np.sqrt(d)


def emblem(size):
    """Dark rounded square + stylized ship/forge chevron (light hull, orange
    trim, cyan engine core) + small star."""
    ss = 4
    N = size * ss
    x, y = T.grid(N)
    y = -y                                            # y up
    aa = 2.0 / N * 1.5

    def cover(d):
        return np.clip(0.5 - d / aa, 0, 1)
    # background rounded square
    q = np.maximum(np.abs(x) - 0.78, 0), np.maximum(np.abs(y) - 0.78, 0)
    d_bg = np.sqrt(q[0] ** 2 + q[1] ** 2) + np.minimum(np.maximum(np.abs(x) - 0.78, np.abs(y) - 0.78), 0) - 0.18
    img = np.zeros((N, N, 4), np.float32)
    t = (y + 1) / 2
    bgc = np.dstack([0.06 + 0.05 * t, 0.075 + 0.06 * t, 0.11 + 0.08 * t])
    a_bg = cover(d_bg)
    border = cover(np.abs(d_bg + 0.025) - 0.012) * a_bg
    col = bgc * (1 - border[..., None]) + np.array([0.25, 0.32, 0.45]) * border[..., None]
    # cyan engine glow under the ship
    r_glow = np.sqrt(x ** 2 + (y + 0.52) ** 2)
    glow = np.exp(-(r_glow / 0.22) ** 2) * 0.9
    col = col + np.array([0.25, 0.85, 1.0]) * glow[..., None] * 0.7
    # ship chevron (outer light hull, inner orange trim)
    outer = [(0.0, 0.70), (0.56, -0.48), (0.22, -0.30), (0.0, -0.40), (-0.22, -0.30), (-0.56, -0.48)]
    inner = [(0.0, 0.42), (0.30, -0.22), (0.12, -0.13), (0.0, -0.19), (-0.12, -0.13), (-0.30, -0.22)]
    d_out = _sd_poly(x, y, outer)
    d_in = _sd_poly(x, y, inner)
    shade = 0.82 + 0.18 * np.clip(-x * 0.6 + y * 0.4, -1, 1)
    hull = np.dstack([0.93 * shade, 0.95 * shade, 0.98 * shade])
    a_out = cover(d_out)
    col = col * (1 - a_out[..., None]) + hull * a_out[..., None]
    a_in = cover(d_in)
    orange = np.array([0.95, 0.48, 0.12])
    col = col * (1 - a_in[..., None]) + orange * a_in[..., None]
    # cockpit gem
    r_c = np.sqrt(x ** 2 + (y - 0.12) ** 2)
    a_c = cover(r_c - 0.085)
    col = col * (1 - a_c[..., None]) + np.array([0.3, 0.88, 1.0]) * a_c[..., None]
    # star top-right
    sx, sy = x - 0.52, y - 0.5
    star = np.maximum(np.exp(-(sx / 0.012) ** 2 - (sy / 0.14) ** 2), np.exp(-(sy / 0.012) ** 2 - (sx / 0.14) ** 2))
    star = np.maximum(star, np.exp(-(sx ** 2 + sy ** 2) / 0.0012))
    col = col + star[..., None] * 0.9
    img[..., :3] = np.clip(col, 0, 1)
    img[..., 3] = a_bg
    # downsample (box filter) with premultiplied averaging
    pm = img[..., :3] * img[..., 3:4]
    pm = pm.reshape(size, ss, size, ss, 3).mean((1, 3))
    al = img[..., 3].reshape(size, ss, size, ss).mean((1, 3))
    rgb = np.where(al[..., None] > 1e-4, pm / np.maximum(al[..., None], 1e-4), 0)
    return np.dstack([rgb, al])


def render_icons():
    os.makedirs(UI, exist_ok=True)
    out = []
    for name, s in (('icon_512.png', 512), ('favicon.png', 64)):
        p = os.path.join(UI, name)
        T.write_png(p, emblem(s))
        out.append(p)
    return out


# ----------------------------------------------------------------------------
# main menu background
# ----------------------------------------------------------------------------
def _flame(name, loc, direction, length, radius):
    """Simple emissive exhaust cone for the hero shot."""
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=radius, radius2=0.0, depth=length, end_fill_type='NOTHING')
    c = bpy.context.active_object
    c.name = name
    q = Vector((0, 0, 1)).rotation_difference(Vector(direction))
    c.rotation_mode = 'QUATERNION'
    c.rotation_quaternion = q
    c.location = Vector(loc) + Vector(direction).normalized() * length / 2
    c.data.materials.append(_emit_alpha('Flame', '#7FE8FF', 6.0, 0.55))
    return c


MENU_OPTIONS = {
    # camera location, look-at target, lens, focus distance
    1: dict(cam=(2.0, 4.0, 2.6), target=(9.0, 40.0, 0.0), lens=35, focus=15.0),
    2: dict(cam=(0.5, 2.0, 6.5), target=(9.5, 40.0, -1.0), lens=35, focus=18.0),
    3: dict(cam=(-3.5, 1.0, 4.0), target=(8.0, 40.0, -1.0), lens=35, focus=19.0),
}


def _exhaust(name, loc, direction):
    """Two nested emissive cones + a point light: main-engine plume."""
    d = Vector(direction).normalized()
    q = Vector((0, 0, 1)).rotation_difference(-d)       # cone tip along the plume
    for k, (length, rad, col, stren, alpha) in enumerate(((0.7, 0.17, '#E8FDFF', 14.0, 0.85),
                                                         (1.6, 0.3, '#3FD2FF', 6.0, 0.3))):
        bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=0.0, radius2=rad, depth=length,
                                        end_fill_type='NOTHING')
        c = bpy.context.active_object
        c.name = f'{name}{k}'
        c.rotation_mode = 'QUATERNION'
        c.rotation_quaternion = q
        c.location = Vector(loc) + d * length / 2
        c.data.materials.append(_emit_alpha(f'Plume{k}', col, stren, alpha))
    ld = bpy.data.lights.new(name + 'L', 'POINT')
    ld.energy = 40
    ld.color = (0.4, 0.85, 1.0)
    ld.shadow_soft_size = 0.3
    lo = bpy.data.objects.new(name + 'L', ld)
    lo.location = Vector(loc) + d * 0.6
    bpy.context.scene.collection.objects.link(lo)


def build_menu_scene():
    import json
    import planets_preview as PP
    G.reset_scene()
    sc = bpy.context.scene
    R.setup_render(2560, 1440, samples=256)
    _world_hdr(0.5)
    sc.view_settings.look = 'AgX - Medium High Contrast'
    for o in list(bpy.data.objects):
        if o.type == 'LIGHT':
            bpy.data.objects.remove(o)
    R._sun('Key', 4.8, (1.0, 0.92, 0.82), (0, 62, -25), angle=1.5)        # warm, from the camera-right
    R._sun('Rim', 4.0, (0.55, 0.78, 1.0), (0, 75, 95), angle=3)           # cool, from behind the station
    R._sun('Fill', 0.5, (0.7, 0.6, 1.0), (0, 40, -140), angle=10)
    # gas giant far below-right
    meta = json.load(open(os.path.join(paths.ROOT, 'public', 'assets', 'planets', 'planets.json'), encoding='utf-8'))
    PP.make_planet('gas_a', meta['gas_a'], (430.0, 900.0, -430.0), 230.0, spin=255)
    # home station, docking arm toward the camera
    st_loc, st_rot = (15.0, 76.0, 1.5), -90
    before = set(bpy.data.objects)
    PV.import_glb(os.path.join(paths.STATIONS, 'station_home.glb'), loc=st_loc, rot_z=st_rot)
    PV.import_glb(os.path.join(paths.STATIONS, 'dock_clamp.glb'),
                  loc=(st_loc[0], st_loc[1] - 14.0, st_loc[2]), rot_z=st_rot)
    # tilt the whole station toward the camera so the ring reads as an ellipse
    from mathutils import Matrix
    tilt = Matrix.Translation(st_loc) @ Matrix.Rotation(math.radians(22), 4, 'X') @ Matrix.Translation(
        [-c for c in st_loc])
    for o in bpy.data.objects:
        if o not in before and o.parent is None:
            o.matrix_world = tilt @ o.matrix_world
    # titanium starter ship flying away from the camera toward the station (bow +Y)
    ship_rot, ox, oy = 90, 7.0, 18.0
    cr, sr = math.cos(math.radians(ship_rot)), math.sin(math.radians(ship_rot))
    placed = []
    for f, (x, y), r in PV.M1_SHIP:
        X, Y = ox + x * cr - y * sr, oy + x * sr + y * cr
        placed.append((f.replace('_iron', '_titanium'), (X, Y), r + ship_rot))
    PV.build_ship(placed, connectors=True)
    for (x, y) in ((-1, 1), (-1, -1)):          # forward engines: nozzle exit at local x = -1.47
        X, Y = ox + (-1.47) * cr - y * sr, oy + (-1.47) * sr + y * cr
        _exhaust(f'Exhaust{y}', (X, Y, -0.02), (-cr, -sr, 0))
    PV.add_rocks([
        ('asteroid_iron_c', (15.5, 9.5, -2.4), 40),             # foreground lower right (defocused)
        ('asteroid_copper_b', (27.0, 50.0, 8.0), 110),
        ('asteroid_titanium_a', (25.0, 64.0, -7.0), 200),
        ('asteroid_ice_b', (34.0, 95.0, -4.0), 10),
        ('asteroid_frag_iron_a', (13.0, 9.0, 1.4), 20),
        ('asteroid_frag_titanium_b', (20.0, 24.0, 3.0), 80),
    ])
    for o in bpy.data.objects:
        if o.parent is None and o.name.startswith('asteroid_iron_c'):
            o.scale = (1.3, 1.3, 1.3)
    cam = R.make_camera(lens=35)
    cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.sensor_width = 36
    cam.data.clip_end = 5000
    cam.data.dof.use_dof = True
    cam.data.dof.aperture_fstop = 2.2
    return sc, cam


def render_menu(options=(1, 2, 3), iter_tag=None):
    """Render composition options to art/out/previews/ui-menu-opt<n>.png."""
    sc, cam = build_menu_scene()
    out = []
    for n in options:
        o = MENU_OPTIONS[n]
        cam.data.lens = o['lens']
        cam.location = o['cam']
        cam.rotation_euler = (Vector(o['target']) - Vector(o['cam'])).to_track_quat('-Z', 'Y').to_euler()
        cam.data.dof.focus_distance = o['focus']
        p = R.render_to(os.path.join(paths.PREVIEWS, f'ui-menu-opt{n}.png'))
        out.append(p)
        if iter_tag:
            shutil.copyfile(p, os.path.join(paths.PREVIEWS, 'iterations', f'{iter_tag}-ui-menu-opt{n}.png'))
    PV._save_blend(os.path.join(paths.BLEND, 'ui-menu.blend'))
    return out


def finalize_menu(n):
    """Write the chosen option as menu_bg.jpg / menu_bg_1080.jpg plus a 16:10
    centre-crop check (art/out/previews/ui-menu-16x10.png)."""
    src = os.path.join(paths.PREVIEWS, f'ui-menu-opt{n}.png')
    img = bpy.data.images.load(src)
    out = []
    for name, (w, h) in (('menu_bg.jpg', (2560, 1440)), ('menu_bg_1080.jpg', (1920, 1080))):
        im = img.copy()
        if (w, h) != tuple(im.size):
            im.scale(w, h)
        im.file_format = 'JPEG'
        im.save(filepath=os.path.join(UI, name), quality=92)
        out.append(os.path.join(UI, name))
    a = R.read_png(src)
    cw = int(1440 * 1.6)
    x0 = (2560 - cw) // 2
    crop = a[:, x0:x0 + cw]
    R.write_png(crop, os.path.join(paths.PREVIEWS, 'ui-menu-16x10.png'))
    shutil.copyfile(src, os.path.join(paths.PREVIEWS, 'ui-menu.png'))
    return out


# ----------------------------------------------------------------------------
# main menu background v2 (art audit 2026-10-16, batch D4): current assets -
# detail-pass home station with the v2 clamp + caged beacons, traffic (trader
# + Guild cutter escort, cargo drone), the titanium starter ship on approach,
# a rust-clan Jackal lurking far off, the ringed gas giant, the Guild relay
# landmark far away.  Left ~35 % stays calm and dark for the menu panel.
# ----------------------------------------------------------------------------
MENU2_OPTIONS = {
    1: dict(cam=(-6.0, -4.0, 7.0), target=(16.0, 52.0, -1.5), lens=30),
    2: dict(cam=(-4.0, -2.0, 9.5), target=(15.0, 50.0, -3.0), lens=32),
}


def _plume(name, loc, direction, scale=1.0):
    """Engine plume (two nested emissive cones + point light) leaving `loc` along `direction`."""
    d = Vector(direction).normalized()
    q = Vector((0, 0, 1)).rotation_difference(-d)
    for k, (length, rad, col, stren, alpha) in enumerate(((0.7, 0.17, '#E8FDFF', 14.0, 0.85),
                                                         (1.7, 0.3, '#3FD2FF', 6.0, 0.3))):
        bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=0.0, radius2=rad * scale, depth=length * scale,
                                        end_fill_type='NOTHING')
        c = bpy.context.active_object
        c.name = f'{name}{k}'
        c.rotation_mode = 'QUATERNION'
        c.rotation_quaternion = q
        c.location = Vector(loc) + d * length * scale / 2
        c.data.materials.append(_emit_alpha(f'Plume{name}{k}', col, stren, alpha))
    ld = bpy.data.lights.new(name + 'L', 'POINT')
    ld.energy = 30 * scale
    ld.color = (0.4, 0.85, 1.0)
    lo = bpy.data.objects.new(name + 'L', ld)
    lo.location = Vector(loc) + d * 0.6 * scale
    bpy.context.scene.collection.objects.link(lo)


def _glow_ball(name, loc, hexcol, r=0.12, strength=30.0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=r, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(_emit_alpha(name, hexcol, strength, 1.0))
    return o


def _import_at(path, loc, rot_z=0.0, scale=1.0):
    roots, objs = PV.import_glb(path, loc=loc, rot_z=rot_z)
    for r in roots:
        r.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    return roots, objs


def _thrusters(objs, scale=1.0, prefix='T'):
    bpy.context.view_layer.update()
    for o in objs:
        if o.name.startswith('thruster_'):
            mw = o.matrix_world
            d = mw.to_3x3() @ Vector((1, 0, 0))
            _plume(f'{prefix}{o.name}', mw.translation, d, scale)


def build_menu_scene_v2():
    import json
    from mathutils import Matrix
    import planets_preview as PP
    import preview_pirate_parts as PPP
    G.reset_scene()
    sc = bpy.context.scene
    R.setup_render(2560, 1600, samples=256)
    _world_hdr(0.42)
    sc.view_settings.look = 'AgX - Medium High Contrast'
    for o in list(bpy.data.objects):
        if o.type == 'LIGHT':
            bpy.data.objects.remove(o)
    R._sun('Key', 4.6, (1.0, 0.92, 0.82), (0, 58, -35), angle=1.5)        # warm, from the camera-right
    R._sun('Rim', 4.2, (0.55, 0.78, 1.0), (0, 72, 110), angle=3)          # cool, from behind the station
    R._sun('Fill', 0.45, (0.7, 0.6, 1.0), (0, 40, -150), angle=10)
    meta = json.load(open(os.path.join(paths.ROOT, 'public', 'assets', 'planets', 'planets.json'), encoding='utf-8'))
    # ringed gas giant far below-right
    gloc, grad = (980.0, 1450.0, -820.0), 330.0
    PP.make_planet('gas_giant', meta['gas_giant'], gloc, grad, spin=250, tilt=16)
    rr, _ = _import_at(os.path.join(paths.MODELS, 'planets', 'gas_giant_rings.glb'), gloc)
    for r in rr:
        r.scale = (grad, grad, grad)
        r.rotation_mode = 'XYZ'
        r.rotation_euler = (math.radians(16), 0, math.radians(250))
    # Guild relay landmark, far away up-right, dim
    _import_at(os.path.join(paths.MODELS, 'landmarks', 'guild_relay.glb'), (1500.0, 3600.0, 260.0), rot_z=30,
               scale=1.6)
    # home station, tilted toward the camera, dock arm toward the lower left
    st_loc, st_rot = (19.0, 66.0, 0.0), -128.0
    before = set(bpy.data.objects)
    roots, sobjs = _import_at(os.path.join(paths.STATIONS, 'station_home.glb'), st_loc, rot_z=st_rot)
    port = next(o for o in sobjs if o.name.startswith('dock_port'))
    croots, _ = PV.import_glb(os.path.join(paths.STATIONS, 'dock_clamp.glb'))
    for c in croots:
        c.parent = port
        c.matrix_parent_inverse = Matrix.Identity(4)
        c.location = (0, 0, 0)
        c.rotation_euler = (0, 0, 0)
    tilt = Matrix.Translation(st_loc) @ Matrix.Rotation(math.radians(20), 4, 'X') @ Matrix.Translation(
        [-c for c in st_loc])
    for o in bpy.data.objects:
        if o not in before and o.parent is None:
            o.matrix_world = tilt @ o.matrix_world
    bpy.context.view_layer.update()
    # trader leaving toward the upper right with a Guild cutter escort
    _, tro = _import_at(os.path.join(paths.MODELS, 'npc', 'trader.glb'), (40.0, 92.0, 4.0), rot_z=58)
    _thrusters(tro, 1.4, 'Tr')
    cutter = os.path.join(paths.MODELS, 'npc', 'guild_cutter.glb')
    if os.path.exists(cutter):
        _, cro = _import_at(cutter, (47.0, 102.0, 7.5), rot_z=62)
        _thrusters(cro, 1.0, 'Cu')
        bpy.context.view_layer.update()
        for o in cro:
            if o.name.startswith('strobe_'):
                _glow_ball('Strobe' + o.name, o.matrix_world.translation, '#9CCBFF', r=0.1, strength=60)
    # cargo drone on a route near the station
    _, dro = _import_at(os.path.join(paths.MODELS, 'drones', 'drone_cargo.glb'), (8.0, 56.0, 3.5), rot_z=-30,
                        scale=1.2)
    _thrusters(dro, 0.5, 'Dr')
    # titanium starter ship approaching the dock (bow toward the station)
    ship_rot, ox, oy = 68, 6.5, 24.0
    cr, sr = math.cos(math.radians(ship_rot)), math.sin(math.radians(ship_rot))
    placed = []
    for f, (x, y), r in PV.M1_SHIP:
        X, Y = ox + x * cr - y * sr, oy + x * sr + y * cr
        placed.append((f.replace('_iron', '_titanium'), (X, Y), r + ship_rot))
    PV.build_ship(placed, connectors=True)
    for (x, y) in ((-1, 1), (-1, -1)):          # main engines: nozzle exit at local x = -1.47
        X, Y = ox + (-1.47) * cr - y * sr, oy + (-1.47) * sr + y * cr
        _plume(f'Ex{y}', (X, Y, -0.02), (-cr, -sr, 0))
    # rust-clan Jackal lurking far off on the right, half behind a rock
    PPP.build_ship(PPP.JACKAL, 'rust', 'iron', origin=(50.0, 100.0), rot=215)
    PV.add_rocks([
        ('asteroid_copper_b', (30.0, 46.0, 6.0), 110),
        ('asteroid_titanium_a', (44.0, 70.0, -9.0), 200),
        ('asteroid_ice_b', (53.5, 103.5, 1.0), 10),
        ('asteroid_iron_a', (70.0, 124.0, -2.0), 70),
        ('asteroid_frag_iron_a', (14.0, 15.0, 2.2), 20),
        ('asteroid_frag_titanium_b', (26.0, 28.0, 4.0), 80),
    ])
    for o in bpy.data.objects:
        if o.parent is None and o.name.startswith('asteroid_iron_c'):
            o.scale = (1.4, 1.4, 1.4)
    cam = R.make_camera(lens=32)
    cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.sensor_width = 36
    cam.data.clip_end = 6000
    cam.data.dof.use_dof = True
    cam.data.dof.aperture_fstop = 2.8
    return sc, cam


def render_menu2(options=(1, 2), iter_tag=None):
    """Render v2 composition options to art/out/previews/ui-menu2-opt<n>.png (2560 x 1600)."""
    sc, cam = build_menu_scene_v2()
    out = []
    for n in options:
        o = MENU2_OPTIONS[n]
        cam.data.lens = o['lens']
        cam.location = o['cam']
        cam.rotation_euler = (Vector(o['target']) - Vector(o['cam'])).to_track_quat('-Z', 'Y').to_euler()
        cam.data.dof.focus_distance = (Vector((12.0, 30.0, 0.0)) - Vector(o['cam'])).length
        p = R.render_to(os.path.join(paths.PREVIEWS, f'ui-menu2-opt{n}.png'))
        out.append(p)
        if iter_tag:
            shutil.copyfile(p, os.path.join(paths.PREVIEWS, 'iterations', f'{iter_tag}-ui-menu2-opt{n}.png'))
    PV._save_blend(os.path.join(paths.BLEND, 'ui-menu2.blend'))
    return out


def finalize_menu2(n):
    """Write v2 option n as menu_bg.jpg (2560 x 1600) / menu_bg_1080.jpg (1920 x 1080, centre crop of the
    16:10 frame to 16:9) + art/out/previews/ui-menu.png."""
    src = os.path.join(paths.PREVIEWS, f'ui-menu2-opt{n}.png')
    out = []
    ims = bpy.context.scene.render.image_settings
    ims.file_format = 'JPEG'
    ims.color_mode = 'RGB'
    ims.quality = 88
    img = bpy.data.images.load(src)
    img.save_render(os.path.join(UI, 'menu_bg.jpg'))           # Image.save ignores the quality
    out.append(os.path.join(UI, 'menu_bg.jpg'))
    a = R.read_png(src)                       # rows bottom-up
    ch = int(2560 * 9 / 16)
    y0 = (1600 - ch) // 2
    crop = a[y0:y0 + ch]
    tmp = os.path.join(paths.PREVIEWS, 'ui-menu2-16x9.png')
    R.write_png(crop, tmp)
    im = bpy.data.images.load(tmp)
    im.scale(1920, 1080)
    im.save_render(os.path.join(UI, 'menu_bg_1080.jpg'))
    out.append(os.path.join(UI, 'menu_bg_1080.jpg'))
    shutil.copyfile(src, os.path.join(paths.PREVIEWS, 'ui-menu.png'))
    return out


def main(argv):
    only = set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else {'logo', 'menu', 'icons'}
    tag = argv[argv.index('--iter') + 1] if '--iter' in argv else None
    made = []
    if 'icons' in only:
        made += render_icons()
    if 'logo' in only:
        made += list(render_logo())
    if 'menu' in only:
        opts = tuple(int(x) for x in argv[argv.index('--options') + 1].split(',')) if '--options' in argv else (1, 2, 3)
        made += render_menu(opts, tag)
    if 'menu2' in only:
        opts = tuple(int(x) for x in argv[argv.index('--options') + 1].split(',')) if '--options' in argv else (1, 2)
        made += render_menu2(opts, tag)
    if '--final2' in argv:
        made += finalize_menu2(int(argv[argv.index('--final2') + 1]))
    if '--final' in argv:
        made += finalize_menu(int(argv[argv.index('--final') + 1]))
    if tag:
        it = os.path.join(paths.PREVIEWS, 'iterations')
        for p in made:
            if p.endswith(('ui-logo.png', 'ui-menu.png', 'icon_512.png')):
                shutil.copyfile(p, os.path.join(it, f'{tag}-{os.path.basename(p)}'))
    for p in made:
        print('UI', p)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
