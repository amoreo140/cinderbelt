"""Pirate clan part sets (readability work, step 3) - build, verify, manifest.

  blender --background --factory-startup --python art/blender/build_pirate_parts.py -- [options]

Options:
  --clans rust,cauldron,slantedStar   clans to build (default: all)
  --parts cockpit,engine,...          part modules (default: all in PART_IDS)
  --tiers iron,titanium               tiers (default: iron,titanium)
  --no-optimize                       skip the liveries + optimizer post-step
  --verify-only                       only re-run the socket verification on the shipped files

Output: public/assets/models/parts_pirate/<clan>/<module>_<tier>.glb + manifest.json.
Every file is verified against the player's part (public/assets/models/parts/<module>_<tier>.glb):
same special node names, parents and transforms (pivots, muzzles, emitters), same deck
profile bounds, everything inside the 1x1 footprint, turrets/heads inside the cell at every
aim angle, engine nozzle exit at the player's x.  A failed check exits with code 1.
"""
import importlib
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import paths  # noqa: E402
from lib import export as E  # noqa: E402
from lib import geo as G  # noqa: E402
from lib import materials as M  # noqa: E402

OUT = os.path.join(paths.MODELS, 'parts_pirate')
CLANS = ('rust', 'cauldron', 'slantedStar')
CLAN_MODULES = {'rust': 'rust', 'cauldron': 'cauldron', 'slantedStar': 'slanted_star'}
TIERS = ('iron', 'titanium')
TIER_NUM = {'iron': 1, 'titanium': 2}
# part module (file name) -> game PartId (the parts pirate ships use: src/sim/combat/enemies.ts,
# src/sim/captains/captains.ts)
PART_IDS = {'cockpit': 'cockpit', 'engine': 'engine', 'cannon': 'cannon', 'armor': 'armor',
            'shield_generator': 'shield', 'reactor': 'reactor', 'gyroscope': 'gyro',
            'fuel_tank': 'fuelTank', 'cargo': 'cargo', 'tractor_beam': 'tractorBeam'}
# nodes the game looks up / animates (art/README §2.3); must match the player's part exactly
SPECIAL = {'cannon': ('Cannon_Turret', 'Cannon_Muzzle'), 'tractor_beam': ('Tractor_Head', 'Tractor_Emitter'),
           'gyroscope': ('Gyro_Ring_Outer', 'Gyro_Ring_Inner'), 'shield_generator': ('Shield_Emitter',)}
# swiveling heads: everything must stay inside the cell at any aim angle (radius from the pivot axis)
SWIVEL = {'cannon': 'Cannon_Turret', 'tractor_beam': 'Tractor_Head'}

MANIFEST_SCHEMA = {
    'about': 'Pirate clan part sets (readability work step 3, art/README §2.7.20). Visual only: '
             'same PartId/tier, footprint, deck profile, node names, pivots and empties as the player part.',
    'parts': 'clan -> PartId -> tier ("1" iron, "2" titanium) -> model path (relative to the site root, '
             'like catalog.ts partModelPath). Missing entry = use the player part (fallback).',
    'clans': 'clan -> {label, accent (UI token colour), lights}. Clan ids = FactionId.',
    'connectors': 'clan -> {edge, corner}: hull connectors in clan colours, geometry identical to '
                  'parts/hull_connector_*.glb (same placement rule, connectors.ts).',
    'nodes': 'PartId -> special node names (identical to the player part).',
    'liveries': 'Do NOT apply the "pirate" livery to clan parts (it does not change them anyway); '
                'wrecks use the "derelict" livery (textures/palette_derelict_*.png, same atlas layout).',
}
CLAN_INFO = {
    'rust': {'label': 'Hrdza', 'accent': '#ff5a4a', 'lights': 'red'},
    'cauldron': {'label': 'Kotol', 'accent': '#ff8a3a', 'lights': 'orange'},
    'slantedStar': {'label': 'Šikmá hviezda', 'accent': '#ffd36b', 'lights': 'yellow'},
}


def out_path(clan, module, tier):
    return os.path.join(OUT, clan, f'{module}_{tier}.glb')


def asset_path(clan, module, tier):
    return f'assets/models/parts_pirate/{clan}/{module}_{tier}.glb'


CONNECTORS = ('edge', 'corner')


def connector_path(clan, kind):
    return os.path.join(OUT, clan, f'hull_connector_{kind}.glb')


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
def _fresh_scene():
    G.reset_scene()
    M.build_atlas_images(paths.ATLAS)


def _check_in_blender(module, root):
    """Geometry checks on the built objects (world space, Blender axes). Returns problems."""
    import bpy
    from mathutils import Vector
    bpy.context.view_layer.update()
    problems = []
    objs = [root] + list(root.children_recursive)
    lim = 0.5 + 1e-4
    for o in objs:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        xs, ys = [], []
        for v in o.data.vertices:
            w = mw @ v.co
            xs.append(w.x)
            ys.append(w.y)
        if min(xs) < -lim or max(xs) > lim or min(ys) < -lim or max(ys) > lim:
            problems.append(f'{o.name}: outside the cell x[{min(xs):.3f},{max(xs):.3f}] '
                            f'y[{min(ys):.3f},{max(ys):.3f}]')
    head = SWIVEL.get(module)
    if head:
        h = next(o for o in objs if o.name == head)
        piv = h.matrix_world.translation
        rmax = 0.0
        for o in [h] + list(h.children_recursive):
            if o.type != 'MESH':
                continue
            for v in o.data.vertices:
                w = o.matrix_world @ v.co
                rmax = max(rmax, math.hypot(w.x - piv.x, w.y - piv.y))
        if rmax > 0.5:
            problems.append(f'{head}: swept radius {rmax:.3f} > 0.5')
    if module == 'engine':
        xs = [(root.matrix_world @ v.co).x for v in root.data.vertices
              if abs((root.matrix_world @ v.co).z) < 0.3 and abs((root.matrix_world @ v.co).y) < 0.3]
        if min(xs) < -0.5:
            problems.append(f'engine: nozzle reaches x {min(xs):.3f}')
    return problems


def build(clans, modules, tiers, build_connectors=True):
    from parts_pirate import kit as K
    report, problems = [], []
    for clan in clans:
        mod = importlib.import_module('parts_pirate.' + CLAN_MODULES[clan])
        for module in modules:
            for tier in tiers:
                _fresh_scene()
                ct = K.clan_tier(clan, tier)
                root = mod.BUILDERS[module](ct, K.TIER_LEVEL[tier], K.rng_for(clan, module, tier), paths.ATLAS)
                objs = [root] + list(root.children_recursive)
                tris = sum(G.tri_count(o) for o in objs if o.type == 'MESH')
                problems += [f'{clan}/{module}_{tier}: {p}' for p in _check_in_blender(module, root)]
                out = E.export_glb(root, out_path(clan, module, tier))
                report.append((f'{clan}/{os.path.basename(out)}', tris, [o.name for o in objs]))
        if build_connectors:
            for kind in CONNECTORS:
                _fresh_scene()
                root = K.build_connector(clan, kind, paths.ATLAS)
                out = E.export_glb(root, connector_path(clan, kind))
                report.append((f'{clan}/{os.path.basename(out)}', G.tri_count(root), [root.name]))
    return report, problems


# ---------------------------------------------------------------------------
# manifest
# ---------------------------------------------------------------------------
def write_manifest():
    parts = {}
    for clan in CLANS:
        for module, pid in PART_IDS.items():
            for tier in TIERS:
                if os.path.exists(out_path(clan, module, tier)):
                    parts.setdefault(clan, {}).setdefault(pid, {})[str(TIER_NUM[tier])] = \
                        asset_path(clan, module, tier)
    data = {
        '_schema': MANIFEST_SCHEMA,
        'version': 1,
        'clans': CLAN_INFO,
        'tiers': {'1': 'iron', '2': 'titanium'},
        'parts': parts,
        'connectors': {clan: {kind: f'assets/models/parts_pirate/{clan}/hull_connector_{kind}.glb'
                              for kind in CONNECTORS if os.path.exists(connector_path(clan, kind))}
                       for clan in CLANS},
        'nodes': {PART_IDS[m]: list(v) for m, v in SPECIAL.items()},
        'liveries': {'derelict': {k: f'assets/textures/palette_derelict_{k}.png'
                                  for k in ('basecolor', 'orm', 'emissive')}},
    }
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'manifest.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')
    return path


# ---------------------------------------------------------------------------
# verification on the exported / shipped GLB files (plain JSON, no Blender needed)
# ---------------------------------------------------------------------------
def glb_json(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, _ver, _len = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, path
    clen, ctype = struct.unpack_from('<II', data, 12)
    return json.loads(data[20:20 + clen].decode('utf-8'))


def _nodes(js):
    """name -> (parent name, translation, rotation, scale, mesh bounds or None)."""
    nodes = js['nodes']
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    out = {}
    for i, n in enumerate(nodes):
        b = None
        if 'mesh' in n:
            mins, maxs = [], []
            for p in js['meshes'][n['mesh']]['primitives']:
                acc = js['accessors'][p['attributes']['POSITION']]
                mins.append(acc['min'])
                maxs.append(acc['max'])
            b = ([min(m[k] for m in mins) for k in range(3)], [max(m[k] for m in maxs) for k in range(3)])
        out[n.get('name', f'#{i}')] = (nodes[parent[i]].get('name') if i in parent else None,
                                       n.get('translation', [0, 0, 0]), n.get('rotation', [0, 0, 0, 1]),
                                       n.get('scale', [1, 1, 1]), b)
    return out


def _root(nodes):
    return next(k for k, v in nodes.items() if v[0] is None)


def verify(clans=CLANS, modules=tuple(PART_IDS), tiers=TIERS):
    """Compare every clan part with the player's part. Returns (lines, failures)."""
    lines, fails = [], 0
    for module in modules:
        for tier in tiers:
            ref_path = os.path.join(paths.PARTS, f'{module}_{tier}.glb')
            ref = _nodes(glb_json(ref_path))
            rroot = _root(ref)
            for clan in clans:
                p = out_path(clan, module, tier)
                if not os.path.exists(p):
                    lines.append(f'MISSING {clan}/{module}_{tier}')
                    fails += 1
                    continue
                got = _nodes(glb_json(p))
                groot = _root(got)
                errs = []
                for name in SPECIAL.get(module, ()):
                    if name not in got:
                        errs.append(f'node {name} missing')
                        continue
                    rp, rt, rr, rs, _ = ref[name]
                    gp, gt, gr, gs, _ = got[name]
                    rp = 'ROOT' if rp == rroot else rp
                    gp = 'ROOT' if gp == groot else gp
                    if rp != gp:
                        errs.append(f'{name} parent {gp} != {rp}')
                    for lab, a, b in (('t', gt, rt), ('r', gr, rr), ('s', gs, rs)):
                        if max(abs(x - y) for x, y in zip(a, b)) > 1e-5:
                            errs.append(f'{name} {lab} {[round(x, 4) for x in a]} != {[round(x, 4) for x in b]}')
                extra = sorted(set(got) - {groot} - set(SPECIAL.get(module, ())))
                if extra:
                    errs.append(f'unexpected nodes {extra}')
                # deck profile: the root mesh spans the same core block + skirt as the player part
                rb, gb = ref[rroot][4], got[groot][4]
                # glTF: x forward, y up, z = -Blender y. Same skirt extents (+-0.491) on every side
                # (engine: front and flanks only), nothing past 0.5, same bottom of the core block.
                for k, lab in ((0, 'x'), (2, 'z')):
                    for side, val, rval in (('min', gb[0][k], rb[0][k]), ('max', gb[1][k], rb[1][k])):
                        if abs(val) > 0.5 + 1e-4:
                            errs.append(f'root {lab}{side} {val:.3f} outside the cell')
                        elif abs(val - rval) > 0.01 and not (module == 'engine' and lab == 'x' and side == 'min'):
                            errs.append(f'root {lab}{side} {val:.3f} vs player {rval:.3f}')
                # bottom: the core block (-0.20) like the player part; engines may sit higher than the
                # player bell but never below the hangar floor (-0.37, README 2.5)
                if gb[0][1] < -0.365 or (module != 'engine' and abs(gb[0][1] - rb[0][1]) > 0.01):
                    errs.append(f'root bottom y {gb[0][1]:.3f} vs player {rb[0][1]:.3f}')
                if module == 'engine' and abs(gb[0][0] - rb[0][0]) > 0.03:
                    errs.append(f'nozzle exit x {gb[0][0]:.3f} vs player {rb[0][0]:.3f}')
                size = os.path.getsize(p)
                status = 'OK  ' if not errs else 'FAIL'
                fails += bool(errs)
                lines.append(f'{status} {clan:12s} {module}_{tier:9s} {size / 1024:5.1f} KB '
                             f'(player {os.path.getsize(ref_path) / 1024:5.1f} KB)' +
                             ('' if not errs else '\n       ' + '\n       '.join(errs)))
    for clan in clans:
        for kind in CONNECTORS:
            ref = _nodes(glb_json(os.path.join(paths.PARTS, f'hull_connector_{kind}.glb')))
            p = connector_path(clan, kind)
            if not os.path.exists(p):
                lines.append(f'MISSING {clan}/hull_connector_{kind}')
                fails += 1
                continue
            got = _nodes(glb_json(p))
            rb, gb = ref[_root(ref)][4], got[_root(got)][4]
            bad = len(got) != 1 or max(abs(a - b) for a, b in zip(rb[0] + rb[1], gb[0] + gb[1])) > 1e-5
            fails += bad
            lines.append(f'{"FAIL" if bad else "OK  "} {clan:12s} hull_connector_{kind:6s} bounds '
                         f'{"differ" if bad else "identical"} {os.path.getsize(p) / 1024:5.1f} KB')
    return lines, fails


def main(argv):
    clans = argv[argv.index('--clans') + 1].split(',') if '--clans' in argv else list(CLANS)
    modules = argv[argv.index('--parts') + 1].split(',') if '--parts' in argv else list(PART_IDS)
    tiers = argv[argv.index('--tiers') + 1].split(',') if '--tiers' in argv else list(TIERS)
    problems = []
    if '--verify-only' not in argv:
        report, problems = build(clans, modules, tiers, build_connectors='--parts' not in argv)
        for f, tris, names in report:
            print(f'BUILT {f:34s} {tris:6d} tris  nodes={names}')
        print('MANIFEST', write_manifest())
        # liveries first: palette_default_* must contain the clan swatches (the optimizer compares
        # the embedded atlas with it) and palette_derelict_* is part of this deliverable
        from lib import livery as LV
        for lv in ['default'] + list(LV.LIVERIES):
            LV.export_livery(paths.TEXTURES, lv)
        if '--no-optimize' not in argv:
            from lib import optimize
            optimize.run(['models'])
    lines, fails = verify(clans, modules, tiers)
    print('\n'.join(lines))
    for p in problems:
        print('GEOMETRY', p)
    print(f'VERIFY {"PASSED" if not fails and not problems else "FAILED"}: {len(lines)} files, '
          f'{fails} socket failures, {len(problems)} geometry problems')
    if fails or problems:
        sys.exit(1)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
