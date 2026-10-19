"""Art batch C (art audit, batch C; sectors design):
"Guild Watch" - the Guild's own ships and posts. Cosmetic for now
(render only, no simulation), flown in Guarded sectors and along Guild Lanes.

Guild language = the human hull language (light chamfered plates over a dark
core, README §4) with the Guild's own marks:
  * a deep NAVY band (`guild_navy`) where the player's parts carry a skirt belt,
  * ORANGE Guild chevrons (`accent_iron` = the Guild emblem trim #f27a2c) pointing
    forward on the bow / wings,
  * the drill-bit emblem (Guild: a white drill bit with dark grooves on an
    orange-rimmed navy octagon),
  * blue-white patrol strobes (`strobe_blue`) - only the Guild Watch has them.
Silhouette rule: a WEDGE / arrowhead - never the trader's long rack, never a
part-grid ship.

npc/guild_cutter.glb   C1 patrol cutter   ~7.2 x 4.2 x 2.0, bow +X, origin = hull centre on the plane
npc/guild_frigate.glb  C2 patrol leader   ~13.6 x 6.4 x 3.2, COLOR_0
stations/guild_picket.glb  C3 checkpoint post, R = 5, COLOR_0, dock_port at (R, 0, 0)

Node contract (same as npc/trader.glb so src/render/traffic can fly them):
  thruster_<i>   EMPTY at the nozzle exit, local +X = exhaust direction (backward)
  beacon_<i>     lamp MESH (origin = lamp centre): 0 port red (+Y), 1 starboard green (-Y),
                 2.. white / amber running lamps - blink in code (beaconLevel)
  strobe_<i>     lamp MESH, `strobe_blue`: patrol strobes, alternate 0/1 (fast double flash)
  Gun_<i> / Turret_0  yaw pivots (rest aim +X); muzzle_<i> EMPTY children at the barrel tips
Positions in the manifest (npc/npc_ships.json) are in glTF axes.
"""
import math
import random

from mathutils import Matrix, Vector

from lib import geo as G
from lib import greebles as GR
import station_kit as K

NAVY = 'guild_navy'
ORANGE = 'accent_iron'
ORANGE_D = 'accent_iron_dark'
STROBE = 'strobe_blue'

# greeble style for the Guild (dtl kit, README §2.10): navy as an extra host / shade
GUILD_STYLE = dict(GR.STYLES['home'])
GUILD_STYLE.update(
    hosts=tuple(GR.STYLES['home']['hosts']) + (NAVY,),
    shade=dict(GR.STYLES['home']['shade'], **{NAVY: (NAVY, 'hull_dark', NAVY)}),
    weights={'window': 0.5, 'rack': 0.3, 'skylight': 0.4, 'lights': 1.2, 'antenna': 1.2, 'unit': 1.3},
)


# ----------------------------------------------------------------------------
# small kit (shared with borders.py / npc_ships.py)
# ----------------------------------------------------------------------------
def mirror_y(pts):
    """Mirror a CCW outline across y = 0 (result is CCW again)."""
    return [(x, -y) for x, y in reversed(pts)]


def plate(name, pts, z0, z1, mat, bevel=0.02, top_mat=None):
    return G.prism(name, pts, z0, z1, mat, bevel=bevel, seg=1, top_mat=top_mat)


def chevron(name, x, z, w, d, t, mat, y=0.0, h=0.03, back=True):
    """Forward-pointing V (tip at +X): arm width t, total half span w, depth d.
    Returns two prisms (port / starboard arm)."""
    out = []
    for s in (1, -1):
        pts = [(x, y), (x - d, y + s * w), (x - d - t, y + s * w), (x - t, y)]
        if s < 0:
            pts = list(reversed(pts))
        out.append(G.prism(f'{name}{s}', pts, z, z + h, mat))
    return out


def drill_emblem(name, x, y, z, s=1.0, rot=0.0, h=0.03):
    """The Guild emblem flat on a deck (top-down): orange-rimmed navy octagon,
    white drill bit pointing +X with three dark grooves. s = half size."""
    out = []
    c = 0.29 * s

    def oct_pts(r):
        cc = r * 0.29 / 0.5 * 1.0
        return G.chamfer_rect(-r, r, -r, r, cc)
    out.append(G.prism(name + 'Rim', oct_pts(0.5 * s), z, z + h, ORANGE))
    out.append(G.prism(name + 'Bg', oct_pts(0.42 * s), z + h, z + h * 1.6, NAVY))
    # drill bit: wide end at -X (with a collar), point at +X
    bit = [(0.36 * s, 0.0), (-0.2 * s, 0.2 * s), (-0.2 * s, -0.2 * s)]
    bit = [bit[0], bit[1], bit[2]]
    out.append(G.prism(name + 'Bit', list(reversed(bit)) if False else [bit[0], bit[1], bit[2]], z + h * 1.6,
                       z + h * 2.4, 'hull_white'))
    out.append(G.box(name + 'Collar', -0.32 * s, -0.24 * s, -0.22 * s, 0.22 * s, z + h * 1.6, z + h * 2.4, ORANGE))
    for k, f in enumerate((0.0, 0.33, 0.62)):
        # grooves: thin dark slanted bars across the bit
        xa = -0.14 * s + f * 0.42 * s
        ww = 0.17 * s * (1 - f * 0.9)
        g = G.box(f'{name}G{k}', -0.018 * s, 0.018 * s, -ww, ww, z + h * 2.4, z + h * 2.75, NAVY)
        G.transform(g, loc=(xa, 0, 0), rot=(0, 0, 18))
        out.append(g)
    del c
    for o in out:
        o.matrix_basis = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(math.radians(rot), 4, 'Z') @ o.matrix_basis
    return out


def lamp(name, loc, key, r=0.14, atlas_dir=None, parent=None, col=False):
    """Lamp MESH node (origin = lamp centre) - the node the game blinks."""
    b = G.ellipsoid(name, r, r, r * 0.85, key, seg=10, rings=6)
    G.finalize(b, atlas_dir)
    if col:
        GR.ensure_col(b)
    b.location = loc
    if parent is not None:
        b.parent = parent
    return b


def strobe_lens(name, loc, atlas_dir, parent, length=0.32, r=0.09, col=False):
    """Elongated light-bar lens (along Y) for the patrol strobes."""
    b = G.cyl(name, r, length, STROBE, axis='Y', verts=10)
    G.finalize(b, atlas_dir)
    if col:
        GR.ensure_col(b)
    b.location = loc
    b.parent = parent
    return b


def empty(name, loc, parent, yaw_deg=0.0, pitch_deg=0.0, size=0.3):
    e = G.empty(name, loc=loc, size=size)
    e.rotation_euler = (0, math.radians(pitch_deg), math.radians(yaw_deg))
    e.parent = parent
    return e


def bell(name, x, y, z, r=0.4, L=0.5, axis_dir=-1):
    """Engine bell opening toward -X (axis_dir=-1) at x."""
    prof = [(0.0, r * 0.66), (-L, r), (-L - 0.06, r * 1.06), (-L - 0.02, r * 1.12), (0.0, r * 0.92)]
    return G.lathe(name, prof, [1, 2, 2, 0, 0], ['metal_bare', 'nozzle_in', 'hull_dark'], loc=(x, y, z), axis='X',
                   verts=18)


def engine_pod(name, x0, x1, y, z, r, glow=True, mat='hull_light', band=NAVY):
    """Cylindrical engine nacelle along X from x0 (rear) to x1 with a bell at x0."""
    out = [G.cyl(name, r, x1 - x0, mat, loc=((x0 + x1) / 2, y, z), axis='X', verts=14, bevel=0.03, seg=1)]
    out.append(G.ring_band(name + 'Band', r + 0.035, r - 0.02, -0.07, 0.07, band,
                           loc=(x0 + (x1 - x0) * 0.62, y, z), axis='X', verts=14, smooth=False))
    out.append(G.cyl(name + 'Intake', r * 0.82, 0.12, 'hull_dark', loc=(x1 + 0.04, y, z), axis='X', verts=14))
    out.append(bell(name + 'Bell', x0 + 0.02, y, z, r=r * 0.92, L=0.42))
    if glow:
        out.append(G.ring_band(name + 'Glow', r * 0.98, r * 0.86, -0.025, 0.025, 'engine_glow',
                               loc=(x0 - 0.36, y, z), axis='X', verts=16))
        out.append(G.cyl(name + 'Core', r * 0.58, 0.03, 'engine_core', loc=(x0 - 0.02, y, z), axis='X', verts=14))
    return out


def gun_pod(name, length=0.95, r=0.075, housing=0.2, twin=False, atlas_dir=None):
    """Yaw node geometry built around the pivot (0,0,0): housing + barrel(s) to +X.
    Returns (object, [muzzle local positions])."""
    p = [G.cyl(name + 'Hs', housing, housing * 1.1, 'hull_mid', verts=10, bevel=0.02, seg=1),
         G.ring_band(name + 'Ring', housing + 0.02, housing - 0.03, -0.04, 0.0, NAVY, verts=10, smooth=False),
         G.box(name + 'Mantlet', 0.0, housing * 1.25, -housing * 0.75, housing * 0.75, -housing * 0.45,
               housing * 0.5, 'hull_light', bevel=0.02, seg=1)]
    ys = (-0.09, 0.09) if twin else (0.0,)
    muzzles = []
    for k, yy in enumerate(ys):
        p.append(G.cyl(f'{name}Bar{k}', r, length, 'metal_bare', loc=(housing + length / 2, yy, 0.02), axis='X',
                       verts=8))
        p.append(G.cyl(f'{name}Tip{k}', r * 1.35, 0.1, 'hull_dark', loc=(housing + length - 0.03, yy, 0.02),
                       axis='X', verts=8))
        p.append(G.ring_band(f'{name}TipG{k}', r * 1.0, r * 0.6, -0.01, 0.01, 'cannon_glow',
                             loc=(housing + length + 0.025, yy, 0.02), axis='X', verts=8))
        muzzles.append((housing + length + 0.05, yy, 0.02))
    ob = G.join(p, name)
    G.finalize(ob, atlas_dir)
    return ob, muzzles


def light_weather(ob, seed, extra=(), grime=0.12):
    """Clean Guild hulls: AO + a little panel fade, almost no grime (COLOR_0)."""
    GR.weather(ob, random.Random(seed), extra=extra, ao=0.55, near=0.35, far=1.6, grime=grime, panel=0.05,
               under=0.18, soot=0.2)


# ----------------------------------------------------------------------------
# C1 Guild Watch cutter
# ----------------------------------------------------------------------------
CUTTER_FUSE = [(3.65, 0.0), (2.15, 0.6), (-1.9, 0.86), (-3.05, 0.78), (-3.05, -0.78), (-1.9, -0.86), (2.15, -0.6)]
CUTTER_WING = [(1.05, 0.72), (-1.55, 2.08), (-2.6, 2.08), (-2.25, 0.76)]   # port, CCW


def _scaled(pts, k, cx=0.0, cy=0.0):
    return [(cx + (x - cx) * k, cy + (y - cy) * k) for x, y in pts]


def _inset(pts, d):
    """Crude inset of a convex CCW outline by distance d (offset each edge, intersect)."""
    n = len(pts)
    lines = []
    for i in range(n):
        a, b = Vector(pts[i]), Vector(pts[(i + 1) % n])
        t = (b - a).normalized()
        nrm = Vector((-t.y, t.x))      # inward normal for CCW
        lines.append((a + nrm * d, t))
    out = []
    for i in range(n):
        p1, t1 = lines[i - 1]
        p2, t2 = lines[i]
        den = t1.x * t2.y - t1.y * t2.x
        if abs(den) < 1e-9:
            out.append(tuple(p2))
            continue
        s = ((p2.x - p1.x) * t2.y - (p2.y - p1.y) * t2.x) / den
        q = p1 + t1 * s
        out.append((q.x, q.y))
    return out


def build_cutter(atlas_dir):
    st = []
    # ---- fuselage: dark keel, navy band, white deck -------------------------------
    st.append(plate('Keel', _inset(CUTTER_FUSE, 0.12), -0.5, -0.12, 'hull_dark', bevel=0.04))
    st.append(plate('Band', CUTTER_FUSE, -0.16, 0.04, NAVY, bevel=0.025))
    st.append(plate('Deck', _inset(CUTTER_FUSE, 0.03), 0.04, 0.2, 'hull_white', bevel=0.03))
    # ---- wings: thinner, lower; navy leading edge, white plate ------------------
    for s in (1, -1):
        w = CUTTER_WING if s > 0 else mirror_y(CUTTER_WING)
        st.append(plate(f'WingCore{s}', _inset(w, 0.06), -0.24, -0.06, 'hull_dark', bevel=0.03))
        st.append(plate(f'Wing{s}', w, -0.08, 0.04, 'hull_light', bevel=0.02))
        # navy leading-edge strip
        le = [(1.02, s * 0.74), (-1.5, s * 2.06), (-1.86, s * 2.06), (0.62, s * 0.74)]
        if s < 0:
            le = list(reversed(le))
        st.append(plate(f'WingLE{s}', le, 0.04, 0.075, NAVY, bevel=0.0))
        # two orange chevron stripes across the wing (parallel to the trailing edge)
        for k, xo in enumerate((-1.25, -1.75)):
            pts = [(xo + 0.55, s * 0.95), (xo - 0.2, s * 1.95), (xo - 0.34, s * 1.95), (xo + 0.41, s * 0.95)]
            if s < 0:
                pts = list(reversed(pts))
            st.append(plate(f'WingChev{s}{k}', pts, 0.04, 0.07, ORANGE, bevel=0.0))
        # wingtip pod (nav lamp sits on it)
        st.append(G.box(f'TipPod{s}', -2.45, -1.6, s * 2.02 - 0.09, s * 2.02 + 0.09, -0.2, 0.06, NAVY,
                        bevel=0.03, seg=1))
        # ventral fin under each wing root
        fin = [(-1.2, 0.0), (-2.5, 0.0), (-2.7, -0.0)]
        del fin
    # ---- spine + cockpit -------------------------------------------------------
    spine = [(1.7, 0.0), (1.0, 0.42), (-2.3, 0.5), (-2.75, 0.4), (-2.75, -0.4), (-2.3, -0.5), (1.0, -0.42)]
    st.append(plate('Spine', spine, 0.18, 0.44, 'hull_light', bevel=0.04))
    st.append(plate('SpineTop', _inset(spine, 0.07), 0.44, 0.5, NAVY, bevel=0.015))
    canopy = [(2.05, 0.0), (1.45, 0.3), (0.7, 0.36), (0.7, -0.36), (1.45, -0.3)]
    st.append(plate('Canopy', canopy, 0.45, 0.66, 'glass_cockpit', bevel=0.04))
    st.append(plate('CanopyFrame', [(0.78, 0.4), (0.62, 0.4), (0.62, -0.4), (0.78, -0.4)][::-1], 0.45, 0.7,
                    'glass_frame', bevel=0.01))
    # nose chevrons (bold orange V's - the patrol read from above)
    st += chevron('NoseChev0', 3.2, 0.2, 0.42, 0.62, 0.16, ORANGE)
    st += chevron('NoseChev1', 2.75, 0.2, 0.5, 0.74, 0.12, ORANGE)
    # drill-bit emblem on the spine behind the canopy
    st += drill_emblem('Emblem', -0.35, 0.0, 0.5, s=0.66)
    # ---- dorsal fin + strobe bar -------------------------------------------------
    fin = [(-1.55, 0.0), (-2.05, 0.0), (-2.75, 0.0)]
    del fin
    fpts = [(-1.5, 0.5), (-2.75, 0.5), (-2.75, 1.32), (-2.35, 1.32)]   # in XZ
    finob = G.prism('Fin', [(x, z) for x, z in fpts], -0.05, 0.05, NAVY, bevel=0.012, seg=1)
    finob.rotation_euler = (math.radians(90), 0, 0)
    st.append(finob)
    st.append(G.box('FinStripe', -2.62, -2.06, -0.06, 0.06, 1.0, 1.1, ORANGE))
    st.append(G.box('StrobeBar', -2.68, -2.38, -0.36, 0.36, 1.3, 1.38, 'hull_dark', bevel=0.015, seg=1))
    # ---- drive: two engine pods ------------------------------------------------
    for s in (1, -1):
        st += engine_pod(f'Eng{s}', -3.25, -1.85, s * 0.58, -0.08, 0.34)
    st.append(G.box('DriveBlock', -3.0, -1.9, -0.62, 0.62, -0.42, 0.18, 'hull_dark', bevel=0.04, seg=1))
    # radiator slats on the drive top
    for k in range(4):
        x = -2.95 + k * 0.22
        st.append(G.box(f'Rad{k}', x, x + 0.1, -0.32, 0.32, 0.5, 0.58, 'hull_mid', bevel=0.01, seg=1))
    # ---- gun pod mounts on the wing roots ----------------------------------------
    for s in (1, -1):
        st.append(G.cyl(f'GunMount{s}', 0.24, 0.16, 'hull_dark', loc=(0.35, s * 1.12, 0.06), verts=10,
                        bevel=0.02, seg=1))
    # small sensor / antenna under the nose + running lamp mounts
    st.append(G.box('NoseSensor', 2.6, 3.25, -0.12, 0.12, -0.36, -0.14, 'hull_mid', bevel=0.02, seg=1))
    for s in (1, -1):    # side window strip on the spine
        st.append(G.box(f'Win{s}', -1.6, 0.4, s * 0.5 - 0.02, s * 0.5 + 0.02, 0.32, 0.4, 'window_warm'))
    root = G.join(st, 'Guild_Cutter')
    light_weather(root, 31)
    G.finalize(root, atlas_dir)
    # ---- gun pods (yaw nodes) + muzzles ------------------------------------------
    for i, s in enumerate((1, -1)):
        gun, muzzles = gun_pod(f'Gun_{i}', length=0.95, atlas_dir=atlas_dir)
        GR.ensure_col(gun)
        gun.location = (0.35, s * 1.12, 0.26)
        gun.parent = root
        empty(f'muzzle_{i}', muzzles[0], gun)
    # ---- lamps --------------------------------------------------------------------
    for i, (loc, key) in enumerate((((-2.1, 2.14, 0.12), 'light_red'), ((-2.1, -2.14, 0.12), 'light_green'),
                                    ((-3.08, 0.0, 0.3), 'light_white'), ((3.45, 0.0, 0.26), 'light_white'))):
        lamp(f'beacon_{i}', loc, key, r=0.12, atlas_dir=atlas_dir, parent=root, col=True)
    for i, s in enumerate((1, -1)):
        strobe_lens(f'strobe_{i}', (-2.53, s * 0.2, 1.47), atlas_dir, root, length=0.3, r=0.085, col=True)
    for i, s in enumerate((1, -1)):
        empty(f'thruster_{i}', (-3.72, s * 0.58, -0.08), root, yaw_deg=180)
    return root


# ----------------------------------------------------------------------------
# C2 Guild Watch frigate (patrol leader)
# ----------------------------------------------------------------------------
FRIG_FUSE = [(6.85, 0.0), (4.7, 1.12), (-0.8, 1.72), (-5.5, 1.72), (-6.35, 1.42), (-6.35, -1.42), (-5.5, -1.72),
             (-0.8, -1.72), (4.7, -1.12)]
FRIG_WING = [(0.6, 1.55), (-3.55, 3.2), (-5.05, 3.2), (-4.75, 1.6)]


def build_frigate(atlas_dir):
    import structures as S
    st = []
    st.append(plate('Keel', _inset(FRIG_FUSE, 0.2), -1.05, -0.3, 'hull_dark', bevel=0.06))
    st.append(plate('Band', FRIG_FUSE, -0.36, 0.06, NAVY, bevel=0.04))
    st.append(plate('Deck', _inset(FRIG_FUSE, 0.05), 0.06, 0.32, 'hull_white', bevel=0.04))
    for s in (1, -1):
        w = FRIG_WING if s > 0 else mirror_y(FRIG_WING)
        st.append(plate(f'WingCore{s}', _inset(w, 0.08), -0.42, -0.14, 'hull_dark', bevel=0.04))
        st.append(plate(f'Wing{s}', w, -0.16, 0.04, 'hull_light', bevel=0.03))
        le = [(0.58, s * 1.57), (-3.5, s * 3.18), (-3.95, s * 3.18), (0.25, s * 1.57)]
        if s < 0:
            le = list(reversed(le))
        st.append(plate(f'WingLE{s}', le, 0.04, 0.08, NAVY, bevel=0.0))
        for k, xo in enumerate((-2.6, -3.3)):
            pts = [(xo + 0.75, s * 1.85), (xo - 0.3, s * 3.0), (xo - 0.5, s * 3.0), (xo + 0.55, s * 1.85)]
            if s < 0:
                pts = list(reversed(pts))
            st.append(plate(f'WingChev{s}{k}', pts, 0.04, 0.075, ORANGE, bevel=0.0))
        st.append(G.box(f'TipPod{s}', -4.8, -3.5, s * 3.14 - 0.13, s * 3.14 + 0.13, -0.3, 0.1, NAVY, bevel=0.04,
                        seg=1))
        # side hangar slit (port) / service hatch row (starboard)
        if s > 0:
            st.append(G.box('HangarFrame', -3.4, -0.6, 1.66, 1.78, -0.32, 0.02, 'hull_mid', bevel=0.02, seg=1))
            st.append(G.box('HangarSlit', -3.25, -0.75, 1.7, 1.8, -0.24, -0.06, 'trim_black'))
            st += K.light_row('HangarLamps', (-3.2, 1.81, -0.3), (-0.8, 1.81, -0.3), 6, 'light_amber', s=0.04, h=0.04)
        else:
            for k in range(3):
                x = -2.8 + k * 0.9
                st.append(G.box(f'Hatch{k}', x, x + 0.55, -1.8, -1.68, -0.26, -0.04, 'hull_mid', bevel=0.015, seg=1))
    # ---- superstructure: spine block, bridge tower ---------------------------------
    st += S.deck_block('Spine', -4.9, 2.2, -1.05, 1.05, 0.3, 0.92, accent=NAVY, plate='hull_light')
    st.append(plate('SpineTop', G.chamfer_rect(-4.6, 1.9, -0.55, 0.55, 0.2), 0.92, 0.98, NAVY, bevel=0.0))
    st += drill_emblem('Emblem', -2.9, 0.0, 0.98, s=0.95)
    bridge = [(3.55, 0.0), (3.15, 0.75), (1.7, 0.85), (1.7, -0.85), (3.15, -0.75)]
    st.append(plate('Bridge', bridge, 0.3, 1.45, 'hull_light', bevel=0.05))
    st.append(plate('BridgeBand', _scaled(bridge, 1.03, 2.6, 0), 0.82, 0.98, NAVY, bevel=0.0))
    st.append(plate('BridgeCanopy', [(3.5, 0.0), (3.1, 0.62), (2.7, 0.66), (2.7, -0.66), (3.1, -0.62)], 1.0, 1.3,
                    'glass_cockpit', bevel=0.03))
    st.append(plate('BridgeRoof', [(2.85, -0.6), (2.85, 0.6), (1.85, 0.7), (1.85, -0.7)], 1.45, 1.6,
                    'hull_mid', bevel=0.03))
    st.append(G.box('LightBar', 2.1, 2.45, -0.62, 0.62, 1.6, 1.68, 'hull_dark', bevel=0.015, seg=1))
    for s in (1, -1):
        st.append(G.box(f'BridgeWin{s}', 1.85, 3.1, s * 0.84 - 0.02, s * 0.84 + 0.02, 0.5, 0.66, 'window_warm'))
    for k, (x, w, d) in enumerate(((6.1, 0.55, 0.8), (5.5, 0.75, 1.05), (4.85, 0.92, 1.3))):
        st += chevron(f'BowChev{k}', x, 0.32, w, d, 0.2, ORANGE)
    st += S.mast('Mast', (-1.4, -0.55, 0.98), 1.25, r=0.06, dish=0.42)
    st.append(G.cyl('TurretRing', 0.62, 0.14, 'hull_dark', loc=(0.6, 0.0, 1.0), verts=16, bevel=0.02, seg=1))
    st.append(G.ring_band('TurretRingBand', 0.66, 0.56, 0.98, 1.06, ORANGE, verts=16, smooth=False,
                          loc=(0.6, 0, 0)))
    # ---- drive block + three bells -------------------------------------------------
    st += S.deck_block('Drive', -6.5, -4.7, -1.8, 1.8, -1.0, 0.55, accent=NAVY)
    for k, y in enumerate((-1.05, 0.0, 1.05)):
        r = 0.62 if k == 1 else 0.5
        st.append(bell(f'Bell{k}', -6.5, y, -0.25, r=r, L=0.5))
        st.append(G.ring_band(f'BellGlow{k}', r * 1.0, r * 0.88, -0.03, 0.03, 'engine_glow',
                              loc=(-6.92, y, -0.25), axis='X', verts=18))
        st.append(G.cyl(f'BellCore{k}', r * 0.6, 0.03, 'engine_core', loc=(-6.52, y, -0.25), axis='X', verts=14))
    for k in range(4):
        x = -6.3 + k * 0.42
        st.append(G.box(f'RadFin{k}', x - 0.06, x + 0.06, -1.45, 1.45, 0.55, 1.05, 'hull_mid', bevel=0.02, seg=1))
    st.append(G.box('RadCap', -6.45, -4.95, -0.12, 0.12, 1.02, 1.1, ORANGE))
    root = G.join(st, 'Guild_Frigate')
    zones = GR.Zones().cyl(0.6, 0.0, 0.9, 0.9, 9).cyl(-1.4, -0.55, 0.6, 0.9, 9).box(2.0, 2.6, -0.7, 0.7, 1.5, 9)
    zones.box(-3.7, -2.1, -0.8, 0.8, 0.9, 9).box(4.2, 7.0, -1.2, 1.2, 0.25, 9)   # emblem, bow chevrons
    root, st_ = K.dress(root, random.Random(41), GUILD_STYLE, zones, panels=True, panel_cell=0.95,
                        scatter=[dict(density=0.55, side=0.7)], panel_min_area=1.0)
    root.name = 'Guild_Frigate'
    light_weather(root, 42)
    G.finalize(root, atlas_dir)
    tur, muzzles = gun_pod('Turret_0', length=1.5, r=0.09, housing=0.45, twin=True, atlas_dir=atlas_dir)
    GR.ensure_col(tur)
    tur.location = (0.6, 0.0, 1.32)
    tur.parent = root
    for i, m in enumerate(muzzles):
        empty(f'muzzle_{i}', m, tur)
    for i, (loc, key) in enumerate((((-4.15, 3.32, 0.2), 'light_red'), ((-4.15, -3.32, 0.2), 'light_green'),
                                    ((-1.4, -0.55, 2.32), 'light_white'), ((6.62, 0.0, 0.36), 'light_white'),
                                    ((-6.0, 0.0, 1.25), 'light_amber'))):
        lamp(f'beacon_{i}', loc, key, r=0.15, atlas_dir=atlas_dir, parent=root, col=True)
    for i, s in enumerate((1, -1)):
        strobe_lens(f'strobe_{i}', (2.28, s * 0.36, 1.77), atlas_dir, root, length=0.42, r=0.1, col=True)
    for i, y in enumerate((-1.05, 0.0, 1.05)):
        empty(f'thruster_{i}', (-7.0, y, -0.25), root, yaw_deg=180)
    print('BC dtl guild_frigate', st_)
    return root


# ----------------------------------------------------------------------------
# C3 Guild picket (checkpoint post)
# ----------------------------------------------------------------------------
PICKET_R = 5.0
PICKET_MAST = (-1.55, 1.25)
PICKET_CIRCLES = [dict(x=0.0, y=0.0, r=3.45), dict(x=3.55, y=0.0, r=0.75)]


def _octagon(r):
    c = r * 0.4142
    return [(r, -c), (r, c), (c, r), (-c, r), (-r, c), (-r, -c), (-c, -r), (c, -r)]


def build_picket(atlas_dir):
    import structures as S
    st = []
    prof = [(-1.6, 0.0), (-1.6, 0.7), (-0.75, 2.6), (-0.42, 3.05), (-0.42, 0.0)]
    st.append(G.lathe('Under', prof, [0, 0, 0, 0], ['hull_dark'], axis='Z', verts=8, closed=False, smooth=False))
    st.append(G.cyl('UnderSpike', 0.22, 1.2, 'hull_mid', loc=(0, 0, -2.1), verts=8))
    st.append(plate('Band', _octagon(3.2), -0.45, -0.1, NAVY, bevel=0.04))
    st.append(plate('Deck', _octagon(3.1), -0.12, 0.08, 'hull_light', bevel=0.04))
    oct_r = _octagon(3.22)
    for i in range(8):
        a, b = Vector(oct_r[i]), Vector(oct_r[(i + 1) % 8])
        for k in range(4):
            p0 = a.lerp(b, k / 4 + 0.03)
            p1 = a.lerp(b, (k + 1) / 4 - 0.03)
            d = (p1 - p0)
            n = Vector((d.y, -d.x)).normalized() * 0.14
            pts = [(p0.x, p0.y), (p1.x, p1.y), (p1.x - n.x, p1.y - n.y), (p0.x - n.x, p0.y - n.y)]
            st.append(G.prism(f'Rim{i}{k}', pts, 0.06, 0.12, ORANGE if k % 2 == 0 else 'trim_black'))
    st += S.hub('Hub', 1.25, 0.08, 1.4, accent=NAVY, verts=12)
    st.append(G.cyl('HubRoof', 0.85, 0.16, 'hull_mid', loc=(0, 0, 1.48), verts=12, bevel=0.03, seg=1))
    st += S.deck_block('Stub', 2.6, 4.15, -0.6, 0.6, -0.42, 0.04, accent=NAVY)
    st.append(G.ring_band('StubCollar', 0.62, 0.42, -0.08, 0.08, ORANGE, loc=(4.15, 0, -0.2), axis='X', verts=12))
    st += K.light_row('StubLamps', (2.8, 0.52, 0.04), (4.0, 0.52, 0.04), 3, 'engine_glow', s=0.05, h=0.04)
    st += K.light_row('StubLampsR', (2.8, -0.52, 0.04), (4.0, -0.52, 0.04), 3, 'engine_glow', s=0.05, h=0.04)
    st.append(G.cyl('TurretPed', 0.55, 0.5, 'hull_dark', loc=(1.05, -1.75, 0.33), verts=12, bevel=0.03, seg=1))
    st.append(G.ring_band('TurretPedBand', 0.6, 0.5, 0.5, 0.58, ORANGE, verts=12, loc=(1.05, -1.75, 0), smooth=False))
    st.append(G.cyl('DishPed', 0.32, 0.9, 'hull_mid', loc=(0.9, 1.75, 0.5), verts=10, bevel=0.02, seg=1))
    mx, my = PICKET_MAST
    for k in range(3):
        a = math.radians(90 + k * 120)
        st.append(G.cyl(f'MastLeg{k}', 0.05, 4.2, 'metal_bare', loc=(mx + 0.22 * math.cos(a), my + 0.22 * math.sin(a),
                                                                     2.15), verts=6))
    for k in range(5):
        st.append(G.ring_band(f'MastRing{k}', 0.3, 0.22, 0.4 + k * 0.85, 0.46 + k * 0.85, NAVY if k % 2 else ORANGE,
                              loc=(mx, my, 0), verts=6, smooth=False))
    st.append(G.cyl('MastFoot', 0.45, 0.2, 'hull_dark', loc=(mx, my, 0.18), verts=8))
    st.append(G.box('MastBar', mx - 0.12, mx + 0.12, my - 0.45, my + 0.45, 4.2, 4.3, 'hull_dark', bevel=0.015, seg=1))
    # Guild sign board (emblem) facing -Y (toward the default camera), tilted back 35 deg
    sign = [G.box('SignBoard', -0.05, 0.05, -0.85, 0.85, -0.55, 0.55, NAVY, bevel=0.02, seg=1),
            G.box('SignRim', -0.06, 0.03, -0.92, 0.92, -0.62, 0.62, ORANGE, bevel=0.015, seg=1)]
    em = drill_emblem('SignEm', 0.0, 0.0, 0.05, s=0.95)
    for o in em:
        o.matrix_basis = Matrix.Rotation(math.radians(90), 4, 'Y') @ o.matrix_basis
    sign += em
    for o in sign:
        o.matrix_basis = (Matrix.Translation((-1.0, -2.2, 1.0)) @ Matrix.Rotation(math.radians(-90), 4, 'Z')
                          @ Matrix.Rotation(math.radians(-35), 4, 'Y') @ o.matrix_basis)
    st += sign
    for s in (1, -1):
        st.append(G.box(f'SignPost{s}', -1.0 + s * 0.6 - 0.05, -1.0 + s * 0.6 + 0.05, -2.1, -2.0, 0.05, 0.75,
                        'hull_dark'))
    st += S.solar_wing('Solar', -4.7, -3.15, -0.9, 0.9, -0.2, cols=3, rows=3)
    st.append(G.box('SolarSpar', -3.3, -2.9, -0.15, 0.15, -0.3, -0.1, 'hull_mid'))
    st += S.vtank('Tank', (-2.2, -1.2, 0.08), 0.42, 1.2)
    root = G.join(st, 'Guild_Picket')
    zones = GR.Zones().cyl(1.05, -1.75, 0.95, 0.0, 9).cyl(0.9, 1.75, 1.05, 0.0, 9).cyl(mx, my, 0.65, 0.0, 9)
    zones.box(-1.9, -0.1, -2.5, -1.5, 0.0, 9).functional(2.5, 4.3, -0.65, 0.65, 0.04).cyl(-2.2, -1.2, 0.55, 0, 9)
    root, st_ = K.dress(root, random.Random(51), GUILD_STYLE, zones, panels=True, panel_cell=0.9,
                        scatter=[dict(density=0.4)], panel_min_area=1.8)
    root.name = 'Guild_Picket'
    light_weather(root, 52, grime=0.2)
    G.finalize(root, atlas_dir)
    tur, muzzles = gun_pod('Turret_0', length=1.1, r=0.08, housing=0.38, twin=True, atlas_dir=atlas_dir)
    GR.ensure_col(tur)
    tur.location = (1.05, -1.75, 0.82)
    tur.rotation_euler = (0, 0, math.radians(-40))
    tur.parent = root
    for i, m in enumerate(muzzles):
        empty(f'muzzle_{i}', m, tur)
    dish = G.lathe('Picket_Dish', [(0.0, 0.0), (0.05, 0.35), (0.2, 0.78), (0.16, 0.82), (0.0, 0.4), (-0.1, 0.0)],
                   [0, 0, 1, 2, 2], ['hull_white', ORANGE, 'hull_mid'], axis='Z', verts=16, closed=False,
                   rot=(0, 50, 0))
    feed = G.cyl('DishFeed', 0.03, 0.6, 'metal_bare', loc=(0.22, 0, 0.42), verts=6)
    hub = G.cyl('DishHub', 0.16, 0.22, 'hull_dark', loc=(0, 0, -0.08), verts=10)
    dish = G.join([dish, feed, hub], 'Picket_Dish')
    G.finalize(dish, atlas_dir)
    GR.ensure_col(dish)
    dish.location = (0.9, 1.75, 1.05)
    dish.parent = root
    for i, (loc, key) in enumerate((((mx, my, 4.55), 'light_red'), ((2.2, 2.2, 0.3), 'light_amber'),
                                    ((-2.2, -2.2, 0.3), 'light_amber'), ((4.0, 0.0, 0.42), 'light_white'))):
        lamp(f'beacon_{i}', loc, key, r=0.17, atlas_dir=atlas_dir, parent=root, col=True)
    strobe_lens('strobe_0', (mx, my + 0.3, 4.4), atlas_dir, root, length=0.28, r=0.09, col=True)
    strobe_lens('strobe_1', (mx, my - 0.3, 4.4), atlas_dir, root, length=0.28, r=0.09, col=True)
    dp = G.empty('dock_port', loc=(PICKET_R, 0, 0), size=0.6)
    dp.parent = root
    print('BC dtl guild_picket', st_)
    return root


BUILDERS = {'guild_cutter': build_cutter, 'guild_frigate': build_frigate, 'guild_picket': build_picket}
