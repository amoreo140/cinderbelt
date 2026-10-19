"""Entry script of art batch B ("Clutter, salvage and wreckage", art audit
2026-10-16 §6 B, README §2.7.23).

  blender --background --factory-startup --python art/blender/batch_b.py -- [--only debris,wreckage,props,decals]
          [--names a,b] [--no-optimize]

Stages (default: all):
  debris    debris.py   -> public/assets/models/debris/debris_*.glb (13 files, B1 + B2)
  wreckage  wreckage.py -> public/assets/models/wreckage/*.glb + wreckage.json (B3)
  props     props.py    -> public/assets/models/props/<clutter>.glb + props.json (B4, B5);
                           cargo_container is NOT rebuilt here (build_all owns it, byte-identical)
  decals    vfx_damage.py -> public/assets/vfx/damage_decals.png (B7, plain numpy)
Every model stage ends with the optimizer limited to the files it wrote
(art/tools/optimize_files.mjs) - batches run in parallel, see audit §5.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402

from lib import export as E  # noqa: E402
from lib import geo as G  # noqa: E402
from lib import materials as M  # noqa: E402
import paths  # noqa: E402
import wreck_kit as W  # noqa: E402

WRECKAGE = os.path.join(paths.MODELS, 'wreckage')
# private copy of the build-time atlas PNGs: parallel batches rewrite art/out/palette at the same time
# (same pixels; the in-memory AF_Palette_* images are what the builders and the exporter use)
ATLAS_B = os.path.join(paths.OUT, 'palette_batch_b')


def _fresh():
    G.reset_scene()
    M.build_atlas_images(ATLAS_B)


def _stats(root):
    objs = [root] + list(root.children_recursive)
    tris = sum(G.tri_count(o) for o in objs if o.type == 'MESH')
    pts = []
    from mathutils import Vector
    bpy.context.view_layer.update()
    for o in objs:
        if o.type == 'MESH':
            pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = [min(p[i] for p in pts) for i in range(3)]
    mx = [max(p[i] for p in pts) for i in range(3)]
    return tris, [o.name for o in objs], mn, mx


def build_debris(names=None):
    import debris as D
    out = []
    for name in D.BUILDERS:
        if names and name not in names:
            continue
        _fresh()
        ob = D.build(name, ATLAS_B)
        f = E.export_glb(ob, os.path.join(paths.DEBRIS, name + '.glb'), vertex_colors=True)
        tris, nodes, mn, mx = _stats(ob)
        print(f'BB debris {name}: {tris} tris, size {mx[0]-mn[0]:.2f} x {mx[1]-mn[1]:.2f} x {mx[2]-mn[2]:.2f}, '
              f'nodes {nodes}')
        out.append(f)
    return out


def build_wreckage(names=None):
    import wreckage as WR
    out = []
    report = {}
    for name in WR.BUILDERS:
        if names and name not in names:
            continue
        _fresh()
        root = WR.build(name, ATLAS_B)
        f = E.export_glb(root, os.path.join(WRECKAGE, name + '.glb'), vertex_colors=True)
        tris, nodes, mn, mx = _stats(root)
        report[name] = WR.describe(name, root)
        print(f'BB wreckage {name}: {tris} tris, size {mx[0]-mn[0]:.2f} x {mx[1]-mn[1]:.2f} x {mx[2]-mn[2]:.2f}, '
              f'nodes {nodes}')
        out.append(f)
    WR.write_manifest(report, WRECKAGE)
    return out


def build_props(names=None):
    import props as PR
    out = []
    report = {}
    for name in PR.CLUTTER:
        if names and name not in names:
            continue
        _fresh()
        root = PR.build(name, ATLAS_B)
        f = E.export_glb(root, os.path.join(paths.PROPS, name + '.glb'), vertex_colors=True)
        tris, nodes, mn, mx = _stats(root)
        report[name] = PR.describe(name, root)
        print(f'BB props {name}: {tris} tris, size {mx[0]-mn[0]:.2f} x {mx[1]-mn[1]:.2f} x {mx[2]-mn[2]:.2f}, '
              f'nodes {nodes}')
        out.append(f)
    PR.write_manifest(report, paths.PROPS)
    return out


def build_decals():
    import vfx_damage
    return vfx_damage.main()


def main(argv):
    only = None
    names = None
    if '--only' in argv:
        only = set(argv[argv.index('--only') + 1].split(','))
    if '--names' in argv:
        names = set(argv[argv.index('--names') + 1].split(','))
    files = []
    if not only or 'debris' in only:
        files += build_debris(names)
    if not only or 'wreckage' in only:
        files += build_wreckage(names)
    if not only or 'props' in only:
        files += build_props(names)
    if not only or 'decals' in only:
        build_decals()
    if files and '--no-optimize' not in argv:
        W.optimize_files(files)
    print('BB done', len(files), 'models')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv)
