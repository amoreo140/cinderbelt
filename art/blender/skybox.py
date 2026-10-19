"""Cinderbelt - space skybox panoramas (one per world ring).

Renders a 360 deg equirectangular panorama with Cycles (procedural world
starfield + galaxy band, volumetric emission/absorption nebula around the
camera), then writes:
    public/assets/skybox/ring<N>_bg.jpg   4096x2048 sRGB JPEG  (visible background)
    public/assets/skybox/ring<N>_env.hdr  1024x512 linear RGBE (IBL / reflections)
and previews to art/out/previews/skybox/.

Usage:
  blender --background --factory-startup --python art/blender/skybox.py -- \
      --ring 1 [--tag v1] [--res 4096] [--samples 128] [--stage all|render|post|preview] [--publish]

--publish writes the deliverables to public/assets/skybox (only meaningful at
--res 4096); without it they go to art/out/skybox_work/ for iteration.
"""
import argparse
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402

import paths  # noqa: E402
from skybox_lib import moods, post, preview, scene, world, nebula  # noqa: E402

SKYBOX = os.path.join(paths.ROOT, 'public', 'assets', 'skybox')
WORK = os.path.join(paths.OUT, 'skybox_work')
PREV = os.path.join(paths.PREVIEWS, 'skybox')

ENV_W = 1024


def render_pano(mood, exr_path, res, samples):
    scene.reset()
    scene.cycles_settings(res, res // 2, samples)
    sc = bpy.context.scene
    sc.cycles.max_bounces = 0
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.volume_bounces = 0
    sc.cycles.volume_biased = True
    sc.cycles.volume_step_rate = 1.0
    sc.cycles.volume_max_steps = 1024
    world.build_world(mood)
    nebula.build_nebula(mood)
    scene.pano_camera()
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.image_settings.color_depth = '32'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.exr_codec = 'ZIP'
    sc.render.filepath = exr_path
    os.makedirs(os.path.dirname(exr_path), exist_ok=True)
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    dt = time.time() - t0
    print(f'[skybox] rendered {res}x{res // 2} @ {samples} spp in {dt:.1f}s -> {exr_path}')
    return dt


def make_outputs(mood, exr_path, bg_path, env_path, pano_preview):
    lin = post.load_float(exr_path)
    post.stats(mood['name'] + ' (scene-linear)', lin)
    g = mood['grade']
    disp = post.grade(lin, g['exposure'], g['shoulder'], g['saturation'])
    srgb = post.srgb_encode(disp)
    if srgb.shape[1] != 4096:
        print('[skybox] note: background is', srgb.shape[1], 'px wide (iteration res)')
    post.save_jpeg(srgb, bg_path, quality=95)
    # env map: box-filtered (seam safe) linear radiance, same exposure as the bg
    env = post.box_down(lin * g['exposure'], lin.shape[1] // ENV_W)
    post.save_hdr(env, env_path)
    post.stats(mood['name'] + ' env', env)
    # downscaled full panorama for review
    small = post.box_down(srgb, max(1, srgb.shape[1] // 2048))
    post.save_jpeg(small, pano_preview, quality=92)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--ring', type=int, default=1)
    ap.add_argument('--tag', default='v1')
    ap.add_argument('--res', type=int, default=4096)
    ap.add_argument('--samples', type=int, default=128)
    ap.add_argument('--stage', default='all', choices=['all', 'render', 'post', 'preview'])
    ap.add_argument('--publish', action='store_true')
    a = ap.parse_args(argv)

    mood = moods.get(a.ring)
    name = f'ring{a.ring}'
    exr = os.path.join(WORK, f'{name}_{a.tag}.exr')
    if a.publish:
        bg, env = os.path.join(SKYBOX, f'{name}_bg.jpg'), os.path.join(SKYBOX, f'{name}_env.hdr')
    else:
        bg, env = os.path.join(WORK, f'{name}_{a.tag}_bg.jpg'), os.path.join(WORK, f'{name}_{a.tag}_env.hdr')
    prefix = os.path.join(PREV, f'{name}_{a.tag}')

    if a.stage in ('all', 'render'):
        render_pano(mood, exr, a.res, a.samples)
    if a.stage in ('all', 'post'):
        make_outputs(mood, exr, bg, env, prefix + '_pano.jpg')
    if a.stage in ('all', 'preview'):
        preview.MODELS = paths.MODELS
        t0 = time.time()
        preview.render_previews(bg, env, prefix, os.path.join(WORK, 'tmp'))
        print(f'[skybox] previews in {time.time() - t0:.1f}s -> {prefix}_*')


if __name__ == '__main__':
    main()
