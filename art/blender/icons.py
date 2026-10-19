"""UI icons rendered from the exported models.

  public/assets/icons/parts/<partId>_t<tier>.png   128x128 RGBA, orthographic,
      tilted ICON_TILT deg toward the stern, bow (+X) pointing UP, on a dark
      rounded plate.  Multi-cell parts (module CELLS = (w, h)) frame their
      whole footprint (ortho scale x 0.9 max(w, h)).
  public/assets/icons/resources/<id>.png            64x64 RGBA, small chunk of
      the resource (3/4 view).
  public/assets/icons/home/<module>.png            128x128 RGBA, Rozvoj (home module) icons for every
      module of home_modules.MODULES (JSON ids: paint_shop, trophy_hall, refinery, observatory,
      laboratory, drone_hub), rendered from models/stations/home_module_<id>.glb: same plate, lights and
      orthographic camera as the part icons, but a 3/4 view (HOME_ICON_EL / HOME_ICON_AZ) - a building
      reads from the side, not straight down.  The collar adapter (the station side) points away.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402

import paths  # noqa: E402
from lib import geo as G  # noqa: E402
from lib import materials as M  # noqa: E402
from lib import render as R  # noqa: E402

# Blender part module -> game part id
PART_IDS = {
    'cockpit': 'cockpit', 'armor': 'armor', 'engine': 'engine', 'gyroscope': 'gyro',
    'mining_laser': 'miningLaser', 'cargo': 'cargo', 'fuel_tank': 'fuelTank', 'reactor': 'reactor',
    'radar': 'radar', 'cannon': 'cannon', 'shield_generator': 'shield',
    'heavy_laser': 'heavyLaser', 'large_cargo': 'largeCargo', 'battery': 'battery',
    'tractor_beam': 'tractorBeam',
    # M4 / M5a
    'refinery': 'refinery', 'large_reactor': 'largeReactor', 'repair_module': 'repairModule',
    'shielding': 'shielding',
    # M5b
    'cruise_drive': 'cruiseDrive',
}
ICON_TILT = 24.0     # deg from straight top-down, camera leaning toward the stern (-X)
TIERS = (('iron', 1), ('titanium', 2), ('crystal', 3))
RESOURCES = {  # id: (asteroid kind, seed)
    'iron': ('iron', 501), 'copper': ('copper', 503), 'ice': ('ice', 509), 'titanium': ('titanium', 521),
    # M5a: Kr / VZ / He3 / Ex (ids follow the camelCase part-id style; game ids not fixed in the spec yet)
    'crystal': ('crystal', 531), 'rareEarth': ('rare', 541), 'helium3': ('comet', 547), 'exotic': ('exotic', 557),
}
# icon plate border per tier (spec 10.2): T1/T2 keep the neutral border; T3 = --af-crystal #b98cff with
# 45 deg facet marks in each corner (the UI's T3 "fazety" brackets)
TIER_FRAME = {3: ((0x5d / 255, 0x33 / 255, 0xa8 / 255), (0xb9 / 255, 0x8c / 255, 0xff / 255))}


def _icon_scene(size):
    G.reset_scene()
    sc = bpy.context.scene
    R.setup_render(size, size, samples=64)
    sc.render.use_compositing = False          # no bloom halo on tiny icons
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    R.setup_world(ambient=(0.10, 0.11, 0.14), ambient_strength=1.0)
    sc.view_settings.exposure = -0.35
    R._sun('Key', 4.0, (1.0, 0.96, 0.9), (0, 50, 150))      # from the upper-left of the icon
    R._sun('Fill', 1.2, (0.7, 0.8, 1.0), (0, 50, -40))
    cd = bpy.data.cameras.new('IconCam')
    cd.type = 'ORTHO'
    cam = bpy.data.objects.new('IconCam', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def _import(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def part_icons():
    out_dir = os.path.join(paths.ICONS, 'parts')
    os.makedirs(out_dir, exist_ok=True)
    cam = _icon_scene(128)
    cam.data.ortho_scale = 1.22
    # slight tilt for depth: camera above and a little behind the stern; its
    # up vector stays on +X so the bow points up in the icon
    from mathutils import Vector
    tl = math.radians(ICON_TILT)
    d = Vector((-math.sin(tl), 0.0, math.cos(tl)))
    cam.location = Vector((0.0, 0.0, 0.12)) + d * 10
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    made = []
    import importlib
    for mod, pid in PART_IDS.items():
        # multi-cell parts: frame the whole footprint (same 128 px icon, the
        # part is drawn smaller per cell; a 2x1 stands upright = bow up)
        w, h = getattr(importlib.import_module('parts.' + mod), 'CELLS', (1, 1))
        cam.data.ortho_scale = 1.22 * max(w, h) * (0.9 if max(w, h) > 1 else 1.0)
        for tier, tn in TIERS:
            objs = _import(os.path.join(paths.PARTS, f'{mod}_{tier}.glb'))
            p = os.path.join(out_dir, f'{pid}_t{tn}.png')
            R.render_to(p)
            plate(p, radius=18, tier=tn)
            for o in objs:
                bpy.data.objects.remove(o)
            made.append(p)
    return made


def plate(path, radius=18, border=1.5, tier=None):
    """Composite the rendered icon over a subtle dark rounded plate (keeps
    transparency outside the rounded rectangle).  tier 3: crystal-violet
    border + four 45 deg facet strokes across the corners."""
    import numpy as np
    a = R.read_png(path)
    h, w, _ = a.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32) + 0.5
    # signed distance to a rounded rectangle inset by 1px
    hx, hy = w / 2 - 1, h / 2 - 1
    qx = np.abs(xx - w / 2) - (hx - radius)
    qy = np.abs(yy - h / 2) - (hy - radius)
    dist = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - radius
    inside = np.clip(0.5 - dist, 0, 1)
    edge = np.clip(1 - np.abs(dist + border) / border, 0, 1) * inside
    t = yy / h                      # image rows are bottom-up: t = 0 bottom
    plate_rgb = np.stack([0.075 + 0.05 * t, 0.09 + 0.06 * t, 0.125 + 0.08 * t], -1)
    frame = TIER_FRAME.get(tier)
    edge_rgb = np.array(frame[0] if frame else (0.24, 0.30, 0.40))
    if frame:   # violet-tinted plate gradient + stronger border
        plate_rgb = plate_rgb * np.array([1.05, 0.92, 1.12])
        edge = np.clip(1 - np.abs(dist + border * 1.3) / (border * 1.3), 0, 1) * inside
    plate_rgb = plate_rgb * (1 - edge[..., None]) + edge_rgb * edge[..., None]
    if frame:   # facet strokes: short 45 deg bars cutting each corner, |x|+|y| = const
        u = np.abs(xx - w / 2) + np.abs(yy - h / 2)
        k = (w / 2 - 1) + (h / 2 - 1) - radius * 1.15
        along = np.abs(np.abs(xx - w / 2) - np.abs(yy - h / 2))
        stroke = np.clip(1.4 - np.abs(u - k) / 1.4, 0, 1) * np.clip(1 - (along - w * 0.12) / 1.5, 0, 1) * inside
        plate_rgb = plate_rgb * (1 - stroke[..., None]) + np.array(frame[1]) * stroke[..., None]
    al = a[..., 3:4]
    rgb = a[..., :3] * al + plate_rgb * (1 - al)
    if frame:   # keep the facet strokes on top of the part render
        rgb = rgb * (1 - stroke[..., None]) + np.array(frame[1]) * stroke[..., None]
    out = np.concatenate([rgb, np.maximum(inside[..., None] * 0.94, al)], -1)
    img = bpy.data.images.new('plate', w, h, alpha=True)
    img.colorspace_settings.name = 'sRGB'
    img.pixels.foreach_set(out.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def resource_icons():
    import asteroids as A
    out_dir = os.path.join(paths.ICONS, 'resources')
    os.makedirs(out_dir, exist_ok=True)
    made = []
    for rid, (kind, seed) in RESOURCES.items():
        cam = _icon_scene(64)
        M.build_atlas_images(paths.ATLAS)
        ob = A.build(f'chunk_{rid}', kind, seed, 1.0, paths.ATLAS)
        bpy.context.view_layer.update()
        c, r = R.bounds([ob])
        cam.data.ortho_scale = r * 1.15
        el, az = math.radians(40), math.radians(-60)
        d = (math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))
        from mathutils import Vector
        cam.location = Vector(c) + Vector(d) * 20
        cam.rotation_euler = (-Vector(d)).to_track_quat('-Z', 'Y').to_euler()
        p = os.path.join(out_dir, f'{rid}.png')
        R.render_to(p)
        plate(p, radius=10)
        made.append(p)
    return made


HOME_ICON_EL = 46.0     # deg above the horizon
HOME_ICON_AZ = -125.0   # camera azimuth around the module (0 = on +X); the module's +X runs to the lower right


def home_icons():
    """Rozvoj tab icons: one per home module (M5 modules too - the UI shows them locked)."""
    import home_modules as HM
    from mathutils import Vector
    out_dir = os.path.join(paths.ICONS, 'home')
    os.makedirs(out_dir, exist_ok=True)
    cam = _icon_scene(128)
    bpy.context.scene.view_settings.exposure = 0.15   # station hulls are darker than part deck plates
    el, az = math.radians(HOME_ICON_EL), math.radians(HOME_ICON_AZ)
    d = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    rot = (-d).to_track_quat('-Z', 'Y')
    made = []
    for mod, info in HM.MODULES.items():
        objs = _import(os.path.join(paths.STATIONS, info['file'] + '.glb'))
        bpy.context.view_layer.update()
        # frame the projected bounding box (camera right / up axes), centred
        right, up = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0))
        pts = [o.matrix_world @ Vector(c) for o in objs if o.type == 'MESH' for c in o.bound_box]
        us, vs = [p.dot(right) for p in pts], [p.dot(up) for p in pts]
        centre = right * (max(us) + min(us)) / 2 + up * (max(vs) + min(vs)) / 2
        cam.data.ortho_scale = max(max(us) - min(us), max(vs) - min(vs)) * 1.05
        cam.location = centre + d * 30
        cam.rotation_euler = rot.to_euler()
        p = os.path.join(out_dir, f'{mod}.png')
        R.render_to(p)
        plate(p, radius=18)
        for o in objs:
            bpy.data.objects.remove(o)
        made.append(p)
    return made


def build_all():
    made = part_icons() + resource_icons() + home_icons()
    print('ICONS', len(made))
    return made


if __name__ == '__main__':
    _argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if '--only' in _argv:   # e.g. -- --only home
        _only = _argv[_argv.index('--only') + 1].split(',')
        print('ICONS', sum(len({'parts': part_icons, 'resources': resource_icons, 'home': home_icons}[k]())
                             for k in _only))
    else:
        build_all()
