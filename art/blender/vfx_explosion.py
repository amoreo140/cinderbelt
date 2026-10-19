"""Explosion flipbooks rendered with a Cycles procedural volume.

explosion_small.png / explosion_large.png: 8x8 frames of 256 px (2048x2048),
row-major from the TOP-LEFT, fireball -> smoke dissipating, transparent
background (straight alpha)."""
import math
import os
import shutil

import bpy
import numpy as np

import paths
from lib import render as R
from lib import tex2d as T

FRAMES = 64
CELL = 256
VARIANTS = {
    # R0 -> R1 radius, fire end (t), fire strength, noise scale, density, smoke grey, seed
    'explosion_small': dict(r0=0.26, r1=0.8, fire_end=0.5, fire=16.0, nscale=1.6, dens=12.0, grey=0.42, seed=1.7,
                            amp0=1.3, amp1=1.7),
    'explosion_large': dict(r0=0.3, r1=0.9, fire_end=0.62, fire=20.0, nscale=1.8, dens=14.0, grey=0.38, seed=5.3,
                            amp0=1.4, amp1=1.9),
}


def _scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'OPTIX'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == 'OPTIX'
        sc.cycles.device = 'GPU'
    except Exception as e:
        print('GPU setup failed', e)
    sc.cycles.samples = 128
    sc.cycles.use_denoising = True
    sc.cycles.volume_bounces = 1
    sc.render.resolution_x = sc.render.resolution_y = CELL
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'    # saturated, predictable sprite colours
    w = bpy.data.worlds.new('W')
    sc.world = w
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.4, 0.5, 1)
    cd = bpy.data.cameras.new('C')
    cd.type = 'ORTHO'
    cd.ortho_scale = 2.3
    cam = bpy.data.objects.new('C', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.location = (0, -10, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    for name, energy, rot in (('Key', 5.0, (50, 0, -40)), ('Fill', 1.0, (120, 0, 140))):
        ld = bpy.data.lights.new(name, 'SUN')
        ld.energy = energy
        lo = bpy.data.objects.new(name, ld)
        lo.rotation_euler = [math.radians(a) for a in rot]
        sc.collection.objects.link(lo)
    return sc


def _domain():
    bpy.ops.mesh.primitive_cube_add(size=2.4)
    dom = bpy.context.active_object
    m = bpy.data.materials.new('Fireball')
    nt = m.node_tree
    nt.nodes.clear()
    N, L = nt.nodes, nt.links
    out = N.new('ShaderNodeOutputMaterial')
    vol = N.new('ShaderNodeVolumePrincipled')
    L.new(vol.outputs['Volume'], out.inputs['Volume'])
    tc = N.new('ShaderNodeTexCoord')
    noise = N.new('ShaderNodeTexNoise')
    noise.noise_dimensions = '4D'
    noise.inputs['Detail'].default_value = 10.0
    noise.inputs['Roughness'].default_value = 0.62
    noise.inputs['Distortion'].default_value = 0.35
    L.new(tc.outputs['Object'], noise.inputs['Vector'])
    length = N.new('ShaderNodeVectorMath')
    length.operation = 'LENGTH'
    L.new(tc.outputs['Object'], length.inputs[0])

    def math_node(op, a=None, b=None):
        n = N.new('ShaderNodeMath')
        n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        return n
    nc = math_node('SUBTRACT', noise.outputs['Fac'], 0.5)
    namp = math_node('MULTIPLY', nc.outputs['Value'], 0.3)              # amplitude (per frame)
    radius = math_node('ADD', namp.outputs['Value'], 0.5)               # R + noise (per frame)
    edge = math_node('SUBTRACT', radius.outputs['Value'], length.outputs['Value'])
    soft = N.new('ShaderNodeMapRange')
    soft.inputs['From Min'].default_value = 0.0
    soft.inputs['From Max'].default_value = 0.06
    L.new(edge.outputs['Value'], soft.inputs['Value'])
    breakup = math_node('MULTIPLY', noise.outputs['Fac'], 1.6)
    dens = math_node('MULTIPLY', soft.outputs['Result'], breakup.outputs['Value'])
    dmul = math_node('MULTIPLY', dens.outputs['Value'], 8.0)            # density (per frame)
    L.new(dmul.outputs['Value'], vol.inputs['Density'])
    # heat: 0 at the core -> 1 at the rim (plus noise)
    rel = math_node('DIVIDE', length.outputs['Value'], 0.5)             # / R (per frame)
    hn = math_node('MULTIPLY', nc.outputs['Value'], 0.6)
    heat = math_node('ADD', rel.outputs['Value'], hn.outputs['Value'])
    ramp = N.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0
    cr.elements[0].color = (1.0, 0.97, 0.85, 1)
    cr.elements[1].position = 1.0
    cr.elements[1].color = (0.25, 0.03, 0.01, 1)
    for pos, col in ((0.25, (1.0, 0.8, 0.3, 1)), (0.5, (1.0, 0.45, 0.08, 1)), (0.78, (0.75, 0.14, 0.02, 1))):
        e = cr.elements.new(pos)
        e.color = col
    L.new(heat.outputs['Value'], ramp.inputs['Fac'])
    L.new(ramp.outputs['Color'], vol.inputs['Emission Color'])
    hot = math_node('SUBTRACT', 1.05, heat.outputs['Value'])
    hot_c = math_node('MAXIMUM', hot.outputs['Value'], 0.0)
    hot_p = math_node('POWER', hot_c.outputs['Value'], 1.6)
    em = math_node('MULTIPLY', hot_p.outputs['Value'], dens.outputs['Value'])
    emf = math_node('MULTIPLY', em.outputs['Value'], 20.0)              # fire strength (per frame)
    L.new(emf.outputs['Value'], vol.inputs['Emission Strength'])
    vol.inputs['Color'].default_value = (0.3, 0.3, 0.3, 1)
    dom.data.materials.append(m)
    ctl = dict(noise=noise, namp=namp, radius=radius, dmul=dmul, rel=rel, emf=emf, vol=vol)
    return dom, ctl


def _set(ctl, v, t):
    ease = 1 - (1 - t) ** 3
    R_ = v['r0'] + (v['r1'] - v['r0']) * ease
    ctl['noise'].inputs['W'].default_value = v['seed'] + t * 1.6
    ctl['noise'].inputs['Scale'].default_value = v['nscale'] * (1.0 - 0.25 * t)
    ctl['namp'].inputs[1].default_value = v['amp0'] + (v['amp1'] - v['amp0']) * t
    ctl['radius'].inputs[1].default_value = R_
    ctl['rel'].inputs[1].default_value = R_ * max(0.35, 1.35 - 1.2 * t)  # cools from the rim inward
    fire = v['fire'] * max(0.0, 1 - t / v['fire_end']) ** 1.8
    if t < 0.06:
        fire *= 1.0 + (0.06 - t) * 25                                    # initial flash
    ctl['emf'].inputs[1].default_value = fire
    ctl['dmul'].inputs[1].default_value = v['dens'] * (1 - t) ** 1.7 + 0.05
    k = T.smoothstep(0.15, 0.6, np.float32(t)).item()     # 0 = fireball, 1 = smoke
    g = v['grey']
    ctl['vol'].inputs['Color'].default_value = (0.16 + (g - 0.16) * k, 0.08 + (g - 0.08) * k,
                                                0.05 + (g - 0.05) * k, 1)


def render_variant(name, v, out_dir):
    sc = _scene()
    dom, ctl = _domain()
    tmp = os.path.join(paths.OUT, 'tmp_expl', name)
    os.makedirs(tmp, exist_ok=True)
    frames = []
    for f in range(FRAMES):
        t = f / (FRAMES - 1)
        _set(ctl, v, t)
        p = os.path.join(tmp, f'{f:03d}.png')
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        frames.append(p)
    sheet = np.zeros((8 * CELL, 8 * CELL, 4), np.float32)
    for f, p in enumerate(frames):
        a = R.read_png(p)[::-1]                    # to top-row-first
        r, c = divmod(f, 8)
        sheet[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = a
    out = os.path.join(out_dir, name + '.png')
    T.write_png(out, sheet)
    shutil.rmtree(tmp, ignore_errors=True)
    return out


def build_all(out_dir):
    return [render_variant(n, v, out_dir) for n, v in VARIANTS.items()]
