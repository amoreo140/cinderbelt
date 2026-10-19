"""M3 (combat) previews: new parts, debris, pirate livery, refreshed icons."""
import math
import os
import random
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
from lib import livery as LV  # noqa: E402
from lib import render as R  # noqa: E402

TMP = os.path.join(paths.OUT, 'tmp_tiles')


def _turn(objs, node, deg):
    for o in objs:
        if o.name.startswith(node):
            o.rotation_mode = 'XYZ'
            # glTF import keeps Blender Z-up: spin around the node's local Z
            o.rotation_euler = (o.rotation_euler[0], o.rotation_euler[1], math.radians(deg))
    bpy.context.view_layer.update()


def parts_sheet(out_png, tile_w=798, tile_h=448):
    cam = PV._new_scene(tile_w, tile_h, 128, key_az=-120)
    tiles = []
    entries = [('cannon', 'iron', 'CANNON  T1 IRON'), ('cannon', 'titanium', 'CANNON  T2 TITANIUM'),
               ('shield_generator', 'iron', 'SHIELD GENERATOR  T1 IRON'),
               ('shield_generator', 'titanium', 'SHIELD GENERATOR  T2 TITANIUM')]
    for i, (part, tier, label) in enumerate(entries):
        for o in list(bpy.data.objects):
            if o.type in ('MESH', 'EMPTY'):
                bpy.data.objects.remove(o)
        # the part twice: at rest (left) and with turret / emitter turned 45 deg (right)
        objs = []
        for k, (dx, ang) in enumerate(((-0.62, 0), (0.62, 45))):
            _, new = PV.import_glb(os.path.join(paths.PARTS, f'{part}_{tier}.glb'), loc=(dx, -dx * 0.6, 0))
            _turn(new, 'Cannon_Turret' if part == 'cannon' else 'Shield_Emitter', ang)
            objs += new
        c, r = R.bounds(objs)
        R.aim_camera(cam, c, 38, -58, R.fit_distance(cam, r, margin=0.85))
        labs = [R.camera_label(cam, label, y_frac=0.42, size_frac=0.05),
                R.camera_label(cam, 'rest', y_frac=-0.43, x_frac=-0.12, size_frac=0.04),
                R.camera_label(cam, 'turned 45 deg', y_frac=-0.43, x_frac=0.14, size_frac=0.04)]
        tiles.append(R.render_to(os.path.join(TMP, f'm3p_{i}.png')))
        for lb in labs:
            bpy.data.objects.remove(lb)
    R.stitch(tiles, 2, tile_w, tile_h, out_png, gap=4)


def debris_sheet(out_png, blend_path, tile_w=530, tile_h=448):
    cam = PV._new_scene(tile_w, tile_h, 128, key_az=-120)
    names = ['debris_a', 'debris_b', 'debris_c', 'debris_d', 'debris_e']
    groups = []
    for i, n in enumerate(names):
        _, objs = PV.import_glb(os.path.join(paths.DEBRIS, n + '.glb'), loc=(i * 4.0, 0, 0))
        groups.append((objs, n.upper().replace('_', ' ')))
    # a scattered field like a blown-up ship
    rng = random.Random(7)
    field = []
    for k in range(16):
        n = names[k % 5]
        loc = (30 + rng.uniform(-2.2, 2.2), rng.uniform(-1.6, 1.6), rng.uniform(-0.4, 0.4))
        _, objs = PV.import_glb(os.path.join(paths.DEBRIS, n + '.glb'), loc=loc, rot_z=rng.uniform(0, 360))
        for o in objs:
            if o.parent is None:
                o.rotation_euler = [rng.uniform(0, 6.28) for _ in range(3)]
        field += objs
    groups.append((field, 'SCATTERED FIELD (16 pcs)'))
    bpy.context.view_layer.update()
    allobjs = [o for g in groups for o in g[0]]
    tiles = []
    for gi, (objs, label) in enumerate(groups):
        PV._hide(allobjs, True)
        PV._hide(objs, False)
        c, r = R.bounds(objs)
        R.aim_camera(cam, c, 40, -60, R.fit_distance(cam, r, margin=1.05))
        lab = R.camera_label(cam, f'{label}\n{PV._tri_count(objs)} tris', y_frac=-0.42, size_frac=0.04)
        tiles.append(R.render_to(os.path.join(TMP, f'm3d_{gi}.png')))
        bpy.data.objects.remove(lab)
    R.stitch(tiles, 3, tile_w, tile_h, out_png, gap=5, gap_y=4)
    PV._hide(allobjs, False)
    PV._save_blend(blend_path)


def apply_livery(objs, livery):
    """Swap the AF_Palette textures on these objects for a livery (what the
    game will do on its material)."""
    files = LV.texture_paths(paths.TEXTURES, livery)
    imgs = []
    for f, cs in zip(files, ('sRGB', 'Non-Color', 'sRGB')):
        im = bpy.data.images.load(f, check_existing=True)
        im.colorspace_settings.name = cs
        imgs.append(im)
    cache = {}
    for o in objs:
        if o.type != 'MESH':
            continue
        for slot in o.material_slots:
            m = slot.material
            if not m or not m.name.startswith('AF_Palette'):
                continue
            if m.name not in cache:
                mm = m.copy()
                mm.name = f'AF_Palette_{livery}'
                for n in mm.node_tree.nodes:
                    if n.type == 'TEX_IMAGE' and n.image:
                        nm = n.image.name.lower()
                        if 'orm' in nm:
                            n.image = imgs[1]
                        elif 'emiss' in nm:
                            n.image = imgs[2]
                        else:
                            n.image = imgs[0]
                cache[m.name] = mm
            slot.material = cache[m.name]


def pirate_shot(out_png, blend_path):
    cam = PV._new_scene(1600, 900, 160, seed=4.0, key_az=-140)
    # player ship (left, bow +X toward the pirate) and pirate ship (right, bow -X)
    lay_p = [(f, (c[0] - 4.2, c[1]), r) for f, c, r in PV.M1_SHIP]
    PV.build_ship(lay_p, connectors=True)
    lay_e = []
    for f, (x, y), r in PV.M1_SHIP:
        f2 = f.replace('mining_laser', 'cannon')
        lay_e.append((f2, (5.2 - x, -y), r + 180))
    before = set(bpy.data.objects)
    PV.build_ship(lay_e, connectors=True)
    pirate = [o for o in bpy.data.objects if o not in before]
    apply_livery(pirate, 'pirate')
    PV.add_rocks([('asteroid_iron_b', (-1.0, 9.5, -1.5), 30), ('asteroid_ice_a', (12.0, -7.0, -1.5), 70),
                  ('asteroid_copper_c', (-12.0, -7.5, -1.5), 140)])
    R.aim_camera(cam, (0.5, 0.0, 0.0), 55, -90, 30.0)
    R.camera_label(cam, 'PLAYER', y_frac=-0.2, x_frac=-0.16, size_frac=0.028)
    R.camera_label(cam, 'PIRATE LIVERY', y_frac=-0.2, x_frac=0.17, size_frac=0.028)
    R.render_to(out_png)
    PV._save_blend(blend_path)


def icons_sheet(out_png):
    from icons import PART_IDS, RESOURCES
    W, H_ = 1600, 900
    bg = np.zeros((H_, W, 4), dtype=np.float32)
    bg[..., 0], bg[..., 1], bg[..., 2], bg[..., 3] = 0.035, 0.045, 0.06, 1.0

    def paste(path, cx, cy_top):
        a = R.read_png(path)
        h, w, _ = a.shape
        x0, y0 = cx - w // 2, H_ - cy_top - h
        al = a[..., 3:4]
        reg = bg[y0:y0 + h, x0:x0 + w, :3]
        bg[y0:y0 + h, x0:x0 + w, :3] = a[..., :3] * al + reg * (1 - al)

    ids = list(PART_IDS.values())[:15]      # the M3 set (M4/M5a icons: preview_m5a icons sheet)
    n = len(ids)
    step = (W - 120) // n
    for row, tn in enumerate((1, 2)):
        for i, pid in enumerate(ids):
            paste(os.path.join(paths.ICONS, 'parts', f'{pid}_t{tn}.png'), 60 + step // 2 + i * step,
                  120 + row * 190)
    for i, rid in enumerate(list(RESOURCES)[:4]):
        paste(os.path.join(paths.ICONS, 'resources', f'{rid}.png'), W // 2 - 300 + i * 200, 560)
    R.write_png(bg, out_png)


def main(iter_tag=None):
    os.makedirs(paths.PREVIEWS, exist_ok=True)
    P = paths.PREVIEWS
    pa = os.path.join(P, 'm3-parts.png')
    de = os.path.join(P, 'm3-debris.png')
    pi = os.path.join(P, 'm3-pirate.png')
    ic = os.path.join(P, 'm3-icons.png')
    parts_sheet(pa)
    debris_sheet(de, os.path.join(paths.BLEND, 'm3-debris.blend'))
    pirate_shot(pi, os.path.join(paths.BLEND, 'm3-pirate.blend'))
    icons_sheet(ic)
    shutil.rmtree(TMP, ignore_errors=True)
    PV._keep_iterations(iter_tag, ((pa, 'm3-parts'), (de, 'm3-debris'), (pi, 'm3-pirate'), (ic, 'm3-icons')))


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv[argv.index('--iter') + 1] if '--iter' in argv else None)
