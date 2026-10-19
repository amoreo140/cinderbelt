"""Landmark previews (landmarks.py): every landmark at the GAME camera (pitch 55 deg, vertical FOV 50,
16:9) at the suggested scale and depth from landmarks.json, over the ring's skybox (dimmed ~40 % as in
plan R4), with the starter ship + a few rocks on the gameplay plane for scale. The landmark gets the
suggested zone haze (albedo / emissive share from the manifest, haze colour from src/render/env/zoneLook.ts)
and the suggested glow sprites (vfx/glow_soft.png, additive) - i.e. what the game should draw.

  landmark-<id>.png        top: default zoom (48) | bottom: max zoom (210) + hero close-up (no haze)
  landmark-echo_column.png beacon off-screen (the ray points to it) | max zoom | close
  landmark-gas_giant.png   world-anchored gas giant seen from three points of ring 1 (compass test)
  landmarks-sheet.png      hero close-ups of all landmarks

  blender --background --factory-startup --python art/blender/preview_landmarks.py -- [--only guild_relay,...] [--iter lm1]
"""
import json
import math
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
from lib import geo as G  # noqa: E402
from lib import render as R  # noqa: E402

TMP = os.path.join(paths.OUT, 'tmp_tiles_landmarks')
LM_DIR = os.path.join(paths.MODELS, 'landmarks')
SKY = os.path.join(paths.ROOT, 'public', 'assets', 'skybox')
GAME_LENS = 12.0 / math.tan(math.radians(25.0))      # sensor height 24 (vertical fit) -> vFOV 50 deg
DEFAULT_DIST, MAX_DIST = 48.0, 210.0

# zoneLook.ts: haze colour, sun colour + screen side (azimuth the light comes from), fill colour
ZONES = {
    1: dict(haze=0x1b2450, sun=0xfff0dc, sun_az=60, elev=40, fill=0x7f9cff),
    2: dict(haze=0x3a1420, sun=0xffd8b0, sun_az=105, elev=38, fill=0xff7a6a),
    3: dict(haze=0x0c3a34, sun=0xe0fff6, sun_az=70, elev=38, fill=0x40ffc8),
    4: dict(haze=0x24102c, sun=0xffb090, sun_az=110, elev=40, fill=0xa050ff),
}


def _lin_hex(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def _lin_str(s):
    return _lin_hex(int(s.lstrip('#'), 16))


def load_manifest():
    with open(os.path.join(LM_DIR, 'landmarks.json'), encoding='utf-8') as f:
        return json.load(f)


# ----------------------------------------------------------------------------
# scene
# ----------------------------------------------------------------------------
def sky_world(ring, dim=0.55):
    """Ring skybox (equirect) for camera rays, dimmed like plan R4; soft fill-coloured ambient for lighting."""
    z = ZONES[ring]
    w = bpy.data.worlds.new('AF_Sky')
    bpy.context.scene.world = w
    nt = w.node_tree
    nt.nodes.clear()
    N, L = nt.nodes, nt.links
    out = N.new('ShaderNodeOutputWorld')
    env = N.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(os.path.join(SKY, f'ring{ring}_bg.webp'), check_existing=True)
    bg_cam = N.new('ShaderNodeBackground')
    bg_cam.inputs['Strength'].default_value = dim
    L.new(env.outputs['Color'], bg_cam.inputs['Color'])
    bg_amb = N.new('ShaderNodeBackground')
    f = _lin_hex(z['fill'])
    bg_amb.inputs['Color'].default_value = (0.03 + f[0] * 0.04, 0.03 + f[1] * 0.04, 0.05 + f[2] * 0.04, 1)
    lp = N.new('ShaderNodeLightPath')
    mix = N.new('ShaderNodeMixShader')
    L.new(lp.outputs['Is Camera Ray'], mix.inputs['Fac'])
    L.new(bg_amb.outputs['Background'], mix.inputs[1])
    L.new(bg_cam.outputs['Background'], mix.inputs[2])
    L.new(mix.outputs['Shader'], out.inputs['Surface'])


def new_scene(w, h, ring, samples=64):
    G.reset_scene()
    R.setup_render(w, h, samples=samples)
    sky_world(ring)
    z = ZONES[ring]
    R._sun('Key', 3.6, _lin_hex(z['sun']), (0, 90 - z['elev'], z['sun_az']), angle=1.5)
    R._sun('Fill', 0.7, _lin_hex(z['fill']), (0, 60, z['sun_az'] + 150), angle=8)
    R._sun('Top', 0.9, (0.85, 0.9, 1.0), (0, 10, 0), angle=10)
    cam = R.make_camera(lens=GAME_LENS)
    cam.data.clip_end = 9000
    return cam


def game_view(cam, dist, target=(0, 0, 0)):
    R.aim_camera(cam, target, 55, -90, dist)
    bpy.context.view_layer.update()


def point_at_ndc(cam, nx, ny, z_plane):
    """World point on the horizontal plane z = z_plane seen at NDC (nx, ny) (-1..1, +y up)."""
    sc = bpy.context.scene
    aspect = sc.render.resolution_x / sc.render.resolution_y
    th = math.tan(math.radians(25.0)) if abs(cam.data.lens - GAME_LENS) < 1e-3 else \
        cam.data.sensor_height / 2 / cam.data.lens
    d = Vector((nx * th * aspect, ny * th, -1.0))
    d = (cam.matrix_world.to_3x3() @ d).normalized()
    o = cam.matrix_world.translation
    t = (z_plane - o.z) / d.z
    return o + d * t


def plane_context():
    PV.build_ship(PV.M1_SHIP, connectors=True)
    PV.add_rocks(PV.M1_ROCKS)


# ----------------------------------------------------------------------------
# landmark import, haze, glows
# ----------------------------------------------------------------------------
def haze_material(src, haze_rgb, h_albedo, h_emit):
    """Copy of an imported material with aerial perspective: albedo x (1 - h), emission x (1 - h_emit),
    plus the haze colour emitted with weight h (≈ three.js fog toward the zone haze)."""
    m = src.copy()
    m.name = src.name + '_haze'
    nt = m.node_tree
    b = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b is None:
        return m
    strength = b.inputs['Emission Strength'].default_value or 1.0

    def scaled(sock_name, k):
        sock = b.inputs[sock_name]
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs['B'].default_value = (k, k, k, 1)
        if sock.links:
            nt.links.new(sock.links[0].from_socket, mix.inputs['A'])
        else:
            mix.inputs['A'].default_value = sock.default_value
        nt.links.new(mix.outputs['Result'], sock)
        return mix
    scaled('Base Color', 1.0 - h_albedo)
    em = scaled('Emission Color', 1.0 - h_emit)
    add = nt.nodes.new('ShaderNodeMix')
    add.data_type = 'RGBA'
    add.blend_type = 'ADD'
    add.inputs['Factor'].default_value = 1.0
    k = h_albedo / strength
    add.inputs['B'].default_value = (haze_rgb[0] * k, haze_rgb[1] * k, haze_rgb[2] * k, 1)
    nt.links.new(em.outputs['Result'], add.inputs['A'])
    nt.links.new(add.outputs['Result'], b.inputs['Emission Color'])
    if b.inputs['Emission Strength'].default_value == 0:
        b.inputs['Emission Strength'].default_value = 1.0
    return m


def apply_haze(objs, ring, h_albedo, h_emit):
    haze = _lin_hex(ZONES[ring]['haze'])
    cache = {}
    for o in objs:
        if o.type != 'MESH':
            continue
        for slot in o.material_slots:
            if slot.material is None or slot.material.name.startswith('AF_EchoColumn'):
                continue
            key = slot.material.name
            if key not in cache:
                cache[key] = haze_material(slot.material, haze, h_albedo, h_emit)
            slot.material = cache[key]


def _additive(name, color, strength, image=None):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    nt.nodes.clear()
    N, L = nt.nodes, nt.links
    em = N.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = strength
    if image is not None:
        tex = N.new('ShaderNodeTexImage')
        tex.image = image
        tex.extension = 'EXTEND'
        mul = N.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        L.new(tex.outputs['Color'], mul.inputs['A'])
        mul.inputs['B'].default_value = (*color, 1)
        alpha = N.new('ShaderNodeMix')     # straight alpha -> premultiply
        alpha.data_type = 'RGBA'
        alpha.blend_type = 'MULTIPLY'
        alpha.inputs['Factor'].default_value = 1.0
        L.new(mul.outputs['Result'], alpha.inputs['A'])
        L.new(tex.outputs['Alpha'], alpha.inputs['B'])
        L.new(alpha.outputs['Result'], em.inputs['Color'])
    else:
        em.inputs['Color'].default_value = (*color, 1)
    tr = N.new('ShaderNodeBsdfTransparent')
    add = N.new('ShaderNodeAddShader')
    L.new(tr.outputs['BSDF'], add.inputs[0])
    L.new(em.outputs['Emission'], add.inputs[1])
    out = N.new('ShaderNodeOutputMaterial')
    L.new(add.outputs['Shader'], out.inputs['Surface'])
    return m


def glow_sprite(cam, loc, size, color_hex, opacity=1.0):
    img = bpy.data.images.load(os.path.join(paths.VFX, 'glow_soft.png'), check_existing=True)
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc)
    p = bpy.context.active_object
    p.rotation_euler = cam.matrix_world.to_euler()
    p.data.materials.append(_additive('Glow', _lin_str(color_hex), 1.6 * opacity, img))
    p.visible_shadow = False
    return p


def import_landmark(entry, loc, yaw=0.0):
    roots, objs = PV.import_glb(os.path.join(LM_DIR, entry['file']), loc=loc, rot_z=yaw)
    for r in roots:
        r.scale = (entry['scale'],) * 3
    bpy.context.view_layer.update()
    return roots, objs


def add_glows(cam, entry, objs):
    s = entry['scale']
    for g in entry.get('glows', []):
        e = next((o for o in objs if o.name.split('.')[0] == g['node']), None)
        if e is None:
            continue
        glow_sprite(cam, e.matrix_world.translation, g['size'], g['color'], g.get('opacity', 1.0))


def place_landmark(cam, entry, ndc, yaw, haze=True, glows=True):
    """Put the landmark so its origin projects to `ndc` at the manifest depth."""
    p = point_at_ndc(cam, ndc[0], ndc[1], -entry['depth'])
    roots, objs = import_landmark(entry, tuple(p), yaw)
    if haze:
        apply_haze(objs, entry['ring'], entry['haze']['albedo'], entry['haze']['emissive'])
    if glows:
        add_glows(cam, entry, objs)
    return p, objs


def _canvas(w, h):
    c = np.zeros((h, w, 4), np.float32)
    c[..., :3] = (0.02, 0.025, 0.035)
    c[..., 3] = 1
    return c


def compose(out_png, top, bl, br):
    a, b, c = R.read_png(top), R.read_png(bl), R.read_png(br)
    H = a.shape[0] + 4 + b.shape[0]
    canvas = _canvas(1600, H)
    canvas[H - a.shape[0]:] = a          # rows are bottom-up
    canvas[:b.shape[0], :b.shape[1]] = b
    canvas[:c.shape[0], 1600 - c.shape[1]:] = c
    R.write_png(canvas, out_png)


# ----------------------------------------------------------------------------
# sheets
# ----------------------------------------------------------------------------
VIEW = {   # ndc of the anchor in the default view, yaw, hero camera (elev, az)
    'guild_relay': ((-0.42, 0.18), 20, (24, -70)),
    'rust_ring_shard': ((0.38, 0.22), -15, (32, -75)),
    'crystal_spire': ((-0.35, 0.25), 10, (18, -72)),
    'dead_forge': ((0.4, 0.3), 25, (22, -68)),
}


def hero_tile(entry, path, elev_az, w=798, h=449, label=None):
    cam = new_scene(w, h, entry['ring'], samples=96)
    roots, objs = import_landmark(entry, (0, 0, 0))
    for r in roots:
        r.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    c, r = R.bounds(objs)
    R.aim_camera(cam, c, elev_az[0], elev_az[1], R.fit_distance(cam, r, margin=0.72))
    R.camera_label(cam, label or f"{entry['id']}  {entry['tris']} tris", y_frac=-0.44, size_frac=0.04)
    return R.render_to(path)


def landmark_sheet(entry, out_png):
    lid = entry['id']
    ndc, yaw, hero = VIEW[lid]
    # default zoom
    cam = new_scene(1600, 900, entry['ring'])
    game_view(cam, DEFAULT_DIST)
    p, _ = place_landmark(cam, entry, ndc, yaw)
    plane_context()
    ws = entry['worldSize']
    R.camera_label(cam, f"{lid}  ring {entry['ring']}   x{entry['scale']} = {ws[0]:.0f} x {ws[1]:.0f} x {ws[2]:.0f} u,"
                        f"  depth {entry['depth']}   |   game camera, default zoom {DEFAULT_DIST:.0f}",
                   y_frac=-0.465, size_frac=0.02)
    top = R.render_to(os.path.join(TMP, f'{lid}_def.png'))
    # max zoom, same world placement
    cam = new_scene(798, 449, entry['ring'])
    game_view(cam, MAX_DIST)
    roots, objs = import_landmark(entry, tuple(p), yaw)
    apply_haze(objs, entry['ring'], entry['haze']['albedo'], entry['haze']['emissive'])
    add_glows(cam, entry, objs)
    plane_context()
    R.camera_label(cam, f'max zoom {MAX_DIST:.0f} (same placement)', y_frac=-0.44, size_frac=0.04)
    bl = R.render_to(os.path.join(TMP, f'{lid}_max.png'))
    br = hero_tile(entry, os.path.join(TMP, f'{lid}_hero.png'), hero)
    compose(out_png, top, bl, br)
    return br


def _echo_beacon(man, loc, tilt=0.0, lower_only=False):
    col = man['echoColumn']
    sw, sh = col['scale']['width'], col['scale']['height']
    _, oz = PV.import_glb(os.path.join(paths.KOVACI, 'ozvena_beacon.glb'), loc=loc)
    roots, cobjs = PV.import_glb(os.path.join(LM_DIR, 'echo_column.glb'), loc=loc)
    img = bpy.data.images.load(os.path.join(paths.VFX, 'echo_column.png'), check_existing=True)
    m = _additive('EchoAdd', (1, 1, 1), 2.2, img)
    for r in roots:
        r.scale = (sw, sw, sh)
        # Blender X rotation by +tilt leans the top toward -Y (the camera side) = three.js rotation.x = +tilt
        r.rotation_euler = (math.radians(tilt), 0, 0)
    for o in cobjs:
        if o.type == 'MESH':
            o.data.materials.clear()
            o.data.materials.append(m)
            o.visible_shadow = False
            if lower_only:
                import bmesh
                bm = bmesh.new()
                bm.from_mesh(o.data)
                bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z > 0.0], context='FACES')
                bm.to_mesh(o.data)
                bm.free()
    return oz


def echo_compass_sheet(man, out_png):
    """The same beacons with the compass tilt (35 deg, lower half only) + beacons east, west and south."""
    beacons = [(150.0, 10.0, 0), (-90.0, 420.0, 0), (260.0, -60.0, 0), (-330.0, 120.0, 0), (60.0, -160.0, 0)]
    cam = new_scene(1600, 900, 3)
    game_view(cam, DEFAULT_DIST)
    for b in beacons:
        _echo_beacon(man, b, tilt=35.0, lower_only=True)
    plane_context()
    R.camera_label(cam, 'COMPASS option: column tilted 35 deg (lower half only) - beacons E 150, N 430, E 260, '
                        'W 340, S 170 u: every ray enters from its side and points at the ship', y_frac=-0.465,
                   size_frac=0.019)
    top = R.render_to(os.path.join(TMP, 'echoc_def.png'))
    cam = new_scene(798, 449, 3)
    game_view(cam, MAX_DIST)
    for b in beacons:
        _echo_beacon(man, b, tilt=35.0, lower_only=True)
    plane_context()
    R.camera_label(cam, f'compass option, max zoom {MAX_DIST:.0f}', y_frac=-0.44, size_frac=0.04)
    bl = R.render_to(os.path.join(TMP, 'echoc_max.png'))
    cam = new_scene(798, 449, 3)
    game_view(cam, DEFAULT_DIST)
    for b in beacons:
        _echo_beacon(man, b, tilt=0.0)
    plane_context()
    R.camera_label(cam, 'same beacons, VERTICAL column: only the north one shows', y_frac=-0.44, size_frac=0.035)
    br = R.render_to(os.path.join(TMP, 'echoc_vert.png'))
    compose(out_png, top, bl, br)


def echo_sheet(man, out_png):
    def beacon(loc):
        return _echo_beacon(man, loc)
    # 1: two beacons off-screen - east (up-ray enters from the right) and far north (down-ray)
    cam = new_scene(1600, 900, 3)
    game_view(cam, DEFAULT_DIST)
    beacon((150.0, 10.0, 0))
    beacon((-90.0, 420.0, 0))
    plane_context()
    R.camera_label(cam, 'echo_column: both beacons off-screen - 150 u east (ray from the right) and 430 u north '
                        f'(ray from the top)   |   default zoom {DEFAULT_DIST:.0f}', y_frac=-0.465, size_frac=0.02)
    top = R.render_to(os.path.join(TMP, 'echo_def.png'))
    # 2: max zoom, beacon north-east on screen + one far north (down-ray)
    cam = new_scene(798, 449, 3)
    game_view(cam, MAX_DIST)
    beacon((150.0, 10.0, 0))
    beacon((-90.0, 420.0, 0))
    beacon((-520.0, -40.0, 0))
    plane_context()
    R.camera_label(cam, f'max zoom {MAX_DIST:.0f}: same + one 520 u west', y_frac=-0.44, size_frac=0.04)
    bl = R.render_to(os.path.join(TMP, 'echo_max.png'))
    # 3: close, beacon next to the ship
    cam = new_scene(798, 449, 3)
    game_view(cam, DEFAULT_DIST)
    beacon((-14.0, 9.0, 0))
    plane_context()
    R.camera_label(cam, 'beacon 17 u from the ship (fade the column when the camera is this close)', y_frac=-0.44,
                   size_frac=0.035)
    br = R.render_to(os.path.join(TMP, 'echo_close.png'))
    compose(out_png, top, bl, br)


def gas_giant_sheet(man, out_png):
    import preview_m5b as P5
    gg = next(e for e in man['landmarks'] if e['id'] == 'gas_giant')
    anchor = (gg['anchor'][0], gg['anchor'][1], -gg['depth'])
    tiles = []
    for i, ship in enumerate(((0.0, 0.0), (1000.0, -800.0), (-1100.0, 900.0))):
        cam = new_scene(798, 449, 1, samples=48)
        game_view(cam, DEFAULT_DIST, target=(ship[0], ship[1], 0))
        P5._gas_giant(anchor, gg['radius'], spin=120)
        PV.build_ship([(f, (c[0] + ship[0], c[1] + ship[1]), r) for f, c, r in PV.M1_SHIP], connectors=False)
        R.camera_label(cam, f'ship at ({ship[0]:.0f}, {ship[1]:.0f}) - giant anchored at ({anchor[0]:.0f}, '
                            f'{anchor[1]:.0f}), depth {gg["depth"]}',
                       y_frac=-0.44, size_frac=0.035)
        tiles.append(R.render_to(os.path.join(TMP, f'gg_{i}.png')))
    cam = new_scene(798, 449, 1, samples=48)
    game_view(cam, MAX_DIST, target=(1000.0, -800.0, 0))
    P5._gas_giant(anchor, gg['radius'], spin=120)
    PV.build_ship([(f, (c[0] + 1000.0, c[1] - 800.0), r) for f, c, r in PV.M1_SHIP], connectors=False)
    R.camera_label(cam, 'ship at (1000, -800), max zoom 210', y_frac=-0.44, size_frac=0.035)
    tiles.append(R.render_to(os.path.join(TMP, 'gg_3.png')))
    R.stitch(tiles, 2, 798, 449, out_png, gap=4)


def main(only=None, iter_tag=None):
    os.makedirs(TMP, exist_ok=True)
    man = load_manifest()
    files, heroes = [], []
    for e in man['landmarks']:
        if not e.get('file') or (only and e['id'] not in only):
            continue
        out = os.path.join(paths.PREVIEWS, f"landmark-{e['id']}.png")
        heroes.append(landmark_sheet(e, out))
        files.append((out, f"landmark-{e['id']}"))
    if not only or 'echo_column' in only:
        out = os.path.join(paths.PREVIEWS, 'landmark-echo_column.png')
        echo_sheet(man, out)
        files.append((out, 'landmark-echo_column'))
        out = os.path.join(paths.PREVIEWS, 'landmark-echo_column-compass.png')
        echo_compass_sheet(man, out)
        files.append((out, 'landmark-echo_column-compass'))
    if not only or 'gas_giant' in only:
        out = os.path.join(paths.PREVIEWS, 'landmark-gas_giant.png')
        gas_giant_sheet(man, out)
        files.append((out, 'landmark-gas_giant'))
    if len(heroes) == 4:
        out = os.path.join(paths.PREVIEWS, 'landmarks-sheet.png')
        R.stitch(heroes, 2, 798, 449, out, gap=4)
        files.append((out, 'landmarks-sheet'))
    shutil.rmtree(TMP, ignore_errors=True)
    PV._keep_iterations(iter_tag, files)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else None,
         argv[argv.index('--iter') + 1] if '--iter' in argv else None)
