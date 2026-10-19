"""Cockpit 1x1 - glowing canopy on a pointed fairing, nose toward +X.
Level 2: longer, sleeker canopy, swept side fins, glowing fairing strakes."""
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'cockpit'


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    pcs = C.core_block(tier=t)
    h = C.PLATE_HALF
    top = C.DECK_TOP
    fair = [(-h, -h + 0.03), (-h + 0.03, -h), (0.24, -h), (h, -0.26), (h, 0.26),
            (0.24, h), (-h + 0.03, h), (-h, h - 0.03)]
    pcs.append(G.prism('Fairing', fair, C.PLATE_Z0, top, t['plate'], bevel=0.012))
    # tier accent wings on the fairing shoulders
    for s in (1, -1):
        wing = [(-0.36, 0.25 * s), (0.10, 0.25 * s), (0.28, 0.33 * s), (-0.36, 0.33 * s)]
        if s < 0:
            wing = list(reversed(wing))
        pcs.append(G.prism('Stripe', wing, top + 0.01, top + 0.035, t['accent'], bevel=0.008, seg=1))
    if lvl >= 2:
        # glowing strakes inside the accent wings + swept dorsal fins
        for s in (1, -1):
            strake = [(-0.33, 0.275 * s), (0.08, 0.275 * s), (0.22, 0.305 * s), (-0.33, 0.305 * s)]
            if s < 0:
                strake = list(reversed(strake))
            pcs.append(G.prism('Strake', strake, top + 0.03, top + 0.042, t['glow']))
            fin = [(-0.44, 0.0), (-0.20, 0.0), (-0.30, 0.13), (-0.44, 0.13)]
            f = G.prism('Fin', fin, -0.012, 0.012, t['accent'], bevel=0.006, seg=1)
            # stand the fin up: profile in XZ, thickness along Y
            G.transform(f, loc=(0, 0.36 * s, top), rot=(90, 0, 0))
            pcs.append(f)
    # canopy: rear hull hump + front glass bubble + dark frame ring
    k = 1.0 if lvl < 2 else 1.08            # T2: longer, lower, sleeker canopy
    pcs.append(G.ellipsoid('CanopyHump', 0.27 * k, 0.215, 0.23 / k, t['plate'], loc=(-0.15, 0, top),
                           seg=20, rings=12, upper_only=True))
    rim = G.torus('CanopyRim', 0.33 * k, 0.026, 'glass_frame', loc=(0, 0, 0), maj=28, mnr=6)
    rim.scale = (1.0, 0.225 / (0.33 * k), 1.0)
    rim.location = (0.06, 0, top + 0.012)
    pcs.append(rim)
    pcs.append(G.ellipsoid('CanopyGlass', 0.32 * k, 0.215, 0.25 / k, 'glass_cockpit',
                           loc=(0.06, 0, top), seg=20, rings=12, upper_only=True))
    if lvl >= 2:  # canopy frame bow across the glass
        bow = G.torus('CanopyBow', 0.235 / k, 0.016, 'glass_frame', rot=(90, 0, 90), maj=24, mnr=6)
        bow.scale = (1.0, 0.215 / (0.235 / k) * 1.04, 1.06)
        bow.location = (0.02, 0, top)
        pcs.append(bow)
    # dorsal spine on the hump + antenna
    pcs.append(G.box('Spine', -0.36, -0.02, -0.025, 0.025, top, top + 0.255 / k,
                     t['accent'], bevel=0.012, seg=1))
    if lvl >= 3:  # T3: cut-crystal ridge along the spine, crystal fin tips, rear corner gems
        pcs.append(C.gem_bar('SpineGem', (-0.35, 0, top + 0.25 / k), (-0.04, 0, top + 0.25 / k), 0.05, 0.045))
        for s in (1, -1):
            g = C.gem('FinGem', 0.13, 0.026, sides=4)
            C.place(g, (-0.43, 0.36 * s, top + 0.10), (-0.45, 0, 1.0))
            pcs.append(g)
        pcs += C.crystal_corners(t, top + 0.006, corners=(1, 2))
    pcs.append(G.cyl('Antenna', 0.012, 0.16, 'metal_bare', loc=(-0.30, 0, top + 0.28), verts=6))
    pcs.append(G.cyl('AntennaTip', 0.022, 0.03, 'light_red', loc=(-0.30, 0, top + 0.36), verts=8))
    # nose light + side nav lights (port red, starboard green)
    pcs.append(G.box('NoseLight', h - 0.03, h + 0.006, -0.08, 0.08, 0.10, 0.15, 'light_white',
                     bevel=0.01, seg=1))
    pcs.append(G.cyl('NavPort', 0.03, 0.03, 'light_red', loc=(-0.30, h - 0.02, 0.125), axis='Y', verts=10))
    pcs.append(G.cyl('NavStbd', 0.03, 0.03, 'light_green', loc=(-0.30, -h + 0.02, 0.125), axis='Y', verts=10))
    root = G.join(pcs, f'Cockpit_{tier.capitalize()}')
    G.finalize(root, atlas_dir)
    return root
