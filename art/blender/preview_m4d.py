"""M4d previews (M4d task A1) - rendered from the SHIPPED (optimized) GLBs.

  blender --background --factory-startup --python art/blender/preview_m4d.py -- [--only relay,trader] [--iter m4dN]

  relay   m4d-relay.png           guild_relay_mast: broken / repaired / lit (3/4) + derelict_relay for
                                  comparison, top views with the collision circle
          m4d-relay-gamecam.png   game camera (pitch 55, vFOV 50) at distance 48: broken + lit Guild masts
                                  with the starter ship
  trader  m4d-trader-link.png     top views: trader + tanker with their collision circles (npc_ships.json
                                  `collision`), the starter ship linked at trade_port (heading 0 / 90 / 225,
                                  its bounding circle in amber)
          m4d-trader-gamecam.png  game camera at distance 48: convoy (trader + tanker) with the starter ship
                                  linked at the trade port
Icons: python art/blender/map_icons.py --preview  -> m4d-icons.png
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

import paths  # noqa: E402
import preview as PV  # noqa: E402
import preview_guild_borders as GB  # noqa: E402
import preview_landmarks as PL  # noqa: E402
import preview_m35 as P35  # noqa: E402
from lib import render as R  # noqa: E402

TMP = os.path.join(paths.OUT, 'tmp_tiles_m4d')
ITER = os.path.join(paths.PREVIEWS, 'iterations')
STARTER_COM = (3 / 7, 0.0)      # grid-cell centre of mass of the starter ship (equal cell masses)
STARTER_R = 2.75                # its bounding radius (properties.ts: max cell offset + sqrt(1/2))
GUILD_LIT = (0.45, 0.7, 1.0)    # relayLook guild lit colour (~ [1.6, 2.6, 4.2] normalised)


def _base(o):
    return o.name.split('.')[0]


def _hide(objs, prefix, hidden=True):
    for o in objs:
        if _base(o).startswith(prefix):
            o.hide_render = hidden
            for c in o.children_recursive:
                c.hide_render = hidden


def _light_lamp(objs, color=GUILD_LIT, strength=9.0):
    m = P35._emit_mat('M4d_Lamp', color, strength)
    for o in objs:
        if _base(o) in ('relay_lamp', 'Lens') and o.type == 'MESH':
            o.data.materials.clear()
            o.data.materials.append(m)


def _lamp_pos(objs):
    for o in objs:
        if _base(o) == 'relay_lamp':
            return o.matrix_world.translation.copy()
    return None


def linked_ship(port=(4.5, 1.5), heading=0.0, trader_loc=(0.0, 0.0), trader_yaw=0.0):
    """Starter ship pinned beside the trade port: centre = port + bounding radius along the trader's +y."""
    ty = math.radians(trader_yaw)
    px = trader_loc[0] + port[0] * math.cos(ty) - (port[1] + STARTER_R) * math.sin(ty)
    py = trader_loc[1] + port[0] * math.sin(ty) + (port[1] + STARTER_R) * math.cos(ty)
    a = math.radians(heading + trader_yaw)
    ox = px - (STARTER_COM[0] * math.cos(a) - STARTER_COM[1] * math.sin(a))
    oy = py - (STARTER_COM[0] * math.sin(a) + STARTER_COM[1] * math.cos(a))
    return GB.starter_ship((ox, oy), rot=heading + trader_yaw), (px, py)


def _tile(cam, path, label, target, el, az, dist):
    R.aim_camera(cam, target, el, az, dist)
    lab = R.camera_label(cam, label, y_frac=-0.43, size_frac=0.045)
    out = R.render_to(path)
    bpy.data.objects.remove(lab)
    return out


def _iter(tag, files):
    if tag:
        os.makedirs(ITER, exist_ok=True)
        for f in files:
            shutil.copy(f, os.path.join(ITER, f'{tag}-{os.path.basename(f)}'))


# ----------------------------------------------------------------------------
def relay(tag):
    lay = json.load(open(os.path.join(paths.DATA, 'derelict_layouts.json'), encoding='utf-8'))
    tw, th = 480, 460
    cam = PV._new_scene(tw, th, 96, key_az=-120)
    tiles = []
    states = [('BROKEN  (Relay_Broken shown)', False, False), ('REPAIRED  (Relay_Broken hidden)', True, False),
              ('LIT  (lamp + lens glow, guild look)', True, True)]
    for i, (label, repaired, lit) in enumerate(states):
        GB._clear()
        objs = GB.imp('derelicts/guild_relay_mast')
        if repaired:
            _hide(objs, 'Relay_Broken')
        if lit:
            _light_lamp(objs)
        GB.node_markers(objs, prefixes=('power_target',))
        tris = PV._tri_count([o for o in objs if not o.hide_render])
        tiles.append(_tile(cam, os.path.join(TMP, f'r{i}.png'), f'{label}  {tris} tris', (-0.4, 0, 1.2), 30, -62, 9.0))
    GB._clear()
    objs = GB.imp('derelicts/derelict_relay')
    tiles.append(_tile(cam, os.path.join(TMP, 'r3.png'), f'derelict_relay (M4b)  {PV._tri_count(objs)} tris',
                       (-0.4, 0, 1.2), 30, -62, 9.0))
    # second row: other side (broken), top views with the collision circle
    GB._clear()
    objs = GB.imp('derelicts/guild_relay_mast')
    tiles.append(_tile(cam, os.path.join(TMP, 'r4.png'), 'BROKEN  rear view', (-0.6, 0, 1.0), 22, 140, 9.0))
    circ = [(c['x'], c['y'], c['r']) for c in lay['guild_relay_mast']['circles']]
    P35.circle_overlay(circ, z=0.0)
    tiles.append(_tile(cam, os.path.join(TMP, 'r5.png'), 'BROKEN  top + circle r 1.5', (-0.5, 0, 0), 89.9, -90, 10.0))
    _hide(objs, 'Relay_Broken')
    tiles.append(_tile(cam, os.path.join(TMP, 'r6.png'), 'REPAIRED  top', (-0.5, 0, 0), 89.9, -90, 10.0))
    GB._clear()
    objs = GB.imp('derelicts/guild_relay_mast')
    objs += GB.starter_ship((3.4, -1.2), rot=0)
    tiles.append(_tile(cam, os.path.join(TMP, 'r7.png'), 'scale: starter ship', (1.0, -0.6, 0.8), 40, -70, 13.0))
    png = os.path.join(paths.PREVIEWS, 'm4d-relay.png')
    R.stitch(tiles, 4, tw, th, png, gap=4)

    def build(cam_):
        GB.starter_ship((0, -2), rot=20)
        a = GB.imp('derelicts/guild_relay_mast', loc=(-11, 3, 0), yaw=30)
        b = GB.imp('derelicts/guild_relay_mast', loc=(11, 5, 0), yaw=-60)
        _hide(b, 'Relay_Broken')
        _light_lamp(b)
        PL.glow_sprite(cam_, _lamp_pos(b), 2.2, '#9ccbff', 0.9)
        PV.add_rocks([('asteroid_iron_b', (-20.0, -9.0, -1.0), 30), ('asteroid_copper_a', (22.0, -6.0, -1.2), 120)])
        return '   (left: broken, right: repaired + lit)'
    files = [png] + GB._render_pair('m4d-relay-gamecam', build, [(0, 1, 0)], [48])
    _iter(tag, files)
    return files


# ----------------------------------------------------------------------------
def trader(tag):
    man = json.load(open(os.path.join(paths.NPC, 'npc_ships.json'), encoding='utf-8'))['collision']
    tw, th = 640, 520
    cam = PV._new_scene(tw, th, 64, key_az=-120)
    tiles = []
    for i, heading in enumerate((0, 90, 225)):
        GB._clear()
        objs = GB.imp('npc/trader')
        P35.circle_overlay([(c['x'], c['y'], c['r']) for c in man['trader']['circles']], z=1.6)
        ship, centre = linked_ship(heading=heading)
        ring = P35.circle_overlay([(centre[0], centre[1], STARTER_R)], z=1.6)
        amber = P35._emit_mat('M4d_ShipCircle', (1.0, 0.55, 0.1), 3.0)
        for o in ring:
            o.data.materials.clear()
            o.data.materials.append(amber)
        GB.node_markers(objs, prefixes=('trade_port',))
        tiles.append(_tile(cam, os.path.join(TMP, f't{i}.png'), f'trader + starter linked, heading {heading}',
                           (0.0, 1.4, 0), 89.9, -90, 31.0))
    GB._clear()
    GB.imp('npc/tanker')
    P35.circle_overlay([(c['x'], c['y'], c['r']) for c in man['tanker']['circles']], z=2.6)
    tiles.append(_tile(cam, os.path.join(TMP, 't3.png'), 'tanker + collision circles', (0, 0, 0), 89.9, -90, 24.0))
    png = os.path.join(paths.PREVIEWS, 'm4d-trader-link.png')
    R.stitch(tiles, 2, tw, th, png, gap=4)

    def build(cam_):
        objs = GB.imp('npc/trader', loc=(0, 0, 0), yaw=8)
        # tanker 16 u behind (centre to centre): 12 u would overlap the trader (stern -7.2, tanker bow +5.85)
        GB.imp('npc/tanker', loc=(-16 * math.cos(math.radians(8)), -16 * math.sin(math.radians(8)), 0), yaw=8)
        linked_ship(heading=0, trader_yaw=8)
        for o in objs:
            if _base(o) == 'beacon_3':
                PL.glow_sprite(cam_, o.matrix_world.translation.copy(), 1.6, '#ffb547', 0.8)
        PV.add_rocks([('asteroid_iron_b', (-14.0, 12.0, -1.0), 30), ('asteroid_copper_a', (20.0, -9.0, -1.2), 120)])
        return '   (convoy: trader + tanker, starter ship linked at trade_port)'
    files = [png] + GB._render_pair('m4d-trader-gamecam', build, [(-4, 2, 0)], [48])
    _iter(tag, files)
    return files


def main(argv):
    only = set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else {'relay', 'trader'}
    tag = argv[argv.index('--iter') + 1] if '--iter' in argv else None
    os.makedirs(TMP, exist_ok=True)
    os.makedirs(GB.TMP, exist_ok=True)
    out = []
    if 'relay' in only:
        out += relay(tag)
    if 'trader' in only:
        out += trader(tag)
    for f in out:
        print('PREVIEW', f)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
