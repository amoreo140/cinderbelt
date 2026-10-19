"""Volumetric nebula: a unit-radius sphere around the panoramic camera,
filled with a procedural emission + absorption volume.

  r 0.38 .. 0.66 : dust shell (absorption only)  -> dark lanes in front
  r 0.55 .. 1.00 : glowing gas (emission)
The camera sits at the centre, so every pixel integrates one radial ray.
Art direction comes from 'regions' (soft spherical caps that allow gas) and
'pockets' (3D hot spots that brighten / tint the gas like an embedded star).
"""
import math

import bpy

from .nodes import NB
from . import geom


def _caps(nb, dirp, regions, base):
    acc = base
    for R in regions:
        c = geom.dir_vec(*R['dir'])
        cosd = nb.dot(dirp, tuple(c))
        cap = nb.smooth(cosd, math.cos(math.radians(R['radius'])),
                        math.cos(math.radians(R['radius'] * R.get('core', 0.35))))
        acc = nb.add(acc, nb.mul(cap, R['strength']))
    return acc


def build_nebula(mood):
    M = mood['nebula']
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=1.0, location=(0, 0, 0))
    ob = bpy.context.active_object
    ob.name = 'NebulaVolume'
    # the sphere must not show up as a surface, only as a volume
    mat = bpy.data.materials.new('Nebula_' + mood['name'])
    ob.data.materials.append(mat)
    nt = mat.node_tree
    nt.nodes.clear()
    nb = NB(nt)
    mat.cycles.volume_sampling = 'DISTANCE'
    mat.cycles.volume_interpolation = 'LINEAR'

    tc = nb.node('ShaderNodeTexCoord')
    p = tc.outputs['Object']
    r = nb.length(p)
    dirp = nb.normalize(p)
    seed = mood['seed']

    # ---------------- region / patch masks ----------------------------------
    region = _caps(nb, dirp, M['regions'], M['region_base'])
    patch = nb.noise(p, scale=M['patch_scale'], detail=2, rough=0.5, w=seed + 21.0)
    patch = nb.smooth(patch, M['patch_lo'], M['patch_hi'])
    mask = nb.mul(region, nb.add(0.25, nb.mul(patch, 0.75)))

    # ---------------- domain-warped density -----------------------------------
    warp = nb.noise(p, scale=M['warp_scale'], detail=3, rough=0.5, w=seed + 31.0, out='Color')
    q = nb.vadd(p, nb.vscale(nb.vsub(warp, (0.5, 0.5, 0.5)), M['warp_amount']))
    n = nb.noise(q, scale=M['scale'], detail=8, rough=M['rough'], distortion=0.15, w=seed + 41.0)
    body = nb.pow(nb.smooth(n, M['lo'], M['hi']), M['gamma'])
    # erosion by a fine noise: crisper, more textured cloud bodies
    fine = nb.noise(q, scale=M.get('fine_scale', 11.0), detail=5, rough=0.6, w=seed + 101.0)
    erosion = nb.maprange(fine, 0.3, 0.7, 1.0 - M.get('erode', 0.0), 1.0 + M.get('erode', 0.0))
    body = nb.mul(body, erosion)
    # wispy filaments: ridges of a second warped fbm
    fn = nb.noise(q, scale=M['fil_scale'], detail=7, rough=0.58, distortion=0.3, w=seed + 51.0)
    ridge = nb.sub(1.0, nb.absf(nb.sub(nb.mul(fn, 2.0), 1.0)))
    fil = nb.pow(ridge, M['fil_sharp'])
    fil = nb.mul(fil, nb.smooth(n, M['lo'] - 0.12, M['hi']))       # filaments hug the clouds

    if M.get('facet_gain'):
        # crystalline veins: bright ridges along Voronoi cell edges, inside the clouds
        # evaluated on the (slightly warped) view direction, so each vein is constant
        # along the radial ray and stays crisp instead of smearing through the shell
        fq = nb.vadd(dirp, nb.vscale(nb.vsub(warp, (0.5, 0.5, 0.5)), 0.08))
        vein = 0.0
        for k, (sc_mul, wgt) in enumerate(((1.0, 0.6), (2.6, 0.6))):
            fv = nb.voronoi(fq, M['facet_scale'] * sc_mul, randomness=1.0, w=seed + 111.0 + k,
                            feature='DISTANCE_TO_EDGE')
            v = nb.sub(1.0, nb.smooth(fv.outputs['Distance'], 0.0, M.get('facet_width', 0.06)))
            # only some patches crystallise -> sparse shards instead of a uniform net
            pm = nb.noise(p, scale=M.get('facet_mask_scale', 3.0) * sc_mul, detail=2, w=seed + 121.0 + k)
            v = nb.mul(v, nb.smooth(pm, M.get('facet_mask_lo', 0.45), M.get('facet_mask_lo', 0.45) + 0.16))
            vein = nb.add(vein, nb.mul(v, wgt))
        vein = nb.mul(vein, nb.smooth(n, M['lo'] - 0.08, M['hi'] + 0.05))
        fil = nb.add(fil, nb.mul(vein, M['facet_gain']))
    shell_em = nb.mul(nb.smooth(r, 0.55, 0.68), nb.sub(1.0, nb.smooth(r, 0.9, 1.0)))
    # soft low-frequency wash under the structure (keeps clouds from looking cut out)
    wn = nb.noise(q, scale=M.get('wash_scale', 1.8), detail=3, rough=0.5, w=seed + 91.0)
    wash = nb.smooth(wn, 0.35, 0.75)
    dens = nb.add(nb.add(body, nb.mul(fil, M['fil_gain'])), nb.mul(wash, M.get('wash_gain', 0.0)))
    gas = nb.mul(dens, nb.mul(mask, shell_em))

    # ---------------- pockets (embedded stars lighting the gas) ---------------
    boost = 0.0
    clear_acc = 0.0
    for P in M['pockets']:
        c = geom.dir_vec(*P['dir']) * P.get('depth', 0.78)
        g = nb.gauss(nb.dist(p, tuple(c)), P['size'])
        boost = nb.add(boost, nb.mul(g, P['gain']))
        # cavity: same centre direction, measured on the dust shell radius
        cd = geom.dir_vec(*P['dir']) * 0.52
        clear_acc = nb.add(clear_acc, nb.gauss(nb.dist(p, tuple(cd)), P['size'] * 1.3))
    # ---------------- colour -----------------------------------------------------
    cn = nb.noise(p, scale=M['color_scale'], detail=3, rough=0.5, distortion=0.3, w=seed + 61.0)
    col = nb.ramp(cn, M['colors'])
    # denser gas and hot pockets lean towards the 'hot' colour
    hot = nb.clamp01(nb.add(nb.mul(nb.pow(body, 2.0), M['hot_from_density']), nb.mul(boost, M['hot_from_pocket'])))
    col = nb.mix_rgb(hot, col, M['hot_color'])
    # thin filaments lean towards the 'edge' colour
    edge_w = nb.clamp01(nb.mul(nb.sub(fil, nb.mul(body, 1.5)), M['edge_mix']))
    col = nb.mix_rgb(edge_w, col, M['edge_color'])

    strength = nb.mul(nb.mul(gas, M['emission']), nb.add(1.0, boost))
    emis = nb.node('ShaderNodeEmission')
    nb._set(emis.inputs['Color'], col)
    nb._set(emis.inputs['Strength'], strength)

    # ---------------- dust (absorption) ---------------------------------------------
    D = M['dust']
    dn = nb.noise(q, scale=D['scale'], detail=8, rough=0.6, distortion=0.35, w=seed + 71.0)
    dfil_n = nb.noise(q, scale=D['scale'] * 1.7, detail=6, rough=0.55, w=seed + 81.0)
    dfil = nb.pow(nb.sub(1.0, nb.absf(nb.sub(nb.mul(dfil_n, 2.0), 1.0))), 6.0)
    dust = nb.add(nb.smooth(dn, D['lo'], D['hi']), nb.mul(dfil, D['fil_gain']))
    dmask = _caps(nb, dirp, M['regions'], D['region_base'])
    shell_d = nb.mul(nb.smooth(r, 0.38, 0.46), nb.sub(1.0, nb.smooth(r, 0.58, 0.66)))
    dust = nb.mul(nb.mul(dust, dmask), nb.mul(shell_d, D['density']))
    # hot pockets blow a cavity into the dust (keeps the focal glow visible)
    clear = nb.sub(1.0, nb.clamp01(nb.mul(clear_acc, D.get('pocket_clear', 0.0))))
    dust = nb.mul(dust, clear)
    absn = nb.node('ShaderNodeVolumeAbsorption')
    nb._set(absn.inputs['Color'], D['color'])
    nb._set(absn.inputs['Density'], dust)

    addn = nb.node('ShaderNodeAddShader')
    nt.links.new(emis.outputs[0], addn.inputs[0])
    nt.links.new(absn.outputs[0], addn.inputs[1])
    out = nb.node('ShaderNodeOutputMaterial')
    nt.links.new(addn.outputs[0], out.inputs['Volume'])
    return ob
