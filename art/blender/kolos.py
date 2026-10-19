"""Rezonancny kolos (spec 6.5, M5a boss, ring-3 crystal field behind a warden
patrol).  A colossal Forge-smith construct overgrown by singing crystal: three huge
obsidian claw-blades (3-fold) cradle a violet crystal heart, two bronze rings
float around it, three green warden eyes sit at the blade tips.  Its WEAK
POINTS are crystal outcrops carrying SINGING VEINS - the player shoots them
with the mining laser on the tone peak (spec 2.1.1 / 6.5), so they reuse the
asteroid vein format (TEXCOORD_1 VeinUV) and the same shader.

kolos.glb  ~27 x 25 x 12 units, origin = centre on the gameplay plane.
AF_Palette + COLOR_0 (the outcrops carry rock vertex colour) -> export with
vertex colours.
  Colossus                  static: three claw blades, bronze inlays, base shards
    Kolos_Glyphs         ember glyph inlays (pulse; flare when a weak point dies)
    Kolos_Heart          crystal heart cluster; pivot (0, 0, 0.6); pulse / slow spin
                         around local +Y (glTF); exposed core of the fight
    Kolos_Ring_0 / _1    floating segmented rings around the heart; spin around
                         local +Y in opposite directions (ring 1 tilted 10 deg)
    weak_0..4            DESTROYABLE crystal outcrops (one per blade + two on the
                         heart base); children Vein_w<i>_<k> = singing vein fills
                         (TEXCOORD_1 VeinUV, same as asteroid Vein_<k>)
    emitter_0..2         EMPTY at each warden eye on the blade tips: telegraphed
                         beam turrets; local +X = outward rest aim
    spawn_0..2           EMPTY between the blades: Roj swarm launch points
                         (launch along local +X)
Layout: LAYOUTS['kolos'] -> art/blender/data/boss_layouts.json (circles,
weakPoints with their vein polylines in the weak node's frame, emitters, spawns,
heart, clearRadius).
"""
import math
import random

from mathutils import Matrix, Vector

from lib import geo as G
import kovaci as K
import asteroids as A
import veins as V

BLADE_ANG = (90.0, 210.0, 330.0)
HEART_Z = 0.6


def _blade_frame(t, ang):
    a = math.radians(ang)
    d = Vector((math.cos(a), math.sin(a), 0))
    s = Vector((-d.y, d.x, 0))
    r = 2.6 + 10.0 * t
    z = -0.6 + 4.2 * t ** 2.2
    tw = math.radians(14 * t)        # slight twist along the blade
    s2 = s * math.cos(tw) + Vector((0, 0, 1)) * math.sin(tw)
    up = s.cross(d) if s.cross(d).z > 0 else -s.cross(d)
    up = (up * math.cos(tw) - s * math.sin(tw)).normalized()
    return d * r + Vector((0, 0, z)), d, s2, up


def _blade(name, ang, steps=12):
    secs = []
    for i in range(steps + 1):
        t = i / steps
        c, d, s, up = _blade_frame(t, ang)
        w = 2.4 * (1 - t) ** 0.55 + 0.12
        th = 1.1 * (1 - t) + 0.14
        secs.append([c + s * w, c + up * th, c - s * w, c - up * th * 0.55])
    return K.loft(name, secs, 'kov_obsidian')


def _edge(name, ang, side, out, steps=10):
    pts = []
    for i in range(steps + 1):
        t = 0.03 + 0.9 * i / steps
        c, d, s, up = _blade_frame(t, ang)
        w = 2.4 * (1 - t) ** 0.55 + 0.12
        pts.append(c + s * w * side + up * 0.04)
    for k in range(len(pts) - 1):
        out.append(K.bar(f'{name}{k}', pts[k], pts[k + 1], 0.16, 'kov_bronze'))


def _glyphs(name, ang, out):
    t = 0.06
    k = 0
    pat = (0.07, 0.025, 0.025)
    while t < 0.86:
        L = pat[k % 3]
        a0, a1 = t, min(0.9, t + L)
        c0, _, _, u0 = _blade_frame(a0, ang)
        c1, _, _, u1 = _blade_frame(a1, ang)
        th0 = 1.1 * (1 - a0) + 0.14
        th1 = 1.1 * (1 - a1) + 0.14
        out.append(K.bar(f'{name}{k}', c0 + u0 * (th0 + 0.03), c1 + u1 * (th1 + 0.03), 0.2 * (1 - 0.5 * a0), 'kov_ember'))
        t = a1 + (0.05 if k % 3 == 2 else 0.02)
        k += 1


# weak points: (t along blade or None = heart base, blade angle / polar angle, radius of the outcrop, seed)
WEAK = [(0.38, 90.0, 1.7, 601), (0.38, 210.0, 1.7, 607), (0.38, 330.0, 1.7, 613),
        (None, 150.0, 1.35, 619), (None, 30.0, 1.35, 631)]
CIRCLES = [(0.0, 0.0, 4.4)]
for _a in BLADE_ANG:
    for _r, _rr in ((5.8, 2.6), (8.4, 2.0), (10.8, 1.5), (12.6, 1.0)):
        CIRCLES.append((round(_r * math.cos(math.radians(_a)), 2), round(_r * math.sin(math.radians(_a)), 2), _rr))
for _a in (30.0, 150.0, 270.0):   # floating ring segments between the blades
    CIRCLES.append((round(6.4 * math.cos(math.radians(_a)), 2), round(6.4 * math.sin(math.radians(_a)), 2), 1.2))
LAYOUTS = {'kolos': dict(circles=CIRCLES, clearRadius=24.0)}
_INFO = {}


def build(atlas_dir, seed=4040):
    rng = random.Random(seed)
    st, gl = [], []
    for k, ang in enumerate(BLADE_ANG):
        st.append(_blade(f'Blade{k}', ang))
        _edge(f'EdgeL{k}_', ang, 1, st)
        _edge(f'EdgeR{k}_', ang, -1, st)
        _glyphs(f'Glyph{k}_', ang, gl)
    # central obsidian hub (hexagonal drum with a bronze rim) under the heart
    hub = [(3.0 * math.cos(math.radians(30 + 60 * i)), 3.0 * math.sin(math.radians(30 + 60 * i))) for i in range(6)]
    st.append(G.prism('Hub', hub, -1.6, 0.5, 'kov_obsidian', bevel=0.1, seg=1))
    for i in range(6):
        a0, a1 = hub[i], hub[(i + 1) % 6]
        st.append(K.bar(f'HubRim{i}', (a0[0], a0[1], 0.52), (a1[0], a1[1], 0.52), 0.18, 'kov_bronze'))
        m = ((a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2)
        n = Vector((m[0], m[1], 0)).normalized()
        gl.append(K.bar(f'HubGl{i}', Vector((m[0], m[1], -0.4)) + n * 0.05 - Vector((n.y, -n.x, 0)) * 0.6,
                        Vector((m[0], m[1], -0.4)) + n * 0.05 + Vector((n.y, -n.x, 0)) * 0.2, 0.16, 'kov_ember'))
    # floating base shards below the hub (levitating, split)
    for i in range(3):
        a0 = i * 120 + 30
        pts = [(0.0, 0.0)] + [(3.6 * math.cos(math.radians(a)), 3.6 * math.sin(math.radians(a)))
                              for a in (a0 - 50, a0, a0 + 50)]
        cx = sum(p[0] for p in pts) / 4
        cy = sum(p[1] for p in pts) / 4
        pts = [(cx + (x - cx) * 0.86, cy + (y - cy) * 0.86) for x, y in pts]
        z0 = -3.2 - 0.25 * i
        st.append(G.prism(f'Shard{i}', pts, z0, z0 + 0.8, 'kov_obsidian', bevel=0.06, seg=1))
        keel = [Vector((x, y, z0 + 0.01)) for x, y in pts]
        st.append(K.loft(f'Keel{i}', [keel, [Vector((cx + (p.x - cx) * 0.2, cy + (p.y - cy) * 0.2, z0 - 1.8))
                                              for p in keel]], 'kov_obsidian'))
    # warden eyes at the blade tips (static mesh) + their emitter empties
    emit = []
    for k, ang in enumerate(BLADE_ANG):
        c, d, s, up = _blade_frame(0.97, ang)
        eye = K.octa(f'Eye{k}', 0.42, 0.8, 'kov_warden')
        G.apply_modifiers(eye)
        eye.data.transform(Matrix.Translation(c + d * 0.5) @ (Vector((0, 0, 1)).rotation_difference(d)).to_matrix().to_4x4())
        st.append(eye)
        for j, sgn in enumerate((1, -1)):
            pr = K.bar(f'EyeProng{k}{j}', c - d * 0.6 + s * 0.6 * sgn, c + d * 0.9 + s * 0.25 * sgn, 0.14, 'kov_bronze')
            st.append(pr)
        emit.append((c + d * 1.1, ang))
    root = G.join(st, 'Kolos')
    G.finalize(root, atlas_dir)
    G.set_smooth(root, False)
    glyph = G.join(gl, 'Kolos_Glyphs')
    G.finalize(glyph, atlas_dir)
    glyph.parent = root
    # crystal heart (pivot on the axis)
    hp = [K.crystal_column('HeartMain', 1.25, -0.5, 8.4, mat='st_ore_crystal')]
    for i in range(6):
        a = math.radians(i * 60 + 15)
        col = K.crystal_column(f'HeartCol{i}', 0.6 + 0.15 * (i % 2), -0.3, 4.0 + 1.6 * ((i * 3) % 4) / 3,
                               mat='st_ore_crystal')
        G.apply_modifiers(col)
        lean = Matrix.Rotation(math.radians(22 + 6 * (i % 3)), 4, Vector((-math.sin(a), math.cos(a), 0)))
        col.data.transform(Matrix.Translation((1.35 * math.cos(a), 1.35 * math.sin(a), 0)) @ lean)
        hp.append(col)
    heart = G.join(hp, 'Kolos_Heart')
    G.finalize(heart, atlas_dir)
    G.set_smooth(heart, False)
    heart.location = (0, 0, HEART_Z)
    heart.parent = root
    # floating rings
    for k, (R_, z, n, tilt) in enumerate(((4.6, 3.4, 6, 0.0), (6.6, 1.6, 7, 10.0))):
        ring, rgl = K.seg_ring(f'Ring{k}', R_, 0.0, n, 8.0, 0.55 - 0.1 * k, 0.32)
        ob = G.join(ring + rgl, f'Kolos_Ring_{k}')
        G.finalize(ob, atlas_dir)
        ob.location = (0, 0, z)
        ob.rotation_euler = (math.radians(tilt), 0, 0)
        ob.parent = root
    # weak points: crystal outcrops with a singing vein each
    weak = []
    for i, (t, ang, rad, sd) in enumerate(WEAK):
        ob = A.build(f'weak_{i}', 'crystal', sd, rad, atlas_dir, 'chunky' if t is not None else 'round', veins=True)
        vs = A.VEINS[f'weak_{i}']
        for ch in sorted(ob.children, key=lambda c: c.name):
            if ch.name.startswith('Vein_'):
                ch.name = f'Vein_w{i}_{ch.name.split(".")[0][5:]}'
        if t is not None:
            c, d, s, up = _blade_frame(t, ang)
            loc = c + up * (1.1 * (1 - t) + 0.14 + rad * 0.15)
            yaw = ang
        else:
            a = math.radians(ang)
            loc = Vector((2.9 * math.cos(a), 2.9 * math.sin(a), 0.7))
            yaw = ang
        ob.location = loc
        ob.rotation_euler = (0, 0, math.radians(yaw))
        ob.parent = root
        weak.append((ob.name, loc, yaw, vs))
    for k, (p, ang) in enumerate(emit):
        e = G.empty(f'emitter_{k}', loc=p, size=0.6)
        e.rotation_euler = (0, 0, math.radians(ang))
        e.parent = root
    spawns = []
    for k, ang in enumerate((30.0, 150.0, 270.0)):
        a = math.radians(ang)
        p = Vector((7.5 * math.cos(a), 7.5 * math.sin(a), 0.0))
        e = G.empty(f'spawn_{k}', loc=p, size=0.6)
        e.rotation_euler = (0, 0, math.radians(ang))
        e.parent = root
        spawns.append((p, ang))
    _INFO.update(weak=weak, emit=emit, spawns=spawns)
    return root


BUILDERS = {'kolos': build}


def _g(v):
    """Blender (x, y, z) -> layout dict in the local frame (z = height above the plane)."""
    return {'x': round(v[0], 3), 'y': round(v[1], 3), 'z': round(v[2], 3)}


def layouts_json():
    """Static data (positions are computed from the same constants as the build)."""
    out = {'_schema': {
        'units': 'game units; local boss frame, +Y = left, gameplay plane z = 0 (z = height above it)',
        'circles': 'list of {x, y, r} collision circles covering the solid structure',
        'weakPoints': 'destroyable weak_<i> nodes: position, yawDeg, outcrop radius, veins = the singing veins on '
                      'it (node Vein_w<i>_<k>; polyline in the weak node frame, glTF coords, same format as '
                      'veins.json entries, type "singing")',
        'emitters': 'beam turret empties emitter_<i>: position + yawDeg (rest aim, outward)',
        'spawns': 'Roj swarm launch empties spawn_<i>: position + yawDeg (launch direction)',
        'heart': 'Kolos_Heart pivot', 'clearRadius': 'no asteroids inside'}}
    weak = []
    for i, (t, ang, rad, sd) in enumerate(WEAK):
        if t is not None:
            c, d, s, up = _blade_frame(t, ang)
            loc = c + up * (1.1 * (1 - t) + 0.14 + rad * 0.15)
        else:
            a = math.radians(ang)
            loc = Vector((2.9 * math.cos(a), 2.9 * math.sin(a), 0.7))
        e = {'node': f'weak_{i}', **_g(loc), 'yawDeg': ang, 'radius': rad}
        vs = A.VEINS.get(f'weak_{i}')
        if vs:
            e['veins'] = V.json_entry(vs, 'crystal')['veins']
            for k, v in enumerate(e['veins']):
                v['node'] = f'Vein_w{i}_{k}'
        weak.append(e)
    emit = []
    for k, ang in enumerate(BLADE_ANG):
        c, d, s, up = _blade_frame(0.97, ang)
        emit.append({'node': f'emitter_{k}', **_g(c + d * 1.1), 'yawDeg': ang})
    spawns = []
    for k, ang in enumerate((30.0, 150.0, 270.0)):
        a = math.radians(ang)
        spawns.append({'node': f'spawn_{k}', **_g((7.5 * math.cos(a), 7.5 * math.sin(a), 0.0)), 'yawDeg': ang})
    out['kolos'] = {'circles': [{'x': x, 'y': y, 'r': r} for x, y, r in CIRCLES], 'weakPoints': weak,
                    'emitters': emit, 'spawns': spawns, 'heart': {'node': 'Kolos_Heart', 'x': 0, 'y': 0, 'z': HEART_Z},
                    'clearRadius': LAYOUTS['kolos']['clearRadius']}
    return out
