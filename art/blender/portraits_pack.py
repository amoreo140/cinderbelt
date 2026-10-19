"""Pack the Komunikator portrait masters (art/out/portraits/<id>.png, RGBA 512 px
rendered by portraits.py) into shipped WebPs + manifest + contact sheet.

Plain Python + Pillow (no Blender):  python art/blender/portraits_pack.py [--quality 90]

  * comm-screen background: dark --af-screen gradient, a soft faction-colour glow
    behind the head, corner vignette (opaque - reads as a lit screen on the dark UI)
  * echo: horizontal slice offsets + chromatic split + scanlines (glitching signal)
  * unknown: static noise + scanlines over a dark silhouette
  * derelict_ai: faint amber static, dust specks, cyan scanline-flicker bands + scanlines
  * out: public/assets/ui/portraits/<id>.webp (128 px) and <id>@2x.webp (256 px),
    portraits.json, art/out/previews/portraits.png
"""
import json
import os
import random
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
MASTERS = os.path.join(ROOT, 'art', 'out', 'portraits')
OUT = os.path.join(ROOT, 'public', 'assets', 'ui', 'portraits')
PREVIEW = os.path.join(ROOT, 'art', 'out', 'previews', 'portraits.png')

SCREEN = (10, 21, 33)          # --af-screen #0a1521
SCREEN_DEEP = (5, 10, 17)


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def background(size, accent, strength=0.34):
    """Vertical screen gradient + radial accent glow behind the head + vignette."""
    w = h = size
    bg = Image.new('RGB', (w, h))
    px = bg.load()
    ar, ag, ab = hex_rgb(accent)
    cx, cy = 0.5 * w, 0.4 * h
    for y in range(h):
        t = y / (h - 1)
        base = [SCREEN[i] * (1 - t) + SCREEN_DEEP[i] * t for i in range(3)]
        for x in range(w):
            dx, dy = (x - cx) / w, (y - cy) / h
            g = max(0.0, 1.0 - (dx * dx + dy * dy) / 0.16) ** 2 * strength
            vx, vy = (x / (w - 1) - 0.5) * 2, (y / (h - 1) - 0.5) * 2
            v = max(0.0, (vx * vx + vy * vy) ** 0.5 - 0.75) * 0.55
            r = (base[0] + ar * g * 0.35) * (1 - v)
            gg = (base[1] + ag * g * 0.35) * (1 - v)
            b = (base[2] + ab * g * 0.35) * (1 - v)
            px[x, y] = (int(r), int(gg), int(b))
    return bg


def scanlines(img, period=2, dark=0.82):
    w, h = img.size
    mask = Image.new('L', (w, h), 255)
    d = ImageDraw.Draw(mask)
    for y in range(0, h, period):
        d.line([(0, y), (w, y)], fill=int(255 * dark))
    return ImageChops.multiply(img, Image.merge('RGB', (mask, mask, mask)))


def glitch(rgba, seed=7):
    """Slice the signal horizontally, shift slices, split RGB channels."""
    rnd = random.Random(seed)
    w, h = rgba.size
    out = rgba.copy()
    y = 0
    while y < h:
        bh = rnd.randint(int(h * 0.015), int(h * 0.07))
        if rnd.random() < 0.38:
            dx = rnd.randint(-int(w * 0.06), int(w * 0.06))
            strip = rgba.crop((0, y, w, min(h, y + bh)))
            out.paste((0, 0, 0, 0), (0, y, w, min(h, y + bh)))
            out.paste(strip, (dx, y))
        y += bh
    r, g, b, a = out.split()
    sh = int(w * 0.012)
    r = ImageChops.offset(r, -sh, 0)
    b = ImageChops.offset(b, sh, 0)
    a2 = ImageChops.lighter(a, ImageChops.lighter(ImageChops.offset(a, -sh, 0), ImageChops.offset(a, sh, 0)))
    return Image.merge('RGBA', (r, g, b, a2))


def static(img, amount=0.55, seed=11):
    rnd = random.Random(seed)
    w, h = img.size
    noise = Image.new('L', (w // 2, h // 2))
    noise.putdata([rnd.randint(0, 255) for _ in range((w // 2) * (h // 2))])
    noise = noise.resize((w, h), Image.NEAREST)
    n_rgb = Image.merge('RGB', (noise, noise, noise))
    tint = Image.new('RGB', (w, h), (90, 104, 124))
    n_rgb = ImageChops.multiply(n_rgb, tint)
    return Image.blend(img, ImageChops.screen(img, n_rgb), amount)


FLICKER = ((0.405, 0.022, 0.018), (0.452, 0.01, -0.012), (0.66, 0.018, 0.01), (0.2, 0.012, -0.008))


def derelict(img, seed=23):
    """Failing station screen: faint amber static, dust specks, a few scanline-flicker bands
    (shifted rows tinted cyan) - mechanical, distinct from echo's violet glitch and unknown's grey snow."""
    w, h = img.size
    rnd = random.Random(seed)
    noise = Image.new('L', (w // 2, h // 2))
    noise.putdata([rnd.randint(0, 255) for _ in range((w // 2) * (h // 2))])
    noise = noise.resize((w, h), Image.NEAREST)
    n_rgb = ImageChops.multiply(Image.merge('RGB', (noise, noise, noise)), Image.new('RGB', (w, h), (130, 98, 54)))
    out = Image.blend(img, ImageChops.screen(img, n_rgb), 0.15)
    d = ImageDraw.Draw(out)
    for _ in range(int(w * h / 1800)):
        x, y = rnd.randrange(w), rnd.randrange(h)
        c = rnd.randint(90, 150)
        d.point((x, y), fill=(c, int(c * 0.86), int(c * 0.66)))
    for fy, fh, fdx in FLICKER:
        y0, y1 = int(fy * h), int(fy * h) + max(1, int(fh * h))
        band = out.crop((0, y0, w, y1))
        band = ImageChops.offset(band, int(fdx * w), 0)
        band = ImageChops.screen(band, Image.new('RGB', band.size, (18, 58, 66)))
        out.paste(band, (0, y0))
    return out


def compose(meta, size):
    src = Image.open(os.path.join(MASTERS, f"{meta['id']}.png")).convert('RGBA')
    fig = src.resize((size, size), Image.LANCZOS)
    if meta['id'] == 'echo':
        bg = background(size, meta['accent'], strength=0.5)
        glow = fig.filter(ImageFilter.GaussianBlur(size * 0.03))
        bg.paste(glow, (0, 0), glow)
        g = glitch(fig)
        bg.paste(g, (0, 0), g)
        return scanlines(bg, period=2 if size <= 128 else 3, dark=0.72)
    if meta['id'] == 'unknown':
        bg = background(size, meta['accent'], strength=0.18)
        bg.paste(fig, (0, 0), fig)
        bg = static(bg, 0.45)
        return scanlines(bg, period=2 if size <= 128 else 3, dark=0.7)
    if meta['id'] == 'derelict_ai':
        bg = background(size, meta['accent'], strength=0.24)
        bg.paste(fig, (0, 0), fig)
        return scanlines(derelict(bg), period=2 if size <= 128 else 3, dark=0.8)
    bg = background(size, meta['accent'])
    bg.paste(fig, (0, 0), fig)
    return bg


def contact_sheet(metas, tiles):
    cols = 4
    t = 256
    pad, lab = 16, 26
    rows = (len(tiles) + cols - 1) // cols
    small = 64
    W = max(cols * (t + pad) + pad, pad + 140 + len(tiles) * 52 + pad)  # fit the 48 px strip
    H = rows * (t + lab + pad) + pad + 60
    sheet = Image.new('RGB', (W, H), (14, 18, 24))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('arial.ttf', 15)
    except OSError:
        font = ImageFont.load_default()
    for i, (m, (big, s128)) in enumerate(zip(metas, tiles)):
        x = pad + (i % cols) * (t + pad)
        y = pad + (i // cols) * (t + lab + pad)
        sheet.paste(big, (x, y))
        # the real 128 px file at 1:1 in the corner + a 64 px thumbnail
        sheet.paste(s128.resize((small, small), Image.LANCZOS), (x + t - small - 4, y + t - small - 4))
        d.rectangle([x + t - small - 5, y + t - small - 5, x + t - 4, y + t - 4], outline=hex_rgb(m['accent']))
        d.rectangle([x, y + t, x + 6, y + t + lab - 6], fill=hex_rgb(m['accent']))
        d.text((x + 12, y + t + 4), f"{m['id']}  ({m['faction']})", fill=(232, 237, 244), font=font)
    y0 = H - 60
    d.text((pad, y0 + 4), 'Real size 128 px:', fill=(147, 160, 179), font=font)
    x = pad + 140
    for m, (big, s128) in zip(metas, tiles):
        thumb = s128.resize((48, 48), Image.LANCZOS)
        sheet.paste(thumb, (x, y0))
        x += 52
    return sheet


def main():
    q = 90
    if '--quality' in sys.argv:
        q = int(sys.argv[sys.argv.index('--quality') + 1])
    with open(os.path.join(MASTERS, 'meta.json'), encoding='utf-8') as f:
        metas = json.load(f)
    os.makedirs(OUT, exist_ok=True)
    manifest = {'size': 128, 'size2x': 256, 'portraits': []}
    tiles = []
    total = 0
    for m in metas:
        p128 = compose(m, 128)
        p256 = compose(m, 256)
        f1 = os.path.join(OUT, f"{m['id']}.webp")
        f2 = os.path.join(OUT, f"{m['id']}@2x.webp")
        p128.save(f1, 'WEBP', quality=q, method=6)
        p256.save(f2, 'WEBP', quality=q - 4, method=6)
        s1, s2 = os.path.getsize(f1), os.path.getsize(f2)
        total += s1 + s2
        print(f"{m['id']:24s} {s1 / 1024:5.1f} KB  @2x {s2 / 1024:5.1f} KB")
        manifest['portraits'].append({'id': m['id'], 'file': f"{m['id']}.webp", 'file2x': f"{m['id']}@2x.webp",
                                      'faction': m['faction'], 'role': m['role'], 'accent': m['accent']})
        tiles.append((Image.open(f2).convert('RGB'), Image.open(f1).convert('RGB')))
    with open(os.path.join(OUT, 'portraits.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    print(f'TOTAL {total / 1024:.1f} KB ({len(metas)} portraits, 128 + 256 px)')
    contact_sheet(metas, tiles).save(PREVIEW)
    print('PREVIEW', PREVIEW)


if __name__ == '__main__':
    main()
