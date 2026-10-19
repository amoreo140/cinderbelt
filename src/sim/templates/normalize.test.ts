import { describe, expect, it } from 'vitest';
import { SHAPE_IDS } from '../../data/shapes';
import { createGrid } from '../ship/grid';
import { createStarterShip } from '../ship/presets';
import { compareTemplateParts, gridTemplateParts, isTemplatePart, normalizeParts, normalizeTemplate, templateGrid, templateProblem } from './normalize';
import { randomShip, shapedRandomShip, shifted } from './testShips';
import type { TemplatePart } from './types';

describe('normalizeTemplate', () => {
  it('puts the cockpit at (0, 0) and sorts the parts by key, x, y, rot', () => {
    const t = normalizeTemplate(createGrid([['engine', 2, 3, 0], ['cockpit', 3, 3], ['armor', 4, 3]]))!;
    expect(t).toEqual([
      ['armor:1', 1, 0, 0],
      ['cockpit:1', 0, 0, 0],
      ['engine:1', -1, 0, 0],
    ]);
  });

  it('drops ids, HP and the Guild loan flag', () => {
    const grid = createGrid([['cockpit', 0, 0], ['engine', -1, 0]]);
    grid.parts[1]!.loan = true;
    const t = normalizeTemplate(grid)!;
    for (const p of t) expect(p).toHaveLength(4);
    expect(t).toContainEqual(['engine:1', -1, 0, 0]);
  });

  it('keeps tiers and variants in the key', () => {
    const grid = createGrid([['cockpit', 0, 0, 0, 2], ['engine', -1, 0, 0, 2]]);
    grid.parts[1]!.variant = 'overdrive';
    const keys = normalizeTemplate(grid)!.map((p) => p[0]);
    expect(keys).toContain('cockpit:2');
    expect(keys).toContain('engine:2:overdrive');
  });

  it('needs exactly one cockpit', () => {
    expect(normalizeTemplate(createGrid([['engine', 0, 0]]))).toBeNull();
    expect(normalizeTemplate(createGrid([['cockpit', 0, 0], ['cockpit', 1, 0]]))).toBeNull();
  });

  it('is idempotent and placement-invariant (property, random ships)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const ship = randomShip(seed);
      const t = normalizeTemplate(ship)!;
      expect(normalizeParts(t), `seed ${seed}`).toEqual(t);
      expect(normalizeTemplate(templateGrid(t)), `seed ${seed}`).toEqual(t);
      // the same ship built three cells to the left and two up, parts in another order
      expect(normalizeTemplate(shifted(ship, -3, 2)), `seed ${seed}`).toEqual(t);
      expect(templateProblem(t), `seed ${seed}`).toBeNull();
    }
  });
});

describe('templateProblem', () => {
  const ok = normalizeTemplate(createStarterShip())!;

  it('accepts a valid design', () => {
    expect(templateProblem(ok)).toBeNull();
  });

  it('names the problem', () => {
    expect(templateProblem([])).toBe('empty');
    expect(templateProblem([['nope:1' as never, 0, 0, 0]])).toBe('unknownPart');
    expect(templateProblem([['engine:1', 0, 0, 0]])).toBe('noCockpit');
    expect(templateProblem([['cockpit:1', 0, 0, 0], ['cockpit:1', 1, 0, 0]])).toBe('multipleCockpits');
    expect(templateProblem([['cockpit:1', 0, 0, 0], ['armor:1', 0, 0, 0]])).toBe('overlap');
    expect(templateProblem([['cockpit:1', 0, 0, 0], ['armor:1', 1e15, 0, 0]])).toBe('outOfBounds');
    expect(templateProblem([['cockpit:1', 0, 0, 0], ['armor:1', 3, 0, 0]])).toBe('disconnected');
  });

  it('fits the 15 × 15 hangar exactly: a 15-cell line is fine, 16 cells are not', () => {
    const line = (n: number): TemplatePart[] => [['cockpit:1', 0, 0, 0], ...Array.from({ length: n - 1 }, (_, i): TemplatePart => ['armor:1', i + 1, 0, 0])];
    expect(templateProblem(line(15))).toBeNull();
    expect(templateProblem(line(16))).toBe('outOfBounds');
    // a 2-cell part at the far end counts with both cells
    expect(templateProblem([...line(13), ['heavyLaser:1', 13, 0, 0]])).toBeNull();
    expect(templateProblem([...line(14), ['heavyLaser:1', 14, 0, 0]])).toBe('outOfBounds');
    // the same holds left of the cockpit (the cockpit need not be in the middle)
    expect(templateProblem(line(15).map(([k, x, y, r]): TemplatePart => [k, -x, y, r]))).toBeNull();
  });
});

describe('templates with shapes (SL2 E2)', () => {
  it('gridTemplateParts gives shaped parts a 5th element, unshaped ones stay 4-tuples', () => {
    const parts = gridTemplateParts(createGrid([['cockpit', 0, 0], ['armor', 1, 0, 2, 1, 'wedge'], ['armor', -1, 0]]));
    expect(parts).toEqual([['cockpit:1', 0, 0, 0], ['armor:1', 1, 0, 2, 'wedge'], ['armor:1', -1, 0, 0]]);
  });

  it('templateGrid restores the shapes; a full part gets no shape key', () => {
    const grid = templateGrid([['armor:1', 1, 0, 2, 'wedge'], ['armor:1', -1, 0, 0], ['cockpit:1', 0, 0, 0]], 3, 4);
    expect(grid.parts[0]).toMatchObject({ partId: 'armor', x: 4, y: 4, rot: 2, shape: 'wedge' });
    expect('shape' in grid.parts[1]!).toBe(false);
  });

  it('sorts by key, x, y, rot first; the shape only breaks ties (none first, then SHAPE_IDS order)', () => {
    const a: TemplatePart = ['armor:1', 1, 0, 0];
    expect(compareTemplateParts(['armor:1', 0, 5, 3, 'nose2x1'], a)).toBeLessThan(0);
    expect(compareTemplateParts(['armor:1', 1, 0, 1, 'wedge'], a)).toBeGreaterThan(0);
    expect(compareTemplateParts(a, ['armor:1', 1, 0, 0, 'wedge'])).toBeLessThan(0);
    const shaped = SHAPE_IDS.map((s): TemplatePart => ['armor:1', 1, 0, 0, s]);
    expect([...shaped].reverse().sort(compareTemplateParts)).toEqual(shaped);
    expect(compareTemplateParts(['armor:1', 1, 0, 0, 'wedge'], ['armor:1', 1, 0, 0, 'wedge'])).toBe(0);
  });

  it('normalisation is idempotent, placement-invariant and keeps the shapes (property)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const ship = shapedRandomShip(seed);
      const t = normalizeTemplate(ship)!;
      expect(normalizeParts(t), `seed ${seed}`).toEqual(t);
      expect(normalizeTemplate(templateGrid(t)), `seed ${seed}`).toEqual(t);
      expect(normalizeTemplate(shifted(ship, -3, 2)), `seed ${seed}`).toEqual(t);
      expect(templateProblem(t), `seed ${seed}`).toBeNull();
      expect(t.filter((p) => p.length === 5)).toHaveLength(ship.parts.filter((p) => p.shape).length);
    }
  });

  it('isTemplatePart: a 5th element must be a known shape', () => {
    expect(isTemplatePart(['armor:1', 0, 0, 0, 'wedge'])).toBe(true);
    expect(isTemplatePart(['armor:1', 0, 0, 0, 'wingL'])).toBe(true);
    // the form only – whether the part may carry it is templateProblem's business
    expect(isTemplatePart(['cannon:1', 0, 0, 0, 'wedge'])).toBe(true);
    expect(isTemplatePart(['armor:1', 0, 0, 0, 'w'])).toBe(false);
    expect(isTemplatePart(['armor:1', 0, 0, 0, undefined])).toBe(false);
    expect(isTemplatePart(['armor:1', 0, 0, 0, 'wedge', 1])).toBe(false);
    expect(isTemplatePart(['armor:1', 0, 0, 0, '__proto__'])).toBe(false);
  });

  it('templateProblem: shapeNotAllowed, unknownShape and shape footprints', () => {
    expect(templateProblem([['cockpit:1', 0, 0, 0], ['cannon:1', 1, 0, 0, 'wedge']])).toBe('shapeNotAllowed');
    expect(templateProblem([['cockpit:1', 0, 0, 0, 'nose'], ['armor:1', 1, 0, 0]])).toBe('shapeNotAllowed');
    expect(templateProblem([['cockpit:1', 0, 0, 0], ['armor:1', 1, 0, 0, 'blob' as never]])).toBe('unknownShape');
    expect(templateProblem([['cockpit:1', 0, 0, 0], ['armor:2', 1, 0, 0, 'wingL']])).toBeNull();
    // a wing covers its second cell: overlap with the cockpit, connection over a gap
    expect(templateProblem([['cockpit:1', 0, 0, 0], ['armor:1', -1, 0, 0, 'wingR']])).toBe('overlap');
    expect(templateProblem([['cockpit:1', 0, 0, 0], ['armor:1', 1, 0, 0, 'nose2x1'], ['armor:1', 3, 0, 0]])).toBeNull();
    expect(templateProblem([['cockpit:1', 0, 0, 0], ['armor:1', 1, 0, 0, 'nose'], ['armor:1', 3, 0, 0]])).toBe('disconnected');
    // a wing rotated by 90° is 1×2
    expect(templateProblem([['cockpit:1', 0, 0, 0], ['armor:1', 0, 1, 1, 'wingL'], ['armor:1', 0, 3, 0]])).toBeNull();
    // bounds count the wing's second cell
    const line = (n: number): TemplatePart[] => [['cockpit:1', 0, 0, 0], ...Array.from({ length: n - 1 }, (_, i): TemplatePart => ['armor:1', i + 1, 0, 0])];
    expect(templateProblem([...line(13), ['armor:1', 13, 0, 0, 'wingL']])).toBeNull();
    expect(templateProblem([...line(14), ['armor:1', 14, 0, 0, 'wingL']])).toBe('outOfBounds');
  });
});
