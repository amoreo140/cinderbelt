"""Station variants per ring / role (art audit 2026-10-16, batch D2).

  station_d   Institute research station (ring 1-3, research role): no rotating
              ring - a tri-lobed spindle with a big observatory dome, three lab
              lobes ending in observatory domes, two sensor booms; Institute trim
              + cyan window bands and glow rings.
  station_e   fortified frontier trade post (ring 2): static armoured ring with
              flak plates, turret blisters, scrap patches, gatehouse over the dock
              arm, container walls in the yard, red/amber lights.
  outpost_c   ice-moored outpost (ring 3): modules bolted into an ice rock
              (asteroid ice style, no veins), glowing heaters, mooring anchors.
  outpost_d   armoured relay outpost (ring 2): squat armoured drum with a lattice
              relay mast, dishes, radiator fins.

Node contract = every other station (README 2.3 / 2.5): <Root> static mesh
(COLOR_0 AO/grime), `beacon_<i>` lamps (caged housings, batch D1), `dock_port`
EMPTY at (R, 0, 0); no ring_rotor on these four.  Radius R: stations 10,
outposts 6.  Collision layouts live in LAYOUTS_D (NOT structures.LAYOUTS, so a
full build never changes the live station_layouts.json); batch_d.py writes them
to art/blender/data/station_layouts_batch_d.json for the code agent to merge.

Palette: the audit's `accent_institute` swatch does not exist yet (step 0 not
run) -> INSTITUTE_TRIM falls back to `accent_titanium` until it does.
"""
import math
import random

from mathutils import Matrix, Vector

from lib import geo as G
from lib import greebles as GR
from lib import palette as P
import station_kit as K
import stations_dtl as D
import structures as S

INSTITUTE_TRIM = 'accent_institute' if 'accent_institute' in P.INDEX else 'accent_titanium'
INSTITUTE_TRIM_DARK = 'accent_titanium_dark'

LAYOUTS_D = {
    'station_d': dict(R=10.0, circles=[(0, 0, 2.9),
                                       # lab lobes (60 / 180 / 300 deg): pylon+lab, observatory dome
                                       *[(round(r * math.cos(math.radians(a)), 2), round(r * math.sin(math.radians(a)), 2),
                                          rr) for a in (60, 180, 300) for r, rr in ((4.5, 1.25), (5.9, 1.25),
                                                                                    (7.25, 1.35))],
                                       # sensor booms (120 / 240 deg): mid span + pod
                                       *[(round(r * math.cos(math.radians(a)), 2), round(r * math.sin(math.radians(a)), 2),
                                          rr) for a in (120, 240) for r, rr in ((4.0, 1.3), (5.4, 1.3), (6.9, 0.45), (8.4, 0.8))],
                                       (4.2, 0, 1.0), (6.0, 0, 1.0), (7.8, 0, 1.0), (9.0, 0, 1.0)]),
    'station_e': dict(R=10.0, circles=[(0, 0, 8.45), (9.0, 0, 1.0)]),
    'outpost_c': dict(R=6.0, circles=[(-2.7, 0.0, 2.45), (-1.0, 0.2, 1.75), (-2.4, 1.5, 1.4), (-2.4, -1.5, 1.4),
                                      (-4.3, 0.0, 1.2), (1.5, 0, 0.9), (3.0, 0, 1.0), (5.0, 0, 1.0)]),
    'outpost_d': dict(R=6.0, circles=[(-1.0, 0, 2.75), (-1.0, 3.1, 0.75), (-1.0, -3.1, 0.75), (2.2, 0, 0.9),
                                      (3.6, 0, 1.0), (5.0, 0, 1.0)]),
}

# role / placement suggestions for the manifest (the code decides)
ROLES = {
    'station_d': dict(kind='station', rings=[1, 2, 3], role='research (Institute)', faction='institute',
                      label='Institute research station', labelSk='Výskumná stanica Inštitútu'),
    'station_e': dict(kind='station', rings=[2], role='trade (fortified frontier post)', faction='freeTraders',
                      label='Fortified frontier trade post', labelSk='Opevnená hraničná obchodná stanica'),
    'outpost_c': dict(kind='outpost', rings=[3], role='outpost (ice-moored)', faction='guild',
                      label='Ice-moored outpost', labelSk='Hliadka ukotvená v ľade'),
    'outpost_d': dict(kind='outpost', rings=[2], role='outpost (armoured relay)', faction='guild',
                      label='Armoured relay outpost', labelSk='Obrnená reléová hliadka'),
}

# greeble styles (dicts - station_kit.finish accepts a style dict)
_FRONTIER_HOSTS = tuple(GR._BASE['hosts']) + ('pir_gunmetal', 'pir_plate_worn', 'pir_gunmetal_dark')
_FRONTIER_SHADE = dict(GR._BASE['shade'])
_FRONTIER_SHADE.update({'pir_gunmetal': ('pir_gunmetal', 'pir_plate_worn', 'hull_mid', 'pir_gunmetal_dark'),
                        'pir_plate_worn': ('pir_plate_worn', 'pir_gunmetal', 'hull_mid'),
                        'pir_gunmetal_dark': ('pir_gunmetal_dark', 'pir_gunmetal'),
                        'hull_mid': ('hull_mid', 'pir_plate_worn', 'hull_mid', 'hull_dark')})
STYLE = {
    'institute': GR._style(accent=INSTITUTE_TRIM, accent2=INSTITUTE_TRIM_DARK, window='glass_cockpit',
                           tech='tier_glow_ti', lamp='light_white', lamp2='light_amber',
                           cargo=(INSTITUTE_TRIM, 'hull_white', 'hull_light', 'hull_mid', 'accent_titanium_dark'),
                           weights={'dish': 2.4, 'antenna': 1.8, 'skylight': 1.4, 'unit': 1.3, 'rack': 0.25,
                                    'tank': 0.6, 'scorch': 0.3}),
    'frontier': GR._style(accent='accent_iron', accent2='pir_hazard', lamp='light_red', lamp2='light_amber',
                          hosts=_FRONTIER_HOSTS, shade=_FRONTIER_SHADE,
                          weights={'patch': 2.4, 'scorch': 1.4, 'rack': 1.5, 'cables': 1.5, 'lights': 0.7,
                                   'window': 0.7, 'skylight': 0.5}, lit=0.85, rust=0.3),
    'ice': GR._style(weights={'tank': 1.6, 'pipes': 1.7, 'antenna': 1.3, 'unit': 1.4, 'rack': 0.5}),
    'relay': GR._style(accent2='pir_hazard', hosts=_FRONTIER_HOSTS, shade=_FRONTIER_SHADE,
                       weights={'antenna': 2.2, 'dish': 1.6, 'unit': 1.3, 'patch': 1.4, 'scorch': 0.8,
                                'window': 0.6}),
}


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def _rotz(objs, deg, pivot=(0.0, 0.0, 0.0)):
    """Bake modifiers + transforms, then rotate the mesh data about Z through pivot."""
    pv = Vector(pivot)
    m = Matrix.Translation(pv) @ Matrix.Rotation(math.radians(deg), 4, 'Z') @ Matrix.Translation(-pv)
    for o in objs:
        G.apply_modifiers(o)
        G.bake_transform(o)
        o.data.transform(m)
    return objs


def _polar(r, deg, z=0.0):
    a = math.radians(deg)
    return (r * math.cos(a), r * math.sin(a), z)


def observatory_dome(name, loc, r, h, yaw, ring=INSTITUTE_TRIM, glow='tier_glow_ti', scope=True):
    """White dome with a dark observing slit (toward `yaw`), trim + glow rings,
    telescope barrel poking out of the slit."""
    x, y, z = loc
    out = [G.ellipsoid(name, r, r, h, 'hull_white', loc=(x, y, z), seg=18, rings=7, upper_only=True)]
    out.append(G.ring_band(name + 'Rim', r * 1.06, r * 0.9, z - 0.1, z + 0.05, ring, loc=(x, y, 0), verts=18,
                           smooth=False))
    out.append(G.ring_band(name + 'Glow', r * 1.075, r * 1.0, z - 0.2, z - 0.12, glow, loc=(x, y, 0), verts=18,
                           smooth=False))
    cy, sy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    pts = []
    for t in (12, 40, 64, 84, 97):
        a = math.radians(t)
        pts.append(Vector((x + cy * (r + 0.02) * math.cos(a), y + sy * (r + 0.02) * math.cos(a),
                           z + (h + 0.02) * math.sin(a))))
    for k in range(len(pts) - 1):
        out.append(K.bar(f'{name}Slit{k}', pts[k], pts[k + 1], r * 0.3, 'trim_black', hgt=0.06))
    if scope:
        el = math.radians(38)
        d = Vector((cy * math.cos(el), sy * math.cos(el), math.sin(el)))
        p0 = Vector((x, y, z + h * 0.35))
        p1 = p0 + d * (r * 1.12)
        out.append(K.bar(name + 'Scope', p0, p1, r * 0.24, 'hull_mid'))
        out.append(K.bar(name + 'ScopeRing', p1 - d * 0.12, p1, r * 0.29, INSTITUTE_TRIM))
        out.append(K.bar(name + 'Lens', p1, p1 + d * 0.03, r * 0.18, 'glass_cockpit'))
    return out


def flak_plate(name, r, a, z0, z1, w, tilt, mat, haz=False):
    """Armour slab on an outer wall at radius r, angle a (deg), leaning outward by tilt (deg)."""
    out = []
    b = G.box(name, -0.09, 0.09, -w / 2, w / 2, z0 - (z0 + z1) / 2, z1 - (z0 + z1) / 2, mat)
    G.transform(b, loc=_polar(r, a, (z0 + z1) / 2), rot=(0, -tilt, a))
    out.append(b)
    if haz:
        for k in range(3):
            hb = G.box(f'{name}H{k}', 0.085, 0.1, -0.06, 0.06, -0.25, 0.25, 'pir_hazard')
            G.transform(hb, rot=(0, 0, 0))
            G.apply_modifiers(hb)
            hb.data.transform(Matrix.Rotation(math.radians(35), 4, 'X'))
            hb.data.transform(Matrix.Translation((0, -w / 2 + 0.2 + k * (w - 0.4) / 2, 0)))
            G.transform(hb, loc=_polar(r, a, (z0 + z1) / 2), rot=(0, -tilt, a))
            out.append(hb)
    return out


def turret_blister(name, r, a, z, mat='pir_gunmetal'):
    """Defence blister: armoured collar, dome, twin barrels pointing outward."""
    x, y, _ = _polar(r, a)
    out = [G.cyl(name + 'Collar', 0.82, 0.22, 'hull_dark', loc=(x, y, z + 0.11), verts=12, smooth=False),
           G.ring_band(name + 'Band', 0.84, 0.7, z + 0.16, z + 0.24, 'pir_hazard', loc=(x, y, 0), verts=12,
                       smooth=False),
           G.ellipsoid(name, 0.68, 0.68, 0.5, mat, loc=(x, y, z + 0.22), seg=12, rings=5, upper_only=True)]
    d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0.12)).normalized()
    side = Vector((-d.y, d.x, 0)).normalized()
    for s in (1, -1):
        p0 = Vector((x, y, z + 0.5)) + side * s * 0.16
        out.append(K.bar(f'{name}Gun{s}', p0, p0 + d * 1.15, 0.09, 'metal_bare'))
        out.append(K.bar(f'{name}Muz{s}', p0 + d * 1.0, p0 + d * 1.18, 0.13, 'hull_dark'))
    sight = Vector((x, y, z + 0.62)) + d * 0.45
    out.append(G.box(name + 'Sight', sight.x - 0.07, sight.x + 0.07, sight.y - 0.07, sight.y + 0.07, sight.z - 0.04,
                     sight.z + 0.05, 'light_red'))
    return out


def _station_zones(R, beacons, arm_x0, arm_w, arm_z1):
    z = D._beacon_zones(D._std_zones(R), beacons)
    D.arm_zone(z, arm_x0, R, arm_w, arm_z1)
    return z


# ----------------------------------------------------------------------------
# station D - Institute research station (R = 10)
# ----------------------------------------------------------------------------
LAB_ANGLES = (60.0, 180.0, 300.0)
BOOM_ANGLES = (120.0, 240.0)


def build_station_d(atlas_dir, seed=7101):
    R = LAYOUTS_D['station_d']['R']
    tr = INSTITUTE_TRIM
    st = []
    # spindle: spire, lower drum, flange, mid collar, upper drum, top deck
    prof = [(-4.25, 0.0), (-4.25, 0.22), (-3.5, 0.55), (-2.7, 1.15), (-2.05, 1.85), (-1.55, 2.3), (-0.62, 2.4),
            (-0.55, 2.78), (-0.28, 2.78), (-0.22, 2.3), (0.88, 2.2), (0.95, 2.5), (1.25, 2.5), (1.3, 2.1),
            (2.42, 1.95), (2.5, 1.62), (2.98, 1.55), (3.06, 1.82), (3.12, 0.0)]
    mats = ['hull_dark', 'hull_dark', 'hull_mid', 'hull_mid', 'hull_dark', 'hull_light', tr, 'hull_light',
            'hull_dark', 'hull_light', tr, 'hull_light', 'hull_dark', 'hull_light', 'hull_mid', 'hull_mid',
            'hull_dark', 'hull_light']
    st.append(D._lathe('Spindle', prof, mats, verts=24))
    for i in range(12):        # ribs on the lower drum + upper drum
        a = i * 30 + 15
        st.append(K.rbox(f'SpRib{i}', 2.22, 2.46, 0.08, -1.5, -0.66, a, 'hull_mid'))
        st.append(K.rbox(f'SpRibU{i}', 1.9, 2.04, 0.07, 1.36, 2.38, a, 'hull_mid'))
    st += K.ring_lights('FlangeL', 2.79, -0.35, 36, 'glass_cockpit', s=0.04, h=0.05, a0=5)
    st.append(G.ring_band('MidGlow', 2.52, 2.4, 1.05, 1.15, 'tier_glow_ti', verts=24, smooth=False))
    st += K.ring_lights('SpireL', 1.0, -2.95, 8, 'light_white', s=0.04, h=0.04)
    # main observatory on the top deck + equipment ring
    st += observatory_dome('MainDome', (0, 0, 3.08), 1.42, 1.18, 200.0)
    for i in range(6):
        a = i * 60 + 30
        st.append(K.rbox(f'DeckPod{i}', 1.55, 1.82, 0.22, 3.06, 3.32, a, 'hull_light', bevel=0.02))
    # three lab lobes: pylon (walkway + windows), lab block, observatory dome
    for k, a in enumerate(LAB_ANGLES):
        lobe = []
        lobe.append(G.box(f'Pyl{k}', 2.2, 4.05, -0.42, 0.42, -0.75, 0.05, 'hull_mid', bevel=0.04, seg=1))
        lobe.append(G.box(f'PylKeel{k}', 2.2, 4.05, -0.24, 0.24, -0.98, -0.72, 'hull_dark', bevel=0.02, seg=1))
        lobe.append(G.box(f'PylWin{k}', 2.5, 3.85, -0.44, 0.44, -0.4, -0.3, 'glass_cockpit'))
        for j in range(3):
            x = 2.55 + j * 0.62
            lobe.append(G.box(f'PylRib{k}{j}', x - 0.08, x + 0.08, -0.5, 0.5, -0.82, 0.12,
                              tr if j % 2 == 0 else 'hull_light', bevel=0.02, seg=1))
        lobe += S.deck_block(f'Lab{k}', 3.95, 6.55, -1.05, 1.05, -1.25, 0.65, accent=tr)
        lobe.append(G.box(f'LabSky{k}', 4.3, 6.1, -0.32, 0.32, 0.62, 0.7, 'trim_black'))
        lobe.append(G.box(f'LabSkyG{k}', 4.38, 6.02, -0.25, 0.25, 0.66, 0.73, 'glass_cockpit'))
        # dome on a short drum at the lobe tip
        lobe.append(G.cyl(f'DomeDrum{k}', 1.18, 1.2, 'hull_light', loc=(7.2, 0, -0.55), verts=18, smooth=False))
        lobe.append(G.ring_band(f'DomeDrumB{k}', 1.2, 1.1, -0.8, -0.62, tr, loc=(7.2, 0, 0), verts=18, smooth=False))
        lobe += observatory_dome(f'Obs{k}', (7.2, 0, 0.05), 1.1, 0.95, 35.0 + 50 * k, scope=True)
        st += _rotz(lobe, a)
    # sensor booms between the lobes: lattice, radiators, sensor pod with prongs
    for k, a in enumerate(BOOM_ANGLES):
        boom = []
        boom += K.box_truss(f'Boom{k}', (2.3, 0, 0.2), (8.05, 0, 0.2), w=0.42, h=0.34, bar_w=0.06, mat='hull_mid',
                            rung_mat='hull_dark')
        boom.append(G.box(f'BoomSpine{k}', 2.3, 8.0, -0.06, 0.06, 0.33, 0.39, tr))
        for j, x in enumerate((4.0, 5.4)):
            boom += K.solar_array(f'BoomRad{k}{j}', x - 0.5, x + 0.5, 0.25, 1.35, 0.2, cols=4, rows=1,
                                  cell='hull_white')
            boom += K.solar_array(f'BoomRadB{k}{j}', x - 0.5, x + 0.5, -1.35, -0.25, 0.2, cols=4, rows=1,
                                  cell='hull_white')
        boom.append(G.ellipsoid(f'Pod{k}', 0.6, 0.6, 0.52, 'hull_white', loc=(8.45, 0, 0.2), seg=14, rings=8))
        boom.append(G.ring_band(f'PodBand{k}', 0.63, 0.5, 0.12, 0.28, tr, loc=(8.45, 0, 0), verts=14, smooth=False))
        boom.append(G.ring_band(f'PodGlow{k}', 0.64, 0.55, 0.0, 0.06, 'tier_glow_ti', loc=(8.45, 0, 0), verts=14,
                                smooth=False))
        for j in range(3):
            pa = j * 120 + 30
            d = Vector((math.cos(math.radians(pa)), math.sin(math.radians(pa)), -0.35)).normalized()
            p0 = Vector((8.45, 0, 0.1))
            boom.append(K.bar(f'Prong{k}{j}', p0 + d * 0.5, p0 + d * 1.0, 0.05, 'metal_bare'))
        st += _rotz(boom, a)
    # dock arm (+X)
    arm, bpos = D.arm_dtl('Arm', 2.6, R, w=1.5, gantry=True, accent=tr)
    st += arm
    pod = [_polar(8.45, a, 0.73) for a in BOOM_ANGLES]
    beacons = [(bpos[0], 'light_red'), (bpos[1], 'light_green'), ((0.0, 0.0, 4.32), 'light_white'),
               (pod[0], 'light_amber'), (pod[1], 'light_amber'), ((0.0, 0.0, -4.4), 'light_red')]
    zones = _station_zones(R, beacons, 2.6, 1.5, 0.18)
    for a in BOOM_ANGLES:                 # sensor pods + prongs stay clean
        x, y, _ = _polar(8.45, a)
        zones.cyl(x, y, 1.1, -9, 9)
    cfg = D._cfg((-1.25, -0.95, -0.25, 0.3, 1.75), cell=0.95, density=1.05)
    root, _ = K.finish('Station_D', st, atlas_dir, R, beacons, style=STYLE['institute'], seed=seed, zones=zones,
                       static_cfg=cfg, weather_cfg=dict(grime=0.22), beacon='cage')
    return root


# ----------------------------------------------------------------------------
# station E - fortified frontier trade post (R = 10)
# ----------------------------------------------------------------------------
E_RING_R, E_RING_W, E_RING_Z0, E_RING_Z1 = 7.05, 1.7, -1.15, 0.45
E_GATE = 15.0          # half angle of the gate gap at +X (deg)
E_TURRETS = (45.0, 135.0, 225.0, 315.0)


def build_station_e(atlas_dir, seed=7202):
    R = LAYOUTS_D['station_e']['R']
    rng = random.Random(seed)
    st = []
    # hub + command tower + comm mast
    st += D.hub_dtl('Hub', 2.6, -1.6, 1.0, flange_z=-0.62, verts=20)
    st.append(D._lathe('Tower', [(1.0, 1.55), (1.45, 1.5), (1.5, 1.2), (1.95, 1.1), (2.05, 0.9), (2.25, 0.82),
                                 (2.3, 0.0)],
                       ['hull_mid', 'hull_dark', 'pir_glass_red', 'pir_gunmetal', 'hull_mid', 'hull_dark'], verts=12))
    st += S.mast('Mast', (0.35, 0.35, 2.28), 1.5, r=0.08, dish=0.45)
    st += S.mast('MastB', (-0.5, -0.3, 2.28), 0.8, r=0.05)
    # armoured ring: segments between the gate (+X) and around
    seg_w = 26.0
    a = E_GATE
    k = 0
    while a < 360 - E_GATE - 1:
        a1 = min(a + seg_w, 360 - E_GATE)
        zc = (E_RING_Z0 + E_RING_Z1) / 2
        st.append(K.arc_box(f'RSeg{k}', E_RING_R, E_RING_W, E_RING_Z1 - E_RING_Z0, zc, a + 1.0, a1 - 1.0,
                            'hull_dark', side_mat='pir_gunmetal', top_mat='hull_mid'))
        # parapet on the outer top edge + inner walkway lip
        st.append(K.arc_box(f'RPar{k}', E_RING_R + E_RING_W / 2 - 0.14, 0.24, 0.32, E_RING_Z1 + 0.16, a + 1.5,
                            a1 - 1.5, 'pir_gunmetal', top_mat='pir_gunmetal_dark'))
        # buttress at the segment joint
        st.append(K.rbox(f'RBut{k}', E_RING_R - E_RING_W / 2 - 0.12, E_RING_R + E_RING_W / 2 + 0.22, 0.26,
                         E_RING_Z0 - 0.1, E_RING_Z1 + 0.42, a, 'hull_mid'))
        st.append(K.rbox(f'RButH{k}', E_RING_R + E_RING_W / 2 + 0.1, E_RING_R + E_RING_W / 2 + 0.24, 0.27,
                         E_RING_Z0 + 0.3, E_RING_Z0 + 0.62, a, 'pir_hazard'))
        # flak plates on the outer wall (mismatched, one hazard-striped)
        n = 3
        for j in range(n):
            pa = a + (a1 - a) * (j + 0.5) / n
            mat = ('pir_gunmetal', 'hull_mid', 'pir_plate_worn', 'pir_gunmetal_dark')[rng.randrange(4)]
            st += flak_plate(f'Flak{k}{j}', E_RING_R + E_RING_W / 2 + 0.12, pa, E_RING_Z0 + 0.05, E_RING_Z1 - 0.05,
                             (a1 - a) / n * math.pi / 180 * (E_RING_R + 0.95) * 0.86, 14 + rng.uniform(-4, 4), mat,
                             haz=(j == 1 and k % 2 == 0))
        a = a1
        k += 1
    # end walls of the ring at the gate + gate bastions + lintel over the arm
    for s in (1, -1):
        gx, gy = _polar(E_RING_R, s * (E_GATE + 1.0))[:2]
        st.append(G.box(f'Bastion{s}', gx - 0.95, gx + 0.95, -0.55 + gy - s * 0.15, 0.55 + gy - s * 0.15,
                        E_RING_Z0 - 0.2, 1.55, 'hull_dark', bevel=0.06, seg=1))
        st.append(G.box(f'BastionTop{s}', gx - 1.0, gx + 1.0, -0.6 + gy - s * 0.15, 0.6 + gy - s * 0.15, 1.5, 1.66,
                        'pir_gunmetal', bevel=0.03, seg=1))
        for j in range(4):
            hz = E_RING_Z0 + 0.25 + j * 0.42
            hb = G.box(f'BastHaz{s}{j}', gx + 0.94, gx + 0.99, gy - s * 0.15 - 0.5, gy - s * 0.15 + 0.5, hz, hz + 0.16,
                       'pir_hazard')
            st.append(hb)
        # retracted blast door slabs inside the bastions' inner faces
        st.append(G.box(f'BlastDoor{s}', gx - 0.7, gx + 0.7, s * 1.12 - 0.08, s * 1.12 + 0.08, -0.9, 1.3,
                        'pir_gunmetal_dark', bevel=0.02, seg=1))
    gx = 6.45
    st.append(G.box('Lintel', gx - 0.45, gx + 0.45, -1.5, 1.5, 1.22, 1.6, 'hull_mid', bevel=0.04, seg=1))
    for j in range(7):
        hb = G.box(f'LintelHaz{j}', -0.07, 0.07, -0.14, 0.14, 0, 0.03, 'pir_hazard')
        G.transform(hb, loc=(gx, -1.2 + j * 0.4, 1.6), rot=(0, 0, 40))
        st.append(hb)
    st += K.light_row('LintelL', (gx + 0.46, -1.2, 1.3), (gx + 0.46, 1.2, 1.3), 5, 'light_amber', s=0.05, h=0.08)
    # turret blisters on the ring
    for t, ta in enumerate(E_TURRETS):
        st += turret_blister(f'Tur{t}', E_RING_R + 0.1, ta, E_RING_Z1 + 0.32)
    # red / amber marker lights along the parapet
    for j in range(16):
        la = E_GATE + 6 + j * (360 - 2 * E_GATE - 12) / 15
        x, y, _ = _polar(E_RING_R + E_RING_W / 2 - 0.14, la)
        st.append(G.box(f'ParL{j}', x - 0.05, x + 0.05, y - 0.05, y + 0.05, E_RING_Z1 + 0.32, E_RING_Z1 + 0.4,
                        'light_red' if j % 2 else 'light_amber'))
    # yard deck between hub and ring + heavy girders
    st.append(K.arc_box('Yard', 4.75, 2.8, 0.3, -1.05, E_GATE + 6, 360 - E_GATE - 6, 'hull_dark',
                        top_mat='floor_dark'))
    for ga in (90.0, 180.0, 270.0):
        g = K.box_truss(f'Gird{int(ga)}', (2.6, 0, -0.75), (6.25, 0, -0.75), w=0.7, h=0.5, bar_w=0.08, mat='hull_mid',
                        rung_mat='hull_dark')
        st += _rotz(g, ga)
    # container walls in the yard (two high, long axis tangential)
    keys = ('accent_iron', 'pir_hazard', 'accent_trader', 'hull_mid', 'pir_rust', 'accent_titanium', 'pir_gunmetal')
    ci = 0
    for (a0, a1) in ((40, 130), (150, 210), (230, 320)):
        n = max(3, int((a1 - a0) / 9.5))
        for j in range(n):
            ca = a0 + (a1 - a0) * (j + 0.5) / n
            if any(abs(((ca - ga) + 180) % 360 - 180) < 6 for ga in (90.0, 180.0, 270.0)):
                continue
            for lvl in range(2 if rng.random() < 0.6 else 1):
                x, y, _ = _polar(5.1, ca)
                st += S.container(f'Cn{ci}', x, y, -0.9 + lvl * 0.62, 1.3, 0.75, 0.6, keys[ci % len(keys)],
                                  rot=ca + 90)
                ci += 1
    # dock arm through the gate
    arm, bpos = D.arm_dtl('Arm', 3.3, R, w=1.5, gantry=False)
    st += arm
    beacons = [(bpos[0], 'light_red'), (bpos[1], 'light_green'), ((0.35, 0.35, 3.8), 'light_white'),
               ((_polar(E_RING_R, E_GATE + 1.0)[0], _polar(E_RING_R, E_GATE + 1.0)[1] - 0.15, 1.9), 'light_amber'),
               ((_polar(E_RING_R, -E_GATE - 1.0)[0], _polar(E_RING_R, -E_GATE - 1.0)[1] + 0.15, 1.9), 'light_amber')]
    zones = _station_zones(R, beacons, 3.3, 1.5, 0.18)
    for ta in E_TURRETS:
        x, y, _ = _polar(E_RING_R + 0.1, ta)
        zones.cyl(x, y, 1.0, -9, 9)
    zones.box(gx - 0.6, R, -1.5, 1.5, -2, 2.2)              # gate passage
    cfg = D._cfg((-0.45,), cell=1.2, density=0.38, panel_keys=('hull_mid', 'hull_light', 'pir_gunmetal'))
    root, _ = K.finish('Station_E', st, atlas_dir, R, beacons, style=STYLE['frontier'], seed=seed, zones=zones,
                       static_cfg=cfg, weather_cfg=dict(grime=0.42, rust=0.25), beacon='cage')
    return root


# ----------------------------------------------------------------------------
# outpost C - ice-moored outpost (R = 6)
# ----------------------------------------------------------------------------
ICE_C = (-2.4, 0.0, -0.75)          # rock centre
ICE_RAD = (2.75, 2.2, 1.75)


def ice_rock(name, seed=31, center=ICE_C, radii=ICE_RAD):
    """Faceted ice rock in the asteroid ice style (no veins): displaced
    icosphere, per-facet ice swatches (crust on top, deep blue underneath) +
    glowing crystal clusters."""
    import bmesh
    from mathutils import noise
    rng = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    o = Vector((rng.uniform(-40, 40), rng.uniform(-40, 40), rng.uniform(-40, 40)))
    for v in bm.verts:
        n = v.co.normalized()
        d = 1.0 + 0.2 * noise.noise(n * 1.6 + o) + 0.08 * noise.noise(n * 3.7 - o)
        v.co = Vector((n.x * radii[0] * d, n.y * radii[1] * d, n.z * radii[2] * d)) + Vector(center)
    # flat-ish top shelf where the hab sits
    for v in bm.verts:
        if v.co.z > center[2] + radii[2] * 0.62:
            v.co.z = center[2] + radii[2] * 0.62 + (v.co.z - center[2] - radii[2] * 0.62) * 0.25
    bm.normal_update()
    keys = ['st_rock_ice', 'ice_crust', 'rock_ice_2', 'ice_crust_blue', 'rock_ice_3']
    for f in bm.faces:
        nz = f.normal.z
        r = rng.random()
        if nz > 0.55:
            f.material_index = 1 if r < 0.55 else (3 if r < 0.8 else 0)
        elif nz < -0.35:
            f.material_index = 2 if r < 0.7 else 4
        else:
            f.material_index = 0 if r < 0.5 else (4 if r < 0.75 else 3)
    rock = G.obj_from_bm(name, bm, keys)
    out = [rock]
    # crystal clusters (prisms) sticking out of the sides
    for c, (az, el, sc) in enumerate(((150, 15, 1.0), (210, -5, 0.8), (95, 25, 0.75), (265, 20, 0.9),
                                      (185, 40, 0.65))):
        d = Vector((math.cos(math.radians(az)) * math.cos(math.radians(el)),
                    math.sin(math.radians(az)) * math.cos(math.radians(el)), math.sin(math.radians(el))))
        base = Vector(center) + Vector((d.x * radii[0], d.y * radii[1], d.z * radii[2])) * 0.86
        for j in range(4):
            jd = (d + Vector((rng.uniform(-0.45, 0.45), rng.uniform(-0.45, 0.45), rng.uniform(-0.2, 0.5)))).normalized()
            L = sc * rng.uniform(0.85, 1.45)
            rr = sc * rng.uniform(0.15, 0.25)
            cr = G.cyl(f'{name}Cr{c}{j}', rr, L, 'ice_crystal', verts=6, r2=rr * 0.25, smooth=False)
            G.apply_modifiers(cr)
            cr.data.transform(Matrix.Translation((0, 0, L / 2)))
            q = Vector((0, 0, 1)).rotation_difference(jd)
            cr.data.transform(Matrix.Translation(base + jd * -0.15) @ q.to_matrix().to_4x4())
            out.append(cr)
    return out


def build_outpost_c(atlas_dir, seed=7303):
    R = LAYOUTS_D['outpost_c']['R']
    st = []
    st += ice_rock('IceRock', seed=seed)
    rock_bvh = GR.bvh_of([st[0]])

    def surf(x, y, default=0.0):
        hit = rock_bvh.ray_cast(Vector((x, y, 9.0)), Vector((0, 0, -1)), 20.0)
        return hit[0].z if hit[0] is not None else default

    top = ICE_C[2] + ICE_RAD[2] * 0.62           # rock shelf height
    # hab capsule clamped onto the shelf
    L, r = 1.55, 0.78
    hx, hz = -2.3, top + 0.55
    prof = [(-L - r, 0.0), (-L - r * 0.72, r * 0.72), (-L, r), (L, r), (L + r * 0.55, r * 0.75), (L + r * 0.75, 0.0)]
    st.append(G.lathe('Hab', prof, [0, 0, 1, 2, 2], ['hull_mid', 'hull_light', 'hull_dark'], loc=(hx, 0, hz),
                      axis='X', verts=14, closed=False, smooth=False))
    for i, x in enumerate((-1.2, 0.0, 1.2)):
        st.append(G.ring_band(f'HabBand{i}', r + 0.07, r - 0.04, -0.1, 0.1, 'accent_iron' if i != 1 else 'hull_mid',
                              loc=(hx + x, 0, hz), axis='X', verts=14, smooth=False))
    st.append(G.box('HabWinL', hx - 1.4, hx + 1.0, r - 0.02, r + 0.03, hz - 0.08, hz + 0.08, 'window_warm'))
    st.append(G.box('HabWinR', hx - 1.4, hx + 1.0, -r - 0.03, -r + 0.02, hz - 0.08, hz + 0.08, 'window_warm'))
    for s in (1, -1):       # clamp legs bored into the ice
        for x in (-1.0, 1.0):
            fz = surf(hx + x * 1.15, s * 1.2, top - 0.4)
            st.append(K.bar(f'HabLeg{s}{x}', (hx + x, s * 0.55, hz - 0.35), (hx + x * 1.15, s * 1.2, fz + 0.1),
                            0.13, 'hull_dark'))
            st.append(G.box(f'HabFoot{s}{x}', hx + x * 1.15 - 0.2, hx + x * 1.15 + 0.2, s * 1.2 - 0.2,
                            s * 1.2 + 0.2, fz - 0.12, fz + 0.1, 'accent_iron', bevel=0.02, seg=1))
    # antenna mast + dish on the hab
    st += S.mast('Antenna', (hx - 1.1, 0.0, hz + r - 0.05), 1.3, r=0.06, dish=0.42)
    # heaters pressed into the ice (glowing melt rings + grilles)
    heaters = ((-0.75, 1.3, 140.0), (-0.8, -1.3, 220.0), (-4.2, 0.35, 0.0))
    for i, (x, y, yaw) in enumerate(heaters):
        hz0 = min(surf(x + dx, y + dy, top) for dx in (-0.4, 0.4) for dy in (-0.35, 0.35)) + 0.12
        hb = []
        hb.append(G.box(f'Heat{i}', -0.45, 0.45, -0.38, 0.38, -0.25, 0.45, 'hull_mid', bevel=0.04, seg=1))
        hb.append(G.box(f'HeatTop{i}', -0.4, 0.4, -0.33, 0.33, 0.45, 0.52, 'hull_light'))
        hb.append(G.box(f'HeatGrille{i}', -0.3, 0.3, -0.24, 0.24, 0.5, 0.56, 'trim_black'))
        for j in range(4):
            gx = -0.22 + j * 0.147
            hb.append(G.box(f'HeatBar{i}{j}', gx - 0.03, gx + 0.03, -0.2, 0.2, 0.52, 0.58, 'cannon_glow'))
        hb.append(G.ring_band(f'HeatMelt{i}', 0.78, 0.6, -0.27, -0.2, 'light_amber', verts=12, smooth=False))
        hb.append(G.ring_band(f'HeatMeltB{i}', 0.62, 0.5, -0.27, -0.19, 'cannon_glow', verts=12, smooth=False))
        for o in hb:
            G.apply_modifiers(o)
            G.bake_transform(o)
            o.data.transform(Matrix.Translation((x, y, hz0)) @ Matrix.Rotation(math.radians(yaw), 4, 'Z'))
        st += hb
        st.append(K.bar(f'HeatPipe{i}', (x, y, hz0 + 0.2), (hx + (0.9 if x > hx else -1.5), 0.0, hz - 0.2), 0.08,
                        'metal_bare'))
    # mooring anchors: pylons driven into the rock with cables to the hab
    anchors = []
    for i, (x, y) in enumerate(((-3.9, 1.55), (-3.9, -1.55))):
        az = surf(x - 0.3, y * 1.25, top) + 0.55
        anchors.append((x - 0.3, y * 1.25, az))
        st.append(K.bar(f'Anchor{i}', (x, y, ICE_C[2] - 0.2), (x - 0.3, y * 1.25, az - 0.05), 0.22, 'hull_dark'))
        st.append(G.box(f'AnchorCap{i}', x - 0.5, x - 0.1, y * 1.25 - 0.2, y * 1.25 + 0.2, az - 0.1, az + 0.1,
                        'accent_iron', bevel=0.02, seg=1))
        st.append(K.bar(f'Moor{i}', (x - 0.3, y * 1.25, az + 0.05), (hx - 1.6, y * 0.2, hz + 0.1), 0.04,
                        'trim_black'))
    # dock arm from the rock face
    arm, bpos = D.arm_dtl('Arm', 0.45, R, w=1.3, gantry=False, z0=-0.5, z1=0.15)
    st += arm
    st.append(G.box('ArmCollar', 0.25, 0.75, -0.95, 0.95, -0.85, 0.35, 'hull_mid', bevel=0.05, seg=1))
    st.append(G.box('ArmCollarB', 0.2, 0.8, -0.98, 0.98, -0.45, -0.3, 'accent_iron'))
    beacons = [(bpos[0], 'light_red'), (bpos[1], 'light_green'), ((hx - 1.1, 0.0, hz + r + 1.35), 'light_amber'),
               ((anchors[0][0], anchors[0][1], anchors[0][2] + 0.25), 'light_amber')]
    zones = _station_zones(R, beacons, 0.45, 1.3, 0.15)
    cfg = D._cfg((), panels=False, density=1.3)
    root, _ = K.finish('Outpost_C', st, atlas_dir, R, beacons, style=STYLE['ice'], seed=seed, zones=zones,
                       static_cfg=cfg, weather_cfg=dict(grime=0.25), beacon='cage')
    return root


# ----------------------------------------------------------------------------
# outpost D - armoured relay outpost (R = 6)
# ----------------------------------------------------------------------------
def build_outpost_d(atlas_dir, seed=7404):
    R = LAYOUTS_D['outpost_d']['R']
    rng = random.Random(seed)
    cx = -1.0
    st = []
    # squat armoured drum
    prof = [(-1.65, 0.0), (-1.65, 1.2), (-1.35, 2.05), (-1.1, 2.3), (0.55, 2.3), (0.7, 2.12), (0.82, 2.12),
            (0.9, 1.75), (0.9, 0.0)]
    mats = ['hull_dark', 'hull_dark', 'pir_gunmetal', 'hull_mid', 'hull_dark', 'pir_hazard', 'hull_mid', 'hull_light']
    st.append(D._lathe('Drum', prof, mats, verts=16, loc=(cx, 0, 0)))
    for j in range(12):          # flak plates around the drum
        pa = j * 30 + 15
        mat = ('pir_gunmetal', 'hull_mid', 'pir_plate_worn')[rng.randrange(3)]
        plates = flak_plate(f'DFlak{j}', 2.4, pa, -1.05, 0.45, 1.05, 12 + rng.uniform(-3, 3), mat, haz=(j % 4 == 1))
        for o in plates:
            G.apply_modifiers(o)
            G.bake_transform(o)
            o.data.transform(Matrix.Translation((cx, 0, 0)))
        st += plates
    st += D._moved(K.ring_lights('DrumL', 2.0, 0.78, 12, 'light_amber', s=0.05, h=0.05, a0=15), (cx, 0, 0))
    # roof: hatch ring + relay mast (lattice) with dishes and emitter
    st.append(G.ring_band('RoofRing', 1.6, 1.3, 0.88, 0.96, 'pir_hazard', loc=(cx, 0, 0), verts=16, smooth=False))
    mast = K.box_truss('Mast', (cx, 0, 0.9), (cx, 0, 5.4), w=0.5, h=0.5, bar_w=0.07, mat='hull_mid',
                       rung_mat='hull_dark', rung=6)
    st += mast
    st.append(G.cyl('MastBase', 0.6, 0.5, 'hull_dark', loc=(cx, 0, 1.15), verts=8, smooth=False))
    for k, (zz, yaw) in enumerate(((2.6, 30.0), (3.6, 200.0))):
        d = (math.cos(math.radians(yaw)), math.sin(math.radians(yaw)))
        arm = G.box(f'DishArm{k}', 0.0, 0.7, -0.05, 0.05, -0.05, 0.05, 'hull_dark')
        G.transform(arm, loc=(cx, 0, zz), rot=(0, 0, yaw))
        st.append(arm)
        dish = [(0.0, 0.0), (0.03, 0.22), (0.12, 0.62), (0.1, 0.66), (0.0, 0.3), (-0.06, 0.0)]
        st.append(G.lathe(f'Dish{k}', dish, [0, 0, 1, 2, 2], ['hull_white', 'accent_iron', 'hull_mid'],
                          loc=(cx + d[0] * 0.85, d[1] * 0.85, zz), axis='Z', verts=14, closed=False,
                          rot=(0, 70, yaw)))
    st.append(G.cyl('Emitter', 0.34, 0.35, 'hull_dark', loc=(cx, 0, 5.55), verts=10, smooth=False))
    st.append(G.ring_band('EmitterGlow', 0.4, 0.3, 5.5, 5.62, 'tier_glow_ti', loc=(cx, 0, 0), verts=10,
                          smooth=False))
    st.append(G.cyl('EmitterTop', 0.2, 0.12, 'hull_mid', loc=(cx, 0, 5.78), verts=8, smooth=False))
    for k in range(3):              # guy wires
        ga = k * 120 + 60
        x, y, _ = _polar(1.95, ga)
        st.append(K.bar(f'Guy{k}', (cx + x, y, 0.92), (cx, 0, 4.2), 0.025, 'metal_bare'))
    # radiator fins on +-Y
    for s in (1, -1):
        y0, y1 = (2.5, 3.8) if s > 0 else (-3.8, -2.5)
        st += K.solar_array(f'Fin{s}', cx - 0.7, cx + 0.7, y0, y1, -0.2, cols=3, rows=2, cell='hull_white')
        st.append(G.box(f'FinArm{s}', cx - 0.12, cx + 0.12, min(s * 2.25, s * 2.55), max(s * 2.25, s * 2.55),
                        -0.3, -0.1, 'hull_dark'))
    arm, bpos = D.arm_dtl('Arm', 1.25, R, w=1.3, gantry=False, z0=-0.5, z1=0.15)
    st += arm
    beacons = [(bpos[0], 'light_red'), (bpos[1], 'light_green'), ((cx, 0.0, 6.1), 'light_red'),
               ((cx - 1.6, 1.0, 1.15), 'light_amber'), ((cx - 1.6, -1.0, 1.15), 'light_amber')]
    zones = _station_zones(R, beacons, 1.25, 1.3, 0.15)
    zones.cyl(cx, 0, 0.75, 0.8, 9)          # mast foot
    cfg = D._cfg((-0.55,), cell=0.9, density=0.7)
    root, _ = K.finish('Outpost_D', st, atlas_dir, R, beacons, style=STYLE['relay'], seed=seed, zones=zones,
                       static_cfg=cfg, weather_cfg=dict(grime=0.38, rust=0.2), beacon='cage')
    return root


BUILDERS = {'station_d': build_station_d, 'station_e': build_station_e, 'outpost_c': build_outpost_c,
            'outpost_d': build_outpost_d}


def layouts_json():
    """Entries in the station_layouts.json format (structures.layouts_json), for the code agent to merge."""
    out = {'_schema': {
        'note': 'batch D station variants - MERGE these entries into art/blender/data/station_layouts.json '
                '(+ src/data copy); the live file is not changed by the art build',
        'units': 'game units = grid cells; local station frame, +X = dock direction, +Y = left',
        'circles': 'list of {x, y, r} collision circles covering the solid structure',
        'radius': 'station radius R (spec 5.4); dock_port lies at (R, 0)',
        'dockPort': '{x, y}: position of the dock_port node (clamp origin, gameplay plane z = 0)',
        'clearRadius': 'no asteroids inside this radius (R + 12 docking gap)'}}
    for k, v in LAYOUTS_D.items():
        out[k] = {'radius': v['R'], 'dockPort': {'x': v['R'], 'y': 0.0},
                  'clearRadius': v['R'] + S.CLEAR_MARGIN,
                  'circles': [{'x': x, 'y': y, 'r': r} for x, y, r in v['circles']]}
    return out
