"""QA helper: list where a structure's vertices stick out of its collision
circles (clusters on a 1-unit grid).

  blender -b --factory-startup --python art/blender/tools_coverage.py -- <folder>/<name> [<layout json>]
"""
import json
import math
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy  # noqa: E402
import paths  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
for item in argv[0].split(','):
    folder, name = item.split('/')
    lay_file = argv[1] if len(argv) > 1 else 'station_layouts.json'
    lay = json.load(open(os.path.join(paths.DATA, lay_file), encoding='utf-8'))[name]
    circles = [(c['x'], c['y'], c['r']) for c in lay['circles']]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    base = os.path.join(paths.OUT, 'before_dtl') if folder.startswith('before_') else paths.MODELS
    folder = folder.replace('before_', '')
    bpy.ops.import_scene.gltf(filepath=os.path.join(base, folder, name + '.glb'))
    bpy.context.view_layer.update()
    cnt = Counter()
    worst = {}
    n = 0
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            p = mw @ v.co        # glTF import: Blender frame again (Y-up converted back)
            n += 1
            d = min(math.hypot(p.x - x, p.y - y) - r for x, y, r in circles)
            if d > 0.05:
                k = (round(p.x), round(p.y))
                cnt[k] += 1
                worst[k] = max(worst.get(k, 0), d)
    print('COVER', name, 'verts', n, 'outside', sum(cnt.values()))
    for k, c in cnt.most_common(14):
        print('  at', k, c, 'max', round(worst[k], 2))
