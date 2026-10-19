// AF2 template codes (SL2 E2 S7, spec §6.3): templates with
// shaped armour. Since the rename to Cinderbelt the game writes this payload under the CB2 prefix; AF2 codes are
// still read (golden.test.ts keeps the old AF1 codes).
import { describe, expect, it } from 'vitest';
import { TEMPLATE_CODE_MAX } from '../../data/fleet';
import { ALL_PART_KEYS, parsePartKey, type PartKey } from '../../data/parts';
import { SHAPE_IDS, SHAPES, SHAPEABLE_PARTS, type ShapeId } from '../../data/shapes';
import { createRng } from '../math/rng';
import { partCells } from '../ship/grid';
import { base64UrlDecode, base64UrlEncode, decodeTemplate, encodeTemplate, templateChecksum } from './codec';
import { normalizeParts, normalizeTemplate, templateGrid, templateProblem } from './normalize';
import { shapedRandomShip, SPEC_SHIPS_E2 } from './testShips';
import type { ShipTemplate, TemplatePart } from './types';

/** An AF2 code with any payload (correct checksum). */
function af2Of(data: unknown): string {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(data)));
  return `AF2.${payload}.${templateChecksum(payload)}`;
}
const err = (code: unknown) => {
  const r = decodeTemplate(code);
  return r.ok ? 'ok' : r.error;
};
const payloadOf = (code: string): unknown => JSON.parse(new TextDecoder().decode(base64UrlDecode(code.split('.')[1]!)!));

describe('AF2 / CB2 encode / decode', () => {
  for (const [id, build] of Object.entries(SPEC_SHIPS_E2)) {
    it(`ship ${id} after E2: AF2 round trip, shapes kept, stable re-encode`, () => {
      const grid = build();
      const t: ShipTemplate = { name: `Loď ${id}`, parts: normalizeTemplate(grid)! };
      expect(templateProblem(t.parts)).toBeNull();
      const code = encodeTemplate(t);
      expect(code).toMatch(/^CB2\.[A-Za-z0-9_-]+\.[0-9a-f]{4}$/);
      expect(code.length).toBeLessThanOrEqual(TEMPLATE_CODE_MAX);
      const r = decodeTemplate(code);
      expect(r).toEqual({ ok: true, template: t });
      expect(encodeTemplate((r as { template: ShipTemplate }).template)).toBe(code);
      // the decoded template builds the same shaped ship (shapes per cell)
      const shapesOf = (g: typeof grid) => g.parts.filter((p) => p.shape).map((p) => [p.shape, p.rot, ...partCells(p).map((c) => `${c.x - g.parts.find((q) => q.partId === 'cockpit')!.x},${c.y - g.parts.find((q) => q.partId === 'cockpit')!.y}`)].join(' ')).sort();
      expect(shapesOf(templateGrid(t.parts))).toEqual(shapesOf(grid));
    });
  }

  it('the AF2 payload: v 2, a key dictionary in first-use order, index tuples, shape codes only on shaped parts', () => {
    const t: ShipTemplate = { name: 'Kosa', parts: normalizeTemplate(SPEC_SHIPS_E2.A())! };
    const data = payloadOf(encodeTemplate(t)) as { v: number; n: string; k: PartKey[]; p: (string | number)[][] };
    expect(Object.keys(data)).toEqual(['v', 'n', 'k', 'p']);
    expect(data.v).toBe(2);
    expect(data.n).toBe('Kosa');
    expect(data.k).toEqual([...new Set(t.parts.map((p) => p[0]))]);
    expect(data.p).toHaveLength(t.parts.length);
    for (const [i, part] of t.parts.entries()) {
      const tuple = data.p[i]!;
      expect(data.k[tuple[0] as number]).toBe(part[0]);
      expect(tuple.slice(1, 4)).toEqual(part.slice(1, 4));
      if (part[4] === undefined) expect(tuple).toHaveLength(4);
      else expect(tuple[4]).toBe(SHAPES[part[4]].code);
    }
    expect(data.p.filter((tp) => tp.length === 5).map((tp) => tp[4]).sort()).toEqual(['a', 'a', 'n', 'wl', 'wr']);
  });

  it('every shape code round-trips', () => {
    for (const shape of SHAPE_IDS) {
      for (const rot of [0, 1, 2, 3] as const) {
        const parts = normalizeParts([['cockpit:1', 0, 0, 0], ['armor:2', -1, 0, rot, shape]])!;
        // a 2×1 shape at rot 0 / 1 reaches into the cockpit's cell from (−1, 0) – lay it on the other side then
        const fixed = templateProblem(parts) === null ? parts : normalizeParts([['cockpit:1', 0, 0, 0], ['armor:2', 1, 0, rot, shape]])!;
        expect(templateProblem(fixed), `${shape} ${rot}`).toBeNull();
        const t: ShipTemplate = { name: shape, parts: fixed };
        expect(decodeTemplate(encodeTemplate(t)), `${shape} ${rot}`).toEqual({ ok: true, template: t });
      }
    }
  });

  it('round-trips random shaped ships (property); unshaped ones are CB2 too', () => {
    let af2 = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const parts = normalizeTemplate(shapedRandomShip(seed, 1 + (seed % 60)))!;
      const t: ShipTemplate = { name: `Tvar ${seed}`, parts };
      const code = encodeTemplate(t);
      const shaped = parts.some((p) => p.length === 5);
      expect(code.startsWith('CB2.'), `seed ${seed}`).toBe(true);
      if (shaped) af2++;
      expect(code.length, `seed ${seed}`).toBeLessThanOrEqual(TEMPLATE_CODE_MAX);
      expect(decodeTemplate(code), `seed ${seed}`).toEqual({ ok: true, template: t });
      expect(encodeTemplate((decodeTemplate(code) as { template: ShipTemplate }).template)).toBe(code);
    }
    expect(af2).toBeGreaterThan(60);
  });

  it('a legacy AF2 code decodes to the same template as its CB2 twin', () => {
    const data = { v: 2, n: 'A', k: ['cockpit:1', 'armor:1'], p: [[0, 0, 0, 0], [1, 1, 0, 0, 'w']] };
    const legacy = decodeTemplate(af2Of(data));
    expect(legacy.ok).toBe(true);
    expect(decodeTemplate(af2Of(data).replace('AF2.', 'CB2.'))).toEqual(legacy);
  });

  it('an AF2 code without shapes is read; it re-encodes as CB2', () => {
    const r = decodeTemplate(af2Of({ v: 2, n: 'A', k: ['engine:1', 'cockpit:1'], p: [[0, 4, 5, 0], [1, 5, 5, 0]] }));
    expect(r).toEqual({ ok: true, template: { name: 'A', parts: [['cockpit:1', 0, 0, 0], ['engine:1', -1, 0, 0]] } });
    expect(encodeTemplate((r as { template: ShipTemplate }).template)).toMatch(/^CB2\./);
  });

  it('a T4-size ship with shapes fits under TEMPLATE_CODE_MAX (6 144)', () => {
    expect(TEMPLATE_CODE_MAX).toBe(6144);
    // the whole 15 × 15 hangar (225 parts, the TEMPLATE_MAX_PARTS cap), cockpit in the middle so every
    // other coordinate is up to two characters: 170 half-point shaped plates (wedge / half / nose, both
    // armour tiers) + 54 full parts of the longest 1×1 keys – 170 × ½ + 54 = 139 pts, within the T4 budget (140 pts)
    const long = ALL_PART_KEYS.filter((k) => parsePartKey(k).partId !== 'cockpit' && parsePartKey(k).partId !== 'armor')
      .filter((k) => templateGrid([[k, 0, 0, 0]]).parts.every((p) => partCells(p).length === 1))
      .sort((a, b) => b.length - a.length);
    const halfShapes: ShapeId[] = ['wedge', 'half', 'nose'];
    const armour = ['armor:1', 'armor:2'] as PartKey[];
    const parts: TemplatePart[] = [];
    let i = 0;
    for (let x = -7; x <= 7; x++) {
      for (let y = -7; y <= 7; y++) {
        if (x === 0 && y === 0) parts.push(['cockpit:2:combat', 0, 0, 0]);
        else if (i++ < 170) parts.push([armour[i % 2]!, x, y, 3, halfShapes[i % 3]!]);
        else parts.push([long[i % long.length]!, x, y, 3]);
      }
    }
    expect(parts).toHaveLength(225);
    const t: ShipTemplate = { name: 'Ž'.repeat(24), parts: normalizeParts(parts)! };
    expect(templateProblem(t.parts)).toBeNull();
    const code = encodeTemplate(t);
    expect(code.length).toBeLessThanOrEqual(TEMPLATE_CODE_MAX);
    expect(decodeTemplate(code)).toEqual({ ok: true, template: t });
  });
});

describe('AF2 decode errors', () => {
  const good = { v: 2, n: 'A', k: ['cockpit:1', 'armor:1', 'cannon:1'], p: [[0, 0, 0, 0], [1, 1, 0, 0, 'w']] };

  it('accepts the hand-made good code', () => {
    expect(decodeTemplate(af2Of(good))).toEqual({ ok: true, template: { name: 'A', parts: [['armor:1', 1, 0, 0, 'wedge'], ['cockpit:1', 0, 0, 0]] } });
  });

  it('prefix / checksum / format of the AF2 frame work like AF1', () => {
    const code = af2Of(good);
    expect(err(code.slice(0, -1))).toBe('checksum');
    expect(err(code.slice(0, -5))).toBe('checksum');
    expect(err('AF2.')).toBe('format');
    expect(err('AF2..0000')).toBe('format');
    expect(err(code.slice(0, 10) + '+' + code.slice(11))).toBe('format');
    expect(err(code.replace('AF2.', 'AF22.'))).toBe('prefix');
  });

  it('version: v other than 2, an AF2 payload behind AF1, a superstructure key t', () => {
    expect(err(af2Of({ ...good, v: 1 }))).toBe('version');
    expect(err(af2Of({ ...good, v: 3 }))).toBe('version');
    expect(err(af2Of({ ...good, v: undefined }))).toBe('format');
    expect(err(af2Of(good).replace('AF2.', 'AF1.'))).toBe('version');
    expect(err(af2Of({ ...good, t: [[2, 0, 0, 0]] }))).toBe('version');
    expect(err(af2Of({ ...good, t: [] }))).toBe('version');
    expect(err(af2Of({ ...good, t: null }))).toBe('version');
  });

  it('name comes before the parts', () => {
    expect(err(af2Of({ ...good, n: ' ', k: 'x' }))).toBe('name');
  });

  it('format: a broken dictionary, index out of range, malformed tuples', () => {
    expect(err(af2Of({ ...good, k: undefined }))).toBe('format');
    expect(err(af2Of({ ...good, k: 'cockpit:1' }))).toBe('format');
    expect(err(af2Of({ ...good, k: ['cockpit:1', 7] }))).toBe('format');
    // a duplicate key in the dictionary
    expect(err(af2Of({ ...good, k: ['cockpit:1', 'armor:1', 'armor:1'] }))).toBe('format');
    // index out of range, negative, not an integer, a key instead of an index
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0], [3, 1, 0, 0]] }))).toBe('format');
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0], [-1, 1, 0, 0]] }))).toBe('format');
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0], [1.5, 1, 0, 0]] }))).toBe('format');
    expect(err(af2Of({ ...good, p: [['cockpit:1', 0, 0, 0]] }))).toBe('format');
    expect(err(af2Of({ ...good, p: [] }))).toBe('format');
    expect(err(af2Of({ ...good, p: [[0, 0, 0]] }))).toBe('format');
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0, 'w', 1]] }))).toBe('format');
    expect(err(af2Of({ ...good, p: [[0, 0.5, 0, 0]] }))).toBe('format');
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 4]] }))).toBe('format');
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0], [1, 1, 0, 0, 7]] }))).toBe('format');
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0], [1, 1, 0, 0, null]] }))).toBe('format');
    expect(err(af2Of({ ...good, p: [null] }))).toBe('format');
  });

  it('unknownPart: an unknown key in the dictionary', () => {
    expect(err(af2Of({ ...good, k: ['cockpit:1', 'armor:9'] }))).toBe('unknownPart');
    expect(err(af2Of({ ...good, k: ['cockpit:1', 'armor:1', '__proto__'] }))).toBe('unknownPart');
  });

  it('unknownShape: a shape code the game does not know', () => {
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0], [1, 1, 0, 0, 'x']] }))).toBe('unknownShape');
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0], [1, 1, 0, 0, 'wedge']] }))).toBe('unknownShape');
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0], [1, 1, 0, 0, '']] }))).toBe('unknownShape');
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0], [1, 1, 0, 0, 'W']] }))).toBe('unknownShape');
  });

  it('shapeNotAllowed: a shape on a part that cannot have one (a cannon, the cockpit)', () => {
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0], [2, 1, 0, 0, 'w']] }))).toBe('shapeNotAllowed');
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0, 'n'], [1, 1, 0, 0]] }))).toBe('shapeNotAllowed');
    expect(SHAPEABLE_PARTS.has('cannon')).toBe(false);
  });

  it('cockpits, overlap, bounds and connectivity use the shape footprints', () => {
    expect(err(af2Of({ ...good, p: [[1, 1, 0, 0, 'w']] }))).toBe('noCockpit');
    expect(err(af2Of({ ...good, k: ['cockpit:1', 'cockpit:2'], p: [[0, 0, 0, 0], [1, 1, 0, 0]] }))).toBe('manyCockpits');
    // a wing at (−1, 0) rot 0 covers (−1, 0) and (0, 0) – the cockpit's cell
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0], [1, -1, 0, 0, 'wl']] }))).toBe('overlap');
    // a 13-cell armour line + a wing at its end: 15 cells fit, 16 do not
    const line = (n: number) => [[0, 0, 0, 0], ...Array.from({ length: n }, (_, i) => [1, i + 1, 0, 0])];
    expect(err(af2Of({ ...good, p: [...line(12), [1, 13, 0, 0, 'wr']] }))).toBe('ok');
    expect(err(af2Of({ ...good, p: [...line(13), [1, 14, 0, 0, 'wr']] }))).toBe('outOfBounds');
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0], [1, 2, 0, 0, 'w']] }))).toBe('invalidDesign');
    // a wing's second cell connects what its first cell alone would not
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0], [1, 1, 0, 0, 'wl'], [1, 3, 0, 0]] }))).toBe('ok');
    expect(err(af2Of({ ...good, p: [[0, 0, 0, 0], [1, 1, 0, 0, 'w'], [1, 3, 0, 0]] }))).toBe('invalidDesign');
  });
});

describe('AF2 fuzz', () => {
  const ALPHABET = 'AF2.abcdefABCDEF0123456789-_+/= \n{}[]":,.wlrn\u0000';

  it('never throws on mutated AF2 codes; anything accepted is a valid normalised template', () => {
    const rng = createRng(77);
    const int = (n: number) => Math.floor(rng() * n);
    const base = [
      ...Object.values(SPEC_SHIPS_E2).map((b, i) => encodeTemplate({ name: `S${i}`, parts: normalizeTemplate(b())! })),
      ...Array.from({ length: 20 }, (_, i) => encodeTemplate({ name: `F${i}`, parts: normalizeTemplate(shapedRandomShip(700 + i))! })),
    ];
    for (let i = 0; i < 4000; i++) {
      const chars = [...base[int(base.length)]!];
      for (let k = 1 + int(3); k > 0; k--) {
        const at = int(chars.length);
        const op = int(3);
        if (op === 0) chars[at] = ALPHABET[int(ALPHABET.length)]!;
        else if (op === 1) chars.splice(at, 1);
        else chars.splice(at, 0, ALPHABET[int(ALPHABET.length)]!);
      }
      const s = chars.join('');
      let r: ReturnType<typeof decodeTemplate> | undefined;
      expect(() => (r = decodeTemplate(s)), s).not.toThrow();
      if (r!.ok) {
        expect(templateProblem(r!.template.parts)).toBeNull();
        expect(normalizeParts(r!.template.parts)).toEqual(r!.template.parts);
      }
    }
  });

  it('valid JSON of the wrong shapes behind a correct AF2 checksum never throws', () => {
    const shapes: unknown[] = [
      { v: 2, n: 'A', k: [['cockpit:1']], p: [[0, 0, 0, 0]] },
      { v: 2, n: 'A', k: { 0: 'cockpit:1', length: 1 }, p: [[0, 0, 0, 0]] },
      { v: 2, n: 'A', k: ['cockpit:1'], p: [{ 0: 0, 1: 0, 2: 0, 3: 0, length: 4 }] },
      { v: 2, n: 'A', k: ['cockpit:1'], p: [[0, 0, 0, 0, { toString: 1 }]] },
      { v: 2, n: 'A', k: ['cockpit:1'], p: [[0, 0, 0, 0, '__proto__']] },
      { v: 2, n: 'A', k: ['cockpit:1'], p: [['length', 0, 0, 0]] },
      { v: 2, n: 'A', k: ['cockpit:1', 'armor:1'], p: Array.from({ length: 300 }, () => [1, 0, 0, 0, 'n2']) },
      { v: 2, n: 'A', k: ['cockpit:1'], p: [[0, 1e308, -1e308, 0]] },
    ];
    for (const s of shapes) expect(() => decodeTemplate(af2Of(s))).not.toThrow();
    expect(err(af2Of(shapes[0]))).toBe('format');
    expect(err(af2Of(shapes[3]))).toBe('format');
    expect(err(af2Of(shapes[4]))).toBe('unknownShape');
    expect(err(af2Of(shapes[5]))).toBe('format');
  });
});
