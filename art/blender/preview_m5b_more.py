"""M5b previews: drones, cruise drive, home modules (called from preview_m5b_base.main_extra)."""
import math
import os

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
import preview_m5b as M5  # noqa: E402
from lib import render as R  # noqa: E402

TMP = M5.TMP
P = paths.PREVIEWS


def _by_name(objs, name):
    for o in objs:
        if o.name == name or o.name.split('.')[0] == name:
            return o
    return None


def _turn(objs, node, deg, axis=2):
    o = _by_name(objs, node)
    if o:
        r = list(o.rotation_euler)
        r[axis] += math.radians(deg)
        o.rotation_euler = r
        bpy.context.view_layer.update()


# ----------------------------------------------------------------------------
DRONES = [('drone_cargo', 'CARGO DRONE', -55, 30), ('drone_mining', 'MINING DRONE', -55, 32),
          ('drone_repair', 'REPAIR DRONE', -55, 32), ('drone_scout', 'SCOUT DRONE', -55, 30)]


def drones(only):
    W, H = 1600, 900
    cam = PV._new_scene(398, 448, 128, key_az=-120)
    tiles = []
    for i, (f, label, az, el) in enumerate(DRONES):
        M5._clear()
        objs = M5._imp('drones', f)
        if f == 'drone_mining':
            _turn(objs, 'Drone_Laser', -25)
        if f == 'drone_repair':
            _turn(objs, 'Repair_Arm_L', 20)
            _turn(objs, 'Repair_Arm_R', -20)
        c, r = R.bounds([o for o in objs if o.type == 'MESH'])
        R.aim_camera(cam, c, el, az, R.fit_distance(cam, r, margin=0.95))
        labs = [R.camera_label(cam, label, y_frac=0.43, size_frac=0.05),
                R.camera_label(cam, f'{M5._tris(objs)} tris', y_frac=-0.44, size_frac=0.04)]
        tiles.append(R.render_to(os.path.join(TMP, f'd_{i}.png')))
        for lb in labs:
            bpy.data.objects.remove(lb)
    # scale scene: titanium ship with mining + repair drones, cargo drone on a drone dock
    cam = PV._new_scene(1600, 448, 160, seed=3.0, key_az=-130)
    lay = [(f.replace('_iron', '_titanium'), c, r) for f, c, r in PV.M1_SHIP]
    PV.build_ship(lay, connectors=True)
    M5._imp('drones', 'drone_mining', loc=(3.6, 2.0, 0.3), rot=200)
    M5._imp('drones', 'drone_mining', loc=(3.4, -2.6, 0.2), rot=150)
    rep = M5._imp('drones', 'drone_repair', loc=(-2.3, 1.9, 0.6), rot=-60)
    M5._imp('drones', 'drone_scout', loc=(-6.5, -1.8, 0.0), rot=20)
    M5._imp('asteroids', 'asteroid_iron_a', loc=(6.6, 0.4, -0.6), rot=40)
    dock = M5._imp('base', 'base_module_drone_dock', loc=(11.5, 0.0, -1.6), rot=180)
    pad = _by_name(dock, 'drone_pad')
    bpy.context.view_layer.update()
    pp = pad.matrix_world.translation
    M5._imp('drones', 'drone_cargo', loc=(pp.x, pp.y, pp.z + 0.62), rot=180)
    R.aim_camera(cam, (2.5, 0.0, 0.0), 55, -90, 19.5)
    R.camera_label(cam, 'scale: ship cells = 1 u  |  mining + repair drones (hangar), scout, cargo drone landed on '
                        'a base drone dock (drone_pad + landingHeight)', y_frac=-0.45, size_frac=0.03)
    scale = R.render_to(os.path.join(TMP, 'd_scale.png'))
    canvas = M5._canvas(W, H)
    for i, t in enumerate(tiles):
        M5._paste(canvas, R.read_png(t), i * 400 + (1 if i else 0), 0)
    M5._paste(canvas, R.read_png(scale), 0, 452)
    out = os.path.join(P, 'm5b-drones.png')
    R.write_png(canvas, out)
    return [(out, 'm5b-drones')]


# ----------------------------------------------------------------------------
def cruise(only):
    import preview_m5a as PA
    out = os.path.join(P, 'm5b-cruise.png')
    W, H = 1600, 900
    cam = PV._new_scene(1060, 448, 160, key_az=-120)
    objs = []
    for k, tier in enumerate(('iron', 'titanium', 'crystal')):
        objs += M5._imp('parts', f'cruise_drive_{tier}', loc=(0, (1 - k) * 1.7, 0))
    c, r = R.bounds([o for o in objs if o.type == 'MESH'])
    R.aim_camera(cam, c, 34, -60, R.fit_distance(cam, r, margin=0.8))
    R.camera_label(cam, 'CRUISE DRIVE 2x1  (cruise_drive_<tier>.glb)  T1 / T2 / T3', y_frac=0.43, size_frac=0.045)
    R.camera_label(cam, f'{M5._tris(objs) // 3} tris avg', y_frac=-0.44, x_frac=0.36, size_frac=0.035)
    sheet = R.render_to(os.path.join(TMP, 'c_sheet.png'))
    # rear 3/4 (nozzle + spool)
    cam = PV._new_scene(536, 448, 128, key_az=-150)
    M5._clear()
    objs = M5._imp('parts', 'cruise_drive_titanium')
    c, r = R.bounds([o for o in objs if o.type == 'MESH'])
    R.aim_camera(cam, c, 26, -150, R.fit_distance(cam, r, margin=0.85))
    R.camera_label(cam, 'rear: nozzle + Cruise_Spool', y_frac=0.43, size_frac=0.05)
    rear = R.render_to(os.path.join(TMP, 'c_rear.png'))
    # on a ship (hauler layout) at game camera
    cam = PV._new_scene(1060, 448, 160, seed=3.0, key_az=-140)
    lay = [('cockpit_titanium', (2, 0), 0), ('gyroscope_titanium', (1, 0), 0), ('reactor_titanium', (0, 0), 0),
           ('cargo_titanium', (1, 1), 0), ('cargo_titanium', (1, -1), 0), ('fuel_tank_titanium', (0, 1), 0),
           ('fuel_tank_titanium', (0, -1), 0), ('engine_titanium', (-1, 1), 0), ('engine_titanium', (-1, -1), 0),
           ('radar_titanium', (2, 1), 0), ('shield_generator_titanium', (2, -1), 0)]
    PV.build_ship(lay, connectors=True)
    # cruise drive 2x1 on cells (-2,0),(-1,0) -> origin (-1.5, 0)
    M5._imp('parts', 'cruise_drive_titanium', loc=(-1.5, 0, 0))
    R.aim_camera(cam, (0.0, 0, 0), 55, -90, 9.0)
    R.camera_label(cam, 'on a ship (cells (-2,0),(-1,0) -> origin (-1.5, 0)), game camera', y_frac=-0.44, size_frac=0.035)
    ship = R.render_to(os.path.join(TMP, 'c_ship.png'))
    canvas = M5._canvas(W, H)
    M5._paste(canvas, R.read_png(sheet), 0, 0)
    M5._paste(canvas, R.read_png(rear), 1064, 0)
    M5._paste(canvas, R.read_png(ship), 0, 452)
    # icons t1..t3 (128 px) on the right bottom
    import numpy as np
    for k in range(3):
        p = os.path.join(paths.ICONS, 'parts', f'cruiseDrive_t{k + 1}.png')
        if os.path.exists(p):
            ic = R.read_png(p)
            big = np.kron(ic, np.ones((1, 1, 1)))
            a = big[..., 3:4]
            bg = np.zeros_like(big)
            bg[..., :3] = (0.02, 0.025, 0.035)
            comp = big * a + bg * (1 - a)
            comp[..., 3] = 1
            M5._paste(canvas, comp, 1090 + k * 170, 600)
    R.write_png(canvas, out)
    return [(out, 'm5b-cruise')]


# ----------------------------------------------------------------------------
def home(only):
    import home_modules as HM
    import json
    out = os.path.join(P, 'm5b-home-modules.png')
    lay = HM.layouts_json()
    W, H = 1600, 900
    cam = PV._new_scene(1060, 900, 160, seed=3.0, key_az=-130)
    M5._clear()
    objs = M5._imp('stations', 'station_home')
    for mod, slot in HM.PREVIEW_FIT.items():
        s = lay['slots'][slot]
        objs += M5._imp('stations', HM.MODULES[mod]['file'], loc=(s['x'], s['y'], s['z']), rot=s['yawDeg'])
    M5._imp('stations', 'dock_clamp', loc=(14, 0, 0))
    R.aim_camera(cam, (-1.0, 1.5, 0), 56, -90, 84)
    R.camera_label(cam, 'HOME STATION  all 6 modules  (M5b: observatory > fr, laboratory > port, drone hub > aft)',
                   y_frac=0.45, size_frac=0.026)
    big = R.render_to(os.path.join(TMP, 'h_big.png'))
    PV._save_blend(os.path.join(paths.BLEND, 'm5b-home.blend'))
    cam = PV._new_scene(536, 296, 128, key_az=-120)
    small = []
    for i, mod in enumerate(('observatory', 'laboratory', 'drone_hub')):
        M5._clear()
        info = HM.MODULES[mod]
        objs = M5._imp('stations', info['file'])
        c, r = R.bounds([o for o in objs if o.type == 'MESH'])
        R.aim_camera(cam, c, 38, -50, R.fit_distance(cam, r, margin=0.82))
        labs = [R.camera_label(cam, info['label'], y_frac=0.42, size_frac=0.06),
                R.camera_label(cam, f'{M5._tris(objs)} tris', y_frac=-0.43, size_frac=0.05)]
        small.append(R.render_to(os.path.join(TMP, f'h_{i}.png')))
        for lb in labs:
            bpy.data.objects.remove(lb)
    canvas = M5._canvas(W, H)
    M5._paste(canvas, R.read_png(big), 0, 0)
    for i, t in enumerate(small):
        M5._paste(canvas, R.read_png(t), 1064, i * 302)
    R.write_png(canvas, out)
    return [(out, 'm5b-home-modules')]
