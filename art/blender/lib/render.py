"""Preview rendering helpers: Cycles setup, space world, lighting rig,
bloom compositor, cameras, labels and contact-sheet stitching."""
import math
import os

import bpy
import numpy as np
from mathutils import Vector


# --------------------------------------------------------------------------
# render settings
# --------------------------------------------------------------------------
def setup_render(w, h, samples=96):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'OPTIX'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type in ('OPTIX',)
        sc.cycles.device = 'GPU'
    except Exception as e:  # pragma: no cover - CPU fallback
        print('GPU setup failed, using CPU:', e)
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'  # look names are prefixed per view transform
    sc.view_settings.exposure = 0.0
    _setup_bloom(sc)


def _setup_bloom(sc):
    ng = bpy.data.node_groups.get('AF_Comp') or bpy.data.node_groups.new('AF_Comp', 'CompositorNodeTree')
    ng.nodes.clear()
    if not ng.interface.items_tree:
        ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    rl = ng.nodes.new('CompositorNodeRLayers')
    glare = ng.nodes.new('CompositorNodeGlare')
    glare.inputs['Type'].default_value = 'Bloom'
    glare.inputs['Quality'].default_value = 'High'
    glare.inputs['Threshold'].default_value = 1.2
    glare.inputs['Strength'].default_value = 0.55
    glare.inputs['Size'].default_value = 0.6
    out = ng.nodes.new('NodeGroupOutput')
    ng.links.new(rl.outputs['Image'], glare.inputs['Image'])
    ng.links.new(glare.outputs['Image'], out.inputs[0])
    sc.compositing_node_group = ng
    sc.render.use_compositing = True


# --------------------------------------------------------------------------
# world: dark space with stars and a faint nebula (camera rays only);
# lighting rays see a soft cool ambient.
# --------------------------------------------------------------------------
def setup_world(ambient=(0.035, 0.045, 0.07), ambient_strength=1.0, seed=0.0):
    w = bpy.data.worlds.get('AF_Space') or bpy.data.worlds.new('AF_Space')
    bpy.context.scene.world = w
    nt = w.node_tree
    nt.nodes.clear()
    N, L = nt.nodes, nt.links
    out = N.new('ShaderNodeOutputWorld')
    coord = N.new('ShaderNodeTexCoord')
    # stars
    vor = N.new('ShaderNodeTexVoronoi')
    vor.inputs['Scale'].default_value = 220.0
    L.new(coord.outputs['Generated'], vor.inputs['Vector'])
    # Generated in world = view direction; offset to vary between scenes
    if 'W' in vor.inputs:
        vor.inputs['W'].default_value = seed
    dist = N.new('ShaderNodeMapRange')
    dist.inputs['From Min'].default_value = 0.0
    dist.inputs['From Max'].default_value = 0.07
    dist.inputs['To Min'].default_value = 1.0
    dist.inputs['To Max'].default_value = 0.0
    L.new(vor.outputs['Distance'], dist.inputs['Value'])
    sep = N.new('ShaderNodeSeparateColor')
    L.new(vor.outputs['Color'], sep.inputs['Color'])
    pick = N.new('ShaderNodeMapRange')  # only ~12% of cells hold a star
    pick.inputs['From Min'].default_value = 0.88
    pick.inputs['From Max'].default_value = 1.0
    pick.inputs['To Min'].default_value = 0.0
    pick.inputs['To Max'].default_value = 1.0
    L.new(sep.outputs['Red'], pick.inputs['Value'])
    star = N.new('ShaderNodeMath')
    star.operation = 'MULTIPLY'
    L.new(dist.outputs['Result'], star.inputs[0])
    L.new(pick.outputs['Result'], star.inputs[1])
    star_pow = N.new('ShaderNodeMath')
    star_pow.operation = 'POWER'
    star_pow.inputs[1].default_value = 3.0
    L.new(star.outputs['Value'], star_pow.inputs[0])
    star_gain = N.new('ShaderNodeMath')
    star_gain.operation = 'MULTIPLY'
    star_gain.inputs[1].default_value = 6.0
    L.new(star_pow.outputs['Value'], star_gain.inputs[0])
    # nebula
    noi = N.new('ShaderNodeTexNoise')
    noi.inputs['Scale'].default_value = 1.6
    noi.inputs['Detail'].default_value = 6.0
    noi.inputs['Roughness'].default_value = 0.6
    L.new(coord.outputs['Generated'], noi.inputs['Vector'])
    ramp = N.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.elements[0].position = 0.35
    cr.elements[0].color = (0.004, 0.006, 0.014, 1)
    cr.elements[1].position = 0.75
    cr.elements[1].color = (0.05, 0.02, 0.09, 1)
    e = cr.elements.new(0.58)
    e.color = (0.012, 0.03, 0.06, 1)
    L.new(noi.outputs['Fac'], ramp.inputs['Fac'])
    add = N.new('ShaderNodeMixRGB')
    add.blend_type = 'ADD'
    add.inputs['Fac'].default_value = 1.0
    L.new(ramp.outputs['Color'], add.inputs['Color1'])
    starcol = N.new('ShaderNodeCombineColor')
    for ch in ('Red', 'Green', 'Blue'):
        L.new(star_gain.outputs['Value'], starcol.inputs[ch])
    L.new(starcol.outputs['Color'], add.inputs['Color2'])
    bg_cam = N.new('ShaderNodeBackground')
    L.new(add.outputs['Color'], bg_cam.inputs['Color'])
    bg_amb = N.new('ShaderNodeBackground')
    bg_amb.inputs['Color'].default_value = (*ambient, 1)
    bg_amb.inputs['Strength'].default_value = ambient_strength
    lp = N.new('ShaderNodeLightPath')
    mix = N.new('ShaderNodeMixShader')
    L.new(lp.outputs['Is Camera Ray'], mix.inputs['Fac'])
    L.new(bg_amb.outputs['Background'], mix.inputs[1])
    L.new(bg_cam.outputs['Background'], mix.inputs[2])
    L.new(mix.outputs['Shader'], out.inputs['Surface'])
    return w


def _sun(name, energy, color, rot, angle=2.0):
    ld = bpy.data.lights.new(name, 'SUN')
    ld.energy = energy
    ld.color = color
    ld.angle = math.radians(angle)
    ob = bpy.data.objects.new(name, ld)
    ob.rotation_euler = [math.radians(a) for a in rot]
    bpy.context.scene.collection.objects.link(ob)
    return ob


def setup_lights(key_az=-135):
    """Warm key from the upper front-left of the camera, cool rim from behind,
    violet low fill.  key_az = azimuth (deg) the key light comes FROM.
    Sun rotation (0, zenith, az): light arrives from azimuth `az`."""
    _sun('Key', 4.2, (1.0, 0.95, 0.86), (0, 45, key_az))
    _sun('Rim', 3.0, (0.55, 0.78, 1.0), (0, 68, key_az + 170), angle=4)
    _sun('Fill', 0.6, (0.75, 0.6, 1.0), (0, 62, key_az - 100), angle=10)


# --------------------------------------------------------------------------
# camera
# --------------------------------------------------------------------------
def make_camera(name='Cam', lens=50.0):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.sensor_fit = 'VERTICAL'
    cd.sensor_height = 24.0
    cd.clip_start = 0.05
    cd.clip_end = 500
    ob = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.scene.camera = ob
    return ob


def aim_camera(cam, target, elevation, azimuth, distance):
    """Place camera on a sphere around target. elevation in deg above the
    horizon, azimuth in deg (0 = camera on +X side looking toward -X)."""
    el, az = math.radians(elevation), math.radians(azimuth)
    d = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    cam.location = Vector(target) + d * distance
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()


def fit_distance(cam, radius, margin=1.15):
    sc = bpy.context.scene
    aspect = sc.render.resolution_x / sc.render.resolution_y
    vfov = 2 * math.atan(cam.data.sensor_height / 2 / cam.data.lens)
    hfov = 2 * math.atan(math.tan(vfov / 2) * aspect)
    fov = min(vfov, hfov)
    return radius * margin / math.sin(fov / 2)


def bounds(objs):
    pts = []
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            pts.append(o.matrix_world @ Vector(c))
    mn = Vector([min(p[i] for p in pts) for i in range(3)])
    mx = Vector([max(p[i] for p in pts) for i in range(3)])
    return (mn + mx) / 2, (mx - mn).length / 2


# --------------------------------------------------------------------------
# labels
# --------------------------------------------------------------------------
def _label_mat():
    m = bpy.data.materials.get('AF_LabelText')
    if m:
        return m
    m = bpy.data.materials.new('AF_LabelText')
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (0.75, 0.82, 0.95, 1)
    em.inputs['Strength'].default_value = 0.9
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


def camera_label(cam, text, y_frac=-0.42, size_frac=0.045, x_frac=0.0, align='CENTER'):
    """Text glued to the camera. Fractions are of the frame height."""
    cu = bpy.data.curves.new('Label', 'FONT')
    cu.body = text
    cu.align_x = align
    cu.align_y = 'CENTER'
    d = 1.0
    half_h = d * math.tan(math.atan(cam.data.sensor_height / 2 / cam.data.lens))
    cu.size = 2 * half_h * size_frac
    ob = bpy.data.objects.new('Label', cu)
    ob.data.materials.append(_label_mat())
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = cam
    sc = bpy.context.scene
    aspect = sc.render.resolution_x / sc.render.resolution_y
    ob.location = (x_frac * 2 * half_h * aspect, y_frac * 2 * half_h, -d)
    ob.visible_shadow = False
    return ob


# --------------------------------------------------------------------------
# render + stitch
# --------------------------------------------------------------------------
def render_to(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc = bpy.context.scene
    ext = os.path.splitext(path)[1]
    tmp = path[:-len(ext)] + '.rendering' + ext if ext else path + '.rendering'
    sc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    _replace_with_retry(tmp, path)       # target may be locked by a viewer
    return path


def read_png(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)


def write_png(arr, path):
    h, w, _ = arr.shape
    img = bpy.data.images.new('stitch', w, h, alpha=False)
    img.colorspace_settings.name = 'sRGB'
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    tmp = path + '.tmp.png'
    img.filepath_raw = tmp
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    _replace_with_retry(tmp, path)
    return path


def _replace_with_retry(src, dst, tries=20):
    """The target PNG may be briefly locked on Windows (e.g. open in a viewer)."""
    import time
    for i in range(tries):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            time.sleep(0.5)
    raise RuntimeError(f'could not replace {dst} (locked?)')


def stitch(tiles, cols, tile_w, tile_h, path, gap=4, bg=(0.02, 0.025, 0.035), gap_y=None):
    """tiles: list of PNG paths, row-major from the TOP-left."""
    gy = gap if gap_y is None else gap_y
    rows = math.ceil(len(tiles) / cols)
    W = cols * tile_w + (cols - 1) * gap
    H = rows * tile_h + (rows - 1) * gy
    canvas = np.ones((H, W, 4), dtype=np.float32)
    canvas[..., 0], canvas[..., 1], canvas[..., 2] = bg
    for i, p in enumerate(tiles):
        r, c = divmod(i, cols)
        a = read_png(p)
        # image rows are bottom-up
        y0 = H - (r + 1) * tile_h - r * gy
        x0 = c * (tile_w + gap)
        canvas[y0:y0 + tile_h, x0:x0 + tile_w] = a
    return write_png(canvas, path)
