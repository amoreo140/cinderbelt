"""Previews of art batch C (Guild Watch, sector borders, NPC traffic) - rendered
from the SHIPPED (optimized) GLBs.

  blender --background --factory-startup --python art/blender/preview_guild_borders.py -- [--only a,b] [--iter bcN]
          [--files npc/guild_cutter,borders/lane_buoy]   (stage 'close' only)

  close    batch-c-close.png            3/4 + top view of --files (quick iteration)
  guild    batch-c-guild.png            cutter, frigate, picket (3/4 close-ups, node markers)
           batch-c-guild-gamecam.png    game camera (pitch 55, vFOV 50) at distance 48 and 140 next to
                                        the starter ship and the trader, ring-1 sky dimmed; + -grey.png
  borders  batch-c-borders.png          lane buoy + the four security markers (3/4 + top view)
           batch-c-borders-gamecam.png  a border run (markers + mocked fence/ribbon between them) and a
                                        Guild Lane at distance 48 and 140; + -grey.png
  traffic  batch-c-traffic.png          the four civilian ships (3/4 + top)
           batch-c-traffic-gamecam.png  station traffic around station_a at distance 48 / 140; + -grey.png
  vfx      batch-c-vfx.png              border ribbon + fence textures, tinted by the security tokens
Every game-camera shot gets a greyscale copy (*-grey.png): research R4 - gameplay
objects (ships, minable rocks) stay the brightest things; border markers read but
stay calmer.
"""
import math
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
import preview_landmarks as PL  # noqa: E402
from lib import render as R  # noqa: E402

TMP = os.path.join(paths.OUT, 'tmp_tiles_batch_c')
ITER = os.path.join(paths.PREVIEWS, 'iterations')
BORDERS = os.path.join(paths.MODELS, 'borders')

# security colours = UI tokens (src/ui/theme/tokens.css), map legend of the sectors design §5.1
TOKENS = {'guarded': '#6be38a', 'quiet': '#9fb4cc', 'contested': '#ffb547', 'pirate': '#ff5a4a',
          'lane': '#f27a2c'}


def _lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def _clear():
    for o in list(bpy.data.objects):
        if o.type in ('MESH', 'EMPTY', 'FONT'):
            bpy.data.objects.remove(o)


def grey(png):
    a = R.read_png(png)
    y = a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722
    a[..., 0] = a[..., 1] = a[..., 2] = y
    out = png[:-4] + '-grey.png'
    R.write_png(a, out)
    return out


def model(rel):
    return os.path.join(paths.MODELS, rel + '.glb')


def imp(rel, loc=(0, 0, 0), yaw=0.0, scale=1.0, hide=()):
    roots, new = PV.import_glb(model(rel) if not os.path.isabs(rel) else rel, loc=loc, rot_z=yaw)
    for r in roots:
        r.scale = (scale, scale, scale)
    for o in new:
        if any(o.name.startswith(h) for h in hide):
            o.hide_render = True
    bpy.context.view_layer.update()
    return new


def starter_ship(origin=(0, 0), rot=0.0):
    ca, sa = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    objs = []
    for f, (x, y), r in PV.M1_SHIP:
        objs += imp(os.path.join(paths.PARTS, f + '.glb'), loc=(origin[0] + x * ca - y * sa,
                                                            origin[1] + x * sa + y * ca, 0), yaw=r + rot)
    for f, (x, y), r in PV.connector_placements([c for _, c, _ in PV.M1_SHIP]):
        objs += imp(os.path.join(paths.PARTS, f + '.glb'), loc=(origin[0] + x * ca - y * sa,
                                                            origin[1] + x * sa + y * ca, 0), yaw=r + rot)
    return objs


def node_markers(objs, prefixes=('muzzle_', 'thruster_', 'fence_', 'glow_', 'dock_port', 'banner_')):
    """Small green spheres on the contract empties (QA view)."""
    out = []
    mat = bpy.data.materials.get('QA_Marker')
    if mat is None:
        mat = bpy.data.materials.new('QA_Marker')
        nt = mat.node_tree
        nt.nodes.clear()
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (0.1, 1.0, 0.25, 1)
        em.inputs['Strength'].default_value = 6
        o = nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(em.outputs[0], o.inputs[0])
    for o in objs:
        if o.type == 'EMPTY' and o.name.split('.')[0].startswith(prefixes):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.07, location=o.matrix_world.translation)
            s = bpy.context.active_object
            s.data.materials.append(mat)
            # direction tick along the empty's local +X
            d = o.matrix_world.to_3x3() @ Vector((1, 0, 0))
            bpy.ops.mesh.primitive_cylinder_add(radius=0.025, depth=0.5,
                                                location=o.matrix_world.translation + d.normalized() * 0.25)
            c = bpy.context.active_object
            c.rotation_mode = 'QUATERNION'
            c.rotation_quaternion = d.to_track_quat('Z', 'Y')
            c.data.materials.append(mat)
            out += [s, c]
    return out


def studio_tiles(entries, tile_w, tile_h, prefix, views=((36, -58),), markers=False, margin=0.95):
    """entries: [(rel model path, label, kw)] -> tile paths; one tile per (entry, view)."""
    cam = PV._new_scene(tile_w, tile_h, 96, key_az=-120)
    tiles = []
    for i, (rel, label, kw) in enumerate(entries):
        _clear()
        objs = imp(rel, **(kw or {}))
        if markers:
            node_markers(objs)
        c, r = R.bounds(objs)
        tris = PV._tri_count([o for o in objs if not o.hide_render])
        for k, (el, az) in enumerate(views):
            R.aim_camera(cam, c, el, az, R.fit_distance(cam, r, margin=margin))
            lab = R.camera_label(cam, f'{label}  {tris} tris' if k == 0 else label + ('  (top)' if el > 80 else '  (rear)'), y_frac=-0.43,
                                 size_frac=0.05)
            tiles.append(R.render_to(os.path.join(TMP, f'{prefix}_{i}_{k}.png')))
            bpy.data.objects.remove(lab)
    return tiles


# ----------------------------------------------------------------------------
# stages
# ----------------------------------------------------------------------------
def close(tag, files):
    entries = [(f, f.split('/')[-1], None) for f in files]
    tiles = studio_tiles(entries, 720, 520, 'close', views=((32, -58), (88, -90), (20, 140)), markers=True)
    png = os.path.join(paths.PREVIEWS, 'batch-c-close.png')
    R.stitch(tiles, 3, 720, 520, png, gap=4)
    return [png]


# ----------------------------------------------------------------------------
# game-camera helpers: markers, fences, ribbon, glows
# ----------------------------------------------------------------------------
GW, GH = 1280, 720
ALL_BANNERS = ('Banner_rust', 'Banner_cauldron', 'Banner_slantedStar')
SEC_LAMP = {'guarded': TOKENS['guarded'], 'quiet': '#cfe3ff', 'contested': TOKENS['contested'],
            'pirate': TOKENS['pirate'], 'lane': '#ffb347'}


def _base(o):
    return o.name.split('.')[0]


def strip_material(name, tex, color_hex, strength):
    img = bpy.data.images.load(os.path.join(paths.VFX, tex), check_existing=True)
    m = PL._additive(name, _lin(color_hex), strength, img)
    for n in m.node_tree.nodes:
        if n.type == 'TEX_IMAGE':
            n.extension = 'REPEAT'
    return m


def add_strip(name, pts, width, mat, repeat, side_fn):
    """Quad strip along the polyline pts (world Vectors); side_fn(p, d) -> unit side vector."""
    verts, faces, uvs = [], [], []
    u = 0.0
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        s = side_fn(p, d) * (width / 2)
        if i > 0:
            u += (p - pts[i - 1]).length / repeat
        verts += [p - s, p + s]
        uvs.append((u, 0.0))
        uvs.append((u, 1.0))
    for i in range(len(pts) - 1):
        faces.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = uvs[me.loops[li].vertex_index]
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.visible_shadow = False
    return ob


def fence(name, a, b, kind, cam, strength=1.4, pts=None):
    mat = strip_material(f'Fence_{kind}', f'border_fence_{kind}.png', TOKENS[kind], strength)
    view = (cam.matrix_world.to_3x3() @ Vector((0, 0, -1))).normalized()
    if pts is None:
        n = max(2, int((b - a).length / 2))
        pts = [a.lerp(b, k / n) for k in range(n + 1)]
    return add_strip(name, pts, 0.7, mat, 6.0, lambda p, d: d.cross(view).normalized())


def ribbon(name, pts, kind, strength=0.25, width=14.0):
    mat = strip_material(f'Ribbon_{kind}', 'border_ribbon.png', TOKENS[kind], strength)
    return add_strip(name, pts, width, mat, 40.0, lambda p, d: d.cross(Vector((0, 0, 1))).normalized())


def marker(kind, pos, tangent_deg, clan='rust', y=-0.6, scale=1.0):
    """Import a border marker with local +Y along the border tangent. Returns (objs, empties by name)."""
    hide = tuple(b for b in ALL_BANNERS if b != f'Banner_{clan}')
    objs = imp(f'borders/border_{kind}', loc=(pos[0], pos[1], y), yaw=tangent_deg - 90, scale=scale, hide=hide)
    em = {_base(o): o.matrix_world.translation.copy() for o in objs if o.type == 'EMPTY'}
    return objs, em


def glows(cam, objs, color_hex, size=2.6, opacity=0.8):
    for o in objs:
        if o.type == 'EMPTY' and _base(o).startswith('glow_'):
            PL.glow_sprite(cam, o.matrix_world.translation.copy(), size, color_hex, opacity)


def border_run(cam, kind, pts, tangent_fn, clan='rust', fences=True, glow=True):
    """Markers at pts with fences between consecutive markers."""
    prev = None
    for i, p in enumerate(pts):
        objs, em = marker(kind, p, tangent_fn(p), clan=clan)
        if glow:
            glows(cam, objs, SEC_LAMP[kind])
        if fences and prev is not None and 'fence_l' in prev and 'fence_r' in em:
            fence(f'Fence{kind}{i}', prev['fence_l'], em['fence_r'], kind, cam)
        prev = em


def _render_pair(name, build, targets, dists):
    """Render the scene built by build(cam) at each (target, distance); stitch vertically + grey copy."""
    cam = PL.new_scene(GW, GH, 1, samples=64)
    labels = build(cam)
    tiles = []
    for k, (t, d) in enumerate(zip(targets, dists)):
        PL.game_view(cam, d, target=t)
        lab = R.camera_label(cam, f'game camera  pitch 55  vFOV 50  distance {d:g}' + (labels or ''),
                             y_frac=-0.46, size_frac=0.026)
        tiles.append(R.render_to(os.path.join(TMP, f'{name}_{k}.png')))
        bpy.data.objects.remove(lab)
    png = os.path.join(paths.PREVIEWS, f'{name}.png')
    R.stitch(tiles, 1, GW, GH, png, gap=4)
    return [png, grey(png)]


# ----------------------------------------------------------------------------
# stages
# ----------------------------------------------------------------------------
def guild(tag):
    entries = [('npc/guild_cutter', 'guild_cutter', None), ('npc/guild_frigate', 'guild_frigate', None),
               ('stations/guild_picket', 'guild_picket', None)]
    tiles = studio_tiles(entries, 640, 440, 'guild', views=((32, -58), (88, -90)), markers=True)
    png = os.path.join(paths.PREVIEWS, 'batch-c-guild.png')
    R.stitch(tiles, 2, 640, 440, png, gap=4)

    def build(cam):
        starter_ship((0, 0))
        imp('npc/guild_cutter', loc=(-11, 7, 0.4), yaw=12)
        imp('npc/guild_cutter', loc=(-14, -5, 0.2), yaw=-8)
        imp('npc/guild_frigate', loc=(12, 10, 0.6), yaw=-15)
        imp('stations/guild_picket', loc=(22, -9, -0.5), yaw=200)
        imp('npc/trader', loc=(-30, 14, 0.0), yaw=12)
        imp('npc/guild_cutter', loc=(-38, 20, 0.3), yaw=12)
        for x in (-70, 60):
            b = imp('borders/lane_buoy', loc=(x, -30, -0.4), yaw=0)
            glows(cam, b, SEC_LAMP['lane'], size=3.0)
        PV.add_rocks([('asteroid_iron_b', (-24.0, -16.0, -1.0), 30), ('asteroid_copper_a', (30.0, 18.0, -1.2), 120)])
        return '   (starter ship, 3 cutters, frigate, picket, trader, lane buoys)'
    return [png] + _render_pair('batch-c-guild-gamecam', build, [(0, 2, 0), (0, 10, 0)], [48, 140])


def borders(tag):
    entries = [('borders/lane_buoy', 'lane_buoy', None),
               ('borders/border_guarded', 'guarded', None), ('borders/border_quiet', 'quiet', None),
               ('borders/border_contested', 'contested', None)]
    entries += [('borders/border_pirate', f'pirate {c}',
                 dict(hide=tuple(b for b in ALL_BANNERS if b != f'Banner_{c}'))) for c in ('rust', 'cauldron',
                                                                                         'slantedStar')]
    tiles = studio_tiles(entries, 420, 420, 'borders', views=((30, -58), (88, -90)), markers=True, margin=1.05)
    # 7 entries x 2 views -> 14 tiles; arrange as 7 columns x 2 rows (3/4 row, top row)
    order = [tiles[2 * i] for i in range(7)] + [tiles[2 * i + 1] for i in range(7)]
    png = os.path.join(paths.PREVIEWS, 'batch-c-borders.png')
    R.stitch(order, 7, 420, 420, png, gap=4)
    out = [png]

    # lineup: every marker with fence stubs and its ribbon, starter ship for scale (spacing compressed)
    def lineup(cam):
        starter_ship((0, 9))
        kinds = [('guarded', 'rust'), ('quiet', 'rust'), ('contested', 'rust'), ('pirate', 'rust'),
                 ('pirate', 'cauldron'), ('pirate', 'slantedStar')]
        for i, (k, clan) in enumerate(kinds):
            x = -27.5 + i * 11
            objs, em = marker(k, (x, -4), 0, clan=clan)
            glows(cam, objs, SEC_LAMP[k])
            fence(f'F{i}a', em['fence_l'], em['fence_l'] + Vector((3.6, 0, 0)), k, cam)
            fence(f'F{i}b', em['fence_r'] - Vector((3.6, 0, 0)), em['fence_r'], k, cam)
        b = imp('borders/lane_buoy', loc=(-30, 14, -0.4), yaw=0)
        glows(cam, b, SEC_LAMP['lane'], size=3.0)
        b = imp('borders/lane_buoy', loc=(30, 14, -0.4), yaw=0)
        glows(cam, b, SEC_LAMP['lane'], size=3.0)
        PV.add_rocks([('asteroid_iron_a', (14.0, 15.0, -1.0), 30), ('asteroid_ice_b', (-14.0, 17.0, -1.6), 70)])
        return '   (lineup, spacing compressed: guarded, quiet, contested, pirate rust / cauldron / slantedStar)'
    out += _render_pair('batch-c-borders-lineup', lineup, [(0, 2, 0)], [48])

    # real spacing: Guarded | Pirate boundary (alternating markers) + a Guild Lane
    def run(cam):
        starter_ship((0, 0), rot=20)

        def curve(t):        # organic boundary: gentle S curve
            return Vector((t, -10 + 9 * math.sin(t / 55.0) + 4 * math.sin(t / 23.0), 0))

        def tangent(p):
            d = curve(p.x + 0.5) - curve(p.x - 0.5)
            return math.degrees(math.atan2(d.y, d.x))
        xs = [-245 + 70 * k for k in range(8)]
        pts = [curve(x) for x in xs]
        ribbon('BorderRib', [curve(x) + Vector((0, 0, -0.9)) for x in range(-260, 261, 6)], 'pirate')
        for i, p in enumerate(pts):
            k = 'guarded' if i % 2 == 0 else 'pirate'
            off = Vector((0, 3 if k == 'guarded' else -3, 0))
            ang = tangent(p) + (0 if k == 'guarded' else 180)
            objs, em = marker(k, p + off, ang)
            glows(cam, objs, SEC_LAMP[k])
        # fences per side: guarded markers link to guarded, pirate to pirate
        for k, s in (('guarded', 0), ('pirate', 1)):
            ps = [pts[i] for i in range(s, len(pts), 2)]
            off = Vector((0, 3 if k == 'guarded' else -3, 1.9))
            for i in range(len(ps) - 1):
                # the fence follows the boundary spline between the two emitters (sampled every 4 u)
                xs_ = [ps[i].x + (ps[i + 1].x - ps[i].x) * t / 35 for t in range(36)]
                fence(f'RF{k}{i}', None, None, k, cam, pts=[curve(x) + off for x in xs_])
        # Guild Lane: buoys on the centre line every 140 u, heading +X
        for x in (-210, -70, 70, 210):
            b = imp('borders/lane_buoy', loc=(x, 46 + x * 0.05, -0.4), yaw=3)
            glows(cam, b, SEC_LAMP['lane'], size=3.0)
        imp('npc/guild_cutter', loc=(-40, 40, 0.3), yaw=3)
        imp('npc/trader', loc=(-60, 42, 0.0), yaw=3)
        PV.add_rocks([('asteroid_iron_b', (-20.0, -40.0, -1.0), 30), ('asteroid_copper_a', (28.0, -36.0, -1.2), 120),
                      ('asteroid_titanium_a', (40.0, -52.0, -1.2), 60)])
        return '   (Guarded | Pirate boundary at real spacing 70 u, Guild Lane buoys every 140 u)'
    out += _render_pair('batch-c-borders-gamecam', run, [(0, -4, 0), (0, 12, 0)], [48, 140])
    return out


def traffic(tag):
    entries = [('npc/miner_barge', 'miner_barge', None), ('npc/tanker', 'tanker', None),
               ('npc/courier', 'courier', None), ('npc/survey_ship', 'survey_ship', None)]
    tiles = studio_tiles(entries, 560, 400, 'traffic', views=((32, -58), (88, -90)), markers=True)
    order = [tiles[2 * i] for i in range(4)] + [tiles[2 * i + 1] for i in range(4)]
    png = os.path.join(paths.PREVIEWS, 'batch-c-traffic.png')
    R.stitch(order, 4, 560, 400, png, gap=4)

    def build(cam):
        imp('stations/station_a', loc=(0, 0, 0), yaw=0)
        starter_ship((22, 0), rot=180)
        imp('npc/miner_barge', loc=(-14, 17, 0.6), yaw=-60)
        imp('npc/tanker', loc=(-22, -13, 0.6), yaw=60)
        imp('npc/courier', loc=(4, 19, 1.0), yaw=150)
        imp('npc/survey_ship', loc=(-6, -15, 0.6), yaw=-170)
        imp('npc/trader', loc=(-32, 4, 0.6), yaw=90)
        imp('npc/guild_cutter', loc=(15, -14, 0.4), yaw=30)
        return '   (station_a: barge, tanker, courier, survey ship, trader, Guild cutter)'
    return [png] + _render_pair('batch-c-traffic-gamecam', build, [(0, -1, 0), (0, 6, 0)], [48, 140])


def vfx(tag):
    """Ribbon + fence per security level, tinted with the token colour, additive over --af-screen."""
    bg = np.array([0x0a, 0x15, 0x21], np.float32) / 255.0
    W = 1024
    rows = []

    def tinted(img, hexcol, gain=1.0):
        c = np.array([int(hexcol[i:i + 2], 16) / 255.0 for i in (1, 3, 5)], np.float32)
        a = img[..., 3:4] * gain
        return np.clip(bg + img[..., :3] * c * a, 0, 1)

    for kind in ('guarded', 'quiet', 'contested', 'pirate'):
        rib = R.read_png(os.path.join(paths.VFX, 'border_ribbon.png'))
        fen = R.read_png(os.path.join(paths.VFX, f'border_fence_{kind}.png'))
        rib = np.tile(rib, (1, W // rib.shape[1], 1))
        fen = np.tile(np.kron(fen, np.ones((2, 2, 1), np.float32)), (1, W // (fen.shape[1] * 2), 1))
        rows = [tinted(rib, TOKENS[kind], 0.9), tinted(fen, TOKENS[kind], 1.2),
                np.broadcast_to(bg, (8, W, 3)).copy()] + rows        # read_png rows are bottom-up
    img = np.concatenate(rows, 0)
    img = np.concatenate([img, np.ones(img.shape[:2] + (1,), np.float32)], -1)
    png = os.path.join(paths.PREVIEWS, 'batch-c-vfx.png')
    R.write_png(img, png)
    return [png]


STAGES = {'guild': guild, 'borders': borders, 'traffic': traffic, 'vfx': vfx}


def main(argv):
    only = argv[argv.index('--only') + 1].split(',') if '--only' in argv else ['guild', 'borders', 'traffic', 'vfx']
    tag = argv[argv.index('--iter') + 1] if '--iter' in argv else None
    files = argv[argv.index('--files') + 1].split(',') if '--files' in argv else []
    os.makedirs(TMP, exist_ok=True)
    out = []
    for st in only:
        out += close(tag, files) if st == 'close' else STAGES[st](tag)
    if tag:
        os.makedirs(ITER, exist_ok=True)
        for p in out:
            shutil.copy(p, os.path.join(ITER, f'{tag}-{os.path.basename(p)}'))
    for p in out:
        print('BC PREVIEW', p)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
