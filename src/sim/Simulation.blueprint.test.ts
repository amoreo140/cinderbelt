// M3.8: the ship blueprint (last confirmed design) and the `partsLost` notice.
import { describe, expect, it } from 'vitest';
import { applyRam } from './combat/combat';
import { IDLE_COMMAND } from './commands';
import { applyDeath } from './death/death';
import { createGrid } from './ship/grid';
import { missingParts } from './ship/blueprint';
import { createStarterShip } from './ship/presets';
import { Simulation, type SimEvent } from './Simulation';
import { createDraft, applyStroke } from './shipyard/draft';
import { draftBaseHash } from './shipyard/commit';
import { act, dockedSim, expectOk, homeOnly } from './station/testHarness';
import { stationStorage } from './station/storage';
import { homeStation } from './world/stations';

/** Cockpit, engine and a tail of two armor plates – losing the inner plate tears off the outer one. */
const tailShip = () => createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['armor', 1, 0], ['armor', 2, 0]]);

function flying(grid = tailShip(), deathPenalty: 'none' | 'hard' = 'none'): Simulation {
  const sim = new Simulation({ seed: 3, generator: homeOnly, grid, startDocked: false, settings: { deathPenalty } });
  sim.step(IDLE_COMMAND);
  return sim;
}

describe('ship blueprint', () => {
  it('a new game starts with its ship as the blueprint', () => {
    const sim = dockedSim();
    expect(sim.state.player.blueprint).toEqual(sim.state.player.grid);
  });

  it('a part destroyed in flight goes missing from the blueprint, with one partsLost notice', () => {
    const sim = flying();
    const p = sim.state.player;
    const events: SimEvent[] = [];
    applyRam(sim.state, 'player', p, 3, 1000, events);
    expect(p.grid.parts.map((q) => q.id)).toEqual([1, 2]);
    expect(missingParts(p.blueprint, p.grid).map((q) => q.id)).toEqual([3, 4]);
    const lost = events.filter((e) => e.type === 'partsLost');
    expect(lost).toEqual([
      {
        type: 'partsLost',
        cause: 'impact',
        parts: [
          { partId: 3, key: 'armor:1', detached: false },
          { partId: 4, key: 'armor:1', detached: true },
        ],
      },
    ]);
  });

  it('tells hazards from impacts', () => {
    const sim = flying();
    const events: SimEvent[] = [];
    applyRam(sim.state, 'player', sim.state.player, 4, 1000, events, 'hazard');
    expect(events.find((e) => e.type === 'partsLost')).toMatchObject({ cause: 'hazard', parts: [{ partId: 4, detached: false }] });
  });

  it('sends no partsLost when the cockpit goes (that is the death sequence)', () => {
    const sim = flying();
    const events: SimEvent[] = [];
    applyRam(sim.state, 'player', sim.state.player, 1, 1000, events);
    expect(events.some((e) => e.type === 'partsLost')).toBe(false);
    expect(events.some((e) => e.type === 'playerDestroyed')).toBe(true);
  });

  it('a shipyard commit makes the new design the blueprint', () => {
    const sim = dockedSim();
    const p = sim.state.player;
    const inventory = stationStorage(sim.state, homeStation().id).parts;
    const draft = applyStroke(createDraft(homeStation().id, p.grid, p.hp, inventory), [{ op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 }]).draft;
    expectOk(act(sim, { type: 'shipyardCommit', baseHash: draftBaseHash(draft), ops: [{ op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 }], acquire: {} }));
    expect(p.blueprint).toBe(p.grid);
    expect(p.blueprint.parts.some((q) => q.partId === 'armor')).toBe(true);
  });

  it('death keeps the blueprint for a restored snapshot, a new starter ship starts a new one', () => {
    const keep = flying(tailShip(), 'none');
    const before = keep.state.player.blueprint;
    applyDeath(keep);
    expect(keep.state.player.blueprint).toBe(before);

    // Hard: the blueprint is the full starter layout; what the Guild did not lend (the player can buy
    // it, second review I5) is its gap
    const fresh = flying(tailShip(), 'hard');
    applyDeath(fresh);
    expect(fresh.state.player.blueprint).toEqual(createStarterShip());
    expect(missingParts(fresh.state.player.blueprint, fresh.state.player.grid).length).toBe(createStarterShip().parts.length - fresh.state.player.grid.parts.length);
  });
});
