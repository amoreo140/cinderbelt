import { describe, expect, it } from 'vitest';
import type { Silhouette, SilhouetteCell } from '../game/combatView';
import { cannonPips, hitMarker, hpLevel, screenBearing, shipStatusLine, silhouetteLayout, silhouetteOutlinePath, silhouetteTier, threatMode } from './combatHud';

const cell = (x: number, y: number, part: number, fraction = 1, partId: SilhouetteCell['partId'] = 'armor', tier: 1 | 2 = 1): SilhouetteCell => ({
  x,
  y,
  part,
  partId,
  tier,
  fraction,
});

const sil = (cells: SilhouetteCell[]): Silhouette => ({
  cells,
  minX: Math.min(...cells.map((c) => c.x)),
  maxX: Math.max(...cells.map((c) => c.x)),
  minY: Math.min(...cells.map((c) => c.y)),
  maxY: Math.max(...cells.map((c) => c.y)),
  damaged: cells.filter((c) => c.fraction < 1).length,
});

describe('shipStatusLine (M3.8)', () => {
  it('says the ship is intact only when nothing is missing or damaged', () => {
    expect(shipStatusLine({ damaged: 0, missing: 0 }, 1)).toEqual({ text: 'Bez poškodenia', lamp: 'ok' });
    expect(shipStatusLine({ damaged: 0 }, 1)).toEqual({ text: 'Bez poškodenia', lamp: 'ok' });
  });

  it('counts damaged parts (red under 30 % hull)', () => {
    expect(shipStatusLine({ damaged: 3, missing: 0 }, 0.8)).toEqual({ text: '3 poškodené diely', lamp: 'warn' });
    expect(shipStatusLine({ damaged: 1, missing: 0 }, 0.2)).toEqual({ text: '1 poškodený diel', lamp: 'bad' });
  });

  it('puts lost parts first – a lost part is never "no damage"', () => {
    expect(shipStatusLine({ damaged: 0, missing: 1 }, 1)).toEqual({ text: '1 diel stratený', lamp: 'bad' });
    expect(shipStatusLine({ damaged: 2, missing: 1 }, 1)).toEqual({ text: '1 diel stratený · 2 poškodené', lamp: 'bad' });
    expect(shipStatusLine({ damaged: 5, missing: 3 }, 1).text).toBe('3 diely stratené · 5 poškodených');
  });
});

describe('hpLevel', () => {
  it('maps the HP fraction to the cell state of the silhouette', () => {
    expect(hpLevel(1)).toBe('ok');
    expect(hpLevel(0.6)).toBe('ok');
    expect(hpLevel(0.59)).toBe('warn');
    expect(hpLevel(0.3)).toBe('warn');
    expect(hpLevel(0.29)).toBe('crit');
    expect(hpLevel(0.01)).toBe('crit');
    expect(hpLevel(0)).toBe('lost');
    expect(hpLevel(-1)).toBe('lost');
  });
});

describe('silhouetteOutlinePath (SL2 E1 T10)', () => {
  it('maps the grid outline onto the layout: bow up, port left, half a gap outside the cells', () => {
    // a cross: cockpit at the bow, port (+y) and starboard (−y) arms, one aft cell
    const s = sil([cell(1, 0, 1, 1, 'cockpit'), cell(0, 0, 2), cell(-1, 0, 3), cell(0, 1, 4), cell(0, -1, 5)]);
    const l = silhouetteLayout(s, { width: 100, height: 100 }, { maxCell: 10, gap: 2 });
    // a unit square around the cockpit cell (grid frame: x 0.5…1.5, y −0.5…0.5)
    const d = silhouetteOutlinePath('M0.5 -0.5L1.5 -0.5L1.5 0.5L0.5 0.5Z', s, l);
    // the cockpit cell is drawn at (12, 0) … (22, 10); the outline runs 1 px (gap / 2) outside it
    expect(d).toBe('M23 11L23 -1L11 -1L11 11Z');
  });

  it('keeps every subpath (evenodd holes) and fractional bevel points', () => {
    const s = sil([cell(0, 0, 1), cell(2, 2, 2)]);
    const l = silhouetteLayout(s, { width: 100, height: 100 }, { maxCell: 8, gap: 1 });
    const d = silhouetteOutlinePath('M-0.5 -0.5L0.25 -0.5L0.5 -0.25L0.5 0.5L-0.5 0.5Z M1.5 1.5L2.5 1.5L2.5 2.5L1.5 2.5Z', s, l);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/Z/g)).toHaveLength(2);
    // step 9, cell 8: x = (2 − gy)·9 + 4, y = (2 − gx)·9 + 4
    expect(d.startsWith('M26.5 26.5L26.5 19.75L24.25 17.5L17.5 17.5L17.5 26.5Z')).toBe(true);
    expect(d.endsWith('M8.5 8.5L8.5 -0.5L-0.5 -0.5L-0.5 8.5Z')).toBe(true);
  });

  it('is empty without an outline', () => {
    const s = sil([cell(0, 0, 1)]);
    const l = silhouetteLayout(s, { width: 100, height: 100 }, { maxCell: 8, gap: 1 });
    expect(silhouetteOutlinePath(undefined, s, l)).toBe('');
    expect(silhouetteOutlinePath('', s, l)).toBe('');
  });
});

describe('silhouetteTier (SL2 E1 T10)', () => {
  it('takes the tier of the cockpit (the ship class), T1 without one', () => {
    expect(silhouetteTier(sil([cell(0, 0, 1, 1, 'armor', 2), cell(1, 0, 2, 1, 'cockpit', 1)]))).toBe(1);
    expect(silhouetteTier(sil([cell(0, 0, 1, 1, 'armor', 1), cell(1, 0, 2, 1, 'cockpit', 2)]))).toBe(2);
    expect(silhouetteTier(sil([cell(0, 0, 1, 1, 'armor', 2)]))).toBe(1);
  });
});

describe('silhouetteLayout', () => {
  it('draws the ship bow up with its left side on the left (like the hangar)', () => {
    // bow (+x) up, port side (+y) on the left
    const s = sil([cell(1, 0, 1, 1, 'cockpit'), cell(0, 0, 2), cell(-1, 0, 3), cell(0, 1, 4), cell(0, -1, 5)]);
    const l = silhouetteLayout(s, { width: 100, height: 100 }, { maxCell: 10, gap: 2 });
    expect(l.cell).toBe(10);
    expect(l.width).toBe(3 * 10 + 2 * 2);
    expect(l.height).toBe(3 * 10 + 2 * 2);
    const at = (part: number) => l.cells.find((c) => c.part === part)!;
    expect([at(1).x, at(1).y]).toEqual([12, 0]); // kokpit – stred hore
    expect([at(3).x, at(3).y]).toEqual([12, 24]); // zadok dole
    expect([at(4).x, at(4).y]).toEqual([0, 12]); // port side on the left
    expect([at(5).x, at(5).y]).toEqual([24, 12]); // starboard side on the right
  });

  it('shrinks cells to fit the box (never below 3 px)', () => {
    const cells: SilhouetteCell[] = [];
    for (let x = 0; x < 15; x++) cells.push(cell(x, 0, x));
    const l = silhouetteLayout(sil(cells), { width: 200, height: 76 }, { maxCell: 12, gap: 1 });
    // 15 rows in 76 px: (76 − 14) / 15 = 4,13 → 4
    expect(l.cell).toBe(4);
    expect(l.height).toBeLessThanOrEqual(76);
    const tiny = silhouetteLayout(sil(cells), { width: 10, height: 10 }, { maxCell: 12, gap: 1 });
    expect(tiny.cell).toBe(3);
  });

  it('gives every part one box around its cells (tier brackets) and carries the HP level', () => {
    const s = sil([cell(0, 0, 7, 0.5, 'cargo', 2), cell(0, 1, 7, 0.5, 'cargo', 2), cell(1, 0, 8, 0.2, 'cockpit')]);
    const l = silhouetteLayout(s, { width: 100, height: 100 }, { maxCell: 10, gap: 2 });
    const box = l.parts.find((p) => p.part === 7)!;
    expect(box).toMatchObject({ x: 0, y: 12, w: 22, h: 10, tier: 2, level: 'warn' });
    expect(l.parts.find((p) => p.part === 8)).toMatchObject({ level: 'crit', cockpit: true });
    expect(l.cells.filter((c) => c.part === 7).every((c) => c.level === 'warn')).toBe(true);
  });

  it('marks cells and parts lost against the blueprint (M3.8)', () => {
    const s = sil([cell(0, 0, 1, 1, 'cockpit'), { ...cell(1, 0, 2, 0), missing: true }]);
    const l = silhouetteLayout(s, { width: 100, height: 100 }, { maxCell: 10, gap: 2 });
    expect(l.cells.find((c) => c.part === 2)).toMatchObject({ missing: true, level: 'lost' });
    expect(l.cells.find((c) => c.part === 1)).toMatchObject({ missing: false });
    expect(l.parts.find((p) => p.part === 2)).toMatchObject({ missing: true });
  });

  it('handles an empty ship', () => {
    const l = silhouetteLayout({ cells: [], minX: 0, maxX: 0, minY: 0, maxY: 0, damaged: 0 }, { width: 80, height: 80 }, { maxCell: 10, gap: 1 });
    expect(l.cells).toEqual([]);
    expect(l.parts).toEqual([]);
  });
});

describe('hitMarker', () => {
  const view = { width: 1000, height: 600 };

  it('puts a hit from the right (world angle 0) on the right edge, pointing right', () => {
    const m = hitMarker(0, view, 40);
    expect(m.x).toBeCloseTo(960);
    expect(m.y).toBeCloseTo(300);
    expect(m.rotation).toBeCloseTo(0);
  });

  it('turns world angles into screen angles (north-up camera, y down)', () => {
    // attacker to the north (+y in the world) = up on the screen
    const up = hitMarker(Math.PI / 2, view, 40);
    expect(up.x).toBeCloseTo(500);
    expect(up.y).toBeCloseTo(40);
    expect(up.rotation).toBeCloseTo(-Math.PI / 2);
    const down = hitMarker(-Math.PI / 2, view, 40);
    expect(down.y).toBeCloseTo(560);
  });

  it('keeps diagonal markers on the inset ellipse along the true direction', () => {
    const m = hitMarker(Math.PI / 4, view, 40);
    const dx = m.x - 500;
    const dy = m.y - 300;
    // direction preserved (up and to the right)
    expect(Math.atan2(dy, dx)).toBeCloseTo(-Math.PI / 4);
    // na elipse s poloosami 460 × 260
    expect((dx / 460) ** 2 + (dy / 260) ** 2).toBeCloseTo(1);
  });
});

describe('screenBearing', () => {
  it('is the negated world angle (north-up camera, screen y down)', () => {
    expect(screenBearing(0)).toBeCloseTo(0);
    expect(screenBearing(Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    expect(screenBearing(-2)).toBeCloseTo(2);
  });
});

describe('cannonPips', () => {
  it('lights one pip per ready cannon', () => {
    expect(cannonPips({ total: 3, ready: 2 })).toEqual([true, true, false]);
    expect(cannonPips({ total: 0, ready: 0 })).toEqual([]);
  });

  it('caps the row so a gun boat does not overflow the console', () => {
    const pips = cannonPips({ total: 14, ready: 14 }, 8);
    expect(pips).toHaveLength(8);
  });
});

describe('threatMode', () => {
  it('shows the full alert band right after the alert, then a compact band while attacked', () => {
    const threat = { nearby: 2, attacking: 1, nearest: { distance: 80, angle: 0 } };
    expect(threatMode(threat, 10, 12)).toBe('alert');
    expect(threatMode(threat, 13, 12)).toBe('compact');
    expect(threatMode({ ...threat, attacking: 0, nearest: null }, 13, 12)).toBe(null);
    expect(threatMode({ ...threat, attacking: 0, nearest: null }, 11, 12)).toBe('alert');
  });
});
