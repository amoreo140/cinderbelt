"""NPC trader (spec 5.3 / 5.5 "Konvoj obchodnikov", M4) - a "Volni obchodnici"
freighter in the human hull language: light chamfered decks over a dark
spine, GREEN trader belts (accent_trader, the faction's emblem colour) instead
of the player's orange, colourful container racks, a forward bridge and a
three-nozzle drive block.  Silhouette from the top: a long spine with a
blunt bridge head, container "ribs" on both flanks and a wide engine tail.

trader.glb  ~13.6 x 5.4 x 2.8 units, origin = hull centre on the gameplay
plane, bow = +X (moves toward +X).
  Trader                 static hull
    Trader_Cargo         container racks (separate node: the game may hide
                         some containers when the trader sells out)
    beacon_0 / beacon_1  port red (+Y) / starboard green (-Y) wing-tip lamps
    beacon_2             white top strobe on the bridge mast
    beacon_3             amber "open for trade" lamp above the trade port
    thruster_0..2        EMPTY at each nozzle exit, local +X points BACKWARD
                         (-X world, exhaust direction) - engine flame origin
    trade_port           EMPTY at the port-side docking collar (+Y side, on the
                         plane); the player's ship lines up here to trade.  The
                         port-side rack ends at x 1.5 (one bay shorter than
                         starboard): a clear apron in front of the port (M4d)
"""
import math

from lib import geo as G
import structures as S

ACC = 'accent_trader'
PORT_BAYS = 4      # container bays on the port (+Y) flank; starboard has 5
CONTAINERS = ('accent_iron', 'accent_titanium', 'fuel_yellow', 'hull_light', 'accent_trader', 'der_rust')


def _bell(name, x, y, z, r=0.62):
    prof = [(0.0, r * 0.62), (-0.55, r), (-0.6, r * 1.06), (-0.55, r * 1.12), (0.0, r * 0.9)]
    return G.lathe(name, prof, [1, 2, 2, 0, 0], ['metal_bare', 'nozzle_in', 'hull_dark'],
                   loc=(x, y, z), axis='X', verts=20)


def build(atlas_dir):
    st, cargo = [], []
    # ---- spine ---------------------------------------------------------------
    st.append(G.box('Spine', -5.2, 4.0, -0.55, 0.55, -0.7, 0.35, 'hull_dark', bevel=0.06, seg=1))
    st.append(G.prism('SpinePlate', G.chamfer_rect(-5.0, 3.8, -0.42, 0.42, 0.15), 0.3, 0.5, 'hull_light',
                      bevel=0.03, seg=1))
    for k in range(6):
        x = -4.2 + k * 1.45
        st.append(G.box(f'SpineRib{k}', x - 0.12, x + 0.12, -0.62, 0.62, -0.78, 0.42, 'hull_mid', bevel=0.03, seg=1))
    # ---- container racks on both flanks (cargo node) ---------------------------
    # M4d: the port-side rack stops one bay short (x 1.5) - a clear apron in front of the trade port, so
    # a linked ship (pinned at trade_port + its bounding radius outward, any heading) never touches it
    k = 0
    for s in (1, -1):
        bays = PORT_BAYS if s > 0 else 5
        x_end = -3.9 + bays * 1.5 - 0.6 if s > 0 else 3.0     # port: ends at the next bay's post (x 1.5)
        st.append(G.box(f'RackRail{s}', -4.6, x_end, s * 0.6 - 0.08, s * 0.6 + 0.08, -0.85, -0.65, 'metal_bare'))
        st.append(G.box(f'RackRailT{s}', -4.6, x_end, s * 2.45 - 0.08, s * 2.45 + 0.08, 0.95, 1.1, 'metal_bare'))
        for i in range(5):
            x = -3.9 + i * 1.5
            if i > bays:
                break
            # frame post per bay (on the short port side, post `bays` closes the rack)
            st.append(G.box(f'RackPost{s}{i}', x - 0.72, x - 0.6, min(s * 0.6, s * 2.5), max(s * 0.6, s * 2.5),
                            -0.85, 1.1, ACC if i % 2 == 0 else 'hull_mid', bevel=0.02, seg=1))
            for lvl in range(2 if i < bays else 0):
                if (i, lvl, s) in ((4, 1, -1), (1, 1, 1)):
                    continue          # gaps: some bays already sold
                cargo += S.container(f'Box{s}{i}{lvl}', x, s * 1.55, -0.75 + lvl * 0.9, 1.15, 1.7, 0.82,
                                     CONTAINERS[k % len(CONTAINERS)])
                k += 1
    # ---- bridge module (+X) ----------------------------------------------------
    st += S.deck_block('Bridge', 3.6, 6.4, -1.15, 1.15, -0.9, 0.9, accent=ACC)
    nose = [(6.3, -0.9), (7.0, -0.45), (7.0, 0.45), (6.3, 0.9)]
    st.append(G.prism('Nose', nose, -0.75, 0.55, 'hull_light', bevel=0.05, seg=1))
    st.append(G.box('NoseLight', 6.92, 7.06, -0.25, 0.25, -0.15, 0.1, 'light_white', bevel=0.02, seg=1))
    # canopy band across the bridge front
    st.append(G.prism('Canopy', [(5.4, -0.95), (6.15, -0.7), (6.15, 0.7), (5.4, 0.95)], 0.85, 1.25, 'glass_cockpit',
                      bevel=0.04, seg=1))
    st.append(G.box('CanopyFrame', 5.3, 5.45, -1.0, 1.0, 0.85, 1.32, 'glass_frame', bevel=0.02, seg=1))
    st.append(G.box('BridgeTop', 3.9, 5.25, -0.75, 0.75, 0.85, 1.25, 'hull_light', bevel=0.05, seg=1))
    st.append(G.box('BridgeStripe', 3.9, 5.25, -0.12, 0.12, 1.24, 1.3, ACC))
    st += S.mast('Mast', (4.3, 0.45, 1.25), 0.9, r=0.05, dish=0.32)
    for s in (1, -1):   # window rows on the bridge flanks
        st.append(G.box(f'BridgeWin{s}', 4.0, 6.0, s * 1.15 - 0.03, s * 1.15 + 0.03, 0.15, 0.32, 'window_warm'))
    # trade port collar on the port side (+Y) of the bridge
    st.append(G.cyl('PortCollar', 0.55, 0.3, ACC, loc=(4.5, 1.3, 0.0), axis='Y', verts=16, bevel=0.03, seg=1))
    st.append(G.ring_band('PortRing', 0.48, 0.32, -0.03, 0.03, 'engine_glow', loc=(4.5, 1.46, 0.0), axis='Y', verts=16))
    st.append(G.cyl('PortHatch', 0.32, 0.06, 'hull_dark', loc=(4.5, 1.45, 0.0), axis='Y', verts=16))
    # ---- drive block (-X) --------------------------------------------------------
    st += S.deck_block('Drive', -6.6, -4.6, -1.9, 1.9, -1.1, 0.9, accent=ACC)
    for k2, y in enumerate((-1.15, 0.0, 1.15)):
        st.append(_bell(f'Bell{k2}', -6.6, y, -0.15, r=0.5 if k2 != 1 else 0.6))
        st.append(G.ring_band(f'BellGlow{k2}', 0.55 if k2 != 1 else 0.66, 0.48 if k2 != 1 else 0.58, -0.03, 0.03,
                              'engine_glow', loc=(-6.95, y, -0.15), axis='X', verts=20))
        st.append(G.cyl(f'BellCore{k2}', 0.3 if k2 != 1 else 0.36, 0.03, 'engine_core', loc=(-6.62, y, -0.15),
                        axis='X', verts=16))
    # radiator fins on top of the drive + side wings with nav lamps
    for k2 in range(4):
        x = -6.3 + k2 * 0.42
        st.append(G.box(f'RadFin{k2}', x - 0.06, x + 0.06, -1.5, 1.5, 0.9, 1.4, 'hull_mid', bevel=0.02, seg=1))
    st.append(G.box('RadCap', -6.45, -4.95, -0.1, 0.1, 1.38, 1.46, ACC))
    for s in (1, -1):
        wing = [(-6.2, s * 1.9), (-4.9, s * 1.9), (-5.3, s * 2.7), (-6.2, s * 2.7)]
        if s < 0:
            wing = list(reversed(wing))
        st.append(G.prism(f'Wing{s}', wing, -0.35, -0.05, 'hull_light', bevel=0.03, seg=1))
        st.append(G.box(f'WingStripe{s}', -6.15, -5.4, s * 2.3 - 0.08, s * 2.3 + 0.08, -0.06, 0.0, ACC))
    # trader emblem plate on the spine: two arrows round a coin (simplified)
    st.append(G.cyl('Coin', 0.32, 0.06, ACC, loc=(2.6, 0, 0.53), verts=20))
    st.append(G.cyl('CoinIn', 0.18, 0.07, 'hull_white', loc=(2.6, 0, 0.535), verts=20))
    for s in (1, -1):
        arr = [(2.6 + s * 0.05, s * 0.36), (2.6 + s * 0.45, s * 0.36), (2.6 + s * 0.45, s * 0.5),
               (2.6 + s * 0.7, s * 0.3), (2.6 + s * 0.45, s * 0.1), (2.6 + s * 0.45, s * 0.24),
               (2.6 + s * 0.05, s * 0.24)]
        st.append(G.prism(f'Arrow{s}', arr if s > 0 else list(reversed(arr)), 0.5, 0.56, ACC))
    root = G.join(st, 'Trader')
    G.finalize(root, atlas_dir)
    cg = G.join(cargo, 'Trader_Cargo')
    G.finalize(cg, atlas_dir)
    cg.parent = root
    for i, (loc, key) in enumerate((((-5.6, 2.72, -0.2), 'light_red'), ((-5.6, -2.72, -0.2), 'light_green'),
                                    ((4.3, 0.45, 2.25), 'light_white'), ((4.5, 1.3, 0.75), 'light_amber'))):
        b = S.beacon(f'beacon_{i}', (0, 0, 0), key, r=0.16)
        G.finalize(b, atlas_dir)
        b.location = loc
        b.parent = root
    for k2, y in enumerate((-1.15, 0.0, 1.15)):
        e = G.empty(f'thruster_{k2}', loc=(-7.2, y, -0.15), size=0.4)
        e.rotation_euler = (0, 0, math.radians(180))
        e.parent = root
    tp = G.empty('trade_port', loc=(4.5, 1.5, 0.0), size=0.5)
    tp.parent = root
    return root


BUILDERS = {'trader': build}
