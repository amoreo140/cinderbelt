"""Home-station modules (spec 7.4 "Home station", M4 + M5a + M5b) that attach to
station_home's attach_<slot> empties (see structures.HOME_SLOTS).

Every module glb: origin = the docking collar of the slot (the pylon's end
face), the module extends along local +X (away from the station), centred on
local y = 0, z = 0 = the collar centre height (slot z = -0.5 below the plane).
Place it with the empty's world transform (position + yaw).  Human station
language (light decks, dark structure, orange belts, warm windows).

  home_module_paint_shop.glb   Lakovna (M4)        spray booth + paint tanks
    Paint_Gantry      spray gantry; slides along local X in code (pivot = its
                      origin at the booth centre line), paint_bay EMPTY = where
                      a ship being painted would hover (optional showcase)
  home_module_trophy_hall.glb  Trofejna sien (M4)  open gallery ring
    trophy_0..5       EMPTY on each pedestal top: the game parents boss
                      trophies / captain replicas here (3D in the dock)
  home_module_refinery.glb     Rafineria (M5a, Index 1)  smelters + 4 output silos
    Refinery_Rotor    centrifuge drum; spin around local +Y (glTF)
  home_module_observatory.glb  Observatorium (M5b, Index 2)  rotating dome + telescope, scout cradle
    Obs_Dome -> Obs_Telescope, scout_bay EMPTY
  home_module_laboratory.glb   Laboratory (M5b)  lab block + containment cylinder, Lab_Relic
  home_module_drone_hub.glb    Dronovy hub (M5b, Index 3)  tower + 3 pads (drone_pad_0..2), DroneHub_Radar

  trophy_fortress.glb          fortress trophy (M4c): Rust Fortress miniature for a trophy_<i>
                               pedestal; origin = pedestal top, +X = launch bay, one mesh

Modules also carry beacon_<i> lamps (blink in code like station beacons).
Layout: art/blender/data/home_modules.json (slots, modules, collision circles
in the module frame and per default slot in the station frame).
"""
import math
import random

import bmesh
from mathutils import Matrix

from lib import geo as G
import asteroid_styles as AST
import structures as S
import pirates as PI

# id -> label, milestone, Index Kovania point, default slot, local collision circles
MODULES = {
    'paint_shop':  dict(file='home_module_paint_shop', label='LAKOVNA  paint shop (M4)', milestone='M4',
                        index=None, slot='fl', circles=[(2.6, 0, 2.4)]),
    'trophy_hall': dict(file='home_module_trophy_hall', label='TROFEJNA SIEN  trophy hall (M4)', milestone='M4',
                        index=None, slot='rl', circles=[(2.7, 0, 2.6)]),
    'refinery':    dict(file='home_module_refinery', label='RAFINERIA  home refinery (M5a, Index 1)',
                        milestone='M5a', index=1, slot='rr', circles=[(2.4, 0, 2.2), (4.6, 1.5, 1.0),
                                                                     (4.6, -1.5, 1.0)]),
    # M5b
    'observatory': dict(file='home_module_observatory', label='OBSERVATORIUM  observatory (M5b, Index 2)',
                        milestone='M5b', index=2, slot='fr', circles=[(3.0, 0, 2.6)]),
    'laboratory':  dict(file='home_module_laboratory', label='LABORATORIUM  laboratory (M5b)', milestone='M5b',
                        index=None, slot='port', circles=[(3.0, 0, 2.7)]),
    'drone_hub':   dict(file='home_module_drone_hub', label='DRONOVY HUB  drone hub (M5b, Index 3)',
                        milestone='M5b', index=3, slot='aft',
                        circles=[(1.3, 0, 1.6), (2.75, 1.65, 1.35), (2.75, -1.65, 1.35), (5.35, 0, 1.35)]),
}
# what the preview attaches where (the game decides at runtime)
PREVIEW_FIT = {'paint_shop': 'fl', 'trophy_hall': 'rl', 'refinery': 'rr', 'observatory': 'fr',
               'laboratory': 'port', 'drone_hub': 'aft'}


def _collar_adapter(st, z0=-0.6, z1=0.6):
    """Short adapter from the pylon collar into the module (all modules)."""
    st.append(G.box('Adapter', 0.0, 0.7, -0.62, 0.62, z0, z1, 'hull_dark', bevel=0.05, seg=1))
    st.append(G.box('AdapterRing', 0.08, 0.2, -0.72, 0.72, z0 - 0.08, z1 + 0.08, 'accent_iron', bevel=0.03, seg=1))


def _finish(name, st, atlas_dir, beacons, extra=()):
    root = G.join(st, name)
    G.finalize(root, atlas_dir)
    for i, (loc, key) in enumerate(beacons):
        b = S.beacon(f'beacon_{i}', (0, 0, 0), key, r=0.2)
        G.finalize(b, atlas_dir)
        b.location = loc
        b.parent = root
    for e in extra:
        e.parent = root
    return root


# ----------------------------------------------------------------------------
# Lakovna - paint shop: open spray booth with a gantry and colour tanks
# ----------------------------------------------------------------------------
PAINTS = ('pir_rust', 'accent_titanium', 'fuel_yellow', 'accent_trader', 'accent_crystal', 'hull_white')


def build_paint_shop(atlas_dir):
    st = []
    _collar_adapter(st)
    # booth floor (dark grating) + side walls with spray nozzles
    st += S.deck_block('Floor', 0.6, 4.8, -2.2, 2.2, -1.2, -0.55)
    st.append(G.box('Grate', 0.95, 4.45, -1.55, 1.55, -0.57, -0.5, 'floor_dark'))
    for k in range(7):
        x = 1.1 + k * 0.5
        st.append(G.box(f'GrateBar{k}', x - 0.03, x + 0.03, -1.5, 1.5, -0.52, -0.47, 'hull_mid'))
    for s in (1, -1):
        st += S.deck_block(f'Wall{s}', 0.7, 4.7, s * 1.75 - 0.3, s * 1.75 + 0.3, -0.55, 1.3)
        for k in range(4):
            x = 1.3 + k * 0.95
            st.append(G.cyl(f'Nozzle{s}{k}', 0.07, 0.2, 'metal_bare', loc=(x, s * 1.4, 0.55), axis='Y', verts=8))
            st.append(G.cyl(f'NozzleTip{s}{k}', 0.05, 0.03, PAINTS[k], loc=(x, s * 1.3, 0.55), axis='Y', verts=8))
        # paint splash stripes on the wall tops (the shop's signature)
        for k, key in enumerate(PAINTS):
            x = 1.0 + k * 0.6
            st.append(G.box(f'Swatch{s}{k}', x, x + 0.45, s * 1.75 - 0.25, s * 1.75 + 0.25, 1.28, 1.34, key))
    # rear: colour tank rack (6 small vertical paint tanks)
    st += S.deck_block('TankDeck', 4.7, 6.1, -2.3, 2.3, -1.0, -0.3)
    for k, key in enumerate(PAINTS):
        y = -1.75 + k * 0.7
        st += S.vtank(f'Paint{k}', (5.4, y, 0.25), 0.28, 1.1, body=key, cap='hull_light')
    st.append(G.box('Manifold', 5.0, 5.15, -2.0, 2.0, -0.35, -0.2, 'metal_bare'))
    # sign board on the roof edge: paint stripes chevron
    st.append(G.box('Sign', 0.75, 0.95, -1.2, 1.2, 1.3, 1.9, 'hull_dark', bevel=0.03, seg=1))
    for k, key in enumerate(PAINTS[:5]):
        y = -1.0 + k * 0.5
        st.append(G.box(f'SignStripe{k}', 0.94, 0.98, y - 0.2, y + 0.2, 1.4, 1.8, key))
    beacons = [((6.0, 2.2, 0.0), 'light_amber'), ((6.0, -2.2, 0.0), 'light_amber')]
    root = _finish('HomeModule_PaintShop', st, atlas_dir, beacons)
    # spray gantry (slides along X): bridge over the booth with 3 spray heads
    gp = []
    for s in (1, -1):
        gp.append(G.box(f'GLeg{s}', -0.15, 0.15, s * 1.75 - 0.15, s * 1.75 + 0.15, 1.3, 2.1, 'accent_iron', bevel=0.03, seg=1))
    gp.append(G.box('GBeam', -0.22, 0.22, -2.0, 2.0, 2.0, 2.35, 'hull_light', bevel=0.04, seg=1))
    gp.append(G.box('GStripe', -0.23, 0.23, -1.5, 1.5, 2.33, 2.38, 'trim_black'))
    for k, y in enumerate((-0.8, 0.0, 0.8)):
        gp.append(G.cyl(f'Head{k}', 0.1, 0.4, 'hull_dark', loc=(0, y, 1.8), verts=10))
        gp.append(G.cyl(f'HeadTip{k}', 0.07, 0.06, PAINTS[k + 1], loc=(0, y, 1.58), verts=10))
    gant = G.join(gp, 'Paint_Gantry')
    G.finalize(gant, atlas_dir)
    gant.location = (2.7, 0, 0)
    gant.parent = root
    bay = G.empty('paint_bay', loc=(2.7, 0, 0.6), size=0.6)
    bay.parent = root
    return root


# ----------------------------------------------------------------------------
# Trofejna sien - open gallery ring with 6 pedestals around a podium
# ----------------------------------------------------------------------------
# trophy_<i> empties: local +X turned so a trophy's front (+X) faces the game / dock camera (it
# always looks north from the south, i.e. along station +Y with station_home's portAngle 0) while the
# hall sits on its default slot: module yaw = -90 - slot yaw
TROPHY_FACING_DEG = (-90.0 - S.HOME_SLOTS[MODULES['trophy_hall']['slot']][3]) % 360.0
def build_trophy_hall(atlas_dir):
    st = []
    _collar_adapter(st)
    cx = 2.8
    # round deck (octagon) + belt
    oct_pts = [(cx + 2.5 * math.cos(math.radians(22.5 + 45 * i)), 2.5 * math.sin(math.radians(22.5 + 45 * i)))
               for i in range(8)]
    st.append(G.prism('Deck', oct_pts, -1.1, -0.45, 'hull_dark', bevel=0.06, seg=1))
    inner = [(cx + (x - cx) * 0.93, y * 0.93) for x, y in oct_pts]
    st.append(G.prism('DeckPlate', inner, -0.5, -0.32, 'hull_light', bevel=0.04, seg=1))
    st.append(G.ring_band('Carpet', 1.75, 1.15, -0.33, -0.3, 'pir_rust', loc=(cx, 0, 0), verts=24))
    for i in range(8):
        a0, a1 = oct_pts[i], oct_pts[(i + 1) % 8]
        st.append(PI.strut(f'Belt{i}', (a0[0], a0[1], -0.8), (a1[0], a1[1], -0.8), 0.18, 'accent_iron'))
    # central podium with a gold laurel ring
    st.append(G.cyl('Podium', 0.65, 0.35, 'hull_white', loc=(cx, 0, -0.15), verts=16, bevel=0.04, seg=1))
    st.append(G.ring_band('Laurel', 0.7, 0.6, 0.0, 0.08, 'ore_copper', loc=(cx, 0, 0), verts=16))
    pedestals = []
    for i in range(6):
        a = math.radians(i * 60 + 30)
        x, y = cx + 1.85 * math.cos(a), 1.85 * math.sin(a)
        st.append(G.cyl(f'Ped{i}', 0.32, 0.55, 'hull_light', loc=(x, y, -0.05), verts=12, bevel=0.03, seg=1))
        st.append(G.ring_band(f'PedTrim{i}', 0.34, 0.28, 0.18, 0.24, 'ore_copper', loc=(x, y, 0), verts=12))
        st.append(G.cyl(f'PedLamp{i}', 0.22, 0.03, 'light_white', loc=(x, y, 0.235), verts=12))
        pedestals.append((x, y, 0.25))
    # ring canopy on 6 slim columns (frame only -> trophies visible from above)
    for i in range(6):
        a = math.radians(i * 60)
        x, y = cx + 2.3 * math.cos(a), 2.3 * math.sin(a)
        st.append(G.cyl(f'Col{i}', 0.08, 1.9, 'hull_mid', loc=(x, y, 0.6), verts=8))
    st.append(G.ring_band('Canopy', 2.45, 2.15, 1.5, 1.7, 'hull_light', loc=(cx, 0, 0), verts=24))
    st.append(G.ring_band('CanopyBelt', 2.47, 2.4, 1.55, 1.65, 'accent_iron', loc=(cx, 0, 0), verts=24))
    st.append(G.ring_band('CanopyLight', 2.18, 2.12, 1.48, 1.52, 'window_warm', loc=(cx, 0, 0), verts=24))
    # banners hanging from the outer canopy belt (one per captain clan colour); outside the ring and on
    # the column angles, so they never cut into a trophy standing on a pedestal (A1 check)
    for i, key in enumerate(('pir_rust', 'fuel_yellow', 'accent_titanium')):
        a = math.radians(120 + i * 60)
        x, y = cx + 2.52 * math.cos(a), 2.52 * math.sin(a)
        b = G.box(f'Banner{i}', -0.03, 0.03, -0.22, 0.22, 0.75, 1.48, key)
        G.transform(b, loc=(x, y, 0), rot=(0, 0, math.degrees(a) + 90))
        st.append(b)
    beacons = [((cx + 2.5, 0, 1.75), 'light_amber')]
    extra = []
    for i, (x, y, z) in enumerate(pedestals):
        e = G.empty(f'trophy_{i}', loc=(x, y, z), size=0.3)
        e.rotation_euler = (0, 0, math.radians(TROPHY_FACING_DEG))
        extra.append(e)
    return _finish('HomeModule_TrophyHall', st, atlas_dir, beacons, extra)


# ----------------------------------------------------------------------------
# Rafineria - home refinery (Index 1): two smelters, a centrifuge, 4 silos
# (composite, superconductor, focusing lens, fuel cell)
# ----------------------------------------------------------------------------
SILOS = (('hull_mid', 'tier_glow_ti'), ('ore_copper', 'battery_glow'), ('accent_crystal', 'cr_gem'),
         ('fuel_yellow', 'fuel_glow'))


def build_refinery(atlas_dir):
    st = []
    _collar_adapter(st)
    st += S.deck_block('Base', 0.6, 5.6, -2.0, 2.0, -1.2, -0.45)
    # two smelter towers with molten crucible glow
    for k, y in enumerate((1.05, -1.05)):
        st.append(G.lathe(f'Smelter{k}', [(-0.45, 0.0), (-0.45, 0.75), (0.6, 0.7), (1.4, 0.48), (1.7, 0.4), (1.7, 0.0)],
                          [0, 1, 2, 3, 3], ['hull_dark', 'hull_light', 'hull_mid', 'hull_dark'], loc=(1.6, y, 0),
                          axis='Z', verts=12, closed=False, smooth=False))
        st.append(G.ring_band(f'SmeltBand{k}', 0.74, 0.66, 0.15, 0.32, 'accent_iron', loc=(1.6, y, 0), verts=12,
                              smooth=False))
        st.append(G.cyl(f'Melt{k}', 0.34, 0.06, 'ember', loc=(1.6, y, 1.68), verts=12))
        st.append(G.ring_band(f'MeltGlow{k}', 0.68, 0.64, 0.55, 0.62, 'cannon_glow', loc=(1.6, y, 0), verts=12,
                              smooth=False))
        st += S.mast(f'Stack{k}', (1.2, y + 0.4 * (1 if y > 0 else -1), 1.5), 0.7, r=0.08)
    # silos at the outer end (x 3.6 .. 5.2)
    for k, (body, cap) in enumerate(SILOS):
        x = 3.75 + (k % 2) * 1.1
        y = 1.0 if k < 2 else -1.0
        st += S.vtank(f'Silo{k}', (x, y, 0.35), 0.42, 1.6, body=body, cap='hull_light')
        st.append(G.cyl(f'SiloCap{k}', 0.2, 0.06, cap, loc=(x, y, 1.18), verts=12))
    # pipe rack + walkway
    st.append(G.box('PipeRack', 2.4, 5.3, -0.12, 0.12, -0.45, 0.9, 'hull_dark', bevel=0.02, seg=1))
    for k, z in enumerate((0.2, 0.5, 0.8)):
        st.append(G.cyl(f'Pipe{k}', 0.06, 4.6, ('metal_bare', 'accent_iron', 'metal_bare')[k], loc=(3.0, 0, z),
                        axis='X', verts=8))
    st.append(G.box('Win', 0.75, 2.2, -2.04, -1.98, -0.85, -0.7, 'window_warm'))
    st.append(G.box('Win2', 0.75, 2.2, 1.98, 2.04, -0.85, -0.7, 'window_warm'))
    beacons = [((5.6, 2.0, -0.2), 'light_amber'), ((5.6, -2.0, -0.2), 'light_amber')]
    root = _finish('HomeModule_Refinery', st, atlas_dir, beacons)
    # centrifuge drum between the smelters
    rp = [G.cyl('Drum', 0.42, 0.5, 'hull_light', verts=16, bevel=0.03, seg=1),
          G.ring_band('DrumBelt', 0.45, 0.38, -0.06, 0.06, 'accent_iron', verts=16),
          G.ring_band('DrumGlow', 0.44, 0.4, 0.17, 0.2, 'reactor_glow', verts=16)]
    for i in range(4):
        b = G.box(f'DrumFin{i}', 0.38, 0.52, -0.04, 0.04, -0.2, 0.2, 'hull_dark')
        G.transform(b, rot=(0, 0, i * 90))
        rp.append(b)
    rotor = G.join(rp, 'Refinery_Rotor')
    G.finalize(rotor, atlas_dir)
    rotor.location = (1.6, 0, 0.0)
    rotor.parent = root
    return root


# ----------------------------------------------------------------------------
# M5b: Observatorium (Index 2) - rotating dome with a slit + telescope, scout drone cradle
# ----------------------------------------------------------------------------
def build_observatory(atlas_dir):
    import kovaci as K  # noqa: F401  (kit reference)
    st = []
    _collar_adapter(st)
    st += S.deck_block('Base', 0.6, 5.3, -2.0, 2.0, -1.2, -0.45)
    # drum the dome sits on (window band)
    st.append(G.cyl('Drum', 1.75, 0.55, 'hull_dark', loc=(2.6, 0, -0.2), verts=24, bevel=0.03, seg=1))
    st.append(G.ring_band('DrumBelt', 1.79, 1.7, -0.32, -0.18, 'accent_iron', loc=(2.6, 0, 0), verts=24))
    st.append(G.ring_band('DrumWin', 1.77, 1.7, -0.08, 0.0, 'window_warm', loc=(2.6, 0, 0), verts=24))
    # comet-tracking antenna array + scout drone launch cradle at the outer end
    for k, y in enumerate((-1.45, 1.45)):
        st += S.mast(f'Ant{k}', (4.65, y, -0.45), 1.0, r=0.05, dish=0.32)
    st += S.deck_block('Cradle', 4.3, 5.2, -0.55, 0.55, -0.6, -0.25, accent='accent_titanium', inset=0.06, plate_h=0.1)
    for s in (1, -1):
        st.append(G.box(f'CradleRail{s}', 4.35, 5.45, s * 0.3 - 0.04, s * 0.3 + 0.04, -0.27, -0.2, 'engine_glow'))
    beacons = [((5.3, 2.0, -0.4), 'light_amber'), ((5.3, -2.0, -0.4), 'light_amber')]
    root = _finish('HomeModule_Observatory', st, atlas_dir, beacons)
    # dome (turns around local +Y glTF / +Z Blender) with the slit and the telescope as a child
    dz = 0.05
    dp = [G.ellipsoid('Dome', 1.62, 1.62, 1.55, 'hull_white', seg=24, rings=12, upper_only=True)]
    # slit: dark glazed strip across the dome top between two raised accent rails (along local X)
    n = 10
    for i in range(n):
        a0 = math.radians(-60 + 120 * i / n)
        a1 = math.radians(-60 + 120 * (i + 1) / n)
        for y0, y1, key, rr in ((-0.42, 0.42, 'glass_frame', 1.585), (0.42, 0.56, 'accent_iron', 1.6),
                                (-0.56, -0.42, 'accent_iron', 1.6)):
            am = (a0 + a1) / 2
            L = rr * (a1 - a0) + 0.02
            b = G.box(f'Slit{i}{key}{y0}', -L / 2, L / 2, y0, y1, -0.03, 0.03 if key != 'glass_frame' else 0.0, key)
            G.transform(b, loc=(rr * math.sin(am), 0, rr * math.cos(am) * 1.55 / 1.62), rot=(0, math.degrees(am), 0))
            dp.append(b)
    dp.append(G.ring_band('DomeBase', 1.66, 1.5, -0.05, 0.12, 'hull_mid', verts=24))
    for o in dp:
        G.apply_modifiers(o)
        G.bake_transform(o)
        o.data.transform(Matrix.Translation((2.6, 0, dz)))
    dome = _node('Obs_Dome', dp, atlas_dir, (2.6, 0, dz), root)
    # telescope tube poking out of the slit (child of the dome; pitch it around its local Y)
    tp = [G.cyl('Tube', 0.32, 2.2, 'hull_light', loc=(0, 0, 0), axis='X', verts=16, bevel=0.02, seg=1),
          G.ring_band('TubeBelt', 0.34, 0.28, -0.35, -0.2, 'accent_titanium', axis='X', verts=16),
          G.ring_band('TubeRim', 0.35, 0.27, 1.05, 1.12, 'hull_dark', axis='X', verts=16),
          G.cyl('Lens', 0.27, 0.03, 'glass_cockpit', loc=(1.1, 0, 0), axis='X', verts=16),
          G.ring_band('LensGlow', 0.3, 0.27, 1.11, 1.13, 'engine_glow', axis='X', verts=16),
          G.cyl('Counter', 0.22, 0.5, 'hull_dark', loc=(-1.25, 0, 0), axis='X', verts=12)]
    for o in tp:
        G.apply_modifiers(o)
        G.bake_transform(o)
        o.data.transform(Matrix.Rotation(math.radians(-48), 4, 'Y'))
    tel = _node('Obs_Telescope', tp, atlas_dir, (0, 0, 0), dome)
    tel.location = (0.25, 0, 0.75)
    bay = G.empty('scout_bay', loc=(4.75, 0, -0.25), size=0.4)
    bay.parent = root
    return root


# ----------------------------------------------------------------------------
# M5b: Laboratory - clean lab block + containment chamber with a Forge-smith relic under analysis
# ----------------------------------------------------------------------------
TUBES = ('reactor_glow', 'laser_glow', 'fuel_glow', 'battery_glow', 'gyro_glow', 'repair_glow')


def build_laboratory(atlas_dir):
    import kovaci as K
    st = []
    _collar_adapter(st)
    st += S.deck_block('Base', 0.6, 5.4, -2.1, 2.1, -1.2, -0.45, plate='hull_white')
    # two-storey lab block toward the station (white, blue-glass window band)
    st += S.deck_block('Lab', 0.75, 2.35, -1.9, 1.9, -0.45, 0.95, plate='hull_white')
    st.append(G.box('LabWin', 2.34, 2.38, -1.6, 1.6, 0.2, 0.45, 'glass_cockpit'))
    st.append(G.box('LabWin2', 0.9, 2.2, 1.89, 1.93, 0.2, 0.45, 'glass_cockpit'))
    st.append(G.box('LabWin3', 0.9, 2.2, -1.93, -1.89, 0.2, 0.45, 'glass_cockpit'))
    st.append(G.box('RoofVent', 1.0, 1.6, -0.9, -0.3, 0.95, 1.15, 'hull_mid', bevel=0.03, seg=1))
    st += S.mast('LabMast', (1.3, 1.2, 0.95), 0.9, r=0.05)
    # containment chamber: ring plinth, glass cylinder (open top rim so the relic reads from above),
    # three analyzer arms with green scan emitters
    cx = 3.85
    st.append(G.cyl('Plinth', 1.45, 0.25, 'hull_dark', loc=(cx, 0, -0.32), verts=24, bevel=0.03, seg=1))
    st.append(G.ring_band('PlinthGlow', 1.47, 1.38, -0.3, -0.24, 'accent_titanium', loc=(cx, 0, 0), verts=24))
    st.append(G.ring_band('Glass', 1.12, 1.07, -0.2, 1.1, 'glass_cockpit', loc=(cx, 0, 0), verts=24))
    st.append(G.ring_band('GlassRim', 1.18, 1.02, 1.1, 1.2, 'hull_light', loc=(cx, 0, 0), verts=24))
    st.append(G.ring_band('GlassFoot', 1.2, 1.0, -0.22, -0.1, 'hull_mid', loc=(cx, 0, 0), verts=24))
    for k in range(3):
        a = math.radians(30 + 120 * k)
        x, y = cx + 1.35 * math.cos(a), 1.35 * math.sin(a)
        st.append(G.cyl(f'ArmPost{k}', 0.12, 1.6, 'hull_light', loc=(x, y, 0.55), verts=10))
        st.append(PI.strut(f'Arm{k}', (x, y, 1.3), (cx + 0.55 * math.cos(a), 0.55 * math.sin(a), 1.45), 0.1, 'hull_mid'))
        st.append(G.cyl(f'Emitter{k}', 0.08, 0.14, 'radar_glow', loc=(cx + 0.5 * math.cos(a), 0.5 * math.sin(a), 1.38),
                        verts=8))
    # sample rack (coloured tubes) on the port side
    st.append(G.box('Rack', 2.45, 2.95, 1.25, 1.95, -0.45, 0.15, 'hull_mid', bevel=0.02, seg=1))
    for k, key in enumerate(TUBES):
        st.append(G.cyl(f'Tube{k}', 0.06, 0.4, key, loc=(2.55 + (k % 3) * 0.17, 1.42 + (k // 3) * 0.32, 0.3), verts=8))
    beacons = [((5.4, 2.1, -0.4), 'light_amber'), ((5.4, -2.1, -0.4), 'light_amber')]
    root = _finish('HomeModule_Laboratory', st, atlas_dir, beacons)
    # the relic: a Forge-smith obsidian shard with ember glyph cuts + violet crystal, levitating (spin/bob)
    rp = [K.octa('Shard', 0.42, 0.75, 'kov_obsidian', loc=(0, 0, 0)),
          K.octa('Crystal', 0.16, 0.38, 'kov_crystal', loc=(0.0, 0.0, 0.62)),
          G.ring_band('Halo', 0.62, 0.55, -0.03, 0.03, 'kov_bronze', verts=12)]
    for k in range(4):
        g = G.box(f'Glyph{k}', -0.02, 0.02, -0.03, 0.03, -0.12 + 0.1 * (k % 2), 0.1 + 0.1 * (k % 2), 'kov_ember')
        G.transform(g, loc=(0.3 * math.cos(math.radians(45 + 90 * k)), 0.3 * math.sin(math.radians(45 + 90 * k)), 0.0),
                    rot=(0, 0, 45 + 90 * k))
        rp.append(g)
    for o in rp:
        G.apply_modifiers(o)
        G.bake_transform(o)
        o.data.transform(Matrix.Translation((cx, 0, 0.45)))
    _node('Lab_Relic', rp, atlas_dir, (cx, 0, 0.45), root)
    return root


# ----------------------------------------------------------------------------
# M5b: Dronovy hub (Index 3, +3 drone routes) - control tower + three landing pads
# ----------------------------------------------------------------------------
HUB_PADS = ((2.75, 1.65), (2.75, -1.65), (5.35, 0.0))


def build_drone_hub(atlas_dir):
    st = []
    _collar_adapter(st)
    # Y-shaped deck carrying the three pads
    st += S.deck_block('Spine', 0.6, 5.4, -0.7, 0.7, -1.15, -0.5)
    st += S.deck_block('Arms', 2.0, 3.5, -2.9, 2.9, -1.15, -0.5)
    st.append(G.box('Hangar', 0.7, 1.9, -1.45, 1.45, -1.1, 0.35, 'hull_light', bevel=0.05, seg=1))
    st.append(G.box('HangarDoor', 1.88, 1.93, -1.15, 1.15, -0.95, 0.15, 'hull_dark'))
    for k in range(4):
        z = -0.85 + k * 0.26
        st.append(G.box(f'DoorRib{k}', 1.9, 1.95, -1.1, 1.1, z, z + 0.05, 'hull_mid'))
    st.append(G.box('HangarBelt', 0.68, 1.92, -1.47, 1.47, -0.3, -0.15, 'accent_iron', bevel=0.02, seg=1))
    # control tower with a cab (windows) on the hangar
    st.append(G.cyl('Tower', 0.28, 1.4, 'hull_mid', loc=(1.15, 0, 1.0), verts=10))
    st.append(G.cyl('Cab', 0.55, 0.45, 'hull_light', loc=(1.15, 0, 1.85), verts=10, bevel=0.03, seg=1))
    st.append(G.ring_band('CabWin', 0.57, 0.5, 1.8, 1.98, 'window_warm', loc=(1.15, 0, 0), verts=10))
    st.append(G.cyl('CabRoof', 0.6, 0.08, 'accent_iron', loc=(1.15, 0, 2.12), verts=10))
    pads = []
    for i, (x, y) in enumerate(HUB_PADS):
        st.append(G.cyl(f'Pad{i}', 1.3, 0.22, 'hull_dark', loc=(x, y, -0.55), verts=24, bevel=0.03, seg=1))
        st.append(G.cyl(f'PadTop{i}', 1.22, 0.05, 'floor_dark', loc=(x, y, -0.42), verts=24))
        st.append(G.ring_band(f'PadRing{i}', 1.08, 0.96, -0.4, -0.37, 'engine_glow', loc=(x, y, 0), verts=24))
        st.append(G.ring_band(f'PadBelt{i}', 1.33, 1.26, -0.62, -0.52, 'accent_iron', loc=(x, y, 0), verts=24))
        # route number ticks (1/2/3 short bars)
        for k in range(i + 1):
            st.append(G.box(f'Tick{i}{k}', x - 0.3 + k * 0.22, x - 0.18 + k * 0.22, y - 0.05, y + 0.05, -0.39, -0.375,
                            'light_white'))
        pads.append((x, y, -0.37))
    beacons = [((x + 1.15 * math.cos(math.radians(a)), y + 1.15 * math.sin(math.radians(a)), -0.35),
                'light_green' if a == 0 else 'light_amber') for x, y in HUB_PADS for a in (0, 180)]
    beacons.append(((1.15, 0, 2.25), 'light_red'))
    extra = [G.empty(f'drone_pad_{i}', loc=p, size=0.4) for i, p in enumerate(pads)]
    root = _finish('HomeModule_DroneHub', st, atlas_dir, beacons, extra)
    # spinning traffic radar on the cab roof
    rp = S.mast('RMast', (0, 0, 0), 0.35, r=0.04)
    prof = [(0.0, 0.0), (0.02, 0.2), (0.08, 0.45), (0.06, 0.48), (0.0, 0.22), (-0.04, 0.0)]
    rp.append(G.lathe('RDish', prof, [0, 0, 1, 2, 2], ['hull_white', 'accent_iron', 'hull_mid'],
                      loc=(0.0, 0, 0.4), axis='Z', verts=14, closed=False, rot=(0, 60, 0)))
    for o in rp:
        G.apply_modifiers(o)
        G.bake_transform(o)
        o.data.transform(Matrix.Translation((1.15, 0, 2.16)))
    _node('DroneHub_Radar', rp, atlas_dir, (1.15, 0, 2.16), root)
    return root


def _node(name, parts, atlas_dir, pivot, parent):
    ob = G.join(parts, name)
    G.finalize(ob, atlas_dir)
    ob.data.transform(Matrix.Translation([-c for c in pivot]))
    ob.location = pivot
    ob.parent = parent
    return ob


# ----------------------------------------------------------------------------
# Trophy: Rust Fortress miniature for a trophy-hall pedestal (M4c, task A1)
# ----------------------------------------------------------------------------
# Room on one trophy-hall pedestal (pedestals 1.85 from the podium and 1.85 apart, canopy
# columns 1.16 away, canopy 1.25 above the pedestal top): a trophy must stay inside this box.
TROPHY_FIT = dict(maxExtent=1.6, maxHeight=1.15)
TROPHY_FORTRESS = dict(file='trophy_fortress', label='HRDZAVA PEVNOST  fortress trophy (miniature, M4c)')


def _rod(name, p0, p1, w, mat='pir_gunmetal_dark'):
    """Square bar from p0 to p1 without bevels (12 tris; pirates.strut bevels to 44)."""
    from mathutils import Vector
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    ob = G.box(name, 0.0, d.length, -w / 2, w / 2, -w / 2, w / 2, mat)
    q = Vector((1, 0, 0)).rotation_difference(d.normalized())
    ob.data.transform(Matrix.Translation(p0) @ q.to_matrix().to_4x4())
    return ob


def _mini_lamp(name, loc, key, r):
    return G.ellipsoid(name, r, r, r, key, loc=loc, seg=6, rings=4)


def _mini_rock(rng, radius, pad):
    """Low-poly fortress rock: squashed lumpy icosphere, levelled top pad, a few planar cuts.
    Faces get a lit / side / underside rock swatch (fake AO without vertex colours)."""
    bm = AST.sculpt_bm(rng, radius, subdiv=3, amp=0.22, detail=0.4, lobes=(2, 3), craters=(1, 1),
                       squash=(0.36, 0.4))
    bmesh.ops.translate(bm, vec=(0, 0, -0.6 * radius / 9.0), verts=bm.verts)
    res = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                                 plane_co=(0, 0, pad), plane_no=(0, 0, 1), clear_outer=True)
    bmesh.ops.edgenet_fill(bm, edges=[e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)])
    AST.planar_cuts(bm, rng, 3, depth=(0.88, 0.93))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    for f in bm.faces:
        n = f.normal.z
        f.material_index = 0 if n > 0.35 else (1 if n > -0.45 else 2)
    ob = G.obj_from_bm('MiniRock', bm, ['st_rock_iron', 'rock_iron_3', 'rock_iron_2'])
    G.set_smooth(ob, False)
    return ob


def build_trophy_fortress(atlas_dir, seed=4242):
    """Miniature of the Rust Fortress (pirates.build_fortress) for a trophy pedestal.

    Built in fortress units with the read-at-a-glance features exaggerated (ember core in its
    armoured well, launch bay with the red mouth at +X, two red shield-generator orbs behind the
    rock, the clan totem with its claw banner, turret mounts on the rim), then scaled into
    TROPHY_FIT and set on a small display stand.  One mesh, AF_Palette, no vertex colours.
    Origin = the pedestal top (stand foot at z = 0), +X = front (launch bay)."""
    rng = random.Random(seed)
    PAD = PI.PAD
    plate = PI.plate
    st = [_mini_rock(rng, PI.ROCK_R, PAD)]
    # rim crags (break the round cake silhouette; keep the launch bay clear)
    for i in range(6):
        a = math.radians(i * 60 + 30 + rng.uniform(-10, 10))
        if math.cos(a) > 0.75:
            continue
        cb = AST.sculpt_bm(rng, rng.uniform(1.4, 2.0), subdiv=1, amp=0.3, detail=0.3, lobes=(1, 1),
                           craters=(0, 0), stretch=1.5, squash=(0.55, 0.7))
        cr = G.obj_from_bm(f'Crag{i}', cb, ['rock_iron_3'])
        G.set_smooth(cr, False)
        R = PI.ROCK_R * rng.uniform(0.86, 0.94)
        G.transform(cr, loc=(R * math.cos(a), R * math.sin(a), PAD - rng.uniform(0.8, 1.4)),
                    rot=(rng.uniform(-15, 15), rng.uniform(-25, 25), math.degrees(a)))
        st.append(cr)
    # pad deck plates (big, few)
    for i in range(9):
        a = math.radians(i * 40 + rng.uniform(-12, 12))
        r = rng.uniform(4.4, 6.6)
        x, y = r * math.cos(a), r * math.sin(a)
        if x > 3.4 and abs(y) < 3.4:
            continue
        st.append(plate(f'Deck{i}', (x, y, PAD + 0.08), (rng.uniform(2.0, 2.8), rng.uniform(1.4, 2.2), 0.25),
                        rot=(0, 0, rng.uniform(0, 180)), mat=PI.SCRAP[i % len(PI.SCRAP)], bevel=0.0))
    # core well + oversized ember core (the hero read)
    st.append(G.lathe('Well', [(PAD - 0.2, 3.7), (PAD + 1.1, 3.5), (PAD + 1.6, 3.0), (PAD + 1.6, 2.4),
                               (PAD + 0.3, 2.2), (PAD + 0.3, 0.0)],
                      [0, 1, 2, 0, 3], ['pir_gunmetal_dark', 'pir_gunmetal', 'pir_rust', 'trim_black'],
                      axis='Z', verts=10, closed=False, smooth=False))
    for i in range(5):
        a = i * 72 + 36
        b = plate(f'Buttress{i}', (0, 0, 0), (1.1, 0.7, 1.9), mat='pir_rust' if i % 2 else 'pir_gunmetal',
                  bevel=0.0)
        G.transform(b, loc=(3.6 * math.cos(math.radians(a)), 3.6 * math.sin(math.radians(a)), PAD + 0.6),
                    rot=(0, 18, a))
        st.append(b)
    st.append(G.ellipsoid('Core', 2.0, 2.0, 1.7, 'kov_ember', loc=(0, 0, PAD + 1.5), seg=10, rings=5))
    st.append(G.torus('CoreHoop', 2.15, 0.22, 'pir_gunmetal_dark', loc=(0, 0, PAD + 1.5), rot=(90, 0, 30),
                      maj=10, mnr=3, smooth=False))
    st.append(G.torus('CoreHoop2', 2.15, 0.22, 'pir_rust', loc=(0, 0, PAD + 1.5), rot=(90, 0, 150),
                      maj=10, mnr=3, smooth=False))
    # launch bay (+X): hangar body, rust ribs, black mouth with red glow strips, sloped brow
    hx0, hx1, hw, hz0, hz1 = 3.6, 11.0, 2.9, -1.0, 3.0
    st.append(plate('BayBody', ((hx0 + hx1) / 2, 0, (hz0 + hz1) / 2), (hx1 - hx0, 2 * hw, hz1 - hz0),
                    mat='pir_gunmetal', bevel=0.0))
    for k in range(3):
        x = hx0 + 1.6 + k * 2.3
        st.append(plate(f'BayRib{k}', (x, 0, (hz0 + hz1) / 2), (0.6, 2 * hw + 0.4, hz1 - hz0 + 0.4),
                        mat='pir_rust' if k % 2 == 0 else 'pir_gunmetal_dark', bevel=0.0))
    st.append(plate('MouthFrame', (hx1 + 0.2, 0, (hz0 + hz1) / 2), (0.6, 2 * hw + 0.6, hz1 - hz0 + 0.6),
                    mat='pir_gunmetal_dark', bevel=0.0))
    st.append(plate('MouthHole', (hx1 + 0.45, 0, (hz0 + hz1) / 2 - 0.1), (0.3, 2 * hw - 1.2, hz1 - hz0 - 1.0),
                    mat='trim_black', bevel=0.0))
    for s in (1, -1):
        st.append(plate(f'MouthGlow{s}', (hx1 + 0.58, s * (hw - 0.75), (hz0 + hz1) / 2),
                        (0.12, 0.45, hz1 - hz0 - 1.2), mat='pir_glow_red', bevel=0.0))
    st.append(plate('MouthSill', (hx1 + 0.58, 0, hz0 + 0.55), (0.12, 2 * hw - 1.2, 0.35), mat='pir_glow_red',
                    bevel=0.0))
    brow = G.prism('Brow', [(-1.2, -hw - 0.3), (0.8, -hw - 0.3), (0.8, hw + 0.3), (-1.2, hw + 0.3)], 0.0, 0.6,
                   'pir_rust')
    G.transform(brow, loc=(hx1 - 0.2, 0, hz1 - 0.1), rot=(0, 16, 0))
    st.append(brow)
    for k in range(4):   # hazard stripes on the brow
        t = plate(f'BrowHaz{k}', (0, 0, 0), (0.5, 0.6, 0.08), mat='pir_hazard', bevel=0.0)
        G.transform(t, loc=(hx1 + 0.05, -hw + 0.9 + k * (2 * hw - 1.8) / 3, hz1 + 0.62), rot=(0, 16, 0))
        st.append(t)
    # scrap walls + a few spikes along the pad rim
    for i in range(14):
        a = 2 * math.pi * (i + 0.5) / 14
        x, y = 7.4 * math.cos(a), 7.4 * math.sin(a)
        if x > 3.0 and abs(y) < 3.8:
            continue
        h = 1.4 + (0.9 if i % 3 == 0 else 0.0)
        st.append(plate(f'Wall{i}', (x, y, PAD + h / 2 - 0.1), (0.6, 2.6, h),
                        rot=(0, rng.uniform(-8, 4), math.degrees(a)), mat=PI.SCRAP[(i * 3) % len(PI.SCRAP)],
                        bevel=0.0))
        if i % 3 == 0:
            st += PI.spikes(f'WSpike{i}', (x, y), 0.3, 2, PAD + h - 0.2, 1.4, rng)
    # turret mounts with stubby pirate cannons pointing outward
    for i, (x, y, z, a) in enumerate(PI.TURRETS):
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        st.append(G.cyl(f'TPlat{i}', 1.45, 0.5, 'pir_rust' if i < 2 else 'pir_gunmetal', loc=(x, y, z - 0.45),
                        verts=8))
        st.append(G.cyl(f'TDome{i}', 0.85, 0.7, 'pir_gunmetal_dark', loc=(x, y, z + 0.15), verts=8, r2=0.6))
        bar = G.cyl(f'TBarrel{i}', 0.2, 2.0, 'pir_gunmetal_dark', loc=(1.0, 0, 0), axis='X', verts=6)
        G.transform(bar, loc=(x, y, z + 0.25), rot=(0, 0, a))
        st.append(bar)
        st.append(G.cyl(f'TMuzzle{i}', 0.16, 0.12, 'pir_glow_red', loc=(x + 2.0 * ca, y + 2.0 * sa, z + 0.25),
                        axis='X', verts=6))
        st.append(_rod(f'TBrace{i}', (x - 0.9 * ca, y - 0.9 * sa, z - 0.6),
                           (x - 3.0 * ca, y - 3.0 * sa, PAD - 1.4), 0.35))
    # shield generators behind the rock (-X): plinth, column, prongs + big red orb
    for i, (x, y) in enumerate(PI.GENS):
        z0 = PAD - 0.2
        st.append(G.cyl(f'GenPlinth{i}', 1.9, 1.8, 'pir_gunmetal_dark', loc=(x, y, z0 - 0.7), verts=8))
        st.append(G.ring_band(f'GenRim{i}', 1.98, 1.6, z0 + 0.0, z0 + 0.25, 'pir_hazard', loc=(x, y, 0), verts=8,
                              smooth=False))
        st.append(G.cyl(f'GenCol{i}', 0.75, 3.2, 'pir_gunmetal', loc=(x, y, z0 + 1.8), verts=8, r2=0.55))
        for k in range(3):
            a = math.radians(k * 120 + 60)
            st.append(_rod(f'GenProng{i}{k}', (x + 0.4 * math.cos(a), y + 0.4 * math.sin(a), z0 + 3.2),
                               (x + 1.4 * math.cos(a), y + 1.4 * math.sin(a), z0 + 4.6), 0.3, 'pir_rust'))
        st.append(G.ellipsoid(f'GenOrb{i}', 1.25, 1.25, 1.25, 'pir_glow_red', loc=(x, y, z0 + 4.3), seg=10,
                              rings=6))
        st.append(_rod(f'GenCable{i}', (x + 1.4, y * 0.85, PAD - 0.2), (-3.4, y * 0.4, PAD + 0.5), 0.45,
                           'pir_rust_dark'))
    # clan totem with the claw banner (oversized: the trophy's signature from the top)
    tx, ty = 0.4, -4.6
    st.append(G.cyl('TotemPole', 0.35, 6.4, 'pir_gunmetal_dark', loc=(tx, ty, PAD + 3.2), verts=6))
    st.append(plate('Banner', (tx + 0.1, ty - 2.05, PAD + 4.0), (0.25, 3.7, 3.6), mat='pir_rust', bevel=0.0))
    for s in (1, -1):
        for k in range(3):
            sl = plate(f'Claw{s}{k}', (0, 0, 0), (0.1, 0.38, 2.6), mat='pir_gunmetal_dark', bevel=0.0)
            G.transform(sl, loc=(tx + 0.1 + s * 0.15, ty - 1.05 - k * 0.95, PAD + 4.0), rot=(-18, 0, 0))
            st.append(sl)
    st.append(plate('BannerBar', (tx, ty - 2.0, PAD + 5.9), (0.3, 4.3, 0.3), mat='pir_gunmetal', bevel=0.0))
    st += PI.spikes('TotemSpike', (tx, ty), 0.05, 3, PAD + 6.3, 1.2, rng)
    st.append(_mini_lamp('TotemLamp', (tx, ty, PAD + 6.8), 'light_red', 0.45))
    # one antenna mast with a red lamp + crates (scale cues)
    st.append(G.cyl('Mast', 0.18, 3.4, 'pir_gunmetal', loc=(-5.0, 2.4, PAD + 1.7), verts=6))
    st.append(_mini_lamp('MastLamp', (-5.0, 2.4, PAD + 3.6), 'light_red', 0.45))
    for k, (x, y, r_) in enumerate(((-3.6, -4.8, 12), (-2.0, -5.6, -8))):
        st.append(plate(f'Crate{k}', (x, y, PAD + 0.6), (2.0, 1.2, 1.1), rot=(0, 0, r_),
                        mat=('pir_hazard', 'pir_rust')[k], bevel=0.0))
    ob = G.join(st, 'Trophy_Fortress')
    # scale into the pedestal box, centre it on the origin, lift onto the display stand
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]
    zs = [v.co.z for v in ob.data.vertices]
    stand = 0.16
    k = min(TROPHY_FIT['maxExtent'] / max(max(xs) - min(xs), max(ys) - min(ys)),
            (TROPHY_FIT['maxHeight'] - stand) / (max(zs) - min(zs)))
    ob.data.transform(Matrix.Translation((-(max(xs) + min(xs)) / 2 * k, -(max(ys) + min(ys)) / 2 * k,
                                          stand - min(zs) * k)) @ Matrix.Scale(k, 4))
    sp = [ob,
          G.cyl('StandFoot', 0.26, 0.06, 'pir_gunmetal_dark', loc=(0, 0, 0.03), verts=8),
          G.cyl('StandBand', 0.21, 0.03, 'pir_rust', loc=(0, 0, 0.07), verts=8),
          G.cyl('StandPost', 0.05, stand, 'pir_gunmetal', loc=(0, 0, 0.06 + stand / 2), verts=6)]
    ob = G.join(sp, 'Trophy_Fortress')
    G.finalize(ob, atlas_dir)
    return ob


BUILDERS = {MODULES[k]['file']: f for k, f in (('paint_shop', build_paint_shop), ('trophy_hall', build_trophy_hall),
                                               ('refinery', build_refinery), ('observatory', build_observatory),
                                               ('laboratory', build_laboratory), ('drone_hub', build_drone_hub))}
BUILDERS[TROPHY_FORTRESS['file']] = build_trophy_fortress


def _slot_circles(slot, circles):
    x, y, z, yaw = S.HOME_SLOTS[slot]
    c, s = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    return [{'x': round(x + cx * c - cy * s, 3), 'y': round(y + cx * s + cy * c, 3), 'r': r} for cx, cy, r in circles]


LAYOUTS = {}   # coverage is checked in the module frame by preview, not per glb


def layouts_json():
    out = {'_schema': {
        'station': 'modules attach to this station glb (stations/station_home.glb)',
        'slots': 'attach point = EMPTY node `attach_<slot>` on station_home: position {x, y, z} in the station frame '
                 '(+X dock direction, +Y left, z up = Blender), yawDeg = rotation about the up axis; the module '
                 'glb origin goes on the empty and its +X along the empty +X',
        'modules': 'file (models/stations/<file>.glb), label, milestone, Index Kovania point (null = cosmetic), '
                   'defaultSlot, circles = collision circles in the MODULE frame (+X away from the station), '
                   'circlesAtDefaultSlot = the same circles in the station frame (add them to station_home circles '
                   'while the module is built)',
        'nodes': 'animated / special child nodes of the module'}}
    out['station'] = 'station_home'
    out['slots'] = {k: {'node': f'attach_{k}', 'x': round(v[0], 3), 'y': round(v[1], 3), 'z': v[2], 'yawDeg': v[3]}
                    for k, v in S.HOME_SLOTS.items()}
    nodes = {'paint_shop': {'Paint_Gantry': 'slides along local X (+-1.2) while painting',
                            'paint_bay': 'EMPTY, showcase spot of a ship being painted'},
             'trophy_hall': {f'trophy_{i}': f'EMPTY on a pedestal top: parent a trophy here; local +X (yaw '
                                            f'{TROPHY_FACING_DEG:.0f} deg in the module) faces the dock camera '
                                            '(screen down, sim -y) on the default slot rl'
                             for i in range(6)},
             'refinery': {'Refinery_Rotor': 'spin around local +Y (glTF up)'},
             'observatory': {'Obs_Dome': 'dome with the slit: turn around local +Y (glTF up), pivot = dome centre',
                             'Obs_Telescope': 'child of the dome, pitched 48 deg; may nod around its local Z (glTF)',
                             'scout_bay': 'EMPTY on the launch cradle: the scout drone (drones/drone_scout) parks '
                                          'here (origin + landingHeight), launches along +X'},
             'laboratory': {'Lab_Relic': 'Kovaci relic under analysis: slow spin around local +Y + bob; hide when '
                                         'no relic is being analysed'},
             'drone_hub': {'drone_pad_0..2': 'EMPTY landing spots of the 3 extra drone routes (pad tops)',
                           'DroneHub_Radar': 'traffic radar on the tower cab, spin around local +Y'}}
    out['modules'] = {}
    for k, v in MODULES.items():
        out['modules'][k] = {'file': v['file'], 'label': v['label'], 'milestone': v['milestone'],
                             'index': v['index'], 'defaultSlot': v['slot'],
                             'circles': [{'x': x, 'y': y, 'r': r} for x, y, r in v['circles']],
                             'circlesAtDefaultSlot': _slot_circles(v['slot'], v['circles']),
                             'nodes': nodes.get(k, {})}
    out['trophies'] = {
        '_schema': 'trophy models for the trophy_<i> pedestals: file (models/stations/<file>.glb), origin = the '
                   'pedestal top (parent it to trophy_<i> with identity transform), +X = front; fit = the room on '
                   'one pedestal (max horizontal extent / max height above the pedestal top) - captain replicas '
                   'must be scaled into it too',
        'fit': dict(TROPHY_FIT),
        'fortress': {'file': TROPHY_FORTRESS['file'], 'label': TROPHY_FORTRESS['label'],
                     'nodes': {'Trophy_Fortress': 'root mesh (one draw call, no vertex colours); may turn slowly '
                                                  'around local +Y (glTF up)'}}}
    out['futureModules'] = {'forge_vyhen': 'M6b',
                            '_note': 'all six slots have a default module after M5b; the Vyhen (Index 4) needs a '
                                     'new slot or replaces one (decide in M6b)'}
    return out
