"""Batch A previews (scenery.py): everything at the GAME camera (pitch 55 deg, vertical FOV 50, 16:9)
over the ring skybox dimmed like the game's default background brightness, the starter ship and
minable rocks on the gameplay plane for scale. The depth layers are rebuilt the way
src/render/env/DepthLayers.ts places them (DEBRIS_LAYERS depth/count/scale/area, haze toward the
zone haze colour x the default backdrop haze, colour x the default backdrop "debris" dim) - "before"
with the current 80-tri lumpy icosahedron, "after" with the new sets mixed per scenery.json.

  batch-a-sets.png              contact sheet of every far / rubble mesh (+ tris)
  batch-a-bedsheet.png          bed rocks per resource next to a minable rock of the same resource
  batch-a-depth-gamecam.png     rows ring 1..4: before 48 | after 48 | before 140 | after 140
  batch-a-depth-gamecam-grey.png  greyscale copy (readability: gameplay objects must stay brightest)
  batch-a-bed.png (+ -grey)     copper / ice / crystal field: no bed vs bed, distance 48 and 140
  batch-a-rubble.png            chips around rocks: before (icosahedra) vs after, distance 7 / 13 / 24
  batch-a-depth-ring<N>.png     full-size frame per ring at distance 48: before (top) / after (bottom)
  batch-a-depth-lineup.png (+ -grey)  each ring's identity set lined up at depth 210 (layer-1 haze)
  batch-a-luma.json             measured luminance (sRGB luma) of depth-rock vs minable-rock pixels

  blender --background --factory-startup --python art/blender/preview_scenery.py -- [--only sets,depth,hero,lineup,bed,rubble] [--iter ba1]
"""
import json
import math
import os
import random
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
import preview_landmarks as PL  # noqa: E402  (import-only: new_scene, game_view, sky world, zone lights)
from lib import geo as G  # noqa: E402
from lib import render as R  # noqa: E402

TMP = os.path.join(paths.OUT, 'tmp_tiles_scenery')
SC = os.path.join(paths.MODELS, 'scenery')
TW, TH = 640, 360
PITCH = 55.0
DISTS = (48.0, 140.0)

# zoneLook.ts hazeStrength per ring; backdrop.ts at the default background brightness 0.6
HAZE_STRENGTH = {1: 0.8, 2: 0.8, 3: 0.85, 4: 0.85}
BACKDROP_HAZE = 1.3 + (1.0 - 1.3) * 0.6      # 1.12
BACKDROP_DEBRIS = 0.3 + (1.0 - 0.3) * 0.6    # 0.72
DEBRIS_HAZE = [0.62, 0.6, 0.82]              # DepthLayers.DEBRIS_LAYERS[i].haze
DEBRIS_AREA = [800, 1300, 2400]

PLANE_ROCKS = {   # gameplay-plane rocks per ring (file, (x, y, z), rot)
    1: PV.M1_ROCKS,
    2: [('asteroid_iron_c', (6.5, 4.0, -1.0), 30), ('asteroid_titanium_b', (-7.0, 4.2, -1.6), 70),
        ('asteroid_copper_c', (-5.8, -4.6, -1.2), 140), ('asteroid_iron_a', (8.0, -4.4, -1.4), 200),
        ('asteroid_titanium_c', (11.5, 1.0, -2.0), 90), ('asteroid_rare_a', (-12.0, -0.5, -2.5), 10)],
    3: [('asteroid_crystal_a', (6.5, 4.0, -1.0), 30), ('asteroid_ice_b', (-7.0, 4.2, -1.6), 70),
        ('asteroid_crystal_b', (-5.8, -4.6, -1.2), 140), ('asteroid_crystal_c', (8.0, -4.4, -1.4), 200),
        ('asteroid_ice_c', (11.5, 1.0, -2.0), 90), ('asteroid_titanium_b', (-12.0, -0.5, -2.5), 10)],
    4: [('asteroid_rare_a', (6.5, 4.0, -1.0), 30), ('asteroid_crystal_b', (-7.0, 4.2, -1.6), 70),
        ('asteroid_rare_b', (-5.8, -4.6, -1.2), 140), ('asteroid_titanium_a', (8.0, -4.4, -1.4), 200),
        ('asteroid_crystal_c', (11.5, 1.0, -2.0), 90), ('asteroid_rare_a', (-12.0, -0.5, -2.5), 10)],
}
FIELD_RES = {1: ['copper', 'iron', 'ice'], 2: ['iron', 'titanium', 'copper'], 3: ['crystal', 'ice'],
             4: ['rare', 'crystal', 'titanium']}


def _lin_hex(h):
    return PL._lin_hex(h)


ENV_SCALE = {1: 0.62, 2: 0.6, 3: 0.65, 4: 0.55}     # zoneLook.ts envScale


def new_scene(w, h, ring, samples=64, env=0.5):
    """PL.new_scene + image-based light like the game: non-camera rays see the ring env map
    (ring<N>_env.hdr x envScale x `env`) instead of a flat ambient, so glossy obsidian / metal
    reflect the nebula as they do in three.js (scene.environment)."""
    cam = PL.new_scene(w, h, ring, samples=samples)
    path = os.path.join(PL.SKY, f'ring{ring}_env.hdr')
    if env and os.path.exists(path):
        nt = bpy.context.scene.world.node_tree
        mix = next(n for n in nt.nodes if n.type == 'MIX_SHADER')
        amb = mix.inputs[1].links[0].from_node
        tex = nt.nodes.new('ShaderNodeTexEnvironment')
        tex.image = bpy.data.images.load(path, check_existing=True)
        nt.links.new(tex.outputs['Color'], amb.inputs['Color'])
        amb.inputs['Strength'].default_value = ENV_SCALE[ring] * env
    return cam


def load_manifest():
    with open(os.path.join(SC, 'scenery.json'), encoding='utf-8') as f:
        return json.load(f)


# ----------------------------------------------------------------------------
# materials
# ----------------------------------------------------------------------------
def haze_mat(src, haze_rgb, h, dim, name, tint=(1.0, 1.0, 1.0)):
    """What DepthLayers' shader does: (lit colour mixed toward the haze by h) x dim.
    Approximated as albedo x (1-h) x dim, emission x (1-h) x dim, plus haze x h x dim emitted."""
    m = src.copy()
    m.name = name
    nt = m.node_tree
    b = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b is None:
        return m
    strength = b.inputs['Emission Strength'].default_value
    if strength == 0 and not b.inputs['Emission Color'].links:
        b.inputs['Emission Color'].default_value = (0, 0, 0, 1)     # no emission (default colour is white)
    strength = strength or 1.0
    k = (1.0 - h) * dim

    def scaled(sock_name, t=(1.0, 1.0, 1.0)):
        sock = b.inputs[sock_name]
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs['B'].default_value = (k * t[0], k * t[1], k * t[2], 1)
        if sock.links:
            nt.links.new(sock.links[0].from_socket, mix.inputs['A'])
        else:
            mix.inputs['A'].default_value = sock.default_value
        nt.links.new(mix.outputs['Result'], sock)
        return mix
    scaled('Base Color', tint)
    em = scaled('Emission Color')
    add = nt.nodes.new('ShaderNodeMix')
    add.data_type = 'RGBA'
    add.blend_type = 'ADD'
    add.inputs['Factor'].default_value = 1.0
    w = h * dim / strength
    add.inputs['B'].default_value = (haze_rgb[0] * w, haze_rgb[1] * w, haze_rgb[2] * w, 1)
    nt.links.new(em.outputs['Result'], add.inputs['A'])
    nt.links.new(add.outputs['Result'], b.inputs['Emission Color'])
    if b.inputs['Emission Strength'].default_value == 0:
        b.inputs['Emission Strength'].default_value = 1.0
    return m


def blob_material():
    m = bpy.data.materials.get('Blob')
    if m:
        return m
    m = bpy.data.materials.new('Blob')
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*_lin_hex(0x56545e), 1)
    b.inputs['Roughness'].default_value = 0.95
    b.inputs['Metallic'].default_value = 0.05
    return m


def tinted(src, name):
    """Copy of a material whose base colour is multiplied by the object colour (= three.js instanceColor)."""
    m = src.copy()
    m.name = name
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    info = nt.nodes.new('ShaderNodeObjectInfo')
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    sock = b.inputs['Base Color']
    if sock.links:
        nt.links.new(sock.links[0].from_socket, mix.inputs['A'])
    else:
        mix.inputs['A'].default_value = sock.default_value
    nt.links.new(info.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], sock)
    return m


# ----------------------------------------------------------------------------
# geometry sources
# ----------------------------------------------------------------------------
def lumpy_blob():
    """Blender copy of DepthLayers.lumpyRock(): IcosahedronGeometry(1, 1) (80 tris) + sine lumps."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in bm.verts:
        # three (x, y, z) = Blender (x, z, -y)
        x, y, z = v.co.x, v.co.z, -v.co.y
        n = 1 + 0.18 * math.sin(3.1 * x + 1.3) * math.sin(2.7 * y + 0.4) * math.sin(3.7 * z + 2.2) \
            + 0.08 * math.sin(7.3 * x + 5.1 * z)
        v.co *= n
    me = bpy.data.meshes.new('Blob')
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    me.materials.append(blob_material())
    return me


def ico_chip():
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    me = bpy.data.meshes.new('IcoChip')
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    return me


def import_set(file):
    """Import a scenery glb, hide the template objects; returns {node name: mesh datablock}."""
    roots, objs = PV.import_glb(os.path.join(SC, file))
    out = {}
    for o in objs:
        if o.type == 'MESH':
            out[o.name.split('.')[0]] = o.data
        o.hide_render = True
        o.hide_viewport = True
    return out


def instance(mesh, loc, rot, scale, name='inst', coll=None):
    o = bpy.data.objects.new(name, mesh)
    (coll or bpy.context.scene.collection).objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    o.scale = scale
    return o


def layer_mesh(cache, mesh, layer, haze_rgb, h, dim, tint=(1.0, 1.0, 1.0)):
    key = (mesh.name, layer)
    if key not in cache:
        me = mesh.copy()
        me.materials.clear()
        for m in mesh.materials:
            mk = (m.name, layer, tint)
            if mk not in cache:
                cache[mk] = haze_mat(m, haze_rgb, h, dim, f'{m.name}_L{layer}', tint)
            me.materials.append(cache[mk])
        cache[key] = me
    return cache[key]


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def show(coll, on):
    coll.hide_render = not on
    coll.hide_viewport = not on


# ----------------------------------------------------------------------------
# depth layers (DepthLayers.ts)
# ----------------------------------------------------------------------------
def depth_layers(man, ring, after, target=(0.0, 0.0), seed=7):
    """Instances of the three DEBRIS_LAYERS, deterministic (same placement before/after)."""
    coll = collection('after' if after else 'before')
    haze = _lin_hex(PL.ZONES[ring]['haze'])
    sets = {}
    if after:
        for sid in ('rocks', 'scrap', 'crystal', 'obsidian'):
            s = man['sets'].get(sid)
            if s:
                meshes = import_set(s['file'])
                sets[sid] = [meshes[e['name']] for e in s['meshes']]
    blob = None if after else lumpy_blob()
    cache = {}
    tan = math.tan(math.radians(PITCH))
    for li, spec in enumerate(man['depth']['layers']):
        rng = random.Random(seed * 100 + li)
        h = min(0.95, DEBRIS_HAZE[li] * HAZE_STRENGTH[ring] * BACKDROP_HAZE)
        d0, d1 = spec['depth']
        look = (target[0], target[1] + (d0 + d1) / 2 / tan)
        area = DEBRIS_AREA[li]
        mix = man['depth']['mix'][str(ring)][li]
        for i in range(spec['count']):
            x = look[0] + (rng.random() - 0.5) * area
            y = look[1] + (rng.random() - 0.5) * area
            z = -(d0 + rng.random() * (d1 - d0))
            s = spec['scale'][0] + rng.random() ** 1.8 * (spec['scale'][1] - spec['scale'][0])
            e = 0.55 + rng.random() * 0.6
            rot = (rng.random() * 6.283, rng.random() * 6.283, rng.random() * 6.283)
            pick, mi = rng.random(), rng.random()
            if not after:
                me = layer_mesh(cache, blob, li, haze, h, BACKDROP_DEBRIS)
                instance(me, (x, y, z), rot, (s, s * (0.8 + 0.4 * e), s * e), coll=coll)
                continue
            acc, sid = 0.0, 'rocks'
            for k, share in mix.items():
                acc += share
                if pick <= acc:
                    sid = k
                    break
            meshes = sets[sid]
            src = meshes[int(mi * len(meshes)) % len(meshes)]
            s *= man['depth']['setScale'].get(sid, 1.0)
            tint = PL._lin_str(man['depth']['rockTint'][str(ring)]) if sid == 'rocks' else (1.0, 1.0, 1.0)
            me = layer_mesh(cache, src, li, haze, h, BACKDROP_DEBRIS, tuple(tint))
            instance(me, (x, y, z), rot, (s, s * (0.9 + 0.2 * (e - 0.55) / 0.6), s), coll=coll)
    return coll


def plane_content(ring, field=True):
    coll = collection('plane_rocks')
    PV.build_ship(PV.M1_SHIP, connectors=True)
    objs = []
    for f, loc, rz in PLANE_ROCKS[ring]:
        _, new = PV.import_glb(os.path.join(paths.ASTEROIDS, f + '.glb'), loc=loc, rot_z=rz)
        objs += new
    if field:     # a small field ahead-right (shows at distance 140)
        rng = random.Random(ring * 31)
        res = FIELD_RES[ring]
        for i in range(16):
            r = res[i % len(res)]
            v = 'ab' if r == 'rare' else 'abc'
            f = f'asteroid_{r}_{v[rng.randrange(len(v))]}'
            a, d = rng.uniform(0, 6.283), 16 * math.sqrt(rng.random())
            _, new = PV.import_glb(os.path.join(paths.ASTEROIDS, f + '.glb'),
                                   loc=(34 + math.cos(a) * d, 22 + math.sin(a) * d, rng.uniform(-2.5, 0.5)),
                                   rot_z=rng.uniform(0, 360))
            objs += new
    for o in objs:
        for c in o.users_collection:
            c.objects.unlink(o)
        coll.objects.link(o)
    return coll


# ----------------------------------------------------------------------------
# rendering + measurement
# ----------------------------------------------------------------------------
def render_tile(cam, path, label):
    lab = R.camera_label(cam, label, y_frac=-0.45, size_frac=0.036)
    R.render_to(path)
    bpy.data.objects.remove(lab)
    return path


def luma(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def measure(cam, depth_coll, rock_coll, tag):
    """Luma of depth-rock pixels vs minable-rock pixels. Three extra renders: sky only, depth layers only,
    gameplay rocks only (ship hidden); a pixel belongs to a group where its render differs from the sky."""
    sc = bpy.context.scene
    keep = sc.cycles.samples
    sc.cycles.samples = 24
    ship = [o for o in sc.collection.objects if o.type == 'MESH']
    states = {'sky': (False, False), 'depth': (True, False), 'rocks': (False, True)}
    img = {}
    for k, (d_on, r_on) in states.items():
        depth_coll.hide_render = not d_on
        rock_coll.hide_render = not r_on
        for o in ship:
            o.hide_render = True
        img[k] = luma(R.read_png(R.render_to(os.path.join(TMP, f'{tag}_m_{k}.png'))))
    depth_coll.hide_render = False
    rock_coll.hide_render = False
    for o in ship:
        o.hide_render = False
    sc.cycles.samples = keep

    def stats(k):
        m = np.abs(img[k] - img['sky']) > 0.03
        v = img[k][m]
        if v.size < 20:
            return None
        return {'pixels': int(v.size), 'mean': round(float(v.mean()), 3), 'p90': round(float(np.percentile(v, 90)), 3),
                'p99': round(float(np.percentile(v, 99)), 3)}
    return {'depth': stats('depth'), 'minable': stats('rocks')}


def grey_copy(src, dst):
    a = R.read_png(src)
    g = luma(a)
    a[..., 0] = a[..., 1] = a[..., 2] = g
    R.write_png(a, dst)
    return dst


# ----------------------------------------------------------------------------
# sheets
# ----------------------------------------------------------------------------
def depth_sheet(man, out_png, luma_out):
    tiles, report = [], {}
    for ring in (1, 2, 3, 4):
        cam = new_scene(TW, TH, ring, samples=64)
        rocks = plane_content(ring)
        before = depth_layers(man, ring, after=False)
        after = depth_layers(man, ring, after=True)
        row = []
        for dist in DISTS:
            PL.game_view(cam, dist)
            for is_after, coll in ((False, before), (True, after)):
                show(before, not is_after)
                show(after, is_after)
                tag = f'r{ring}_{int(dist)}_{"after" if is_after else "before"}'
                lab = f'ring {ring}  {"AFTER - new sets" if is_after else "BEFORE - 80-tri blobs"}  |  distance {dist:.0f}'
                row.append(render_tile(cam, os.path.join(TMP, tag + '.png'), lab))
                if is_after or dist == DISTS[0]:
                    report[tag] = measure(cam, coll, rocks, tag)
        tiles += row
    R.stitch(tiles, 4, TW, TH, out_png, gap=4)
    with open(luma_out, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=1)
    for k, v in report.items():
        print('LUMA', k, v)
    return report


def hero_sheet(man, ring, out_png, dist=48.0):
    """Full-size (1600 x 900) game-camera frame of one ring: before (top) / after (bottom), half height each."""
    cam = new_scene(1600, 900, ring, samples=96)
    plane_content(ring)
    before = depth_layers(man, ring, after=False)
    after = depth_layers(man, ring, after=True)
    PL.game_view(cam, dist)
    tiles = []
    for is_after in (False, True):
        show(before, not is_after)
        show(after, is_after)
        lab = R.camera_label(cam, f'ring {ring}  {"AFTER - new sets" if is_after else "BEFORE - 80-tri blobs"}  |  '
                                  f'game camera, distance {dist:.0f}', y_frac=-0.465, size_frac=0.022)
        tiles.append(R.render_to(os.path.join(TMP, f'hero_{ring}_{int(is_after)}.png')))
        bpy.data.objects.remove(lab)
    R.stitch(tiles, 1, 1600, 900, out_png, gap=4)
    return out_png


LINEUP = {1: 'rocks', 2: 'scrap', 3: 'crystal', 4: 'obsidian'}


def lineup_sheet(man, out_png, depth=210.0, scale=8.0):
    """Every mesh of the ring's identity set placed in view at the middle depth layer (depth 210,
    layer-1 haze, x setScale) - how each silhouette reads after the haze, with the ship for scale."""
    W, H = 798, 449
    tiles = []
    for ring in (1, 2, 3, 4):
        cam = new_scene(W, H, ring, samples=96)
        PV.build_ship(PV.M1_SHIP, connectors=True)
        PL.game_view(cam, 48.0)
        sid = LINEUP[ring]
        s = man['sets'][sid]
        meshes = import_set(s['file'])
        haze = _lin_hex(PL.ZONES[ring]['haze'])
        h = min(0.95, DEBRIS_HAZE[1] * HAZE_STRENGTH[ring] * BACKDROP_HAZE)
        tint = tuple(PL._lin_str(man['depth']['rockTint'][str(ring)])) if sid == 'rocks' else (1.0, 1.0, 1.0)
        cache = {}
        n = len(s['meshes'])
        rng = random.Random(ring)
        for i, e in enumerate(s['meshes']):
            nx = -0.82 + 1.64 * i / (n - 1)
            ny = 0.42 if i % 2 == 0 else -0.05
            pt = PL.point_at_ndc(cam, nx, ny, -depth)
            me = layer_mesh(cache, meshes[e['name']], 1, haze, h, BACKDROP_DEBRIS, tint)
            sc = scale * man['depth']['setScale'].get(sid, 1.0)
            instance(me, tuple(pt), (rng.uniform(0, 6.28), rng.uniform(0, 6.28), rng.uniform(0, 6.28)), (sc, sc, sc))
        R.camera_label(cam, f'ring {ring}: {s["file"]} at depth {depth:.0f}, scale {scale:.0f} x setScale, layer-1 haze  |  distance 48',
                       y_frac=-0.45, size_frac=0.032)
        tiles.append(R.render_to(os.path.join(TMP, f'lineup_{ring}.png')))
    R.stitch(tiles, 2, W, H, out_png, gap=4)


def bed_sheet(man, out_png):
    bed = man['sets']['bed']
    tiles = []
    for res, ring in (('copper', 1), ('ice', 1), ('crystal', 3)):
        cam = new_scene(TW, TH, ring, samples=64)
        PV.build_ship(PV.M1_SHIP, connectors=True)
        rng = random.Random(sum(map(ord, res)))
        centre = Vector((14.0, 16.0, 0.0))
        for i in range(14):
            a, d = rng.uniform(0, 6.283), 15 * math.sqrt(rng.random())
            PV.import_glb(os.path.join(paths.ASTEROIDS, f'asteroid_{res}_{"abc"[i % 3]}.glb'),
                          loc=(centre.x + math.cos(a) * d, centre.y + math.sin(a) * d, rng.uniform(-2.0, 0.5)),
                          rot_z=rng.uniform(0, 360))
        meshes = import_set(bed['file'])
        coll = collection('bed')
        brng = random.Random(5)
        haze = _lin_hex(PL.ZONES[ring]['haze'])
        hz = man['bed']['haze']
        cache = {}
        a0 = brng.uniform(0, 6.283)
        for i in range(6):
            r = 4 + brng.random() ** 1.3 * 6
            a, d = a0 + i * 1.047 + brng.uniform(-0.3, 0.3), 15 * brng.uniform(0.45, 1.3)
            z = -(r + 3 + brng.random() * 12)
            d_north = -z / math.tan(math.radians(PITCH))     # sit under the field as seen from the camera
            me = layer_mesh(cache, meshes[f'Bed_{res}_{i % 3}'], 9, haze, hz, 1.0)
            instance(me, (centre.x + math.cos(a) * d, centre.y + math.sin(a) * d + d_north, z),
                     (brng.uniform(-0.3, 0.3), brng.uniform(-0.3, 0.3), brng.uniform(0, 6.283)), (r, r, r), coll=coll)
        for dist in DISTS:
            PL.game_view(cam, dist, target=(6.0, 6.0, 0.0))
            for on in (False, True):
                show(coll, on)
                tag = f'bed_{res}_{int(dist)}_{int(on)}'
                tiles.append(render_tile(cam, os.path.join(TMP, tag + '.png'),
                                         f'{res} field (ring {ring})  {"WITH bed rocks" if on else "no bed"}  |  distance {dist:.0f}'))
    R.stitch(tiles, 4, TW, TH, out_png, gap=4)


AST_RADIUS = 2.0
ROCK_COLOR = {'iron': 0x7a5a4f, 'copper': 0x86684a, 'ice': 0xa8c8e8, 'titanium': 0x8d93a3}


def _frac(x):
    return x - math.floor(x)


def _rand(seed, i):
    return _frac(math.sin(seed * 0.000123 + i * 12.9898) * 43758.5453)


def rubble_sheet(man, out_png):
    """Chips around four rocks as AsteroidDust places them (t = 0), before vs after."""
    rocks = [('asteroid_copper_a', (7.0, 6.0, 0.0), 'copper', 1234567), ('asteroid_iron_b', (-6.5, 5.0, 0.0), 'iron', 7654321),
             ('asteroid_ice_c', (-5.0, -5.5, 0.0), 'ice', 4242424), ('asteroid_titanium_a', (6.0, -6.0, 0.0), 'titanium', 9090909)]
    tiles = []
    cam = new_scene(TW, TH, 1, samples=96)
    PV.build_ship(PV.M1_SHIP, connectors=True)
    for f, loc, _, _ in rocks:
        PV.import_glb(os.path.join(paths.ASTEROIDS, f + '.glb'), loc=loc, rot_z=40)
    rub = import_set(man['sets']['rubble']['file'])
    rub_meshes = [rub[e['name']] for e in man['sets']['rubble']['meshes']]
    for me in rub_meshes:
        mats = [tinted(m, m.name + '_tint') for m in me.materials]
        me.materials.clear()
        for m in mats:
            me.materials.append(m)
    ico = ico_chip()
    chip_mat = bpy.data.materials.new('ChipBefore')
    b = chip_mat.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*_lin_hex(0x8a8278), 1)
    b.inputs['Roughness'].default_value = 0.9
    b.inputs['Metallic'].default_value = 0.1
    ico.materials.append(tinted(chip_mat, 'ChipBeforeTint'))
    colls = {False: collection('chips_before'), True: collection('chips_after')}
    for after in (False, True):
        for f, loc, res, seed in rocks:
            r = AST_RADIUS
            n = min(7, round(7 * min(1.5, 0.35 + r / 6)))
            for i in range(n + 2):
                orbit = r * (1.3 + _rand(seed, i) * 1.1)
                ang = _rand(seed, i + 13) * math.pi * 2
                tilt = (_rand(seed, i + 29) - 0.5) * 0.9
                size = min(0.7, 0.09 + _rand(seed, i + 3) * 0.16 * max(1, r * 0.4))
                # three (x, y, z) -> Blender (x, -z, y); three z = -pos.y + sin(ang) * orbit
                p = (loc[0] + math.cos(ang) * orbit, loc[1] - math.sin(ang) * orbit,
                     math.sin(ang * 1.3 + i) * orbit * tilt * 0.5)
                rot = (_rand(seed, i + 41) * 3, _rand(seed, i + 43) * 6, 0.5)
                sc = (size, size * (0.7 + _rand(seed, i + 9) * 0.5), size * (0.6 + _rand(seed, i + 5) * 0.6))
                me = rub_meshes[int(_rand(seed, i + 77) * len(rub_meshes)) % len(rub_meshes)] if after else ico
                o = instance(me, p, rot, sc, coll=colls[after])
                c = _lin_hex(ROCK_COLOR[res])
                k = 0.75 + _rand(seed, i + 61) * 0.4
                o.color = (c[0] * k, c[1] * k, c[2] * k, 1)
    for dist, tgt in ((7.0, (7.0, 6.0, 0.0)), (13.0, (7.0, 5.0, 0.0)), (24.0, (0.5, 0.0, 0.0))):
        PL.game_view(cam, dist, target=tgt)
        for after in (False, True):
            show(colls[False], not after)
            show(colls[True], after)
            tiles.append(render_tile(cam, os.path.join(TMP, f'rub_{int(dist)}_{int(after)}.png'),
                                     f'{"AFTER - rubble.glb" if after else "BEFORE - icosahedron chips"}  |  distance {dist:.0f}'))
    order = [tiles[0], tiles[2], tiles[4], tiles[1], tiles[3], tiles[5]]
    R.stitch(order, 3, TW, TH, out_png, gap=4)


def fit_row(cam, width_units, w, h):
    """Camera distance so that `width_units` fill the frame width."""
    vfov = 2 * math.atan(cam.data.sensor_height / 2 / cam.data.lens)
    return width_units / 2 / (math.tan(vfov / 2) * w / h)


def text(body, loc, size):
    t = bpy.data.curves.new('t', 'FONT')
    t.body = body
    t.align_x = 'CENTER'
    t.size = size
    to = bpy.data.objects.new('t', t)
    to.data.materials.append(R._label_mat())
    bpy.context.scene.collection.objects.link(to)
    to.location = loc
    to.rotation_euler = (math.radians(55), 0, 0)
    return to


def sets_sheet(man, out_png):
    """One row per set: every mesh at unit radius, 3/4 view, neutral studio light."""
    rows = [('rocks', 'A1 depth_rocks (all rings)'), ('scrap', 'A2 depth_ring2_scrap'),
            ('crystal', 'A3 depth_ring3_crystal'), ('obsidian', 'A4 depth_ring4_obsidian'), ('rubble', 'A6 rubble')]
    W, H = 1600, 420
    tiles = []
    for sid, title in rows:
        s = man['sets'][sid]
        G.reset_scene()
        R.setup_render(W, H, samples=96)
        R.setup_world(seed=2.0)
        R.setup_lights(key_az=-120)
        cam = R.make_camera(lens=50)
        meshes = import_set(s['file'])
        n = len(s['meshes'])
        sp = 2.55
        for i, e in enumerate(s['meshes']):
            x = (i - (n - 1) / 2) * sp
            instance(meshes[e['name']], (x, 0, 0), (0.25, 0.1, 0.5 + i * 0.7), (1, 1, 1))
            text(f"{e['name']}\n{e['kind']}  {e['tris']} tris", (x, -1.45, -1.05), 0.2)
        R.aim_camera(cam, (0, -0.35, -0.2), 35, -90, fit_row(cam, 8 * sp + 0.6, W, H))
        R.camera_label(cam, title, y_frac=0.42, size_frac=0.06)
        tiles.append(R.render_to(os.path.join(TMP, f'sets_{sid}.png')))
    R.stitch(tiles, 1, W, H, out_png, gap=4)


def bedsheet(man, out_png):
    bed = man['sets']['bed']
    W, H = 1600, 380
    tiles = []
    for res in ('iron', 'copper', 'ice', 'titanium', 'crystal', 'rare'):
        G.reset_scene()
        R.setup_render(W, H, samples=96)
        R.setup_world(seed=3.0)
        R.setup_lights(key_az=-120)
        cam = R.make_camera(lens=50)
        meshes = import_set(bed['file'])
        for i in range(3):
            e = next(x for x in bed['meshes'] if x['name'] == f'Bed_{res}_{i}')
            instance(meshes[e['name']], ((i - 1.5) * 2.7, 0, 0), (0, 0, 0.6 + i), (1.15, 1.15, 1.15))
            text(f"{e['name']}  {e['tris']} tris", ((i - 1.5) * 2.7, -1.6, -1.1), 0.2)
        v = 'ab' if res == 'rare' else 'abc'
        roots, objs = PV.import_glb(os.path.join(paths.ASTEROIDS, f'asteroid_{res}_{v[0]}.glb'), loc=(2.7 * 1.6, 0, 0))
        for r in roots:
            r.scale = (0.5, 0.5, 0.5)
        text(f'minable asteroid_{res}_{v[0]} (x0.5)', (2.7 * 1.6, -1.6, -1.1), 0.2)
        R.aim_camera(cam, (0.2, -0.4, -0.25), 35, -90, fit_row(cam, 14.5, W, H))
        tiles.append(R.render_to(os.path.join(TMP, f'bedsheet_{res}.png')))
    R.stitch(tiles, 1, W, H, out_png, gap=4)


def main(only=None, iter_tag=None):
    os.makedirs(TMP, exist_ok=True)
    man = load_manifest()
    files = []

    def want(k):
        return not only or k in only
    if want('sets'):
        p = os.path.join(paths.PREVIEWS, 'batch-a-sets.png')
        sets_sheet(man, p)
        files.append((p, 'batch-a-sets'))
        p = os.path.join(paths.PREVIEWS, 'batch-a-bedsheet.png')
        bedsheet(man, p)
        files.append((p, 'batch-a-bedsheet'))
    if want('depth'):
        p = os.path.join(paths.PREVIEWS, 'batch-a-depth-gamecam.png')
        depth_sheet(man, p, os.path.join(paths.PREVIEWS, 'batch-a-luma.json'))
        g = grey_copy(p, os.path.join(paths.PREVIEWS, 'batch-a-depth-gamecam-grey.png'))
        files += [(p, 'batch-a-depth-gamecam'), (g, 'batch-a-depth-gamecam-grey')]
    if want('lineup'):
        p = os.path.join(paths.PREVIEWS, 'batch-a-depth-lineup.png')
        lineup_sheet(man, p)
        g = grey_copy(p, os.path.join(paths.PREVIEWS, 'batch-a-depth-lineup-grey.png'))
        files += [(p, 'batch-a-depth-lineup'), (g, 'batch-a-depth-lineup-grey')]
    if want('hero'):
        for ring in (1, 2, 3, 4):
            p = os.path.join(paths.PREVIEWS, f'batch-a-depth-ring{ring}.png')
            hero_sheet(man, ring, p)
            files.append((p, f'batch-a-depth-ring{ring}'))
    if want('bed'):
        p = os.path.join(paths.PREVIEWS, 'batch-a-bed.png')
        bed_sheet(man, p)
        g = grey_copy(p, os.path.join(paths.PREVIEWS, 'batch-a-bed-grey.png'))
        files += [(p, 'batch-a-bed'), (g, 'batch-a-bed-grey')]
    if want('rubble'):
        p = os.path.join(paths.PREVIEWS, 'batch-a-rubble.png')
        rubble_sheet(man, p)
        files.append((p, 'batch-a-rubble'))
    shutil.rmtree(TMP, ignore_errors=True)
    PV._keep_iterations(iter_tag, files)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else None,
         argv[argv.index('--iter') + 1] if '--iter' in argv else None)
