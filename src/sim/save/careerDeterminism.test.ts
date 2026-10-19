// Career determinism across save and load (M3.5a): contracts, boards, the courier, a captain, "First
// Day" and the board and sector epoch boundary – A runs N + M steps, B runs N, is saved, loaded and runs
// the remaining M. At Guild level 2 the home board carries the pinned Guild relay slip (M4d, save V20).
import { describe, expect, it } from 'vitest';
import { SECTOR_EPOCH_TICKS } from '../../data/sector';
import { IDLE_COMMAND, type GameAction, type PlayerCommand } from '../commands';
import { Simulation, type SimEvent } from '../Simulation';
import { loadSave } from './load';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { testContext } from './testing';

const ctx = testContext();

function setup(): Simulation {
  const sim = new Simulation({ seed: 77, settings: { enemyDensity: 'high' } });
  // just before the sector (and board) epoch changes
  sim.state.tick = SECTOR_EPOCH_TICKS * 2 - 150;
  sim.state.career.rep.guild = { points: 260, level: 2, assignments: {} };
  sim.state.career.rep.institute = { points: 100, level: 1, assignments: {} };
  sim.step(IDLE_COMMAND);
  const board = sim.state.career.boards.get('home')!;
  const actions: GameAction[] = board.offers.slice(0, 3).map((o, i) => ({ type: 'acceptContract', offerId: o.id, reqId: i + 1 }));
  const events = sim.step({ ...IDLE_COMMAND, actions });
  expect(events.filter((e) => e.type === 'contractAccepted').length).toBeGreaterThan(0);
  // a courier shipment on its way
  const any = [...sim.state.world.discovered].find((id) => id !== 'home');
  if (any) {
    sim.state.stations.get('home')!.resources.iron = 50;
    sim.step({ ...IDLE_COMMAND, actions: [{ type: 'courierSend', from: 'home', to: any, resources: { iron: 20 }, parts: {}, reqId: 9 }] });
  }
  sim.step({ ...IDLE_COMMAND, actions: [{ type: 'undock', reqId: 10 }] });
  return sim;
}

/** The pilot flies around, mines and presses F. */
function script(sim: Simulation, step: number): PlayerCommand {
  const pos = sim.state.player.body.pos;
  const rock = sim.state.world.asteroids()[step % 7];
  const aim = rock ? rock.pos : { x: pos.x + 10, y: pos.y };
  return {
    ...IDLE_COMMAND,
    flight: { forward: Math.sin(step / 40) * 0.8, strafe: Math.cos(step / 55) * 0.4, turn: Math.sin(step / 25) },
    aim,
    mining: step % 3 !== 0,
    dock: step % 50 === 0,
  };
}

function run(sim: Simulation, from: number, to: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = from; i < to; i++) out.push(...sim.step(script(sim, i)));
  return out;
}

function roundTrip(sim: Simulation): Simulation {
  const result = loadSave(toEnvelope(toSave(sim, ctx)));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  return restoreSimulation(result.save);
}

describe('career determinism across save and load', () => {
  it.each([
    [60, 400],
    [200, 600],
  ])('N=%i, M=%i: identical events and state', (n, m) => {
    const a = setup();
    const b = setup();
    run(a, 0, n);
    run(b, 0, n);
    const loaded = roundTrip(b);
    expect(JSON.stringify(toSave(loaded, ctx))).toBe(JSON.stringify(toSave(b, ctx)));
    const eventsA = run(a, n, n + m);
    const eventsB = run(loaded, n, n + m);
    expect(eventsB).toEqual(eventsA);
    expect(JSON.stringify(toSave(loaded, ctx))).toBe(JSON.stringify(toSave(a, ctx)));
    expect(a.state.career.contracts.length).toBeGreaterThan(0);
  });
});
