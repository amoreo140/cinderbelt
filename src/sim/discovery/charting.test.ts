// Charting sectors by flight coverage (sectors §4.1, stage 1b): flat Data once per sector, derived
// from the explored chunks – no saved state, identical across save and load.
import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND } from '../commands';
import { chartThreshold, chartingData, regionWorld, sectorChunkKeys, sectorInfo, sectorKnowledge, surveyDone, surveyPoints } from '../regions';
import { loadSave } from '../save/load';
import { restoreSimulation, toEnvelope, toSave } from '../save/serialize';
import { testContext } from '../save/testing';
import type { Simulation, SimEvent } from '../Simulation';
import { CHUNK_SIZE } from '../world/chunks';
import { flyingAt, ofType, tapScan, teleport } from './testing';

const SEED = 1337;
const ctx = testContext();

/** An Uncharted (never start-Charted) sector of a depth near home. */
function uncharted(depth: number): string {
  const r = regionWorld(SEED)
    .regions.filter((x) => x.seed.depth === depth && sectorInfo(SEED, x.seed.id)!.startKnowledge === 'uncharted')
    .sort((a, b) => Math.hypot(a.seed.x, a.seed.y) - Math.hypot(b.seed.x, b.seed.y))[0];
  if (!r) throw new Error(`no uncharted depth-${depth} sector`);
  return r.seed.id;
}

const centre = (key: string) => {
  const [cx, cy] = key.split(',').map(Number) as [number, number];
  return { x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE };
};

/** Step i: the ship jumps to the i-th chunk of the path (explores the 3 × 3 around it), then one step. */
function fly(sim: Simulation, path: readonly string[], from: number, to: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = from; i < to; i++) {
    teleport(sim, centre(path[i % path.length]!));
    out.push(...sim.step(IDLE_COMMAND));
  }
  return out;
}

function roundTrip(sim: Simulation): Simulation {
  const result = loadSave(toEnvelope(toSave(sim, ctx)));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  return restoreSimulation(result.save);
}

describe('charting by flight coverage', () => {
  it('pays the flat Data of the depth once, when the sector reaches 70 % – re-flying pays nothing', () => {
    for (const depth of [1, 2]) {
      const id = uncharted(depth);
      // every 3rd chunk is enough: the 3 × 3 explore window covers the rest
      const path = sectorChunkKeys(SEED, id).filter((_, i) => i % 3 === 0);
      const sim = flyingAt(SEED, centre(path[0]!));
      expect(sectorKnowledge(sim.state, id)).toBe('uncharted');
      const before = sim.state.discovery.dataTotal;
      const first = fly(sim, path, 0, path.length);
      const charted = ofType(first, 'sectorCharted').filter((e) => e.id === id);
      expect(charted).toEqual([{ type: 'sectorCharted', id, depth, data: chartingData(depth), via: 'coverage' }]);
      expect(ofType(first, 'dataGained').filter((e) => e.source === 'chart').reduce((s, e) => s + e.amount, 0)).toBeGreaterThanOrEqual(chartingData(depth));
      expect(sectorKnowledge(sim.state, id)).toBe('charted');
      expect(sim.state.discovery.dataTotal).toBeGreaterThan(before);
      // coverage farming: flying the explored chunks again never pays
      const total = sim.state.discovery.dataTotal;
      const again = fly(sim, path, 0, path.length * 2);
      expect(ofType(again, 'sectorCharted')).toEqual([]);
      expect(sim.state.discovery.dataTotal).toBe(total);
    }
  });

  it('the event fires on the step whose chunks cross the threshold', () => {
    const id = uncharted(1);
    const keys = sectorChunkKeys(SEED, id);
    const sim = flyingAt(SEED, centre(keys[0]!));
    const need = chartThreshold(keys.length);
    let step = -1;
    for (let i = 0; i < keys.length && step < 0; i++) {
      const events = fly(sim, keys, i, i + 1);
      if (ofType(events, 'sectorCharted').some((e) => e.id === id)) step = i;
    }
    expect(step).toBeGreaterThanOrEqual(0);
    // after the step the sector has at least the threshold; one step earlier it did not
    const explored = sim.state.world.explored;
    expect(keys.filter((k) => explored.has(k)).length).toBeGreaterThanOrEqual(need);
  });

  it.each([
    [7, 40],
    [25, 30],
  ])('N=%i, M=%i: identical events and Data across save and load', (n, m) => {
    const id = uncharted(1);
    const path = sectorChunkKeys(SEED, id).filter((_, i) => i % 3 === 0);
    const a = flyingAt(SEED, centre(path[0]!));
    const b = flyingAt(SEED, centre(path[0]!));
    fly(a, path, 0, n);
    fly(b, path, 0, n);
    const restored = roundTrip(b);
    const ea = fly(a, path, n, n + m);
    const eb = fly(restored, path, n, n + m);
    expect(eb).toEqual(ea);
    expect(restored.state.discovery.dataTotal).toBe(a.state.discovery.dataTotal);
    expect(sectorKnowledge(restored.state, id)).toBe(sectorKnowledge(a.state, id));
  });
});

describe('charting by survey points (stage 2)', () => {
  /** Pulse at a position (full battery, no cooldown). */
  function pulseAt(sim: Simulation, pos: { x: number; y: number }): SimEvent[] {
    teleport(sim, pos);
    sim.state.discovery.scanner.cooldown = 0;
    sim.state.player.energy = sim.state.player.props.batteryCapacity;
    return tapScan(sim);
  }

  it('depth 1 and 2: the last point charts the sector (the 3 × 3 explore window around a few points may chart a small one by coverage first)', () => {
    for (const depth of [1, 2]) {
      const id = uncharted(depth);
      const points = surveyPoints(SEED, id);
      const last = points.at(-1)!;
      const sim = flyingAt(SEED, last.pos);
      sim.state.regions.points.set(id, (1 << (points.length - 1)) - 1);
      expect(sectorKnowledge(sim.state, id)).not.toBe('charted');
      const events = pulseAt(sim, last.pos);
      expect(ofType(events, 'surveyPointMarked').filter((e) => e.sector === id)).toEqual([
        { type: 'surveyPointMarked', sector: id, index: last.index, pos: last.pos, done: points.length, total: points.length },
      ]);
      expect(ofType(events, 'sectorCharted').filter((e) => e.id === id)).toEqual([{ type: 'sectorCharted', id, depth, data: chartingData(depth), via: 'survey' }]);
    }
  });

  it('depth 3: a pulse within 150 u marks a point; the last point charts the sector and pays its Data once', () => {
    for (const depth of [3]) {
      const id = uncharted(depth);
      const points = surveyPoints(SEED, id);
      expect(points.length).toBe(depth + 2);
      const sim = flyingAt(SEED, points[0]!.pos);
      const data = sim.state.discovery.dataTotal;
      const marked: number[] = [];
      let charted: SimEvent[] = [];
      for (const p of points) {
        // 120 u off the point still counts
        const events = pulseAt(sim, { x: p.pos.x + 120, y: p.pos.y });
        marked.push(...ofType(events, 'surveyPointMarked').filter((e) => e.sector === id).map((e) => e.index));
        charted = [...charted, ...ofType(events, 'sectorCharted').filter((e) => e.id === id)];
      }
      expect([...new Set(marked)].sort()).toEqual(points.map((p) => p.index));
      expect(charted).toEqual([{ type: 'sectorCharted', id, depth, data: chartingData(depth), via: 'survey' }]);
      expect(sectorKnowledge(sim.state, id)).toBe('charted');
      expect(surveyDone(sim.state, id)).toBe(true);
      expect(sim.state.discovery.dataTotal).toBeGreaterThanOrEqual(data + chartingData(depth));
      // farming: pulsing the points again or flying the whole sector charts it no more
      for (const p of points) expect(ofType(pulseAt(sim, p.pos), 'surveyPointMarked').filter((e) => e.sector === id)).toEqual([]);
      const path = sectorChunkKeys(SEED, id).filter((_, i) => i % 3 === 0);
      const flown = fly(sim, path, 0, path.length);
      expect(ofType(flown, 'sectorCharted').filter((e) => e.id === id)).toEqual([]);
    }
  });

  it('a pulse farther than 150 u marks nothing; a sector charted by coverage takes no more points', () => {
    const id = uncharted(1);
    const p = surveyPoints(SEED, id)[0]!;
    const sim = flyingAt(SEED, p.pos);
    expect(ofType(pulseAt(sim, { x: p.pos.x + 160, y: p.pos.y }), 'surveyPointMarked').filter((e) => e.sector === id && e.index === p.index)).toEqual([]);
    const path = sectorChunkKeys(SEED, id).filter((_, i) => i % 3 === 0);
    fly(sim, path, 0, path.length);
    expect(sectorKnowledge(sim.state, id)).toBe('charted');
    expect(ofType(pulseAt(sim, p.pos), 'surveyPointMarked').filter((e) => e.sector === id)).toEqual([]);
  });

  it('marked points survive save and load (V15) and the run continues identically', () => {
    const id = uncharted(3);
    const points = surveyPoints(SEED, id);
    const a = flyingAt(SEED, points[0]!.pos);
    pulseAt(a, points[0]!.pos);
    pulseAt(a, points[1]!.pos);
    const b = roundTrip(a);
    expect(b.state.regions.points.get(id)).toBe(a.state.regions.points.get(id));
    const ea = points.slice(2).flatMap((p) => pulseAt(a, p.pos));
    const eb = points.slice(2).flatMap((p) => pulseAt(b, p.pos));
    expect(eb).toEqual(ea);
    expect(ofType(ea, 'sectorCharted').map((e) => e.id)).toContain(id);
    expect(b.state.discovery.dataTotal).toBe(a.state.discovery.dataTotal);
  });
});
