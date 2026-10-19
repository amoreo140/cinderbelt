"""Batch D (art audit 2026-10-16 §6) - "Structures and screens": entry script.

  blender --background --factory-startup --python art/blender/batch_d.py -- [--only clamp,stations,variants,hangar]
          [--names a,b] [--no-optimize]

Stages (default: all four):
  clamp      stations/dock_clamp.glb v2 (hydraulic jaws, DROP-IN)
  stations   station_home, station_a..c, outpost_a..b rebuilt with caged beacon lamps (DROP-IN, same seeds)
  variants   stations/station_d, station_e, outpost_c, outpost_d (stations_var.py) + their layouts in
             art/blender/data/station_layouts_batch_d.json (to MERGE into station_layouts.json - the live
             file is not touched)
  hangar     stations/hangar_platform.glb v2 (DROP-IN) + stations/hangar_bay.glb (new)

Always writes public/assets/models/stations/stations_batch_d.json (manifest) and prints COVERAGE /
node lists.  Ends with the optimizer on THIS batch's files only (not the whole models tree).
The menu background is ui_art.py (--only menu2); previews: preview_batch_d.py.
"""
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import paths  # noqa: E402
from lib import export as E  # noqa: E402
from lib import geo as G  # noqa: E402
from lib import materials as M  # noqa: E402

STAGES = ('clamp', 'stations', 'variants', 'hangar')
DROP_IN_STATIONS = ('station_home', 'station_a', 'station_b', 'station_c', 'outpost_a', 'outpost_b')
LAYOUT_FILE = os.path.join(paths.DATA, 'station_layouts_batch_d.json')
MANIFEST = os.path.join(paths.STATIONS, 'stations_batch_d.json')
OPT_DIR = os.path.join(paths.OUT, 'batch_d_tools')


def _fresh_scene():
    G.reset_scene()
    M.build_atlas_images(paths.ATLAS)


def _export(name, root):
    objs = [root] + list(root.children_recursive)
    tris = sum(G.tri_count(o) for o in objs if o.type == 'MESH')
    vc = any(o.type == 'MESH' and len(o.data.color_attributes) for o in objs)
    out = E.export_glb(root, os.path.join(paths.STATIONS, name + '.glb'), vertex_colors=vc)
    return out, tris, objs


def _nodes(objs):
    import bpy
    bpy.context.view_layer.update()
    rows = []
    for o in objs:
        if o.name.startswith(('beacon_', 'guide_light_', 'dock_port', 'ring_rotor', 'attach_', 'Clamp_Jaw', 'Arm_')):
            p = o.matrix_world.translation
            rows.append((o.name, (round(p.x, 3), round(p.z, 3), round(-p.y, 3))))      # glTF coords
    return rows


def build(stages, names=None):
    import structures as S
    report, built = [], []

    def want(n):
        return not names or n in names

    if 'clamp' in stages and want('dock_clamp'):
        import stations_dtl as D
        _fresh_scene()
        root = D.build_clamp(paths.ATLAS)
        out, tris, objs = _export('dock_clamp', root)
        report.append(('dock_clamp', tris, _nodes(objs)))
        built.append(out)
    if 'stations' in stages:
        for n in DROP_IN_STATIONS:
            if not want(n):
                continue
            _fresh_scene()
            root = S.BUILDERS[n](paths.ATLAS)
            out, tris, objs = _export(n, root)
            print('COVERAGE', n, S.coverage(objs, S.LAYOUTS[n]['circles']))
            report.append((n, tris, _nodes(objs)))
            built.append(out)
    if 'variants' in stages:
        import stations_var as V
        os.makedirs(paths.DATA, exist_ok=True)
        with open(LAYOUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(V.layouts_json(), f, indent=2)
        for n, b in V.BUILDERS.items():
            if not want(n):
                continue
            _fresh_scene()
            root = b(paths.ATLAS)
            out, tris, objs = _export(n, root)
            print('COVERAGE', n, S.coverage(objs, V.LAYOUTS_D[n]['circles']))
            report.append((n, tris, _nodes(objs)))
            built.append(out)
    if 'hangar' in stages:
        import hangar as H
        for n, b in (('hangar_platform', H.build), ('hangar_bay', H.build_bay)):
            if not want(n):
                continue
            _fresh_scene()
            root = b(paths.ATLAS)
            out, tris, objs = _export(n, root)
            if n == 'hangar_bay':
                print('HEIGHT RULE', n, H.check_height_rule(objs))
            else:
                print('PLATFORM CHECK', n, H.check_platform(objs))
            report.append((n, tris, _nodes(objs)))
            built.append(out)
    return report, built


# ----------------------------------------------------------------------------
# optimizer on this batch's files only (art/tools/optimize_assets.mjs has no file filter)
# ----------------------------------------------------------------------------
_WRAPPER = r"""
import { optimizeGlb } from './optimize_copy.mjs';
const files = process.argv.slice(2);
for (const f of files) {
  const r = await optimizeGlb(f, { force: false });
  console.log(r ? `optimized ${f}: ${(r[0] / 1024).toFixed(0)} KB -> ${(r[1] / 1024).toFixed(0)} KB` : `already optimized ${f}`);
}
"""


def optimize_files(files):
    """Run the optimizer's per-GLB step on `files` only.  A patched copy of
    optimize_assets.mjs (optimizeGlb exported, ROOT fixed) lives in art/out/batch_d_tools/ so Node
    resolves the repo's node_modules."""
    node = shutil.which('node')
    if not node or not files:
        print('WARNING optimize: node missing or nothing to do')
        return False
    os.makedirs(OPT_DIR, exist_ok=True)
    src = open(os.path.join(paths.ART, 'tools', 'optimize_assets.mjs'), encoding='utf-8').read()
    a = "async function optimizeGlb("
    b = "const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');"
    assert a in src and b in src, 'optimize_assets.mjs changed - update batch_d.optimize_files'
    src = src.replace(a, 'export ' + a).replace(
        b, "const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');")
    with open(os.path.join(OPT_DIR, 'optimize_copy.mjs'), 'w', encoding='utf-8') as f:
        f.write(src)
    with open(os.path.join(OPT_DIR, 'optimize_files.mjs'), 'w', encoding='utf-8') as f:
        f.write(_WRAPPER)
    r = subprocess.run([node, os.path.join(OPT_DIR, 'optimize_files.mjs')] + list(files), cwd=paths.ROOT)
    return r.returncode == 0


def write_manifest(report):
    """stations_batch_d.json: what changed, node contracts, sizes (merged with an existing file so a
    partial run keeps the other entries)."""
    import hangar as H
    import stations_var as V
    data = {}
    if os.path.exists(MANIFEST):
        try:
            data = json.load(open(MANIFEST, encoding='utf-8'))
        except Exception:
            data = {}
    data['_schema'] = {
        'about': 'art audit 2026-10-16 batch D (structures and screens): dock clamp v2, caged beacons, station '
                 'variants, hangar platform v2 + hangar bay. glTF coordinates (+X = dock / bow, +Y = up).',
        'integration': 'DROP-IN = same file + node contract, rebuild shows it; SMALL CODE = path list / manifest copy',
        'files': 'per file: integration, tris (shipped GLB incl. children), nodes (name -> glTF position), notes',
        'layouts': 'new station layouts: art/blender/data/station_layouts_batch_d.json (merge into '
                   'station_layouts.json + the src/data copy)',
    }
    files = data.setdefault('files', {})
    for name, tris, nodes in report:
        e = files.setdefault(name, {})
        e['file'] = f'assets/models/stations/{name}.glb'
        e['tris'] = tris
        e['nodes'] = {n: list(p) for n, p in nodes}
        sz = os.path.join(paths.STATIONS, name + '.glb')
        if os.path.exists(sz):
            e['bytes'] = os.path.getsize(sz)
        if name == 'dock_clamp':
            e['integration'] = 'DROP-IN'
            e['notes'] = ('origin = dock_port, extent x -2.4..0.6, y -1.5..1.5 (Blender) unchanged; guide_light_0..3 '
                          'unchanged (left+right pair, index grows along +X). New: Clamp_Jaw_L / Clamp_Jaw_R (pivot = '
                          'outer hinge, closed = rest pose). Optional animation: open = rotate +35 deg (L) / -35 deg (R) '
                          'about local +Y while the ship is out of range, close during the docking latch.')
            e['jaws'] = {'openDeg': {'Clamp_Jaw_L': 35, 'Clamp_Jaw_R': -35}, 'axis': 'local +Y'}
        elif name in DROP_IN_STATIONS:
            e['integration'] = 'DROP-IN'
            e['notes'] = ('caged beacon lamps: beacon_<i> = the lamp lens only (same order + colours, positions moved '
                          '<= ~0.3 to sit on a surface); the cage housing is part of the static mesh. Other nodes '
                          'unchanged.')
        elif name in V.LAYOUTS_D:
            e['integration'] = 'SMALL CODE'
            e.update(V.ROLES[name])
            e['radius'] = V.LAYOUTS_D[name]['R']
            e['notes'] = ('no ring_rotor; beacon_<i> blink like every station; layout in '
                          'station_layouts_batch_d.json')
        elif name == 'hangar_platform':
            e['integration'] = 'DROP-IN'
            e['notes'] = ('17 x 17, 15 x 15 floor clean, floor top z -0.37 (glTF y), all geometry below glTF y '
                          f'{H.PLATFORM_MAX_Y} (HangarView GANTRY_CUT 0.55 ghosts nothing now - the clipping can stay '
                          'or go). Pedestal down to the bay deck (glTF y %.2f).' % H.BAY_DECK)
        elif name == 'hangar_bay':
            e['integration'] = 'SMALL CODE'
            e['notes'] = ('add to the hangar yard group (same frame as hangar_platform: origin = platform centre, '
                          '+X = bow). Height rule: every vertex at horizontal distance r from the centre stays below '
                          'glTF y = -0.37 + 0.6 (r - 8.5) (camera orbit 360, pitch >= 35, FOV 34) - verified at build. '
                          'Bay door opens to space on +X (the far side at the default yaw). Optional animation: '
                          'Arm_<i> slides along local X on its rail (range in railX), Arm_<i>_Head turns about local '
                          '+Y; Arm_<i>_Tip = weld-spark origin.')
            e['railX'] = list(H.ARM_RAIL_X)
            e['deckY'] = H.BAY_DECK
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1)
    return MANIFEST


def main(argv):
    stages = set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else set(STAGES)
    names = set(argv[argv.index('--names') + 1].split(',')) if '--names' in argv else None
    t0 = time.time()
    report, built = build(stages, names)
    for n, tris, nodes in report:
        print(f'BUILT {n:18s} {tris:6d} tris  nodes={nodes}')
    if '--no-optimize' not in argv:
        optimize_files(built)
    write_manifest(report)
    print(f'DONE batch D in {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
