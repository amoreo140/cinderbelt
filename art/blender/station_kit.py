"""Detail-pass ("dtl") building blocks for large structures + the finishing
pipeline that dresses them with the greeble kit (lib/greebles.py).

Blocks return lists of objects (logical PAL_ materials, like structures.py);
finish() joins them, adds panel insets / window rows / scattered greebles,
bakes AO + grime into COLOR_0 and finalises to the AF_Palette atlas.
"""
import math
import random

import bmesh
from mathutils import Matrix, Vector

from lib import geo as G
from lib import greebles as GR


# ----------------------------------------------------------------------------
# primitives
# ----------------------------------------------------------------------------
def arc_box(name, R, w, h, z, a0, a1, mat, steps=None, side_mat=None, top_mat=None):
    """Rectangular-section ring arc from angle a0 to a1 (deg), radial width w,
    height h centred on z.  side_mat: outer wall, top_mat: top face."""
    steps = steps or max(2, int(abs(a1 - a0) / 5.0))
    bm = bmesh.new()
    secs = []
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        c, s = math.cos(a), math.sin(a)
        ri, ro = R - w / 2, R + w / 2
        secs.append([bm.verts.new((ri * c, ri * s, z - h / 2)), bm.verts.new((ro * c, ro * s, z - h / 2)),
                     bm.verts.new((ro * c, ro * s, z + h / 2)), bm.verts.new((ri * c, ri * s, z + h / 2))])
    keys = [mat]
    if side_mat:
        keys.append(side_mat)
    if top_mat:
        keys.append(top_mat)
    for i in range(steps):
        A, B = secs[i], secs[i + 1]
        for k in range(4):
            j = (k + 1) % 4
            f = bm.faces.new((A[k], A[j], B[j], B[k]) if a1 > a0 else (A[k], B[k], B[j], A[j]))
            if k == 1 and side_mat:
                f.material_index = 1
            if k == 2 and top_mat:
                f.material_index = len(keys) - 1
    for sec, first in ((secs[0], True), (secs[-1], False)):
        f = bm.faces.new(list(reversed(sec)) if first == (a1 > a0) else sec)
    ob = G.obj_from_bm(name, bm, keys)
    return ob


def rbox(name, r0, r1, hw, z0, z1, angle, mat, bevel=0.0, tw=None):
    """Box spanning radius r0..r1 along `angle` (deg), half-width hw (tangential)."""
    b = G.box(name, r0, r1, -hw, hw, z0, z1, mat, bevel=bevel, seg=1)
    G.transform(b, rot=(0, 0, angle))
    return b


def bar(name, p0, p1, w, mat, hgt=None):
    """Square bar between two points (no bevel - cheap)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    hgt = hgt or w
    ob = G.box(name, 0.0, d.length, -w / 2, w / 2, -hgt / 2, hgt / 2, mat)
    q = Vector((1, 0, 0)).rotation_difference(d.normalized())
    ob.data.transform(Matrix.Translation(p0) @ q.to_matrix().to_4x4())
    return ob


def box_truss(name, p0, p1, w=0.6, h=0.5, bar_w=0.08, mat='hull_dark', rung=None, rung_mat=None, diag=True):
    """Rectangular box girder from p0 to p1 (horizontal-ish): 4 longerons,
    rungs and alternating diagonals on the two sides."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    ax = d.normalized()
    side = ax.cross(Vector((0, 0, 1)))
    if side.length < 1e-4:
        side = Vector((0, 1, 0))
    side.normalize()
    up = side.cross(ax).normalized()
    out = []
    corners = [side * sy * w / 2 + up * sz * h / 2 for sy in (-1, 1) for sz in (-1, 1)]
    for i, c in enumerate(corners):
        out.append(bar(f'{name}L{i}', p0 + c, p1 + c, bar_w, mat))
    n = rung or max(2, int(L / max(w, 0.5)))
    rm = rung_mat or mat
    for i in range(n + 1):
        t = p0 + d * (i / n)
        for sy in (-1, 1):
            out.append(bar(f'{name}V{i}{sy}', t + side * sy * w / 2 - up * h / 2, t + side * sy * w / 2 + up * h / 2,
                           bar_w * 0.75, rm))
        for sz in (-1, 1):
            out.append(bar(f'{name}H{i}{sz}', t - side * w / 2 + up * sz * h / 2, t + side * w / 2 + up * sz * h / 2,
                           bar_w * 0.75, rm))
        if diag and i < n:
            t2 = p0 + d * ((i + 1) / n)
            for sy in (-1, 1):
                a = t + side * sy * w / 2 + up * (h / 2 if i % 2 else -h / 2)
                b = t2 + side * sy * w / 2 + up * (-h / 2 if i % 2 else h / 2)
                out.append(bar(f'{name}D{i}{sy}', a, b, bar_w * 0.6, rm))
    return out


def tank_h(name, x0, x1, y, z, r, body='fuel_yellow', cap='hull_light', strap='trim_black', axis='X', verts=12,
           straps=3):
    """Horizontal capsule tank along X (or Y) with straps and saddles."""
    L = (x1 - x0) / 2 - r
    c = (x0 + x1) / 2
    prof = []
    n = 3
    for i in range(n + 1):
        a = math.pi / 2 * i / n
        prof.append((-L - r * math.cos(a), r * math.sin(a)))
    prof.append((L, r))
    for i in range(1, n + 1):
        a = math.pi / 2 * i / n
        prof.append((L + r * math.sin(a), r * math.cos(a)))
    segs = [1] * n + [0] + [1] * n
    loc = (c, y, z) if axis == 'X' else (y, c, z)
    out = [G.lathe(name, prof, segs, [body, cap], loc=loc, axis=axis, verts=verts, closed=False)]
    for j in range(straps):
        a = -L * 0.8 + 1.6 * L * j / max(1, straps - 1)
        loc2 = (c + a, y, z) if axis == 'X' else (y, c + a, z)
        out.append(G.ring_band(f'{name}Strap{j}', r + 0.04, r - 0.04, -0.06, 0.06, strap, loc=loc2, axis=axis,
                               verts=verts, smooth=False))
    return out


def solar_array(name, x0, x1, y0, y1, z, cols=4, rows=3, frame='hull_mid', cell='solar_cell', tilt=0.0,
                pivot_y=None, spar='hull_dark'):
    """Framed solar array in the XY plane at height z: border frame, cell
    grid, back spar along X.  tilt (deg) rotates it about the X axis through
    (pivot_y, z)."""
    out = []
    t = 0.07
    out.append(G.box(name + 'FrA', x0, x1, y0, y0 + t, z - 0.06, z + 0.05, frame))
    out.append(G.box(name + 'FrB', x0, x1, y1 - t, y1, z - 0.06, z + 0.05, frame))
    out.append(G.box(name + 'FrC', x0, x0 + t, y0, y1, z - 0.06, z + 0.05, frame))
    out.append(G.box(name + 'FrD', x1 - t, x1, y0, y1, z - 0.06, z + 0.05, frame))
    out.append(G.box(name + 'Back', x0 + t, x1 - t, y0 + t, y1 - t, z - 0.04, z - 0.01, 'trim_black'))
    gx, gy = (x1 - x0 - 2 * t) / cols, (y1 - y0 - 2 * t) / rows
    for i in range(cols):
        for j in range(rows):
            out.append(G.box(f'{name}C{i}{j}', x0 + t + i * gx + 0.035, x0 + t + (i + 1) * gx - 0.035,
                             y0 + t + j * gy + 0.035, y0 + t + (j + 1) * gy - 0.035, z - 0.01, z + 0.03, cell))
    # mid spar + cross ribs
    ym = (y0 + y1) / 2
    out.append(G.box(name + 'Spar', x0, x1, ym - 0.05, ym + 0.05, z - 0.12, z - 0.03, spar))
    if tilt:
        py = y0 if pivot_y is None else pivot_y
        mm = Matrix.Translation((0, py, z)) @ Matrix.Rotation(math.radians(tilt), 4, 'X') @ Matrix.Translation(
            (0, -py, -z))
        for o in out:
            G.apply_modifiers(o)
            o.data.transform(mm)
    return out


def rotator(name, loc, r=0.22, L=0.5, axis='Y', mat='hull_mid', ring='accent_iron'):
    """Solar-array rotator joint: drum + accent ring + end caps."""
    x, y, z = loc
    out = [G.cyl(name, r, L, mat, loc=loc, axis=axis, verts=10)]
    out.append(G.ring_band(name + 'Ring', r + 0.05, r - 0.02, -0.06, 0.06, ring, loc=loc, axis=axis, verts=10,
                           smooth=False))
    out.append(G.cyl(name + 'Cap', r * 0.6, L + 0.16, 'hull_dark', loc=loc, axis=axis, verts=8))
    return out


def lamp_post(name, loc, key, h=0.35, r=0.07):
    x, y, z = loc
    return [G.box(name, x - 0.04, x + 0.04, y - 0.04, y + 0.04, z, z + h, 'hull_dark'),
            G.box(name + 'L', x - r, x + r, y - r, y + r, z + h, z + h + r * 1.6, key)]


def light_row(name, p0, p1, n, key, s=0.06, h=0.05):
    p0, p1 = Vector(p0), Vector(p1)
    out = []
    for i in range(n):
        p = p0 + (p1 - p0) * ((i + 0.5) / n)
        out.append(G.box(f'{name}{i}', p.x - s, p.x + s, p.y - s, p.y + s, p.z, p.z + h, key))
    return out


def ring_lights(name, r, z, n, key, s=0.06, h=0.05, a0=0.0, skip=()):
    out = []
    for i in range(n):
        if i in skip:
            continue
        a = math.radians(a0 + 360.0 * i / n)
        b = G.box(f'{name}{i}', -s, s, -s, s, 0, h, key)
        G.transform(b, loc=(r * math.cos(a), r * math.sin(a), z), rot=(0, 0, math.degrees(a)))
        out.append(b)
    return out


# ----------------------------------------------------------------------------
# finish: join -> panels -> window rows -> scatter -> weather -> atlas
# ----------------------------------------------------------------------------
def dress(host, rng, style, zones, bvh_extra=(), panels=True, rows=(), scatter=None, panel_cell=1.1,
          panel_keys=None, row_kinds=('window',), region=None, center=(0.0, 0.0), z_min=-1e9, z_max=1e9,
          row_region=None, panel_region=None, panel_min_area=1.2):
    """Dress `host` (joined, logical materials).  Returns the joined object and
    a stats dict.  scatter: kwargs for Scatter.run or a list of them."""
    S = GR.STYLES[style] if isinstance(style, str) else style
    stats = {}
    if panels:
        kp = GR.Kit()
        bvh = GR.bvh_of([host] + list(bvh_extra))
        stats['panels'] = GR.panel_grid(kp, host, rng, S, cell=panel_cell, keys=panel_keys, bvh=bvh, zones=zones,
                                        center=center, z_min=z_min, z_max=z_max, region=panel_region,
                                        min_area=panel_min_area)
        if kp.tris:
            host = _join_kit(host, kp.obj(host.name + 'Panels'))
    if rows:
        kr = GR.Kit()
        bvh = GR.bvh_of([host] + list(bvh_extra))
        stats['rows'] = GR.wall_rows(kr, host, rng, S, rows, bvh=bvh, zones=zones, kinds=row_kinds,
                                     region=row_region)
        if kr.tris:
            host = _join_kit(host, kr.obj(host.name + 'Rows'))
    if scatter is not None:
        sc = GR.Scatter(rng, S, zones)
        bvh = GR.bvh_of([host] + list(bvh_extra))
        runs = scatter if isinstance(scatter, (list, tuple)) else [scatter]
        for kw in runs:
            kw = dict(kw)
            kw.setdefault('center', center)
            sc.run(host, bvh=bvh, **kw)
        stats['greebles'] = dict(sc.count)
        if sc.kit.tris:
            host = _join_kit(host, sc.kit.obj(host.name + 'Greebles'))
    return host, stats


def _join_kit(host, kob):
    """Join a greeble object into host (host keeps its name, transform and
    COLOR_0; the kit is moved into host-local space)."""
    if host.data.color_attributes.get('Col') is not None:
        GR.ensure_col(kob)
    mw = host.matrix_world.copy()
    if mw != Matrix.Identity(4):
        kob.data.transform(mw.inverted())
    name = host.name
    with_bpy = __import__('bpy')
    with with_bpy.context.temp_override(active_object=host, object=host, selected_objects=[host, kob],
                                        selected_editable_objects=[host, kob]):
        with_bpy.ops.object.join()
    host.name = name
    return host


def post_dress(host, seed, style, zones=None, bvh_extra=(), weather_cfg=None, **dress_kw):
    """Detail pass on an already FINISHED mesh node (faces on the AF_Palette
    atlas, any transform): greebles/panels/rows in the node's local space,
    then AO/grime into COLOR_0 (multiplied into an existing 'Col') and the
    new faces baked to the atlas.  zones are in the node's LOCAL space."""
    import bpy
    bpy.context.view_layer.update()      # matrix_world is stale after setting location (README gotcha)
    rng = random.Random(seed)
    extra = []
    inv = host.matrix_world.inverted()
    for o in bvh_extra:      # other nodes, brought into host-local space for ray tests / AO
        if o is None or o.type != 'MESH':
            continue
        c = o.copy()
        c.data = o.data.copy()
        c.parent = None
        c.matrix_world = inv @ o.matrix_world
        __import__('bpy').context.scene.collection.objects.link(c)
        extra.append(c)
    mw = host.matrix_world.copy()
    host.matrix_world = Matrix.Identity(4)
    parent = host.parent
    host, stats = dress(host, rng, style, zones or GR.Zones(), bvh_extra=extra, **dress_kw)
    wc = dict(weather_cfg or {})
    GR.weather(host, rng, extra=extra, existing=host.data.color_attributes.get('Col') is not None, **wc)
    import bpy
    for c in extra:
        bpy.data.objects.remove(c)
    import paths
    G.finalize(host, paths.ATLAS)
    host.parent = parent
    host.matrix_world = mw
    stats['tris'] = G.tri_count(host)
    return host, stats


# ----------------------------------------------------------------------------
# caged beacon lamp (batch D, audit I9): replaces the bare glossy sphere.
# The lamp (ribbed Fresnel lens) is the `beacon_<i>` node the game blinks; the
# housing (base, collar, cage bars, top ring + cross) joins the static mesh.
# ----------------------------------------------------------------------------
CAGE_LIFT = 0.25          # lamp centre above the mounting surface


def beacon_lamp(name, key, s=1.0):
    """Ribbed Fresnel lens around the node origin (s = +1 upright, -1 hanging)."""
    prof = [(-0.1, 0.0), (-0.1, 0.1), (-0.05, 0.122), (-0.02, 0.104), (0.02, 0.12), (0.05, 0.104),
            (0.095, 0.092), (0.14, 0.0)]
    prof = [(s * a, r) for a, r in prof]
    if s < 0:
        prof = list(reversed(prof))
    return G.lathe(name, prof, [0] * (len(prof) - 1), [key], axis='Z', verts=8, closed=False, smooth=False)


def cage_housing(name, loc, s=1.0, stalk=0.0):
    """Housing around a lamp centred at `loc` (s = +1: base below, -1: hanging
    from a ceiling).  stalk > 0 adds a post of that length under the base."""
    x, y, z = loc
    out = []

    def zr(a, b):          # z range a..b in lamp space -> world, ordered
        za, zb = z + s * a, z + s * b
        return min(za, zb), max(za, zb)

    z0, z1 = zr(-0.25, -0.185)
    out.append(G.cyl(name + 'Base', 0.2, z1 - z0, 'hull_dark', loc=(x, y, (z0 + z1) / 2), verts=8, smooth=False))
    z0, z1 = zr(-0.205, -0.19)
    out.append(G.ring_band(name + 'Band', 0.205, 0.16, z0, z1, 'accent_iron', loc=(x, y, 0), verts=8, smooth=False))
    z0, z1 = zr(-0.185, -0.09)
    out.append(G.cyl(name + 'Collar', 0.135, z1 - z0, 'hull_mid', loc=(x, y, (z0 + z1) / 2), verts=8, smooth=False))
    z0, z1 = zr(-0.1, 0.15)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        bx, by = x + 0.163 * math.cos(a), y + 0.163 * math.sin(a)
        b = G.box(f'{name}Bar{k}', -0.017, 0.017, -0.017, 0.017, z0, z1, 'hull_dark')
        G.transform(b, loc=(bx, by, 0), rot=(0, 0, 45 + 90 * k))
        out.append(b)
    z0, z1 = zr(0.135, 0.165)
    out.append(G.ring_band(name + 'Ring', 0.185, 0.145, z0, z1, 'hull_dark', loc=(x, y, 0), verts=8, smooth=False))
    z0, z1 = zr(0.15, 0.178)
    for k in range(2):
        b = G.box(f'{name}X{k}', -0.17, 0.17, -0.016, 0.016, z0, z1, 'hull_dark')
        G.transform(b, loc=(x, y, 0), rot=(0, 0, 45 + 90 * k))
        out.append(b)
    z0, z1 = zr(0.165, 0.2)
    out.append(G.cyl(name + 'Cap', 0.045, z1 - z0, 'hull_mid', loc=(x, y, (z0 + z1) / 2), verts=6, smooth=False))
    if stalk > 0:
        z0, z1 = zr(-0.25 - stalk, -0.245)
        out.append(G.cyl(name + 'Stalk', 0.05, z1 - z0, 'hull_mid', loc=(x, y, (z0 + z1) / 2), verts=6,
                         smooth=False))
    return out


def _surface(bvh, loc, up):
    """Nearest mounting surface for a beacon at loc: below (up=True, a face
    looking up within -0.45..+0.3 of loc.z) or above (up=False).  Returns z or None."""
    x, y, z = loc
    d = Vector((0, 0, -1)) if up else Vector((0, 0, 1))
    o = Vector((x, y, z + (0.45 if up else -0.45)))
    for _ in range(8):
        hit = bvh.ray_cast(o, d, 1.3)
        if hit[0] is None:
            return None
        p, n = hit[0], hit[1]
        if up and n.z > 0.5 and p.z <= z + 0.3:
            return p.z
        if not up and n.z < -0.5 and p.z >= z - 0.3:
            return p.z
        o = p + d * 0.003
    return None


def place_caged_beacons(host, beacons, seed=7):
    """Mount a caged housing for every (loc, key) beacon on the nearest surface
    of `host` (joined static mesh, identity transform).  Returns
    (housing object weathered with COLOR_0 or None, [(lamp_loc, key, s)])."""
    bvh = GR.bvh_of([host])
    parts, lamps = [], []
    for i, (loc, key) in enumerate(beacons):
        x, y, z = loc
        zs = _surface(bvh, loc, True)
        if zs is not None:
            s, lz, stalk = 1.0, zs + CAGE_LIFT, 0.0
        else:
            zc = _surface(bvh, loc, False)
            if zc is not None:
                s, lz, stalk = -1.0, zc - CAGE_LIFT, 0.0
            else:     # free-standing: a short post down to whatever is below (if anything)
                hit = bvh.ray_cast(Vector((x, y, z - 0.25)), Vector((0, 0, -1)), 3.0)
                s, lz = 1.0, z
                stalk = (hit[3] - 0.005) if hit[0] is not None else 0.0
        parts += cage_housing(f'Cage{i}', (x, y, lz), s, stalk)
        lamps.append(((x, y, lz), key, s))
    if not parts:
        return None, lamps
    ob = G.join(parts, host.name + 'Cages')
    GR.weather(ob, random.Random(seed), extra=[host], near=0.2, far=1.0, grime=0.2)
    return ob, lamps


def finish(name, static, atlas_dir, R, beacons=(), rotor=None, rotor_loc=(0, 0, 0), style='home', seed=1,
           zones=None, rotor_zones=None, static_cfg=None, rotor_cfg=None, weather_cfg=None, extra_nodes=(),
           beacon='sphere'):
    """Station-style finish: static root + optional ring_rotor + beacon_<i> +
    dock_port (R > 0).  *_cfg: kwargs for dress().  Returns (root, stats).
    beacon='cage' (batch D): caged lamp housings mounted on the nearest surface
    (the housing joins the static mesh after dress/weather, so the greeble RNG
    is unchanged); 'sphere' = the old bare sphere."""
    rng = random.Random(seed)
    root = G.join(static, name)
    ro = G.join(rotor, 'ring_rotor') if rotor else None
    zones = zones or GR.Zones()
    stats = {}
    root, stats['static'] = dress(root, rng, style, zones, bvh_extra=[ro] if ro else (), **(static_cfg or {}))
    if ro is not None:
        ro, stats['rotor'] = dress(ro, rng, style, rotor_zones or GR.Zones(), bvh_extra=[root], **(rotor_cfg or {}))
        ro.name = 'ring_rotor'
    root.name = name
    wc = dict(weather_cfg or {})
    GR.weather(root, rng, extra=[ro] if ro else (), **wc)
    if ro is not None:
        GR.weather(ro, rng, extra=[root], **wc)
    lamps = None
    if beacon == 'cage' and beacons:
        cages, lamps = place_caged_beacons(root, beacons, seed=seed + 7)
        if cages is not None:
            root = _join_kit(root, cages)
            root.name = name
    G.finalize(root, atlas_dir)
    if ro is not None:
        G.finalize(ro, atlas_dir)
        ro.data.transform(Matrix.Translation([-c for c in rotor_loc]))
        ro.location = rotor_loc
        ro.parent = root
    if lamps is not None:
        for i, (loc, key, s) in enumerate(lamps):
            b = beacon_lamp(f'beacon_{i}', key, s)
            G.finalize(b, atlas_dir)
            GR.ensure_col(b)
            b.location = loc
            b.parent = root
    else:
        for i, (loc, key) in enumerate(beacons):
            b = G.ellipsoid(f'beacon_{i}', 0.24, 0.24, 0.24, key, seg=10, rings=6)
            G.finalize(b, atlas_dir)
            GR.ensure_col(b)
            b.location = loc
            b.parent = root
    for nd in extra_nodes:
        if nd.type == 'MESH':
            GR.ensure_col(nd)
        nd.parent = root
    if R:
        dp = G.empty('dock_port', loc=(R, 0, 0), size=0.6)
        dp.parent = root
    stats['tris'] = sum(G.tri_count(o) for o in [root] + list(root.children_recursive) if o.type == 'MESH')
    print('DTL', name, stats)
    return root, stats
