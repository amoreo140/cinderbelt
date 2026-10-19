"""Entry script of art batch C ("Factions in space": Guild Watch, sector borders,
NPC traffic - art audit 2026-10-16 §6 C, sectors design 2026-10-18 §0/§5.2,
README §2.7.24).

  blender --background --factory-startup --python art/blender/batch_c.py -- [--only guild,borders,npc,vfx]
          [--names a,b] [--no-optimize]

Stages (default: all):
  guild    guild.py      -> models/npc/guild_cutter.glb, guild_frigate.glb, models/stations/guild_picket.glb
  borders  borders.py    -> models/borders/*.glb (lane buoy + 4 security border markers)
  npc      npc_ships.py  -> models/npc/miner_barge.glb, tanker.glb, courier.glb, survey_ship.glb
  vfx      vfx_borders.py -> vfx/border_ribbon.png, vfx/border_fence_<security>.png (plain numpy)
Manifests (written every run from the shipped files' build report):
  models/npc/npc_ships.json, models/borders/borders.json
Every model stage ends with the optimizer limited to the files it wrote
(art/tools/optimize_files.mjs) - batches run in parallel, see audit §5.
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from lib import export as E  # noqa: E402
from lib import geo as G  # noqa: E402
from lib import materials as M  # noqa: E402
import paths  # noqa: E402

BORDERS = os.path.join(paths.MODELS, 'borders')
REPORT = os.path.join(paths.OUT, 'batch_c_report.json')
# private atlas dir: parallel batches rewrite art/out/palette/ (same pixels, but never read a half-written PNG)
ATLAS = os.path.join(paths.OUT, 'palette_batch_c')


def _fresh():
    G.reset_scene()
    M.build_atlas_images(ATLAS)


def _gltf(v):
    """Blender (x, y, z) -> glTF (x, z, -y), rounded."""
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]


def stats(root):
    """tris, node list (name, type, glTF world position, parent), glTF bounds."""
    bpy.context.view_layer.update()
    objs = [root] + list(root.children_recursive)
    tris = sum(G.tri_count(o) for o in objs if o.type == 'MESH')
    pts = []
    for o in objs:
        if o.type == 'MESH':
            pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = [min(p[i] for p in pts) for i in range(3)]
    mx = [max(p[i] for p in pts) for i in range(3)]
    nodes = []
    for o in objs:
        if o is root:
            continue
        nodes.append(dict(name=o.name, type='EMPTY' if o.type == 'EMPTY' else 'MESH',
                          parent=o.parent.name if o.parent is not root else None,
                          pos=_gltf(o.matrix_world.translation),
                          tris=G.tri_count(o) if o.type == 'MESH' else 0))
    gmin = [round(mn[0], 3), round(mn[2], 3), round(-mx[1], 3)]
    gmax = [round(mx[0], 3), round(mx[2], 3), round(-mn[1], 3)]
    return dict(tris=tris, nodes=nodes, min=gmin, max=gmax,
                size=[round(gmax[i] - gmin[i], 3) for i in range(3)])


def _load_report():
    if os.path.exists(REPORT):
        with open(REPORT, encoding='utf-8') as f:
            return json.load(f)
    return {}


def _save_report(rep):
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, 'w', encoding='utf-8') as f:
        json.dump(rep, f, indent=1)


def _build(builders, out_dir_of, names, rep, vc=True):
    files = []
    for name, builder in builders.items():
        if names and name not in names:
            continue
        _fresh()
        root = builder(ATLAS)
        f = E.export_glb(root, os.path.join(out_dir_of(name), name + '.glb'), vertex_colors=vc)
        s = stats(root)
        rep[name] = s
        print(f'BC {name}: {s["tris"]} tris, size {s["size"]}, nodes {[n["name"] for n in s["nodes"]]}')
        files.append(f)
    return files


def build_guild(names, rep):
    import guild
    return _build(guild.BUILDERS, lambda n: paths.STATIONS if n == 'guild_picket' else paths.NPC, names, rep)


def build_borders(names, rep):
    import borders
    return _build(borders.BUILDERS, lambda n: BORDERS, names, rep)


def build_npc(names, rep):
    import npc_ships
    return _build(npc_ships.BUILDERS, lambda n: paths.NPC, names, rep)


def write_manifests(rep):
    out = []
    try:
        import npc_ships
        out.append(npc_ships.write_manifest(rep))
    except (ImportError, KeyError) as e:
        print('BC npc manifest skipped:', e)
    try:
        import borders
        out.append(borders.write_manifest(rep))
    except (ImportError, KeyError) as e:
        print('BC borders manifest skipped:', e)
    return out


def optimize_files(files):
    node = shutil.which('node')
    if not node or not files:
        print('WARNING optimize: node missing or nothing to do')
        return False
    script = os.path.join(paths.ART, 'tools', 'optimize_files.mjs')
    r = subprocess.run([node, script] + list(files), cwd=paths.ROOT)
    if r.returncode != 0:
        print('WARNING optimize: failed - run node art/tools/optimize_files.mjs <files>')
        return False
    return True


def main(argv):
    only = set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else None
    names = set(argv[argv.index('--names') + 1].split(',')) if '--names' in argv else None
    rep = _load_report()
    files = []
    if not only or 'guild' in only:
        files += build_guild(names, rep)
    if not only or 'borders' in only:
        files += build_borders(names, rep)
    if not only or 'npc' in only:
        files += build_npc(names, rep)
    if not only or 'vfx' in only:
        import vfx_borders
        vfx_borders.main()
    _save_report(rep)
    if files and '--no-optimize' not in argv:
        optimize_files(files)
    for m in write_manifests(rep):
        print('BC manifest', m)
    print('BC done', len(files), 'models')


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
