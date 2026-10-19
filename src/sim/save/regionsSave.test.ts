// Save V15 (sectors stage 2): the region generator id and the sector charts – migration 14 → 15,
// validation, round trip and determinism across save and load.
import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND, type GameAction, type GameActionInput } from '../commands';
import { chartTrade, firstChartTarget } from '../charts/charts';
import { fnv1aHex } from '../math/fnv1a';
import { regionWorld, sectorChunkKeys, sectorInfo, sectorKnowledge, surveyPoints } from '../regions';
import { Simulation, type SimEvent } from '../Simulation';
import { loadSave } from './load';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { downgradeToV14, testContext } from './testing';
import type { SaveEnvelope } from './types';

const SEED = 1337;
let req = 0;
const act = (sim: Simulation, a: GameActionInput): SimEvent[] => sim.step({ ...IDLE_COMMAND, actions: [{ ...a, reqId: ++req } as GameAction] });

function envelopeOf(data: { version: number }): SaveEnvelope {
  const text = JSON.stringify(data);
  return { format: 'cinderbelt-save', version: data.version, checksum: fnv1aHex(text), data: text };
}

function roundTrip(sim: Simulation): Simulation {
  const result = loadSave(toEnvelope(toSave(sim, testContext())));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  return restoreSimulation(result.save);
}

/** A game with a marked survey point, a sold chart and a bought one. */
function chartedGame(): Simulation {
  const sim = new Simulation({ seed: SEED });
  sim.state.credits = 20_000;
  const own = firstChartTarget(sim.state)!.id;
  for (const k of sectorChunkKeys(SEED, own)) sim.state.world.explored.add(k);
  act(sim, { type: 'chartSell', sector: own });
  const guild = regionWorld(SEED).regions.find((r) => chartTrade(SEED, r.seed.id) === 'guild' && sectorKnowledge(sim.state, r.seed.id) !== 'charted')!.seed.id;
  act(sim, { type: 'chartBuy', sector: guild });
  const deep = regionWorld(SEED).regions.find((r) => r.seed.depth === 3 && surveyPoints(SEED, r.seed.id).length === 5)!.seed.id;
  sim.state.regions.points.set(deep, 0b101);
  expect(sim.state.regions.sold.size).toBe(1);
  expect(sim.state.regions.bought.size).toBe(1);
  return sim;
}

describe('save V15 – sector charts', () => {
  it('a new game saves generator 1 and empty charts', () => {
    const save = toSave(new Simulation({ seed: SEED }), testContext());
    expect(save.version).toBe(20);
    expect(save.regions).toEqual({ gen: 1, points: [], bought: [], sold: [], cooldowns: [] });
  });

  it('charts survive save and load and the save is canonical', () => {
    const sim = chartedGame();
    const save = toSave(sim, testContext());
    const loaded = roundTrip(sim);
    expect(loaded.state.regions).toEqual(sim.state.regions);
    expect(toSave(loaded, testContext())).toEqual(save);
    for (const r of regionWorld(SEED).regions) expect(sectorKnowledge(loaded.state, r.seed.id)).toBe(sectorKnowledge(sim.state, r.seed.id));
  });

  it('a sold chart stays sold after loading – no second sale through a save copy', () => {
    const sim = chartedGame();
    const sold = [...sim.state.regions.sold][0]!;
    const copy = roundTrip(sim);
    const events = act(copy, { type: 'chartSell', sector: sold });
    expect(events.find((e) => e.type === 'actionResult')).toMatchObject({ ok: false, reason: 'chartSold' });
  });

  it('migration 14 → 15: generator 1, nothing surveyed, bought or sold; coverage charts stay Charted and sellable', () => {
    const sim = new Simulation({ seed: SEED });
    const own = firstChartTarget(sim.state)!.id;
    for (const k of sectorChunkKeys(SEED, own)) sim.state.world.explored.add(k);
    const current = toSave(sim, testContext());
    const old = downgradeToV14(current);
    expect(old.version).toBe(14);
    expect('regions' in old).toBe(false);
    const result = loadSave(toEnvelope(old));
    expect(result).toMatchObject({ ok: true, fromVersion: 14 });
    if (!result.ok) return;
    expect(result.save).toEqual(current);
    const loaded = restoreSimulation(result.save);
    expect(sectorKnowledge(loaded.state, own)).toBe('charted');
    expect(act(loaded, { type: 'chartSell', sector: own }).find((e) => e.type === 'actionResult')).toMatchObject({ ok: true });
  });

  it('rejects an unknown generator, a foreign sector id and survey bits outside the sector', () => {
    const base = toSave(chartedGame(), testContext());
    const deep = base.regions.points[0]![0];
    const bad = [
      { ...base, regions: { ...base.regions, gen: 2 } },
      { ...base, regions: { ...base.regions, sold: ['rg:A:1,1'] } },
      { ...base, regions: { ...base.regions, bought: ['nope'] } },
      { ...base, regions: { ...base.regions, points: [[deep, 1 << 7]] } },
      { ...base, regions: { ...base.regions, points: [[deep, 0]] } },
    ];
    for (const save of bad) expect(loadSave(envelopeOf(save))).toMatchObject({ ok: false, error: 'invalid' });
    // a valid one passes
    expect(loadSave(envelopeOf(base)).ok).toBe(true);
    expect(sectorInfo(SEED, deep)).not.toBeNull();
  });
});
