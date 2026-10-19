"""Previews for the pirate clan part sets (build_pirate_parts.py).

  blender --background --factory-startup --python art/blender/preview_pirate_parts.py -- [--only a,b] [--iter tag]

  sheets   pirate-parts-<clan>.png      per part: player T1 | clan T1 | clan T2 (3/4 view, turret turned)
  lineup   pirate-ships-close.png       player Hammer + the three clan Hammers (T1 row, T2 row), close
           pirate-ships-gamecam.png     the same at the game camera (pitch 55, fov 50, distance 48)
           pirate-jackal-scavenger.png  Jackal + Scavenger per clan at the game camera
  sockets  pirate-sockets.png           mixed ships (player/clan parts in a checkerboard, hull connectors,
                                        muzzle/emitter empties marked), top view + 3/4 view
  derelict pirate-derelict.png          clan ships + player ship with the derelict livery
"""
import math
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
import preview_m3 as P3  # noqa: E402
from lib import render as R  # noqa: E402

TMP = os.path.join(paths.OUT, 'tmp_tiles_pirate')
PIR = os.path.join(paths.MODELS, 'parts_pirate')
CLANS = ('rust', 'cauldron', 'slantedStar')
LABEL = {'rust': 'HRDZA (rust)', 'cauldron': 'KOTOL (cauldron)', 'slantedStar': 'SIKMA HVIEZDA (slantedStar)',
         'player': 'PLAYER'}
PARTS = [('cockpit', 'COCKPIT'), ('engine', 'ENGINE'), ('cannon', 'CANNON'), ('armor', 'ARMOR'),
         ('shield_generator', 'SHIELD'), ('reactor', 'REACTOR'), ('gyroscope', 'GYRO'), ('fuel_tank', 'FUEL TANK'),
         ('cargo', 'CARGO'), ('tractor_beam', 'TRACTOR BEAM')]
GAME_LENS = 12.0 / math.tan(math.radians(25))     # vertical fov 50 deg with sensor height 24

# ship templates (src/sim/combat/enemies.ts): (module, x, y, game rot) - Blender rot_z = 90 * rot
HAMMER = [('cockpit', 1, 0, 0), ('armor', 2, 0, 0), ('armor', 1, 1, 0), ('armor', 1, -1, 0),
          ('cannon', 2, 1, 0), ('cannon', 2, -1, 0), ('shield_generator', 0, 0, 0), ('reactor', -1, 0, 0),
          ('gyroscope', 0, 1, 0), ('fuel_tank', 0, -1, 0), ('engine', -2, 0, 0), ('engine', -1, 1, 0),
          ('engine', -1, -1, 0), ('engine', 0, 2, 3), ('engine', 0, -2, 1), ('engine', 1, 2, 2), ('engine', 1, -2, 2)]
JACKAL = [('cockpit', 0, 0, 0), ('cannon', 1, 0, 0), ('engine', -1, 0, 0), ('engine', 0, 1, 3), ('engine', 0, -1, 1),
          ('engine', 1, 1, 2), ('engine', 1, -1, 2)]
SCAVENGER = [('cockpit', 1, 0, 0), ('tractor_beam', 2, 0, 0), ('gyroscope', 1, 2, 0), ('fuel_tank', 0, 0, 0),
             ('cargo', 0, 1, 0), ('cargo', 0, -1, 0), ('reactor', -1, 0, 0), ('engine', -2, 0, 0),
             ('engine', -1, 1, 0), ('engine', -1, -1, 0), ('engine', 0, 2, 3), ('engine', 0, -2, 1),
             ('engine', 1, 1, 2), ('engine', 1, -1, 2)]


def part_file(owner, module, tier):
    if owner == 'player':
        return os.path.join(paths.PARTS, f'{module}_{tier}.glb')
    return os.path.join(PIR, owner, f'{module}_{tier}.glb')


def _clear():
    for o in list(bpy.data.objects):
        if o.type in ('MESH', 'EMPTY', 'FONT'):
            bpy.data.objects.remove(o)


def _turn(objs, deg):
    for name in ('Cannon_Turret', 'Tractor_Head', 'Shield_Emitter'):
        P3._turn(objs, name, deg)


def build_ship(layout, owner, tier, origin=(0, 0), rot=0.0, owner_of=None, connectors=True):
    """layout: (module, x, y, game rot). owner_of(i, x, y) -> 'player' | clan overrides `owner`."""
    objs = []
    ca, sa = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    cells = []
    for i, (module, x, y, r) in enumerate(layout):
        own = owner_of(i, x, y) if owner_of else owner
        wx, wy = origin[0] + x * ca - y * sa, origin[1] + x * sa + y * ca
        _, new = PV.import_glb(part_file(own, module, tier), loc=(wx, wy, 0), rot_z=90 * r + rot)
        objs += new
        cells.append((x, y))
    if connectors:
        # clan ships use the clan connectors; mixed (socket test) ships the player's
        folder = paths.PARTS if owner == 'player' or owner_of else os.path.join(PIR, owner)
        for f, (x, y), r in PV.connector_placements(cells):
            wx, wy = origin[0] + x * ca - y * sa, origin[1] + x * sa + y * ca
            _, new = PV.import_glb(os.path.join(folder, f + '.glb'), loc=(wx, wy, 0), rot_z=r + rot)
            objs += new
    return objs


def _game_cam():
    cam = R.make_camera('GameCam', lens=GAME_LENS)
    return cam


# ---------------------------------------------------------------------------
def sheets(tag):
    out = []
    tile_w, tile_h = 640, 330
    for clan in SHEET_CLANS:
        cam = PV._new_scene(tile_w, tile_h, 96, key_az=-120)
        tiles = []
        for i, (module, label) in enumerate(PARTS):
            _clear()
            objs = []
            az = -125 if module == 'engine' else -60
            r_az = math.radians(az)
            right = (-math.sin(r_az), math.cos(r_az))
            for k, (own, tier) in enumerate((('player', 'iron'), (clan, 'iron'), (clan, 'titanium'))):
                s = (k - 1) * 1.12
                _, new = PV.import_glb(part_file(own, module, tier), loc=(s * right[0], s * right[1], 0))
                _turn(new, 35)
                objs += new
            c, r = R.bounds(objs)
            R.aim_camera(cam, c, 36, az, R.fit_distance(cam, r, margin=0.78))
            labs = [R.camera_label(cam, label, y_frac=0.42, size_frac=0.058),
                    R.camera_label(cam, 'player T1', y_frac=-0.43, x_frac=-0.27, size_frac=0.045),
                    R.camera_label(cam, f'{clan} T1', y_frac=-0.43, x_frac=0.0, size_frac=0.045),
                    R.camera_label(cam, f'{clan} T2', y_frac=-0.43, x_frac=0.27, size_frac=0.045)]
            tiles.append(R.render_to(os.path.join(TMP, f'{clan}_{i}.png')))
            for lb in labs:
                bpy.data.objects.remove(lb)
        png = os.path.join(paths.PREVIEWS, f'pirate-parts-{clan}.png')
        R.stitch(tiles, 2, tile_w, tile_h, png, gap=4)
        out.append((png, f'pirate-parts-{clan}'))
    return out


def lineup(tag):
    out = []
    owners = ('player',) + CLANS
    # close shot: 4 Hammers per row, T1 top row, T2 bottom row
    cam = PV._new_scene(1800, 1000, 128, seed=3.0, key_az=-140)
    for row, tier in enumerate(('iron', 'titanium')):
        for k, own in enumerate(owners):
            build_ship(HAMMER, own, tier, origin=(-10.5 + 7.0 * k, 4.2 - 8.6 * row))
    R.aim_camera(cam, (0.0, -0.2, 0.0), 55, -90, 30.0)
    for k, own in enumerate(owners):
        R.camera_label(cam, LABEL[own], y_frac=0.44, x_frac=-0.33 + 0.218 * k, size_frac=0.022)
    R.camera_label(cam, 'T1 iron', y_frac=0.05, x_frac=-0.46, size_frac=0.02)
    R.camera_label(cam, 'T2 titanium', y_frac=-0.42, x_frac=-0.44, size_frac=0.02)
    p = os.path.join(paths.PREVIEWS, 'pirate-ships-close.png')
    R.render_to(p)
    out.append((p, 'pirate-ships-close'))
    PV._save_blend(os.path.join(paths.BLEND, 'pirate-ships.blend'))

    # game camera: pitch 55, fov 50, distance 48 (CameraRig DEFAULT_DISTANCE) - player + 3 T1 Hammers
    _clear()
    cam = _game_cam()
    bpy.context.scene.camera = cam
    for o in [o for o in bpy.data.objects if o.name == 'Cam']:
        bpy.data.objects.remove(o)
    pos = {'player': (-1.0, -4.0), 'rust': (9.0, 5.0), 'cauldron': (13.0, -6.0), 'slantedStar': (-12.0, 6.5)}
    rots = {'player': 20, 'rust': 200, 'cauldron': 160, 'slantedStar': -30}
    for own in owners:
        build_ship(HAMMER, own, 'iron', origin=pos[own], rot=rots[own])
    PV.add_rocks([('asteroid_iron_b', (-4.0, 12.0, -1.5), 30), ('asteroid_ice_a', (17.0, 12.0, -1.5), 70),
                  ('asteroid_copper_c', (-17.0, -9.0, -1.5), 140), ('asteroid_titanium_a', (4.0, -14.0, -1.6), 10)])
    R.aim_camera(cam, (0.0, 0.0, 0.0), 55, -90, 48.0)
    p = os.path.join(paths.PREVIEWS, 'pirate-ships-gamecam.png')
    R.render_to(p)
    out.append((p, 'pirate-ships-gamecam'))
    R.aim_camera(cam, (0.0, 0.0, 0.0), 55, -90, 28.0)
    p2 = os.path.join(paths.PREVIEWS, 'pirate-ships-gamecam28.png')
    R.render_to(p2)
    out.append((p2, 'pirate-ships-gamecam28'))

    # jackals + scavengers per clan at the game camera
    _clear()
    for k, clan in enumerate(CLANS):
        x = -12.0 + 12.0 * k
        build_ship(JACKAL, clan, 'iron', origin=(x - 2.5, 5.0), rot=-90)
        build_ship(JACKAL, clan, 'titanium', origin=(x + 2.5, 5.0), rot=-90)
        build_ship(SCAVENGER, clan, 'iron', origin=(x, -4.5), rot=90)
    R.aim_camera(cam, (0.0, 0.0, 0.0), 55, -90, 34.0)
    for k, clan in enumerate(CLANS):
        R.camera_label(cam, LABEL[clan], y_frac=0.44, x_frac=-0.3 + 0.3 * k, size_frac=0.022)
    p3 = os.path.join(paths.PREVIEWS, 'pirate-jackal-scavenger.png')
    R.render_to(p3)
    out.append((p3, 'pirate-jackal-scavenger'))
    return out


def _marker(loc, name='Marker'):
    """Small glowing octahedron at an empty (muzzle / emitter) for the socket check."""
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.045)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    m = bpy.data.materials.get('AF_Marker') or bpy.data.materials.new('AF_Marker')
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (0.2, 1.0, 0.3, 1)
    em.inputs['Strength'].default_value = 6
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], o.inputs[0])
    me.materials.append(m)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    return ob


def sockets(tag):
    """Mixed ships: player and clan parts in a checkerboard so every seam is player|pirate."""
    out = []
    cam = PV._new_scene(1800, 1000, 96, seed=2.0, key_az=-140)
    layout = HAMMER + [('cargo', -1, 2, 0), ('tractor_beam', 2, 2, 0), ('cannon', 3, 0, 0), ('armor', -1, -2, 0)]
    objs = []
    for k, clan in enumerate(CLANS):
        objs += build_ship(layout, clan, 'titanium' if k == 1 else 'iron', origin=(-11.0 + 11.0 * k, 0.0),
                           owner_of=lambda i, x, y, c=clan: 'player' if (x + y) % 2 == 0 else c)
    bpy.context.view_layer.update()
    for o in list(bpy.data.objects):
        if o.type == 'EMPTY' and o.name.split('.')[0] in ('Cannon_Muzzle', 'Tractor_Emitter'):
            _marker(o.matrix_world.translation.copy())
    R.aim_camera(cam, (0.5, 0.0, 0.0), 89.9, -90, 43.0)
    for k, clan in enumerate(CLANS):
        R.camera_label(cam, f'player | {clan} checkerboard', y_frac=0.44, x_frac=-0.33 + 0.33 * k, size_frac=0.022)
    R.camera_label(cam, 'top view - hull connectors on every seam, green = muzzle / emitter empties',
                   y_frac=-0.45, size_frac=0.02)
    p = os.path.join(paths.PREVIEWS, 'pirate-sockets.png')
    R.render_to(p)
    out.append((p, 'pirate-sockets'))
    R.aim_camera(cam, (11.0, 0.0, 0.0), 35, -70, 12.0)
    p2 = os.path.join(paths.PREVIEWS, 'pirate-sockets-34.png')
    R.render_to(p2)
    out.append((p2, 'pirate-sockets-34'))
    return out


def derelict(tag):
    out = []
    cam = PV._new_scene(1800, 900, 128, seed=3.0, key_az=-140)
    owners = ('player',) + CLANS
    for k, own in enumerate(owners):
        alive = build_ship(HAMMER, own, 'iron', origin=(-10.5 + 7.0 * k, 3.6))
        dead = build_ship(HAMMER, own, 'iron', origin=(-10.5 + 7.0 * k, -3.8), rot=17)
        P3.apply_livery(dead, 'derelict')
        del alive
    R.aim_camera(cam, (0.0, -0.1, 0.0), 55, -90, 27.0)
    for k, own in enumerate(owners):
        R.camera_label(cam, LABEL[own], y_frac=0.44, x_frac=-0.33 + 0.218 * k, size_frac=0.022)
    R.camera_label(cam, 'derelict livery', y_frac=-0.45, size_frac=0.022)
    p = os.path.join(paths.PREVIEWS, 'pirate-derelict.png')
    R.render_to(p)
    out.append((p, 'pirate-derelict'))
    return out


SHEET_CLANS = list(CLANS)
STAGES = {'sheets': sheets, 'lineup': lineup, 'sockets': sockets, 'derelict': derelict}


def main(argv):
    only = argv[argv.index('--only') + 1].split(',') if '--only' in argv else list(STAGES)
    tag = argv[argv.index('--iter') + 1] if '--iter' in argv else None
    if '--clans' in argv:
        SHEET_CLANS[:] = argv[argv.index('--clans') + 1].split(',')
    os.makedirs(paths.PREVIEWS, exist_ok=True)
    files = []
    for s in only:
        files += STAGES[s](tag)
    shutil.rmtree(TMP, ignore_errors=True)
    PV._keep_iterations(tag, files)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
