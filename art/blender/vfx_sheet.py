"""Labelled contact sheet of all VFX textures (art/out/previews/vfx-sheet.png)
and flipbook playback videos (vfx-explosion.mp4)."""
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402

import paths  # noqa: E402
from lib import optimize  # noqa: E402
from lib import render as R  # noqa: E402

VFX = os.path.join(paths.ROOT, 'public', 'assets', 'vfx')
ITEMS = [  # file, label
    ('explosion_small.png', 'explosion_small  8x8 @256'), ('explosion_large.png', 'explosion_large  8x8 @256'),
    ('impact_dust.png', 'impact_dust  4x4 @128'), ('smoke_puff.png', 'smoke_puff'),
    ('shockwave_ring.png', 'shockwave_ring'),
    ('flame_gradient.png', 'flame_gradient'), ('flame_noise.png', 'flame_noise (RGB channels)'),
    ('muzzle_flash.png', 'muzzle_flash  4 frames'), ('bolt.png', 'bolt'), ('beam.png', 'beam'),
    ('shield_hex.png', 'shield_hex (tiles)'), ('flare_star.png', 'flare_star'), ('glow_soft.png', 'glow_soft'),
    ('spark.png', 'spark'), ('ember.png', 'ember'),
]
COLS, ROWS = 5, 3
CELL_W, CELL_H = 320, 310
W, H = COLS * CELL_W, ROWS * CELL_H


def _mat(img):
    m = bpy.data.materials.new('T_' + img.name)
    nt = m.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Linear'
    tex.extension = 'EXTEND'
    em = nt.nodes.new('ShaderNodeEmission')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(tex.outputs['Color'], em.inputs['Color'])
    nt.links.new(tex.outputs['Alpha'], mix.inputs['Fac'])
    nt.links.new(tr.outputs['BSDF'], mix.inputs[1])
    nt.links.new(em.outputs['Emission'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    return m


def _plane(name, w, h, loc, mat):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (w, h, 1)
    ob.data.materials.append(mat)
    return ob


def _flat(name, rgb):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*rgb, 1)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


def sheet(out_png):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 16
    sc.cycles.use_denoising = False
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.view_settings.view_transform = 'Standard'
    sc.render.film_transparent = False
    w = bpy.data.worlds.new('W')
    sc.world = w
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.004, 0.005, 0.008, 1)
    cd = bpy.data.cameras.new('C')
    cd.type = 'ORTHO'
    cd.ortho_scale = W
    cam = bpy.data.objects.new('C', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.location = (W / 2, -H / 2, 100)
    tile = _flat('Tile', (0.012, 0.016, 0.024))
    lab = _flat('Lab', (0.55, 0.6, 0.7))
    for i, (f, label) in enumerate(ITEMS):
        p = optimize.shipped(os.path.join(VFX, f))
        r, c = divmod(i, COLS)
        cx, cy = c * CELL_W + CELL_W / 2, -(r * CELL_H + CELL_H / 2)
        _plane(f'Bg{i}', CELL_W - 10, CELL_H - 10, (cx, cy, -1), tile)
        if os.path.exists(p):
            img = bpy.data.images.load(p)
            iw, ih = img.size
            s = min(250 / iw, 230 / ih)
            _plane(f'Img{i}', iw * s, ih * s, (cx, cy + 18, 0), _mat(img))
        cu = bpy.data.curves.new('L', 'FONT')
        cu.body = label
        cu.align_x = 'CENTER'
        cu.size = 15
        t = bpy.data.objects.new('L', cu)
        t.data.materials.append(lab)
        sc.collection.objects.link(t)
        t.location = (cx, cy - CELL_H / 2 + 14, 0)
    R.render_to(out_png)


def explosion_video(out_mp4, fps=30):
    """Play both explosion flipbooks side by side (plus impact dust) on a dark
    background; frames composed with numpy, encoded with Blender's FFmpeg."""
    import numpy as np
    from lib import tex2d as T
    tmp = os.path.join(paths.OUT, 'tmp_video')
    os.makedirs(tmp, exist_ok=True)
    sheets = {}
    for name, grid_n, cell in (('explosion_small', 8, 256), ('explosion_large', 8, 256), ('impact_dust', 4, 128)):
        a = R.read_png(optimize.shipped(os.path.join(VFX, name + '.png')))[::-1]   # top row first
        sheets[name] = (a, grid_n, cell)
    Wv, Hv = 960, 400
    n_frames = 64
    for fi in range(n_frames):
        canvas = np.zeros((Hv, Wv, 3), np.float32)
        canvas[...] = (0.02, 0.025, 0.04)
        for slot, (name, (a, g, cell)) in enumerate(sheets.items()):
            k = fi if g == 8 else min(15, fi // 4)
            r, c = divmod(k, g)
            fr = a[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell]
            if cell != 256:
                fr = fr.repeat(2, 0).repeat(2, 1)
            x0 = 40 + slot * 310
            y0 = 72
            al = fr[..., 3:4]
            reg = canvas[y0:y0 + 256, x0:x0 + 256]
            canvas[y0:y0 + 256, x0:x0 + 256] = fr[..., :3] * al + reg * (1 - al)
        img = np.concatenate([canvas, np.ones((Hv, Wv, 1), np.float32)], -1)
        T.write_png(os.path.join(tmp, f'f{fi:03d}.png'), img)
    # encode with the sequencer
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = Wv, Hv
    sc.render.fps = fps
    sc.frame_start, sc.frame_end = 1, n_frames * 2
    sc.view_settings.view_transform = 'Standard'
    sed = sc.sequence_editor_create()
    files = sorted(os.listdir(tmp))
    strips = sed.strips if hasattr(sed, 'strips') else sed.sequences
    for rep in range(2):
        st = strips.new_image(f'loop{rep}', os.path.join(tmp, files[0]), channel=1 + rep,
                              frame_start=1 + rep * n_frames)
        for f in files[1:]:
            st.elements.append(f)
    rs = sc.render
    try:
        rs.image_settings.media_type = 'VIDEO'
    except Exception:
        pass
    rs.image_settings.file_format = 'FFMPEG'
    rs.ffmpeg.format = 'MPEG4'
    rs.ffmpeg.codec = 'H264'
    rs.ffmpeg.constant_rate_factor = 'HIGH'
    rs.filepath = out_mp4
    bpy.ops.render.render(animation=True)
    shutil.rmtree(tmp, ignore_errors=True)
    return out_mp4


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    tag = argv[argv.index('--iter') + 1] if '--iter' in argv else None
    out = os.path.join(paths.PREVIEWS, 'vfx-sheet.png')
    sheet(out)
    if tag:
        shutil.copyfile(out, os.path.join(paths.PREVIEWS, 'iterations', f'{tag}-vfx-sheet.png'))
    if '--video' in argv:
        print('VIDEO', explosion_video(os.path.join(paths.PREVIEWS, 'vfx-explosion.mp4')))
    print('SHEET', out)
