"""Loose props floating in space.

cargo_container.glb - salvage cargo container the player tractors in.
  ~1.2 x 0.76 x 0.78 units, origin = centre of the hull box (it tumbles freely,
  there is no "up"), long axis along +X.  Chunky hull-style crate: dark
  structural frame with corner bumpers, light chamfered hull plates,
  corrugated flanks, orange hazard belt, grab handles on both ends and on top.
  Children:
    beacon_0   amber emissive lamp on the top (blink in code), pivot at the lamp.

Space clutter (art audit 2026-10-16 batch B4/B5, README 2.7.23) - CLUTTER builders,
exported by batch_b.py WITH vertex colours (AO/grime COLOR_0) + props.json:
  sat_comm, sat_survey, nav_beacon, cargo_pod_small, cargo_pallet, fuel_canister,
  ore_canister, escape_pod, claim_marker, solar_wing_drift  (B4, human, rings 1-2)
  pirate_mine, pirate_stash, scrap_raft                       (B5, decoration only)
BUILDERS keeps only cargo_container (build_all.py's props stage exports without
vertex colours and must keep that file byte-identical).
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from lib import geo as G  # noqa: E402
from lib import palette as P  # noqa: E402

LX, LY, LZ = 0.52, 0.36, 0.34    # half extents of the hull (+ bumpers and handles: ~1.2 x 0.75 x 0.8)
BEACON_LOC = (0.27, 0.215, LZ + 0.085)


def _handle(name, p0, p1, standoff, axis_out, mat='metal_bare'):
    """U-shaped grab handle: two standoffs + a bar between p0 and p1, pushed
    out along axis_out (0 = x, 1 = y, 2 = z) by `standoff` (signed)."""
    out = []
    for i, p in enumerate((p0, p1)):
        q = list(p)
        q[axis_out] += standoff / 2
        lo = [q[k] - 0.025 for k in range(3)]
        hi = [q[k] + 0.025 for k in range(3)]
        lo[axis_out] = p[axis_out] + min(0.0, standoff)
        hi[axis_out] = p[axis_out] + max(0.0, standoff)
        out.append(G.box(f'{name}Post{i}', lo[0], hi[0], lo[1], hi[1], lo[2], hi[2], 'hull_dark', bevel=0.008, seg=1))
    a = [p0[k] for k in range(3)]
    a[axis_out] += standoff
    b = [p1[k] for k in range(3)]
    b[axis_out] += standoff
    d = [b[k] - a[k] for k in range(3)]
    ax = max(range(3), key=lambda k: abs(d[k]))
    centre = tuple((a[k] + b[k]) / 2 for k in range(3))
    L = math.dist(a, b) + 0.05
    out.append(G.cyl(f'{name}Bar', 0.022, L, mat, loc=centre, axis='XYZ'[ax], verts=8))
    return out


def build_cargo_container(atlas_dir):
    acc, acc_d = 'accent_iron', 'accent_iron_dark'
    pcs = []
    # structural core (dark) + light hull plates on every face
    pcs.append(G.box('Core', -LX + 0.03, LX - 0.03, -LY + 0.03, LY - 0.03, -LZ + 0.03, LZ - 0.03, 'hull_dark',
                     bevel=0.03, seg=1))
    c = 0.06
    # top / bottom plates
    for s in (1, -1):
        pl = G.prism(f'PlateZ{s}', G.chamfer_rect(-LX + 0.07, LX - 0.07, -LY + 0.07, LY - 0.07, c),
                     -0.03, 0.03, 'hull_light', bevel=0.012, seg=1)
        G.transform(pl, loc=(0, 0, s * (LZ - 0.03)))
        pcs.append(pl)
    # side plates (+-Y) with corrugation ribs
    for s in (1, -1):
        pl = G.prism(f'PlateY{s}', G.chamfer_rect(-LX + 0.07, LX - 0.07, -LZ + 0.07, LZ - 0.07, c),
                     -0.03, 0.03, 'hull_light', bevel=0.012, seg=1)
        G.transform(pl, loc=(0, s * (LY - 0.03), 0), rot=(90, 0, 0))
        pcs.append(pl)
        for i, x in enumerate((-0.30, -0.19, -0.08, 0.08, 0.19, 0.30)):
            pcs.append(G.box(f'Rib{s}{i}', x - 0.022, x + 0.022, s * LY - 0.01, s * LY + 0.018,
                             -LZ + 0.11, LZ - 0.11, 'hull_mid', bevel=0.006, seg=1))
        # stencil panel in the middle of the flank
        pcs.append(G.box(f'Stencil{s}', -0.07, 0.07, s * LY - 0.005, s * LY + 0.02, -0.12, 0.12, 'trim_black',
                         bevel=0.005, seg=1))
        for k, z in enumerate((-0.06, 0.0, 0.06)):
            pcs.append(G.box(f'StencilMark{s}{k}', -0.04, 0.04 - 0.025 * k, s * LY + 0.01, s * LY + 0.026,
                             z - 0.012, z + 0.012, 'hull_white'))
    # end plates (+-X)
    for s in (1, -1):
        pl = G.prism(f'PlateX{s}', G.chamfer_rect(-LY + 0.07, LY - 0.07, -LZ + 0.07, LZ - 0.07, c),
                     -0.03, 0.03, 'hull_light', bevel=0.012, seg=1)
        G.transform(pl, loc=(s * (LX - 0.03), 0, 0), rot=(90, 0, 90))
        pcs.append(pl)
        # diagonal hazard stripes on the ends
        for k, o in enumerate((-0.2, -0.07, 0.06, 0.19)):
            st = G.box(f'Haz{s}{k}', -0.013, 0.013, -0.035, 0.035, -0.11, 0.11, acc if k % 2 == 0 else 'trim_black')
            G.transform(st, loc=(s * LX, o, -0.08), rot=(35 * s, 0, 0))
            pcs.append(st)
    # hazard belt around the middle of the long axis (two bands)
    for k, x in enumerate((-0.395, 0.395)):
        pcs.append(G.box(f'Belt{k}', x - 0.035, x + 0.035, -LY - 0.012, LY + 0.012, -LZ - 0.012, LZ + 0.012, acc,
                         bevel=0.008, seg=1))
    # chunky corner bumpers
    for sx in (1, -1):
        for sy in (1, -1):
            for sz in (1, -1):
                x, y, z = sx * LX, sy * LY, sz * LZ
                lo = [x - sx * 0.085, y - sy * 0.085, z - sz * 0.085]
                hi = [x + sx * 0.014, y + sy * 0.014, z + sz * 0.014]
                lo, hi = [min(a, b) for a, b in zip(lo, hi)], [max(a, b) for a, b in zip(lo, hi)]
                pcs.append(G.box(f'Bumper{sx}{sy}{sz}', lo[0], hi[0], lo[1], hi[1], lo[2], hi[2],
                                 acc_d if sz > 0 else 'hull_dark', bevel=0.022, seg=1))
    # grab handles: both ends (along Y) and two on top (along X)
    for s in (1, -1):
        pcs += _handle(f'EndHandle{s}', (s * LX, -0.14, 0.17), (s * LX, 0.14, 0.17), s * 0.06, 0)
    for k, y in enumerate((-0.17, 0.17)):
        pcs += _handle(f'TopHandle{k}', (-0.17, y, LZ), (0.17, y, LZ), 0.06, 2)
    # beacon housing (the lamp itself is the beacon_0 child)
    bx, by, bz = BEACON_LOC
    pcs.append(G.cyl('BeaconBase', 0.055, 0.05, 'hull_dark', loc=(bx, by, LZ + 0.02), verts=12, bevel=0.01, seg=1))
    pcs.append(G.ring_band('BeaconCage', 0.06, 0.05, LZ + 0.04, LZ + 0.06, 'trim_black', loc=(bx, by, 0), verts=12))
    root = G.join(pcs, 'Cargo_Container')
    G.finalize(root, atlas_dir)
    lamp = G.ellipsoid('beacon_0', 0.042, 0.042, 0.05, 'light_amber', seg=10, rings=6)
    G.finalize(lamp, atlas_dir)
    lamp.location = BEACON_LOC
    lamp.parent = root
    return root


BUILDERS = {'cargo_container': build_cargo_container}


def build(name, atlas_dir):
    if name in CLUTTER:
        return CLUTTER[name](atlas_dir)
    return BUILDERS[name](atlas_dir)


from clutter_props import CLUTTER, describe, write_manifest  # noqa: E402,F401  (batch B4/B5)
