import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../world/chunks';
import {
  REGION_GEN,
  chartThreshold,
  chartingData,
  knowledgeOf,
  newlyCharted,
  regionWorld,
  sectorChunkKeys,
  sectorCoverage,
  sectorInfo,
  sectorKnowledge,
  neighbours,
  ownChart,
  surveyDone,
  surveyPoints,
  trainingChartSector,
} from './index';
import { stepIndex } from '../../data/training';

const SEED = 1337;

/** The first finite sector of a depth with the given start knowledge. */
function sectorWith(seed: number, depth: number, start: string): string {
  const r = regionWorld(seed).regions.find((x) => x.seed.depth === depth && sectorInfo(seed, x.seed.id)!.startKnowledge === start);
  if (!r) throw new Error(`no depth-${depth} ${start} sector on seed ${seed}`);
  return r.seed.id;
}

describe('sector knowledge from explored chunks (stage 1b)', () => {
  it('a sector has exactly the chunks whose centre lies in it (no chunk left outside the scan)', () => {
    for (const seed of [1, 7, 42, 1337, 90210]) {
      const world = regionWorld(seed);
      for (const r of world.regions) {
        const keys = sectorChunkKeys(seed, r.seed.id);
        // a box of 1.5 spacings plus a margin around the seed holds the whole cell: compare against it
        const reach = Math.ceil((1.8 * r.seed.spacing + 400) / CHUNK_SIZE);
        const ccx = Math.floor(r.seed.x / CHUNK_SIZE);
        const ccy = Math.floor(r.seed.y / CHUNK_SIZE);
        let n = 0;
        for (let cx = ccx - reach; cx <= ccx + reach; cx++) {
          for (let cy = ccy - reach; cy <= ccy + reach; cy++) {
            if (world.field.regionOfChunk(cx, cy).id === r.seed.id) n++;
          }
        }
        expect(keys.length, `${seed} ${r.seed.id}`).toBe(n);
        // chunk area ≈ rastered area (±40 % – small cells, 200 u vs 100 u sampling)
        expect(keys.length * CHUNK_SIZE * CHUNK_SIZE).toBeGreaterThan(r.area * 0.6);
        expect(keys.length * CHUNK_SIZE * CHUNK_SIZE).toBeLessThan(r.area * 1.4 + 2 * CHUNK_SIZE * CHUNK_SIZE);
      }
    }
  });

  it('coverage counts the explored chunks of the sector and nothing else', () => {
    const id = sectorWith(SEED, 2, 'uncharted');
    const keys = sectorChunkKeys(SEED, id);
    const explored = new Set<string>(['0,0', '1,0', '9999,9999']);
    expect(sectorCoverage(SEED, explored, id)).toEqual({ explored: 0, total: keys.length, share: 0 });
    for (const k of keys.slice(0, 5)) explored.add(k);
    const c = sectorCoverage(SEED, explored, id);
    expect(c.explored).toBe(5);
    expect(c.share).toBeCloseTo(5 / keys.length, 10);
  });

  it('Uncharted and Reported sectors become Charted at 70 % of their chunks, never before', () => {
    for (const start of ['uncharted', 'reported'] as const) {
      const id = sectorWith(SEED, 2, start);
      const keys = sectorChunkKeys(SEED, id);
      const need = chartThreshold(keys.length);
      expect(need).toBe(Math.ceil(keys.length * REGION_GEN.charting.coverage - 1e-9));
      const explored = new Set<string>();
      for (const k of keys.slice(0, need - 1)) explored.add(k);
      expect(knowledgeOf(SEED, explored, id)).toBe(start);
      explored.add(keys[need - 1]!);
      expect(knowledgeOf(SEED, explored, id)).toBe('charted');
      expect(sectorKnowledge({ seed: SEED, world: { explored } }, id)).toBe('charted');
    }
  });

  it('start-Charted sectors stay Charted; unknown ids are Uncharted', () => {
    const origin = regionWorld(SEED).field.origin.id;
    expect(knowledgeOf(SEED, new Set(), origin)).toBe('charted');
    expect(knowledgeOf(SEED, new Set(), 'rg:B:nope')).toBe('uncharted');
  });

  it('the charting trigger fires once, on the chunk that crosses the threshold', () => {
    const id = sectorWith(SEED, 1, 'uncharted');
    const keys = sectorChunkKeys(SEED, id);
    const need = chartThreshold(keys.length);
    const explored = new Set<string>();
    const fired: string[][] = [];
    for (const k of keys) {
      explored.add(k);
      fired.push(newlyCharted(SEED, explored, [k]));
    }
    const hits = fired.map((f, i) => (f.includes(id) ? i : -1)).filter((i) => i >= 0);
    expect(hits).toEqual([need - 1]);
    // re-flying explored chunks never fires again (they are not fresh any more)
    expect(newlyCharted(SEED, explored, [])).toEqual([]);
    // a batch that jumps over the threshold fires once as well
    const batch = new Set<string>(keys);
    expect(newlyCharted(SEED, batch, [...keys])).toEqual([id]);
    // Origin never pays (Charted from the start)
    const origin = regionWorld(SEED).field.origin.id;
    const home = new Set(sectorChunkKeys(SEED, origin));
    expect(newlyCharted(SEED, home, [...home])).toEqual([]);
  });

  it('does not depend on the insertion order or on a fresh cache', () => {
    const id = sectorWith(SEED, 2, 'uncharted');
    const keys = sectorChunkKeys(SEED, id);
    const part = keys.slice(0, chartThreshold(keys.length));
    const a = new Set(part);
    const b = new Set([...part].reverse());
    expect(sectorCoverage(SEED, a, id)).toEqual(sectorCoverage(SEED, b, id));
    // growing set: the incremental count equals a recount
    const grow = new Set<string>();
    for (const k of keys) {
      grow.add(k);
      sectorCoverage(SEED, grow, id);
    }
    expect(sectorCoverage(SEED, grow, id).explored).toBe(keys.length);
    expect(sectorCoverage(SEED, new Set(grow), id).explored).toBe(keys.length);
  });

  it('flat Data by depth: 2 / 3 / 6 (the design 3 / 6 / 12 halved by §6.4), nothing for depth 4+', () => {
    expect([1, 2, 3, 4].map(chartingData)).toEqual([2, 3, 6, 0]);
  });
});

describe('sector knowledge – stage 2 (charts, survey points, training)', () => {
  const none = new Set<string>();
  const base = { seed: SEED, world: { explored: none } };

  it('lane A\'s first sector is withheld (Reported) while the training runs up to its checklist step', () => {
    const lane = trainingChartSector(SEED)!;
    expect(lane).not.toBeNull();
    expect(sectorInfo(SEED, lane)!.origin).toBe(false);
    const at = (status: 'active' | 'done' | 'skipped', step: number) => sectorKnowledge({ ...base, career: { training: { status, step } } }, lane);
    expect(at('active', 0)).toBe('reported');
    expect(at('active', stepIndex('checklist'))).toBe('reported');
    expect(at('active', stepIndex('checklist') + 1)).toBe('charted');
    expect(at('done', 9)).toBe('charted');
    expect(at('skipped', 0)).toBe('charted');
    expect(sectorKnowledge(base, lane)).toBe('charted');
    // Origin is never withheld
    expect(sectorKnowledge({ ...base, career: { training: { status: 'active', step: 0 } } }, regionWorld(SEED).field.origin.id)).toBe('charted');
  });

  it('a bought chart is Charted and makes its neighbours Reported; all survey points chart a sector', () => {
    const id = sectorWith(SEED, 2, 'uncharted');
    const bought = { points: new Map<string, number>(), bought: new Set([id]) };
    expect(sectorKnowledge({ ...base, regions: bought }, id)).toBe('charted');
    const field = regionWorld(SEED).field;
    for (const n of neighbours(field, field.seedById(id)!)) expect(sectorKnowledge({ ...base, regions: bought }, n.id)).not.toBe('uncharted');
    const n = surveyPoints(SEED, id).length;
    const partial = { points: new Map([[id, (1 << (n - 1)) - 1]]), bought: new Set<string>() };
    expect(sectorKnowledge({ ...base, regions: partial }, id)).toBe('uncharted');
    expect(surveyDone({ ...base, regions: partial }, id)).toBe(false);
    const full = { points: new Map([[id, (1 << n) - 1]]), bought: new Set<string>() };
    expect(sectorKnowledge({ ...base, regions: full }, id)).toBe('charted');
    expect(ownChart({ ...base, regions: full }, id)).toBe(true);
    expect(ownChart({ ...base, regions: bought }, id)).toBe(false);
  });
});
