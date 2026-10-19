"""Map / radar SVG icons (M4d task A1) -> public/assets/ui/icons/.

Pure Python (no Blender needed):  python art/blender/map_icons.py
Preview sheet (Node + sharp):     python art/blender/map_icons.py --preview  -> art/out/previews/m4d-icons.png

Style = the M4b site glyphs drawn on the map / radar canvases (src/ui/canvasDraw.ts, radarDraw.ts) and
the radar grammar R7:
  * OBJECTS (notes, relay mast) are an outline in their colour with at most a faint fill (0.14-0.3),
    round joins / caps, stroke ~1.4 px at 16 px;
  * SHIPS (convoy, Guild Watch) are FILLED with the dark screen outline (#0a1521), pointing +X (right)
    at rest - rotate by the heading like drawRadarShip;
  * colour = meaning: friendly Guild = ok green #6be38a (+ the Guild orange chevron #f27a2c), neutral
    traders = the neutral ship blue #7cc8ff, hostile = bad red #ff5a4a, warning = warn amber #ffb547.
viewBox 0 0 24 24, width/height 24; no text, no gradients, no filters.  Every file has a <title>.

Files (id -> file):
  note_star, note_warning, note_ore, note_pirate, note_flag   map note icons (MapNote.icon)
  convoy                                                      convoy map / radar glyph (trader + tanker)
  guild_watch, guild_watch_hostile                            Guild Watch radar glyph (hostile = optional:
                                                              no friendly fire, the Watch never turns on
                                                              the player in M4d)
  guild_relay, guild_relay_lit                                Guild relay mast map glyph (unpowered / powered)
"""
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'public', 'assets', 'ui', 'icons')

# src/ui/theme/tokens.ts PALETTE
SCREEN, HULL_HI, HULL_SHADE = '#0a1521', '#eef1f5', '#aab3c0'
TRIM, GLOW, OK, WARN, BAD = '#f27a2c', '#62d9f4', '#6be38a', '#ffb547', '#ff5a4a'
FUEL, SHIELD, ORE_RICH = '#f4c64e', '#7cc8ff', '#ffcf5c'

SW = 2.0          # outline width in viewBox units (24 -> 1.33 px at 16 px, like the 1.3-1.5 px canvas glyphs)
FAINT = 0.22      # object fill opacity (radarDraw OBJECT_FILL)


def f(v):
    return f'{v:.2f}'.rstrip('0').rstrip('.')


def pts(p):
    return ' '.join(f'{f(x)},{f(y)}' for x, y in p)


def obj_poly(p, color, fill_op=FAINT, sw=SW):
    """Hollow object: outline + faint fill."""
    return (f'  <polygon points="{pts(p)}" fill="{color}" fill-opacity="{fill_op}" stroke="{color}" '
            f'stroke-width="{f(sw)}" stroke-linejoin="round"/>')


def ship_poly(p, color, sw=1.5):
    """Filled ship shape with the dark screen outline."""
    return f'  <polygon points="{pts(p)}" fill="{color}" stroke="{SCREEN}" stroke-width="{f(sw)}" stroke-linejoin="round"/>'


def fill_poly(p, color, op=1.0):
    o = '' if op >= 1 else f' fill-opacity="{op}"'
    return f'  <polygon points="{pts(p)}" fill="{color}"{o}/>'


def line(p, color, sw=SW, op=1.0):
    o = '' if op >= 1 else f' stroke-opacity="{op}"'
    return (f'  <polyline points="{pts(p)}" fill="none" stroke="{color}" stroke-width="{f(sw)}" '
            f'stroke-linecap="round" stroke-linejoin="round"{o}/>')


def circle(cx, cy, r, color, fill=None, fill_op=1.0, sw=SW, stroke_op=1.0):
    fl = 'none' if fill is None else fill
    fo = '' if fill is None or fill_op >= 1 else f' fill-opacity="{fill_op}"'
    st = '' if sw <= 0 else f' stroke="{color}" stroke-width="{f(sw)}"' + ('' if stroke_op >= 1 else f' stroke-opacity="{stroke_op}"')
    return f'  <circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="{fl}"{fo}{st}/>'


def star_pts(cx, cy, r0, r1, n=5, rot=-90):
    out = []
    for i in range(2 * n):
        r = r1 if i % 2 == 0 else r0
        a = math.radians(rot + i * 180 / n)
        out.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return out


# ----------------------------------------------------------------------------
# map notes (objects: outline + faint fill)
# ----------------------------------------------------------------------------
def note_star():
    return [obj_poly(star_pts(12, 12.6, 4.1, 9.6), FUEL)]


def note_warning():
    tri = [(12, 2.8), (21.6, 20.2), (2.4, 20.2)]
    return [obj_poly(tri, WARN), line([(12, 9.2), (12, 14.2)], WARN, sw=2.3), circle(12, 17.3, 1.25, WARN, fill=WARN, sw=0)]


def note_ore():
    # a faceted rock (hull shade) with a gold ore crystal vein through it
    rock = [(5.0, 7.4), (10.4, 3.4), (17.6, 4.6), (21.2, 10.6), (18.6, 18.6), (10.6, 20.8), (3.6, 15.6)]
    vein = [(7.6, 15.4), (11.4, 9.0), (16.6, 8.0), (14.2, 11.6), (17.4, 14.8), (11.2, 17.0)]
    return [obj_poly(rock, HULL_SHADE), fill_poly(vein, ORE_RICH), line([(11.4, 9.0), (14.2, 11.6), (11.2, 17.0)], SCREEN,
                                                                    sw=0.9, op=0.55)]


def note_pirate():
    # skull: cranium + jaw, dark eye sockets, a nose notch and teeth lines
    skull = [(12, 2.6), (16.9, 3.9), (19.6, 7.6), (19.4, 12.4), (16.8, 14.8), (16.8, 19.6), (7.2, 19.6),
             (7.2, 14.8), (4.6, 12.4), (4.4, 7.6), (7.1, 3.9)]
    return [obj_poly(skull, BAD, fill_op=0.26),
            circle(8.9, 9.6, 2.2, BAD, fill=BAD, sw=0), circle(15.1, 9.6, 2.2, BAD, fill=BAD, sw=0),
            fill_poly([(12, 11.8), (13.2, 14.0), (10.8, 14.0)], BAD),
            line([(10.4, 16.4), (10.4, 19.4)], BAD, sw=1.3), line([(13.6, 16.4), (13.6, 19.4)], BAD, sw=1.3)]


def note_flag():
    pole = line([(6.4, 21.4), (6.4, 2.8)], GLOW)
    pennant = [(6.4, 3.4), (19.8, 7.6), (6.4, 12.6)]
    return [obj_poly(pennant, GLOW, fill_op=0.3), pole, line([(3.4, 21.4), (9.6, 21.4)], GLOW)]


# ----------------------------------------------------------------------------
# ships (filled + dark outline), bow +X
# ----------------------------------------------------------------------------
def convoy():
    """Neutral convoy: a long freighter hull (pointed bow, the container racks as one dark seam) with the
    short tanker behind it - a 'train', never the wedge of the Guild."""
    trader = [(23.0, 12), (19.4, 7.0), (9.2, 7.0), (7.6, 8.8), (7.6, 15.2), (9.2, 17.0), (19.4, 17.0)]
    tanker = [(5.6, 12), (4.4, 9.4), (1.8, 9.4), (0.9, 10.6), (0.9, 13.4), (1.8, 14.6), (4.4, 14.6)]
    return [ship_poly(tanker, SHIELD), ship_poly(trader, SHIELD),
            line([(10.6, 12), (18.2, 12)], SCREEN, sw=1.1, op=0.6)]


def _watch(fill, chev, chev_op=1.0):
    """Guild Watch: the radar ship arrowhead (drawRadarShip proportions) with a Guild chevron across it."""
    s, cx, cy = 10.6, 12.6, 12
    wedge = [(cx + s, cy), (cx - s * 0.75, cy + s * 0.7), (cx - s * 0.4, cy), (cx - s * 0.75, cy - s * 0.7)]
    # forward-pointing chevron band inside the wedge
    ch = [(cx + 1.6, cy), (cx - 3.4, cy + 4.0), (cx - 5.2, cy + 4.0), (cx - 0.6, cy),
          (cx - 5.2, cy - 4.0), (cx - 3.4, cy - 4.0)]
    return [ship_poly(wedge, fill), fill_poly(ch, chev, chev_op)]


def guild_watch():
    return _watch(OK, TRIM)


def guild_watch_hostile():
    return _watch(BAD, SCREEN, 0.75)


# ----------------------------------------------------------------------------
# Guild relay mast (object): drawRelayMast + the Guild orange and a chevron on the foot
# ----------------------------------------------------------------------------
def _relay(lit):
    out = []
    mast = TRIM
    if lit:
        out.append(circle(12, 6.4, 5.6, GLOW, sw=1.2, stroke_op=0.45))
    out.append(line([(12, 21.0), (12, 10.0)], mast))
    out.append(line([(5.8, 21.0), (18.2, 21.0)], mast))
    # Guild chevron on the mast (points up = the relay's forward on the map legend)
    out.append(line([(8.6, 17.6), (12, 14.6), (15.4, 17.6)], mast, sw=1.6))
    if lit:
        out.append(circle(12, 6.4, 3.4, GLOW, fill=GLOW, sw=0))
    else:
        out.append(circle(12, 6.4, 3.4, mast, fill=mast, fill_op=0.14))
    return out


def guild_relay():
    return _relay(False)


def guild_relay_lit():
    return _relay(True)


ICONS = {
    'note_star': (note_star, 'Map note: star'),
    'note_warning': (note_warning, 'Map note: warning'),
    'note_ore': (note_ore, 'Map note: ore'),
    'note_pirate': (note_pirate, 'Map note: pirates'),
    'note_flag': (note_flag, 'Map note: flag'),
    'convoy': (convoy, 'Convoy (trader + tanker), bow +X'),
    'guild_watch': (guild_watch, 'Guild Watch ship (friendly), bow +X'),
    'guild_watch_hostile': (guild_watch_hostile, 'Guild Watch ship (hostile, optional), bow +X'),
    'guild_relay': (guild_relay, 'Guild relay mast (unpowered)'),
    'guild_relay_lit': (guild_relay_lit, 'Guild relay mast (powered)'),
}


def svg(body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">\n'
            f'  <title>{title}</title>\n' + '\n'.join(body) + '\n</svg>\n')


def write_all(out_dir=OUT):
    os.makedirs(out_dir, exist_ok=True)
    made = []
    for k, (fn, title) in ICONS.items():
        p = os.path.join(out_dir, f'{k}.svg')
        with open(p, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(svg(fn(), title))
        made.append(p)
    return made


def _inner(path):
    txt = open(path, encoding='utf-8').read()
    return txt[txt.index('>', txt.index('<svg')) + 1:txt.rindex('</svg>')]


def preview(out_png=None):
    """Contact sheet: every icon at 16 / 24 / 64 px on the map screen colour, plus a radar-like strip
    (ships rotated by a heading, notes and relays among the M4b-style rings), rasterized by sharp."""
    import subprocess
    import shutil
    root = os.path.dirname(os.path.dirname(HERE))
    out_png = out_png or os.path.join(root, 'art', 'out', 'previews', 'm4d-icons.png')
    W, row_h = 760, 84
    keys = list(ICONS)
    H = 40 + row_h * len(keys) + 230
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
             f'<rect width="{W}" height="{H}" fill="{SCREEN}"/>',
             '<text x="16" y="26" font-family="Segoe UI, Arial" font-size="15" fill="#93a0b3">M4d map / radar icons '
             '(public/assets/ui/icons) at 16, 24 and 64 px</text>']
    for i, k in enumerate(keys):
        y = 40 + i * row_h
        body = _inner(os.path.join(OUT, k + '.svg'))
        parts.append(f'<line x1="0" y1="{y}" x2="{W}" y2="{y}" stroke="#1d3a52" stroke-width="1"/>')
        for x, size in ((20, 16), (52, 24), (96, 64)):
            parts.append(f'<svg x="{x}" y="{y + (row_h - size) / 2:.0f}" width="{size}" height="{size}" '
                         f'viewBox="0 0 24 24">{body}</svg>')
        parts.append(f'<text x="186" y="{y + 38}" font-family="Consolas, monospace" font-size="15" '
                     f'fill="#e8edf4">{k}.svg</text>')
        parts.append(f'<text x="186" y="{y + 60}" font-family="Segoe UI, Arial" font-size="13" '
                     f'fill="#93a0b3">{ICONS[k][1]}</text>')
    # radar-ish strip
    y0 = 40 + row_h * len(keys) + 10
    cx, cy = 380, y0 + 105
    parts.append(f'<rect x="0" y="{y0}" width="{W}" height="220" fill="#08111b"/>')
    for r in (40, 80, 120, 160):
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#1d3a52" stroke-width="1"/>')
    placed = [('convoy', -150, -30, 20, 18), ('guild_watch', -60, 40, -35, 16), ('guild_watch', -30, 62, -20, 16),
              ('guild_watch_hostile', 120, -60, 160, 16), ('note_star', 60, 20, 0, 16), ('note_warning', 150, 50, 0, 16),
              ('note_ore', -110, 70, 0, 16), ('note_pirate', 200, -20, 0, 16), ('note_flag', 20, -70, 0, 16),
              ('guild_relay', -200, 40, 0, 16), ('guild_relay_lit', 250, 70, 0, 16)]
    for k, dx, dy, rot, size in placed:
        body = _inner(os.path.join(OUT, k + '.svg'))
        x, y = cx + dx - size / 2, cy + dy - size / 2
        parts.append(f'<g transform="rotate({-rot} {cx + dx} {cy + dy})"><svg x="{x}" y="{y}" width="{size}" '
                     f'height="{size}" viewBox="0 0 24 24">{body}</svg></g>')
    parts.append(f'<polygon points="{cx + 9},{cy} {cx - 6},{cy + 5.5} {cx - 3},{cy} {cx - 6},{cy - 5.5}" '
                 f'fill="{HULL_HI}" stroke="{TRIM}" stroke-width="1.5"/>')
    parts.append(f'<text x="16" y="{y0 + 210}" font-family="Segoe UI, Arial" font-size="12" fill="#93a0b3">'
                 'in context at 16-18 px (ships rotated by heading, the player arrow in the centre)</text>')
    parts.append('</svg>')
    sheet = os.path.join(root, 'art', 'out', 'tmp_m4d_icons.svg')
    with open(sheet, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(parts))
    node = shutil.which('node')
    js = ("const s=require('sharp');s(process.argv[1],{density:72}).png().toFile(process.argv[2])"
          ".then(()=>console.log('PNG',process.argv[2])).catch(e=>{console.error(e);process.exit(1)})")
    subprocess.run([node, '-e', js, sheet, out_png], cwd=root, check=True)
    return out_png


if __name__ == '__main__':
    import sys
    for p in write_all():
        print('ICON', p)
    if '--preview' in sys.argv:
        preview()
