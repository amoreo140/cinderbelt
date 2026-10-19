"""M5b previews (built from the exported files):

  m5b-planets.png        (planets_preview.sheet) 12 biome planets
  m5b-gasgiant.png       hero gas giant + ring system, game-camera view, ring profile strip
  m5b-base.png           full L3 base on a planet from the game camera + floating gas-giant base
  m5b-base-modules.png   hub + 9 modules close-up (+ top-view footprint check)
  m5b-drones.png         4 drones (+ scale next to ship cells)
  m5b-cruise.png         cruise drive T1/T2/T3 + on a ship + icons
  m5b-home-modules.png   home station with observatory / laboratory / drone hub + close-ups

  blender --background --factory-startup --python art/blender/preview_m5b.py -- \
      [--only planets,gasgiant,base,modules,drones,cruise,home] [--iter m5bN]
"""
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
import planets_preview as PP  # noqa: E402
from lib import render as R  # noqa: E402

TMP = os.path.join(paths.OUT, 'tmp_tiles_m5b')
P = paths.PREVIEWS


def _clear():
    for o in list(bpy.data.objects):
        if o.type in ('MESH', 'EMPTY'):
            bpy.data.objects.remove(o)


def _imp(folder, name, loc=(0, 0, 0), rot=0.0, scale=1.0):
    p = os.path.join(paths.MODELS, folder, name + '.glb')
    roots, new = PV.import_glb(p, loc=loc, rot_z=rot)
    if scale != 1.0:
        for r in roots:
            r.scale = (scale, scale, scale)
        bpy.context.view_layer.update()
    return new


def _tris(objs):
    from lib import geo as G
    return sum(G.tri_count(o) for o in objs if o.type == 'MESH')


def _canvas(W, H):
    c = np.zeros((H, W, 4), np.float32)
    c[..., :3] = (0.02, 0.025, 0.035)
    c[..., 3] = 1
    return c


def _paste(canvas, img, x, y_top):
    """Paste img (rows bottom-up) with its top-left corner at (x, y_top) in image coordinates."""
    H = canvas.shape[0]
    h, w = img.shape[:2]
    y0 = H - y_top - h
    canvas[y0:y0 + h, x:x + w] = img


def _lights_only_sun(energy=4.5, rot=(0, 70, -160)):
    for o in list(bpy.data.objects):
        if o.type == 'LIGHT':
            bpy.data.objects.remove(o)
    return R._sun('Star', energy, (1.0, 0.96, 0.9), rot, angle=0.6)


# ----------------------------------------------------------------------------
# gas giant
# ----------------------------------------------------------------------------
GG_TILT = 16.0


def _gas_giant(loc, radius, spin=30.0, tilt=GG_TILT):
    meta = PP.load_meta()['gas_giant']
    objs = PP.make_planet('gas_giant', meta, loc, radius, spin=spin, tilt=tilt, segs=160)
    rings = _imp('planets', 'gas_giant_rings')
    for r in rings:
        if r.parent is None:
            r.location = loc
            r.scale = (radius, radius, radius)
            r.rotation_euler = (math.radians(tilt), 0, 0)
    bpy.context.view_layer.update()
    return objs + rings


def gasgiant(out_png):
    os.makedirs(TMP, exist_ok=True)
    W, H = 1600, 900
    # hero shot
    cam = PV._new_scene(1100, 900, 160, seed=5.0)
    _lights_only_sun(5.0, (0, 62, 150))
    _gas_giant((0, 0, 0), 10.0, spin=200)
    # a barren moon for scale (normal planets are ~1/2.5 of the giant)
    meta = PP.load_meta()
    PP.make_planet('rocky_barren', meta['rocky_barren'], (9.1, -15.6, 9.5), 1.6, spin=40)
    cam.data.clip_end = 2000
    R.aim_camera(cam, (2.0, 0, 0.5), 21, 64, 62)
    R.camera_label(cam, 'PLYNNY OBOR  gas giant + ring system', y_frac=0.45, size_frac=0.03)
    R.camera_label(cam, 'gas_giant_albedo 4096x2048  +  gas_giant_rings.glb (r 1.28-2.35, tilt 16)',
                   y_frac=-0.45, size_frac=0.021)
    hero = R.render_to(os.path.join(TMP, 'gg_hero.png'))
    PV._save_blend(os.path.join(paths.BLEND, 'm5b-gasgiant.blend'))
    # game camera: giant far below the gameplay plane, a ship + gas base above
    cam = PV._new_scene(496, 560, 128, seed=6.0, key_az=-130)
    _gas_giant((-40, 330, -560), 110.0, spin=120)
    PV.build_ship(PV.M1_SHIP, connectors=True)
    cam.data.clip_end = 5000
    R.aim_camera(cam, (0.5, 0, 0), 55, -90, 34)
    R.camera_label(cam, 'game camera 55 deg', y_frac=-0.45, size_frac=0.04)
    game = R.render_to(os.path.join(TMP, 'gg_game.png'))
    canvas = _canvas(W, H)
    _paste(canvas, R.read_png(hero), 0, 0)
    _paste(canvas, R.read_png(game), 1104, 0)
    # ring profile strip (texture over a checker, so alpha reads)
    from gas_giant import ring_profile
    col, a = ring_profile(496)
    strip = np.zeros((300, 496, 4), np.float32)
    yy, xx = np.mgrid[0:300, 0:496]
    chk = np.where(((xx // 12) + (yy // 12)) % 2 == 0, 0.12, 0.06)[..., None].repeat(3, 2)
    lin = col[None].repeat(300, 0)
    strip[..., :3] = lin * a[None, :, None] + chk * (1 - a[None, :, None])
    strip[..., 3] = 1
    _paste(canvas, strip, 1104, 590)
    R.write_png(canvas, out_png)


# ----------------------------------------------------------------------------
def main(only, iter_tag):
    os.makedirs(TMP, exist_ok=True)
    made = []
    if 'planets' in only:
        PP.main(None)
        made.append((os.path.join(P, 'm5b-planets.png'), 'm5b-planets'))
    if 'gasgiant' in only:
        f = os.path.join(P, 'm5b-gasgiant.png')
        gasgiant(f)
        made.append((f, 'm5b-gasgiant'))
    if 'base' in only:
        import preview_m5b_base as PB
        made += PB.main(only)
    if 'drones' in only or 'cruise' in only or 'home' in only or 'modules' in only:
        import preview_m5b_base as PB
        made += PB.main_extra(only)
    PV._keep_iterations(iter_tag, made)
    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else \
        {'planets', 'gasgiant', 'base', 'modules', 'drones', 'cruise', 'home'}
    main(only, argv[argv.index('--iter') + 1] if '--iter' in argv else None)
