"""Cinderbelt - single source of truth for colours and surface properties.

Every asset uses ONE shared material ("AF_Palette") whose textures are a
small swatch atlas generated from this table.  While modelling we assign
*logical* materials (one per swatch key); at bake time each face's UVs are
collapsed onto the centre of its swatch (or spread along a gradient swatch)
and the logical materials are replaced by the atlas material.

Atlas layout: COLS x ROWS cells of CELL px.  Swatch index i lives in
column i % COLS, row i // COLS (row 0 = bottom of the image, Blender UV v=0).
"""
from dataclasses import dataclass

CELL = 16
COLS = 8
ROWS = 32          # 256 swatch slots (atlas 128 x 512 px; grown from 16 rows in M5b)
SIZE_X = CELL * COLS
SIZE_Y = CELL * ROWS

# Material-level emissive strength (exported as KHR_materials_emissive_strength).
# Per-swatch strength is baked into the emissive texture brightness:
# texel = emit_colour * (emit_strength / EMIT_MAX).
EMIT_MAX = 6.0


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


@dataclass
class Swatch:
    key: str
    base: str                 # sRGB hex
    metal: float = 0.0
    rough: float = 0.5
    emit: str = None          # sRGB hex of emission colour (None = no emission)
    emit_strength: float = 0.0
    grad: str = None          # optional: base colour at u=1 of the cell (gradient swatch)
    grad_emit: str = None     # optional: emission colour at u=1 of the cell


# Order matters only for atlas placement; keep appending to stay stable.
SWATCHES = [
    # ---- neutral hull --------------------------------------------------
    Swatch('hull_light', '#E6E9EE', 0.15, 0.42),
    Swatch('hull_mid',   '#AEB6C2', 0.35, 0.45),
    Swatch('hull_dark',  '#4B5463', 0.45, 0.50),
    Swatch('trim_black', '#1C212A', 0.40, 0.55),
    Swatch('metal_bare', '#7E8794', 0.85, 0.32),
    Swatch('nozzle_in',  '#262B33', 0.70, 0.40),
    Swatch('hull_white', '#F7F8FA', 0.05, 0.38),
    Swatch('panel_line', '#2A303B', 0.30, 0.60),
    # ---- tier accents ---------------------------------------------------
    Swatch('accent_iron',      '#F27A1F', 0.10, 0.40),
    Swatch('accent_iron_dark', '#B2501A', 0.20, 0.45),
    Swatch('accent_titanium',      '#2FA6E8', 0.20, 0.38),
    Swatch('accent_titanium_dark', '#1C6FA6', 0.30, 0.42),
    Swatch('accent_crystal',      '#9466F2', 0.15, 0.34),     # renders ~ UI --af-crystal #b98cff
    Swatch('accent_crystal_dark', '#6A3FC0', 0.25, 0.38),
    Swatch('accent_exotic',      '#3CF0A0', 0.10, 0.35),
    Swatch('accent_exotic_dark', '#1E9E68', 0.20, 0.40),
    # ---- emissive details -----------------------------------------------
    Swatch('glass_cockpit', '#1584B0', 0.0, 0.18, emit='#2FD4FF', emit_strength=1.1),
    Swatch('glass_frame',   '#14181F', 0.5, 0.30),
    Swatch('engine_glow',   '#9FEFFF', 0.0, 0.30, emit='#38CFFF', emit_strength=4.5),
    Swatch('engine_core',   '#F2FDFF', 0.0, 0.30, emit='#D8F8FF', emit_strength=6.0),
    Swatch('gyro_glow',     '#C9A2FF', 0.0, 0.30, emit='#A363FF', emit_strength=2.6),
    Swatch('light_red',     '#FF4A4A', 0.0, 0.30, emit='#FF3030', emit_strength=4.0),
    Swatch('light_green',   '#4AFF8A', 0.0, 0.30, emit='#30FF70', emit_strength=4.0),
    Swatch('light_white',   '#FFFFFF', 0.0, 0.30, emit='#FFF4E0', emit_strength=4.0),
    Swatch('light_amber',   '#FFB347', 0.0, 0.30, emit='#FFA024', emit_strength=3.5),
    # ---- asteroids: iron -------------------------------------------------
    Swatch('rock_iron_1', '#3E322D', 0.05, 0.85),
    Swatch('rock_iron_2', '#54423A', 0.05, 0.82),
    Swatch('rock_iron_3', '#6A5244', 0.05, 0.80),
    Swatch('rust',        '#6A3322', 0.20, 0.75),
    Swatch('ore_iron',    '#C25A2C', 0.75, 0.32),
    Swatch('vein_iron',   '#FF7A3A', 0.00, 0.40, emit='#FF5418', emit_strength=3.5),
    # ---- asteroids: ice --------------------------------------------------
    Swatch('rock_ice_1', '#2E4468', 0.05, 0.70),
    Swatch('rock_ice_2', '#3F5E8C', 0.05, 0.62),
    Swatch('rock_ice_3', '#5A80B4', 0.05, 0.55),
    Swatch('ice_crust',  '#CDEBFF', 0.00, 0.22),
    Swatch('ice_crust_blue', '#7FB8EA', 0.00, 0.18),
    # gradient: deep blue root -> bright cyan-white tip, glowing from inside
    Swatch('ice_crystal', '#1A66D8', 0.00, 0.06, emit='#2A8CFF', emit_strength=2.6,
           grad='#DDFBFF', grad_emit='#9CF4FF'),
    Swatch('vein_ice',   '#BFF6FF', 0.00, 0.10, emit='#5CE1FF', emit_strength=2.5),
    # ---- M1 part details ---------------------------------------------------
    Swatch('laser_glow',   '#FF5B8A', 0.0, 0.20, emit='#FF3D78', emit_strength=2.4),
    Swatch('fuel_yellow',  '#FFD23C', 0.00, 0.34),
    Swatch('fuel_glow',    '#FFF0A0', 0.0, 0.30, emit='#E8D15A', emit_strength=2.5),
    Swatch('reactor_glow', '#5AE8C8', 0.0, 0.25, emit='#3EE6C0', emit_strength=2.0),
    Swatch('radar_glow',   '#C8FFD0', 0.0, 0.30, emit='#7DFF9A', emit_strength=3.0),
    # ---- asteroids: copper -----------------------------------------------
    Swatch('rock_copper_1', '#3E3029', 0.05, 0.85),
    Swatch('rock_copper_2', '#54402F', 0.05, 0.80),
    Swatch('rock_copper_3', '#6B5038', 0.10, 0.70),
    Swatch('verdigris',     '#3C8C78', 0.10, 0.60),
    Swatch('ore_copper',    '#E8A040', 0.85, 0.30),
    Swatch('vein_copper',   '#FFD08A', 0.00, 0.35, emit='#FFB84D', emit_strength=3.2),
    # ---- asteroids: titanium ---------------------------------------------
    Swatch('rock_ti_1', '#454C5C', 0.20, 0.65),
    Swatch('rock_ti_2', '#596274', 0.25, 0.60),
    Swatch('rock_ti_3', '#6E7890', 0.30, 0.55),
    Swatch('ti_polished', '#B8C4E2', 0.65, 0.56),
    Swatch('ore_titanium', '#D9E2FF', 0.80, 0.46),
    Swatch('vein_titanium', '#EEF2FF', 0.00, 0.30, emit='#C8D6FF', emit_strength=2.6),
    # ---- tier 2 (titanium) hull ------------------------------------------
    Swatch('hull_ti',       '#EDF2F9', 0.30, 0.30),
    Swatch('hull_dark_ti',  '#3B475B', 0.55, 0.40),
    Swatch('tier_glow_ti',  '#BFEAFF', 0.0, 0.25, emit='#45BFFF', emit_strength=2.4),
    # ---- stations / hangar -----------------------------------------------
    Swatch('floor_dark',  '#2C323C', 0.30, 0.82),
    Swatch('solar_cell',  '#1F3F86', 0.60, 0.22, emit='#1A3C9A', emit_strength=0.35),
    Swatch('window_warm', '#FFE6B0', 0.0, 0.30, emit='#FFC870', emit_strength=2.2),
    # ---- combat (M3) -------------------------------------------------------
    Swatch('char_black',  '#16130F', 0.10, 0.95),
    Swatch('scorch',      '#3B2B22', 0.20, 0.85),
    Swatch('ember',       '#FF7A2A', 0.00, 0.60, emit='#FF4A10', emit_strength=1.8),
    Swatch('cannon_glow', '#FFD08A', 0.00, 0.30, emit='#FF9A2A', emit_strength=3.2),
    Swatch('shield_glow', '#BFF2FF', 0.00, 0.10, emit='#3FD8FF', emit_strength=3.0),
    Swatch('shield_glass', '#2A7FB8', 0.00, 0.08, emit='#2AB8FF', emit_strength=1.4),
    # ---- asteroid style study (lighter albedo; AO comes from vertex colour) --
    Swatch('st_rock_iron',   '#86695A', 0.05, 0.78),
    Swatch('st_rock_copper', '#857262', 0.05, 0.75),
    Swatch('st_rock_ice',    '#8FAFD6', 0.00, 0.40),
    Swatch('st_rock_ti',     '#7C8498', 0.35, 0.55),
    Swatch('st_ore_iron',    '#C2552A', 0.60, 0.40, emit='#FF5A1E', emit_strength=0.9),
    Swatch('st_ore_copper',  '#E6A13E', 0.90, 0.30, emit='#FFB547', emit_strength=0.7),
    Swatch('st_ice_crystal', '#2F86EA', 0.00, 0.08, emit='#5AC8FF', emit_strength=1.6,
           grad='#EEFDFF', grad_emit='#BFF4FF'),
    Swatch('st_ore_ti',      '#E8EEFF', 0.85, 0.30, emit='#C4D4FF', emit_strength=0.7),
    Swatch('st_band_iron',   '#B5512A', 0.40, 0.45, emit='#FF5A1E', emit_strength=1.1),
    Swatch('st_band_copper', '#E8A848', 0.80, 0.35, emit='#FFB547', emit_strength=0.9),
    Swatch('st_band_ice',    '#C8F2FF', 0.00, 0.15, emit='#7FE4FF', emit_strength=1.2),
    Swatch('st_band_ti',     '#E4EAFA', 0.85, 0.30, emit='#C8D6FF', emit_strength=0.6),
    # ---- M2d: battery, tractor beam -----------------------------------------
    Swatch('battery_glow',  '#6FF5EE', 0.00, 0.25, emit='#14E4EE', emit_strength=3.2),
    Swatch('battery_dim',   '#1E4A50', 0.20, 0.30, emit='#0E5A60', emit_strength=0.5),
    Swatch('tractor_glow',  '#ABAEFF', 0.00, 0.22, emit='#6C66FF', emit_strength=3.4),
    Swatch('tractor_glass', '#4A3FA8', 0.00, 0.10, emit='#6E5CFF', emit_strength=1.4),
    # ---- M3.5/M3.6: pirate (Rust) structures - scrap-built, livery colours ---
    Swatch('pir_gunmetal',      '#5A606A', 0.55, 0.42),
    Swatch('pir_gunmetal_dark', '#262A31', 0.50, 0.55),
    Swatch('pir_plate_worn',    '#7A746A', 0.35, 0.60),
    Swatch('pir_rust',          '#9C2A1C', 0.30, 0.55),
    Swatch('pir_rust_dark',     '#5E170F', 0.35, 0.60),
    Swatch('pir_hazard',        '#A8801E', 0.25, 0.52),
    Swatch('pir_glow_red',      '#FF6A50', 0.00, 0.30, emit='#FF2A12', emit_strength=3.5),
    Swatch('pir_glass_red',     '#4A0E0A', 0.00, 0.15, emit='#FF2A12', emit_strength=1.4),
    # ---- Forge-smith (ancient star-smiths): forged obsidian + bronze, ember glyphs --
    Swatch('kov_obsidian', '#17151D', 0.55, 0.22),
    Swatch('kov_bronze',   '#B8904A', 0.90, 0.30),
    Swatch('kov_ember',    '#FF8A4A', 0.00, 0.30, emit='#FF4A12', emit_strength=4.0),
    Swatch('kov_crystal',  '#5A2CC8', 0.00, 0.08, emit='#7A3CFF', emit_strength=1.5,
           grad='#E8D8FF', grad_emit='#C8A8FF'),
    # ---- anomalies -------------------------------------------------------------
    Swatch('anom_void',      '#040509', 0.00, 0.55),
    Swatch('anom_accretion', '#E07030', 0.00, 0.30, emit='#FF6A1A', emit_strength=2.6,
           grad='#FFF4E0', grad_emit='#FFE8C0'),
    Swatch('anom_grav',      '#8A6CFF', 0.00, 0.25, emit='#6A3CFF', emit_strength=2.0),
    Swatch('anom_ion',       '#A8F0FF', 0.00, 0.20, emit='#3AB8FF', emit_strength=4.0),
    Swatch('anom_rad',       '#C8FF5A', 0.00, 0.25, emit='#7CFF2A', emit_strength=3.5),
    Swatch('anom_time',      '#FFE8B0', 0.00, 0.25, emit='#FFD27A', emit_strength=2.6),
    Swatch('anom_time_ghost', '#9FE8E0', 0.00, 0.20, emit='#5FD8D0', emit_strength=1.6),
    # ---- M4: derelict (weathered human) stations + relay -------------------------
    Swatch('der_plate',  '#8A857B', 0.15, 0.74),          # faded, dirty hull plate
    Swatch('der_dark',   '#2C2E33', 0.35, 0.72),          # dusty structure
    Swatch('der_rust',   '#7E4426', 0.25, 0.72),          # bleached orange trim gone rusty
    Swatch('der_window', '#3A3428', 0.00, 0.55, emit='#FFB45A', emit_strength=0.35),  # dead windows (game brightens)
    # ---- M4: comet ---------------------------------------------------------------
    Swatch('comet_ice',   '#C9D7E2', 0.00, 0.45),         # dirty snow
    Swatch('comet_crust', '#4A4642', 0.05, 0.85),         # dark dust crust
    Swatch('he3_glow',    '#FFF0C0', 0.00, 0.30, emit='#FFD98A', emit_strength=2.8),  # helium-3 pockets
    Swatch('comet_jet',   '#E8FBFF', 0.00, 0.20, emit='#9CE8FF', emit_strength=2.2),
    # ---- M4: NPC trader (Volni obchodnici green), repair module ------------------
    Swatch('accent_trader', '#3DBE6A', 0.15, 0.40),
    Swatch('repair_glow',   '#C8FFD8', 0.00, 0.25, emit='#3CFF7A', emit_strength=2.6),
    # ---- M5a: T3 crystal tier hull -------------------------------------------------
    Swatch('hull_cr',      '#ECE5FA', 0.30, 0.24),        # pearl white with a lilac cast, glossy
    Swatch('hull_dark_cr', '#2F2A45', 0.55, 0.32),        # deep indigo structure
    Swatch('tier_glow_cr', '#B488FF', 0.00, 0.22, emit='#8434FF', emit_strength=2.2),
    Swatch('cr_gem',       '#4A16C8', 0.00, 0.04, emit='#6A1CFF', emit_strength=1.0,
           grad='#A274FF', grad_emit='#B888FF'),          # cut crystal (root -> pale tip)
    Swatch('rad_core',     '#FFE27A', 0.00, 0.30, emit='#FFC21E', emit_strength=2.2),  # shielding absorber
    # ---- M5a: Wardens (Forge-smith guardians) sensor eye / telegraph -------------------
    Swatch('kov_warden',   '#D8FFB0', 0.00, 0.25, emit='#9CF05A', emit_strength=3.5),
    # ---- M5a: ring-3 crystal asteroids + rare-earth (VZ) asteroids ----------------
    Swatch('st_rock_crystal', '#646078', 0.15, 0.5),
    Swatch('st_ore_crystal',  '#5A1ED8', 0.00, 0.05, emit='#7A30FF', emit_strength=1.3,
           grad='#B890FF', grad_emit='#B080FF'),
    Swatch('st_band_crystal', '#9C6CF4', 0.00, 0.12, emit='#8A40FF', emit_strength=1.6),
    Swatch('st_rock_rare',    '#6E6258', 0.10, 0.72),
    Swatch('st_ore_rare',     '#1FC878', 0.10, 0.18, emit='#2AF08C', emit_strength=1.2,
           grad='#D8FFE8', grad_emit='#9CFFC8'),
    Swatch('st_band_rare',    '#7CF0B4', 0.20, 0.25, emit='#2AF08C', emit_strength=1.4),
    # ---- M5a/M6: exotic matter (T4 / Ex resource icon) -----------------------------
    Swatch('ex_matter',    '#FF5FD2', 0.00, 0.10, emit='#FF3AC8', emit_strength=2.4,
           grad='#FFE0F6', grad_emit='#FFB0EC'),
    # ---- M5b: planetary bases (foundations), cruise drive ----------------------------
    Swatch('base_concrete',      '#A39E94', 0.05, 0.86),  # poured foundation slab / pad deck edge
    Swatch('base_concrete_dark', '#5A5650', 0.05, 0.90),  # slab sides, cleared ground
    Swatch('cruise_glow',  '#FFE6B0', 0.00, 0.25, emit='#FFB43C', emit_strength=3.6),   # He3 fuel-cell plasma (gold)
    Swatch('cruise_core',  '#FFF8EC', 0.00, 0.25, emit='#FFE8C0', emit_strength=6.0),
    # ---- pirate clan part sets (readability work step 3, parts_pirate/) ------------
    # Rust reuses the pir_* swatches; one extra fresh-rust patch colour + a dark bead.
    Swatch('pir_rust_patch', '#9A4220', 0.20, 0.85),      # fresh orange-brown rust patches
    Swatch('pir_weld',       '#2E2622', 0.45, 0.70),      # weld beads / scorched seams
    # Kotol (cauldron): sooty cast iron, copper pipes, orange clan paint, furnace glow
    Swatch('kot_iron',       '#4A423B', 0.60, 0.62),
    Swatch('kot_iron_dark',  '#221E1B', 0.50, 0.72),
    Swatch('kot_copper',     '#A0602E', 0.85, 0.38),
    Swatch('kot_paint',      '#C25A14', 0.20, 0.55),      # clan orange (skirt, hazard panels)
    Swatch('kot_furnace',    '#FFB070', 0.00, 0.30, emit='#FF6A10', emit_strength=4.5),
    Swatch('kot_glass',      '#3A1A08', 0.00, 0.18, emit='#FF7A1A', emit_strength=1.8),
    # Slanted Star (slantedStar): black lacquer, graphite, gold trim, yellow glow
    Swatch('sst_lacquer',    '#1B1D27', 0.50, 0.34),
    Swatch('sst_graphite',   '#43475D', 0.45, 0.40),
    Swatch('sst_gold',       '#D4A23C', 0.95, 0.25),
    Swatch('sst_gold_dark',  '#8A6420', 0.90, 0.35),
    Swatch('sst_glow',       '#FFE9A8', 0.00, 0.30, emit='#FFC83A', emit_strength=4.0),
    Swatch('sst_glass',      '#2A2208', 0.00, 0.12, emit='#FFC83A', emit_strength=1.3),
    # ---- art audit 2026-10-16 step 0 (batch C: Guild Watch, borders, Institute traffic) ------
    Swatch('guild_navy',       '#1E2C44', 0.40, 0.40),    # deep navy band on Guild Watch hulls
    Swatch('strobe_blue',      '#E8F4FF', 0.00, 0.25, emit='#9CCBFF', emit_strength=5.0),  # patrol strobe
    Swatch('accent_institute', '#2FB2D2', 0.20, 0.45),    # Institute cyan trim (emblem cyan, not T2 blue)
    # ---- SL2 hull shell torn edges (art/README.md "Hull shell (SL2 E1)") ------------------------
    Swatch('ash',      '#9C968C', 0.00, 0.90),            # matte light ash: soot patches on dark clan decks
    Swatch('hot_edge', '#FFF2C4', 0.00, 0.40, emit='#FFD27A', emit_strength=4.2),  # yellow-white torn rim,
    #                                                       hotter than `ember` (reads on Kotol's orange)
]

INDEX = {s.key: i for i, s in enumerate(SWATCHES)}
BY_KEY = {s.key: s for s in SWATCHES}
assert len(SWATCHES) <= COLS * ROWS, "palette atlas is full"


def swatch_uv(key, t=0.5):
    """UV inside swatch `key`.  t in [0,1] moves along a gradient swatch."""
    i = INDEX[key]
    col, row = i % COLS, i // COLS
    pad = 3.0 / CELL  # stay away from cell borders (filtering / mip bleed)
    u = (col + pad + (1 - 2 * pad) * t) / COLS
    v = (row + 0.5) / ROWS
    return u, v


# ---- swatch table for runtime geometry (SL2 E1 hull shell, art/README.md "Hull shell") ----------
SWATCH_TABLE_FILE = 'palette_swatches.json'
SWATCH_TABLE_SCHEMA = 'af-palette-swatches/1'


def swatch_table():
    """Swatch key -> UV of the swatch's cell centre in the SHIPPED atlas, in glTF / three.js
    convention (v = 0 at the TOP of the PNG, textures loaded with flipY = false), i.e. the UV the
    glTF exporter writes for swatch_uv(key):  (u, 1 - v_blender).  Read by the game's
    parseSwatches (src/render/assets/ModelLibrary.ts) for geometry built at runtime (hull shell,
    nav lights) so code never hard-codes the atlas size.  Gradient swatches: the cell centre
    (t = 0.5).  Same layout for every livery, so one table serves all of them."""
    table = {}
    for s in SWATCHES:
        u, v = swatch_uv(s.key)
        table[s.key] = [u, 1.0 - v]
    return table


def write_swatch_table(out_dir):
    """Write public/assets/textures/palette_swatches.json (deterministic: atlas order, LF)."""
    import json
    import os
    doc = {
        '_schema': SWATCH_TABLE_SCHEMA,
        '_note': 'swatch key -> [u, v] of the cell centre in the AF_Palette atlas (glTF UVs, v from the '
                 'top of the image); generated by art/blender/lib/palette.py (liveries stage) - do not edit',
        'atlas': {'cols': COLS, 'rows': ROWS, 'cell': CELL, 'width': SIZE_X, 'height': SIZE_Y},
        'swatches': swatch_table(),
        'emissive': [s.key for s in SWATCHES if s.emit],
    }
    lines = ['{']
    for k in ('_schema', '_note', 'atlas'):
        lines.append(f'  {json.dumps(k)}: {json.dumps(doc[k])},')
    lines.append('  "swatches": {')
    items = list(doc['swatches'].items())
    for i, (k, (u, v)) in enumerate(items):
        lines.append(f'    {json.dumps(k)}: [{u!r}, {v!r}]' + (',' if i < len(items) - 1 else ''))
    lines.append('  },')
    lines.append(f'  "emissive": {json.dumps(doc["emissive"])}')
    lines.append('}')
    path = os.path.join(out_dir, SWATCH_TABLE_FILE)
    os.makedirs(out_dir, exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')
    return path


# ---- tiers ---------------------------------------------------------------
# A tier swaps the accent colours (and later: extra detail level).
# level: detail level (1 = base, 2 adds fins/trim/extra glow ...); plate/core:
# hull swatches; glow: tier glow line swatch (None = no tier glow).
TIERS = {
    'iron':     {'accent': 'accent_iron',     'accent_dark': 'accent_iron_dark',     'label': 'T1 IRON',
                 'level': 1, 'plate': 'hull_light', 'core': 'hull_dark', 'glow': None},
    'titanium': {'accent': 'accent_titanium', 'accent_dark': 'accent_titanium_dark', 'label': 'T2 TITANIUM',
                 'level': 2, 'plate': 'hull_ti', 'core': 'hull_dark_ti', 'glow': 'tier_glow_ti'},
    'crystal':  {'accent': 'accent_crystal',  'accent_dark': 'accent_crystal_dark',  'label': 'T3 CRYSTAL',
                 'level': 3, 'plate': 'hull_cr', 'core': 'hull_dark_cr', 'glow': 'tier_glow_cr',
                 'gem': 'cr_gem'},
    'exotic':   {'accent': 'accent_exotic',   'accent_dark': 'accent_exotic_dark',   'label': 'T4 EXOTIC',
                 'level': 4, 'plate': 'hull_ti', 'core': 'hull_dark_ti', 'glow': 'reactor_glow'},
}
