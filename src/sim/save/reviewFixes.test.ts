// Second code review (M3.5a fairness): load warnings for old ships, paid tolls in the save (V11).
import { describe, expect, it } from 'vitest';
import { createGrid } from '../ship/grid';
import { dockedSim } from '../station/testHarness';
import { EXHAUST_BURN_VERSION, loadSave } from './load';
import { migrate } from './migrations';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { downgradeToV10, downgradeToV8, legacyWorldSave, testContext } from './testing';

/** A ship whose forward engine blows into a hold behind it. */
const covered = () =>
  createGrid([
    ['cockpit', 1, 0],
    ['engine', 0, 0, 0],
    ['cargo', -1, 0],
    ['engine', 1, 1, 3],
  ]);

describe('I15: covered nozzles of an old ship', () => {
  it('a save from before exhaust burns warns that the covered part now burns', () => {
    const old = downgradeToV8(toSave(dockedSim(covered()), testContext()));
    expect(old.version).toBeLessThan(EXHAUST_BURN_VERSION);
    const result = loadSave(toEnvelope(old));
    expect(result).toMatchObject({ ok: true, warnings: [{ code: 'coveredNozzleLegacy', engines: 1 }] });
  });

  it('no warning for an old ship without covered nozzles, nor for a current save (the shipyard warned already)', () => {
    expect(loadSave(toEnvelope(downgradeToV8(toSave(dockedSim(), testContext()))))).toMatchObject({ ok: true, warnings: [] });
    expect(loadSave(toEnvelope(toSave(dockedSim(covered()), testContext())))).toMatchObject({ ok: true, warnings: [] });
  });
});

describe('migration 10 → 11 (I1: paid tolls)', () => {
  it('an old save has no paid toll; a current one keeps it through save and load', () => {
    const sim = dockedSim();
    sim.state.pirates.paid.set('pr:3,4', 5000);
    const current = toSave(sim, testContext());
    expect(current.pirates.paid).toEqual([['pr:3,4', 5000]]);
    const old = downgradeToV10(current);
    expect(old.version).toBe(10);
    expect('paid' in old.pirates).toBe(false);
    const result = loadSave(toEnvelope(old));
    expect(result).toMatchObject({ ok: true, fromVersion: 10 });
    if (result.ok) expect(result.save).toEqual({ ...legacyWorldSave(current), pirates: { ...current.pirates, paid: [] } });
    const same = loadSave(toEnvelope(current));
    if (!same.ok) throw new Error('load failed');
    expect(restoreSimulation(same.save).state.pirates.paid).toEqual(new Map([['pr:3,4', 5000]]));
  });

  it('rejects data that is not a version 10 save', () => {
    expect(migrate({ version: 10 }, 10)).toMatchObject({ ok: false, error: 'migration' });
  });
});
