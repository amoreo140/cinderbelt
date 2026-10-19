"""Planet previews + shared planet scene helpers (M5 / M5b).

  m5b-planets.png        12 biome spheres (4 types x 3 biomes) with clouds and a fresnel atmosphere rim
  planets-gamescale.png  planet below the gameplay plane, ship above, 55 deg game camera

make_planet() / make_gas_giant() are reused by preview_m5b.py (gas giant, base shots).
Reads public/assets/planets/planets.json (schema in planets.py SCHEMA).

  blender --background --factory-startup --python art/blender/planets_preview.py -- [--iter m5b1]
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
from lib import render as R  # noqa: E402

PL = os.path.join(paths.ROOT, 'public', 'assets', 'planets')
SPINS = {'gas_amber': 255, 'gas_azure': 0, 'gas_violet': 160, 'ice_cryo': 20, 'volcanic_sulfur': 200}
TYPES = (('rocky', ('rocky_arid', 'rocky_temperate', 'rocky_barren')),
         ('ice', ('ice_glacier', 'ice_frozen_sea', 'ice_cryo')),
         ('gas', ('gas_amber', 'gas_azure', 'gas_violet')),
         ('volcanic', ('volcanic_fissure', 'volcanic_lava_sea', 'volcanic_sulfur')))


def _lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def load_meta():
    with open(os.path.join(PL, 'planets.json'), encoding='utf-8') as f:
        return json.load(f)


def _img(name, noncolor=False):
    im = bpy.data.images.load(os.path.join(PL, name), check_existing=True)
    if noncolor:
        im.colorspace_settings.name = 'Non-Color'
    return im


def planet_material(name, meta):
    m = bpy.data.materials.new('Planet_' + name)
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    b = N['Principled BSDF']
    b.inputs['Roughness'].default_value = meta.get('roughness', 0.8)
    t = N.new('ShaderNodeTexImage')
    t.image = _img(meta['albedo'])
    L.new(t.outputs['Color'], b.inputs['Base Color'])
    if meta.get('normal'):
        tn = N.new('ShaderNodeTexImage')
        tn.image = _img(meta['normal'], noncolor=True)
        nm = N.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = meta.get('normalScale') or 1.0
        L.new(tn.outputs['Color'], nm.inputs['Color'])
        L.new(nm.outputs['Normal'], b.inputs['Normal'])
    if meta.get('emissive'):
        te = N.new('ShaderNodeTexImage')
        te.image = _img(meta['emissive'])
        L.new(te.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = meta.get('emissiveIntensity', 2.5)
    return m


def cloud_material(cloud, opacity):
    m = bpy.data.materials.new('Clouds')
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    b = N['Principled BSDF']
    b.inputs['Base Color'].default_value = (1, 1, 1, 1)
    b.inputs['Roughness'].default_value = 0.9
    t = N.new('ShaderNodeTexImage')
    t.image = _img(cloud)
    mul = N.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = opacity
    L.new(t.outputs['Alpha'], mul.inputs[0])
    L.new(mul.outputs['Value'], b.inputs['Alpha'])
    return m


def atmo_material(col, density, power=2.2):
    m = bpy.data.materials.new('Atmo')
    nt = m.node_tree
    nt.nodes.clear()
    N, L = nt.nodes, nt.links
    lw = N.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.35
    pw = N.new('ShaderNodeMath')
    pw.operation = 'POWER'
    pw.inputs[1].default_value = power
    L.new(lw.outputs['Facing'], pw.inputs[0])
    st = N.new('ShaderNodeMath')
    st.operation = 'MULTIPLY'
    st.inputs[1].default_value = 3.0 * density
    L.new(pw.outputs['Value'], st.inputs[0])
    em = N.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*_lin(col), 1)
    L.new(st.outputs['Value'], em.inputs['Strength'])
    tr = N.new('ShaderNodeBsdfTransparent')
    add = N.new('ShaderNodeAddShader')
    L.new(tr.outputs['BSDF'], add.inputs[0])
    L.new(em.outputs['Emission'], add.inputs[1])
    out = N.new('ShaderNodeOutputMaterial')
    L.new(add.outputs['Shader'], out.inputs['Surface'])
    return m


def make_planet(name, meta, loc, radius, spin=0.0, tilt=12.0, segs=96):
    """Planet sphere + cloud shell + atmosphere shell (as the game should build it)."""
    objs = []
    layers = [(radius, planet_material(name, meta))]
    if meta.get('clouds'):
        c = meta['clouds']
        layers.append((radius * c.get('shellScale', 1.012), cloud_material(c['texture'], c['opacity'])))
    a = meta['atmosphere']
    layers.append((radius * a.get('shellScale', 1.045), atmo_material(a['color'], a['density'], a.get('power', 2.2))))
    for r, mat in layers:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=segs // 2, radius=r, location=loc)
        o = bpy.context.active_object
        bpy.ops.object.shade_smooth()
        o.data.materials.append(mat)
        o.rotation_mode = 'ZYX'          # spin about the planet's own axis first, then tilt
        o.rotation_euler = (math.radians(tilt), 0, math.radians(spin))
        objs.append(o)
    return objs


def sheet(out_png, W=1600, H=1300):
    meta = load_meta()
    cam = PV._new_scene(W, H, 128, seed=2.0)
    for o in list(bpy.data.objects):
        if o.type == 'LIGHT':
            bpy.data.objects.remove(o)
    R._sun('Star', 4.5, (1.0, 0.96, 0.9), (0, 70, -160), angle=1)
    vis_h = 12.4                         # visible height at the planet plane (y = 0)
    cam.location = (0, -vis_h / (2 * math.tan(math.atan(12 / 50))), 0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    dx, dy = 2.95, 3.65
    for c, (kind, names) in enumerate(TYPES):
        for r, name in enumerate(names):
            x, z = (c - 1.5) * dx, (1 - r) * dy + 0.35
            make_planet(name, meta[name], (x, 0, z), 1.2, spin=SPINS.get(name, (c * 3 + r) * 47))
            e = meta[name]
            res = ' '.join(e['deposits'].keys())
            lab = name.upper().replace('_', ' ') + '\n' + e['labelSk'] + '\n' + res
            R.camera_label(cam, lab, y_frac=(z - 1.75) / vis_h, x_frac=x / (vis_h * W / H), size_frac=0.015)
    R.camera_label(cam, 'PLANETS  4 types x 3 biomes  (planets.json: type, biome, deposits, atmosphere, clouds)',
                   y_frac=0.475, size_frac=0.019)
    R.render_to(out_png)
    PV._save_blend(os.path.join(paths.BLEND, 'm5b-planets.blend'))


def gamescale(out_png, planet='rocky_temperate'):
    meta = load_meta()
    cam = PV._new_scene(1600, 900, 160, seed=3.0, key_az=-140)
    make_planet(planet, meta[planet], (60.0, 520.0, -720.0), 280.0, spin=60)
    PV.build_ship(PV.M1_SHIP, connectors=True)
    cam.data.clip_end = 5000
    R.aim_camera(cam, (0.5, 0.0, 0.0), 55, -90, 32.0)
    R.render_to(out_png)


def main(iter_tag=None):
    a = os.path.join(paths.PREVIEWS, 'm5b-planets.png')
    b = os.path.join(paths.PREVIEWS, 'planets-gamescale.png')
    sheet(a)
    gamescale(b)
    PV._keep_iterations(iter_tag, ((a, 'm5b-planets'), (b, 'planets-gamescale')))


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv[argv.index('--iter') + 1] if '--iter' in argv else None)
