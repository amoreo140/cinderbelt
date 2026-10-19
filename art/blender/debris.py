"""Combat debris: small broken pieces spawned as flying fragments when a part
or a ship is destroyed (Effects.ts -> fxModels.ts).  Batch B of the art audit
2026-10-16 (B1 refresh + B2 faction sets).

Contract (unchanged since M3, the game clones gltf.scene and scales it 0.56-1.44):
  * ONE mesh node per file (root = the mesh), origin = bounding-box centre,
    0.3-1.0 units, AF_Palette + COLOR_0 (soot/scorch, exported with vertex colours).
  * debris_a..e.glb          human ships / stations (player hull language) - DROP-IN
  * debris_pirate_a..e.glb   pirates of every clan (gunmetal, rust, hazard ochre, red glass)
  * debris_kovaci_a..c.glb   Wardens / Colossus (obsidian blade shards, bronze ring bits, dead ember)
Detail-pass language at small scale: torn plate edges with the exposed dark
core, the orange skirt belt, broken nozzle rings, cable stubs, charred cut
caps, one or two thin `ember` slivers (emission 1.8) so fresh debris glows hot.
Budget 250-650 tris (Forge-smith 300-700).
"""
import math
import random

import bmesh
from mathutils import Matrix, Vector

from lib import geo as G
import kovaci as KV
import wreck_kit as W

# backwards-compatible helper names (older scripts import them from here)
broken = W.broken
soot = W.soot
densify_edges = W.subdiv_long


def torn(ob, rng, edge_x, n=4, span=(-0.25, 0.25), axis='x', sign=1, cut_key='char_black'):
    return W.torn(ob, rng, edge_x, n=n, span=span, axis=axis, sign=sign, cut_key=cut_key)


def densify(ob, max_len):
    """Split long edges so the soot vertex colour has enough vertices."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for _ in range(3):
        long_e = [e for e in bm.edges if e.calc_length() > max_len]
        if not long_e:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_e, cuts=1, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(ob.data)
    bm.free()


def slice_x(ob, xs, axis=(1, 0, 0)):
    """Extra edge loops at the given positions (cheap bend support)."""
    G.apply_modifiers(ob)
    G.bake_transform(ob)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    n = Vector(axis)
    for x in xs:
        bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), plane_co=n * x,
                               plane_no=n)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def _finish(name, pcs, atlas_dir, rng, amount=0.5, max_len=0.16, radius=0.4, floor=0.18):
    ob = G.join(pcs, name)
    W.centre_bbox(ob)
    burn = W.burn_centres(ob)
    densify(ob, max_len)
    G.finalize(ob, atlas_dir)
    W.soot(ob, rng, amount, burn, radius=radius, floor=floor)
    W.flat(ob)
    return ob


def _slab(x0, x1, y0, y1, skirts=('+y',), acc='accent_iron', plate='hull_light', core='hull_dark',
          chamfer=0.035, name='S'):
    """Ship-part deck profile (README 2.2): dark core z -0.20..0.10, accent
    skirt z -0.115..-0.055, light chamfered plate z 0.06..0.20."""
    out = [G.box(name + 'Core', x0, x1, y0, y1, -0.20, 0.10, core, bevel=0.01, seg=1)]
    for s in skirts:
        if s == '+y':
            out.append(G.box(name + 'SkY', x0, x1, y1 - 0.004, y1 + 0.008, -0.115, -0.055, acc))
        elif s == '-y':
            out.append(G.box(name + 'Sk-Y', x0, x1, y0 - 0.008, y0 + 0.004, -0.115, -0.055, acc))
        elif s == '+x':
            out.append(G.box(name + 'SkX', x1 - 0.004, x1 + 0.008, y0, y1, -0.115, -0.055, acc))
        elif s == '-x':
            out.append(G.box(name + 'Sk-X', x0 - 0.008, x0 + 0.004, y0, y1, -0.115, -0.055, acc))
    out.append(G.prism(name + 'Plate', G.chamfer_rect(x0 + 0.008, x1 - 0.008, y0 + 0.008, y1 - 0.008, chamfer),
                       0.06, 0.20, plate, bevel=0.012, seg=1))
    return out


# ============================================================================
# B1 - human debris (drop-in replacement of debris_a..e)
# ============================================================================
def debris_a(atlas_dir, rng):
    """Torn deck-plate corner: the plate peels up at the tear over the exposed
    dark core and its metal ribs; orange skirt belt, seam, hatch, bolts, ember
    seam where the plate ripped off."""
    x0, x1, y0, y1 = -0.44, 0.34, -0.29, 0.29
    core, sky, skx, plate = _slab(x0, x1, y0, y1, skirts=('+y', '-x'), name='A')
    planes = W.jagged_planes(rng, 0.30, n=4, span=(-0.3, 0.3))
    for o in (core, sky):
        W.broken(o, planes)
    W.broken(skx, [])
    # plate: tear a bit further out, slice for the bend, peel it up
    W.broken(plate, W.jagged_planes(rng, 0.40, n=4, span=(-0.3, 0.3), tilt=0.7))
    slice_x(plate, [0.12, 0.18, 0.25, 0.32])
    W.bend(plate, (0.12, 0, 0.2), (0, 1, 0), -34, (1, 0, 0), start=0.0, ramp=0.12)
    pcs = [core, sky, skx, plate]
    # exposed ribs sticking out of the core tear
    for k, y in enumerate((-0.17, 0.0, 0.16)):
        rib = G.box(f'Rib{k}', 0.18, 0.44 + rng.uniform(-0.04, 0.04), y - 0.018, y + 0.018, -0.13, -0.05,
                    'metal_bare')
        W.place(rib, rot=(rng.uniform(-8, 8), rng.uniform(-14, 4), rng.uniform(-9, 9)))
        pcs.append(rib)
    # scorched core top under the peeled plate + ember seam along the rip
    pcs.append(G.box('Burn', 0.12, 0.3, -0.25, 0.25, 0.098, 0.104, 'char_black'))
    em = G.box('Ember', 0.11, 0.126, -0.25, 0.22, 0.10, 0.114, 'ember')
    W.place(em, rot=(0, 0, rng.uniform(-6, 6)))
    pcs.append(em)
    # seam line, hatch and bolts on the flat part of the plate
    pcs.append(G.box('Seam', -0.135, -0.12, y0 + 0.04, y1 - 0.04, 0.198, 0.206, 'panel_line'))
    pcs.append(G.prism('Hatch', G.chamfer_rect(-0.38, -0.2, -0.22, -0.05, 0.02), 0.198, 0.214, 'hull_mid'))
    for k, (x, y) in enumerate(((-0.39, 0.23), (-0.04, 0.23), (-0.04, -0.23))):
        pcs.append(G.cyl(f'Bolt{k}', 0.02, 0.03, 'trim_black', loc=(x, y, 0.205), verts=6))
    return _finish('Debris_A', pcs, atlas_dir, rng, amount=0.6, max_len=0.22)


def debris_b(atlas_dir, rng):
    """Bent side skirt: the dark side wall of a part with the orange belt,
    vent slots and a strip of deck plate, curled ~40 deg and torn at both ends."""
    x0, x1 = -0.48, 0.48
    pcs = [G.box('Wall', x0, x1, -0.05, 0.05, -0.2, 0.06, 'hull_dark', bevel=0.008, seg=1),
           G.box('Belt', x0, x1, 0.046, 0.064, -0.115, -0.055, 'accent_iron'),
           G.box('Lip', x0, x1, -0.24, 0.062, 0.06, 0.19, 'hull_light', bevel=0.012, seg=1),
           G.box('LipEdge', x0, x1, -0.248, -0.23, 0.04, 0.17, 'hull_mid')]
    for k in range(5):
        x = -0.36 + k * 0.17
        pcs.append(G.box(f'Slot{k}', x, x + 0.07, 0.048, 0.056, -0.035, 0.02, 'trim_black'))
    for k in range(4):
        x = -0.33 + k * 0.22
        pcs.append(G.box(f'Frame{k}', x - 0.015, x + 0.015, -0.23, -0.05, -0.05, 0.06, 'metal_bare'))
    pcs.append(G.box('Seam', 0.02, 0.035, -0.22, 0.04, 0.188, 0.196, 'panel_line'))
    for o in pcs:
        slice_x(o, [-0.2, -0.1, 0.0, 0.1, 0.2, 0.3])
    for o in pcs:
        W.torn(o, rng, -0.44, n=3, span=(-0.25, 0.06), sign=-1)
        W.torn(o, rng, 0.43, n=3, span=(-0.25, 0.06))
    for o in pcs:
        W.bend(o, (-0.15, -0.3, 0), (0, 0, 1), -40, (1, 0, 0), start=0.0, ramp=0.45)
        W.twist(o, 0.35)
    em = G.box('Ember', -0.44, -0.425, -0.22, 0.04, 0.17, 0.19, 'ember')
    pcs.append(em)
    pcs.append(G.box('Burn', -0.43, -0.3, -0.22, 0.04, 0.19, 0.196, 'char_black'))
    W.place_all(pcs, rot=(0, 0, 180))      # belt on the side the 3/4 preview camera sees (game: random spin)
    return _finish('Debris_B', pcs, atlas_dir, rng, amount=0.5, max_len=0.2)


def debris_c(atlas_dir, rng):
    """Broken nozzle ring: half of an engine bell (dark throat, bare-metal
    shell, orange collar, cooling fins) snapped off with charred breaks."""
    prof = [(0.06, 0.15), (-0.04, 0.17), (-0.2, 0.27), (-0.235, 0.3), (-0.215, 0.322), (-0.04, 0.235),
            (0.06, 0.21)]
    bell = G.lathe('Bell', prof, [0, 0, 0, 1, 2, 2, 2], ['nozzle_in', 'accent_iron_dark', 'metal_bare'], axis='X',
                   verts=20, smooth=False)
    collar = G.ring_band('Collar', 0.245, 0.15, -0.045, 0.045, 'accent_iron', loc=(0.04, 0, 0), axis='X', verts=20,
                         smooth=False)
    pcs = [bell, collar]
    for k in range(10):
        a = math.radians(18 + k * 36)
        fin = G.box(f'Fin{k}', -0.16, -0.05, -0.014, 0.014, 0.0, 0.06, 'hull_dark')
        W.place(fin, loc=(0, 0.24 * math.cos(a), 0.24 * math.sin(a)), rot=(math.degrees(a) - 90, 0, 0))
        W.place(fin, rot=(0, 0, 0))
        pcs.append(fin)
    planes = [((0, 0, -0.02), (0.1, 0.25, -1.0)), ((0, -0.2, 0.02), (0.15, -1.0, -0.5)),
              ((-0.1, 0.22, 0.05), (0.2, 1.0, -0.35))]
    for o in pcs:
        W.broken(o, planes)
    em = G.box('Ember', -0.2, 0.05, -0.012, 0.012, -0.012, 0.012, 'ember')
    W.place(em, loc=(0, -0.2, 0.0), rot=(0, 0, 0))
    pcs.append(em)
    return _finish('Debris_C', pcs, atlas_dir, rng, amount=0.65, radius=0.3)


def debris_d(atlas_dir, rng):
    """Cable stub: a chunk of part core with its plate and orange skirt, a
    torn face spilling three cables and a fuel pipe; bare copper tips."""
    core, sk, plate = _slab(-0.3, 0.14, -0.2, 0.2, skirts=('-y',), name='D')
    planes = W.jagged_planes(rng, 0.1, n=3, span=(-0.2, 0.2))
    for o in (core, sk, plate):
        W.broken(o, planes)
    pcs = [core, sk, plate]
    pcs.append(G.box('Burn', 0.04, 0.12, -0.18, 0.18, -0.19, 0.19, 'char_black'))
    cols = ('trim_black', 'accent_iron', 'hull_mid')
    for k, (y, z) in enumerate(((-0.1, -0.1), (0.02, -0.04), (0.12, -0.12))):
        p0 = (0.06, y, z)
        p1 = (0.42 + 0.08 * k, y + rng.uniform(-0.12, 0.12), z - 0.12 + rng.uniform(-0.05, 0.05))
        pts = W.sag(p0, p1, 0.08 + 0.03 * k, n=6, wobble=0.04, rng=rng)
        pcs.append(W.tube(f'Cable{k}', pts, 0.022, cols[k], sides=5))
        tip = pts[-1]
        pcs.append(G.box(f'Tip{k}', tip.x - 0.02, tip.x + 0.03, tip.y - 0.012, tip.y + 0.012, tip.z - 0.012,
                         tip.z + 0.012, 'ember' if k == 1 else 'ore_copper'))
    pipe = W.tube('Pipe', [(0.02, 0.1, 0.02), (0.18, 0.13, 0.05), (0.32, 0.2, 0.0)], 0.034, 'metal_bare', sides=6)
    pcs.append(pipe)
    pcs.append(G.ring_band('PipeBand', 0.045, 0.03, -0.025, 0.025, 'fuel_yellow', loc=(0.17, 0.13, 0.05), axis='X',
                           verts=8, smooth=False))
    return _finish('Debris_D', pcs, atlas_dir, rng, amount=0.45, radius=0.3)


def debris_e(atlas_dir, rng):
    """Twisted armour panel: thick chamfered plate with two orange chevrons,
    ribs underneath, a scorch blotch, torn and twisted at one end."""
    panel = G.prism('Panel', G.chamfer_rect(-0.5, 0.5, -0.21, 0.21, 0.07), -0.04, 0.04, 'hull_light', bevel=0.01,
                    seg=1)
    slice_x(panel, [-0.25, 0.0, 0.25])
    pcs = [panel]
    for i, x in enumerate((-0.36, -0.08, 0.2)):
        pcs.append(G.box(f'Rib{i}', x - 0.03, x + 0.03, -0.18, 0.18, -0.1, -0.035, 'hull_dark'))
    pcs.append(G.box('Spine', -0.46, 0.4, -0.04, 0.04, -0.09, -0.035, 'hull_dark'))
    for k, x in enumerate((-0.34, -0.2)):
        pts = [(x, -0.15), (x + 0.07, -0.15), (x + 0.15, 0.0), (x + 0.07, 0.15), (x, 0.15), (x + 0.08, 0.0)]
        pcs.append(G.prism(f'Chev{k}', pts, 0.038, 0.048, 'accent_iron'))
    # scorch blotch
    n = 8
    sc = [(0.12 + 0.11 * math.cos(2 * math.pi * i / n) * rng.uniform(0.6, 1.0),
           0.02 + 0.1 * math.sin(2 * math.pi * i / n) * rng.uniform(0.6, 1.0)) for i in range(n)]
    pcs.append(G.prism('Scorch', sc, 0.038, 0.046, 'scorch'))
    pcs.append(G.prism('ScorchIn', [(0.12 + (x - 0.12) * 0.45, 0.02 + (y - 0.02) * 0.45) for x, y in sc], 0.044,
                       0.05, 'char_black'))
    for o in pcs:
        W.torn(o, rng, 0.42, n=4, span=(-0.22, 0.22), tilt=0.8)
    pcs.append(G.box('Ember', 0.38, 0.4, -0.16, 0.1, -0.035, 0.035, 'ember'))
    for o in pcs:
        W.twist(o, 0.85)
    return _finish('Debris_E', pcs, atlas_dir, rng, amount=0.55)


# ============================================================================
# B2 - pirate debris (all clans: generic pir_* scrap)
# ============================================================================
def _rivets(pcs, pts, z, key='trim_black', r=0.018):
    for k, (x, y) in enumerate(pts):
        pcs.append(G.cyl(f'Rivet{len(pcs)}_{k}', r, 0.02, key, loc=(x, y, z), verts=6))


def debris_pirate_a(atlas_dir, rng):
    """Welded scrap plate: two mismatched plates (worn gunmetal + fresh rust)
    joined by a weld bead, rivets, a dark frame underneath; torn ends."""
    p1 = G.box('Plate1', -0.46, 0.06, -0.27, 0.22, -0.03, 0.03, 'pir_plate_worn', bevel=0.01, seg=1)
    p2 = G.box('Plate2', -0.08, 0.44, -0.2, 0.29, 0.0, 0.065, 'pir_rust_patch', bevel=0.01, seg=1)
    W.place(p2, rot=(0, 0, 6))
    fr = G.box('Frame', -0.42, 0.38, -0.04, 0.04, -0.1, -0.03, 'pir_gunmetal_dark')
    fr2 = G.box('Frame2', -0.25, -0.19, -0.24, 0.2, -0.09, -0.03, 'pir_gunmetal_dark')
    W.torn(p1, rng, -0.42, n=3, span=(-0.27, 0.22), sign=-1)
    W.torn(p2, rng, 0.40, n=3, span=(-0.2, 0.3))
    slice_x(p2, [0.18, 0.26])
    W.bend(p2, (0.18, 0, 0.06), (0, 1, 0), -20, (1, 0, 0), ramp=0.1)
    pcs = [p1, p2, fr, fr2]
    for k in range(8):
        y = -0.18 + k * 0.055
        b = G.box(f'Weld{k}', -0.1, -0.055, y - 0.022, y + 0.022, 0.025, 0.06, 'pir_weld')
        W.place(b, rot=(rng.uniform(-10, 10), 0, rng.uniform(-30, 30)))
        pcs.append(b)
    _rivets(pcs, [(-0.38, -0.2), (-0.38, 0.15), (-0.22, -0.2), (-0.22, 0.15)], 0.035)
    _rivets(pcs, [(0.1, -0.14), (0.1, 0.22)], 0.07)
    pcs.append(G.box('Ember', -0.44, -0.42, -0.2, 0.15, -0.03, 0.035, 'ember'))
    return _finish('Debris_Pirate_A', pcs, atlas_dir, rng, amount=0.45)


def debris_pirate_b(atlas_dir, rng):
    """Spiked armour shard: gunmetal wedge with a worn top plate, three welded
    spikes and the clan claw scratches; torn back edge."""
    outline = [(-0.42, -0.2), (0.24, -0.29), (0.42, 0.02), (0.12, 0.29), (-0.36, 0.22)]
    slab = G.prism('Slab', outline, -0.07, 0.05, 'pir_gunmetal', bevel=0.012, seg=1)
    top = G.prism('Top', [(x * 0.78, y * 0.78) for x, y in outline], 0.05, 0.08, 'pir_plate_worn', bevel=0.008, seg=1)
    pcs = [slab, top]
    for k, (x, y, a) in enumerate(((0.32, -0.16, -35), (0.36, 0.08, 10), (0.12, 0.25, 60))):
        sp = G.cyl(f'Spike{k}', 0.045, 0.3, 'pir_gunmetal_dark', verts=4, r2=0.0)
        sp.data.transform(Matrix.Translation((0, 0, 0.15)))
        W.place(sp, loc=(x, y, 0.02), rot=(0, 62, a))
        pcs.append(sp)
    for k in range(3):
        cl = G.box(f'Claw{k}', -0.2, 0.12, -0.012, 0.012, 0.079, 0.088, 'pir_rust')
        W.place(cl, loc=(0, -0.08 + k * 0.07, 0), rot=(0, 0, 28))
        pcs.append(cl)
    for o in (slab, top):
        W.torn(o, rng, -0.3, n=3, span=(-0.26, 0.24), sign=-1)
    pcs.append(G.box('Ember', -0.33, -0.31, -0.18, 0.18, 0.0, 0.085, 'ember'))
    return _finish('Debris_Pirate_B', pcs, atlas_dir, rng, amount=0.45)


def debris_pirate_c(atlas_dir, rng):
    """Hazard girder: an I-beam with ochre/black hazard stripes, kinked,
    torn at both ends, a short chain dangling from one end."""
    pcs = [G.box('FlangeT', -0.46, 0.46, -0.11, 0.11, 0.05, 0.085, 'pir_gunmetal'),
           G.box('FlangeB', -0.46, 0.46, -0.11, 0.11, -0.085, -0.05, 'pir_gunmetal'),
           G.box('Web', -0.46, 0.46, -0.022, 0.022, -0.05, 0.05, 'pir_gunmetal_dark')]
    for k in range(7):
        x = -0.38 + k * 0.12
        st = G.prism(f'Haz{k}', [(x, -0.1), (x + 0.05, -0.1), (x + 0.1, 0.1), (x + 0.05, 0.1)], 0.085, 0.092,
                     'pir_hazard' if k % 2 == 0 else 'trim_black')
        pcs.append(st)
    for o in pcs:
        slice_x(o, [-0.05, 0.0, 0.05])
    for o in pcs:
        W.torn(o, rng, -0.42, n=3, span=(-0.12, 0.12), sign=-1, tilt=0.6)
        W.torn(o, rng, 0.42, n=3, span=(-0.12, 0.12), tilt=0.6)
        W.bend(o, (0.0, 0, 0), (0, 0, 1), 28, (1, 0, 0), ramp=0.06)
    for k in range(3):
        lk = G.torus(f'Link{k}', 0.035, 0.009, 'metal_bare', maj=8, mnr=4, smooth=False)
        W.place(lk, loc=(-0.42, 0.0, -0.11 - k * 0.055), rot=(90 if k % 2 else 0, 0, 90))
        pcs.append(lk)
    pcs.append(G.box('Ember', 0.355, 0.375, -0.1, 0.1, -0.08, 0.08, 'ember'))
    pcs[-1].data.transform(Matrix.Rotation(math.radians(28), 4, 'Z'))
    return _finish('Debris_Pirate_C', pcs, atlas_dir, rng, amount=0.4)


def debris_pirate_d(atlas_dir, rng):
    """Cockpit shard: angular armour hump with the red T-slit visor glass,
    a raked horn stub; cracked diagonally, a loose red glass splinter."""
    hump = G.prism('Hump', [(-0.36, -0.24), (0.22, -0.24), (0.36, 0.0), (0.22, 0.24), (-0.36, 0.24)], -0.08, 0.14,
                   'pir_gunmetal', bevel=0.02, seg=1)
    roof = G.prism('Roof', [(-0.3, -0.17), (0.14, -0.17), (0.26, 0.0), (0.14, 0.17), (-0.3, 0.17)], 0.14, 0.2,
                   'pir_plate_worn', bevel=0.012, seg=1)
    vis = G.prism('Visor', [(0.02, -0.03), (0.2, -0.03), (0.2, 0.03), (0.02, 0.03)], 0.199, 0.212, 'pir_glass_red')
    vis2 = G.prism('VisorT', [(0.14, -0.13), (0.2, -0.13), (0.2, 0.13), (0.14, 0.13)], 0.199, 0.212, 'pir_glass_red')
    horn = G.cyl('Horn', 0.05, 0.26, 'pir_gunmetal_dark', verts=5, r2=0.0)
    horn.data.transform(Matrix.Translation((0, 0, 0.13)))
    W.place(horn, loc=(-0.18, 0.17, 0.16), rot=(-50, -25, 0))
    planes = [((-0.05, -0.05, 0), (-0.8, -1.0, 0.25)), ((-0.18, 0.0, 0), (-1.0, -0.35, -0.2))]
    for o in (hump, roof, vis, vis2):
        W.broken(o, planes)
    pcs = [hump, roof, vis, vis2, horn]
    sh = G.prism('Splinter', [(0, 0), (0.16, 0.03), (0.05, 0.08)], 0.0, 0.014, 'pir_glass_red')
    W.place(sh, loc=(-0.3, -0.22, 0.12), rot=(18, -12, -40))
    pcs.append(sh)
    _rivets(pcs, [(-0.3, 0.2), (0.15, 0.2), (0.15, -0.2)], 0.15, r=0.016)
    pcs.append(G.box('Ember', -0.06, 0.0, -0.006, 0.004, 0.15, 0.205, 'ember'))
    W.place(pcs[-1], loc=(0.0, -0.06, 0), rot=(0, 0, 40))
    return _finish('Debris_Pirate_D', pcs, atlas_dir, rng, amount=0.45)


def debris_pirate_e(atlas_dir, rng):
    """Toothed bell fragment: crude octagonal engine bell with welded teeth on
    the lip, rust band, half of it blown away."""
    prof = [(0.06, 0.15), (-0.04, 0.18), (-0.22, 0.29), (-0.25, 0.32), (-0.225, 0.345), (-0.04, 0.25), (0.06, 0.22)]
    bell = G.lathe('Bell', prof, [0, 0, 0, 1, 2, 2, 2], ['nozzle_in', 'pir_rust', 'pir_gunmetal'], axis='X', verts=8,
                   smooth=False)
    band = G.ring_band('Band', 0.26, 0.17, -0.04, 0.04, 'pir_rust_dark', loc=(0.0, 0, 0), axis='X', verts=8,
                       smooth=False)
    pcs = [bell, band]
    for k in range(8):
        a = math.radians(22.5 + k * 45)
        t = G.cyl(f'Tooth{k}', 0.035, 0.1, 'pir_gunmetal_dark', verts=4, r2=0.0)
        t.data.transform(Matrix.Translation((0, 0, 0.05)))
        W.place(t, loc=(-0.24, 0.33 * math.cos(a), 0.33 * math.sin(a)), rot=(math.degrees(a) - 90, 0, 0))
        W.place(t, rot=(0, 0, 0))
        pcs.append(t)
    planes = [((0, 0, -0.03), (0.1, 0.2, -1.0)), ((0, 0.18, 0.0), (0.2, 1.0, -0.6))]
    for o in pcs:
        W.broken(o, planes)
    pcs.append(G.box('Ember', -0.22, 0.04, -0.012, 0.012, -0.01, 0.014, 'ember'))
    W.place(pcs[-1], loc=(0, -0.22, 0.0))
    return _finish('Debris_Pirate_E', pcs, atlas_dir, rng, amount=0.5, radius=0.3)


# ============================================================================
# B2 - Forge-smith debris (wardens / Colossus): monolithic, no plates or bolts
# ============================================================================
def _blade_piece(name, L, w0, th0, curve, steps=7):
    secs = []
    for i in range(steps + 1):
        t = i / steps
        x = t * L
        y = curve * math.sin(math.pi * t * 0.8)
        w = w0 * (1 - t) ** 0.7 + 0.012
        th = th0 * (1 - t) + 0.012
        c = Vector((x, y, 0))
        secs.append([c + Vector((0, w, 0)), c + Vector((0, 0, th)), c - Vector((0, w, 0)), c - Vector((0, 0, th * 0.5))])
    return KV.loft(name, secs, 'kov_obsidian'), secs


def debris_kovaci_a(atlas_dir, rng):
    """Blade shard: tip of an obsidian blade (diamond section, leaf curve)
    with bronze edge inlays and a long-short-short glyph run gone dark, one
    dash still glowing; clean conchoidal fracture at the base."""
    L = 1.0
    bl, secs = _blade_piece('Blade', L, 0.2, 0.12, 0.1)
    pcs = [bl]
    for side in (0, 2):
        a = secs[1][side]
        b = secs[6][side]
        pcs.append(KV.bar(f'Edge{side}', a + Vector((0, 0, 0.008)), b + Vector((0, 0, 0.008)), 0.045, 'kov_bronze'))
    # glyph dashes along the ridge (long-short-short), mostly dead
    t, k = 0.12, 0
    pattern = (0.12, 0.045, 0.045)
    while t < 0.72:
        Lk = pattern[k % 3]
        p0 = Vector((t * L, 0.1 * math.sin(math.pi * t * 0.8), 0.12 * (1 - t) + 0.016))
        t1 = t + Lk
        p1 = Vector((t1 * L, 0.1 * math.sin(math.pi * t1 * 0.8), 0.12 * (1 - t1) + 0.016))
        pcs.append(KV.bar(f'Glyph{k}', p0, p1, 0.028, 'ember' if k == 3 else 'scorch'))
        t = t1 + (0.07 if k % 3 == 2 else 0.03)
        k += 1
    W.broken(bl, [((0.1, 0, 0), (-1.0, 0.4, 0.5)), ((0.06, 0.05, 0), (-1.0, -0.6, -0.4))], cut_key='kov_obsidian')
    for o in pcs[1:]:
        W.broken(o, [((0.1, 0, 0), (-1.0, 0.4, 0.5))], cut_key='kov_bronze')
    return _finish('Debris_Kovaci_A', pcs, atlas_dir, rng, amount=0.18, radius=0.25, floor=0.4)


def debris_kovaci_b(atlas_dir, rng):
    """Bronze ring segment: a floating-ring segment (bronze, obsidian inner
    band) with ember tick glyphs - one still hot - snapped at one end."""
    R, span, w, h = 0.62, 78, 0.15, 0.11
    secs, secs2 = [], []
    for i in range(9):
        a = math.radians(-span / 2 + span * i / 8)
        rad = Vector((math.cos(a), math.sin(a), 0))
        c = rad * R
        up = Vector((0, 0, h / 2))
        secs.append([c - rad * w / 2 - up, c + rad * w / 2 - up, c + rad * w / 2 + up, c - rad * w / 2 + up])
        c2 = rad * (R - w / 2 - 0.03)
        up2 = Vector((0, 0, h * 0.3))
        secs2.append([c2 - rad * 0.03 - up2, c2 + rad * 0.03 - up2, c2 + rad * 0.03 + up2, c2 - rad * 0.03 + up2])
    ring = KV.loft('Ring', secs, 'kov_bronze')
    inner = KV.loft('Inner', secs2, 'kov_obsidian')
    pcs = [ring, inner]
    for k, f in enumerate((0.2, 0.32, 0.4, 0.62, 0.74, 0.82)):
        a = math.radians(-span / 2 + span * f)
        rad = Vector((math.cos(a), math.sin(a), 0))
        Lk = w * (0.7 if k % 3 == 0 else 0.4)
        c = rad * R + Vector((0, 0, h / 2 + 0.006))
        pcs.append(KV.bar(f'Tick{k}', c - rad * Lk / 2, c + rad * Lk / 2, 0.03, 'ember' if k == 3 else 'scorch'))
    a = math.radians(span / 2 - 6)
    end = Vector((math.cos(a), math.sin(a), 0)) * R
    tang = Vector((-math.sin(a), math.cos(a), 0))
    planes = [(end, tang + Vector((0, 0, 0.6))), (end - tang * 0.03, tang + Vector((0.3, 0, -0.5)))]
    for o in pcs:
        W.broken(o, planes, cut_key='scorch')
    return _finish('Debris_Kovaci_B', pcs, atlas_dir, rng, amount=0.15, radius=0.2, floor=0.45)


def debris_kovaci_c(atlas_dir, rng):
    """Shattered heart chunk: faceted obsidian splinter with a violet crystal
    prism breaking out of it, a bronze band fragment and two glyph cuts."""
    pts = []
    for i in range(16):
        u = rng.uniform(-1, 1)
        a = rng.uniform(0, 2 * math.pi)
        r = math.sqrt(max(0.0, 1 - u * u))
        pts.append(Vector((u * 0.38, r * math.cos(a) * 0.2, r * math.sin(a) * 0.17)))
    chunk = W.hull_from_points('Chunk', pts, 'kov_obsidian')
    cr = KV.crystal_column('Crystal', 0.075, 0.0, 0.4, sides=6)
    W.place(cr, loc=(0.05, 0.02, 0.0), rot=(30, 28, 15))
    cr2 = KV.crystal_column('Crystal2', 0.045, 0.0, 0.22, sides=5)
    W.place(cr2, loc=(-0.1, -0.03, 0.02), rot=(-40, -20, 0))
    band = G.box('Band', -0.04, 0.04, -0.23, 0.23, -0.07, 0.07, 'kov_bronze')
    W.place(band, loc=(-0.2, 0, 0.0), rot=(0, 12, 0))
    W.broken(band, [((-0.2, 0.12, 0), (0, 1.0, 0.3))], cut_key='scorch')
    pcs = [chunk, cr, cr2, band]
    for k, (x, ln) in enumerate(((0.12, 0.12), (0.26, 0.05))):
        g = G.box(f'Glyph{k}', x, x + ln, -0.015, 0.015, 0.0, 0.03, 'ember' if k == 0 else 'scorch')
        W.place(g, loc=(0, -0.02, 0.13 - 0.03 * k))
        pcs.append(g)
    return _finish('Debris_Kovaci_C', pcs, atlas_dir, rng, amount=0.15, radius=0.2, floor=0.45)


BUILDERS = {
    'debris_a': debris_a, 'debris_b': debris_b, 'debris_c': debris_c, 'debris_d': debris_d, 'debris_e': debris_e,
    'debris_pirate_a': debris_pirate_a, 'debris_pirate_b': debris_pirate_b, 'debris_pirate_c': debris_pirate_c,
    'debris_pirate_d': debris_pirate_d, 'debris_pirate_e': debris_pirate_e,
    'debris_kovaci_a': debris_kovaci_a, 'debris_kovaci_b': debris_kovaci_b, 'debris_kovaci_c': debris_kovaci_c,
}
SETS = {'human': ['a', 'b', 'c', 'd', 'e'], 'pirate': ['pirate_a', 'pirate_b', 'pirate_c', 'pirate_d', 'pirate_e'],
        'kovaci': ['kovaci_a', 'kovaci_b', 'kovaci_c']}


def build(name, atlas_dir):
    rng = random.Random(sum(map(ord, name)))
    return BUILDERS[name](atlas_dir, rng)
