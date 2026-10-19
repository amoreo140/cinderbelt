"""Art batch C5 (art audit 2026-10-16 §6 C): civilian NPC traffic - four ship
kinds next to the M4 trader, in the human hull language with the faction read by
colour, flown by src/render/traffic/StationTraffic.ts (render only).

npc/miner_barge.glb  Guild ore barge   ~9.6 x 5   orange hazard, open ore hopper (Barge_Ore), two drill arms
npc/tanker.glb       fuel tanker       ~11.3 x 3  three fuel-yellow sphere tanks on a spine
npc/courier.glb      Free Traders courier ~4.3 x 2.6  green trader belts, fast dart
npc/survey_ship.glb  Institute survey ship ~8.6 x 4  Institute cyan trim, big Survey_Dish, sensor boom

Node contract = npc/trader.glb (README §2.3), so StationTraffic works unchanged:
  thruster_<i>  EMPTY at each nozzle exit, local +X = exhaust direction (backward) - flame origin
  beacon_<i>    lamp MESH (origin = lamp centre): 0 port red (+Y), 1 starboard green (-Y), 2.. white / amber
Extra nodes: Barge_Ore (hide when empty), Drill_0/1 (spin around local +X), Survey_Dish (spin around +Y glTF).
Manifest npc/npc_ships.json (also lists the Guild Watch ships from guild.py).
"""
import json
import math
import os
import random

from lib import geo as G
from lib import greebles as GR
import guild as GU
import paths
import structures as S

ORANGE = 'accent_iron'
TRADER = 'accent_trader'
INST = 'accent_institute'


def _finish(st, name, seed, atlas_dir, grime=0.2, rust=0.0):
    root = G.join(st, name)
    GR.weather(root, random.Random(seed), ao=0.55, near=0.35, far=1.6, grime=grime, panel=0.06, under=0.2, soot=0.4,
               rust=rust)
    G.finalize(root, atlas_dir)
    return root


def _lamps(root, atlas_dir, lamps, r=0.13):
    for i, (loc, key) in enumerate(lamps):
        GU.lamp(f'beacon_{i}', loc, key, r=r, atlas_dir=atlas_dir, parent=root, col=True)


def _thrusters(root, pts):
    for i, p in enumerate(pts):
        GU.empty(f'thruster_{i}', p, root, yaw_deg=180)


def _bell_set(st, name, x, y, z, r):
    st.append(GU.bell(name, x, y, z, r=r, L=0.45))
    st.append(G.ring_band(name + 'Glow', r, r * 0.86, -0.025, 0.025, 'engine_glow', loc=(x - 0.43, y, z), axis='X',
                          verts=16))
    st.append(G.cyl(name + 'Core', r * 0.58, 0.03, 'engine_core', loc=(x - 0.02, y, z), axis='X', verts=12))


# ----------------------------------------------------------------------------
# miner barge (Guild)
# ----------------------------------------------------------------------------
def build_barge(atlas_dir):
    rng = random.Random(7)
    st = S.deck_block('Hull', -3.9, 3.0, -2.25, 2.25, -0.95, 0.25, accent=ORANGE)
    # open hopper walls with an orange / black hazard rim
    for s in (1, -1):
        st.append(G.box(f'WallS{s}', -2.75, 1.75, s * 1.85 - 0.14, s * 1.85 + 0.14, 0.2, 0.95, 'hull_mid', bevel=0.03,
                        seg=1))
    for x in (-2.75, 1.75):
        st.append(G.box(f'WallE{x}', x - 0.14, x + 0.14, -1.95, 1.95, 0.2, 0.95, 'hull_mid', bevel=0.03, seg=1))
    st.append(G.box('HopperFloor', -2.62, 1.62, -1.72, 1.72, 0.22, 0.3, 'floor_dark'))
    n = 0
    for s in (1, -1):
        for k in range(9):
            x = -2.75 + k * 0.5
            st.append(G.box(f'HazS{s}{k}', x, x + 0.25, s * 1.85 - 0.15, s * 1.85 + 0.15, 0.95, 1.0,
                            ORANGE if (k + n) % 2 == 0 else 'trim_black'))
    for x in (-2.75, 1.75):
        for k in range(7):
            y = -1.75 + k * 0.5
            st.append(G.box(f'HazE{x}{k}', x - 0.15, x + 0.15, y, y + 0.25, 0.95, 1.0,
                            ORANGE if k % 2 == 0 else 'trim_black'))
    # wall ribs
    for s in (1, -1):
        for k in range(4):
            x = -2.2 + k * 1.15
            st.append(G.box(f'Rib{s}{k}', x - 0.08, x + 0.08, s * 2.0 - 0.05, s * 2.0 + 0.12 * s + 0.05 * s,
                            -0.6, 0.9, 'hull_dark'))
    # cab at the bow (raised, glass band)
    st += S.deck_block('Cab', 2.15, 3.45, -1.0, 1.0, 0.2, 1.25, accent=ORANGE)
    st.append(G.prism('CabGlass', [(3.5, -0.8), (3.5, 0.8), (3.2, 0.95), (3.2, -0.95)], 0.75, 1.05, 'glass_cockpit',
                      bevel=0.02, seg=1))
    st += S.mast('CabMast', (2.5, 0.6, 1.25), 0.7, r=0.04)
    # drill arms forward from the bow corners
    for s in (1, -1):
        st.append(G.box(f'Arm{s}', 2.8, 4.25, s * 1.65 - 0.2, s * 1.65 + 0.2, -0.55, -0.15, 'hull_dark', bevel=0.03,
                        seg=1))
        st.append(G.box(f'ArmPlate{s}', 2.9, 4.1, s * 1.65 - 0.17, s * 1.65 + 0.17, -0.15, -0.08, ORANGE))
        st.append(G.cyl(f'Piston{s}', 0.07, 1.1, 'metal_bare', loc=(3.4, s * 1.65, -0.02), axis='X', verts=8))
        st.append(G.cyl(f'DrillMotor{s}', 0.28, 0.4, 'hull_mid', loc=(4.3, s * 1.65, -0.35), axis='X', verts=12,
                        bevel=0.02, seg=1))
    # drive
    st += S.deck_block('Drive', -4.55, -3.8, -1.7, 1.7, -0.9, 0.35, accent=ORANGE)
    for k, y in enumerate((-1.0, 1.0)):
        _bell_set(st, f'Bell{k}', -4.55, y, -0.3, 0.48)
    st.append(G.box('RadFin', -4.45, -3.9, -1.4, 1.4, 0.35, 0.55, 'hull_mid', bevel=0.02, seg=1))
    root = _finish(st, 'Miner_Barge', 8, atlas_dir, grime=0.4, rust=0.2)
    # ore pile node (hide when the hold is empty)
    ore = []
    for k in range(26):
        x, y = rng.uniform(-2.4, 1.4), rng.uniform(-1.45, 1.45)
        r = rng.uniform(0.22, 0.42)
        e = G.ellipsoid(f'Ore{k}', r, r * rng.uniform(0.8, 1.2), r * 0.7, 'st_rock_iron' if k % 3 else 'ore_iron',
                        loc=(x, y, 0.32 + r * 0.5), seg=6, rings=4, smooth=False)
        G.transform(e, rot=(0, 0, rng.uniform(0, 90)))
        ore.append(e)
    ob = G.join(ore, 'Barge_Ore')
    GR.weather(ob, random.Random(9), ao=0.5, near=0.25, far=1.0, grime=0.3)
    G.finalize(ob, atlas_dir)
    ob.parent = root
    for i, s in enumerate((1, -1)):
        bit = [G.lathe(f'Bit{i}', [(0.0, 0.24), (0.55, 0.16), (0.85, 0.0)], [0, 0], ['metal_bare'], axis='X',
                       verts=8, closed=False, smooth=False),
               G.ring_band(f'BitCollar{i}', 0.26, 0.16, -0.05, 0.05, ORANGE, axis='X', verts=8, smooth=False)]
        for k in range(3):    # spiral flutes
            f = G.box(f'Flute{i}{k}', 0.05, 0.6, -0.025, 0.025, 0.12, 0.2, 'hull_dark')
            G.transform(f, rot=(k * 120, 0, 0))
            bit.append(f)
        d = G.join(bit, f'Drill_{i}')
        G.finalize(d, atlas_dir)
        GR.ensure_col(d)
        d.location = (4.5, s * 1.65, -0.35)
        d.parent = root
    _lamps(root, atlas_dir, [((-4.0, 2.3, 0.3), 'light_red'), ((-4.0, -2.3, 0.3), 'light_green'),
                             ((2.5, 0.6, 2.02), 'light_white'), ((3.0, -0.95, 1.32), 'light_amber')])
    _thrusters(root, [(-5.05, -1.0, -0.3), (-5.05, 1.0, -0.3)])
    return root


# ----------------------------------------------------------------------------
# tanker
# ----------------------------------------------------------------------------
TANKS = (-2.75, 0.05, 2.85)


def build_tanker(atlas_dir):
    st = []
    st.append(G.box('Spine', -4.7, 4.3, -0.5, 0.5, -0.65, 0.05, 'hull_dark', bevel=0.05, seg=1))
    st.append(G.box('SpineBelt', -4.6, 4.2, -0.55, 0.55, -0.45, -0.3, ORANGE, bevel=0.02, seg=1))
    for k, x in enumerate(TANKS):
        st.append(G.ellipsoid(f'Tank{k}', 1.32, 1.32, 1.22, 'fuel_yellow', loc=(x, 0, 0.9), seg=18, rings=10))
        st.append(G.ring_band(f'TankStrap{k}', 1.34, 1.2, -0.08, 0.08, 'trim_black', loc=(x, 0, 0.9), axis='X',
                              verts=18, smooth=False))
        st.append(G.ring_band(f'TankBelt{k}', 1.34, 1.22, 0.85, 0.95, 'hull_light', loc=(x, 0, 0), verts=18,
                              smooth=False))
        # saddle cradle
        for s in (1, -1):
            st.append(G.box(f'Saddle{k}{s}', x - 0.55, x + 0.55, s * 0.45, s * 1.05, -0.35, 0.2, 'hull_mid',
                            bevel=0.03, seg=1))
        # top hatch + valve
        st.append(G.cyl(f'Hatch{k}', 0.26, 0.14, 'hull_light', loc=(x, 0, 2.12), verts=10, bevel=0.02, seg=1))
        st.append(G.cyl(f'Valve{k}', 0.1, 0.18, 'accent_iron_dark', loc=(x + 0.3, 0.25, 2.06), verts=8))
    # feed pipe along the top connecting the tanks
    st.append(G.cyl('Pipe', 0.07, TANKS[2] - TANKS[0], 'metal_bare', loc=((TANKS[0] + TANKS[2]) / 2, 0.45, 2.0),
                    axis='X', verts=8))
    # bridge at the bow
    st += S.deck_block('Bridge', 4.15, 5.35, -0.85, 0.85, -0.7, 0.75, accent=ORANGE)
    st.append(G.prism('Nose', [(5.3, -0.7), (5.85, -0.35), (5.85, 0.35), (5.3, 0.7)], -0.6, 0.45, 'hull_light',
                      bevel=0.04, seg=1))
    st.append(G.prism('Canopy', [(4.75, -0.8), (5.4, -0.55), (5.4, 0.55), (4.75, 0.8)], 0.72, 1.0, 'glass_cockpit',
                      bevel=0.02, seg=1))
    st += S.mast('Mast', (4.4, -0.4, 0.75), 0.75, r=0.04, dish=0.22)
    # drive
    st += S.deck_block('Drive', -5.35, -4.45, -1.05, 1.05, -0.85, 0.35, accent=ORANGE)
    for k, y in enumerate((-0.55, 0.55)):
        _bell_set(st, f'Bell{k}', -5.35, y, -0.25, 0.42)
    for s in (1, -1):
        st.append(G.box(f'Radiator{s}', -5.0, -4.3, s * 1.05, s * 1.6, -0.12, -0.04, 'hull_mid', bevel=0.01, seg=1))
    root = _finish(st, 'Tanker', 18, atlas_dir, grime=0.3)
    _lamps(root, atlas_dir, [((-4.65, 1.65, -0.0), 'light_red'), ((-4.65, -1.65, -0.0), 'light_green'),
                             ((4.4, -0.4, 1.6), 'light_white'), ((TANKS[1], 0, 2.32), 'light_amber')])
    _thrusters(root, [(-5.85, -0.55, -0.25), (-5.85, 0.55, -0.25)])
    return root


# ----------------------------------------------------------------------------
# courier (Free Traders)
# ----------------------------------------------------------------------------
COURIER = [(2.15, 0.0), (0.7, 0.48), (-1.55, 0.62), (-1.95, 0.42), (-1.95, -0.42), (-1.55, -0.62), (0.7, -0.48)]


def build_courier(atlas_dir):
    st = []
    st.append(GU.plate('Keel', GU._inset(COURIER, 0.08), -0.38, -0.08, 'hull_dark', bevel=0.03))
    st.append(GU.plate('Band', COURIER, -0.12, 0.02, TRADER, bevel=0.02))
    st.append(GU.plate('Deck', GU._inset(COURIER, 0.03), 0.02, 0.16, 'hull_white', bevel=0.025))
    st.append(GU.plate('Canopy', [(1.55, 0.0), (1.0, 0.27), (0.3, 0.3), (0.3, -0.3), (1.0, -0.27)], 0.14, 0.38,
                       'glass_cockpit', bevel=0.03))
    for s in (1, -1):
        w = [(-0.4, s * 0.55), (-1.45, s * 1.3), (-1.85, s * 1.3), (-1.6, s * 0.55)]
        if s < 0:
            w = list(reversed(w))
        st.append(GU.plate(f'Wing{s}', w, -0.1, -0.02, 'hull_light', bevel=0.012))
        st.append(G.box(f'WingTip{s}', -1.85, -1.3, s * 1.3 - 0.06, s * 1.3 + 0.06, -0.12, 0.0, TRADER, bevel=0.01,
                        seg=1))
        st.append(G.cyl(f'Pod{s}', 0.11, 0.6, 'hull_mid', loc=(-1.6, s * 0.95, -0.06), axis='X', verts=8))
        st.append(G.ring_band(f'PodGlow{s}', 0.11, 0.07, -0.02, 0.02, 'engine_glow', loc=(-1.92, s * 0.95, -0.06),
                              axis='X', verts=8, smooth=False))
    st += GU.engine_pod('Main', -2.0, -0.9, 0.0, 0.0, 0.3, band=TRADER)
    # express cargo capsule on the spine (the courier's read: a green parcel pod)
    st.append(G.cyl('Parcel', 0.2, 0.9, TRADER, loc=(-0.2, 0.0, 0.32), axis='X', verts=10, bevel=0.02, seg=1))
    st.append(G.ring_band('ParcelBand', 0.215, 0.15, -0.04, 0.04, 'hull_white', loc=(-0.2, 0, 0.32), axis='X',
                          verts=10, smooth=False))
    # coin + arrows emblem (simplified) on the deck
    st.append(G.cyl('Coin', 0.16, 0.04, TRADER, loc=(-1.25, 0, 0.18), verts=12))
    st.append(G.cyl('CoinIn', 0.09, 0.05, 'hull_white', loc=(-1.25, 0, 0.185), verts=12))
    root = _finish(st, 'Courier', 28, atlas_dir, grime=0.12)
    _lamps(root, atlas_dir, [((-1.58, 1.36, -0.03), 'light_red'), ((-1.58, -1.36, -0.03), 'light_green'),
                             ((-0.9, 0.0, 0.4), 'light_white')], r=0.09)
    _thrusters(root, [(-2.45, 0.0, 0.0), (-1.95, 0.95, -0.06), (-1.95, -0.95, -0.06)])
    return root


# ----------------------------------------------------------------------------
# Institute survey ship
# ----------------------------------------------------------------------------
def build_survey(atlas_dir):
    st = S.deck_block('Hull', -3.1, 2.3, -1.15, 1.15, -0.8, 0.45, accent=INST)
    st.append(G.prism('Nose', [(2.25, -0.95), (3.3, -0.45), (3.3, 0.45), (2.25, 0.95)], -0.65, 0.4, 'hull_light',
                      bevel=0.05, seg=1))
    st.append(G.prism('Canopy', [(2.4, -0.75), (3.2, -0.4), (3.2, 0.4), (2.4, 0.75)], 0.38, 0.64, 'glass_cockpit',
                      bevel=0.03, seg=1))
    st.append(G.box('Stripe', -2.8, 2.0, -0.1, 0.1, 0.45, 0.5, INST))
    # sensor boom forward + tri-star sensor head
    st.append(G.cyl('Boom', 0.07, 2.1, 'metal_bare', loc=(4.3, 0, -0.1), axis='X', verts=8))
    st.append(G.cyl('BoomCollar', 0.16, 0.25, INST, loc=(3.35, 0, -0.1), axis='X', verts=10))
    st.append(G.ellipsoid('SensorPod', 0.22, 0.22, 0.22, 'hull_white', loc=(5.35, 0, -0.1), seg=10, rings=6))
    st.append(G.ring_band('SensorRing', 0.3, 0.25, -0.02, 0.02, 'engine_glow', loc=(5.35, 0, -0.1), axis='X',
                          verts=14))
    for k in range(3):
        a = math.radians(90 + 120 * k)
        arm = G.box(f'SArm{k}', 0.15, 0.62, -0.025, 0.025, -0.025, 0.025, 'hull_mid')
        arm.matrix_basis = __import__('mathutils').Matrix.Translation((5.2, 0, -0.1)) @ \
            __import__('mathutils').Matrix.Rotation(a, 4, 'X') @ \
            __import__('mathutils').Matrix.Rotation(math.radians(90), 4, 'Z')
        st.append(arm)
    # dish pedestal
    st.append(G.cyl('DishPed', 0.35, 0.5, 'hull_mid', loc=(-0.7, 0, 0.7), verts=10, bevel=0.02, seg=1))
    st.append(G.ring_band('DishPedBand', 0.38, 0.3, 0.88, 0.95, INST, verts=10, smooth=False, loc=(-0.7, 0, 0)))
    # lab pods on the flanks with window bands
    for s in (1, -1):
        st.append(G.cyl(f'Lab{s}', 0.45, 2.6, 'hull_light', loc=(-0.5, s * 1.45, -0.2), axis='X', verts=12,
                        bevel=0.03, seg=1))
        st.append(G.ring_band(f'LabBand{s}', 0.47, 0.4, -0.08, 0.08, INST, loc=(0.5, s * 1.45, -0.2), axis='X',
                              verts=12, smooth=False))
        st.append(G.box(f'LabWin{s}', -1.6, 0.6, s * 1.45 + s * 0.42 - 0.03, s * 1.45 + s * 0.42 + 0.03, -0.18,
                        -0.05, 'window_warm'))
    # compass-star emblem on the rear deck (Institute)
    pts = []
    for k in range(8):
        a = math.radians(45 * k)
        r = 0.48 if k % 2 == 0 else 0.13
        pts.append((-2.3 + r * math.cos(a), r * math.sin(a)))
    st.append(G.cyl('EmDisc', 0.56, 0.04, INST, loc=(-2.3, 0, 0.47), verts=20))
    st.append(G.prism('EmStar', pts, 0.49, 0.53, 'hull_white'))
    # drive: two engine pods
    for s in (1, -1):
        st += GU.engine_pod(f'Eng{s}', -3.85, -2.75, s * 0.62, -0.25, 0.32, band=INST)
    root = _finish(st, 'Survey_Ship', 38, atlas_dir, grime=0.12)
    dish = G.lathe('Survey_Dish', [(0.0, 0.0), (0.06, 0.5), (0.26, 1.12), (0.21, 1.17), (0.0, 0.56), (-0.12, 0.0)],
                   [0, 0, 1, 2, 2], ['hull_white', INST, 'hull_mid'], axis='Z', verts=20, closed=False, rot=(0, 35, 0))
    feed = G.cyl('Feed', 0.035, 0.75, 'metal_bare', loc=(0.24, 0, 0.5), verts=6)
    tip = G.ellipsoid('FeedTip', 0.08, 0.08, 0.08, 'engine_glow', loc=(0.45, 0, 0.82), seg=8, rings=4)
    hub = G.cyl('DishHub', 0.2, 0.2, 'hull_dark', loc=(0, 0, -0.06), verts=10)
    dish = G.join([dish, feed, tip, hub], 'Survey_Dish')
    G.finalize(dish, atlas_dir)
    GR.ensure_col(dish)
    dish.location = (-0.7, 0, 1.05)
    dish.parent = root
    _lamps(root, atlas_dir, [((-0.5, 1.95, -0.2), 'light_red'), ((-0.5, -1.95, -0.2), 'light_green'),
                             ((5.35, 0.0, 0.18), 'light_white'), ((-3.0, 0.0, 0.62), 'light_white')])
    _thrusters(root, [(-4.32, 0.62, -0.25), (-4.32, -0.62, -0.25)])
    return root


BUILDERS = {'miner_barge': build_barge, 'tanker': build_tanker, 'courier': build_courier, 'survey_ship': build_survey}


# ----------------------------------------------------------------------------
# manifest
# ----------------------------------------------------------------------------
KINDS = {
    'guild_cutter': dict(file='guild_cutter.glb', faction='guild', role='Guild Watch patrol cutter (C1)',
                         labelSk='Hliadkový kuter Stráže Cechu', labelEn='Guild Watch cutter', speedClass='fast',
                         flame=dict(material='big', length=1.6), trail=dict(width=0.9, color=[0.6, 0.78, 1.0]),
                         lamps={'beacon_0': 'red', 'beacon_1': 'green', 'beacon_2': 'white', 'beacon_3': 'white',
                                'strobe_0': '#9ccbff', 'strobe_1': '#9ccbff'},
                         anim={'Gun_0': 'yaw around +Y, rest +X, +-35 deg', 'Gun_1': 'same',
                               'strobe_0/1': 'patrol strobe: alternating double flash (60 ms on, 80 off, 60 on), '
                                             'period 1.2 s, strobe_1 offset by half a period'},
                         where='Guarded sectors, Guild Lanes, escorting traders (sectors design, "Guild Watch")'),
    'guild_frigate': dict(file='guild_frigate.glb', faction='guild', role='Guild Watch patrol leader (C2)',
                          labelSk='Fregata Stráže Cechu', labelEn='Guild Watch frigate', speedClass='slow',
                          flame=dict(material='big', length=2.6), trail=dict(width=1.6, color=[0.6, 0.78, 1.0]),
                          lamps={'beacon_0': 'red', 'beacon_1': 'green', 'beacon_2': 'white', 'beacon_3': 'white',
                                 'beacon_4': 'amber', 'strobe_0': '#9ccbff', 'strobe_1': '#9ccbff'},
                          anim={'Turret_0': 'yaw around +Y, rest +X, 360 deg', 'strobe_0/1': 'as the cutter'},
                          where='Guarded sector hubs, big escorts; 1 frigate + 2 cutters as a patrol group'),
    'miner_barge': dict(file='miner_barge.glb', faction='guild', role='Guild ore barge (civilian)',
                        labelSk='Banícky čln', labelEn='Mining barge', speedClass='slow',
                        flame=dict(material='big', length=2.2), trail=dict(width=1.3, color=[0.95, 0.66, 0.4]),
                        lamps={'beacon_0': 'red', 'beacon_1': 'green', 'beacon_2': 'white', 'beacon_3': 'amber'},
                        anim={'Drill_0': 'spin around local +X while working (3 rev/s); idle in flight',
                              'Drill_1': 'same, opposite direction',
                              'Barge_Ore': 'visible when loaded (arriving at a station), hidden when departing'},
                        where='home + mining stations, asteroid fields'),
    'tanker': dict(file='tanker.glb', faction='freeTraders', role='fuel tanker (civilian)', labelSk='Tanker',
                   labelEn='Tanker', speedClass='slow', flame=dict(material='big', length=2.2),
                   trail=dict(width=1.3, color=[0.95, 0.85, 0.5]),
                   lamps={'beacon_0': 'red', 'beacon_1': 'green', 'beacon_2': 'white', 'beacon_3': 'amber'},
                   anim={}, where='trade / refinery stations, along Guild Lanes'),
    'courier': dict(file='courier.glb', faction='freeTraders', role='fast courier (civilian)', labelSk='Kuriér',
                    labelEn='Courier', speedClass='fast', flame=dict(material='small', length=1.2),
                    trail=dict(width=0.5, color=[0.55, 0.95, 0.7]),
                    lamps={'beacon_0': 'red', 'beacon_1': 'green', 'beacon_2': 'white'}, anim={},
                    where='everywhere, frequent short hops (scale 1 - it is a small ship, like a drone x2)'),
    'survey_ship': dict(file='survey_ship.glb', faction='institute', role='Institute survey ship (civilian)',
                        labelSk='Prieskumná loď Inštitútu', labelEn='Institute survey ship', speedClass='medium',
                        flame=dict(material='big', length=1.6), trail=dict(width=0.9, color=[0.45, 0.85, 0.95]),
                        lamps={'beacon_0': 'red', 'beacon_1': 'green', 'beacon_2': 'white', 'beacon_3': 'white'},
                        anim={'Survey_Dish': 'spin around +Y (glTF) 0.15 rev/s'},
                        where='research stations, Uncharted sectors, near survey points'),
}


# M4d convoy collision circles (M4d CONVOY_SHAPES, task A1): the convoy ships are moving
# obstacles in the sim. Local frame like station / derelict layouts: x = glTF X (bow), y = -glTF Z
# (port / left = +y), r in game units. Fitted to the plane-projected hull of the shipped GLBs (incl. the
# container racks): trader 6% of the vertices outside (max 0.24 = the trade-port collar face, on purpose),
# tanker 2.5% (max 0.08). trade_port (trader.py): glTF (4.5, 0, -1.5) -> (4.5, 1.5), port side; the
# port-side rack ends at x 1.5, so a ship pinned at trade_port + its bounding radius (+y) clears every
# circle up to a bounding radius of 4.5 (starter ship, r 2.75: >= 0.8 from the racks at any heading).
COLLISION = {
    'trader': dict(file='trader.glb', circles=[(-5.5, 0.0, 2.9), (-2.4, 0.0, 2.75), (0.4, 0.0, 2.75),
                                                (2.5, -1.35, 1.5), (4.3, 0.0, 1.4), (5.7, 0.0, 1.4)],
                   tradePort=dict(x=4.5, y=1.5)),
    'tanker': dict(file='tanker.glb', circles=[(-4.4, 0.0, 1.85), (-2.75, 0.0, 1.45), (-0.25, 0.0, 1.5),
                                                (2.75, 0.0, 1.5), (4.8, 0.0, 1.05)]),
}


def collision_json():
    out = {'_about': 'M4d convoy collision circles: local frame x = glTF X (bow), y = -glTF Z (port / left '
                     'positive), r; list of {x, y, r} covering the hull incl. racks. tradePort = the trade_port '
                     'node of the trader in the same frame (port side; a linked ship sits at tradePort + its '
                     'bounding radius along +y).'}
    for k, v in COLLISION.items():
        e = {'file': v['file'], 'circles': [{'x': x, 'y': y, 'r': r} for x, y, r in v['circles']]}
        if 'tradePort' in v:
            e['tradePort'] = v['tradePort']
        out[k] = e
    return out


def write_manifest(rep):
    kinds = {}
    for k, v in KINDS.items():
        r = rep[k]
        thr = [n for n in r['nodes'] if n['name'].startswith('thruster_')]
        d = dict(v)
        d.update(tris=r['tris'], length=r['size'][0], size=r['size'], bounds=dict(min=r['min'], max=r['max']),
                 nodes=[n['name'] for n in r['nodes']],
                 thrusters=[dict(node=n['name'], pos=n['pos']) for n in thr])
        kinds[k] = d
    data = {
        '_schema': {
            'about': 'NPC ships of art batch C (Guild Watch + civilian traffic). Render only (StationTraffic / a '
                     'future patrol layer). glTF axes: +X = bow (moves toward +X), +Y up, origin = hull centre on '
                     'the gameplay plane. Scale 1 (1 unit = 1 ship cell, like npc/trader.glb).',
            'nodes': 'thruster_<i> EMPTY at the nozzle exit, local +X = exhaust direction: attach the flame strip '
                     '(StationTraffic: flame.rotation.z = -PI/2) and the trail there. beacon_<i> = lamp MESH: clone '
                     'the material and drive emissiveIntensity with beaconLevel(). strobe_<i> = lamp MESH, faster '
                     'patrol rhythm (see anim). Other named nodes: see anim.',
            'flame': 'material = which StationTraffic flame material (big | small); length = FLAME_LENGTH value',
            'trail': 'StationTraffic TRAIL width/color suggestion',
            'speedClass': 'slow ~ trader timings, medium, fast ~ drone timings (KIND_SPECS approach/depart)',
            'faction': 'FactionId (src) of the operator; colours: guild = navy/orange, freeTraders = green, '
                       'institute = cyan',
        },
        'kinds': kinds,
        'collision': collision_json(),
        'traffic': {
            'StationTraffic.MODELS': {k: f'assets/models/npc/{v["file"]}' for k, v in KINDS.items()
                                      if v['faction'] != 'guild' or k == 'miner_barge'},
            'SCALE': 1,
            'suggestedMix': {'home': {'miner_barge': 1, 'courier': 1}, 'station': {'tanker': 1, 'courier': 1},
                             'research': {'survey_ship': 1}, 'outpost': {'courier': 1}},
            'KIND_SPECS hint': {'miner_barge': 'as trader (clearance 6.5, alongside)', 'tanker': 'as trader',
                                'courier': 'as cargo but clearance 3.5', 'survey_ship': 'as trader, clearance 5'},
        },
    }
    path = os.path.join(paths.NPC, 'npc_ships.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return path
