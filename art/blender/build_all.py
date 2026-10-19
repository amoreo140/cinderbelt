"""Cinderbelt art build - entry point.

  blender --background --factory-startup --python art/blender/build_all.py -- [options]

Options:
  --only <stages>  build only the listed stages (default: all, in this order):
                     parts,pirate_parts,asteroids,stations,station_variants,hangar_bay,debris,props,clutter,
                     wreckage,pois,guild,borders,npc,landmarks,scenery,liveries,icons,decals,vfx_borders,
                     preview,menu2
  --no-optimize   skip the optimizer post-step (art/tools/optimize_assets.mjs, README §2.9)
  --names a,b                      with pois/stations: build only these files
  --iter v3                        also copy previews to art/out/previews/iterations/v3-*.png
  --tiers iron[,titanium,crystal]  part tiers to build (default: iron,titanium,crystal)
  --preview m1|m2|m2s|m3           which preview set to render (default: m3)

Conventions (the game relies on these):
  * 1 Blender unit = 1 ship-grid cell; a 1x1 part fits in x,y in [-0.485, 0.485]
    (parts/common.py HALF), origin at the cell centre, z = 0 is the gameplay plane.
  * See art/README.md for the full handbook.
  * +X = bow (forward), +Y = port (left), +Z = up.  The glTF exporter converts
    to Y-up: glTF +X = forward, +Y = up, +Z = starboard (right), i.e.
    Blender (x, y, z) -> glTF (x, z, -y).
  * Engines at rotation 0 push toward +X (nozzle points -X).
  * All assets share ONE material "AF_Palette" (base colour / ORM / emissive
    swatch atlas, see lib/palette.py).  Animated sub-parts are separate named
    child nodes (e.g. Gyro_Ring_Outer, Gyro_Ring_Inner).
"""
import importlib
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import paths  # noqa: E402
from lib import geo as G  # noqa: E402
from lib import materials as M  # noqa: E402
from lib import export as E  # noqa: E402

PART_MODULES = ['cockpit', 'armor', 'engine', 'gyroscope',
                'mining_laser', 'cargo', 'fuel_tank', 'reactor', 'radar',
                'cannon', 'shield_generator',
                'heavy_laser', 'large_cargo', 'battery', 'tractor_beam',
                'refinery', 'large_reactor', 'repair_module',      # M4
                'shielding',                                       # M5a
                'cruise_drive']                                    # M5b


def _fresh_scene():
    G.reset_scene()
    M.build_atlas_images(paths.ATLAS)


def build_parts(tiers):
    report = []
    for tier in tiers:
        for name in PART_MODULES:
            mod = importlib.import_module('parts.' + name)
            _fresh_scene()
            root = mod.build(tier, paths.ATLAS)
            objs = [root] + list(root.children_recursive)
            tris = sum(G.tri_count(o) for o in objs if o.type == 'MESH')
            out = E.export_glb(root, os.path.join(paths.PARTS, f'{name}_{tier}.glb'))
            report.append((os.path.basename(out), tris, [o.name for o in objs]))
    # tier-independent hull connectors (iron accent on the skirt bridge)
    from parts import connectors as CN
    for fn, builder in (('hull_connector_edge', CN.build_edge), ('hull_connector_corner', CN.build_corner)):
        _fresh_scene()
        root = builder('iron', paths.ATLAS)
        out = E.export_glb(root, os.path.join(paths.PARTS, fn + '.glb'))
        report.append((os.path.basename(out), G.tri_count(root), [root.name]))
    return report


def build_asteroids():
    import asteroids as A
    import veins as V
    report = []
    vein_json = {'_schema': V.JSON_SCHEMA}
    for v in A.VARIANTS:
        name, kind, seed, radius = v[:4]
        shape = v[4] if len(v) > 4 else None
        _fresh_scene()
        ob = A.build(name, kind, seed, radius, paths.ATLAS, shape, veins=True)
        out = E.export_glb(ob, os.path.join(paths.ASTEROIDS, name + '.glb'), vertex_colors=True)
        objs = [ob] + list(ob.children)
        report.append((os.path.basename(out), sum(G.tri_count(o) for o in objs), [o.name for o in objs]))
        if A.VEINS.get(name):
            vein_json[name] = V.json_entry(A.VEINS[name], A.KIND_OF.get(name))
    with open(os.path.join(paths.ASTEROIDS, 'veins.json'), 'w', encoding='utf-8') as f:
        json.dump(vein_json, f, indent=1)
    for name, kind, seed, variant in A.FRAGMENTS:
        _fresh_scene()
        ob = A.build_fragment(name, kind, seed, variant, paths.ATLAS)
        out = E.export_glb(ob, os.path.join(paths.ASTEROIDS, name + '.glb'), vertex_colors=True)
        d = ob.dimensions
        report.append((os.path.basename(out), G.tri_count(ob), [ob.name, f'{d.x:.2f}x{d.y:.2f}x{d.z:.2f}']))
    return report


def build_props():
    import props as PR
    report = []
    for name in PR.BUILDERS:
        _fresh_scene()
        root = PR.build(name, paths.ATLAS)
        objs = [root] + list(root.children_recursive)
        tris = sum(G.tri_count(o) for o in objs if o.type == 'MESH')
        out = E.export_glb(root, os.path.join(paths.PROPS, name + '.glb'))
        d = root.dimensions
        report.append((os.path.basename(out), tris, [o.name for o in objs] + [f'{d.x:.2f}x{d.y:.2f}x{d.z:.2f}']))
    return report


def poi_jobs():
    """(module, name, builder, out_dir, vertex_colors) for the M3.5/M3.6 POIs."""
    import pirates as PI
    jobs = [('pirates', n, b, paths.PIRATES, n == 'hrdzava_pevnost') for n, b in PI.BUILDERS.items()]
    for modname, out_dir, vc in (('kovaci', paths.KOVACI, False), ('anomalies', paths.ANOMALIES, True),
                                 ('giants', paths.ASTEROIDS, True), ('buoys', paths.PROPS, False),
                                 # M4
                                 ('derelicts', paths.DERELICTS, True), ('comet', paths.COMETS, True),
                                 ('trader', paths.NPC, False), ('home_modules', paths.STATIONS, False),
                                 # M5a
                                 ('wardens', paths.WARDENS, False), ('kolos', paths.WARDENS, True),
                                 # M5b
                                 ('base_modules', paths.BASE, False), ('drones', paths.DRONES, False)):
        try:
            mod = importlib.import_module(modname)
        except ModuleNotFoundError:
            continue
        jobs += [(modname, n, b, out_dir, vc) for n, b in mod.BUILDERS.items()]
    return jobs


LAYOUT_FILES = {'derelicts': 'derelict_layouts.json', 'kolos': 'boss_layouts.json',
                'home_modules': 'home_modules.json', 'base_modules': 'base_modules.json',
                'drones': 'drones.json'}


def _ancestors(o):
    while o.parent:
        o = o.parent
        yield o


def build_pois(only_names=None):
    import pirates as PI
    report = []
    os.makedirs(paths.DATA, exist_ok=True)
    with open(os.path.join(paths.DATA, 'fortress_layouts.json'), 'w', encoding='utf-8') as f:
        json.dump(PI.layouts_json(), f, indent=2)
    for modname, name, builder, out_dir, vc in poi_jobs():
        if only_names and name not in only_names:
            continue
        _fresh_scene()
        root = builder(paths.ATLAS)
        import dtl_pois   # detail pass: greebles + AO/grime COLOR_0 on fortress, derelicts, base
        if dtl_pois.apply(name, root):
            vc = True
        objs = [root] + list(root.children_recursive)
        tris = sum(G.tri_count(o) for o in objs if o.type == 'MESH')
        out = E.export_glb(root, os.path.join(out_dir, name + '.glb'), vertex_colors=vc)
        report.append((os.path.basename(out), tris, [o.name for o in objs]))
        lay = PI.LAYOUTS if name in PI.LAYOUTS else getattr(importlib.import_module(modname), 'LAYOUTS', {})
        if name in lay:
            import structures as S
            solid = [o for o in objs if not any(a.name.startswith(('Derelict_Drift', 'Comet_Tail')) for a in
                                                   [o] + list(_ancestors(o)))]
            print('COVERAGE', name, S.coverage(solid, lay[name]['circles']))
    # extra layout files (module -> json next to fortress_layouts.json), written after the builds
    # (kolos needs the planned weak-point veins)
    for modname, fn in LAYOUT_FILES.items():
        if only_names and not any(n for m, n, *_ in poi_jobs() if m == modname and n in only_names):
            continue
        mod = importlib.import_module(modname)
        with open(os.path.join(paths.DATA, fn), 'w', encoding='utf-8') as f:
            json.dump(mod.layouts_json(), f, indent=2)
    return report


def build_debris():
    import debris as D
    report = []
    for name in D.BUILDERS:
        _fresh_scene()
        ob = D.build(name, paths.ATLAS)
        out = E.export_glb(ob, os.path.join(paths.DEBRIS, name + '.glb'), vertex_colors=True)
        d = ob.dimensions
        report.append((os.path.basename(out), G.tri_count(ob), [ob.name, f'{d.x:.2f}x{d.y:.2f}x{d.z:.2f}']))
    return report


def build_stations(only_names=None):
    """Stations, outposts, dock clamp, hangar platform + station_layouts.json."""
    import json
    import structures as S
    import hangar as H
    import stations_var as V
    report = []
    os.makedirs(paths.DATA, exist_ok=True)
    layouts = S.layouts_json()
    # batch D variants (station_d/e, outpost_c/d, built by the station_variants stage): their layouts live
    # in stations_var.LAYOUTS_D and are part of the live file since the code side merged them
    layouts.update({k: v for k, v in V.layouts_json().items() if k != '_schema'})
    with open(os.path.join(paths.DATA, 'station_layouts.json'), 'w', encoding='utf-8') as f:
        json.dump(layouts, f, indent=2)
    jobs = list(S.BUILDERS.items()) + [('hangar_platform', H.build)]
    for name, builder in jobs:
        if only_names and name not in only_names:
            continue
        _fresh_scene()
        root = builder(paths.ATLAS)
        objs = [root] + list(root.children_recursive)
        tris = sum(G.tri_count(o) for o in objs if o.type == 'MESH')
        vc = any(o.type == 'MESH' and len(o.data.color_attributes) for o in objs)   # dtl: AO/grime COLOR_0
        out = E.export_glb(root, os.path.join(paths.STATIONS, name + '.glb'), vertex_colors=vc)
        report.append((os.path.basename(out), tris, [o.name for o in objs]))
        if name in S.LAYOUTS:
            print('COVERAGE', name, S.coverage(objs, S.LAYOUTS[name]['circles']))
    return report


# ----------------------------------------------------------------------------
# art audit 2026-10-16 batches A-D (README 2.7.22-2.7.25).  Each batch also has its own entry script
# (scenery.py, batch_b.py, batch_c.py, batch_d.py) that built into a private atlas dir and optimized only
# its own files (the batches ran in parallel); here they use the shared atlas (paths.ATLAS, same pixels)
# and the normal optimizer post-step.
# ----------------------------------------------------------------------------
def build_scenery():
    """Batch A: models/scenery/*.glb + scenery.json."""
    import scenery as SC
    SC.ATLAS = paths.ATLAS
    report = SC.build(optimize=False)
    return [(SC.SETS[sid][0], sum(e['tris'] for e in entries), [e['name'] for e in entries])
            for sid, entries in report.items()]


def _batch_b():
    import batch_b as BB
    BB.ATLAS_B = paths.ATLAS
    return BB


def build_batch_c(stages):
    """Batch C: guild (npc/guild_cutter, guild_frigate, stations/guild_picket), borders (models/borders/),
    npc (civilian traffic) + the manifests npc/npc_ships.json, borders/borders.json (generated from
    the build report art/out/batch_c_report.json, so a partial run keeps the other entries)."""
    import batch_c as BC
    BC.ATLAS = paths.ATLAS
    rep = BC._load_report()
    files = []
    if 'guild' in stages:
        files += BC.build_guild(None, rep)
    if 'borders' in stages:
        files += BC.build_borders(None, rep)
    if 'npc' in stages:
        files += BC.build_npc(None, rep)
    BC._save_report(rep)
    for m in BC.write_manifests(rep):
        print('MANIFEST', m)
    built = {os.path.splitext(os.path.basename(f))[0] for f in files}
    return [(n + '.glb', r['tris'], [nd['name'] for nd in r['nodes']]) for n, r in rep.items() if n in built]


def build_batch_d(stages):
    """Batch D: station_variants (station_d/e, outpost_c/d + data/station_layouts_batch_d.json) and
    hangar_bay.  The dock clamp v2, caged beacons and hangar platform v2 are the `stations` stage.
    Returns batch D's report; its manifest (stations_batch_d.json, with the shipped byte sizes) is
    written after the optimizer."""
    import batch_d as BD
    report = []
    if 'station_variants' in stages:
        report += BD.build({'variants'})[0]
    if 'hangar_bay' in stages:
        report += BD.build({'hangar'}, {'hangar_bay'})[0]
    return report


MENU2_OPTION = 1      # the menu composition chosen in batch D (ui_art.MENU2_OPTIONS)

# stages that export GLBs (followed by the optimizer post-step)
MODEL_STAGES = {'parts', 'pirate_parts', 'asteroids', 'stations', 'station_variants', 'hangar_bay', 'debris',
                'props', 'clutter', 'wreckage', 'pois', 'guild', 'npc', 'borders', 'landmarks', 'scenery'}


def main(argv):
    only = None
    iter_tag = None
    tiers = ['iron', 'titanium', 'crystal']
    mode = argv[argv.index('--preview') + 1] if '--preview' in argv else 'm3'
    if '--only' in argv:
        only = set(argv[argv.index('--only') + 1].split(','))
    if '--iter' in argv:
        iter_tag = argv[argv.index('--iter') + 1]
    if '--tiers' in argv:
        tiers = argv[argv.index('--tiers') + 1].split(',')
    t0 = time.time()
    rep = []
    if not only or 'parts' in only:
        rep += build_parts(tiers)
    if not only or 'pirate_parts' in only:
        # pirate clan part sets (build_pirate_parts.py; `build_pirate_parts.py -- --verify-only` checks
        # them against the player parts)
        import build_pirate_parts as BP
        r, problems = BP.build(BP.CLANS, list(BP.PART_IDS), list(BP.TIERS))
        rep += r
        BP.write_manifest()
        for p in problems:
            print('GEOMETRY', p)
    if not only or 'asteroids' in only:
        rep += build_asteroids()
    if not only or 'stations' in only:
        rep += build_stations(set(argv[argv.index('--names') + 1].split(',')) if '--names' in argv else None)
    stages_d = {s for s in ('station_variants', 'hangar_bay') if not only or s in only}
    report_d = build_batch_d(stages_d) if stages_d else []
    rep += [(n + '.glb', tris, [k for k, _ in nodes]) for n, tris, nodes in report_d]
    if not only or 'debris' in only:
        rep += build_debris()
    if not only or 'props' in only:
        rep += build_props()           # cargo_container (no vertex colours - keeps the file byte-identical)
    if not only or 'clutter' in only:
        _batch_b().build_props()       # batch B4/B5 space clutter WITH vertex colours + props/props.json
    if not only or 'wreckage' in only:
        _batch_b().build_wreckage()    # batch B3 wreck fields + wreckage/wreckage.json
    if not only or 'pois' in only:
        rep += build_pois(set(argv[argv.index('--names') + 1].split(',')) if '--names' in argv else None)
    stages_c = {s for s in ('guild', 'borders', 'npc') if not only or s in only}
    if stages_c:
        rep += build_batch_c(stages_c)
    if not only or 'landmarks' in only:
        import landmarks   # far scenery (readability plan section 2) + landmarks.json
        rep += [(r['file'], r['tris'], r['nodes']) for r in landmarks.build(optimize=False).values()]
    if not only or 'scenery' in only:
        rep += build_scenery()         # batch A depth/bed/rubble sets + scenery.json
    if not only or 'liveries' in only:
        from lib import livery as LV
        for lv in ['default'] + list(LV.LIVERIES):
            print('LIVERY', LV.export_livery(paths.TEXTURES, lv))
        # swatch key -> atlas UV table for runtime geometry (hull shell, nav lights; README "Hull shell")
        from lib import palette as P
        print('SWATCHES', P.write_swatch_table(paths.TEXTURES))
    if '--no-optimize' not in argv and (not only or only & MODEL_STAGES):
        # shipped GLBs: shared atlas by URI + meshopt (after the liveries stage, which writes
        # the shared palette_default_* the optimizer compares the embedded atlas with)
        from lib import optimize
        optimize.run(['models'])
    if report_d:
        import batch_d as BD
        print('MANIFEST', BD.write_manifest(report_d))   # after the optimizer: records the shipped sizes
    if not only or 'icons' in only:
        import icons
        icons.build_all()
    if not only or 'decals' in only:
        _batch_b().build_decals()      # batch B7 vfx/damage_decals.png (numpy)
    if not only or 'vfx_borders' in only:
        import vfx_borders             # batch C border ribbon + fence textures (numpy)
        vfx_borders.main()
    for f, tris, names in rep:
        print(f'BUILT {f:28s} {tris:6d} tris  nodes={names}')
    if not only or 'preview' in only:
        import preview
        preview.main(iter_tag, mode)
    if not only or 'menu2' in only:
        # batch D4 menu background: renders the chosen composition from the shipped (optimized) GLBs, so it
        # runs last; writes public/assets/ui/menu_bg.jpg + menu_bg_1080.jpg (+ art/out/previews/ui-menu.png)
        import bpy
        import ui_art
        ui_art.render_menu2((MENU2_OPTION,), iter_tag)
        # finalize_menu2 writes the JPGs with save_render, which applies the scene's view transform to the
        # rendered PNG once more; the shipped JPGs were finalized in a fresh (--factory-startup) scene, so
        # use its settings (AgX, no look) instead of the render's 'Medium High Contrast' look
        vs = bpy.context.scene.view_settings
        vs.view_transform, vs.look, vs.exposure, vs.gamma = 'AgX', 'None', 0.0, 1.0
        for p in ui_art.finalize_menu2(MENU2_OPTION):
            print('UI', p)
    print(f'DONE in {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
