"""Space anomalies (M3.5b, spec 5.3: gravitational, ionic, radiation, time
echo).  Scannable POIs; the game adds sprite VFX / distortion on top.  All
use the AF_Palette (anom_* swatches, opaque + emissive - no transparency).
Origin = anomaly centre on the gameplay plane, ~8-11 units across.

anomaly_gravity.glb   dark void sphere, hot accretion disk, debris belt
    Anomaly_Gravity        static: void core, photon ring, lensing rings
      Anomaly_Disk         accretion disk, spin around local +Y (glTF), fast
      Anomaly_Debris       orbiting rock belt, spin around local +Y, slow
anomaly_ion.glb       cyan plasma knot inside three gyroscopic charge rings
    Anomaly_Ion            static: plasma knot + halo
      Anomaly_Ring_0..2    tilted rings with charge nodes, spin around their
                           local axis (each tilted differently)
      Anomaly_Shards       orbiting charged plates
anomaly_radiation.glb hot meteorite overgrown with toxic-green crystals
    Anomaly_Radiation      static: rock + crystal clusters
      Anomaly_Ring_0/1     concentric rings of floating crystal shards
                           (spin, opposite directions)
anomaly_time.glb      "time echo": a rock frozen mid-shatter, each fragment
                      trailed by fading ghost copies, inside a clock ring
    Anomaly_Time           static: frozen fragments + ghosts + golden spark
      Anomaly_Ring_0       12-tick clock ring (step-rotate in code)
      Anomaly_Ring_1       tilted counter ring
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from lib import geo as G
import asteroid_styles as S


def disk(name, r0, r1, rings, key, verts=48, thick=0.0):
    """Flat annulus with a radial gradient (af_grad 1 at r0 -> 0 at r1)."""
    bm = bmesh.new()
    rows = []
    for i in range(rings + 1):
        r = r0 + (r1 - r0) * i / rings
        rows.append([bm.verts.new((r * math.cos(2 * math.pi * k / verts), r * math.sin(2 * math.pi * k / verts),
                                   thick * math.sin(k * 1.3 + i))) for k in range(verts)])
    for A, B in zip(rows[:-1], rows[1:]):
        for k in range(verts):
            j = (k + 1) % verts
            bm.faces.new((A[k], A[j], B[j], B[k]))
    # back side so it is visible from below too (assets cull back faces)
    back = bmesh.ops.duplicate(bm, geom=list(bm.faces))
    bfaces = [f for f in back['geom'] if isinstance(f, bmesh.types.BMFace)]
    bmesh.ops.reverse_faces(bm, faces=bfaces)
    bmesh.ops.translate(bm, vec=(0, 0, -0.01), verts=[v for v in back['geom'] if isinstance(v, bmesh.types.BMVert)])
    ob = _obj_no_recalc(name, bm, key, r0, r1)
    return ob


def _obj_no_recalc(name, bm, key, r0, r1):
    """obj_from_bm recalculates normals (would flip the double-sided disk);
    build the object directly instead."""
    from lib import materials as M
    layer = bm.verts.layers.float.new(G.GRAD_ATTR)
    for v in bm.verts:
        v[layer] = max(0.0, min(1.0, 1 - (v.co.xy.length - r0) / (r1 - r0)))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M.mat(key))
    ob = bpy.data.objects.new(name, me)
    G.link(ob)
    G.set_smooth(ob, False)
    return ob


def rock(name, rng, r, key='st_rock_ti', subdiv=2, cuts=2):
    bm = S.sculpt_bm(rng, r, subdiv=subdiv, amp=0.3, detail=0.3, lobes=(1, 1), craters=(0, 0))
    S.planar_cuts(bm, rng, cuts, depth=(0.6, 0.8))
    ob = G.obj_from_bm(name, bm, [key])
    G.set_smooth(ob, False)
    return ob


def crystal(name, L, w, key, sides=6, tip=0.35):
    return S.crystal(name, L, w, key, sides=sides, tip=tip)


def _rand_dir(rng):
    return S._rand_dir(rng)


def _node(parts, name, atlas_dir, parent, loc=(0, 0, 0), rot=(0, 0, 0)):
    ob = G.join(parts, name)
    G.finalize(ob, atlas_dir)
    ob.location = loc
    ob.rotation_euler = [math.radians(a) for a in rot]
    ob.parent = parent
    return ob


# ----------------------------------------------------------------------------
def build_gravity(atlas_dir, seed=31):
    rng = random.Random(seed)
    st = [G.ellipsoid('Void', 1.3, 1.3, 1.3, 'anom_void', seg=24, rings=14)]
    st.append(G.torus('PhotonRing', 1.42, 0.05, 'anom_accretion', maj=40, mnr=4, rot=(90, 0, 0)))
    st.append(G.torus('PhotonRingB', 1.42, 0.04, 'anom_accretion', maj=40, mnr=4, rot=(90, 0, 90)))
    for k, (R_, rot) in enumerate(((2.3, (70, 0, 20)), (4.9, (12, -8, 0)), (3.4, (-55, 0, 60)))):
        st.append(G.torus(f'Lens{k}', R_, 0.035, 'anom_grav', maj=56, mnr=4, rot=rot))
    root = G.join(st, 'Anomaly_Gravity')
    G.finalize(root, atlas_dir)
    # accretion disk (tilted 16 deg so it reads in 3D from the game camera)
    d = disk('Disk', 1.55, 2.75, 3, 'anom_accretion', verts=48)
    d1 = disk('DiskMid', 2.95, 3.55, 2, 'anom_accretion', verts=48)
    d2 = disk('DiskOuter', 3.8, 4.1, 1, 'anom_grav', verts=48)
    _node([d, d1, d2], 'Anomaly_Disk', atlas_dir, root, rot=(16, 0, 0))
    # debris belt in the same plane
    deb = []
    for i in range(26):
        a = 2 * math.pi * i / 26 + rng.uniform(-0.1, 0.1)
        R_ = rng.uniform(4.7, 5.6)
        rk = rock(f'Deb{i}', rng, rng.uniform(0.12, 0.34), subdiv=1, cuts=1)
        G.transform(rk, loc=(R_ * math.cos(a), R_ * math.sin(a), rng.uniform(-0.25, 0.25)),
                    rot=[rng.uniform(0, 360) for _ in range(3)])
        deb.append(rk)
    _node(deb, 'Anomaly_Debris', atlas_dir, root, rot=(16, 0, 0))
    return root


def build_ion(atlas_dir, seed=37):
    rng = random.Random(seed)
    st = [G.ellipsoid('Knot', 0.85, 0.85, 0.85, 'anom_ion', seg=16, rings=10)]
    # spiky plasma burst: crystals pointing out of the knot
    for i in range(14):
        d = _rand_dir(rng)
        c = crystal(f'Spike{i}', rng.uniform(0.9, 1.6), 0.13, 'anom_ion', sides=4, tip=0.6)
        S.align(c, d * 0.5, d)
        st.append(c)
    st.append(G.torus('Halo', 1.25, 0.04, 'anom_ion', maj=32, mnr=4))
    root = G.join(st, 'Anomaly_Ion')
    G.finalize(root, atlas_dir)
    for k, (R_, rot) in enumerate(((2.3, (65, 0, 0)), (2.9, (-40, 30, 70)), (3.5, (15, -20, -40)))):
        parts = [G.torus(f'Ring{k}', R_, 0.07, 'metal_bare', maj=48, mnr=6),
                 G.torus(f'RingGlow{k}', R_, 0.11, 'anom_ion', maj=48, mnr=4)]
        parts[1].scale = (1, 1, 0.25)
        for j in range(4):   # charge nodes
            a = math.radians(j * 90 + k * 20)
            parts.append(G.ellipsoid(f'Node{k}{j}', 0.17, 0.17, 0.17, 'anom_ion', loc=(R_ * math.cos(a),
                                     R_ * math.sin(a), 0), seg=10, rings=6))
            parts.append(G.cyl(f'NodeCap{k}{j}', 0.2, 0.12, 'trim_black', loc=(R_ * math.cos(a), R_ * math.sin(a), 0),
                               verts=8))
        _node(parts, f'Anomaly_Ring_{k}', atlas_dir, root, rot=rot)
    sh = []
    for i in range(10):
        a = 2 * math.pi * i / 10 + rng.uniform(-0.15, 0.15)
        R_ = rng.uniform(4.2, 5.0)
        pts = [(0.32 * math.cos(math.radians(60 * j)), 0.32 * math.sin(math.radians(60 * j))) for j in range(6)]
        p = G.prism(f'Plate{i}', pts, -0.04, 0.04, 'trim_black', top_mat='metal_bare')
        e = G.ring_band(f'PlateEdge{i}', 0.36, 0.3, -0.05, 0.05, 'anom_ion', verts=6)
        for o in (p, e):
            G.transform(o, loc=(R_ * math.cos(a), R_ * math.sin(a), rng.uniform(-0.6, 0.6)),
                        rot=(rng.uniform(-50, 50), rng.uniform(-50, 50), rng.uniform(0, 360)))
        sh += [p, e]
    _node(sh, 'Anomaly_Shards', atlas_dir, root)
    return root


def build_radiation(atlas_dir, seed=41):
    rng = random.Random(seed)
    core = rock('Meteor', rng, 2.1, key='st_rock_iron', subdiv=3, cuts=3)
    S.decimate(core, ratio=0.3)
    pieces = [core]
    for ci, (p, n) in enumerate(S.surface_points(core, rng, 8, 2.1, spacing=0.35)):
        for j in range(rng.randint(4, 6)):
            L = rng.uniform(1.0, 2.0) * (1.0 if j == 0 else 0.6)
            c = crystal(f'Cr{ci}{j}', L, L * 0.22, 'anom_rad', sides=6)
            d = (n + Vector([rng.uniform(-0.5, 0.5) for _ in range(3)]) * (j > 0)).normalized()
            S.align(c, p - n * 0.1, d)
            pieces.append(c)
    root = G.join(pieces, 'Anomaly_Radiation')
    G.finalize(root, atlas_dir)
    S.vertex_colours(root, 'iron', [], 2.1, rng, samples=10, facet=True)
    for k, (R_, n, tilt) in enumerate(((3.6, 14, 8), (4.8, 20, -6))):
        parts = []
        for i in range(n):
            a = 2 * math.pi * i / n + rng.uniform(-0.08, 0.08)
            L = rng.uniform(0.35, 0.7)
            c = crystal(f'Sh{k}{i}', L, L * 0.25, 'anom_rad', sides=4, tip=0.5)
            d = Vector((math.cos(a), math.sin(a), rng.uniform(-0.4, 0.4))).normalized()
            S.align(c, Vector((R_ * math.cos(a), R_ * math.sin(a), rng.uniform(-0.3, 0.3))), d)
            parts.append(c)
        parts.append(G.torus(f'Pulse{k}', R_, 0.03, 'anom_rad', maj=64, mnr=4))
        _node(parts, f'Anomaly_Ring_{k}', atlas_dir, root, rot=(tilt, 0, 0))
    return root


def build_time(atlas_dir, seed=43):
    rng = random.Random(seed)
    st = [G.ellipsoid('Spark', 0.35, 0.35, 0.35, 'anom_time', seg=12, rings=8)]
    # a rock frozen mid-shatter: fragments flung outward, each trailed by 2
    # shrinking ghost copies toward the centre (the "echo" of the moment)
    for i in range(16):
        d = _rand_dir(rng)
        d.z *= 0.5
        d.normalize()
        dist = rng.uniform(1.0, 3.0)
        size = rng.uniform(0.25, 0.55)
        rot = [rng.uniform(0, 360) for _ in range(3)]
        frag = rock(f'Frag{i}', rng, size, key='st_rock_ti', subdiv=1, cuts=2)
        G.transform(frag, loc=d * dist, rot=rot)
        st.append(frag)
        for g in (1, 2):
            gh = frag.copy()
            gh.data = frag.data.copy()
            gh.name = f'Ghost{i}_{g}'
            bpy.context.scene.collection.objects.link(gh)
            gh.data.materials.clear()
            from lib import materials as M
            gh.data.materials.append(M.mat('anom_time_ghost' if g == 1 else 'anom_time'))
            s_ = 1.0 - 0.28 * g
            G.transform(gh, loc=d * (dist - 0.42 * g * size * 2.2), rot=[r_ - 9 * g for r_ in rot], scale=(s_, s_, s_))
            st.append(gh)
    root = G.join(st, 'Anomaly_Time')
    G.finalize(root, atlas_dir)
    # clock ring: 12 tick segments, every third longer
    parts = []
    for i in range(12):
        a0 = i * 30 + 3
        long_ = i % 3 == 0
        steps = 4
        secs = []
        for j in range(steps + 1):
            a = math.radians(a0 + 24 * j / steps)
            rad = Vector((math.cos(a), math.sin(a), 0))
            w, h = (0.34 if long_ else 0.22), 0.12
            secs.append([rad * (4.3 - w / 2) - Vector((0, 0, h / 2)), rad * (4.3 + w / 2) - Vector((0, 0, h / 2)),
                         rad * (4.3 + w / 2) + Vector((0, 0, h / 2)), rad * (4.3 - w / 2) + Vector((0, 0, h / 2))])
        import kovaci as K
        parts.append(K.loft(f'Tick{i}', secs, 'anom_time' if long_ else 'anom_time_ghost'))
    parts.append(G.torus('ClockHair', 4.3, 0.025, 'anom_time', maj=72, mnr=4))
    _node(parts, 'Anomaly_Ring_0', atlas_dir, root, rot=(10, 0, 0))
    parts = [G.torus('Counter', 3.1, 0.05, 'anom_time_ghost', maj=56, mnr=4)]
    for i in range(3):
        a = math.radians(i * 120)
        parts.append(G.ellipsoid(f'Bead{i}', 0.14, 0.14, 0.14, 'anom_time', loc=(3.1 * math.cos(a), 3.1 * math.sin(a), 0),
                                 seg=8, rings=5))
    _node(parts, 'Anomaly_Ring_1', atlas_dir, root, rot=(-62, 0, 25))
    return root


BUILDERS = {'anomaly_gravity': build_gravity, 'anomaly_ion': build_ion,
            'anomaly_radiation': build_radiation, 'anomaly_time': build_time}
