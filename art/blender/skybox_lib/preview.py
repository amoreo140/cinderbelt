"""Previews of a finished panorama:
  * game view: the panorama as background seen through the game camera
    (55 deg pitch, 50 deg vertical FOV), plus a composite with real game
    models lit by the env .hdr + the game's sun and tone mapped like three.js
  * check views: seam (looking at the u=0/1 edge), zenith and nadir
  * downscaled full panorama
"""
import math
import os

import bpy
import numpy as np

from . import post
from . import scene as S

MODELS = None   # set by caller: public/assets/models

SHIP = [
    ('cockpit_iron', (1, 0), 0), ('gyroscope_iron', (0, 0), 0),
    ('armor_iron', (2, 0), 0), ('armor_iron', (-1, 0), 0),
    ('armor_iron', (0, 1), 0), ('armor_iron', (0, -1), 0),
    ('reactor_iron', (1, 1), 0), ('cargo_iron', (1, -1), 0),
    ('engine_iron', (-1, 1), 0), ('engine_iron', (-1, -1), 0),
    ('radar_iron', (2, 1), 0), ('mining_laser_iron', (2, -1), 0),
]
ROCKS = [  # file, (x, y), rot_z, scale
    ('asteroid_ice_a', (-11, 5), 30, 1.0), ('asteroid_iron_a', (-13, -6), 80, 1.0),
    ('asteroid_copper_a', (10, 6), 140, 0.9), ('asteroid_titanium_a', (13, -4), 200, 1.0),
    ('asteroid_iron_b', (-5, 11), 10, 0.7), ('asteroid_ice_b', (6, -10), 260, 0.8),
]


def _world_tex(path, strength=1.0, colorspace='sRGB'):
    w = bpy.data.worlds.new('PreviewWorld')
    bpy.context.scene.world = w
    nt = w.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new('ShaderNodeTexEnvironment')
    tex.image = bpy.data.images.load(path, check_existing=False)
    tex.image.colorspace_settings.name = colorspace
    tex.interpolation = 'Cubic'
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(tex.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs[0], out.inputs['Surface'])


def _cam(name, rot_deg, fov_deg, loc=(0, 0, 0)):
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(fov_deg)
    cd.clip_start = 0.05
    cd.clip_end = 5000
    ob = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = tuple(math.radians(a) for a in rot_deg)
    return ob


def _render_exr(path, w, h, samples, cam, transparent=False, denoise=False):
    sc = bpy.context.scene
    sc.camera = cam
    S.cycles_settings(w, h, samples, denoise=denoise)
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.image_settings.color_depth = '32'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path, check_existing=False)
    W, H = img.size
    buf = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    os.remove(path)
    return buf.reshape(H, W, 4)[::-1].copy()


def _import(path, loc, rot_z=0.0, scale=1.0):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    for o in bpy.data.objects:
        if o not in before and o.parent is None:
            o.location = loc
            o.rotation_mode = 'XYZ'
            o.rotation_euler = (0, 0, math.radians(rot_z))
            o.scale = (scale, scale, scale)


def render_previews(bg_jpg, env_hdr, out_prefix, tmp_dir, game_w=1600, game_h=900, env_strength=2.0):
    os.makedirs(os.path.dirname(out_prefix), exist_ok=True)
    os.makedirs(tmp_dir, exist_ok=True)
    tmp = os.path.join(tmp_dir, 'pv.exr')

    # ---------------- background-only views --------------------------------
    S.reset()
    _world_tex(bg_jpg)
    game_cam = _cam('Game', (90 - 55, 0, 0), 50.0)
    bg = post.srgb_encode(_render_exr(tmp, game_w, game_h, 24, game_cam)[:, :, :3])
    post.save_png(bg, out_prefix + '_gameview_bg.png')

    tiles = []
    for name, rot in (('seam', (90, 0, 90)), ('zenith', (180, 0, 0)), ('nadir', (0, 0, 0))):
        cam = _cam(name, rot, 100.0)
        tiles.append(post.srgb_encode(_render_exr(tmp, 640, 640, 16, cam)[:, :, :3]))
    gap = np.zeros((640, 6, 3), dtype=np.float32)
    post.save_png(np.concatenate([tiles[0], gap, tiles[1], gap, tiles[2]], axis=1),
                  out_prefix + '_checks_seam_zenith_nadir.png')

    # ---------------- game composite (models over the background) ------------
    S.reset()
    _world_tex(env_hdr, strength=env_strength, colorspace='Linear Rec.709')   # = three environmentIntensity
    for f, (x, y), rot in SHIP:
        _import(os.path.join(MODELS, 'parts', f + '.glb'), (x - 0.5, y, 0), rot)
    for f, (x, y), rot, s in ROCKS:
        _import(os.path.join(MODELS, 'asteroids', f + '.glb'), (x, y, 0), rot, s)
    sun_d = bpy.data.lights.new('Sun', 'SUN')
    sun_d.energy = 2.2                      # three DirectionalLight(0xfff0d8, 2.2)
    sun_d.color = (1.0, 0.94, 0.85)
    sun_d.angle = math.radians(1.0)
    sun = bpy.data.objects.new('Sun', sun_d)
    bpy.context.scene.collection.objects.link(sun)
    # three SUN_OFFSET (40, 60, 25) -> Blender (40, -25, 60); light points from there to origin
    sun.rotation_euler = (0, 0, 0)
    from mathutils import Vector
    sun.rotation_euler = (-Vector((40, -25, 60))).to_track_quat('-Z', 'Y').to_euler()
    d = 28.0
    cam = _cam('GameRig', (90 - 55, 0, 0), 50.0,
               loc=(0, -d * math.cos(math.radians(55)), d * math.sin(math.radians(55))))
    obj = _render_exr(tmp, game_w, game_h, 96, cam, transparent=True, denoise=True)
    a = np.clip(obj[:, :, 3:4], 0, 1)
    rgb = np.where(a > 1e-4, obj[:, :, :3] / np.maximum(a, 1e-4), 0)
    fg = post.three_aces(rgb)
    comp = fg * a + bg * (1 - a)
    post.save_png(comp, out_prefix + '_gameview_models.png')
    return out_prefix + '_gameview_models.png'
