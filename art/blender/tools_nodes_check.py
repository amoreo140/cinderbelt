"""QA: compare node names + world positions of the shipped GLBs with the
pre-detail-pass copies in art/out/before_dtl (nodes/pivots must not move).

  blender -b --factory-startup --python art/blender/tools_nodes_check.py
"""
import glob
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy  # noqa: E402
import paths  # noqa: E402


def nodes(f):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f)
    bpy.context.view_layer.update()
    return {o.name: tuple(round(c, 3) for c in o.matrix_world.translation) for o in bpy.data.objects}


bad = 0
for f in sorted(glob.glob(os.path.join(paths.OUT, 'before_dtl', '*', '*.glb'))):
    folder = os.path.basename(os.path.dirname(f))
    a = nodes(f)
    b = nodes(os.path.join(paths.MODELS, folder, os.path.basename(f)))
    diffs = [k for k in a if k not in b or (a[k] != b[k] and not k.startswith('beacon_'))]
    moved_b = [k for k in a if k.startswith('beacon_') and k in b and a[k] != b[k]]
    extra = [k for k in b if k not in a]
    status = 'OK' if not diffs and not extra else 'DIFF'
    bad += status != 'OK'
    print('NODES', status, folder, os.path.basename(f), 'missing/moved:', diffs, 'new:', extra,
          'beacons moved:', moved_b)
print('NODES_BAD', bad)
