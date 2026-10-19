"""M2d previews: multi-cell + new parts, a ship using them, veined asteroids
with a simulated active vein segment, and the new icons.

  blender --background --factory-startup --python art/blender/preview_m2d.py -- [--only parts,ship,veins,icons] [--iter w1]

Outputs (art/out/previews/): m2d-parts.png, m2d-ship.png (+ m2d-ship-gamescale.png),
m2d-veins.png, m2d-icons.png; m2d-ship.blend / m2d-veins.blend in art/out/blend/.
"""
import math
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
from lib import render as R  # noqa: E402

TMP = os.path.join(paths.OUT, 'tmp_tiles_m2d')

# part module -> footprint (w along X, h along Y)
CELLS = {'heavy_laser': (2, 1), 'large_cargo': (2, 2), 'battery': (1, 1), 'tractor_beam': (1, 1)}


def _turn(objs, node, deg):
    for o in objs:
        if o.name.startswith(node):
            o.rotation_mode = 'XYZ'
            o.rotation_euler = (o.rotation_euler[0], o.rotation_euler[1], math.radians(deg))
    bpy.context.view_layer.update()


def _clear():
    for o in list(bpy.data.objects):
        if o.type in ('MESH', 'EMPTY'):
            bpy.data.objects.remove(o)


# ----------------------------------------------------------------------------
# parts sheet
# ----------------------------------------------------------------------------
PARTS = [  # (module, label, turn node, turn deg)
    ('heavy_laser', 'HEAVY LASER  2x1', 'Laser_Head', -30),
    ('large_cargo', 'LARGE CARGO  2x2', None, 0),
    ('battery', 'BATTERY  1x1', None, 0),
    ('tractor_beam', 'TRACTOR BEAM  1x1', 'Tractor_Head', -30),
]


def parts_sheet(out_png, tile_w=798, tile_h=448):
    cam = PV._new_scene(tile_w, tile_h, 128, key_az=-120)
    tiles = []
    for i, (part, label, node, deg) in enumerate(PARTS):
        _clear()
        w, h = CELLS[part]
        objs = []
        gap = 0.62 + 0.5 * (h - 1) + 0.25 * (w - 1)
        for tier, side in (('iron', -1), ('titanium', 1)):
            loc = (side * gap * 0.55, -side * gap * 0.9, 0)
            _, new = PV.import_glb(os.path.join(paths.PARTS, f'{part}_{tier}.glb'), loc=loc)
            if node:
                _turn(new, node, deg)
            objs += new
        c, r = R.bounds(objs)
        R.aim_camera(cam, c, 38, -58, R.fit_distance(cam, r, margin=0.84))
        labs = [R.camera_label(cam, label, y_frac=0.42, size_frac=0.05),
                R.camera_label(cam, 'T1  IRON', y_frac=-0.43, x_frac=-0.16, size_frac=0.04),
                R.camera_label(cam, 'T2  TITANIUM', y_frac=-0.43, x_frac=0.16, size_frac=0.04)]
        if node:
            labs.append(R.camera_label(cam, f'{node} turned {deg} deg', y_frac=0.35, size_frac=0.03))
        tiles.append(R.render_to(os.path.join(TMP, f'p_{i}.png')))
        for lb in labs:
            bpy.data.objects.remove(lb)
    # tile 5: salvage cargo container (tumbling copies + a 1x1 part for scale)
    _clear()
    objs = []
    for k, (loc, rot) in enumerate((((-0.9, 0.5, 0.25), (0, 0, 20)), ((0.75, -0.2, 0.45), (25, 40, -35)),
                                    ((-0.2, -1.5, 0.3), (70, 10, 100)))):
        _, new = PV.import_glb(os.path.join(paths.MODELS, 'props', 'cargo_container.glb'), loc=loc)
        for o in new:
            if o.parent is None:
                o.rotation_euler = [math.radians(a) for a in rot]
        objs += new
    _, ref = PV.import_glb(os.path.join(paths.PARTS, 'cargo_iron.glb'), loc=(1.4, 1.3, 0))
    bpy.context.view_layer.update()
    c, r = R.bounds(objs + ref)
    R.aim_camera(cam, c, 38, -58, R.fit_distance(cam, r, margin=0.8))
    labs = [R.camera_label(cam, 'CARGO CONTAINER  (salvage prop, beacon_0)', y_frac=0.42, size_frac=0.045),
            R.camera_label(cam, '1x1 cargo for scale', y_frac=-0.43, x_frac=0.2, size_frac=0.035)]
    tiles.append(R.render_to(os.path.join(TMP, 'p_4.png')))
    for lb in labs:
        bpy.data.objects.remove(lb)
    # tile 6: top-down footprint check - aim extremes with cell outlines
    _clear()
    objs = []
    for f, loc, node, deg in (('heavy_laser_titanium', (0, 0.9, 0), 'Laser_Head', 60),
                              ('heavy_laser_iron', (0, -0.9, 0), 'Laser_Head', -60),
                              ('tractor_beam_titanium', (2.6, 0.9, 0), 'Tractor_Head', 90),
                              ('tractor_beam_iron', (2.6, -0.9, 0), 'Tractor_Head', -90)):
        _, new = PV.import_glb(os.path.join(paths.PARTS, f + '.glb'), loc=loc)
        _turn(new, node, deg)
        objs += new
        w, h = _footprint(f)
        objs.append(_outline(loc, w, h))
    c, r = R.bounds(objs)
    R.aim_camera(cam, c, 89.9, -90, R.fit_distance(cam, r, margin=0.75))
    labs = [R.camera_label(cam, 'FOOTPRINT CHECK  (top view, aim at the arc limits)', y_frac=0.43, size_frac=0.04),
            R.camera_label(cam, 'heavy laser +-60', y_frac=-0.45, x_frac=-0.18, size_frac=0.032),
            R.camera_label(cam, 'tractor beam +-90', y_frac=-0.45, x_frac=0.2, size_frac=0.032)]
    tiles.append(R.render_to(os.path.join(TMP, 'p_5.png')))
    for lb in labs:
        bpy.data.objects.remove(lb)
    R.stitch(tiles, 2, tile_w, tile_h, out_png, gap=4)


def _outline(loc, w, h, z=0.62):
    """Thin glowing rectangle = the part's grid footprint (+-w/2, +-h/2)."""
    from lib import geo as G
    m = bpy.data.materials.get('AF_Outline')
    if m is None:
        m = bpy.data.materials.new('AF_Outline')
        nt = m.node_tree
        nt.nodes.clear()
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (0.3, 1.0, 0.4, 1)
        em.inputs['Strength'].default_value = 2.0
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    x, y, _ = loc
    t = 0.012
    pcs = []
    for (x0, x1, y0, y1) in ((-w / 2, w / 2, h / 2 - t, h / 2 + t), (-w / 2, w / 2, -h / 2 - t, -h / 2 + t),
                             (w / 2 - t, w / 2 + t, -h / 2, h / 2), (-w / 2 - t, -w / 2 + t, -h / 2, h / 2)):
        b = G.box('Outline', x + x0, x + x1, y + y0, y + y1, z, z + 0.002, 'hull_light')
        b.data.materials.clear()
        b.data.materials.append(m)
        pcs.append(b)
    ob = G.join(pcs, 'Outline')
    ob.visible_shadow = False
    return ob


# ----------------------------------------------------------------------------
# ship with multi-cell parts
# ----------------------------------------------------------------------------
# (part file, footprint centre (x, y), rotation deg, cells (w, h))
M2D_SHIP = [
    ('cockpit_iron', (2, 0), 0),
    ('heavy_laser_iron', (3.5, 0), 0),          # cells (3,0),(4,0)
    ('gyroscope_iron', (1, 0), 0),
    ('reactor_iron', (0, 0), 0),
    ('large_cargo_iron', (-1.5, 0.5), 0),       # cells (-2..-1, 0..1)
    ('battery_iron', (-1, -1), 0),
    ('cargo_iron', (-2, -1), 0),
    ('cargo_iron', (0, 1), 0), ('cargo_iron', (0, -1), 0),
    ('tractor_beam_iron', (2, 1), 0),
    ('fuel_tank_iron', (1, 1), 0),
    ('radar_iron', (2, -1), 0),
    ('mining_laser_iron', (3, -1), 0),
    ('armor_iron', (1, -1), 0),
    ('engine_iron', (-3, 1), 0), ('engine_iron', (-3, 0), 0), ('engine_iron', (-3, -1), 0),
    ('engine_iron', (3, 1), 180),
    ('engine_iron', (0, -2), 90),
    ('engine_iron', (0, 2), 270),
]


def _footprint(f):
    for mod, wh in CELLS.items():
        if f.startswith(mod):
            return wh
    return (1, 1)


def part_cells(layout):
    """[(part index, cell)] for every occupied grid cell.  A w x h part centred
    at (cx, cy) with rotation 0/180 covers w cells along X, h along Y (swapped
    for 90/270)."""
    out = []
    for i, (f, (cx, cy), rot) in enumerate(layout):
        w, h = _footprint(f)
        if rot % 180:
            w, h = h, w
        for a in range(w):
            for b in range(h):
                out.append((i, (round(cx - (w - 1) / 2 + a), round(cy - (h - 1) / 2 + b))))
    return out


def connector_placements_multi(layout):
    """README rule extended to multi-cell parts: edge connectors only between
    cells of DIFFERENT parts (no internal seams); corner connectors where all
    four cells are occupied unless they all belong to the same part."""
    owner = {c: i for i, c in part_cells(layout)}
    out = []
    for (x, y) in sorted(owner):
        o = owner[(x, y)]
        if (x + 1, y) in owner and owner[(x + 1, y)] != o:
            out.append(('hull_connector_edge', (x + 0.5, y), 0))
        if (x, y + 1) in owner and owner[(x, y + 1)] != o:
            out.append(('hull_connector_edge', (x, y + 0.5), 90))
        quad = [(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)]
        if all(q in owner for q in quad) and len({owner[q] for q in quad}) > 1:
            out.append(('hull_connector_corner', (x + 0.5, y + 0.5), 0))
    return out


def build_ship_multi(layout, connectors=True):
    objs = []
    for f, (x, y), rot in layout:
        _, new = PV.import_glb(os.path.join(paths.PARTS, f + '.glb'), loc=(x, y, 0), rot_z=rot)
        objs += new
    if connectors:
        for f, (x, y), rot in connector_placements_multi(layout):
            _, new = PV.import_glb(os.path.join(paths.PARTS, f + '.glb'), loc=(x, y, 0), rot_z=rot)
            objs += new
    return objs


def ship_shot(out_png, gamescale_png, blend_path):
    cam = PV._new_scene(1600, 900, 160, seed=3.0, key_az=-140)
    objs = build_ship_multi(M2D_SHIP)
    _turn(objs, 'Laser_Head', 0)
    c, r = R.bounds([o for o in objs if o.type == 'MESH'])
    centre = (c[0], c[1], 0.0)
    R.aim_camera(cam, centre, 55, -90, 13.0)
    R.render_to(out_png)
    rocks = PV.add_rocks([('asteroid_iron_c', (-12.0, 5.0, -1.5), 30), ('asteroid_copper_b', (12.5, 4.5, -1.8), 70),
                          ('asteroid_titanium_c', (-11.0, -5.0, -1.2), 140),
                          ('asteroid_iron_a', (11.0, -5.2, -1.4), 200)])
    R.aim_camera(cam, centre, 55, -90, 40.0)
    R.render_to(gamescale_png)
    PV._hide(rocks, True)
    R.aim_camera(cam, centre, 55, -90, 13.0)
    PV._save_blend(blend_path)


# ----------------------------------------------------------------------------
# veined asteroids with a simulated active segment
# ----------------------------------------------------------------------------
VEIN_KINDS = ('iron', 'copper', 'titanium')


def vein_material(base_mat, seg=(0.4, 0.6), boost=3.0, add=(1.0, 0.75, 0.5)):
    """Preview stand-in for the game's vein shader: AF_Palette (+ vertex colour)
    with the emission boosted where the vein's second UV set u is inside
    `seg` (soft 0.04 edges): emission * (1 + mask * boost) + mask * add * 0.6."""
    m = base_mat.copy()
    m.name = f'{base_mat.name}_VeinActive'
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N.get('Principled BSDF')
    uv = N.new('ShaderNodeUVMap')
    uv.uv_map = 'VeinUV'
    sep = N.new('ShaderNodeSeparateXYZ')
    L.new(uv.outputs['UV'], sep.inputs['Vector'])
    a = N.new('ShaderNodeMapRange')
    a.inputs['From Min'].default_value = seg[0] - 0.04
    a.inputs['From Max'].default_value = seg[0] + 0.04
    b = N.new('ShaderNodeMapRange')
    b.inputs['From Min'].default_value = seg[1] + 0.04
    b.inputs['From Max'].default_value = seg[1] - 0.04
    L.new(sep.outputs['X'], a.inputs['Value'])
    L.new(sep.outputs['X'], b.inputs['Value'])
    mn = N.new('ShaderNodeMath')
    mn.operation = 'MINIMUM'
    L.new(a.outputs['Result'], mn.inputs[0])
    L.new(b.outputs['Result'], mn.inputs[1])
    # emission colour = atlas emission * (1 + mask * boost) + mask * white-ish
    src = bsdf.inputs['Emission Color'].links[0].from_socket
    k = N.new('ShaderNodeMath')
    k.operation = 'MULTIPLY_ADD'
    k.inputs[1].default_value = boost
    k.inputs[2].default_value = 1.0
    L.new(mn.outputs['Value'], k.inputs[0])
    mul = N.new('ShaderNodeVectorMath')
    mul.operation = 'SCALE'
    L.new(src, mul.inputs[0])
    L.new(k.outputs['Value'], mul.inputs['Scale'])
    hl = N.new('ShaderNodeVectorMath')
    hl.operation = 'SCALE'
    hl.inputs[0].default_value = tuple(c * 0.6 for c in add)
    L.new(mn.outputs['Value'], hl.inputs['Scale'])
    tot = N.new('ShaderNodeVectorMath')
    tot.operation = 'ADD'
    L.new(mul.outputs['Vector'], tot.inputs[0])
    L.new(hl.outputs['Vector'], tot.inputs[1])
    L.new(tot.outputs['Vector'], bsdf.inputs['Emission Color'])
    return m


def _vein_objects(objs):
    return [o for o in objs if o.type == 'MESH' and o.name.split('.')[0].startswith('Vein_')]


HL = {'iron': (1.0, 0.45, 0.15), 'copper': (1.0, 0.75, 0.3), 'titanium': (0.75, 0.85, 1.0)}


def activate_veins(objs, seg=(0.4, 0.6), kind='iron'):
    cache = {}
    for o in _vein_objects(objs):
        uvs = [u.name for u in o.data.uv_layers]
        if len(uvs) > 1 and uvs[1] != 'VeinUV':
            o.data.uv_layers[1].name = 'VeinUV'
        for slot in o.material_slots:
            m = slot.material
            if m.name not in cache:
                cache[m.name] = vein_material(m, seg, add=HL[kind])
            slot.material = cache[m.name]


def veins_sheet(out_png, blend_path):
    """Left: the 9 veined rocks (3x3 grid, active segment u 0.4-0.6 on every
    vein).  Right: close-up of one rock."""
    W, H = 1600, 900
    cam = PV._new_scene(1000, 900, 160, seed=3.0, key_az=-140)
    allobjs = []
    for i, k in enumerate(VEIN_KINDS):
        for j, v in enumerate('abc'):
            _, new = PV.import_glb(os.path.join(paths.ASTEROIDS, f'asteroid_{k}_{v}.glb'),
                                   loc=(-6.4 + j * 8.0, 8.6 - i * 8.6, 0), rot_z=0)
            activate_veins(new, kind=k)
            allobjs += new
    R.aim_camera(cam, (1.6, -1.2, 0.0), 55, -90, 44.0)
    labs = []
    for i, k in enumerate(VEIN_KINDS):
        labs.append(R.camera_label(cam, k.upper(), y_frac=0.36 - i * 0.30, x_frac=-0.48, size_frac=0.022,
                                   align='LEFT'))
    for j, v in enumerate('abc'):
        labs.append(R.camera_label(cam, v.upper(), y_frac=0.465, x_frac=-0.22 + j * 0.215, size_frac=0.024))
    left = R.render_to(os.path.join(TMP, 'veins_left.png'))
    for lb in labs:
        bpy.data.objects.remove(lb)
    PV._save_blend(blend_path)
    # close-up
    cam2 = PV._new_scene(596, 900, 192, seed=5.0, key_az=-140)
    _, rock = PV.import_glb(os.path.join(paths.ASTEROIDS, 'asteroid_iron_b.glb'), loc=(0, 0, 0))
    activate_veins(rock, kind='iron')
    c, r = R.bounds(rock)
    R.aim_camera(cam2, c, 55, -90, R.fit_distance(cam2, r, margin=0.95))
    R.camera_label(cam2, 'IRON B close-up\nactive segment u 0.4-0.6', y_frac=-0.43, size_frac=0.028)
    right = R.render_to(os.path.join(TMP, 'veins_right.png'))
    a, b = R.read_png(left), R.read_png(right)
    canvas = np.zeros((H, W, 4), np.float32)
    canvas[..., 3] = 1
    canvas[:, :1000] = a
    canvas[:, 1004:] = b
    canvas[:, 1000:1004, :3] = (0.02, 0.025, 0.035)
    R.write_png(canvas, out_png)


# ----------------------------------------------------------------------------
# icons
# ----------------------------------------------------------------------------
def icons_sheet(out_png):
    """New part icons at 2x (T1 top row, T2 middle row) + a 1:1 strip mixing
    existing and new T1 icons (as the build UI shows them)."""
    W, H_ = 1600, 900
    bg = np.zeros((H_, W, 4), dtype=np.float32)
    bg[..., 0], bg[..., 1], bg[..., 2], bg[..., 3] = 0.035, 0.045, 0.06, 1.0

    def paste(path, cx, cy_top, scale=1):
        a = R.read_png(path)
        if scale != 1:
            a = a.repeat(scale, 0).repeat(scale, 1)
        h, w, _ = a.shape
        x0, y0 = cx - w // 2, H_ - cy_top - h
        al = a[..., 3:4]
        reg = bg[y0:y0 + h, x0:x0 + w, :3]
        bg[y0:y0 + h, x0:x0 + w, :3] = a[..., :3] * al + reg * (1 - al)

    ids = ['heavyLaser', 'largeCargo', 'battery', 'tractorBeam']
    for row, tn in enumerate((1, 2)):
        for i, pid in enumerate(ids):
            paste(os.path.join(paths.ICONS, 'parts', f'{pid}_t{tn}.png'), 290 + i * 340, 40 + row * 290, 2)
    strip = ['cockpit', 'miningLaser', 'cargo', 'reactor', 'heavyLaser', 'largeCargo', 'battery', 'tractorBeam']
    for i, pid in enumerate(strip):
        paste(os.path.join(paths.ICONS, 'parts', f'{pid}_t1.png'), 275 + i * 150, 690, 1)
    R.write_png(bg, out_png)


def main(only=None, iter_tag=None):
    os.makedirs(paths.PREVIEWS, exist_ok=True)
    P = paths.PREVIEWS
    files = []
    if not only or 'parts' in only:
        p = os.path.join(P, 'm2d-parts.png')
        parts_sheet(p)
        files.append((p, 'm2d-parts'))
    if not only or 'ship' in only:
        p = os.path.join(P, 'm2d-ship.png')
        g = os.path.join(P, 'm2d-ship-gamescale.png')
        ship_shot(p, g, os.path.join(paths.BLEND, 'm2d-ship.blend'))
        files += [(p, 'm2d-ship'), (g, 'm2d-ship-gamescale')]
    if not only or 'veins' in only:
        p = os.path.join(P, 'm2d-veins.png')
        veins_sheet(p, os.path.join(paths.BLEND, 'm2d-veins.blend'))
        files.append((p, 'm2d-veins'))
    if not only or 'icons' in only:
        p = os.path.join(P, 'm2d-icons.png')
        icons_sheet(p)
        files.append((p, 'm2d-icons'))
    shutil.rmtree(TMP, ignore_errors=True)
    PV._keep_iterations(iter_tag, files)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else None,
         argv[argv.index('--iter') + 1] if '--iter' in argv else None)
