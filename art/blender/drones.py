"""Drones (spec 7.3, M5b) - small, readable, human hull language.

All drones: origin = body centre (fly them with the origin on the gameplay
plane), +X = forward (nose), +Y = port, +Z = up (glTF: +X fwd, +Y up).
Thruster EMPTIES `thruster_<i>` sit on the nozzle exits, local +X = exhaust
direction (backwards) - spawn the engine flame sprite along it.
drones.json (art/blender/data/) lists size, landing height, nodes.

  drone_cargo.glb   Nakladny dron (base -> station route, 60 HP)   ~2.3 long
    Cargo_Pod         detachable container under the belly (hide when empty / drop on a raid)
    beacon_0/1        nav lamps (port red / starboard green)
  drone_mining.glb  Tazobny dron (from the ship drone hangar)        ~0.8 long, orange top
    Drone_Laser       mining emitter on the top front; aim around local +Y (glTF up) +-70 deg
      Muzzle          EMPTY beam origin (child), +X = beam direction
  drone_repair.glb  Opravny dron (from the ship drone hangar)        ~0.85 long, green top
    Repair_Arm_L/R    welding arms; swing around local +Y
      Repair_Tip_L/R  EMPTY spark / beam origins
  drone_scout.glb   Prieskumny dron (home Observatorium)            ~1.5 long
    Scout_Dish        sensor dish; spin around local +Y
    beacon_0          white strobe on the tail
"""
import math

from mathutils import Matrix

from lib import geo as G
import structures as S
import pirates as PI

ACC = 'accent_iron'


def _lamp(name, loc, key, r):
    b = G.ellipsoid(name, r, r, r, key, seg=8, rings=5)
    b.location = loc
    G.bake_transform(b)
    return b


def _child(name, parts, atlas_dir, pivot, parent):
    ob = G.join(parts, name)
    G.finalize(ob, atlas_dir)
    ob.data.transform(Matrix.Translation([-c for c in pivot]))
    ob.location = pivot
    ob.parent = parent
    return ob


def _empty(name, loc, yaw=0.0, pitch=0.0, parent=None, size=0.08):
    e = G.empty(name, loc=loc, size=size)
    e.rotation_euler = (0, math.radians(-pitch), math.radians(yaw))
    if parent is not None:
        # loc is in the parent's frame
        e.parent = parent
    return e


def _finish(name, st, atlas_dir, beacons=()):
    root = G.join(st, name)
    G.finalize(root, atlas_dir)
    for i, (loc, key, r) in enumerate(beacons):
        b = _lamp(f'beacon_{i}', (0, 0, 0), key, r)
        G.finalize(b, atlas_dir)
        b.location = loc
        b.parent = root
    return root


# ----------------------------------------------------------------------------
def build_cargo(atlas_dir):
    st = []
    body = [(-0.95, -0.36), (0.55, -0.36), (1.05, -0.16), (1.12, 0.0), (1.05, 0.16), (0.55, 0.36), (-0.95, 0.36)]
    st.append(G.prism('Body', body, -0.1, 0.22, 'hull_light', bevel=0.04, seg=2))
    st.append(G.prism('Belly', [(x * 0.96, y * 0.88) for x, y in body], -0.2, -0.08, 'hull_dark', bevel=0.02, seg=1))
    st.append(G.prism('Belt', [(x * 1.01, y * 1.04) for x, y in body], -0.02, 0.06, ACC, bevel=0.01, seg=1))
    # spine with hazard chevrons + canopy
    st.append(G.box('Spine', -0.85, 0.35, -0.11, 0.11, 0.21, 0.27, 'hull_mid', bevel=0.02, seg=1))
    for k in range(3):
        for s in (1, -1):
            b = G.box(f'Chev{k}{s}', -0.1, 0.1, -0.025, 0.025, 0.265, 0.285, ACC)
            G.transform(b, loc=(-0.65 + k * 0.28, s * 0.055, 0), rot=(0, 0, 35 * s))
            st.append(b)
    st.append(G.ellipsoid('Canopy', 0.26, 0.2, 0.13, 'glass_cockpit', loc=(0.62, 0, 0.2), seg=14, rings=8,
                          upper_only=True))
    st.append(G.ring_band('CanopyRim', 0.27, 0.2, 0.19, 0.23, 'glass_frame', loc=(0.62, 0, 0), verts=14))
    # side engine pods on pylons + tail fins
    for s, y in ((1, 0.56), (-1, -0.56)):
        st.append(G.cyl(f'Pod{s}', 0.16, 0.85, 'hull_mid', loc=(-0.35, y, 0.04), axis='X', verts=12, bevel=0.02, seg=1))
        st.append(G.cyl(f'PodNose{s}', 0.16, 0.18, 'hull_light', loc=(0.16, y, 0.04), axis='X', verts=12, r2=0.06))
        st.append(G.ring_band(f'PodBelt{s}', 0.17, 0.12, -0.15, -0.08, ACC, loc=(0, y, 0.04), axis='X', verts=12))
        st.append(G.ring_band(f'Nozzle{s}', 0.15, 0.09, -0.84, -0.78, 'engine_glow', loc=(0, y, 0.04), axis='X', verts=12))
        st.append(G.cyl(f'NozCore{s}', 0.09, 0.02, 'engine_core', loc=(-0.8, y, 0.04), axis='X', verts=10))
        st.append(G.box(f'Pylon{s}', -0.6, -0.1, min(0.3 * s, 0.42 * s), max(0.3 * s, 0.42 * s), -0.0, 0.08, 'hull_dark'))
        fin = G.prism(f'Fin{s}', [(-0.95, 0.0), (-0.6, 0.0), (-0.85, 0.32), (-0.98, 0.32)], -0.02, 0.02, ACC,
                      bevel=0.006, seg=1)
        G.transform(fin, loc=(0, 0.3 * s, 0.2), rot=(90 - 25 * s, 0, 0))
        st.append(fin)
    # landing skids
    for s in (1, -1):
        st.append(G.box(f'Skid{s}', -0.65, 0.55, 0.24 * s - 0.03, 0.24 * s + 0.03, -0.62, -0.57, 'metal_bare'))
        for x in (-0.45, 0.35):
            st.append(G.box(f'Strut{s}{x}', x - 0.025, x + 0.025, 0.24 * s - 0.025, 0.24 * s + 0.025, -0.58, -0.18,
                            'metal_bare'))
    root = _finish('Drone_Cargo', st, atlas_dir, [((0.0, 0.37, 0.12), 'light_red', 0.045),
                                                  ((0.0, -0.37, 0.12), 'light_green', 0.045),
                                                  ((-0.8, 0.0, 0.3), 'light_amber', 0.05)])
    pod = [G.box('Crate', -0.6, 0.4, -0.27, 0.27, -0.5, -0.2, ACC, bevel=0.025, seg=1)]
    for k, x in enumerate((-0.42, -0.1, 0.22)):
        pod.append(G.box(f'Rib{k}', x - 0.03, x + 0.03, -0.285, 0.285, -0.49, -0.21, 'hull_dark'))
    pod.append(G.box('Label', -0.55, -0.48, -0.2, 0.2, -0.205, -0.19, 'hull_white'))
    pod.append(G.box('Clamp', -0.15, -0.05, -0.2, 0.2, -0.22, -0.18, 'metal_bare'))
    _child('Cargo_Pod', pod, atlas_dir, (-0.1, 0.0, -0.35), root)
    for i, y in enumerate((0.56, -0.56)):
        _empty(f'thruster_{i}', (-0.86, y, 0.04), yaw=180.0, parent=root)
    return root


# ----------------------------------------------------------------------------
def _small_chassis(st, glow, top='accent_iron', belt='hull_dark'):
    """Compact service-drone body (~0.8 long): light octagonal shell, role-coloured top plate (reads at game
    zoom: orange = mining, green = repair), dark belly, two rear nozzles, sensor eye."""
    shell = G.chamfer_rect(-0.32, 0.3, -0.24, 0.24, 0.1)
    st.append(G.prism('Shell', shell, -0.07, 0.06, 'hull_light', bevel=0.02, seg=2))
    st.append(G.prism('Top', G.chamfer_rect(-0.27, 0.22, -0.19, 0.19, 0.08), 0.05, 0.12, top, bevel=0.015, seg=1))
    st.append(G.prism('Belly', [(x * 0.92, y * 0.9) for x, y in shell], -0.13, -0.05, 'hull_dark', bevel=0.012, seg=1))
    st.append(G.prism('Belt', [(x * 1.03, y * 1.05) for x, y in shell], -0.04, 0.0, belt, bevel=0.006, seg=1))
    for s in (1, -1):
        st.append(G.cyl(f'Thr{s}', 0.065, 0.16, 'hull_mid', loc=(-0.35, 0.13 * s, 0.0), axis='X', verts=10))
        st.append(G.ring_band(f'ThrGlow{s}', 0.06, 0.035, -0.45, -0.425, 'engine_glow', loc=(0, 0.13 * s, 0.0),
                              axis='X', verts=10))
        st.append(G.cyl(f'Side{s}', 0.05, 0.1, 'hull_dark', loc=(0.0, 0.27 * s, 0.0), axis='Y', verts=8))
        st.append(G.box(f'SideGlow{s}', -0.03, 0.03, 0.3 * s - 0.01, 0.3 * s + 0.01, -0.02, 0.02, glow))
    st.append(G.ellipsoid('Eye', 0.05, 0.08, 0.045, 'glass_cockpit', loc=(0.3, 0, 0.03), seg=10, rings=6))


def build_mining(atlas_dir):
    st = []
    _small_chassis(st, 'laser_glow', top='accent_iron')
    # twin forward prongs (mandibles) framing the emitter - the top-down marker
    for s in (1, -1):
        st.append(G.box(f'Prong{s}', 0.12, 0.46, 0.1 * s - 0.035, 0.1 * s + 0.035, 0.0, 0.08, 'hull_dark', bevel=0.012, seg=1))
        st.append(G.box(f'ProngTip{s}', 0.42, 0.47, 0.1 * s - 0.03, 0.1 * s + 0.03, 0.01, 0.07, 'laser_glow'))
    # ore hopper at the back
    st.append(G.box('Hopper', -0.27, -0.1, -0.12, 0.12, 0.11, 0.18, 'hull_mid', bevel=0.012, seg=1))
    st.append(G.box('HopperOre', -0.25, -0.12, -0.1, 0.1, 0.16, 0.19, 'rock_iron_2'))
    root = _finish('Drone_Mining', st, atlas_dir, [((-0.3, 0.0, 0.15), 'light_amber', 0.025)])
    # mining emitter on the top front, between the prongs (aims around local +Z/glTF +Y)
    pv = (0.12, 0.0, 0.14)
    lp = [G.cyl('LBase', 0.07, 0.05, 'hull_dark', loc=(0, 0, 0), verts=10),
          G.box('LHead', -0.05, 0.1, -0.045, 0.045, -0.02, 0.06, 'hull_light', bevel=0.01, seg=1),
          G.cyl('LBarrel', 0.026, 0.2, 'metal_bare', loc=(0.18, 0, 0.02), axis='X', verts=8),
          G.ring_band('LLens', 0.034, 0.012, 0.27, 0.29, 'laser_glow', loc=(0, 0, 0.02), axis='X', verts=8)]
    for o in lp:
        G.apply_modifiers(o)
        G.bake_transform(o)
        o.data.transform(Matrix.Translation(pv))
    las = _child('Drone_Laser', lp, atlas_dir, pv, root)
    _empty('Muzzle', (0.29, 0.0, 0.02), parent=las)
    for i, y in enumerate((0.13, -0.13)):
        _empty(f'thruster_{i}', (-0.45, y, 0.0), yaw=180.0, parent=root)
    return root


def build_repair(atlas_dir):
    st = []
    _small_chassis(st, 'repair_glow', top='accent_trader')
    # white cross + green status ring on the green top
    st.append(G.box('CrossA', -0.15, 0.05, -0.03, 0.03, 0.115, 0.135, 'hull_white'))
    st.append(G.box('CrossB', -0.08, -0.02, -0.1, 0.1, 0.115, 0.135, 'hull_white'))
    st.append(G.ring_band('Ring', 0.16, 0.13, 0.11, 0.13, 'repair_glow', loc=(-0.05, 0, 0), verts=16))
    root = _finish('Drone_Repair', st, atlas_dir, [((-0.28, 0.0, 0.15), 'light_green', 0.022)])
    for side, s in (('L', 1), ('R', -1)):
        pv = (0.16, 0.21 * s, 0.02)
        ap = [G.cyl(f'Sh{side}', 0.04, 0.06, 'hull_dark', loc=pv, axis='Y', verts=8),
              PI.strut(f'Up{side}', pv, (0.34, 0.27 * s, 0.03), 0.036, 'hull_light'),
              PI.strut(f'Fo{side}', (0.34, 0.27 * s, 0.03), (0.47, 0.16 * s, 0.0), 0.03, 'hull_mid'),
              G.cyl(f'Torch{side}', 0.018, 0.06, 'metal_bare', loc=(0.5, 0.14 * s, -0.005), axis='X', verts=6),
              _lamp(f'Spark{side}', (0.535, 0.14 * s, -0.005), 'repair_glow', 0.018)]
        arm = _child(f'Repair_Arm_{side}', ap, atlas_dir, pv, root)
        _empty(f'Repair_Tip_{side}', (0.545 - pv[0], 0.14 * s - pv[1], -0.005 - pv[2]), parent=arm)
    for i, y in enumerate((0.13, -0.13)):
        _empty(f'thruster_{i}', (-0.45, y, 0.0), yaw=180.0, parent=root)
    return root


def build_scout(atlas_dir):
    st = []
    # long dart hull
    prof = [(-0.6, 0.0), (-0.6, 0.12), (-0.35, 0.17), (0.25, 0.15), (0.55, 0.09), (0.78, 0.0)]
    st.append(G.lathe('Hull', prof, [0, 1, 1, 2, 2], ['hull_dark', 'hull_light', 'hull_white'], axis='X', verts=10,
                      closed=False, smooth=False))
    st.append(G.ring_band('Belt', 0.175, 0.14, -0.2, -0.12, ACC, axis='X', verts=10, smooth=False))
    st.append(G.ring_band('Glow', 0.16, 0.13, 0.12, 0.16, 'radar_glow', axis='X', verts=10, smooth=False))
    st.append(G.cyl('Antenna', 0.012, 0.5, 'metal_bare', loc=(1.0, 0, 0), axis='X', verts=6))
    st.append(_lamp('AntTip', (1.25, 0, 0), 'radar_glow', 0.025))
    # swept solar wings
    for s in (1, -1):
        w = [(-0.42, 0.0), (0.05, 0.0), (-0.12, 0.62), (-0.42, 0.62)]
        wing = S.solar_wing(f'Wing{s}', -0.42, 0.0, 0.16 if s > 0 else -0.68, 0.68 if s > 0 else -0.16, 0.0,
                            cols=2, rows=2)
        st += wing
        st.append(G.box(f'WingTip{s}', -0.44, 0.02, s * 0.68 - 0.02, s * 0.68 + 0.02, -0.04, 0.05, ACC))
        st.append(G.box(f'WingRoot{s}', -0.3, -0.1, min(0.1 * s, 0.18 * s), max(0.1 * s, 0.18 * s), -0.03, 0.03,
                        'hull_dark'))
    # tail engine
    st.append(G.cyl('Engine', 0.1, 0.18, 'hull_mid', loc=(-0.68, 0, 0), axis='X', verts=10))
    st.append(G.ring_band('EngGlow', 0.095, 0.05, -0.78, -0.76, 'engine_glow', axis='X', verts=10))
    st.append(G.cyl('EngCore', 0.05, 0.01, 'engine_core', loc=(-0.765, 0, 0), axis='X', verts=8))
    root = _finish('Drone_Scout', st, atlas_dir, [((-0.5, 0.0, 0.16), 'light_white', 0.03)])
    dp = [G.cyl('DishMast', 0.02, 0.12, 'metal_bare', loc=(0, 0, 0.06), verts=6)]
    prof = [(0.0, 0.0), (0.012, 0.08), (0.04, 0.17), (0.03, 0.18), (0.0, 0.08), (-0.015, 0.0)]
    dp.append(G.lathe('Dish', prof, [0, 0, 1, 2, 2], ['hull_white', 'radar_glow', 'hull_mid'], loc=(0.0, 0, 0.13),
                      axis='Z', verts=12, closed=False, rot=(0, 50, 0)))
    for o in dp:
        G.apply_modifiers(o)
        G.bake_transform(o)
        o.data.transform(Matrix.Translation((0.1, 0, 0.12)))
    _child('Scout_Dish', dp, atlas_dir, (0.1, 0.0, 0.12), root)
    _empty('thruster_0', (-0.78, 0.0, 0.0), yaw=180.0, parent=root)
    return root


BUILDERS = {'drone_cargo': build_cargo, 'drone_mining': build_mining, 'drone_repair': build_repair,
            'drone_scout': build_scout}

INFO = {
    'drone_cargo': dict(label='Cargo drone', labelSk='Nákladný dron', source='base drone dock / hub routes',
                        spec='100 u per trip (U2: 200), 40 u/s, 60 HP', length=2.3, landingHeight=0.62,
                        nodes={'Cargo_Pod': 'detachable container (pivot = pod centre); hide when empty',
                               'beacon_0/1': 'port red / starboard green nav lamps', 'beacon_2': 'amber tail lamp',
                               'thruster_0/1': 'EMPTY nozzle exits, local +X = exhaust direction'}),
    'drone_mining': dict(label='Mining drone', labelSk='Ťažobný dron', source='ship drone hangar (2x2)',
                         spec='mines asteroids within 60 u of the ship, 0.8 u/s', length=0.8, landingHeight=0.13,
                         nodes={'Drone_Laser': 'emitter on the top front between the prongs, aim around local +Y '
                                               '(+-70 deg)',
                                'Muzzle': 'EMPTY beam origin (child of Drone_Laser), +X = beam',
                                'beacon_0': 'amber lamp', 'thruster_0/1': 'EMPTY nozzle exits'}),
    'drone_repair': dict(label='Repair drone', labelSk='Opravný dron', source='ship drone hangar (2x2)',
                         spec='repairs parts 2 HP/s out of combat', length=0.85, landingHeight=0.13,
                         nodes={'Repair_Arm_L/R': 'welding arms, swing around local +Y (pivot = shoulder)',
                                'Repair_Tip_L/R': 'EMPTY spark / repair beam origins (children of the arms)',
                                'beacon_0': 'green lamp', 'thruster_0/1': 'EMPTY nozzle exits'}),
    'drone_scout': dict(label='Scout drone', labelSk='Prieskumný dron', source='home Observatory (scout_bay)',
                        spec='flies to a signal and back, 10-30 game min, visible on the map', length=1.9,
                        landingHeight=0.17,
                        nodes={'Scout_Dish': 'sensor dish, spin around local +Y', 'beacon_0': 'white strobe',
                               'thruster_0': 'EMPTY nozzle exit'}),
}


def layouts_json():
    return {'_schema': {
        'frame': 'origin = body centre (fly with it on the gameplay plane), glTF +X = nose, +Y = up',
        'length': 'overall length in grid units (ship cell = 1)',
        'landingHeight': 'distance from the origin down to the skids / belly: on a pad put the origin this '
                         'high above the pad EMPTY (base drone_pad, home drone_pad_<i>, scout_bay)',
        'nodes': 'animated / special child nodes'},
        **{k: {'file': k, **v} for k, v in INFO.items()}}
