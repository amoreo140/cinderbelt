import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND } from '../commands';
import { dockedSim } from '../station/testHarness';
import { toSave } from './serialize';
import { testContext } from './testing';
import type { SaveGame } from './types';
import { validateSave } from './validate';

/** A save with contracts, a board, a captain, a shipment and a journal. */
function richSave(): SaveGame {
  const sim = dockedSim();
  sim.step(IDLE_COMMAND);
  const board = sim.state.career.boards.get('home')!;
  sim.step({ ...IDLE_COMMAND, actions: [{ type: 'acceptContract', offerId: board.offers[0]!.id, reqId: 1 }] });
  const c = sim.state.career;
  c.captains.set(3, { promotions: 1, defeated: false, trophies: ['engine:1'], kills: 1 });
  c.engaged.set(3, 0.5);
  c.shipments.push({ id: 7, from: 'home', to: 'st:1,1', resources: { iron: 5 }, parts: { 'armor:1': 1 }, arrival: 500 });
  c.trophies.push({ captain: 2, parts: ['cannon:1'] });
  c.completed.delivery = 2;
  c.log.push({ tick: 3, kind: 'levelUp', faction: 'guild', level: 1 });
  return toSave(sim, testContext());
}

const errorsOf = (mutate: (s: SaveGame & Record<string, unknown>) => void): string[] => {
  const save = structuredClone(richSave()) as SaveGame & Record<string, unknown>;
  mutate(save);
  const r = validateSave(JSON.parse(JSON.stringify(save)));
  return r.ok ? [] : r.errors;
};

describe('career validation', () => {
  it('accepts a full career and returns the same data', () => {
    const save = richSave();
    const r = validateSave(JSON.parse(JSON.stringify(save)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.save.career).toEqual(save.career);
    expect(save.career.contracts).toHaveLength(1);
    expect(save.career.boards).toHaveLength(1);
  });

  it('rejects broken career data with a path', () => {
    expect(errorsOf((s) => delete (s as Record<string, unknown>).career)[0]).toMatch(/^career/);
    expect(errorsOf((s) => ((s.career.contracts[0] as { type: string }).type = 'piracy'))[0]).toMatch(/career\.contracts\[0\]\.type/);
    expect(errorsOf((s) => ((s.career.contracts[0]!.target as { kind: string }).kind = 'nope'))[0]).toMatch(/target\.kind/);
    expect(errorsOf((s) => (s.career.captains[0]![1].trophies = ['laser:9' as never]))[0]).toMatch(/trophies\[0\]/);
    expect(errorsOf((s) => (s.career.rep.guild.level = 7 as never))[0]).toMatch(/rep\.guild\.level/);
    expect(errorsOf((s) => (s.career.training.status = 'maybe' as never))[0]).toMatch(/training\.status/);
    expect(errorsOf((s) => (s.career.training = { ...s.career.training, status: 'active', sites: null }))[0]).toMatch(/training\.sites/);
    expect(errorsOf((s) => (s.career.shipments[0]!.resources = { gold: 1 } as never))[0]).toMatch(/shipments\[0\]\.resources\.gold/);
    expect(errorsOf((s) => (s.career.log = Array.from({ length: 50 }, () => ({ tick: 1, kind: 'died' as const }))))[0]).toMatch(/log/);
    expect(errorsOf((s) => (s.career.engaged = [[99, 0.5]]))[0]).toMatch(/engaged/);
  });
});
