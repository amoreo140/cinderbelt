"""M5b base / drone / cruise / home-module previews (called from preview_m5b.py)."""
import math
import os

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
import planets_preview as PP  # noqa: E402
import preview_m5b as M5  # noqa: E402
from lib import render as R  # noqa: E402

TMP = M5.TMP
P = paths.PREVIEWS


def _by_name(objs, name):
    for o in objs:
        if o.name == name or o.name.split('.')[0] == name:
            return o
    return None


def _hide_tree(o, hidden=True):
    for x in [o] + list(o.children_recursive):
        x.hide_render = hidden
        x.hide_viewport = hidden


def place_base(origin, level=3, mode='ground', layout=None, yaw=0.0, scale=1.0):
    """Import the hub + modules (from base_modules.json conventions) at `origin` (surface point, +Z up)."""
    import base_modules as BM
    layout = layout if layout is not None else (BM.PREVIEW_FIT if mode == 'ground' else BM.PREVIEW_FIT_FLOAT)
    hub = M5._imp('base', 'base_hub')
    root = [o for o in hub if o.parent is None][0]
    root.location = origin
    root.rotation_euler = (0, 0, math.radians(yaw))
    root.scale = (scale, scale, scale)
    _hide_tree(_by_name(hub, 'Hub_Floats' if mode == 'ground' else 'Hub_Legs'))
    for n in (2, 3):
        if level < n:
            _hide_tree(_by_name(hub, f'Hub_Upgrade_{n}'))
    for i in range(8):
        if i not in BM.LEVEL_SLOTS[level]:
            _hide_tree(_by_name(hub, f'Pad_{i}'))
    bpy.context.view_layer.update()
    objs = list(hub)
    for i, mod in layout.items():
        if i not in BM.LEVEL_SLOTS[level]:
            continue
        slot = _by_name(hub, f'slot_{i}')
        new = M5._imp('base', f'base_module_{mod}')
        r = [o for o in new if o.parent is None][0]
        r.matrix_world = slot.matrix_world.copy()
        objs += new
    bpy.context.view_layer.update()
    return objs


def _planet_under(name, top, radius, spin=0.0):
    """Planet sphere whose top touches `top`; tilted 90 deg so the base sits on the equator
    (the equirect poles pinch and smear)."""
    meta = dict(PP.load_meta()[name])
    meta['clouds'] = None     # the game must clear / fade the cloud shell around a base (it sits under it)
    return PP.make_planet(name, meta, (top[0], top[1], top[2] - radius), radius, spin=spin, tilt=90.0, segs=256)


def label_bg(cam, y_frac, h_frac=0.07, alpha=0.55):
    """Dark translucent band behind camera labels (for bright backgrounds)."""
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    pl = bpy.context.active_object
    m = bpy.data.materials.new('LabelBg')
    nt = m.node_tree
    nt.nodes.clear()
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (0.005, 0.008, 0.015, 1)
    mix = nt.nodes.new('ShaderNodeMixShader')
    mix.inputs['Fac'].default_value = alpha
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(tr.outputs['BSDF'], mix.inputs[1])
    nt.links.new(em.outputs['Emission'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    pl.data.materials.append(m)
    sc = bpy.context.scene
    aspect = sc.render.resolution_x / sc.render.resolution_y
    half_h = math.tan(math.atan(cam.data.sensor_height / 2 / cam.data.lens)) * 1.01
    pl.parent = cam
    pl.location = (0, y_frac * 2 * half_h, -1.01)
    pl.scale = (2 * half_h * aspect, 2 * half_h * h_frac, 1)
    pl.visible_shadow = False
    return pl


def base_sheet(out_png):
    W, H = 1600, 900
    # --- main: from orbit - ship on the gameplay plane, U3 base on the planet below ----------
    cam = PV._new_scene(1060, 900, 192, seed=4.0, key_az=-130)
    cam.data.clip_end = 4000
    top = (0.0, 6.0, -26.0)
    _planet_under('rocky_arid', top, 260.0, spin=150)
    place_base(top, level=3)
    PV.build_ship([(f, (x + 9.0, y - 18.5), r) for f, (x, y), r in PV.M1_SHIP], connectors=True)
    if os.path.exists(os.path.join(paths.DRONES, 'drone_cargo.glb')):
        M5._imp('drones', 'drone_cargo', loc=(-12.0, -6.0, -8.0), rot=-120)
    R.aim_camera(cam, (2.0, -1.0, -13.0), 55, -90, 62)
    labs = [R.camera_label(cam, 'PLANETARY BASE from orbit  (U3, 8 slots, game camera 55 deg)', y_frac=0.45,
                           size_frac=0.026)]
    big = R.render_to(os.path.join(TMP, 'b_big.png'))
    for lb in labs:
        bpy.data.objects.remove(lb)
    PV._save_blend(os.path.join(paths.BLEND, 'm5b-base.blend'))
    # --- right top: BaseScreen close-up of the same base ------------------------------------
    cam = PV._new_scene(536, 448, 160, seed=4.0, key_az=-130)
    cam.data.clip_end = 3000
    top = (0.0, 0.0, 0.0)
    _planet_under('rocky_arid', top, 260.0, spin=150)
    place_base(top, level=3)
    R.aim_camera(cam, (0.0, -0.5, 0.5), 50, -100, 40)
    label_bg(cam, -0.44, 0.075)
    R.camera_label(cam, 'drill  storage  solar  reactor  refinery\ndrone dock  launcher  defense tower',
                   y_frac=-0.44, size_frac=0.03)
    close = R.render_to(os.path.join(TMP, 'b_close.png'))
    # --- right bottom: floating base on a gas planet -----------------------------------------
    cam = PV._new_scene(536, 448, 160, seed=5.0, key_az=-130)
    cam.data.clip_end = 3000
    _planet_under('gas_amber', (0, 0, -10.0), 200.0, spin=40)
    place_base((0.0, 0.0, -3.0), level=1, mode='float')
    R.aim_camera(cam, (0.0, -1.0, -2.0), 50, -100, 40)
    label_bg(cam, 0.43, 0.07, alpha=0.85)
    R.camera_label(cam, 'GAS PLANET: Hub_Floats + gas probe (U1)', y_frac=0.43, size_frac=0.04)
    gas = R.render_to(os.path.join(TMP, 'b_gas.png'))
    canvas = M5._canvas(W, H)
    M5._paste(canvas, R.read_png(big), 0, 0)
    M5._paste(canvas, R.read_png(close), 1064, 0)
    M5._paste(canvas, R.read_png(gas), 1064, 452)
    R.write_png(canvas, out_png)


def levels_sheet(out_png):
    import base_modules as BM
    cam = PV._new_scene(1600, 560, 128, seed=6.0, key_az=-130)
    cam.data.clip_end = 3000
    _planet_under('rocky_barren', (0, 0, 0.0), 400.0, spin=10)
    lay = BM.PREVIEW_FIT
    for k, lvl in enumerate((1, 2, 3)):
        place_base(((k - 1) * 25.0, 0, 0), level=lvl, layout=lay)
    R.aim_camera(cam, (0, -1.0, 0), 60, -90, 62)
    for k, lvl in enumerate((1, 2, 3)):
        R.camera_label(cam, f'U{lvl}  ({len(BM.LEVEL_SLOTS[lvl])} slots)' + ('  + Hub_Upgrade_2' if lvl == 2 else
                                                                         '  + Hub_Upgrade_3' if lvl == 3 else ''),
                       y_frac=0.43, x_frac=(k - 1) * 0.31, size_frac=0.04)
    R.render_to(out_png)


MODULE_TILES = [('base', 'base_hub', 'BASE HUB (L3, legs)'), ('base', 'base_module_drill', 'DRILL'),
                ('base', 'base_module_gas_probe', 'GAS PROBE'),
                ('base', 'base_module_solar', 'SOLAR'), ('base', 'base_module_reactor', 'REACTOR'),
                ('base', 'base_module_storage', 'STORAGE'), ('base', 'base_module_refinery', 'REFINERY'),
                ('base', 'base_module_launcher', 'LAUNCHER'),
                ('base', 'base_module_defense_tower', 'DEFENSE TOWER'),
                ('base', 'base_module_drone_dock', 'DRONE DOCK')]


def modules_sheet(out_png, tw=320, th=380):
    import base_modules as BM
    cam = PV._new_scene(tw, th, 128, key_az=-120)
    tiles = []
    for i, (folder, f, label) in enumerate(MODULE_TILES):
        M5._clear()
        if f == 'base_hub':
            objs = place_base((0, 0, 0), level=3, layout={})
        else:
            objs = M5._imp(folder, f)
            # pad under the module for context (from the hub's pad mesh would need the hub; use a disc)
            bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=BM.PAD_R, depth=0.1, location=(0, 0, -0.05),
                                                rotation=(0, 0, math.radians(22.5)))
            pad = bpy.context.active_object
            m = bpy.data.materials.new('PadPrev')
            m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.35, 0.36, 0.38, 1)
            pad.data.materials.append(m)
            objs.append(pad)
        meshes = [o for o in objs if o.type == 'MESH' and not o.hide_render]
        c, r = R.bounds(meshes)
        if f == 'base_module_gas_probe':
            c, r = Vector((0, 0, 0.9)), 3.1        # frame the top part, the tether dangles below
        R.aim_camera(cam, c, 40, -55, R.fit_distance(cam, r, margin=0.9))
        tris = M5._tris([o for o in objs if o.type == 'MESH' and o.name != pad.name] if f != 'base_hub' else meshes)
        labs = [R.camera_label(cam, label, y_frac=0.43, size_frac=0.05),
                R.camera_label(cam, f'{tris} tris', y_frac=-0.44, size_frac=0.04)]
        tiles.append(R.render_to(os.path.join(TMP, f'm_{i}.png')))
        for lb in labs:
            bpy.data.objects.remove(lb)
    R.stitch(tiles, 5, tw, th, out_png, gap=4)


def top_check(out_png):
    """Orthographic top view of a full ground base with the module footprint circles (cyan) and pad
    outlines: every module must stay inside its circle."""
    import base_modules as BM
    cam = PV._new_scene(900, 900, 96, key_az=-130)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 2 * (BM.SLOT_R + BM.PAD_R + 1.0)
    cam.location = (0, 0, 60)
    cam.rotation_euler = (0, 0, 0)
    place_base((0, 0, 0), level=3)
    m = bpy.data.materials.new('Circle')
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (0.1, 1.0, 0.9, 1)
    em.inputs['Strength'].default_value = 3.0
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    for i in range(8):
        x, y, _ = BM.slot_xy(i)
        bpy.ops.mesh.primitive_torus_add(major_radius=BM.MODULE_R, minor_radius=0.03, location=(x, y, 6.0),
                                         major_segments=64, minor_segments=4)
        bpy.context.active_object.data.materials.append(m)
    R.camera_label(cam, 'top view: module footprint circles r 2.25 (cyan)', y_frac=0.46, size_frac=0.025)
    R.render_to(out_png)


def main(only):
    made = []
    f = os.path.join(P, 'm5b-base.png')
    base_sheet(f)
    made.append((f, 'm5b-base'))
    f = os.path.join(P, 'm5b-base-levels.png')
    levels_sheet(f)
    made.append((f, 'm5b-base-levels'))
    return made


def main_extra(only):
    made = []
    if 'modules' in only:
        f = os.path.join(P, 'm5b-base-modules.png')
        modules_sheet(f)
        made.append((f, 'm5b-base-modules'))
        f = os.path.join(P, 'm5b-base-top.png')
        top_check(f)
        made.append((f, 'm5b-base-top'))
    if 'drones' in only:
        import preview_m5b_more as PM
        made += PM.drones(only)
    if 'cruise' in only:
        import preview_m5b_more as PM
        made += PM.cruise(only)
    if 'home' in only:
        import preview_m5b_more as PM
        made += PM.home(only)
    return made
