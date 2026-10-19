"""Ship building 2.0 - stage E0 Blender mock-up (ship building 2.0 design, §9).

  blender --background --factory-startup --python art/blender/mockups/ship2_mockup.py -- [--only 1,2,3,4,5,6] [--iter tag]
          [--views game,close,top,hero,side,dmg] [--samples N]

Mock-up only: nothing is exported; outputs go to art/out/previews/:
  ship2-<n>-<name>.png          before | after at the real game camera (pitch 55, vFOV 50, distance 48);
                                the frame is the central 960x540 of a 1920x1080 game view, shown 2x
  ship2-<n>-<name>-close.png    the same pair at the game pitch from close (detail check)
  ship2-<n>-<name>-top.png      top-down
  ship2-4-warship-hero/-side/-dmg.png, ship2-5-pirates-hero.png
  ship2-sheet.png               contact sheet of everything

"Before" = the shipped part GLBs + hull connectors exactly as the game assembles them today.
"After"  = same GLBs for functional parts + shaped / bevelled armour built from polygons
           (ship2_geo.armor_poly) + the automatic hull shell + superstructure top modules.
"""
import math
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BL = os.path.dirname(HERE)
for p in (BL, HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
from lib import geo as G  # noqa: E402
from lib import render as R  # noqa: E402
import ship2_geo as S  # noqa: E402
from ship2_geo import P_  # noqa: E402
C_DECK = 0.20

OUT = paths.PREVIEWS
TMP = os.path.join(paths.OUT, 'tmp_ship2')
GAME_LENS = 12.0 / math.tan(math.radians(25))      # vFOV 50 with sensor height 24
CROP_LENS = GAME_LENS * 2                          # central half of the game frame
SAMPLES = {'game': 128, 'close': 128, 'top': 96, 'hero': 160}
TIERS = {1: 'iron', 2: 'titanium', 3: 'crystal'}


# ---------------------------------------------------------------------------
# layouts (spec §9).  Engine rot: 0 thrust +X, 1 thrust +Y, 2 thrust -X, 3 thrust -Y.
# Wedge slope: rot 0 = FP, 1 = RP, 2 = RS, 3 = FS.
# ---------------------------------------------------------------------------
def starter_before():
    return [P_('cockpit', 1, 0), P_('gyroscope', 0, 0), P_('mining_laser', 2, 0), P_('reactor', -1, 0),
            P_('cargo', 0, 1), P_('cargo', 0, -1), P_('fuel_tank', 1, 1), P_('radar', 1, -1),
            P_('engine', -1, 1), P_('engine', -1, -1), P_('engine', 2, 1, 2), P_('engine', 2, -1, 2),
            P_('engine', 0, -2, 1), P_('engine', 0, 2, 3)]


def starter_after2():
    return starter_before() + [P_('armor', 1, 2, 0, shape='wedge'), P_('armor', 1, -2, 3, shape='wedge')]


def miner_before():
    g = {(-2, 1): 'engine', (-1, 1): 'fuel_tank', (0, 1): 'cargo', (1, 1): 'cargo', (2, 1): 'mining_laser',
         (-2, 0): 'engine', (-1, 0): 'reactor', (0, 0): 'gyroscope', (1, 0): 'cockpit', (2, 0): 'armor',
         (-2, -1): 'engine', (-1, -1): 'radar', (0, -1): 'cargo', (1, -1): 'cargo', (2, -1): 'mining_laser'}
    return [P_(m, x, y) for (x, y), m in g.items()]


def miner_after():
    parts = [p for p in miner_before() if (p.x, p.y) not in ((2, 0), (-1, -1))]
    parts += [P_('armor', 2, 0, 0, shape='nose'), P_('fuel_tank', -1, -1),
              P_('armor', 0.5, 2, 0, shape='wingL'), P_('armor', 0.5, -2, 0, shape='wingR'),
              P_('armor', -1, 2, 1, shape='arc'), P_('armor', -1, -2, 2, shape='arc')]
    tops = [('radar', 1, 0, 0)]
    return parts, tops


def freighter_before():
    rows = {2: ['engine', 'fuel_tank', 'LC', 'LC', 'cargo', 'cargo', 'armor', 'armor'],
            1: ['engine', 'reactor', 'LC', 'LC', 'cargo', 'cargo', 'shield_generator', 'armor'],
            0: ['engine', 'reactor', 'gyroscope', 'battery', 'cargo', 'cargo', 'cockpit', 'armor'],
            -1: ['engine', 'reactor', 'LC', 'LC', 'cargo', 'cargo', 'radar', 'armor'],
            -2: ['engine', 'fuel_tank', 'LC', 'LC', 'cargo', 'cargo', 'tractor_beam', 'armor']}
    out = []
    for y, row in rows.items():
        for i, m in enumerate(row):
            if m != 'LC':
                out.append(P_(m, i - 4, y))
    out += [P_('large_cargo', -1.5, 1.5), P_('large_cargo', -1.5, -1.5)]
    return out


def freighter_after():
    keep = [p for p in freighter_before() if p.x < 2]
    keep += [P_('armor', 2, 2, 0, shape='wedge'), P_('shield_generator', 2, 1), P_('cockpit', 2, 0),
             P_('armor', 2, -1), P_('armor', 2, -2, 3, shape='wedge'),
             P_('armor', 3, 1, 0, shape='wedge'), P_('tractor_beam', 3, 0), P_('armor', 3, -1, 3, shape='wedge'),
             P_('armor', 0.5, 3, 0, shape='wingL'), P_('armor', 0.5, -3, 0, shape='wingR')]
    tops = [('radar', 2, 0, 0), ('cannon', -1, 0, 0)]
    return keep, tops


def warship_before():
    rows = {3: ['engine', 'fuel_tank', 'armor', 'armor', 'armor', 'armor', 'armor', 'armor', 'cannon'],
            2: ['engine', 'reactor', 'gyroscope', 'cargo', 'shield_generator', 'armor', 'cannon', 'armor', 'armor'],
            1: ['engine', 'reactor', 'battery', 'cargo', 'radar', 'armor', 'armor', 'armor', 'armor'],
            0: ['engine', 'reactor', 'gyroscope', 'shield_generator', 'armor', 'armor', 'cockpit', 'armor', 'cannon'],
            -1: ['engine', 'reactor', 'battery', 'cargo', 'shield_generator', 'armor', 'armor', 'armor', 'armor'],
            -2: ['engine', 'reactor', 'gyroscope', 'cargo', 'shield_generator', 'armor', 'cannon', 'armor', 'armor'],
            -3: ['engine', 'fuel_tank', 'armor', 'armor', 'armor', 'armor', 'armor', 'armor', 'cannon']}
    return [P_(m, i - 4, y) for y, row in rows.items() for i, m in enumerate(row)]


def warship_after():
    centre = {2: ['fuel_tank', 'cargo', 'fuel_tank', 'battery', 'gyroscope', 'armor'],
              1: ['reactor', 'reactor', 'shield_generator', 'reactor', 'reactor', 'shield_generator'],
              0: ['gyroscope', 'battery', 'reactor', 'gyroscope', 'cockpit', 'armor']}
    parts = []
    for y, row in centre.items():
        for i, m in enumerate(row):
            parts.append(P_(m, i - 3, y))
            if y:
                parts.append(P_(m, i - 3, -y))
    for y in (3, -3):
        for x in range(-3, 3):
            parts.append(P_('armor', x, y))
    for y in range(-2, 3):
        parts.append(P_('engine', -4, y))
        parts.append(P_('armor', 3, y))
    for y in (-1, 0, 1):
        parts.append(P_('armor', 4, y))
    for (x, y) in ((3, 3), (4, 2), (5, 1)):
        parts.append(P_('armor', x, y, 0, shape='wedge'))
        parts.append(P_('armor', x, -y, 3, shape='wedge'))
    parts.append(P_('armor', 5.5, 0, 0, shape='nose2x1'))
    parts.append(P_('armor', -2.5, 4, 0, shape='wingL'))
    parts.append(P_('armor', -2.5, -4, 0, shape='wingR'))
    tops = [('cannon', 4, 0, 0), ('cannon', 3, 1, 0), ('cannon', 3, -1, 0), ('cannon', -1, 1, 0),
            ('cannon', -1, -1, 0), ('radar', 1, 0, 0)]
    return parts, tops


def hammer_before():
    return [P_('cockpit', 1, 0), P_('armor', 2, 0), P_('armor', 1, 1), P_('armor', 1, -1), P_('cannon', 2, 1),
            P_('cannon', 2, -1), P_('shield_generator', 0, 0), P_('reactor', -1, 0), P_('gyroscope', 0, 1),
            P_('fuel_tank', 0, -1), P_('engine', -2, 0), P_('engine', -1, 1), P_('engine', -1, -1),
            P_('engine', 0, 2, 3), P_('engine', 0, -2, 1), P_('engine', 1, 2, 2), P_('engine', 1, -2, 2)]


def hammer_after():
    parts = [p for p in hammer_before() if p.m != 'cannon']
    parts += [P_('armor', 3, 0, 0, shape='nose'), P_('armor', 2, 1, 0, shape='wedge'),
              P_('armor', 2, -1, 3, shape='wedge'),
              P_('armor', -1.5, 2, 0, shape='wingL'), P_('armor', -1.5, -2, 0, shape='wingR')]
    tops = [('cannon', 1, 1, 0), ('cannon', 1, -1, 0)]
    return parts, tops


def swap(parts, cell, module, rot=0):
    """Replace the part on `cell` by a full 1x1 `module`."""
    out = [p for p in parts if (round(p.x), round(p.y)) != cell or p.size() != (1, 1)]
    return out + [P_(module, cell[0], cell[1], rot)]


def miner_e2():
    parts, _ = miner_after()
    return swap(parts, (-1, -1), 'radar')


def freighter_e2():
    parts, _ = freighter_after()
    return swap(parts, (2, -1), 'radar')


def hammer_e2():
    parts, _ = hammer_after()
    parts = [p for p in parts if (p.x, p.y) not in ((2, 1), (2, -1))]
    return parts + [P_('cannon', 2, 1), P_('cannon', 2, -1)]


def rules_ship():
    """Shell rule test (not in the spec): U-notch, closed hole, 2-wide notch, stepped bow."""
    rows = {2: ['armor', 'armor', 'armor', None, 'armor', 'armor', 'armor'],
            1: ['armor', 'cargo', 'cargo', 'cargo', 'cargo', 'cargo', 'armor', 'armor'],
            0: ['engine', 'reactor', 'gyroscope', None, 'battery', 'cockpit', 'armor', 'cannon'],
            -1: ['armor', 'cargo', 'cargo', 'cargo', 'cargo', 'cargo', 'armor', 'armor'],
            -2: ['armor', 'armor', None, None, 'armor', 'armor', 'armor']}
    return [P_(m, i - 3, y) for y, row in rows.items() for i, m in enumerate(row) if m]


# ---------------------------------------------------------------------------
# assembly
# ---------------------------------------------------------------------------
class Ship:
    def __init__(self, label):
        self.label = label
        self.root = G.empty('Ship_' + label)
        self.objs = []
        self.tris = {}
        self.hidden = False

    def add(self, objs, group='parts'):
        for o in objs:
            if o.parent is None:
                o.parent = self.root
        self.objs += objs
        self.tris[group] = self.tris.get(group, 0) + S.tri_count(objs)

    def place(self, x, y, rot=0.0):
        self.root.location = (x, y, 0)
        self.root.rotation_euler = (0, 0, math.radians(rot))
        bpy.context.view_layer.update()

    def hide(self, hidden=True):
        self.hidden = hidden
        for o in self.objs + [self.root]:
            o.hide_render = hidden

    def world_bbox(self):
        x, y = self.root.location.x, self.root.location.y
        return self.bb[0] + x, self.bb[1] + x, self.bb[2] + y, self.bb[3] + y


def _imp(path, loc=(0, 0, 0), rot_z=0.0):
    return PV.import_glb(path, loc=loc, rot_z=rot_z)


def build_before(label, parts, owner, tier):
    sh = Ship(label)
    cells = []
    for p in parts:
        _, objs = _imp(S.part_file(owner, p.m, tier), loc=(p.x, p.y, 0), rot_z=90 * p.rot)
        sh.add(objs)
        cells += p.cells()
    for kind, (x, y), r in PV.connector_placements(cells):
        _, objs = _imp(S.connector_file(owner, kind.split('_')[-1]), loc=(x, y, 0), rot_z=r)
        sh.add(objs, 'connectors')
    return sh


def sleeve(sh, hobjs, x, y, r=0.40, z=0.44):
    """Top module on a tall host (shield, gyro...): the pedestal keeps its 0.25 height and hides
    the host's above-deck geometry inside its radius (mock rule, see report)."""
    for o in list(hobjs):
        if o.type == 'MESH' and (o.parent is None or o.parent == sh.root):
            bm = bmesh.new()
            bm.from_mesh(o.data)
            kill = [f for f in bm.faces if any(v.co.z > z and v.co.x ** 2 + v.co.y ** 2 < r * r for v in f.verts)]
            bmesh.ops.delete(bm, geom=kill, context='FACES')
            bm.to_mesh(o.data)
            bm.free()
        elif o.name in bpy.data.objects and o.parent is not None:
            w = o.matrix_world.translation
            if (w.x - x) ** 2 + (w.y - y) ** 2 < r * r and w.z > 0.25:
                for c in [o] + list(o.children_recursive):
                    if c in sh.objs:
                        sh.objs.remove(c)
                    if c in hobjs:
                        hobjs.remove(c)
                    bpy.data.objects.remove(c)


def build_after(label, parts, tops, owner, tier, original=None, detached=None, shell_kw=None,
                skip_tops=(), terrace=None, arcs=False):
    sh = Ship(label)
    st = S.style(owner, tier)
    kw = dict(shell_kw or {})
    if owner != 'player':
        kw.setdefault('bevels', False)     # critic M8 / spec v2: clans get no armour bevels
    shell = S.Shell(parts, st, original_cells=original, **kw)
    by_cell = {}
    for i, p in enumerate(shell.parts):
        if p.m == 'fill':
            continue
        if p.shape or i in shell.bevel_cuts:
            poly = p.poly() if p.shape else S.bevel_poly(p, shell.bevel_cuts[i])
            objs = S.armor_poly(f'Armor_{i}', poly, st, st['lvl'])
            sh.add(objs, 'shaped')
        else:
            _, objs = _imp(S.part_file(owner, p.m, tier), loc=(p.x, p.y, 0), rot_z=90 * p.rot)
            sh.add(objs)
        for c in p.cells():
            by_cell[c] = (p, objs)
    sh.add(shell.build('Shell_' + label), 'shell')
    for kind, (x, y), r in getattr(shell, 'connectors', []):
        _, objs = _imp(S.connector_file(owner, kind), loc=(x, y, 0), rot_z=r)
        sh.add(objs, 'shell')
    bpy.context.view_layer.update()
    for (m, x, y, rot) in tops:
        if (x, y) in skip_tops:
            continue
        host, hobjs = by_cell[(x, y)]
        mast = 0.27 if host.m == 'cockpit' else 0.0
        if mast:
            ped = max(0.62, S.host_top(hobjs, x - mast, y, r=0.30) + 0.03)
        else:
            ped = 0.45
            sleeve(sh, hobjs, x, y)
        objs = S.top_module(_imp, S.part_file(owner, m, tier), x, y, 90 * rot, st, ped, mast_dx=mast,
                            name=f'Top_{m}')
        sh.add(objs, 'tops')
    if detached:
        m, (x, y), yaw, tilt = detached
        objs = S.top_module(_imp, S.part_file(owner, m, tier), x, y, yaw, st, 0.45, name='Loose')
        piv = G.empty('LoosePivot', loc=(x, y, -0.15))
        for o in objs:
            if o.parent is None:
                o.parent = piv
                o.location = (o.location[0] - x, o.location[1] - y, o.location[2] + 0.15)
        piv.rotation_euler = (math.radians(tilt), math.radians(tilt * 0.6), 0)
        sh.add(objs + [piv], 'tops')
    if terrace:
        hmax = max(S.host_top(by_cell[c][1], c[0], c[1], r=0.62) for c in terrace)
        acc = S.Acc('Terrace')
        S.terrace(acc, terrace, st, max(C_DECK + 0.12, hmax + 0.03))
        sh.add([acc.build(bevel=0.008)], 'terrace')
        sh.terrace_top = max(C_DECK + 0.12, hmax + 0.03)
    if arcs:
        acc = S.Acc('Arcs')
        sh.arcs = []
        # one colour per cannon column, so overlapping fans stay apart
        cols = sorted({p.x for p in parts if p.m == 'cannon'})
        mats = ('radar_glow', 'engine_glow', 'fuel_glow')
        for p in parts:
            if p.m == 'cannon':
                ivs = S.arc_fan(acc, (p.x, p.y), 90 * p.rot, [q.poly() for q in parts if q is not p],
                                mat=mats[cols.index(p.x) % len(mats)])
                sh.arcs.append(((p.x, p.y), ivs))
        sh.add([acc.build()], 'overlay')
    sh.shell = shell
    return sh


# ---------------------------------------------------------------------------
# rendering (spec v2 §9.1: native 1080p crops at distance 48 and 100, 3/4 close-up at elevation 35)
# ---------------------------------------------------------------------------
SHIPS = []          # every ship of the current scene (renders hide all but the subject)


def new_scene(w=960, h=540, samples=128, seed=3.0):
    G.reset_scene()
    SHIPS.clear()
    R.setup_render(w, h, samples=samples)
    R.setup_world(seed=seed)
    R.setup_lights(key_az=-135)
    return R.make_camera('Cam', lens=50)


def set_res(w, h, samples):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.cycles.samples = samples


def clear_labels():
    for o in list(bpy.data.objects):
        if o.type == 'FONT':
            bpy.data.objects.remove(o)


def solo(ships):
    for s in SHIPS:
        s.hide(s not in ships)


def caption(cam, text, px, h, top=False):
    """Text of `px` pixels height at the bottom (or top) of an h-pixel frame."""
    clear_labels()
    y = (0.5 - px * 1.0 / h) if top else (-0.5 + px * 1.0 / h)
    R.camera_label(cam, text, y_frac=y, x_frac=0, size_frac=px / h)


def ship_bounds(ships):
    x0 = min(s.world_bbox()[0] for s in ships)
    x1 = max(s.world_bbox()[1] for s in ships)
    y0 = min(s.world_bbox()[2] for s in ships)
    y1 = max(s.world_bbox()[3] for s in ships)
    return x0, x1, y0, y1


def render_native(ship, path, dist, text):
    """Game camera (pitch 55, vFOV 50) at `dist`, 1:1 crop of a 1920x1080 frame around the ship."""
    cam = bpy.context.scene.camera
    solo([ship])
    x0, x1, y0, y1 = ship_bounds([ship])
    ppu = 1080 / (2 * dist * math.tan(math.radians(25)))      # pixels per cell at the target
    txt = 13
    w = max(int(len(text) * 7.2 + 16), int(math.ceil((x1 - x0) * ppu + 28) / 4) * 4 + 4)
    w += w % 2
    h = int(math.ceil(((y1 - y0) * 0.82 + 0.8) * ppu + 2 * (txt + 8)) / 4) * 4 + 4
    set_res(w, h, SAMPLES['game'])
    cam.data.lens = GAME_LENS * 1080 / h
    R.aim_camera(cam, ((x0 + x1) / 2, (y0 + y1) / 2, 0.1), 55, -90, float(dist))
    caption(cam, text, txt, h)
    R.render_to(path)
    cam.data.lens = 50
    return path


def render_close(ships, path, text, el=35, az=-62, w=960, h=540, margin=0.80, samples=None, target_dz=0.15):
    cam = bpy.context.scene.camera
    solo(ships)
    set_res(w, h, samples or SAMPLES['close'])
    cam.data.lens = 50
    objs = [o for s in ships for o in s.objs if o.type == 'MESH']
    c, r = R.bounds(objs)
    R.aim_camera(cam, (c[0], c[1], target_dz), el, az, R.fit_distance(cam, r, margin=margin))
    caption(cam, text, 17 * h / 540, h)
    R.render_to(path)
    return path


# ---------------------------------------------------------------------------
# compositing (numpy): panels side by side, every image at its own pixel size
# ---------------------------------------------------------------------------
BG = (0.02, 0.025, 0.035)


def compose(rows, out, gap=8):
    imgs = [[R.read_png(p) for p in row if p] for row in rows]
    W = max(sum(a.shape[1] for a in row) + gap * (len(row) - 1) for row in imgs)
    H = sum(max(a.shape[0] for a in row) for row in imgs) + gap * (len(imgs) - 1)
    canvas = np.zeros((H, W, 4), dtype=np.float32)
    canvas[..., 0], canvas[..., 1], canvas[..., 2], canvas[..., 3] = BG[0], BG[1], BG[2], 1
    ytop = 0
    for row in imgs:
        rh = max(a.shape[0] for a in row)
        x = 0
        for a in row:
            h, w, _ = a.shape
            y = ytop + (rh - h) // 2
            canvas[H - y - h:H - y, x:x + w] = a          # image rows are bottom-up
            x += w + gap
        ytop += rh + gap
    R.write_png(canvas, out)
    return out


def contact_sheet(files, path, tile_w=960, tile_h=540, cols=3):
    tiles = []
    os.makedirs(TMP, exist_ok=True)
    for i, f in enumerate(files):
        a = R.read_png(f)
        h, w, _ = a.shape
        k = max(1, math.ceil(max(w / tile_w, h / tile_h)))
        b = a[::k, ::k][:tile_h, :tile_w]
        canvas = np.zeros((tile_h, tile_w, 4), dtype=np.float32)
        canvas[..., 0], canvas[..., 1], canvas[..., 2], canvas[..., 3] = BG[0], BG[1], BG[2], 1
        hh, ww = b.shape[:2]
        y0, x0 = (tile_h - hh) // 2, (tile_w - ww) // 2
        canvas[y0:y0 + hh, x0:x0 + ww] = b
        t = os.path.join(TMP, f'tile_{i}.png')
        R.write_png(canvas, t)
        tiles.append(t)
    R.stitch(tiles, cols, tile_w, tile_h, path, gap=6)


def P(name):
    return os.path.join(OUT, f'sl2-{name}.png')


# ---------------------------------------------------------------------------
def ship_bbox_local(parts):
    xs, ys = [], []
    for p in parts:
        for x, y in p.poly():
            xs.append(x)
            ys.append(y)
    return min(xs), max(xs), min(ys), max(ys)


_SLOT = [0]


def make(label, parts, tops=(), owner='player', tier='iron', before=False, **kw):
    if before:
        s = build_before(label, parts, owner, tier)
    else:
        s = build_after(label, parts, list(tops), owner, tier, **kw)
    s.bb = ship_bbox_local(parts)
    s.place(_SLOT[0] * 40.0, 0)        # far apart; renders solo() the subject anyway
    _SLOT[0] += 1
    SHIPS.append(s)
    print(f'TRIS {label}: ' + ', '.join(f'{k} {v}' for k, v in s.tris.items()))
    return s


def state_set(cid, states, files, close=True, cols=2, az=-62):
    """states: [(key, caption, ship)] -> per-state natives + close, then the strips
    sl2-<cid>-48 / -100 / -close."""
    out = {}
    for key, cap, ship in states:
        d = {}
        for dist in (48, 100):
            ppu = 1080 / (2 * dist * math.tan(math.radians(25)))
            short = cap.split(' (')[0].split(' ~')[0]
            d[dist] = render_native(ship, P(f'{cid}-{key}-{dist}'), dist, f'{short}  d{dist}')
        if close:
            d['close'] = render_close([ship], P(f'{cid}-{key}-close'), cap + '  - close 3/4, elevation 35',
                                      az=62 if key.startswith('notch') else az)
        out[key] = d
    return out


def strips(cid, rows_keys, rendered, files, cols=2):
    """rows_keys: list of rows of state keys (D has one row per clan)."""
    for dist in (48, 100):
        f = compose([[rendered[k][dist] for k in row] for row in rows_keys], P(f'{cid}-{dist}'))
        files.append(f)
    keys = [k for row in rows_keys for k in row if 'close' in rendered[k]]
    if keys:
        grid = [keys[i:i + cols] for i in range(0, len(keys), cols)]
        f = compose([[rendered[k]['close'] for k in row] for row in grid], P(f'{cid}-close'), gap=6)
        files.append(f)


def decision(name, a, b, files, c=None):
    """Side-by-side decision panel: natives d48 a|b(|c), d100 a|b(|c) on top, close a|b(|c) below."""
    vs = [a, b] + ([c] if c else [])
    f = compose([[v[48] for v in vs] + [v[100] for v in vs], [v['close'] for v in vs]], P(name), gap=10)
    files.append(f)


# ---------------------------------------------------------------------------
# compositions (spec v2 §9.2-9.6)
# ---------------------------------------------------------------------------
def comp_E(files):
    new_scene()
    pred = make('E pred', starter_before(), before=True)
    e1 = make('E po E1', starter_before())
    e2 = make('E po E2', starter_after2())
    e1w = make('E po E1 lip .12', starter_before(), shell_kw={'lip_w': 0.12})
    r = state_set('E', [('pred', 'E pred 14 b', pred), ('e1', 'E po E1 (shell, lip 0.07)', e1),
                        ('e2', 'E po E2 (+2 wedges) 15 b', e2), ('e1-lip12', 'E po E1, lip 0.12', e1w)], files)
    strips('E', [['pred', 'e1', 'e2']], r, files)
    decision('E-lip', r['e1'], r['e1-lip12'], files)


def comp_A(files):
    new_scene()
    parts, tops = miner_after()
    ss = [('pred', 'A Kosa pred 15 b', make('A pred', miner_before(), before=True)),
          ('e1', 'A po E1 (shell)', make('A e1', miner_before())),
          ('e2', 'A po E2 18.5 b', make('A e2', miner_e2())),
          ('ciel', 'A CIEL (E3: radar mast) 20 b', make('A ciel', parts, tops))]
    r = state_set('A', ss, files)
    strips('A', [['pred', 'e1', 'e2', 'ciel']], r, files)


B_TERRACE = [(0, y) for y in range(-2, 3)] + [(1, y) for y in range(-2, 3)]


def comp_B(files):
    new_scene()
    T = 'titanium'
    parts, tops = freighter_after()
    ss = [('pred', 'B Mula pred 38 b', make('B pred', freighter_before(), tier=T, before=True)),
          ('e1', 'B po E1 (shell, lip 0.07)', make('B e1', freighter_before(), tier=T)),
          ('e2', 'B po E2 ~36 b', make('B e2', freighter_e2(), tier=T)),
          ('ciel', 'B CIEL (E3: radar + dorsal cannon) ~39 b', make('B ciel', parts, tops, tier=T)),
          ('e1-lip12', 'B po E1, lip 0.12', make('B e1 lip', freighter_before(), tier=T,
                                                  shell_kw={'lip_w': 0.12})),
          ('e1-terrace', 'B po E1 + TERRACE over cargo', make('B e1 terrace', freighter_before(), tier=T,
                                                              terrace=B_TERRACE))]
    r = state_set('B', ss, files)
    strips('B', [['pred', 'e1', 'e2', 'ciel']], r, files)
    decision('B-lip', r['e1'], r['e1-lip12'], files)
    decision('B-terrace', r['e1'], r['e1-terrace'], files)
    shipyard(files)


def shipyard(files):
    """B po E2 on the hangar floor as the player sees it while building: no notch fills,
    mirror axis visible (spec v2 §9.4)."""
    import preview_batch_d as PBD
    cam = new_scene(1600, 900, SAMPLES['hero'])
    cam.data.lens = 12.0 / math.tan(math.radians(PBD.HANGAR_FOV / 2))
    cam.data.clip_end = 400
    for nm in ('hangar_platform', 'hangar_bay'):
        f = os.path.join(paths.STATIONS, nm + '.glb')
        if os.path.exists(f):
            _imp(f)
    s = build_after('B shipyard', freighter_e2(), [], 'player', 'titanium', shell_kw={'fill': False})
    s.bb = ship_bbox_local(freighter_e2())
    acc = S.Acc('MirrorAxis')
    for k in range(-15, 15):
        x0 = k * 0.5 + 0.05
        S.quad_strip(acc, (x0, 0), (x0 + 0.3, 0), (0, -1), -0.025, 0.025, PBD.HANGAR_FLOOR + 0.002,
                     PBD.HANGAR_FLOOR + 0.012, 'strobe_blue')
        S.quad_strip(acc, (x0, 0), (x0 + 0.3, 0), (0, -1), -0.012, 0.012, 0.9, 0.91, 'strobe_blue')
    acc.build()
    PBD.hangar_camera(cam, 25, 42, 1.25, 16 / 9, pan=(0.5, 0.0))
    caption(cam, 'B po E2 in the shipyard: no notch fills, mirror axis (overlay line)', 22, 900)
    files.append(R.render_to(P('B-shipyard')))


C_TERRACE = [(3, -1), (3, 0), (3, 1), (4, 0)]


def warship_e2():
    """C after E2, corrected layout of spec §9.5 (the first mock-up's cannons "in pockets" behind the
    wedges were walled in): deck cannons on the stair edge cells (3,±3) and (4,±2) instead of wedges,
    FP/FS wedges on (5,±1), the 2x1 nose, radar on (2,0)."""
    parts, _ = warship_after()
    stair = ((3, 3), (4, 2))
    parts = [p for p in parts if not (p.shape == 'wedge' and (p.x, abs(p.y)) in stair)]
    for x, y in stair:
        parts += [P_('cannon', x, y), P_('cannon', x, -y)]
    return swap(parts, (2, 0), 'radar')


def render_arcs_C(files, e2p, tier):
    """sl2-C-arcs.png: top-down firing arcs of the deck cannons as the game computes them."""
    arcs = make('C e2 arcs', e2p, tier=tier, arcs=True)
    for (x, y), ivs in arcs.arcs:
        print(f'ARCS cannon ({x:g},{y:g}): ' + (', '.join(f'{a:+.0f}..{b:+.0f}' for a, b in ivs) or 'walled in'))
    cam = bpy.context.scene.camera
    solo([arcs])
    set_res(1280, 720, SAMPLES['close'])
    x0, x1, y0, y1 = ship_bounds([arcs])
    R.aim_camera(cam, ((x0 + x1) / 2, (y0 + y1) / 2, 0), 89.9, -90, 27)
    txt = '; '.join(f'({x:g},{y:g}) ' + ' '.join(f'{a:+.0f}..{b:+.0f}' for a, b in ivs) for (x, y), ivs in arcs.arcs
                    if y > 0)
    caption(cam, f'C po E2 (spec 9.5) top-down: deck-cannon arcs as the game computes them ({txt}, '
                 'starboard mirrored); red rim = cut by deck polygons', 18, 720)
    files.append(R.render_to(P('C-arcs')))


def comp_C_arcs(files):
    new_scene()
    render_arcs_C(files, warship_e2(), 'crystal')


def comp_C(files):
    new_scene()
    T = 'crystal'
    parts, tops = warship_after()
    e2p = warship_e2()
    notch = [p for p in e2p if (p.x, p.y) != (-2, 3)]
    ciel = make('C ciel', parts, tops, tier=T)
    ss = [('pred', 'C Halapartna pred 63 b', make('C pred', warship_before(), tier=T, before=True)),
          ('e1', 'C po E1 (shell)', make('C e1', warship_before(), tier=T)),
          ('e2', 'C po E2 ~63.5 b', make('C e2', e2p, tier=T)),
          ('ciel', 'C CIEL (E3: 5 cannons + radar on top) ~70.5 b', ciel),
          ('notch-fill', 'C notch: FILL ON (spec: recessed dark)', make('C notch on', notch, tier=T)),
          ('notch-flush', 'C notch: FILL ON (flush plate option)', make('C notch flush', notch, tier=T,
                                                                       shell_kw={'fill_style': 'flush'})),
          ('notch-open', 'C notch: FILL OFF', make('C notch off', notch, tier=T, shell_kw={'fill': False})),
          ('e2-terrace', 'C po E2 + TERRACE (bow spine)', make('C e2 terrace', e2p, tier=T, terrace=C_TERRACE))]
    r = state_set('C', ss, files)
    strips('C', [['pred', 'e1', 'e2', 'ciel']], r, files)
    decision('C-notch', r['notch-open'], r['notch-fill'], files, r['notch-flush'])
    decision('C-terrace', r['e2'], r['e2-terrace'], files)
    # firing arcs over the E2 bow (layer V)
    render_arcs_C(files, e2p, T)
    # side + hero of the target
    files.append(render_close([ciel], P('C-side'), 'C CIEL - side, elevation 10 (hangar orbit only)', el=10,
                              az=-90, w=1600, h=900, margin=0.62, target_dz=0.25))
    files.append(render_close([ciel], P('C-hero'), 'C CIEL - low 3/4', el=16, az=-40, w=1600, h=900,
                              margin=0.55, samples=SAMPLES['hero'], target_dz=0.3))
    # damage: po E2 lost (3,3), (2,3), (4,1);  CIEL lost host (3,1) -> its top cannon floats free
    orig2 = {c for p in e2p for c in p.cells()}
    gone2 = {(3, 3), (2, 3), (4, 1)}
    d2 = make('C e2 dmg', [p for p in e2p if not (set(p.cells()) & gone2)], tier=T, original=orig2)
    origc = {c for p in parts for c in p.cells()}
    dc = make('C ciel dmg', [p for p in parts if (p.x, p.y) != (3, 1)], tops, tier=T, original=origc,
              detached=('cannon', (5.4, 3.4), 35, 28), skip_tops={(3, 1)})
    a = render_close([d2], P('C-dmg-e2-close'), 'C po E2 damaged: (3,3) (2,3) (4,1) lost - torn = no lip + soot',
                     el=48, az=-80, margin=0.72)
    b = render_close([dc], P('C-dmg-ciel-close'), 'C CIEL damaged: host (3,1) lost, its top cannon drifts free',
                     el=48, az=-80, margin=0.72)
    n1 = render_native(d2, P('C-dmg-e2-48'), 48, 'po E2 damaged d48')
    n2 = render_native(dc, P('C-dmg-ciel-48'), 48, 'CIEL damaged d48')
    files.append(compose([[n1, n2], [a, b]], P('C-dmg'), gap=10))


def comp_D(files):
    new_scene()
    T = 'titanium'
    ss, rows = [], []
    for clan, nm in (('slantedStar', 'Sikma hviezda'), ('rust', 'Hrdza')):
        parts, tops = hammer_after()
        k = 'sst' if clan == 'slantedStar' else 'rust'
        ss += [(k + '-pred', f'D {nm} pred 17 b', make(k + ' pred', hammer_before(), owner=clan, tier=T,
                                                         before=True)),
               (k + '-e1', f'D {nm} po E1 (clan shell)', make(k + ' e1', hammer_before(), owner=clan, tier=T)),
               (k + '-e2', f'D {nm} po E2 19.5 b', make(k + ' e2', hammer_e2(), owner=clan, tier=T)),
               (k + '-ciel', f'D {nm} CIEL ~21.5 b', make(k + ' ciel', parts, tops, owner=clan, tier=T))]
        rows.append([k + '-pred', k + '-e1', k + '-e2', k + '-ciel'])
    r = state_set('D', ss, files)
    strips('D', rows, r, files, cols=4)
    sst = [s for k, _, s in ss if k == 'sst-ciel'][0]
    rust = [s for k, _, s in ss if k == 'rust-ciel'][0]
    sst.place(200.0, 2.4)
    rust.place(198.6, -3.0)
    files.append(render_close([sst, rust], P('D-hero'), 'D CIEL - Sikma hviezda (back) and Hrdza (front), low 3/4',
                              el=17, az=-55, w=1600, h=900, margin=0.6, samples=SAMPLES['hero'], target_dz=0.3))


COMPS = {'E': comp_E, 'A': comp_A, 'B': comp_B, 'C': comp_C, 'D': comp_D,
         'Carcs': comp_C_arcs}      # only sl2-C-arcs.png (also part of 'C')


def main(argv):
    only = argv[argv.index('--only') + 1].split(',') if '--only' in argv else [c for c in COMPS if c != 'Carcs']
    tag = argv[argv.index('--iter') + 1] if '--iter' in argv else None
    if '--samples' in argv:
        k = int(argv[argv.index('--samples') + 1])
        for v in SAMPLES:
            SAMPLES[v] = k
    os.makedirs(OUT, exist_ok=True)
    files = []
    for c in only:
        COMPS[c](files)
    print('FILES', files)
    if '--sheet' in argv or '--only' not in argv:
        names = []
        for cid in 'EABCD':
            for suf in ('48', '100', 'close', 'lip', 'terrace', 'notch', 'shipyard', 'arcs', 'side', 'hero', 'dmg'):
                f = P(f'{cid}-{suf}')
                if os.path.exists(f):
                    names.append(f)
        contact_sheet(names, P('sheet'))
    if tag:
        d = os.path.join(OUT, 'iterations')
        os.makedirs(d, exist_ok=True)
        for f in files:
            shutil.copy(f, os.path.join(d, tag + '-' + os.path.basename(f)))
    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
