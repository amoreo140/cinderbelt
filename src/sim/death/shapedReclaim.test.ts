// SL2 E2 S5: a restored ship takes its shaped armour back out of its own wrecks – death.ts needs no
// change, because the reclaim compares a whole part's scrap (full max HP on both sides of the ratio)
// and the player's shaped plates drop under their plain part key.
import { describe, expect, it } from 'vitest';
import { scrapResources } from '../../data/economy';
import { IDLE_COMMAND, type GameAction } from '../commands';
import { addPartLoot, createWreck, emptyLoot, lootEmpty } from '../combat/wrecks';
import { createGrid } from '../ship/grid';
import { Simulation } from '../Simulation';
import { homeOnly } from '../station/testHarness';
import { applyDeath } from './death';

const undock = { ...IDLE_COMMAND, actions: [{ reqId: 1, type: 'undock' } as GameAction] };

/** The starter layout with two T1 wedges (ids 15, 16) on the flanks. */
const wedgeShip = () =>
  createGrid([
    ['cockpit', 1, 0], ['gyro', 0, 0], ['miningLaser', 2, 0, 0], ['reactor', -1, 0],
    ['cargo', 0, 1], ['cargo', 0, -1], ['fuelTank', 1, 1], ['radar', 1, -1],
    ['engine', -1, 1, 0], ['engine', -1, -1, 0], ['engine', 2, 1, 2], ['engine', 2, -1, 2],
    ['engine', 0, -2, 1], ['engine', 0, 2, 3],
    ['armor', 1, 2, 0, 1, 'wedge'], ['armor', 1, -2, 3, 1, 'wedge'],
  ]);

describe('applyDeath – own wrecks with shaped armour (SL2 E2 S5)', () => {
  it('an intact wedge knocked off whole and a damaged one knocked off as scrap both come back', () => {
    for (const penalty of ['none', 'mild'] as const) {
      const sim = new Simulation({ seed: 1, generator: homeOnly, grid: wedgeShip(), settings: { deathPenalty: penalty } });
      sim.step(undock);
      sim.step(IDLE_COMMAND);
      const p = sim.state.player;
      const [intact, damaged] = [15, 16].map((id) => p.grid.parts.find((part) => part.id === id)!);
      expect(intact!.shape).toBe('wedge');
      const wholeLoot = emptyLoot();
      addPartLoot(wholeLoot, intact!, p.hp, 'player');
      expect(wholeLoot.parts).toEqual({ 'armor:1': 1 });
      const scrapLoot = emptyLoot();
      // 10 of 20 HP: scrap from 30 of 40 (5 Fe) – still within a whole plate's scrap (7 Fe)
      addPartLoot(scrapLoot, damaged!, new Map([[16, 10]]), 'player');
      expect(scrapLoot.cargo.iron).toBe(5);
      expect(scrapResources('armor:1', 40, 40)).toEqual({ iron: 7 });
      const source = { body: p.body, props: p.props };
      const still = { vel: { x: 0, y: 0 }, angVel: 0 };
      sim.state.combat.wrecks.push(createWreck(99, [intact!], source, still, wholeLoot, 'default'));
      sim.state.combat.wrecks.push(createWreck(98, [damaged!], source, still, scrapLoot, 'default'));
      p.destroyed = true;
      applyDeath(sim);
      expect(sim.state.player.grid.parts.some((part) => part.id === 15), penalty).toBe(true);
      expect(lootEmpty(sim.state.combat.wrecks.find((w) => w.id === 99)!.loot), penalty).toBe(true);
      expect(lootEmpty(sim.state.combat.wrecks.find((w) => w.id === 98)!.loot), penalty).toBe(true);
    }
  });
});
