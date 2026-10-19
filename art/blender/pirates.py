"""Pirate (Rust clans) structures - M3.6.

hrdzava_pevnost.glb  "Rusty Fortress" boss POI (spec 6.5): a chunky asteroid
  with a scrap-built fortress on a levelled top pad.  ~36 x 30 units,
  origin = fortress centre on the gameplay plane (z = 0), +X = front (launch
  bay), the two shield generators sit BEHIND the rock (-X), as the spec asks
  ("first the generators behind the asteroid, then the core").
  Node layout:
    Hrdzava_Pevnost      static scrap structures (no vertex colours)
      Fortress_Rock      the asteroid (vertex colour COLOR_0, style C)
      fortress_core      destroyable core: a stolen Forge-smith forge relic in a
                         pirate scrap cage; pivot = relic centre
      shield_gen_0/1     destroyable shield generator towers; pivot = tower base
      turret_0..3        EMPTIES = turret mount points (top of the mount ring);
                         local +X points outward (the turret's rest aim)
      spawn_0            EMPTY at the launch-bay mouth on the gameplay plane,
                         +X = launch direction (reinforcements every 45 s)
      beacon_<i>         red / amber emissive lamps (blink in code)
  Collision circles: LAYOUTS['hrdzava_pevnost'] -> art/blender/data/fortress_layouts.json

pirate_beacon.glb  "Vyzva klanu" beacon (spec 6.3, F to challenge the clan),
  ~1.0 x 1.0 x 2.0, origin = centre of the float body.
    Pirate_Beacon        static scrap buoy with clan claw plates
      Beacon_Spin        rotating lamp housing (spin around local +Y in glTF)
        beacon_0         red lamp (blink in code)

Colours: pir_* swatches (= the pirate livery look: dark gunmetal, rust red,
red / amber glows) so these use the DEFAULT AF_Palette textures.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from lib import geo as G
import asteroid_styles as S

PAD = 1.8          # top of the levelled pad (Blender z)
ROCK_R = 9.0

LAYOUTS = {
    'hrdzava_pevnost': dict(circles=[(0.0, 0.0, 9.6), (7.2, 0.0, 3.2), (9.9, 0.0, 3.2),
                                     (-9.6, 5.4, 2.2), (-9.6, -5.4, 2.2),
                                     (6.4, 7.6, 1.8), (6.4, -7.6, 1.8), (-5.2, 9.4, 1.8), (-5.2, -9.4, 1.8)],
                            spawn=(12.6, 0.0)),
}
CLEAR_MARGIN = 14.0


def layouts_json():
    out = {'_schema': {
        'units': 'game units; local fortress frame, +X = front (launch bay), +Y = left, gameplay plane z = 0',
        'circles': 'list of {x, y, r} collision circles covering the solid structure',
        'spawn': '{x, y}: spawn_0 node (reinforcements launch toward +X)',
        'turrets': 'turret mount points {x, y, z, yawDeg} (z = height above the gameplay plane)',
        'shieldGens': '{x, y} of the shield generator towers (destroy first)',
        'core': '{x, y, z} of fortress_core',
        'clearRadius': 'no asteroids inside this radius'}}
    for k, v in LAYOUTS.items():
        out[k] = {'circles': [{'x': x, 'y': y, 'r': r} for x, y, r in v['circles']],
                  'spawn': {'x': v['spawn'][0], 'y': v['spawn'][1]},
                  'turrets': [{'x': round(x, 3), 'y': round(y, 3), 'z': round(z, 3), 'yawDeg': round(a, 1)}
                              for x, y, z, a in TURRETS],
                  'shieldGens': [{'x': x, 'y': y} for x, y in GENS],
                  'core': {'x': 0.0, 'y': 0.0, 'z': CORE_Z},
                  'clearRadius': max(math.hypot(x, y) + r for x, y, r in v['circles']) + CLEAR_MARGIN}
    return out


# turret mounts: (x, y, z, yaw deg) - on platforms at the rock rim
TURRET_ANGLES = (48.0, -48.0, 120.0, -120.0)
TURRET_R = 9.4
TURRET_Z = PAD + 0.95
TURRETS = [(TURRET_R * math.cos(math.radians(a)) - (1.0 if abs(a) > 90 else 0.0) * 0.0,
            TURRET_R * math.sin(math.radians(a)), TURRET_Z, a) for a in TURRET_ANGLES]
GENS = [(-9.6, 5.4), (-9.6, -5.4)]
CORE_Z = PAD + 1.25


# ----------------------------------------------------------------------------
# scrap kit
# ----------------------------------------------------------------------------
SCRAP = ('pir_gunmetal', 'pir_gunmetal', 'pir_plate_worn', 'pir_gunmetal_dark', 'pir_rust')


def plate(name, c, size, rot=(0, 0, 0), mat='pir_gunmetal', bevel=0.04):
    sx, sy, sz = size
    b = G.box(name, -sx / 2, sx / 2, -sy / 2, sy / 2, -sz / 2, sz / 2, mat, bevel=bevel, seg=1)
    G.transform(b, loc=c, rot=rot)
    return b


def strut(name, p0, p1, w, mat='pir_gunmetal_dark'):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    ob = G.box(name, 0.0, d.length, -w / 2, w / 2, -w / 2, w / 2, mat, bevel=min(0.03, w * 0.2), seg=1)
    G.apply_modifiers(ob)
    q = Vector((1, 0, 0)).rotation_difference(d.normalized())
    ob.data.transform(Matrix.Translation(p0) @ q.to_matrix().to_4x4())
    return ob


def truss(name, p0, p1, w=0.5, bar=0.09, mat='pir_gunmetal_dark', n=None):
    """Two-rail girder with zig-zag braces between p0 and p1 (rails offset in
    the horizontal direction perpendicular to the girder)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0)
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-6:
        side = Vector((1, 0, 0))
    side = side.normalized() * w / 2
    out = [strut(name + 'A', p0 + side, p1 + side, bar, mat), strut(name + 'B', p0 - side, p1 - side, bar, mat)]
    n = n or max(2, int(d.length / (w * 1.4)))
    for i in range(n):
        a = p0 + d * (i / n)
        b = p0 + d * ((i + 1) / n)
        out.append(strut(f'{name}Z{i}', a + side * (1 if i % 2 else -1), b + side * (-1 if i % 2 else 1),
                         bar * 0.8, mat))
    return out


def spikes(name, centre, radius, n, z, length, rng, mat='pir_gunmetal_dark'):
    out = []
    for i in range(n):
        a = 2 * math.pi * (i + rng.uniform(-0.2, 0.2)) / n
        p = Vector((centre[0] + radius * math.cos(a), centre[1] + radius * math.sin(a), z))
        dirn = Vector((math.cos(a) * 0.55, math.sin(a) * 0.55, 1.0)).normalized()
        L = length * rng.uniform(0.7, 1.2)
        sp = G.cyl(f'{name}{i}', L * 0.11, L, mat, verts=4, r2=0.0)
        sp.data.transform(Matrix.Translation((0, 0, L / 2)))
        q = Vector((0, 0, 1)).rotation_difference(dirn)
        sp.matrix_world = Matrix.Translation(p) @ q.to_matrix().to_4x4()
        out.append(sp)
    return out


def lamp(name, loc, key, r=0.22):
    b = G.ellipsoid(name, r, r, r, key, seg=10, rings=6)
    b.location = loc
    G.bake_transform(b)
    return b


# ----------------------------------------------------------------------------
# the rock
# ----------------------------------------------------------------------------
def fortress_rock(rng):
    bm = S.sculpt_bm(rng, ROCK_R, subdiv=4, amp=0.22, detail=0.4, lobes=(2, 3), craters=(1, 2),
                     squash=(0.5, 0.56))
    tmp = G.obj_from_bm('tmpRock', bm, ['st_rock_iron'])
    S.decimate(tmp, ratio=0.09)
    bm = bmesh.new()
    bm.from_mesh(tmp.data)
    bpy.data.objects.remove(tmp)
    # level the top into a building pad and the underside a little
    bmesh.ops.translate(bm, vec=(0, 0, -0.6), verts=bm.verts)
    for co, no in (((0, 0, PAD), (0, 0, 1)),):
        res = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                                     plane_co=co, plane_no=no, clear_outer=True)
        edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        bmesh.ops.edgenet_fill(bm, edges=edges)
    S.planar_cuts(bm, rng, 5, depth=(0.86, 0.92))
    rock = G.obj_from_bm('Fortress_Rock', bm, ['st_rock_iron'])
    S.bevel(rock, 0.14, 1, 12, harden=False)
    G.set_smooth(rock, False)
    # rock crags around the rim break the round "cake" silhouette
    crags = [rock]
    for i in range(8):
        a = math.radians(i * 45 + rng.uniform(-12, 12))
        if math.cos(a) > 0.75:          # keep the launch bay clear
            continue
        r = rng.uniform(1.3, 2.1)
        cb = S.sculpt_bm(rng, r, subdiv=2, amp=0.3, detail=0.3, lobes=(1, 1), craters=(0, 0), stretch=1.5,
                         squash=(0.55, 0.7))
        bmesh.ops.transform(cb, matrix=Matrix.Rotation(math.radians(rng.uniform(55, 80)), 4, 'Y'), verts=cb.verts)
        S.planar_cuts(cb, rng, 2, depth=(0.7, 0.85))
        cr = G.obj_from_bm(f'Crag{i}', cb, ['st_rock_iron'])
        S.bevel(cr, 0.08, 1, 15, harden=False)
        R = ROCK_R * rng.uniform(0.86, 0.95)
        G.transform(cr, loc=(R * math.cos(a), R * math.sin(a), PAD - rng.uniform(0.6, 1.4)),
                    rot=(rng.uniform(-15, 15), rng.uniform(-25, 25), math.degrees(a) + rng.uniform(-30, 30)))
        crags.append(cr)
    rock = G.join(crags, 'Fortress_Rock')
    G.set_smooth(rock, False)
    return rock


# ----------------------------------------------------------------------------
# fortress
# ----------------------------------------------------------------------------
def _core_well(st):
    """Armoured well in the pad centre that holds the core."""
    st.append(G.lathe('Well', [(PAD - 0.2, 3.6), (PAD + 0.9, 3.4), (PAD + 1.35, 3.0), (PAD + 1.35, 2.35),
                               (PAD + 0.2, 2.2), (PAD + 0.2, 0.0)],
                      [0, 1, 2, 0, 3], ['pir_gunmetal_dark', 'pir_gunmetal', 'pir_rust', 'trim_black'],
                      axis='Z', verts=12, closed=False, smooth=False))
    for i in range(12):   # buttresses + clamp teeth
        a = i * 30 + 15
        b = plate(f'Buttress{i}', (3.45, 0, PAD + 0.55), (0.9, 0.42, 1.5), mat='pir_rust' if i % 3 == 0 else
                  'pir_gunmetal', bevel=0.06)
        G.transform(b, loc=(3.45 * math.cos(math.radians(a)), 3.45 * math.sin(math.radians(a)), PAD + 0.55),
                    rot=(0, 18, a))
        st.append(b)
    for i in range(6):    # hazard ring segments on the lip
        a = i * 60
        h = plate(f'LipHaz{i}', (0, 0, 0), (0.7, 0.25, 0.08), mat='pir_hazard' if i % 2 else 'trim_black', bevel=0.02)
        G.transform(h, loc=(2.7 * math.cos(math.radians(a)), 2.7 * math.sin(math.radians(a)), PAD + 1.38),
                    rot=(0, 0, a + 90))
        st.append(h)


def build_core(atlas_dir):
    """fortress_core: a stolen Forge-smith forge relic (obsidian + bronze, ember
    heart) clamped into a pirate scrap cage.  Modelled around its pivot."""
    pc = []
    pc.append(G.ellipsoid('Heart', 1.05, 1.05, 1.05, 'kov_ember', seg=16, rings=10))
    # three obsidian blades wrapping the heart (Forge-smith 3-fold language)
    for i in range(3):
        a = i * 120
        bl = G.prism(f'Blade{i}', [(-0.25, -1.55), (0.25, -1.55), (0.34, 0.0), (0.12, 1.75), (-0.12, 1.75),
                                   (-0.34, 0.0)], -0.12, 0.12, 'kov_obsidian', bevel=0.03, seg=1)
        G.transform(bl, loc=(1.12 * math.cos(math.radians(a)), 1.12 * math.sin(math.radians(a)), 0),
                    rot=(90, 0, a + 90))
        pc.append(bl)
        inl = G.prism(f'Inlay{i}', [(-0.06, -1.2), (0.06, -1.2), (0.03, 1.4), (-0.03, 1.4)], -0.13, 0.13,
                      'kov_bronze')
        G.transform(inl, loc=(1.24 * math.cos(math.radians(a)), 1.24 * math.sin(math.radians(a)), 0),
                    rot=(90, 0, a + 90))
        pc.append(inl)
    # pirate cage: two welded hoops + clamps + bolted caps
    pc.append(G.torus('CageHoopA', 1.42, 0.09, 'pir_gunmetal_dark', rot=(0, 0, 0), maj=16, mnr=4, smooth=False))
    pc.append(G.torus('CageHoopB', 1.42, 0.09, 'pir_rust', rot=(90, 0, 30), maj=16, mnr=4, smooth=False))
    pc.append(G.torus('CageHoopC', 1.42, 0.09, 'pir_gunmetal_dark', rot=(90, 0, 150), maj=16, mnr=4, smooth=False))
    for k, z in enumerate((1.3, -1.3)):
        pc.append(G.cyl(f'Cap{k}', 0.42, 0.3, 'pir_gunmetal', loc=(0, 0, z), verts=8, bevel=0.04, seg=1))
    pc.append(G.cyl('Spike', 0.12, 0.9, 'pir_gunmetal_dark', loc=(0, 0, 1.85), verts=4, r2=0.0))
    core = G.join(pc, 'fortress_core')
    G.finalize(core, atlas_dir)
    return core


def _gen_tower(name, atlas_dir):
    """Shield generator tower (modelled around its base, z = 0 = base)."""
    p = []
    p.append(G.cyl('Base', 1.3, 0.6, 'pir_gunmetal_dark', loc=(0, 0, 0.3), verts=8, bevel=0.06, seg=1))
    p.append(G.cyl('Column', 0.55, 4.2, 'pir_gunmetal', loc=(0, 0, 2.6), verts=8, r2=0.4, bevel=0.04, seg=1))
    for k, z in enumerate((1.4, 2.6, 3.8)):
        p.append(G.ring_band(f'Band{k}', 0.62 - k * 0.05, 0.4, z - 0.12, z + 0.12, 'pir_rust' if k % 2 == 0 else
                             'pir_hazard', verts=8, smooth=False))
    for i in range(3):   # bracing legs
        a = math.radians(i * 120 + 30)
        p.append(strut(f'Leg{i}', (1.15 * math.cos(a), 1.15 * math.sin(a), 0.5), (0.35 * math.cos(a), 0.35 * math.sin(a),
                                                                               2.6), 0.16))
    # emitter: three prongs cradling a red orb
    p.append(G.cyl('Neck', 0.5, 0.4, 'pir_gunmetal_dark', loc=(0, 0, 4.9), verts=8))
    for i in range(3):
        a = math.radians(i * 120)
        p.append(strut(f'Prong{i}', (0.35 * math.cos(a), 0.35 * math.sin(a), 5.0),
                       (0.95 * math.cos(a), 0.95 * math.sin(a), 6.3), 0.14, 'pir_rust'))
        p.append(G.cyl(f'ProngTip{i}', 0.12, 0.3, 'pir_glow_red', loc=(0.98 * math.cos(a), 0.98 * math.sin(a), 6.45),
                       verts=6))
    p.append(G.ellipsoid('Orb', 0.62, 0.62, 0.62, 'pir_glow_red', loc=(0, 0, 5.9), seg=14, rings=8))
    p.append(G.torus('OrbRing', 0.9, 0.06, 'pir_glow_red', loc=(0, 0, 5.9), maj=16, mnr=4))
    ob = G.join(p, name)
    G.finalize(ob, atlas_dir)
    return ob


def build_fortress(atlas_dir, seed=4242):
    rng = random.Random(seed)
    rock = fortress_rock(rng)
    st = []
    # ---- pad deck plating (irregular scrap plates on the levelled top) ------
    for i in range(26):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(3.8, 7.2)
        x, y = r * math.cos(a), r * math.sin(a)
        if x > 3.5 and abs(y) < 3.2:
            continue
        st.append(plate(f'Deck{i}', (x, y, PAD + 0.05), (rng.uniform(1.4, 2.6), rng.uniform(1.0, 2.0), 0.18),
                        rot=(0, 0, rng.uniform(0, 180)), mat=rng.choice(SCRAP), bevel=0.04))
    _core_well(st)
    # ---- launch bay (+X): scrap hangar jutting out of the rock -------------
    hx0, hx1, hw, hz0, hz1 = 3.8, 11.0, 2.7, -1.1, 2.8
    st.append(plate('BayBody', ((hx0 + hx1) / 2, 0, (hz0 + hz1) / 2), (hx1 - hx0, 2 * hw, hz1 - hz0),
                    mat='pir_gunmetal', bevel=0.12))
    for k in range(5):   # ribs
        x = hx0 + 1.4 + k * 1.5
        st.append(plate(f'BayRib{k}', (x, 0, (hz0 + hz1) / 2), (0.32, 2 * hw + 0.3, hz1 - hz0 + 0.3),
                        mat='pir_rust' if k % 2 else 'pir_gunmetal_dark', bevel=0.05))
    # mismatched roof patches
    for k in range(7):
        st.append(plate(f'BayPatch{k}', (rng.uniform(hx0 + 1, hx1 - 1), rng.uniform(-hw + 0.8, hw - 0.8), hz1 + 0.08),
                        (rng.uniform(0.9, 1.8), rng.uniform(0.8, 1.6), 0.14), rot=(0, 0, rng.uniform(-14, 14)),
                        mat=rng.choice(('pir_plate_worn', 'pir_rust', 'pir_gunmetal_dark')), bevel=0.03))
    # mouth: frame, dark interior, red light strips, hazard teeth
    st.append(plate('MouthFrame', (hx1 + 0.15, 0, (hz0 + hz1) / 2), (0.5, 2 * hw + 0.5, hz1 - hz0 + 0.5),
                    mat='pir_gunmetal_dark', bevel=0.08))
    st.append(plate('MouthHole', (hx1 + 0.3, 0, (hz0 + hz1) / 2 - 0.1), (0.35, 2 * hw - 0.9, hz1 - hz0 - 1.1),
                    mat='trim_black', bevel=0.02))
    for s in (1, -1):
        st.append(plate(f'MouthGlow{s}', (hx1 + 0.42, s * (hw - 0.62), (hz0 + hz1) / 2), (0.1, 0.14, hz1 - hz0 - 1.3),
                        mat='pir_glow_red', bevel=0.0))
    for k in range(7):
        y = -hw + 0.55 + k * (2 * hw - 1.1) / 6
        t = plate(f'Tooth{k}', (hx1 + 0.45, y, hz1 - 0.25), (0.12, 0.34, 0.5), rot=(35, 0, 0),
                  mat='pir_hazard' if k % 2 == 0 else 'trim_black', bevel=0.0)
        st.append(t)
    # welded side plating, vents and hazard stripes on the bay flanks
    for sgn in (1, -1):
        for k in range(7):
            x = rng.uniform(hx0 + 0.8, hx1 - 1.0)
            z = rng.uniform(hz0 + 0.6, hz1 - 0.7)
            st.append(plate(f'BaySide{sgn}{k}', (x, sgn * (hw + 0.04), z),
                            (rng.uniform(0.9, 1.9), 0.12, rng.uniform(0.7, 1.5)),
                            rot=(rng.uniform(-8, 8), 0, 0), mat=rng.choice(SCRAP), bevel=0.03))
        for k in range(2):
            x = hx0 + 2.2 + k * 2.6
            st.append(plate(f'BayVent{sgn}{k}', (x, sgn * (hw + 0.1), hz0 + 0.7), (1.2, 0.08, 0.16),
                            mat='pir_glow_red', bevel=0.0))
            st.append(plate(f'BayVentHood{sgn}{k}', (x, sgn * (hw + 0.18), hz0 + 0.86), (1.4, 0.2, 0.08),
                            mat='pir_gunmetal_dark', bevel=0.01))
        for k in range(5):
            stp = plate(f'BayHaz{sgn}{k}', (0, 0, 0), (0.22, 0.06, hz1 - hz0 - 0.6),
                        mat='pir_hazard' if k % 2 == 0 else 'trim_black', bevel=0.0)
            G.transform(stp, loc=(hx1 - 0.45 - k * 0.24, sgn * (hw + 0.17), (hz0 + hz1) / 2), rot=(0, 25, 0))
            st.append(stp)
    # sloped armour brow over the mouth + roof pipe run + small gantry
    brow = G.prism('Brow', [(-0.9, -hw - 0.2), (0.6, -hw - 0.2), (0.6, hw + 0.2), (-0.9, hw + 0.2)], 0.0, 0.45,
                   'pir_rust', bevel=0.04, seg=1)
    G.transform(brow, loc=(hx1 - 0.2, 0, hz1 - 0.1), rot=(0, 16, 0))
    st.append(brow)
    for k, y in enumerate((-1.3, -0.9)):
        st.append(G.cyl(f'RoofPipe{k}', 0.16, hx1 - hx0 - 1.2, 'pir_rust_dark' if k else 'pir_gunmetal',
                        loc=((hx0 + hx1) / 2 - 0.4, y, hz1 + 0.3), axis='X', verts=8))
    for k, x in enumerate((hx0 + 1.6, hx0 + 4.2)):
        st.append(plate(f'PipeClamp{k}', (x, -1.1, hz1 + 0.2), (0.2, 0.9, 0.3), mat='pir_gunmetal_dark', bevel=0.02))
    gx = hx0 + 3.0
    for sgn in (1, -1):
        st.append(plate(f'GantryLeg{sgn}', (gx, sgn * (hw - 0.3), hz1 + 0.9), (0.24, 0.24, 1.8),
                        mat='pir_gunmetal_dark', bevel=0.02))
    st.append(plate('GantryBeam', (gx, 0, hz1 + 1.85), (0.3, 2 * hw - 0.3, 0.28), mat='pir_hazard', bevel=0.03))
    st.append(plate('GantryLoad', (gx, 0.8, hz1 + 1.1), (1.1, 0.7, 0.6), mat='pir_rust', bevel=0.04))
    st.append(strut('GantryCable', (gx, 0.8, hz1 + 1.4), (gx, 0.8, hz1 + 1.75), 0.04, 'metal_bare'))
    # landing lights along the bay roof edge
    for k in range(3):
        for s in (1, -1):
            st.append(plate(f'BayLamp{k}{s}', (hx0 + 1.6 + k * 2.0, s * (hw + 0.05), hz1 - 0.35), (0.35, 0.1, 0.16),
                            mat='pir_glow_red', bevel=0.0))
    # ---- scrap wall segments + spikes along the pad rim --------------------
    for i in range(22):
        a = 2 * math.pi * (i + 0.5) / 22
        x, y = 7.6 * math.cos(a), 7.6 * math.sin(a)
        if x > 3.0 and abs(y) < 3.6:
            continue
        h = rng.uniform(1.0, 1.9)
        wl = plate(f'Wall{i}', (x, y, PAD + h / 2 - 0.1), (0.42, rng.uniform(1.8, 2.4), h),
                   rot=(rng.uniform(-6, 6), rng.uniform(-10, 4), math.degrees(a)), mat=rng.choice(SCRAP), bevel=0.05)
        st.append(wl)
        if i % 2 == 0:
            st += spikes(f'WSpike{i}', (x, y), 0.25, 2, PAD + h - 0.15, 0.9, rng)
    # ---- turret platforms on brackets at the rock rim ----------------------
    for i, (x, y, z, a) in enumerate(TURRETS):
        c = Vector((x, y, 0))
        out = c.normalized()
        st.append(G.cyl(f'TPlat{i}', 1.35, 0.35, 'pir_gunmetal', loc=(x, y, z - 0.42), verts=8, bevel=0.05, seg=1))
        st.append(G.ring_band(f'TPlatRim{i}', 1.42, 1.2, z - 0.5, z - 0.3, 'pir_rust', loc=(x, y, 0), verts=8,
                              smooth=False))
        st.append(G.ring_band(f'TMount{i}', 0.62, 0.42, z - 0.27, z, 'pir_gunmetal_dark', loc=(x, y, 0), verts=12))
        st.append(G.cyl(f'TWell{i}', 0.43, 0.06, 'trim_black', loc=(x, y, z - 0.22), verts=12))
        # brackets back into the rock
        base = c - out * 2.6
        for s in (1, -1):
            sd = Vector((-out.y, out.x, 0)) * 0.7 * s
            st.append(strut(f'TBrace{i}{s}', (c + sd).to_tuple()[:2] + (z - 0.6,),
                            (base + sd).to_tuple()[:2] + (PAD - 0.4,), 0.22))
            st.append(strut(f'TBraceLo{i}{s}', (c + sd * 0.6).to_tuple()[:2] + (z - 0.6,),
                            (base + sd * 0.6 - out * 0.5).to_tuple()[:2] + (PAD - 2.2,), 0.2))
        # armour shield plates on the outer side
        for k in (-1, 0, 1):
            ang = a + k * 40
            sp = plate(f'TShield{i}{k}', (0, 0, 0), (0.25, 1.1, 0.75), mat='pir_rust' if k == 0 else 'pir_gunmetal',
                       bevel=0.03)
            G.transform(sp, loc=(x + 1.2 * math.cos(math.radians(ang)), y + 1.2 * math.sin(math.radians(ang)),
                                 z - 0.05), rot=(0, -12, ang))
            st.append(sp)
    # ---- shield generator plinths (towers are separate nodes) --------------
    for i, (x, y) in enumerate(GENS):
        st.append(G.cyl(f'GenPlinth{i}', 1.8, 1.6, 'pir_gunmetal_dark', loc=(x, y, PAD - 0.9), verts=8,
                        bevel=0.08, seg=1))
        st.append(G.ring_band(f'GenRim{i}', 1.86, 1.5, PAD - 0.25, PAD - 0.05, 'pir_hazard', loc=(x, y, 0), verts=8,
                              smooth=False))
        st += truss(f'GenTruss{i}', (x + 1.5, y * 0.75, PAD - 0.4), (-5.4, y * 0.62, PAD + 0.1), w=0.6, bar=0.12)
        # power cable to the core well
        st.append(strut(f'GenCable{i}', (x + 1.2, y, PAD - 0.2), (-3.2, y * 0.35, PAD + 0.4), 0.26, 'pir_rust_dark'))
    # ---- welded wreck: an old freighter hull section on the pad -------------
    wx, wy = -2.6, 5.2
    prof = [(-2.6, 0.0), (-2.6, 0.9), (1.6, 1.0), (2.4, 0.75), (2.9, 0.0)]
    st.append(G.lathe('WreckHull', prof, [0, 1, 1, 2], ['pir_gunmetal_dark', 'pir_plate_worn', 'pir_rust'],
                      loc=(wx, wy, PAD + 0.85), axis='X', verts=10, closed=True, smooth=False, rot=(0, 0, 18)))
    st.append(G.ellipsoid('WreckCanopy', 0.7, 0.55, 0.45, 'pir_glass_red', loc=(wx + 2.3 * math.cos(math.radians(18)),
                          wy + 2.3 * math.sin(math.radians(18)), PAD + 1.45), seg=10, rings=6, upper_only=True))
    for k in range(4):
        rr = plate(f'WreckRib{k}', (0, 0, 0), (0.22, 2.1, 2.1), mat='pir_rust' if k % 2 else 'pir_gunmetal', bevel=0.03)
        dx = -2.0 + k * 1.1
        G.transform(rr, loc=(wx + dx * math.cos(math.radians(18)), wy + dx * math.sin(math.radians(18)), PAD + 0.85),
                    rot=(0, 0, 18))
        st.append(rr)
    # ---- container stacks ---------------------------------------------------
    for k, (x, y, z, r_) in enumerate(((-4.6, -4.4, PAD + 0.45, 12), (-3.1, -5.4, PAD + 0.45, -8),
                                       (-4.0, -4.9, PAD + 1.35, 30), (1.6, -5.8, PAD + 0.45, 70))):
        st.append(plate(f'Crate{k}', (x, y, z), (1.6, 0.9, 0.85), rot=(0, 0, r_),
                        mat=('pir_rust', 'pir_gunmetal', 'pir_hazard', 'pir_plate_worn')[k], bevel=0.05))
        st.append(plate(f'CrateBand{k}', (x, y, z), (0.18, 0.95, 0.9), rot=(0, 0, r_), mat='pir_gunmetal_dark',
                        bevel=0.02))
    # ---- clan totem: tall spire with claw banner (Rust) --------------------
    tx, ty = 0.6, -4.6
    st.append(G.cyl('TotemPole', 0.22, 6.0, 'pir_gunmetal_dark', loc=(tx, ty, PAD + 3.0), verts=6))
    st.append(plate('Banner', (tx + 0.05, ty - 0.95, PAD + 4.6), (0.08, 1.7, 2.3), mat='pir_rust', bevel=0.02))
    for k in range(3):    # claw slashes on the banner (both sides)
        sl = plate(f'Claw{k}', (0, 0, 0), (0.12, 0.16, 1.5), mat='pir_gunmetal_dark', bevel=0.0)
        G.transform(sl, loc=(tx + 0.05, ty - 0.5 - k * 0.42, PAD + 4.6), rot=(-18, 0, 0))
        st.append(sl)
    st.append(plate('BannerBar', (tx, ty - 0.95, PAD + 5.8), (0.14, 2.1, 0.14), mat='pir_gunmetal', bevel=0.02))
    st += spikes('TotemSpike', (tx, ty), 0.05, 3, PAD + 5.9, 1.1, rng)
    # ---- antenna masts -------------------------------------------------------
    masts = [(-5.6, 1.6, 5.2), (4.2, 4.6, 3.8), (-1.0, -7.0, 3.2), (8.0, -2.2, 3.0)]
    for k, (x, y, h) in enumerate(masts):
        z0 = PAD if math.hypot(x, y) < 7.5 else 3.2
        st.append(G.cyl(f'Mast{k}', 0.12, h, 'pir_gunmetal', loc=(x, y, z0 + h / 2), verts=6))
        for j in range(1, 3):
            st.append(plate(f'MastX{k}{j}', (x, y, z0 + h * j / 3), (0.9 - j * 0.2, 0.06, 0.06), rot=(0, 0, k * 40),
                            mat='pir_gunmetal_dark', bevel=0.0))
    # searchlight on the bay roof
    st.append(G.cyl('SearchBase', 0.35, 0.4, 'pir_gunmetal_dark', loc=(9.2, 1.7, 3.0), verts=8))
    st.append(G.cyl('SearchLamp', 0.32, 0.5, 'pir_gunmetal', loc=(9.5, 1.7, 3.45), axis='X', verts=10, r2=0.42))
    st.append(G.cyl('SearchGlass', 0.36, 0.05, 'light_white', loc=(9.77, 1.7, 3.45), axis='X', verts=10))

    root = G.join(st, 'Hrdzava_Pevnost')
    G.finalize(root, atlas_dir)
    # rock with vertex colour
    G.finalize(rock, atlas_dir)
    S.vertex_colours(rock, 'iron', [], ROCK_R, rng, samples=12, facet=True)
    G.set_smooth(rock, False)
    rock.parent = root
    # destroyable / animated nodes
    core = build_core(atlas_dir)
    core.location = (0, 0, CORE_Z)
    core.parent = root
    for i, (x, y) in enumerate(GENS):
        g = _gen_tower(f'shield_gen_{i}', atlas_dir)
        g.location = (x, y, PAD + 0.7)
        g.parent = root
    for i, (x, y, z, a) in enumerate(TURRETS):
        e = G.empty(f'turret_{i}', loc=(x, y, z), size=0.5)
        e.rotation_euler = (0, 0, math.radians(a))
        e.parent = root
    sp = G.empty('spawn_0', loc=(LAYOUTS['hrdzava_pevnost']['spawn'][0], 0, 0), size=0.8)
    sp.parent = root
    lamps = [((x, y, (PAD if math.hypot(x, y) < 7.5 else 3.2) + h + 0.15), 'light_red') for x, y, h in masts]
    lamps += [((0.6, -4.6, PAD + 6.65), 'light_red'),
              ((hx1 + 0.2, hw + 0.2, hz1 + 0.15), 'light_amber'), ((hx1 + 0.2, -hw - 0.2, hz1 + 0.15), 'light_amber')]
    for i, (loc, key) in enumerate(lamps):
        b = lamp(f'beacon_{i}', (0, 0, 0), key, r=0.26)
        G.finalize(b, atlas_dir)
        b.location = loc
        b.parent = root
    return root


# ----------------------------------------------------------------------------
# pirate beacon ("Vyzva klanu")
# ----------------------------------------------------------------------------
def build_beacon(atlas_dir, seed=77):
    rng = random.Random(seed)
    p = []
    # float body: squat octagonal drum of mismatched plates
    p.append(G.cyl('Body', 0.42, 0.7, 'pir_gunmetal', verts=8, bevel=0.04, seg=1))
    for i in range(8):
        a = i * 45 + 22.5
        pl = plate(f'Plate{i}', (0, 0, 0), (0.06, 0.3, 0.5), mat=('pir_rust', 'pir_gunmetal_dark', 'pir_plate_worn')[i % 3],
                   bevel=0.01)
        G.transform(pl, loc=(0.42 * math.cos(math.radians(a)), 0.42 * math.sin(math.radians(a)), rng.uniform(-0.06, 0.06)),
                    rot=(0, rng.uniform(-6, 6), a))
        p.append(pl)
    p.append(G.ring_band('Belt', 0.48, 0.4, -0.08, 0.08, 'pir_hazard', verts=8, smooth=False))
    # bottom keel + spikes
    p.append(G.cyl('Keel', 0.28, 0.5, 'pir_gunmetal_dark', loc=(0, 0, -0.55), verts=8, r2=0.1))
    for i in range(4):
        a = math.radians(i * 90 + 45)
        sp = G.cyl(f'Spike{i}', 0.07, 0.55, 'pir_gunmetal_dark', verts=4, r2=0.0)
        sp.data.transform(Matrix.Translation((0, 0, 0.27)))
        d = Vector((math.cos(a), math.sin(a), -0.35)).normalized()
        sp.matrix_world = Matrix.Translation((0.36 * math.cos(a), 0.36 * math.sin(a), -0.25)) @ \
            Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
        p.append(sp)
    # mast + two claw banners (clan sign)
    p.append(G.cyl('Mast', 0.06, 0.9, 'pir_gunmetal_dark', loc=(0, 0, 0.75), verts=6))
    for s in (1, -1):
        p.append(plate(f'Banner{s}', (0, s * 0.27, 0.78), (0.04, 0.42, 0.55), mat='pir_rust', bevel=0.0))
        for k in range(3):
            c = plate(f'Claw{s}{k}', (0, 0, 0), (0.05, 0.05, 0.38), mat='pir_gunmetal_dark', bevel=0.0)
            G.transform(c, loc=(0, s * (0.15 + k * 0.1), 0.78), rot=(-20, 0, 0))
            p.append(c)
    root = G.join(p, 'Pirate_Beacon')
    G.finalize(root, atlas_dir)
    # rotating lamp housing with the blinking red lamp inside
    h = []
    h.append(G.cyl('Cap', 0.2, 0.06, 'pir_gunmetal_dark', loc=(0, 0, 0.0), verts=8))
    for i in range(4):
        a = math.radians(i * 90)
        h.append(G.box(f'Bar{i}', -0.02, 0.02, -0.02, 0.02, 0.0, 0.32, 'pir_gunmetal'))
        G.transform(h[-1], loc=(0.16 * math.cos(a), 0.16 * math.sin(a), 0))
    h.append(G.cyl('Top', 0.2, 0.05, 'pir_gunmetal_dark', loc=(0, 0, 0.34), verts=8))
    h.append(plate('Reflector', (0, -0.05, 0.17), (0.24, 0.03, 0.24), mat='metal_bare', bevel=0.0))
    spin = G.join(h, 'Beacon_Spin')
    G.finalize(spin, atlas_dir)
    spin.location = (0, 0, 1.22)
    spin.parent = root
    lmp = lamp('beacon_0', (0, 0, 0), 'pir_glow_red', r=0.11)
    G.finalize(lmp, atlas_dir)
    lmp.location = (0, 0, 0.17)
    lmp.parent = spin
    return root


BUILDERS = {'hrdzava_pevnost': build_fortress, 'pirate_beacon': build_beacon}
