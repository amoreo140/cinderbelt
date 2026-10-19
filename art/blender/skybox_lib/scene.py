"""Scene / render setup shared by the panorama and preview renders."""
import math

import bpy


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0


def cycles_settings(w, h, samples, denoise=False):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'OPTIX'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == 'OPTIX'
        sc.cycles.device = 'GPU'
    except Exception as e:  # pragma: no cover
        print('GPU setup failed, using CPU:', e)
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.use_denoising = denoise
    sc.cycles.pixel_filter_type = 'BLACKMAN_HARRIS'
    sc.cycles.filter_width = 1.5
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    sc.render.use_compositing = False
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0


def pano_camera():
    sc = bpy.context.scene
    cd = bpy.data.cameras.new('Pano')
    cd.type = 'PANO'
    cd.panorama_type = 'EQUIRECTANGULAR'
    cd.clip_start = 0.001
    cd.clip_end = 100.0
    ob = bpy.data.objects.new('Pano', cd)
    sc.collection.objects.link(ob)
    # image centre = +X, top = +Z, u=0.25 = +Y  (matches three.js equirect lookup)
    ob.rotation_euler = (math.radians(90), 0, math.radians(-90))
    sc.camera = ob
    return ob
