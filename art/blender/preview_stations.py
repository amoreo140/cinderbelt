"""M2 station previews: contact sheet, home station at game scale with the
docked starter ship, hangar with the ship, icon sheet, collision overlay."""
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
import structures as S  # noqa: E402
from lib import render as R  # noqa: E402

STATION_TILES = [  # file, label, azimuth, elevation
    ('station_home', 'HOME  "ZAKLADNA POCIATOK"', -60, 42),
    ('station_a', 'STATION A  -  TRADE', -60, 42),
    ('station_b', 'STATION B  -  ICE REFINERY', -60, 42),
    ('station_c', 'STATION C  -  SHIPYARD', -60, 42),
    ('outpost_a', 'OUTPOST A', -60, 42),
    ('outpost_b', 'OUTPOST B', -60, 42),
    ('dock_clamp', 'DOCK CLAMP', -60, 42),
    ('hangar_platform', 'HANGAR PLATFORM', -60, 48),
]


def _station_path(name):
    return os.path.join(paths.STATIONS, name + '.glb')


def _import_station(name, loc=(0, 0, 0), with_clamp=True):
    roots, objs = PV.import_glb(_station_path(name), loc=loc)
    if with_clamp and name in S.LAYOUTS:
        R_ = S.LAYOUTS[name]['R']
        _, c = PV.import_glb(_station_path('dock_clamp'), loc=(loc[0] + R_, loc[1], loc[2]))
        objs += c
    return objs


def stations_sheet(out_png, blend_path, tile_w=397, tile_h=448):
    cam = PV._new_scene(tile_w, tile_h, 128, key_az=-120)
    cam.data.clip_end = 2000
    groups = []
    for i, (name, label, az, el) in enumerate(STATION_TILES):
        objs = _import_station(name, loc=(i * 40.0, 0, 0))
        groups.append((objs, label, az, el))
    allobjs = [o for g in groups for o in g[0]]
    tile_dir = os.path.join(paths.OUT, 'tmp_tiles')
    tiles = []
    for gi, (objs, label, az, el) in enumerate(groups):
        PV._hide(allobjs, True)
        PV._hide(objs, False)
        c, r = R.bounds(objs)
        R.aim_camera(cam, c, el, az, R.fit_distance(cam, r, margin=0.95))
        lab = R.camera_label(cam, f'{label}\n{PV._tri_count(objs)} tris', y_frac=-0.42, size_frac=0.032)
        tiles.append(R.render_to(os.path.join(tile_dir, f'st_{gi}.png')))
        bpy.data.objects.remove(lab)
    R.stitch(tiles, 4, tile_w, tile_h, out_png, gap=4)
    shutil.rmtree(tile_dir, ignore_errors=True)
    PV._hide(allobjs, False)
    R.aim_camera(cam, (140, 0, 0), 40, -90, 160)
    PV._save_blend(blend_path)


def starter_bounding_radius():
    cells = [c for _, c, _ in PV.M1_SHIP]
    cx = sum(x for x, _ in cells) / len(cells)
    cy = sum(y for _, y in cells) / len(cells)
    r = 0.0
    for x, y in cells:
        for dx in (-0.5, 0.5):
            for dy in (-0.5, 0.5):
                r = max(r, math.hypot(x + dx - cx, y + dy - cy))
    return (cx, cy), r


def docked_ship_layout(R_):
    """Starter ship docked per spec 7.2: centre at R + bR + 1 on +X, bow toward
    the station (rotated 180 deg)."""
    (cx, cy), br = starter_bounding_radius()
    px = R_ + br + 1.0
    lay = []
    for f, (x, y), rot in PV.M1_SHIP:
        lay.append((f, (px - (x - cx), -(y - cy)), rot + 180))
    return lay, br


def home_gamescale(out_png, blend_path):
    cam = PV._new_scene(1600, 900, 160, seed=3.0, key_az=-140)
    cam.data.clip_end = 2000
    _import_station('station_home')
    R_ = S.LAYOUTS['station_home']['R']
    lay, br = docked_ship_layout(R_)
    PV.build_ship(lay, connectors=True)
    PV.add_rocks([('asteroid_iron_b', (-24.0, 16.0, -2.0), 30), ('asteroid_ice_b', (30.0, 18.0, -3.0), 70),
                  ('asteroid_copper_a', (-26.0, -14.0, -2.0), 140), ('asteroid_titanium_b', (31.0, -15.0, -2.5), 200),
                  ('asteroid_iron_c', (8.0, 27.0, -2.0), 10)])
    R.aim_camera(cam, (3.0, 0.0, 0.0), 55, -90, 62.0)
    R.render_to(out_png)
    PV._save_blend(blend_path)
    return br


def hangar_view(out_png, blend_path):
    cam = PV._new_scene(1600, 900, 160, seed=2.0, key_az=-130)
    PV.import_glb(_station_path('hangar_platform'))
    PV.build_ship(PV.M1_SHIP, connectors=True)
    R.aim_camera(cam, (0.0, 0.6, 0.0), 64, -90, 40.0)
    R.render_to(out_png)
    PV._save_blend(blend_path)


def icons_sheet(out_png):
    """Composite all icons on a dark UI-like panel (numpy, no text)."""
    W, H_ = 1600, 900
    bg = np.zeros((H_, W, 4), dtype=np.float32)
    bg[..., 0], bg[..., 1], bg[..., 2], bg[..., 3] = 0.055, 0.07, 0.095, 1.0
    from icons import PART_IDS, RESOURCES

    def paste(img_path, x0, y_top, slot):
        a = R.read_png(img_path)
        h, w, _ = a.shape
        # slot background
        ys, xs = H_ - y_top - slot, x0
        bg[ys:ys + slot, xs:xs + slot, :3] = (0.10, 0.125, 0.165)
        ox, oy = xs + (slot - w) // 2, ys + (slot - h) // 2
        al = a[..., 3:4]
        region = bg[oy:oy + h, ox:ox + w, :3]
        bg[oy:oy + h, ox:ox + w, :3] = a[..., :3] * al + region * (1 - al)

    slot, gap = 150, 18
    x_start = (W - (9 * slot + 8 * gap)) // 2
    for row, tn in enumerate((1, 2)):
        for i, pid in enumerate(PART_IDS.values()):
            paste(os.path.join(paths.ICONS, 'parts', f'{pid}_t{tn}.png'), x_start + i * (slot + gap),
                  60 + row * (slot + 40), slot)
    rs = 96
    xr = (W - (4 * rs + 3 * 60)) // 2
    for i, rid in enumerate(RESOURCES):
        paste(os.path.join(paths.ICONS, 'resources', f'{rid}.png'), xr + i * (rs + 60), 60 + 2 * (slot + 40) + 30, rs)
    R.write_png(np.clip(bg, 0, 1), out_png)


# ----------------------------------------------------------------------------
# collision overlay (orthographic top-down)
# ----------------------------------------------------------------------------
def _debug_mat(name, rgb, strength=3.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*rgb, 1)
    em.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


def _ring(name, x, y, r, width, mat, z=30.0, verts=64):
    import bmesh
    bm = bmesh.new()
    outer = [bm.verts.new((x + (r + width / 2) * math.cos(2 * math.pi * i / verts),
                           y + (r + width / 2) * math.sin(2 * math.pi * i / verts), z)) for i in range(verts)]
    inner = [bm.verts.new((x + max(0.0, r - width / 2) * math.cos(2 * math.pi * i / verts),
                           y + max(0.0, r - width / 2) * math.sin(2 * math.pi * i / verts), z)) for i in range(verts)]
    for i in range(verts):
        j = (i + 1) % verts
        bm.faces.new((outer[i], outer[j], inner[j], inner[i]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def collision_sheet(out_png, tile_w=530, tile_h=448):
    cam = PV._new_scene(tile_w, tile_h, 96, key_az=-120)
    cam.data.type = 'ORTHO'
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.clip_end = 2000
    red = _debug_mat('DebugRed', (1.0, 0.12, 0.1), 4.0)
    green = _debug_mat('DebugGreen', (0.1, 1.0, 0.3), 4.0)
    white = _debug_mat('DebugWhite', (0.8, 0.85, 1.0), 1.5)
    yellow = _debug_mat('DebugYellow', (1.0, 0.8, 0.1), 2.0)
    names = [n for n in S.LAYOUTS]
    tile_dir = os.path.join(paths.OUT, 'tmp_tiles')
    tiles = []
    groups = []
    for i, name in enumerate(names):
        ox = i * 80.0
        objs = _import_station(name, loc=(ox, 0, 0))
        L = S.LAYOUTS[name]
        for k, (x, y, r) in enumerate(L['circles']):
            objs.append(_ring(f'C{i}_{k}', ox + x, y, r, 0.12 + 0.01 * L['R'], red))
        objs.append(_ring(f'R{i}', ox, 0, L['R'], 0.08, white))
        objs.append(_ring(f'P{i}', ox + L['R'], 0, 0.35, 0.7, green))
        groups.append((objs, name, L, ox))
    allobjs = [o for g in groups for o in g[0]]
    for gi, (objs, name, L, ox) in enumerate(groups):
        PV._hide(allobjs, True)
        PV._hide(objs, False)
        span = L['R'] * 1.22
        cam.data.ortho_scale = 2 * span
        cam.location = (ox + L['R'] * 0.12, 0, 60)
        cam.rotation_euler = (0, 0, 0)
        lab_txt = f'{name}   R={L["R"]:g}   clearRadius={L["R"] + S.CLEAR_MARGIN:g}'
        cu = bpy.data.curves.new('Lbl', 'FONT')
        cu.body = lab_txt
        cu.align_x = 'CENTER'
        cu.size = span * 0.075
        lab = bpy.data.objects.new('Lbl', cu)
        lab.data.materials.append(white)
        bpy.context.scene.collection.objects.link(lab)
        lab.location = (ox + L['R'] * 0.12, -span * 0.9, 40)
        tiles.append(R.render_to(os.path.join(tile_dir, f'col_{gi}.png')))
        bpy.data.objects.remove(lab)
    R.stitch(tiles, 3, tile_w, tile_h, out_png, gap=5, gap_y=4)
    shutil.rmtree(tile_dir, ignore_errors=True)


def main(iter_tag=None):
    os.makedirs(paths.PREVIEWS, exist_ok=True)
    P = paths.PREVIEWS
    st = os.path.join(P, 'm2-stations.png')
    hg = os.path.join(P, 'm2-home-gamescale.png')
    hn = os.path.join(P, 'm2-hangar.png')
    ic = os.path.join(P, 'm2-icons.png')
    co = os.path.join(P, 'm2-stations-collision.png')
    stations_sheet(st, os.path.join(paths.BLEND, 'm2-stations.blend'))
    br = home_gamescale(hg, os.path.join(paths.BLEND, 'm2-home.blend'))
    hangar_view(hn, os.path.join(paths.BLEND, 'm2-hangar.blend'))
    icons_sheet(ic)
    collision_sheet(co)
    PV._keep_iterations(iter_tag, ((st, 'm2-stations'), (hg, 'm2-home-gamescale'), (hn, 'm2-hangar'),
                                   (ic, 'm2-icons'), (co, 'm2-stations-collision')))
    print('STARTER_BR', br)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv[argv.index('--iter') + 1] if '--iter' in argv else None)
