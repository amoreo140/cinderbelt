"""Faction emblems (M3.5a) as clean flat SVGs -> public/assets/ui/emblems/.

Pure Python (no Blender needed):  python art/blender/emblems.py

Rules (match the "Jazyk trupu" UI design-system tokens):
  * viewBox 0 0 128 128, fills only (no strokes, no gradients, no text),
    2-3 colours each, every shape a plain <polygon>/<path> so it also imports
    into Blender for previews.
  * Human factions use the hull-plate badge: a chamfered octagon (like
    --af-cut plates) with a faction-colour trim ring and an --af-band core.
  * Pirate clans (Rust, Kotol, Slanted Star) use a jagged, welded-scrap
    badge in rust tones.
  * Wardens (Forge-smith machines) use the Forge-smith language: 3-fold symmetry,
    obsidian + ember + violet crystal.
Colours (tokens.css): --af-band #1b222d, --af-hull #d9dee6, --af-trim #f27a2c,
--af-glow #62d9f4, --af-ok #6be38a, --af-warn #ffb547, --af-bad #ff5a4a,
rust #9c2a1c (pirate livery), Forge-smith obsidian #17151d / ember #ff6a2a /
violet #8f7dff (--af-ring-b).
"""
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'public', 'assets', 'ui', 'emblems')

BAND, HULL, TRIM, GLOW, OK, WARN, BAD = '#1b222d', '#d9dee6', '#f27a2c', '#62d9f4', '#6be38a', '#ffb547', '#ff5a4a'
RUST, INK = '#9c2a1c', '#16202c'
OBSIDIAN, EMBER, VIOLET = '#17151d', '#ff6a2a', '#8f7dff'


def fmt(pts):
    return ' '.join(f'{x:.1f},{y:.1f}' for x, y in pts)


def poly(pts, fill):
    return f'  <polygon points="{fmt(pts)}" fill="{fill}"/>'


def ring_path(cx, cy, r0, r1, fill, n=48):
    """Annulus as one path (outer CW + inner CCW, evenodd)."""
    o = [(cx + r1 * math.cos(2 * math.pi * i / n), cy + r1 * math.sin(2 * math.pi * i / n)) for i in range(n)]
    i_ = [(cx + r0 * math.cos(-2 * math.pi * i / n), cy + r0 * math.sin(-2 * math.pi * i / n)) for i in range(n)]
    d = 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in o) + ' Z M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in i_) + ' Z'
    return f'  <path d="{d}" fill="{fill}" fill-rule="evenodd"/>'


def circle(cx, cy, r, fill, n=32):
    return poly([(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)], fill)


def octagon(inset=0.0, c=24.0):
    a, b = 4 + inset, 124 - inset
    c = c - inset * 0.4
    return [(a + c, a), (b - c, a), (b, a + c), (b, b - c), (b - c, b), (a + c, b), (a, b - c), (a, a + c)]


def plate_badge(trim):
    return [poly(octagon(0), trim), poly(octagon(6), BAND)]


def jagged(r_out, r_in, n, cx=64, cy=64, rot=0.0, jitter=(1.0, 0.92, 1.04, 0.95, 1.02, 0.9, 1.05, 0.94)):
    pts = []
    for i in range(2 * n):
        r = (r_out if i % 2 == 0 else r_in) * jitter[i % len(jitter)]
        a = math.radians(rot + 180.0 * i / n) - math.pi / 2
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def scrap_badge(rim):
    """Welded-scrap shield: irregular 9-sided plate with notches."""
    outer = [(16, 10), (60, 4), (104, 12), (122, 40), (118, 86), (96, 116), (64, 124), (30, 114), (8, 84), (6, 40)]
    inner = [(22, 18), (60, 12), (98, 19), (114, 43), (110, 84), (91, 108), (64, 116), (34, 106), (15, 80), (14, 44)]
    notch = [(60, 4), (66, 4), (63, 14)]
    return [poly(outer, rim), poly(inner, INK), poly(notch, INK)]


def rot_pts(pts, deg, cx=64, cy=64):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return [(cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c) for x, y in pts]


def arc_poly(cx, cy, r0, r1, a0, a1, n=20):
    o = [(cx + r1 * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + r1 * math.sin(math.radians(a0 + (a1 - a0) * i / n)))
         for i in range(n + 1)]
    i_ = [(cx + r0 * math.cos(math.radians(a1 - (a1 - a0) * i / n)), cy + r0 * math.sin(math.radians(a1 - (a1 - a0) * i / n)))
          for i in range(n + 1)]
    return o + i_


# ----------------------------------------------------------------------------
def cech():
    """Mining Guild: a mining drill bit (point down) under an orange chuck."""
    s = plate_badge(TRIM)
    s.append(poly([(42, 22), (86, 22), (86, 36), (42, 36)], TRIM))                    # chuck
    s.append(poly([(36, 22), (92, 22), (92, 27), (36, 27)], TRIM))
    bit = [(40, 40), (88, 40), (64, 108)]
    s.append(poly(bit, HULL))                                                          # bit
    for k, y in enumerate((52, 68, 84)):                                               # spiral flutes
        w = (108 - y) / 68 * 24
        s.append(poly([(64 - w - 2, y + 6), (64 + w - 4, y - 6), (64 + w - 6, y - 1), (64 - w, y + 11)], BAND))
    return s


def institut():
    """Kartograficky institut: compass star on an orbit ring with a planet."""
    s = plate_badge(GLOW)
    s.append(ring_path(64, 64, 29, 35, GLOW))
    star = []
    for i in range(8):
        r = 46 if i % 2 == 0 else 9
        a = math.radians(-90 + 45 * i)
        star.append((64 + r * math.cos(a), 64 + r * math.sin(a)))
    s.append(poly(star, HULL))
    s.append(circle(64 + 32 * math.cos(math.radians(-40)), 64 + 32 * math.sin(math.radians(-40)), 8, GLOW))
    s.append(circle(64, 64, 5, BAND))
    return s


def volni():
    """Volni obchodnici: two arrows chasing each other round a coin."""
    s = plate_badge(OK)
    for k, (a0, a1) in enumerate(((200, 330), (20, 150))):
        s.append(poly(arc_poly(64, 64, 30, 40, a0, a1, 18), OK))
        tip = math.radians(a1 + 14)
        base0 = (64 + 24 * math.cos(math.radians(a1)), 64 + 24 * math.sin(math.radians(a1)))
        base1 = (64 + 46 * math.cos(math.radians(a1)), 64 + 46 * math.sin(math.radians(a1)))
        s.append(poly([base0, base1, (64 + 35 * math.cos(tip), 64 + 35 * math.sin(tip))], OK))
    s.append(circle(64, 64, 15, HULL))
    s.append(poly([(64, 54), (73, 64), (64, 74), (55, 64)], BAND))
    return s


def hrdza():
    """Rust (rust clan): three claw slashes on a welded-scrap shield."""
    s = scrap_badge(RUST)
    for k in range(3):
        x = 42 + k * 20
        claw = [(x - 4, 26), (x + 6, 30), (x + 2, 104), (x - 8, 98)]
        s.append(poly(rot_pts(claw, -16), BAD))
    return s


def kotol():
    """Kotol (cauldron clan): a cauldron with three flame tongues."""
    s = scrap_badge(WARN)
    s.append(poly([(20, 58), (108, 58), (108, 68), (20, 68)], BAD))                      # rim
    bowl = [(26, 68)] + [(64 + 38 * math.cos(math.radians(a)), 68 + 34 * math.sin(math.radians(a)))
                         for a in range(165, 0, -15)] + [(102, 68)]
    s.append(poly(bowl, BAD))
    for k, (x, h) in enumerate(((44, 30), (64, 44), (84, 30))):
        s.append(poly([(x - 9, 56), (x - 4, 56 - h * 0.55), (x, 56 - h), (x + 5, 56 - h * 0.5), (x + 9, 56)], WARN))
    s.append(poly([(36, 100), (44, 100), (40, 112)], BAD))                               # feet
    s.append(poly([(84, 100), (92, 100), (88, 112)], BAD))
    return s


def sikma_hviezda():
    """Slanted Star (slanted star clan): a sheared four-point star + slash."""
    s = scrap_badge(WARN)
    star = []
    for i in range(8):
        r = 48 if i % 2 == 0 else 11
        a = math.radians(-90 + 45 * i)
        x, y = r * math.cos(a), r * math.sin(a)
        star.append((64 + x - 0.38 * y, 64 + y))                                         # shear = "slanted"
    s.append(poly(star, WARN))
    s.append(poly([(28, 96), (100, 30), (106, 36), (34, 102)], BAD))
    return s


def straznici():
    """Wardens (Forge-smith guardians): three converging blades round a violet
    crystal, on a cut-corner triangle (Forge-smith 3-fold language)."""
    tri = []
    for i in range(3):
        a = math.radians(-90 + 120 * i)
        for d in (-22, 22):
            b = a + math.radians(d)
            tri.append((64 + 62 * math.cos(b), 70 + 62 * math.sin(b)))
    s = [poly(tri, EMBER)]
    tri_in = [((x - 64) * 0.86 + 64, (y - 70) * 0.86 + 70) for x, y in tri]
    s.append(poly(tri_in, OBSIDIAN))
    for i in range(3):
        blade = [(64, 64 - 44), (70, 64 - 18), (64, 64 - 8), (58, 64 - 18)]
        s.append(poly(rot_pts(blade, 120 * i, 64, 66), EMBER))
    s.append(poly([(64, 52), (74, 66), (64, 80), (54, 66)], VIOLET))
    return s


EMBLEMS = {'cech': cech, 'institut': institut, 'volni_obchodnici': volni, 'hrdza': hrdza, 'kotol': kotol,
           'sikma_hviezda': sikma_hviezda, 'straznici': straznici}
TITLES = {'cech': 'Tazobny cech', 'institut': 'Kartograficky institut', 'volni_obchodnici': 'Volni obchodnici',
          'hrdza': 'Klan Hrdza', 'kotol': 'Klan Kotol', 'sikma_hviezda': 'Klan Sikma hviezda',
          'straznici': 'Strazcovia'}


def write_all(out_dir=OUT):
    os.makedirs(out_dir, exist_ok=True)
    made = []
    for k, fn in EMBLEMS.items():
        body = '\n'.join(fn())
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">\n'
               f'  <title>{TITLES[k]}</title>\n{body}\n</svg>\n')
        p = os.path.join(out_dir, f'{k}.svg')
        with open(p, 'w', encoding='utf-8') as f:
            f.write(svg)
        made.append(p)
    return made


if __name__ == '__main__':
    for p in write_all():
        print('EMBLEM', p)
