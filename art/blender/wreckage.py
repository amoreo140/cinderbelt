"""Wreck-field fragments (art audit 2026-10-16 §6 B3) - render-only scenery
pieces that sit around wrecks (`wreck-salvage`), around derelict stations and
in ring-2 "graveyards".

Derelict language (README 2.7.7): the human station/trader kit built normally,
then weathered (der_* swatches, grime COLOR_0), broken (charred caps on every
cut, girder stubs, hanging cables), dressed by the derelict detail pass
(holes, scorch, patches, dead lights) and rolled/tilted - nothing is level.
They already look dead: use them with the DEFAULT palette (no derelict livery,
no emission except the optional dying beacon_0).

Files (public/assets/models/wreckage/, AF_Palette + COLOR_0), origin = centre
on the gameplay plane (bbox centre in x/y, z centred on 0):
  hull_section_a   freighter spine section with a container rack   ~7 x 4    beacon_0 (dying amber)
  hull_section_b   bridge section, snapped mast, torn wing          ~5 x 4
  hull_section_c   cylindrical habitat module cracked open          ~5 x 3
  ring_arc         snapped station-ring arc with a spoke stub       ~10 x 4
  girder_tangle_a  three box girders crossed and kinked, torn plate ~4 x 3
  girder_tangle_b  a long girder folded into a V with a solar wing  ~5 x 3
  container_spill  5 burst containers + spilled crates (cluster)   ~5 x 4
  engine_block     dead three-bell drive block, bent radiators      ~4 x 4
Manifest: wreckage.json (radius, collision circles, nodes, placement hints).
"""
import json
import math
import os
import random

from mathutils import Matrix, Vector

from lib import geo as G
from lib import greebles as GR
import derelicts as D
import pirates as PI
import station_kit as SK
import structures as S
import wreck_kit as W


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def _cut_all(objs, planes, key='char_black'):
    for o in objs:
        W.broken(o, planes, key)
    return objs


def _stubs(name, pts, rng, length=(0.5, 1.1), w=0.12, direction=(1, 0, 0)):
    """Girder stubs sticking out of a torn face."""
    out = []
    d0 = Vector(direction).normalized()
    for k, p in enumerate(pts):
        d = (d0 + Vector((rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), rng.uniform(-0.3, 0.3)))).normalized()
        p = Vector(p)
        out.append(PI.strut(f'{name}{k}', p, p + d * rng.uniform(*length), w, 'metal_bare'))
    return out


def _cables(name, pts, rng, drop=(0.5, 1.2), r=0.035, direction=(1, 0, 0)):
    """Cables hanging out of a torn face (sag down and outward)."""
    out = []
    d0 = Vector(direction).normalized()
    keys = ('trim_black', 'hull_mid', 'accent_iron_dark', 'trim_black')
    for k, p in enumerate(pts):
        p = Vector(p)
        q = p + d0 * rng.uniform(0.4, 0.9) + Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3),
                                                      -rng.uniform(*drop)))
        out.append(W.tube(f'{name}{k}', W.sag(p, q, rng.uniform(0.15, 0.4), n=7, wobble=0.08, rng=rng), r,
                          keys[k % len(keys)], sides=5))
    return out


def _scorches(name, spots, rng):
    out = []
    for k, (x, y, z, r) in enumerate(spots):
        out += D.scorch(f'{name}{k}', x, y, z, r, rng)
    return out


def _pose(root, rot):
    """Roll/tilt the finished piece (mesh + children) and recentre it:
    bbox centre in x/y on the origin, z centred on the plane."""
    m = G._euler(rot)
    root.data.transform(m)
    for c in root.children:
        c.location = m.to_3x3() @ c.location
        if c.type == 'MESH':
            c.data.transform(m.to_3x3().to_4x4())
    pts = [Vector(v.co) for v in root.data.vertices]
    for c in root.children:
        if c.type == 'MESH':
            pts += [c.location + Vector(v.co) for v in c.data.vertices]
    mn = Vector([min(p[i] for p in pts) for i in range(3)])
    mx = Vector([max(p[i] for p in pts) for i in range(3)])
    ctr = (mn + mx) / 2
    root.data.transform(Matrix.Translation(-ctr))
    for c in root.children:
        c.location -= ctr
    return root


def _beacon(root, name, loc, key, atlas_dir, r=0.16):
    b = S.beacon(name, (0, 0, 0), key, r=r)
    G.finalize(b, atlas_dir)
    GR.ensure_col(b)
    b.location = loc
    b.parent = root
    return b


# ----------------------------------------------------------------------------
# A - freighter spine section with a container rack
# ----------------------------------------------------------------------------
def hull_section_a(atlas_dir, seed=901):
    rng = random.Random(seed)
    st = []
    st.append(G.box('Spine', -3.4, 3.4, -0.6, 0.6, -0.75, 0.35, 'hull_dark', bevel=0.06, seg=1))
    st.append(G.prism('SpinePlate', G.chamfer_rect(-3.3, 3.3, -0.46, 0.46, 0.15), 0.3, 0.52, 'hull_light',
                      bevel=0.03, seg=1))
    for k in range(5):
        x = -2.6 + k * 1.3
        st.append(G.box(f'Rib{k}', x - 0.12, x + 0.12, -0.68, 0.68, -0.82, 0.44, 'hull_mid', bevel=0.03, seg=1))
    st.append(G.box('Keel', -3.3, 3.3, -0.25, 0.25, -1.0, -0.75, 'hull_mid', bevel=0.03, seg=1))
    # container rack on the port side (+Y)
    st.append(G.box('RailB', -3.2, 3.2, 0.6, 0.74, -0.92, -0.74, 'metal_bare'))
    st.append(G.box('RailT', -3.2, 1.6, 2.42, 2.56, 0.96, 1.1, 'metal_bare'))
    for k, x in enumerate((-2.55, -0.95, 0.65, 2.25)):
        h = 1.1 if x < 2 else 0.2
        st.append(G.box(f'Post{k}', x - 0.07, x + 0.07, 0.6, 2.56, -0.92, h, 'accent_iron', bevel=0.02, seg=1))
    for k, (x, lvl, key, rot) in enumerate(((-1.75, 0, 'der_rust', 0), (-0.15, 0, 'verdigris', 0),
                                            (-1.75, 1, 'hull_mid', 9), (1.45, 0, 'rock_ice_2', -14))):
        box = S.container(f'Box{k}', 0, 0, 0, 1.4, 1.75, 0.85, key)
        W.place_all(box, loc=(x, 1.58 + (0.15 if rot else 0), -0.82 + lvl * 0.92), rot=(rot * 0.5, 0, rot))
        st += box
    # starboard flank (-Y): plates torn and peeled down
    for k, (x0, x1, ang) in enumerate(((-3.0, -1.6, 28), (-1.4, 0.2, 52), (1.0, 2.6, 18))):
        pl = G.box(f'Flank{k}', x0, x1, -1.5, -0.62, -0.3, -0.2, 'hull_light', bevel=0.02, seg=1)
        pl2 = G.box(f'FlankB{k}', x0 + 0.05, x1 - 0.05, -1.45, -0.62, -0.38, -0.3, 'hull_dark')
        for o in (pl, pl2):
            W.subdiv_long(o, 0.5)
            W.bend(o, (0, -0.65, -0.25), (1, 0, 0), ang, (0, -1, 0), ramp=0.4)
        st += [pl, pl2]
        if k == 1:
            W.torn(pl, rng, -1.2, n=3, span=(x0, x1), axis='y', sign=-1)
    # holes + scorch on the spine plate, snapped mast
    st += _scorches('Burn', [(-1.6, 0.0, 0.53, 0.45), (1.9, 0.1, 0.53, 0.35), (0.3, -0.2, 0.53, 0.3)], rng)
    st.append(G.box('Hole', 0.7, 1.4, -0.32, 0.2, 0.5, 0.535, 'char_black'))
    st += S.mast('Mast', (2.5, -0.2, 0.52), 0.8, r=0.05)
    st.append(PI.strut('MastBent', (2.5, -0.2, 1.3), (3.0, -0.6, 1.25), 0.06, 'metal_bare'))
    # torn ends: jagged charred cuts, girder stubs and cables
    _cut_all(st, W.jagged_planes(rng, 3.05, n=4, span=(-1.6, 2.6), tilt=0.5))
    _cut_all(st, W.jagged_planes(rng, -3.1, n=4, span=(-1.6, 2.6), sign=-1, tilt=0.5))
    st += _stubs('StubF', [(3.0, -0.3, -0.5), (3.0, 0.35, 0.1), (3.0, 1.4, -0.7)], rng, direction=(1, 0, 0))
    st += _stubs('StubR', [(-3.05, 0.3, -0.4), (-3.05, -0.3, 0.2)], rng, direction=(-1, 0, 0))
    st += _cables('CabF', [(3.0, 0.0, -0.2), (3.0, -0.4, -0.6)], rng, direction=(1, 0, 0))
    st += _cables('CabR', [(-3.05, 0.1, -0.1), (-3.05, 0.4, -0.6), (-3.05, -0.4, -0.5)], rng, direction=(-1, 0, 0))
    z = GR.Zones()
    z.cyl(3.0, -0.6, 0.5, 0.5, 3)
    root = W.derelict_finish('Hull_Section_A', st, atlas_dir, seed, density=1.0, zones=z)
    _beacon(root, 'beacon_0', (3.0, -0.6, 1.3), 'der_window', atlas_dir)
    return _pose(root, (-12, 5, 8))


# ----------------------------------------------------------------------------
# B - bridge section
# ----------------------------------------------------------------------------
def hull_section_b(atlas_dir, seed=902):
    rng = random.Random(seed)
    st = []
    st += S.deck_block('Bridge', -1.7, 1.4, -1.2, 1.2, -0.9, 0.9)
    st.append(G.box('Under', -1.7, 1.3, -0.95, 0.95, -1.35, -0.9, 'hull_mid', bevel=0.04, seg=1))
    st.append(G.prism('Nose', [(1.3, -0.95), (2.15, -0.45), (2.15, 0.45), (1.3, 0.95)], -0.75, 0.55, 'hull_light',
                      bevel=0.05, seg=1))
    st.append(G.prism('Canopy', [(0.4, -0.95), (1.2, -0.7), (1.2, 0.7), (0.4, 0.95)], 0.85, 1.25, 'glass_cockpit',
                      bevel=0.04, seg=1))
    st.append(G.box('CanopyFrame', 0.3, 0.45, -1.0, 1.0, 0.85, 1.32, 'glass_frame', bevel=0.02, seg=1))
    st.append(G.box('Top', -1.3, 0.25, -0.75, 0.75, 0.85, 1.25, 'hull_light', bevel=0.05, seg=1))
    st.append(G.box('Stripe', -1.3, 0.25, -0.12, 0.12, 1.24, 1.3, 'accent_iron'))
    for s in (1, -1):
        st.append(G.box(f'Win{s}', -1.4, 1.0, s * 1.2 - 0.03, s * 1.2 + 0.03, 0.15, 0.32, 'window_warm'))
    # one wing intact-ish (bent), the other torn off at the root
    wing = [(-1.5, 1.2), (0.6, 1.2), (0.0, 2.5), (-1.5, 2.5)]
    w1 = G.prism('Wing', wing, -0.35, -0.12, 'hull_light', bevel=0.03, seg=1)
    w1s = G.box('WingStripe', -1.45, -0.2, 1.75, 1.9, -0.13, -0.08, 'accent_iron')
    for o in (w1, w1s):
        W.subdiv_long(o, 0.6)
        W.bend(o, (0, 1.3, -0.2), (1, 0, 0), 24, (0, 1, 0), ramp=0.8)
    W.torn(w1, rng, 2.2, n=3, span=(-1.5, 0.3), axis='y')
    st += [w1, w1s]
    stub = G.prism('WingStub', [(-1.5, -1.65), (0.6, -1.65), (0.6, -1.2), (-1.5, -1.2)], -0.35, -0.12, 'hull_light',
                   bevel=0.03, seg=1)
    W.torn(stub, rng, -1.5, n=4, span=(-1.5, 0.6), axis='y', sign=-1)
    st.append(stub)
    # snapped mast with the dish hanging, breach in the flank
    st += S.mast('Mast', (-0.6, 0.45, 1.25), 0.7, r=0.05)
    st.append(PI.strut('MastBent', (-0.6, 0.45, 1.95), (-1.3, 0.9, 1.7), 0.06, 'metal_bare'))
    st.append(G.box('Breach', -0.6, 0.5, -1.24, -1.18, -0.6, 0.1, 'char_black'))
    st += _scorches('Burn', [(-0.5, 0.2, 1.31, 0.35), (1.65, 0.0, 0.56, 0.3)], rng)
    # rear end ripped off: charred cut, floor slabs + ribs sticking out
    _cut_all(st, W.jagged_planes(rng, -1.45, n=4, span=(-1.3, 1.3), sign=-1, tilt=0.6))
    for k, z in enumerate((-0.55, 0.25)):
        fl = G.box(f'Floor{k}', -2.1, -1.3, -0.9, 0.9, z - 0.05, z + 0.05, 'floor_dark')
        W.torn(fl, rng, -1.9, n=3, span=(-0.9, 0.9), sign=-1)
        st.append(fl)
    st += _stubs('Stub', [(-1.45, -0.6, -0.3), (-1.45, 0.6, 0.5), (-1.45, 0.0, -1.1)], rng, direction=(-1, 0, 0))
    st += _cables('Cab', [(-1.45, 0.3, -0.2), (-1.45, -0.3, 0.3), (-1.45, 0.8, -0.7)], rng, direction=(-1, 0, 0))
    root = W.derelict_finish('Hull_Section_B', st, atlas_dir, seed, density=1.0)
    return _pose(root, (16, -8, -20))


# ----------------------------------------------------------------------------
# C - cylindrical habitat module cracked open
# ----------------------------------------------------------------------------
def hull_section_c(atlas_dir, seed=903):
    rng = random.Random(seed)
    st = []
    R = 1.05
    prof = [(-2.3, 0.0), (-2.3, 0.55), (-2.2, 0.85), (-2.0, R), (2.2, R), (2.2, 0.0)]
    st.append(G.lathe('Can', prof, [0, 0, 0, 1, 1], ['hull_mid', 'hull_light'], axis='X', verts=16, closed=False,
                      smooth=False))
    for k, x in enumerate((-1.5, -0.3, 0.9)):
        st.append(G.ring_band(f'Hoop{k}', R + 0.08, R - 0.05, x - 0.12, x + 0.12, 'hull_dark', axis='X', verts=16,
                              smooth=False))
    st.append(G.ring_band('WinBand', R + 0.02, R - 0.04, -0.15, 0.15, 'window_warm', loc=(0.3, 0, 0), axis='X',
                          verts=16, smooth=False))
    st.append(G.ring_band('Belt', R + 0.05, R - 0.03, -0.1, 0.1, 'accent_iron', loc=(-0.9, 0, 0), axis='X',
                          verts=16, smooth=False))
    st.append(G.ring_band('Dock', 0.62, 0.38, -0.12, 0.12, 'accent_iron', loc=(-2.36, 0, 0), axis='X', verts=16,
                          smooth=False))
    st.append(G.cyl('Hatch', 0.4, 0.08, 'hull_dark', loc=(-2.34, 0, 0), axis='X', verts=16))
    # radiator fin pair (one bent) + handrail
    for s in (1, -1):
        fin = G.box(f'Rad{s}', -1.6, -0.2, -0.04, 0.04, R, R + 1.1, 'hull_mid', bevel=0.02, seg=1)
        W.place(fin, rot=(s * 35, 0, 0))
        if s < 0:
            W.subdiv_long(fin, 0.4)
            W.bend(fin, (0, 0, R + 0.5), (1, 0, 0), 40, (0, 0, 1), ramp=0.4)
        st.append(fin)
    st.append(W.tube('Rail', [(-1.8, 0.3, R + 0.12), (-0.6, 0.3, R + 0.12), (0.6, 0.35, R + 0.1)], 0.03, 'metal_bare',
                     sides=5))
    st.append(G.box('Dent', 0.8, 1.7, -0.6, 0.0, R - 0.06, R + 0.01, 'scorch'))
    # cracked open at +X: charred jagged end, hoop ribs + floor sticking out
    _cut_all(st, W.jagged_planes(rng, 1.6, n=5, span=(-1.1, 1.1), tilt=0.7))
    for k in range(3):
        a0 = rng.uniform(0, 360)
        arc = SK.arc_box(f'Rib{k}', R - 0.05, 0.08, 0.1, 0.0, a0, a0 + rng.uniform(70, 130), 'metal_bare')
        W.place(arc, loc=(1.7 + k * 0.25, 0, 0), rot=(0, 90, 0))
        st.append(arc)
    fl = G.box('Floor', 1.2, 2.4, -0.75, 0.75, -0.45, -0.37, 'floor_dark')
    W.torn(fl, rng, 2.2, n=3, span=(-0.75, 0.75))
    st.append(fl)
    st += _cables('Cab', [(1.6, 0.2, 0.3), (1.6, -0.3, -0.2)], rng, direction=(1, 0, 0))
    root = W.derelict_finish('Hull_Section_C', st, atlas_dir, seed, density=0.9, panels=False)
    return _pose(root, (24, 6, 25))


# ----------------------------------------------------------------------------
# ring arc
# ----------------------------------------------------------------------------
def ring_arc(atlas_dir, seed=904):
    rng = random.Random(seed)
    R = 12.0
    st, win = D.broken_ring('Ring', R, 1.6, 1.2, 0.0, [(-24, 24)], rng, ribs_every=12)
    st += win
    # inner conduit along the ring + spoke stub
    pts = [(math.cos(math.radians(a)) * (R - 1.0), math.sin(math.radians(a)) * (R - 1.0), -0.25)
           for a in range(-22, 23, 4)]
    st.append(W.tube('Conduit', pts, 0.12, 'hull_dark', sides=6))
    st += S.spoke('Spoke', R - 4.2, R - 0.75, 3, 0.0, w=0.6, h=0.5)
    st[-1].data.update()
    W.torn(st[-1], rng, R - 3.8, n=3, span=(-0.4, 0.4), sign=-1)
    st += _stubs('SpStub', [(R - 4.0, 0.1, 0.0)], rng, direction=(-1, 0, 0))
    st += _scorches('Burn', [(R * math.cos(math.radians(a)), R * math.sin(math.radians(a)), 0.66, 0.4)
                             for a in (-12, 9)], rng)
    for e, a in enumerate((-24, 24)):
        ar = math.radians(a)
        p = (R * math.cos(ar), R * math.sin(ar), 0.0)
        tang = (-math.sin(ar) * (1 if a > 0 else -1), math.cos(ar) * (1 if a > 0 else -1), 0)
        st += _cables(f'Cab{e}', [p, (p[0] - 0.4, p[1], -0.3)], rng, direction=tang, drop=(0.8, 1.6))
    root = W.derelict_finish('Ring_Arc', st, atlas_dir, seed, density=1.1, rows=())
    root.data.transform(Matrix.Translation((-R, 0, 0)))
    return _pose(root, (14, -6, 90))


# ----------------------------------------------------------------------------
# girder tangles
# ----------------------------------------------------------------------------
def girder_tangle_a(atlas_dir, seed=905):
    rng = random.Random(seed)
    st = []
    st += SK.box_truss('T0', (-2.1, -0.2, -0.2), (0.1, 0.25, 0.35), w=0.5, h=0.45, bar_w=0.08, mat='hull_dark',
                       rung_mat='hull_mid')
    st += SK.box_truss('T1', (0.1, 0.25, 0.35), (1.7, -0.9, -0.25), w=0.5, h=0.45, bar_w=0.08, mat='hull_dark',
                       rung_mat='hull_mid')
    st += SK.box_truss('T2', (-0.6, -1.4, -0.4), (0.7, 1.5, 0.45), w=0.4, h=0.4, bar_w=0.07, mat='hull_mid',
                       rung_mat='accent_iron')
    pl = G.box('Plate', -1.0, 0.4, -0.1, 0.9, 0.0, 0.08, 'hull_light', bevel=0.02, seg=1)
    W.subdiv_long(pl, 0.35)
    W.bend(pl, (-0.3, 0.4, 0.0), (1, 0, 0), 38, (0, 1, 0), ramp=0.3)
    W.torn(pl, rng, 0.3, n=3, span=(-0.1, 0.9), sign=1)
    W.place(pl, loc=(0.1, 0.1, 0.45), rot=(10, -14, 25))
    st.append(pl)
    st += _cables('Cab', [(0.1, 0.25, 0.1), (-1.2, 0.0, 0.0), (1.2, -0.6, -0.3)], rng, direction=(0, 1, 0),
                  drop=(0.4, 0.9), r=0.03)
    for p in ((-2.1, -0.2, -0.2), (1.7, -0.9, -0.25), (-0.6, -1.4, -0.4), (0.7, 1.5, 0.45)):
        st.append(G.box(f'Cap{p[0]}', p[0] - 0.12, p[0] + 0.12, p[1] - 0.3, p[1] + 0.3, p[2] - 0.28, p[2] + 0.28,
                        'char_black'))
    root = W.derelict_finish('Girder_Tangle_A', st, atlas_dir, seed, dress=False)
    return _pose(root, (8, 12, 0))


def girder_tangle_b(atlas_dir, seed=906):
    rng = random.Random(seed)
    st = []
    st += SK.box_truss('T0', (-2.4, -0.9, 0.0), (0.0, 0.0, 0.0), w=0.55, h=0.5, bar_w=0.09, mat='hull_dark',
                       rung_mat='hull_mid')
    st += SK.box_truss('T1', (0.0, 0.0, 0.0), (-1.6, 1.6, 0.6), w=0.55, h=0.5, bar_w=0.09, mat='hull_dark',
                       rung_mat='hull_mid')
    st.append(G.box('Knee', -0.4, 0.4, -0.4, 0.4, -0.35, 0.35, 'hull_mid', bevel=0.04, seg=1))
    st.append(G.box('KneeBand', -0.42, 0.42, -0.42, 0.42, -0.08, 0.08, 'accent_iron'))
    sol = D.torn_solar('Sol', -1.0, 1.0, -0.6, 0.6, 0.0, rng, missing=0.3)
    for o in sol:
        W.place(o, loc=(-1.9, 0.6, -0.9), rot=(62, 0, 30))
    st += sol
    st += _cables('Cab', [(-1.0, -0.45, 0.0), (-0.6, 0.6, 0.25)], rng, direction=(0, 0, -1), drop=(0.6, 1.0),
                  r=0.03)
    for p in ((-2.4, -0.9, 0.0), (-1.6, 1.6, 0.6)):
        st.append(G.box(f'Cap{p[0]}', p[0] - 0.14, p[0] + 0.14, p[1] - 0.32, p[1] + 0.32, p[2] - 0.3, p[2] + 0.3,
                        'char_black'))
    root = W.derelict_finish('Girder_Tangle_B', st, atlas_dir, seed, dress=False)
    return _pose(root, (-10, 6, 15))


# ----------------------------------------------------------------------------
# container spill
# ----------------------------------------------------------------------------
def _container(name, key, rng, burst=False, L=1.5, Wd=0.8, H=0.8):
    out = [G.box(name, -L / 2, L / 2, -Wd / 2, Wd / 2, -H / 2, H / 2 - (0.04 if burst else 0), key, bevel=0.03,
                 seg=1)]
    for k, f in enumerate((-0.33, 0.0, 0.33)):
        out.append(G.box(f'{name}R{k}', f * L - 0.035, f * L + 0.035, -Wd / 2 - 0.02, Wd / 2 + 0.02, -H / 2 + 0.04,
                         H / 2 - 0.04, 'hull_dark'))
    for s in (1, -1):
        out.append(G.box(f'{name}End{s}', s * L / 2 - 0.03, s * L / 2 + 0.03, -Wd / 2 + 0.05, Wd / 2 - 0.05,
                         -H / 2 + 0.05, H / 2 - 0.05, 'hull_mid'))
    if burst:
        # split open: dark interior on top, lid blown open on its hinge
        out.append(G.box(f'{name}In', -L / 2 + 0.06, L / 2 - 0.06, -Wd / 2 + 0.06, Wd / 2 - 0.06, H / 2 - 0.05,
                         H / 2 - 0.035, 'char_black'))
        lid = G.box(f'{name}Lid', -L / 2 + 0.02, L / 2 - 0.02, -Wd + 0.04, 0.0, -0.025, 0.025, key)
        W.place(lid, loc=(0, Wd / 2, H / 2), rot=(-118, 0, 0))
        W.place(lid, rot=(0, 0, 0))
        out.append(lid)
    return out


def container_spill(atlas_dir, seed=907):
    rng = random.Random(seed)
    st = []
    keys = ('der_rust', 'verdigris', 'hull_mid', 'pir_hazard', 'rock_ice_2')     # muted cargo colours
    spots = ((-1.5, -0.8, 0.0, 20), (0.4, -1.3, -0.3, -35), (1.8, 0.2, 0.2, 70), (-0.3, 0.9, 0.35, 5),
             (-2.1, 1.2, -0.4, 120))
    for k, (x, y, z, yaw) in enumerate(spots):
        c = _container(f'C{k}', keys[k], rng, burst=k in (1, 3))
        W.place_all(c, loc=(x, y, z), rot=(rng.uniform(-25, 25), rng.uniform(-20, 20), yaw))
        st += c
    # spilled crates + drums
    for k in range(14):
        a = rng.uniform(0, 2 * math.pi)
        d = rng.uniform(0.3, 2.6)
        x, y = 0.3 + d * math.cos(a), -0.2 + d * math.sin(a)
        s = rng.uniform(0.18, 0.3)
        if k % 4 == 3:
            o = [G.cyl(f'Drum{k}', s * 0.6, s * 1.4, 'fuel_yellow' if k % 8 == 3 else 'der_rust', verts=8)]
            o.append(G.ring_band(f'DrumB{k}', s * 0.62, s * 0.5, -0.03, 0.03, 'trim_black', verts=8, smooth=False))
        else:
            o = [G.box(f'Crate{k}', -s, s, -s * 0.8, s * 0.8, -s * 0.7, s * 0.7,
                       ('hull_mid', 'der_plate', 'der_rust', 'accent_iron_dark')[k % 4], bevel=0.02, seg=1),
                 G.box(f'CrateB{k}', -s - 0.01, s + 0.01, -0.03, 0.03, -s * 0.7 - 0.01, s * 0.7 + 0.01, 'trim_black')]
        W.place_all(o, loc=(x, y, rng.uniform(-0.6, 0.6)), rot=[rng.uniform(0, 360) for _ in range(3)])
        st += o
    root = W.derelict_finish('Container_Spill', st, atlas_dir, seed, dress=True, density=0.5, panels=False,
                             grime_scale=0.6)
    return _pose(root, (0, 0, 0))


# ----------------------------------------------------------------------------
# dead engine block
# ----------------------------------------------------------------------------
def _bell(name, x, y, z, r=0.62):
    prof = [(0.0, r * 0.62), (-0.55, r), (-0.6, r * 1.06), (-0.55, r * 1.12), (0.0, r * 0.9)]
    return G.lathe(name, prof, [1, 2, 2, 0, 0], ['metal_bare', 'nozzle_in', 'hull_dark'], loc=(x, y, z), axis='X',
                   verts=16)


def engine_block(atlas_dir, seed=908):
    rng = random.Random(seed)
    st = []
    st += S.deck_block('Drive', -1.3, 1.1, -1.9, 1.9, -1.1, 0.9)
    for k, y in enumerate((-1.15, 0.0, 1.15)):
        r = 0.5 if k != 1 else 0.6
        st.append(_bell(f'Bell{k}', -1.3, y, -0.15, r=r))
        st.append(G.ring_band(f'BellRim{k}', r * 1.1, r * 0.95, -0.03, 0.03, 'scorch', loc=(-1.86, y, -0.15),
                              axis='X', verts=16))
    # radiator fins on top: two still upright, two bent flat
    for k in range(4):
        x = -1.0 + k * 0.5
        fin = G.box(f'RadFin{k}', x - 0.06, x + 0.06, -1.5, 1.5, 0.9, 1.5, 'hull_mid', bevel=0.02, seg=1)
        if k in (1, 3):
            W.subdiv_long(fin, 0.35)
            W.bend(fin, (x, 0, 0.95), (0, 1, 0), 70 if k == 1 else -55, (0, 0, 1), ramp=0.15)
        st.append(fin)
    # fuel lines along the flank
    for s in (1, -1):
        st.append(W.tube(f'Fuel{s}', [(1.1, s * 1.95, -0.6), (-0.2, s * 2.0, -0.55), (-1.2, s * 1.95, -0.3)], 0.07,
                         'fuel_yellow', sides=6))
    # front mount ripped from the ship: charred cut + stubs + cables
    st.append(G.box('Mount', 1.0, 2.0, -1.2, 1.2, -0.8, 0.6, 'hull_dark', bevel=0.05, seg=1))
    st.append(G.box('MountBelt', 1.0, 2.0, -1.25, 1.25, -0.4, -0.2, 'accent_iron'))
    _cut_all(st, W.jagged_planes(rng, 1.75, n=4, span=(-1.9, 1.9), tilt=0.5))
    st += _stubs('Stub', [(1.75, -0.8, 0.2), (1.75, 0.7, -0.5), (1.75, 0.0, 0.3)], rng, direction=(1, 0, 0))
    st += _cables('Cab', [(1.75, 0.3, -0.1), (1.75, -0.4, -0.4)], rng, direction=(1, 0, 0))
    st += _scorches('Burn', [(0.4, 0.8, 0.91, 0.4), (-0.6, -1.0, 0.91, 0.35)], rng)
    root = W.derelict_finish('Engine_Block', st, atlas_dir, seed, density=0.9)
    return _pose(root, (-18, 10, 140))


BUILDERS = {
    'hull_section_a': hull_section_a, 'hull_section_b': hull_section_b, 'hull_section_c': hull_section_c,
    'ring_arc': ring_arc, 'girder_tangle_a': girder_tangle_a, 'girder_tangle_b': girder_tangle_b,
    'container_spill': container_spill, 'engine_block': engine_block,
}


def build(name, atlas_dir):
    return BUILDERS[name](atlas_dir)


# ----------------------------------------------------------------------------
# collision circles + manifest
# ----------------------------------------------------------------------------
# how many circles (0 = fly-through scenery), suggestions for code
META = {
    'hull_section_a': dict(circles=5, kind='hull', count=(1, 2), contexts=['wreck', 'derelict', 'graveyard'],
                           rings=[1, 2, 3], tumble=1.5),
    'hull_section_b': dict(circles=3, kind='hull', count=(0, 1), contexts=['wreck', 'graveyard'], rings=[1, 2, 3],
                           tumble=2.0),
    'hull_section_c': dict(circles=3, kind='hull', count=(0, 1), contexts=['derelict', 'graveyard'],
                           rings=[1, 2, 3], tumble=2.5),
    'ring_arc': dict(circles=6, kind='ring', count=(0, 1), contexts=['derelict', 'graveyard'], rings=[2],
                     tumble=0.6),
    'girder_tangle_a': dict(circles=0, kind='girder', count=(1, 3), contexts=['wreck', 'derelict', 'graveyard'],
                            rings=[1, 2, 3, 4], tumble=4.0),
    'girder_tangle_b': dict(circles=0, kind='girder', count=(1, 2), contexts=['wreck', 'derelict', 'graveyard'],
                            rings=[1, 2, 3, 4], tumble=4.0),
    'container_spill': dict(circles=0, kind='spill', count=(0, 1), contexts=['wreck', 'graveyard'], rings=[1, 2, 3],
                            tumble=0.0),
    'engine_block': dict(circles=2, kind='engine', count=(0, 1), contexts=['wreck', 'graveyard'], rings=[1, 2, 3, 4],
                         tumble=2.0),
}


def plane_points(objs, band=1.2):
    """Plane-frame (Blender x, y) points of every vertex within |z| < band."""
    out = []
    for o in objs:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            p = mw @ v.co
            if abs(p.z) < band:
                out.append((p.x, p.y))
    return out


def _kmeans(P, k):
    import numpy as np
    c = [P[np.argmax(np.linalg.norm(P - P.mean(0), axis=1))]]
    while len(c) < k:
        d = np.min(np.stack([np.linalg.norm(P - q, axis=1) for q in c]), axis=0)
        c.append(P[np.argmax(d)])
    C = np.array(c, dtype=float)
    for _ in range(30):
        lab = np.argmin(np.stack([np.linalg.norm(P - q, axis=1) for q in C]), axis=0)
        for i in range(k):
            if np.any(lab == i):
                C[i] = P[lab == i].mean(0)
    lab = np.argmin(np.stack([np.linalg.norm(P - q, axis=1) for q in C]), axis=0)
    out = []
    for i in range(k):
        m = P[lab == i]
        if len(m) < 8:          # stray cable ends / thin stubs: no circle
            continue
        r = float(np.percentile(np.linalg.norm(m - C[i], axis=1), 88)) + 0.1
        if r < 0.45:            # tiny cluster (cable end, stub tip): not worth a circle
            continue
        out.append((round(float(C[i][0]), 2), round(float(C[i][1]), 2), round(r, 2)))
    return out


def fit_circles(pts, k, r_max=1.15, k_max=10):
    """Cover the plane-band vertices with circles: k-means, raising k until no
    circle is larger than r_max (thin girders / cables stay fly-through)."""
    if not pts or k <= 0:
        return []
    import numpy as np
    P = np.array(pts)
    out = _kmeans(P, k)
    while k < k_max and max(c[2] for c in out) > r_max:
        k += 1
        out = _kmeans(P, k)
    return out


SCHEMA = {
    'about': 'Batch B wreck-field fragments (art/README 2.7.23). Render-only scenery; collide only via `circles`.',
    'frame': 'circles/radius in the piece frame on the gameplay plane: x = glTF +X, y = glTF -Z (Blender +Y), '
             'same convention as station_layouts.json. The piece origin sits on the plane (z centred on 0).',
    'file': 'model path relative to public/',
    'radius': 'bounding radius on the plane (all vertices)',
    'size': 'bounding box [x, y(up), z] in glTF axes',
    'circles': 'collision circles [{x, y, r}] (empty = fly-through debris: no collision)',
    'nodes': 'special child nodes (beacon_<i> = blink; everything else is one static mesh)',
    'suggestedCount': '[min, max] instances per context site',
    'contexts': 'where to spawn: wreck (around a wreck/hulk, 6-30 u), derelict (around derelict stations, '
                'R+5..R+40), graveyard (ring-2 wreck graveyards between fields)',
    'rings': 'rings where the piece fits',
    'tumbleDegPerSec': 'suggested slow motion: pieces WITHOUT circles may tumble about a random axis; pieces WITH '
                       'circles only yaw about the up axis (rotate the circles with them) or stay still; 0 = keep '
                       'the authored pose (every piece is already rolled/tilted)',
    'scale': 'suggested uniform scale range (keep 1 for pieces with circles, or scale the circles too)',
    'livery': 'use the DEFAULT palette - the pieces are already weathered; do NOT apply the derelict livery',
}


def describe(name, root):
    """Manifest entry of a freshly built piece (scene still holds it)."""
    import bpy
    bpy.context.view_layer.update()
    meta = META[name]
    objs = [root] + list(root.children_recursive)
    tris = sum(G.tri_count(o) for o in objs if o.type == 'MESH')
    allp = []
    for o in objs:
        if o.type == 'MESH':
            allp += [o.matrix_world @ v.co for v in o.data.vertices]
    mn = [min(p[i] for p in allp) for i in range(3)]
    mx = [max(p[i] for p in allp) for i in range(3)]
    rad = max(math.hypot(p.x, p.y) for p in allp)
    circles = fit_circles(plane_points(objs, band=0.8), meta['circles'])
    nodes = [o.name for o in objs]
    return {
        'file': f'assets/models/wreckage/{name}.glb',
        'kind': meta['kind'],
        'tris': tris,
        'radius': round(rad, 2),
        'size': [round(mx[0] - mn[0], 2), round(mx[2] - mn[2], 2), round(mx[1] - mn[1], 2)],
        'circles': [dict(x=x, y=y, r=r) for x, y, r in circles],
        'nodes': [n for n in nodes if n.startswith('beacon_')],
        'lights': {'beacon_0': 'dying amber (der_window, dim): slow irregular blink'} if 'beacon_0' in nodes else {},
        'suggestedCount': list(meta['count']),
        'contexts': meta['contexts'],
        'rings': meta['rings'],
        'tumbleDegPerSec': meta['tumble'],
        'scale': [1.0, 1.0] if meta['circles'] else [0.8, 1.25],
    }


def write_manifest(entries, out_dir):
    path = os.path.join(out_dir, 'wreckage.json')
    data = {}
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    data['_schema'] = SCHEMA
    data.update(entries)
    data = {k: data[k] for k in ['_schema'] + [n for n in BUILDERS if n in data]}
    os.makedirs(out_dir, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    print('BB manifest', path)
    return path
