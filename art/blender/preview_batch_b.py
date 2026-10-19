"""Previews of art batch B (clutter, salvage, wreckage) - rendered from the
SHIPPED (optimized) GLBs.

  blender --background --factory-startup --python art/blender/preview_batch_b.py -- [--only debris,wreck,props,decals]
          [--iter bbN]

  debris  batch-b-debris.png          old vs new human set, pirate + Forge-smith sets (3/4 studio tiles)
          batch-b-debris-gamecam.png  explosion scatters at the game camera (pitch 55, vFOV 50, distance 48)
                                      around the starter ship, ring-1 sky dimmed; + -grey.png
  wreck   batch-b-wreckfield.png      the wreck-salvage composition dressed with B3 around a dead Hammer
                                      and derelict_a (distance 48 + 210) + -grey.png; batch-b-wreckage.png sheet
  props   batch-b-props.png           sheet (3/4) + batch-b-props-gamecam.png (starter ship for scale) + -grey.png
  decals  batch-b-decals.png          the decal atlas over a hull plate and over dark
Every game-camera shot also gets a greyscale copy (*-grey.png): research R4 -
gameplay objects (ships, minable rocks) must stay the brightest things,
scenery/clutter darker; wrecks read "dead".
"""
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
import preview_landmarks as PL  # noqa: E402
import preview_m3 as P3  # noqa: E402
from lib import render as R  # noqa: E402

TMP = os.path.join(paths.OUT, 'tmp_tiles_batch_b')
OLD_DEBRIS = os.path.join(paths.OUT, 'before_batch_b', 'debris')
WRECKAGE = os.path.join(paths.MODELS, 'wreckage')
ITER = os.path.join(paths.PREVIEWS, 'iterations')


def _clear():
    for o in list(bpy.data.objects):
        if o.type in ('MESH', 'EMPTY', 'FONT'):
            bpy.data.objects.remove(o)


def grey(png):
    """Greyscale copy (Rec.709 luma of the sRGB values) next to the PNG."""
    a = R.read_png(png)
    y = a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722
    a[..., 0] = a[..., 1] = a[..., 2] = y
    out = png[:-4] + '-grey.png'
    R.write_png(a, out)
    return out


def _imp(path, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    roots, new = PV.import_glb(path, loc=loc)
    for r in roots:
        r.rotation_mode = 'XYZ'
        r.rotation_euler = [math.radians(a) for a in rot]
        r.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    return new


def game_scene(w, h, ring=1, samples=64):
    cam = PL.new_scene(w, h, ring, samples=samples)
    return cam


def starter_ship(origin=(0, 0), rot=0.0):
    ca, sa = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    objs = []
    lay = [(f, (origin[0] + x * ca - y * sa, origin[1] + x * sa + y * ca), r + rot) for f, (x, y), r in PV.M1_SHIP]
    for f, (x, y), r in lay:
        objs += _imp(os.path.join(paths.PARTS, f + '.glb'), loc=(x, y, 0), rot=(0, 0, r))
    cells = [c for _, c, _ in PV.M1_SHIP]
    for f, (x, y), r in PV.connector_placements(cells):
        wx, wy = origin[0] + x * ca - y * sa, origin[1] + x * sa + y * ca
        objs += _imp(os.path.join(paths.PARTS, f + '.glb'), loc=(wx, wy, 0), rot=(0, 0, r + rot))
    return objs


def _studio_tiles(entries, tile_w, tile_h, prefix, el=38, az=-58, margin=0.95):
    """entries: [(glb path, label)] -> rendered tile paths (3/4 studio view)."""
    cam = PV._new_scene(tile_w, tile_h, 96, key_az=-120)
    tiles = []
    for i, (path, label) in enumerate(entries):
        _clear()
        if path is None:
            lab = R.camera_label(cam, label, y_frac=0.0, size_frac=0.07)
            tiles.append(R.render_to(os.path.join(TMP, f'{prefix}_{i}.png')))
            bpy.data.objects.remove(lab)
            continue
        objs = _imp(path)
        c, r = R.bounds(objs)
        R.aim_camera(cam, c, el, az, R.fit_distance(cam, r, margin=margin))
        tris = PV._tri_count(objs)
        lab = R.camera_label(cam, f'{label}  {tris} tris', y_frac=-0.43, size_frac=0.06)
        tiles.append(R.render_to(os.path.join(TMP, f'{prefix}_{i}.png')))
        bpy.data.objects.remove(lab)
    return tiles


# ----------------------------------------------------------------------------
# debris
# ----------------------------------------------------------------------------
HUMAN = ['a', 'b', 'c', 'd', 'e']
PIRATE = ['pirate_a', 'pirate_b', 'pirate_c', 'pirate_d', 'pirate_e']
KOVACI = ['kovaci_a', 'kovaci_b', 'kovaci_c']


def debris_sheet(tag):
    tw, th = 360, 300
    entries = [(os.path.join(OLD_DEBRIS, f'debris_{v}.glb'), f'OLD {v}') for v in HUMAN]
    entries += [(os.path.join(paths.DEBRIS, f'debris_{v}.glb'), f'NEW {v}') for v in HUMAN]
    entries += [(os.path.join(paths.DEBRIS, f'debris_{v}.glb'), v.upper()) for v in PIRATE]
    entries += [(os.path.join(paths.DEBRIS, f'debris_{v}.glb'), v.upper()) for v in KOVACI]
    tiles = _studio_tiles(entries, tw, th, 'deb')
    png = os.path.join(paths.PREVIEWS, 'batch-b-debris.png')
    R.stitch(tiles, 5, tw, th, png, gap=4)
    return [png]


def _scatter(files, centre, n, radius, rng, scale=1.0):
    objs = []
    for k in range(n):
        f = files[k % len(files)]
        a = rng.uniform(0, 2 * math.pi)
        d = radius * math.sqrt(rng.uniform(0.05, 1.0))
        loc = (centre[0] + d * math.cos(a), centre[1] + d * math.sin(a), rng.uniform(-0.6, 0.6))
        s = rng.uniform(0.7, 1.2) * scale
        objs += _imp(f, loc=loc, rot=[rng.uniform(0, 360) for _ in range(3)], scale=s)
    return objs


def debris_gamecam(tag):
    out = []
    cam = game_scene(1600, 900, 1, samples=64)
    rng = random.Random(11)
    starter_ship((0, -1.0), rot=0)
    old = [os.path.join(OLD_DEBRIS, f'debris_{v}.glb') for v in HUMAN]
    new = [os.path.join(paths.DEBRIS, f'debris_{v}.glb') for v in HUMAN]
    pir = [os.path.join(paths.DEBRIS, f'debris_{v}.glb') for v in PIRATE]
    kov = [os.path.join(paths.DEBRIS, f'debris_{v}.glb') for v in KOVACI]
    # ship explosion = 5-8 pieces at scale 1.2, part explosion = 1-2 at 0.8 (Effects.ts)
    _scatter(old, (-14, 5), 8, 3.2, rng, 1.2)
    _scatter(new, (-5, 9), 8, 3.2, rng, 1.2)
    _scatter(pir, (7, 9), 8, 3.2, rng, 1.2)
    _scatter(kov, (15, 4), 8, 3.2, rng, 1.2)
    PV.add_rocks([('asteroid_iron_b', (-15.0, -8.0, -1.0), 30), ('asteroid_copper_a', (14.0, -8.0, -1.2), 120)])
    PL.game_view(cam, 48.0, target=(0, 1.5, 0))
    for txt, x in (('OLD human', -0.33), ('NEW human', -0.13), ('pirate', 0.1), ('Kovaci', 0.3)):
        R.camera_label(cam, txt, y_frac=0.44, x_frac=x, size_frac=0.022)
    png = os.path.join(paths.PREVIEWS, 'batch-b-debris-gamecam.png')
    R.render_to(png)
    out += [png, grey(png)]
    PL.game_view(cam, 24.0, target=(-1, 6.5, 0))
    png2 = os.path.join(paths.PREVIEWS, 'batch-b-debris-gamecam24.png')
    R.render_to(png2)
    out.append(png2)
    return out


def debris(tag):
    return debris_sheet(tag) + debris_gamecam(tag)


# ----------------------------------------------------------------------------
# wreckage
# ----------------------------------------------------------------------------
WRECK = ['hull_section_a', 'hull_section_b', 'hull_section_c', 'ring_arc', 'girder_tangle_a', 'girder_tangle_b',
         'container_spill', 'engine_block']


def _load_json(path):
    import json
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _emit_mat(name, rgb, strength=3.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*rgb, 1)
    em.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


def circle_ring(x, y, r, offset=(0, 0, 0), rgb=(0.2, 1.0, 0.4), z=0.0, thick=0.05):
    from lib import geo as G
    ob = G.torus('Circle', r, thick, 'hull_white', loc=(offset[0] + x, offset[1] + y, offset[2] + z), maj=64, mnr=4)
    ob.data.materials.clear()
    ob.data.materials.append(_emit_mat('AF_CircleOverlay' + str(rgb), rgb))
    ob.visible_shadow = False
    return ob


def wreck_sheet(tag):
    tw, th = 450, 330
    man = _load_json(os.path.join(WRECKAGE, 'wreckage.json'))
    entries = [(os.path.join(WRECKAGE, f'{n}.glb'), n) for n in WRECK]
    tiles = _studio_tiles(entries, tw, th, 'wr', el=40, az=-60, margin=0.85)
    png = os.path.join(paths.PREVIEWS, 'batch-b-wreckage.png')
    R.stitch(tiles, 4, tw, th, png, gap=4)
    # collision: top view with the circles
    cam = PV._new_scene(tw, th, 48, key_az=-120)
    tiles = []
    for i, n in enumerate(WRECK):
        _clear()
        objs = _imp(os.path.join(WRECKAGE, f'{n}.glb'))
        e = man[n]
        for c in e['circles']:
            circle_ring(c['x'], c['y'], c['r'], z=1.6)
        circle_ring(0, 0, e['radius'], rgb=(1.0, 0.5, 0.1), z=1.7)
        R.aim_camera(cam, (0, 0, 0), 89.9, -90, R.fit_distance(cam, e['radius'], margin=1.1))
        lab = R.camera_label(cam, f"{n}  r {e['radius']}  {len(e['circles'])} circles", y_frac=-0.44,
                             size_frac=0.055)
        tiles.append(R.render_to(os.path.join(TMP, f'wrc_{i}.png')))
        bpy.data.objects.remove(lab)
    png2 = os.path.join(paths.PREVIEWS, 'batch-b-wreckage-collision.png')
    R.stitch(tiles, 4, tw, th, png2, gap=4)
    return [png, png2]


def dead_hammer(origin, rot):
    import preview_pirate_parts as PP
    objs = PP.build_ship(PP.HAMMER, 'player', 'iron', origin=origin, rot=rot)
    P3.apply_livery(objs, 'derelict')
    return objs


def _place_piece(n, loc, yaw, tilt=(0, 0)):
    return _imp(os.path.join(WRECKAGE, f'{n}.glb'), loc=loc, rot=(tilt[0], tilt[1], yaw))


def wreckfield(tag):
    out = []
    # ring 1: the wreck-salvage fixture - a dead Hammer, fragments + debris around it, the player close by
    cam = game_scene(1600, 900, 1, samples=64)
    starter_ship((-9.0, -6.5), rot=30)
    dead_hammer((2.0, 2.0), 17)
    rng = random.Random(5)
    for n, loc, yaw in (('hull_section_a', (12.0, 7.0, 0), 35), ('girder_tangle_a', (-6.0, 8.5, 0), 0),
                        ('engine_block', (9.5, -5.0, 0), 200), ('container_spill', (-3.0, -1.5, 0), 60),
                        ('girder_tangle_b', (15.5, -1.0, 0), 120)):
        _place_piece(n, loc, yaw)
    _scatter([os.path.join(paths.DEBRIS, f'debris_{v}.glb') for v in HUMAN], (3.0, 3.0), 10, 6.0, rng, 1.0)
    PV.add_rocks([('asteroid_iron_b', (-16.0, 2.0, -1.0), 30), ('asteroid_copper_a', (17.0, 12.0, -1.2), 120)])
    PL.game_view(cam, 48.0, target=(1.0, 1.5, 0))
    png = os.path.join(paths.PREVIEWS, 'batch-b-wreckfield.png')
    R.render_to(png)
    out += [png, grey(png)]
    # ring 2: derelict station with a graveyard around it, default + max zoom
    cam = game_scene(1600, 900, 2, samples=64)
    _imp(os.path.join(paths.DERELICTS, 'derelict_a.glb'), loc=(0, 0, 0))
    starter_ship((-4.0, -17.0), rot=60)
    for n, loc, yaw in (('ring_arc', (-17.0, 6.0, 0), 25), ('hull_section_b', (16.0, 11.0, 0), 70),
                        ('hull_section_c', (19.0, -6.0, 0), 160), ('girder_tangle_b', (-14.0, -9.0, 0), 300),
                        ('hull_section_a', (2.0, 19.0, 0), 190), ('girder_tangle_a', (24.0, 3.0, 0), 45),
                        ('engine_block', (-25.0, -2.0, 0), 20), ('container_spill', (9.0, -14.0, 0), 220)):
        _place_piece(n, loc, yaw)
    _scatter([os.path.join(paths.DEBRIS, f'debris_{v}.glb') for v in HUMAN + PIRATE], (0.0, 0.0), 30, 22.0, rng, 1.6)
    PL.game_view(cam, 48.0, target=(0.0, 1.0, 0))
    png2 = os.path.join(paths.PREVIEWS, 'batch-b-graveyard.png')
    R.render_to(png2)
    out += [png2, grey(png2)]
    PL.game_view(cam, 210.0, target=(0.0, 30.0, 0))
    png3 = os.path.join(paths.PREVIEWS, 'batch-b-graveyard-210.png')
    R.render_to(png3)
    out.append(png3)
    return out


def wreck(tag):
    return wreck_sheet(tag) + wreckfield(tag)


# ----------------------------------------------------------------------------
# props
# ----------------------------------------------------------------------------
PROPS = ['sat_comm', 'sat_survey', 'nav_beacon', 'cargo_pod_small', 'cargo_pallet', 'fuel_canister', 'ore_canister',
         'escape_pod', 'claim_marker', 'solar_wing_drift', 'pirate_mine', 'pirate_stash', 'scrap_raft']


def props_sheet(tag):
    tw, th = 360, 300
    entries = [(os.path.join(paths.PROPS, f'{n}.glb'), n) for n in PROPS]
    entries.append((os.path.join(paths.PROPS, 'cargo_container.glb'), 'cargo_container (old, ref)'))
    entries += [(os.path.join(paths.PROPS, 'buoy_marker.glb'), 'buoy_marker (ref)')]
    tiles = _studio_tiles(entries, tw, th, 'pr', el=40, az=-60, margin=0.9)
    png = os.path.join(paths.PREVIEWS, 'batch-b-props.png')
    R.stitch(tiles, 5, tw, th, png, gap=4)
    return [png]


def _prop(n, loc, rot=(0, 0, 0), scale=1.0):
    return _imp(os.path.join(paths.PROPS, f'{n}.glb'), loc=loc, rot=rot, scale=scale)


def props_gamecam(tag):
    out = []
    cam = game_scene(1600, 900, 1, samples=64)
    starter_ship((-2.0, -3.0), rot=15)
    rocks = PV.add_rocks([('asteroid_iron_a', (9.0, 7.5, -0.5), 30), ('asteroid_copper_b', (14.0, 2.0, -0.6), 70),
                          ('asteroid_ice_a', (17.5, 9.0, -0.6), 140), ('asteroid_titanium_b', (11.5, -4.0, -0.5), 10)])
    # claim marker stuck on top of the iron rock
    _prop('claim_marker', (9.0, 7.5, 1.4), rot=(12, -8, 0))
    _prop('ore_canister', (15.5, -1.5, 0.2), rot=(20, 10, 40))
    _prop('sat_comm', (-12.0, 8.0, 0.0), rot=(10, 0, 30), scale=1.1)
    _prop('sat_survey', (-1.0, 10.5, 0.0), rot=(0, 0, 20), scale=1.1)
    for k, x in enumerate((-19.0, -15.0, -11.0)):
        pass
    _prop('nav_beacon', (-17.0, -3.0, 0.0), rot=(0, 0, 0), scale=1.2)
    _prop('nav_beacon', (-17.0, 12.0, 0.0), rot=(0, 0, 0), scale=1.2)
    _prop('cargo_pod_small', (4.0, 4.5, 0.0), rot=(30, 10, 60))
    _prop('cargo_pallet', (-7.0, 3.0, 0.0), rot=(10, -15, 25))
    _prop('fuel_canister', (5.0, -6.5, 0.0), rot=(30, 0, 0))
    _prop('escape_pod', (-9.0, -7.0, 0.0), rot=(10, 20, 140))
    _prop('solar_wing_drift', (-3.5, 15.0, 0.0), rot=(20, 10, 70))
    _imp(os.path.join(paths.PROPS, 'cargo_container.glb'), loc=(1.0, 6.5, 0.0), rot=(10, 30, 20))
    PL.game_view(cam, 48.0, target=(0.0, 3.0, 0))
    png = os.path.join(paths.PREVIEWS, 'batch-b-props-gamecam.png')
    R.render_to(png)
    out += [png, grey(png)]
    PL.game_view(cam, 26.0, target=(-3.0, 4.0, 0))
    png2 = os.path.join(paths.PREVIEWS, 'batch-b-props-gamecam26.png')
    R.render_to(png2)
    out.append(png2)
    # pirate dressing (ring 2): mines, stash, raft, a pirate Hammer idling
    cam = game_scene(1600, 900, 2, samples=64)
    import preview_pirate_parts as PP
    PP.build_ship(PP.HAMMER, 'rust', 'iron', origin=(4.0, 2.0), rot=200)
    starter_ship((-14.0, -8.0), rot=40)
    _prop('scrap_raft', (0.0, 5.0, 0.0), rot=(0, 0, 15))
    _prop('pirate_stash', (-3.5, 9.0, 0.0), rot=(5, 0, 30))
    rng = random.Random(3)
    for k in range(7):
        a = 2 * math.pi * k / 7
        _prop('pirate_mine', (10 + 6 * math.cos(a) + rng.uniform(-1, 1), -2 + 4 * math.sin(a), rng.uniform(-0.5, 0.5)),
              rot=[rng.uniform(0, 360) for _ in range(3)])
    PV.add_rocks([('asteroid_iron_b', (-8.0, 10.0, -0.8), 30), ('asteroid_copper_c', (17.0, 9.0, -1.0), 120)])
    PL.game_view(cam, 48.0, target=(0.0, 2.0, 0))
    png3 = os.path.join(paths.PREVIEWS, 'batch-b-pirate-dressing.png')
    R.render_to(png3)
    out += [png3, grey(png3)]
    return out


def props(tag):
    return props_sheet(tag) + props_gamecam(tag)


STAGES = {'debris': debris, 'wreck': wreck, 'props': props}


def main(argv):
    only = None
    tag = None
    if '--only' in argv:
        only = argv[argv.index('--only') + 1].split(',')
    if '--iter' in argv:
        tag = argv[argv.index('--iter') + 1]
    os.makedirs(TMP, exist_ok=True)
    made = []
    for name, fn in STAGES.items():
        if only and name not in only:
            continue
        made += fn(tag)
    if tag:
        os.makedirs(ITER, exist_ok=True)
        for p in made:
            shutil.copyfile(p, os.path.join(ITER, f'{tag}-{os.path.basename(p)}'))
    for p in made:
        print('PREVIEW', p)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
