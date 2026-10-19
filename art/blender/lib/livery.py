"""Palette liveries: alternative swatch tables with the SAME atlas layout as
AF_Palette, so the game can swap the material's three textures (e.g. pirate
ships built from the normal parts).

Exported to public/assets/textures/palette_<livery>_{basecolor,orm,emissive}.png
(plus palette_default_* = the stock textures for swapping back).
"""
import dataclasses
import os

from . import palette as P
from . import materials as M

# key -> dict of Swatch fields to override
PIRATE = {
    # dark gunmetal hull
    'hull_light':  dict(base='#565C66', metal=0.55, rough=0.42),
    'hull_white':  dict(base='#646A74', metal=0.50, rough=0.40),
    'hull_mid':    dict(base='#3E434C', metal=0.55, rough=0.45),
    'hull_dark':   dict(base='#1E2228', metal=0.50, rough=0.55),
    'hull_ti':     dict(base='#5E6470', metal=0.65, rough=0.35),
    'hull_dark_ti': dict(base='#22262E', metal=0.60, rough=0.45),
    'panel_line':  dict(base='#16191E'),
    'trim_black':  dict(base='#121417'),
    # rust-red trim instead of orange / blue
    'accent_iron':          dict(base='#9C2A1C', metal=0.30, rough=0.55),
    'accent_iron_dark':     dict(base='#5E170F', metal=0.35, rough=0.6),
    'accent_titanium':      dict(base='#B3301F', metal=0.40, rough=0.40),
    'accent_titanium_dark': dict(base='#6A1A12', metal=0.45, rough=0.45),
    'fuel_yellow':          dict(base='#8C6A1E', metal=0.2, rough=0.5),
    # red / amber glows
    'glass_cockpit': dict(base='#4A0E0A', emit='#FF2A12', emit_strength=1.6),
    'engine_glow':   dict(base='#FFB09A', emit='#FF3A16', emit_strength=4.5),
    'engine_core':   dict(base='#FFE2C8', emit='#FFB070', emit_strength=6.0),
    'gyro_glow':     dict(base='#FFC08A', emit='#FF7A10', emit_strength=3.0),
    'tier_glow_ti':  dict(base='#FFB0A0', emit='#FF2A1A', emit_strength=2.6),
    'reactor_glow':  dict(base='#FFC28A', emit='#FF8A1A', emit_strength=2.4),
    'radar_glow':    dict(base='#FF9A8A', emit='#FF3A2A', emit_strength=3.0),
    'fuel_glow':     dict(base='#FFC070', emit='#FF8A20', emit_strength=2.5),
    'laser_glow':    dict(base='#FF5A4A', emit='#FF2A2A', emit_strength=2.6),
    'shield_glow':   dict(base='#FFB0A0', emit='#FF3A2A', emit_strength=3.0),
    'shield_glass':  dict(base='#6A1A12', emit='#FF3A1A', emit_strength=1.4),
    'cannon_glow':   dict(base='#FFB07A', emit='#FF5A10', emit_strength=3.2),
}

# ---- M4 paint jobs ("laky", bought in the Lakovna home module) ------------------
# Paints change ONLY the hull plates/structure; tier accents (orange / blue /
# violet skirts, brackets, gems) and all role glows stay, so the tier and the
# part function remain readable.  Same atlas layout -> swap like the pirate livery.
def _paint(light, white, mid, dark, ti, ti_dark, cr, cr_dark, metal=None, rough=None):
    def sw(base, m, r):
        d = dict(base=base)
        if metal is not None:
            d['metal'] = metal if m is None else m
        if rough is not None:
            d['rough'] = rough if r is None else r
        return d
    return {'hull_light': sw(light, None, None), 'hull_white': sw(white, None, None), 'hull_mid': sw(mid, None, None),
            'hull_dark': sw(dark, None, None), 'hull_ti': sw(ti, None, None), 'hull_dark_ti': sw(ti_dark, None, None),
            'hull_cr': sw(cr, None, None), 'hull_dark_cr': sw(cr_dark, None, None)}


PAINT_GRAPHITE = _paint('#5C626C', '#6C727C', '#454A53', '#25292F', '#646B76', '#2A3039', '#635F72', '#2A2638',
                        metal=0.45, rough=0.38)
PAINT_SAND = _paint('#D8C7A4', '#E6D8BA', '#A89878', '#4E4536', '#DCCDAE', '#4A4334', '#DCCBB4', '#463A40')
PAINT_NAVY = _paint('#3E5C88', '#4D6B98', '#2E4566', '#1A2536', '#45659A', '#1C2840', '#4B5A92', '#20203E',
                    metal=0.4, rough=0.36)
PAINT_RACING = _paint('#C8352C', '#D84A3E', '#8E2A24', '#2A1C1C', '#CF3B32', '#2C1E20', '#C83A48', '#2C1A2C',
                      metal=0.3, rough=0.32)

# ---- derelict ("dead" wreck look, readability work, step 3) ---------------------------
# A remap of EVERY swatch (so it works on player parts, pirate clan parts and anything else on
# AF_Palette): colours desaturated to ~20 %, darkened and pulled toward warm soot, surfaces rough
# and dull, and NO emission at all (dead lamps, cold engines and glass read as dark char).
DERELICT_SAT = 0.2          # share of the original saturation that survives
DERELICT_DARK = 0.5         # value multiplier for plain surfaces
DERELICT_GLOW_DARK = 0.3    # emissive swatches (lamps, glows, glass) go much darker
SOOT = (1.0, 0.9, 0.78)     # warm scorched tint


def _derelict_rgb(hexcol, dark):
    r, g, b = P.hex_rgb(hexcol)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    out = []
    for c, t in zip((r, g, b), SOOT):
        c = (lum + (c - lum) * DERELICT_SAT) * dark * t
        out.append(min(1.0, max(0.025, c)))
    return '#' + ''.join(f'{int(round(c * 255)):02X}' for c in out)


def _derelict_overrides():
    over = {}
    for s in P.SWATCHES:
        dark = DERELICT_GLOW_DARK if s.emit else DERELICT_DARK
        d = dict(base=_derelict_rgb(s.base, dark), metal=round(s.metal * 0.5, 3),
                 rough=max(s.rough, 0.8), emit=None, emit_strength=0.0, grad_emit=None)
        d['grad'] = _derelict_rgb(s.grad, dark) if s.grad else None
        over[s.key] = d
    return over


DERELICT = _derelict_overrides()

LIVERIES = {'pirate': PIRATE, 'paint_graphite': PAINT_GRAPHITE, 'paint_sand': PAINT_SAND, 'paint_navy': PAINT_NAVY,
            'paint_racing': PAINT_RACING, 'derelict': DERELICT}


def swatches_for(livery):
    over = LIVERIES[livery]
    return [dataclasses.replace(s, **over[s.key]) if s.key in over else s for s in P.SWATCHES]


def texture_paths(out_dir, livery):
    return tuple(os.path.join(out_dir, f'palette_{livery}_{k}.png') for k in ('basecolor', 'orm', 'emissive'))


def export_livery(out_dir, livery):
    """Write the livery textures; returns their paths."""
    files = texture_paths(out_dir, livery)
    sw = P.SWATCHES if livery == 'default' else swatches_for(livery)
    M.build_atlas_images(out_dir, swatches=sw,
                         names=tuple(f'AF_Livery_{livery}_{k}' for k in ('BaseColor', 'ORM', 'Emissive')),
                         files=files)
    return files
