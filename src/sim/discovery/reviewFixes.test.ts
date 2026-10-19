// Second code review (M3.5a fairness): wreck POI generation, contents and scan rewards.
import { describe, expect, it } from 'vitest';
import { DATA_REWARDS } from '../../data/poi';
import { components } from '../combat/damage';
import { createWreck, emptyLoot } from '../combat/wrecks';
import { createGrid } from '../ship/grid';
import { completeAnalysis } from './scanner';
import { flyingAt, findPoi, ofType, run, teleport } from './testing';
import { poisInChunk, type WreckPoi } from './poi';
import { resolveContents, wreckGrid } from './wrecks';
import { SCANNER } from '../../data/scanner';

const SEED = 4242;

function wreckPois(seed: number, r = 20): WreckPoi[] {
  const out: WreckPoi[] = [];
  for (let cx = -r; cx < r; cx++) for (let cy = -r; cy < r; cy++) for (const p of poisInChunk(seed, cx, cy)) if (p.kind === 'wreck') out.push(p);
  return out;
}

describe('wreck POIs', () => {
  it('I12: every wreck is one connected piece with its cockpit (no hulk made of joints)', () => {
    const pois = wreckPois(SEED);
    expect(pois.length).toBeGreaterThan(20);
    for (const poi of pois) {
      const grid = wreckGrid(poi);
      expect(components(grid.parts), poi.id).toHaveLength(1);
      expect(grid.parts.some((p) => p.partId === 'cockpit'), poi.id).toBe(true);
    }
  });

  it('I10: a wreck POI holds the same fragment after a despawn – it cannot be re-rolled, the pity counter moves once', () => {
    let misses = 0;
    for (const poi of wreckPois(SEED).filter((p) => p.cls !== undefined)) {
      const sim = flyingAt(SEED, { x: 0, y: 400 });
      const w = createWreck(-5, wreckGrid(poi).parts, { body: { pos: poi.pos, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 }, props: { centerOfMass: { x: 0, y: 0 } } }, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'default');
      w.poi = poi.id;
      w.cls = poi.cls;
      const first = resolveContents(sim.state, w, true).fragment;
      const pity = sim.state.discovery.pity.get(poi.cls!) ?? 0;
      expect(pity).toBe(first === null ? 1 : 0);
      if (first === null) misses++;
      for (let i = 0; i < 8; i++) {
        // respawned: no contents yet, rolled again (not the first roll) – the same result, no pity step
        delete w.contents;
        expect(resolveContents(sim.state, w, false).fragment, poi.id).toBe(first);
      }
      expect(sim.state.discovery.pity.get(poi.cls!) ?? 0).toBe(pity);
    }
    expect(misses).toBeGreaterThan(0);
  });

  it('I10: an analysed wreck POI shows its contents again after flying away and back', () => {
    const poi = findPoi(SEED, 'wreck', (p) => p.size === 0 && p.cls !== undefined);
    const sim = flyingAt(SEED, { x: poi.pos.x + 60, y: poi.pos.y });
    run(sim, SCANNER.discoverInterval + 1);
    const w = sim.state.combat.wrecks.find((x) => x.poi === poi.id)!;
    completeAnalysis(sim.state, { key: poi.id, kind: 'wreck', pos: w.body.pos, radius: 1, wreck: w }, []);
    const contents = structuredClone(w.contents);
    expect(contents).toBeDefined();
    teleport(sim, { x: poi.pos.x + 2500, y: poi.pos.y });
    run(sim, SCANNER.discoverInterval + 1);
    teleport(sim, { x: poi.pos.x + 60, y: poi.pos.y });
    run(sim, SCANNER.discoverInterval + 1);
    const again = sim.state.combat.wrecks.find((x) => x.poi === poi.id)!;
    expect(again).not.toBe(w);
    expect(again.contents).toEqual(contents);
  });
});

describe('scan rewards', () => {
  it('I13: debris (own ship pieces, pirate scraps) pays no Data on the first scan; a POI or loot wreck does', () => {
    const sim = flyingAt(SEED, { x: 0, y: 400 });
    const source = { body: { pos: { x: 0, y: 400 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 }, props: { centerOfMass: { x: 0, y: 0 } } };
    const still = { vel: { x: 0, y: 0 }, angVel: 0 };
    const debris = createWreck(50, createGrid([['armor', 0, 0]]).parts, source, still, emptyLoot(), 'default');
    const loot = createWreck(51, createGrid([['cockpit', 0, 0]]).parts, source, still, emptyLoot(), 'pirate');
    loot.cls = 'pirate';
    const scan = (w: typeof debris) => {
      const events: Parameters<typeof completeAnalysis>[2] = [];
      completeAnalysis(sim.state, { key: `wreck#${w.id}`, kind: 'wreck', pos: w.body.pos, radius: 1, wreck: w }, events);
      return ofType(events, 'analysisDone')[0]!;
    };
    expect(scan(debris)).toMatchObject({ first: true, data: 0 });
    expect(scan(loot)).toMatchObject({ first: true, data: DATA_REWARDS.wreck });
  });
});
