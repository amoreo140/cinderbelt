"""Detail pass ("dtl") for the finished POI assets: pirate fortress, derelicts,
planetary base hub + modules.

build_all.build_pois() calls apply(name, root) right after each builder.  The
builders stay as they are (nodes, pivots, layouts untouched); this module adds
ship-part-scale greebles to their STATIC meshes with station_kit.post_dress()
(faces already on the atlas are recognised by their UV), then bakes AO/grime
into COLOR_0 - the GLB is exported with vertex colours.

Animated / toggled child nodes are protected: they join the ray-test BVH and
get clear zones (rotating nodes: a cylinder around the pivot covering their
sweep).
"""
import math

from mathutils import Vector

from lib import greebles as GR
import station_kit as K


def _children(root):
    return [o for o in root.children_recursive]


def _world_bbox(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector([min(p[i] for p in pts) for i in range(3)])
    mx = Vector([max(p[i] for p in pts) for i in range(3)])
    return mn, mx


def protect(zones, objs, inv, spin=(), margin=0.15, skip=()):
    """Clear zones (in host-local space via `inv`) around child nodes: AABB for
    static/toggled nodes, a pivot cylinder for spinning ones (names in spin)."""
    for o in objs:
        if any(o.name.startswith(s) for s in skip):
            continue
        if o.type == 'EMPTY':
            p = inv @ o.matrix_world.translation
            zones.cyl(p.x, p.y, 0.55, p.z - 0.5, p.z + 0.9)
            continue
        if o.type != 'MESH':
            continue
        pts = [inv @ (o.matrix_world @ Vector(c)) for c in o.bound_box]
        mn = Vector([min(p[i] for p in pts) for i in range(3)])
        mx = Vector([max(p[i] for p in pts) for i in range(3)])
        if any(o.name.startswith(s) for s in spin):
            c = inv @ o.matrix_world.translation
            r = max(math.hypot(p.x - c.x, p.y - c.y) for p in pts) + margin
            zones.cyl(c.x, c.y, r, mn.z - margin, mx.z + margin)
        else:
            zones.box(mn.x - margin, mx.x + margin, mn.y - margin, mx.y + margin, mn.z - margin, mx.z + margin)
    return zones


# ----------------------------------------------------------------------------
# pirate fortress
# ----------------------------------------------------------------------------
def _fortress(root):
    import pirates as PI
    kids = _children(root)
    z = GR.Zones()
    inv = root.matrix_world.inverted()
    # turret mounts, core well, generator towers, spawn lane, beacons (+ AABB of the core / towers)
    protect(z, [o for o in kids if o.name != 'Fortress_Rock'], inv, margin=0.2)
    for x, y, zz, a in PI.TURRETS:
        z.cyl(x, y, 1.15, zz - 0.25, zz + 3)
    z.cyl(0, 0, 2.5, PI.PAD + 0.15, 20)
    z.box(10.8, 40, -3.0, 3.0, -3, 9)
    host, st = K.post_dress(root, 4243, 'pirate', z, bvh_extra=kids, panels=True, panel_cell=1.3,
                            panel_keys=('pir_gunmetal', 'pir_plate_worn', 'pir_gunmetal_dark'),
                            rows=[(2.0, 0.08), (0.9, 0.08)], row_kinds=('window', 'wlights', 'wvent'),
                            scatter=[dict(density=1.25)], weather_cfg=dict(grime=0.6, rust=0.5, panel=0.1))
    # scrap clutter on the levelled rock pad: crates, drums, deck patches, cable runs, scorch
    rock = next((o for o in kids if o.name == 'Fortress_Rock'), None)
    if rock is not None:
        def on_pad(p):
            return p.z > PI.PAD - 0.35 and math.hypot(p.x, p.y) < 7.3
        K.post_dress(rock, 4244, 'pirate', z, bvh_extra=[root] + [o for o in kids if o is not rock], panels=False,
                     rows=(), scatter=[dict(density=1.6, keys=('st_rock_iron',), region=on_pad, side=0.0,
                                        only=('rack', 'tank', 'patch', 'cables', 'pipes', 'unit', 'scorch', 'truss',
                                              'hatch', 'vent', 'antenna', 'lights'))],
                     weather_cfg=dict(ao=0.35, ao_near=0.35, grime=0.0))
    for o in kids:     # weather the destroyable nodes too (AO + grime), no greebles on them
        if o.type == 'MESH' and o.name.startswith(('shield_gen', 'fortress_core')):
            K.post_dress(o, 7, 'pirate', None, panels=False, rows=(), scatter=None,
                         weather_cfg=dict(grime=0.5, rust=0.4))
    return st


# ----------------------------------------------------------------------------
# derelicts (weathered human language, dead lights)
# ----------------------------------------------------------------------------
DERELICT_ARMS = {'derelict_a': (3.0, 1.5), 'derelict_b': (0.6, 1.4), 'derelict_c': (3.3, 1.4),
                 'derelict_d': (2.6, 1.3)}


def _derelict(root, name, seed):
    import derelicts as D
    kids = _children(root)
    z = GR.Zones()
    inv = root.matrix_world.inverted()
    protect(z, [o for o in kids if o.name.startswith(('beacon_', 'Derelict_Drift', 'Relay_', 'relay_',
                                                       'power_target', 'dock_port'))], inv, margin=0.2,
            spin=('Relay_Receiver',))
    R = D.LAYOUTS[name]['R']
    if R:
        z.box(R - 2.2, R + 20, -1.6, 1.6, -3, 9)
        x0, w = DERELICT_ARMS[name]
        z.functional(x0 - 0.1, R, -w / 2 - 0.05, w / 2 + 0.05, 0.05)   # arm walkway deck (rolled 6 deg)
    host, st = K.post_dress(root, seed, 'derelict', z, bvh_extra=kids, panels=True, panel_cell=1.1,
                            panel_keys=('der_plate', 'der_dark', 'hull_mid'),
                            rows=[(-0.6, 0.07), (0.25, 0.07), (1.0, 0.07)], row_kinds=('window', 'wpanel', 'whole'),
                            scatter=[dict(density=(1.15 if name == 'derelict_a' else 1.45) if R else 0.8)],
                            weather_cfg=dict(grime=0.25, rust=0.3, panel=0.12, floor=0.22))
    return st


# ----------------------------------------------------------------------------
# planetary base
# ----------------------------------------------------------------------------
SPIN = ('Drill_Rotor', 'Probe_Rotor', 'Solar_Array', 'Reactor_Core', 'Refinery_Rotor', 'Tower_Turret',
        'Hub_Radar', 'Launcher_Pod')


def _base_hub(root):
    import base_modules as B
    kids = _children(root)
    z = GR.Zones()
    inv = root.matrix_world.inverted()
    protect(z, [o for o in kids if not o.name.startswith(('Hub_Legs', 'Hub_Floats', 'Hub_Upgrade', 'Pad_'))], inv,
            spin=SPIN)
    z.annulus(1.9, 3.35, 2.15, 3.2)                      # U2 hab ring + U3 halo
    for a in (22.5, 202.5):                              # U2 hab blocks
        z.cyl(3.75 * math.cos(math.radians(a)), 3.75 * math.sin(math.radians(a)), 0.95, 0.3, 2.0)
    z.cyl(0.0, 2.95, 0.6, 1.8, 9)                        # U3 tower
    for k in range(8):                                   # legs / float arms leave the drum at 22.5 + 45k
        a = math.radians(22.5 + 45 * k)
        for r in (3.2, 3.7, 4.2):
            z.cyl(r * math.cos(a), r * math.sin(a), 0.45, 0.0, 1.6)
        b = math.radians(45 * k)                          # pad bridges meet the foundation
        z.cyl(4.1 * math.cos(b), 4.1 * math.sin(b), 0.9, 0.1, 9)
    host, st = K.post_dress(root, 811, 'base', z, bvh_extra=kids, panels=True, panel_cell=1.0,
                            rows=[(1.37, 0.06)], scatter=[dict(density=1.2)],
                            weather_cfg=dict(grime=0.3))
    for o in kids:
        if o.type == 'MESH' and o.name.startswith('Pad_'):
            # pad deck + bridge walkway are functional: detail only on the slab / bridge SIDES
            pz = GR.Zones().pad(0, 0, B.PAD_R + 0.1, B.PAD_TOP - 0.2)
            K.post_dress(o, 900 + int(o.name[-1]), 'base', pz, panels=False, rows=(),
                         scatter=[dict(density=1.1, top=0.0)], weather_cfg=dict(grime=0.3))
        elif o.type == 'MESH':
            K.post_dress(o, 950, 'base', None, panels=False, rows=(), scatter=None, weather_cfg=dict(grime=0.25))
    return st


def _drone_dock_rim(root, pz=1.0, r=1.752, cx=0.25):
    """Tasteful detail on the landing pad RIM (side wall under the orange belt):
    alternating vents and light strips - the pad surface itself stays clean."""
    import random
    rng = random.Random(5)
    kit = GR.Kit()
    S_ = GR.STYLES['base']
    for k in range(20):
        a = math.radians(9 + k * 18)
        if math.cos(a) < -0.8:          # the control hut side
            continue
        n = Vector((math.cos(a), math.sin(a), 0))
        m = GR.wall_frame((cx + r * n.x, r * n.y, pz - 0.19), n)
        if k % 2:
            GR.w_lights(kit, m, 0.14, 0.03, rng, S_, 'hull_dark')
        else:
            GR.g_vent(kit, m, 0.16, 0.045, rng, S_, 'hull_dark')
    K._join_kit(root, kit.obj('DockRim'))


def _base_module(root, name):
    import base_modules as B
    kids = _children(root)
    z = GR.Zones()
    inv = root.matrix_world.inverted()
    protect(z, kids, inv, spin=SPIN, margin=0.18)
    z.annulus(B.MODULE_R - 0.05, 99, -9, 99)
    functional = name in ('base_module_drone_dock', 'base_module_launcher')
    if name == 'base_module_drone_dock':
        _drone_dock_rim(root)
    if name == 'base_module_drone_dock':          # landing pad + glow ring + chevrons stay clean
        z.pad(0.25, 0.0, 1.85, 0.3)
    st = K.post_dress(root, sum(map(ord, name)), 'base', z, bvh_extra=kids, panels=not functional, panel_cell=0.8,
                      panel_min_area=0.5, rows=[(0.95, 0.06), (1.45, 0.06)],
                      scatter=[dict(density=1.3, top=0.0 if functional else 1.0)],
                      weather_cfg=dict(grime=0.25, near=0.3, far=1.4))[1]
    for o in kids:
        if o.type == 'MESH':
            K.post_dress(o, 951, 'base', None, panels=False, rows=(), scatter=None,
                         weather_cfg=dict(grime=0.2, near=0.3, far=1.4))
    return st


def apply(name, root):
    """Detail pass for a finished POI root; returns True if it was dressed
    (export with vertex colours)."""
    import bpy
    bpy.context.view_layer.update()
    if name == 'hrdzava_pevnost':
        st = _fortress(root)
    elif name.startswith('derelict_'):
        st = _derelict(root, name, 3000 + sum(map(ord, name)))
    elif name == 'base_hub':
        st = _base_hub(root)
    elif name.startswith('base_module_'):
        st = _base_module(root, name)
    else:
        return False
    print('DTL', name, st)
    return True
