// Save/load determinism of the M4d state (save V20): a relay hold (the warning and the fight with the
// Guild reinforcement), a live Guild Watch fight, a convoy link in the middle of a trade and an escort
// under ambush – game A runs N + M steps, game B runs N, is saved, loaded and runs the remaining M; the
// events and the state hashes must match.
import { describe, expect, it } from 'vitest';
import { ESCORT } from '../../data/convoys';
import { RELAY_CHAIN } from '../../data/guild';
import { IDLE_COMMAND, type GameAction, type GameActionInput, type PlayerCommand } from '../commands';
import { fnv1aHex } from '../math/fnv1a';
import type { SimEvent, Simulation } from '../Simulation';
import { escortGame, linkedGame, relayHoldGame, rideEscort, stepHold, watchFightGame } from './guildTesting';
import { loadSave } from './load';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { testContext } from './testing';

const ctx = testContext();
const TICKS = 60;

const hash = (sim: Simulation): string => fnv1aHex(JSON.stringify(toSave(sim, ctx)));

function roundTrip(sim: Simulation): Simulation {
  const result = loadSave(toEnvelope(toSave(sim, ctx)));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  expect(result.warnings).toEqual([]);
  return restoreSimulation(result.save);
}

type Step = (sim: Simulation, i: number) => SimEvent[];

function run(sim: Simulation, step: Step, from: number, to: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = from; i < to; i++) out.push(...step(sim, i));
  return out;
}

/** A and B from the same setup; B saved and loaded after `n` steps; both run `m` more. Returns B before the save. */
function check(setup: () => Simulation, step: Step, n: number, m: number, atSave: (b: Simulation) => void): void {
  const a = setup();
  const b = setup();
  run(a, step, 0, n);
  run(b, step, 0, n);
  expect(hash(b)).toBe(hash(a));
  atSave(b);
  const loaded = roundTrip(b);
  expect(hash(loaded)).toBe(hash(b));
  const eventsA = run(a, step, n, n + m);
  const eventsB = run(loaded, step, n, n + m);
  expect(eventsB).toEqual(eventsA);
  expect(hash(loaded)).toBe(hash(a));
}

const act = (cmd: PlayerCommand, action: GameActionInput, reqId: number): PlayerCommand => ({ ...cmd, actions: [{ ...action, reqId } as GameAction] });

describe('M4d determinism across save and load', () => {
  const hold = () => relayHoldGame().sim;
  const holdStep: Step = (sim) => stepHold(sim);

  it('a relay hold in its warning: the counterattack still comes on time', () => {
    check(hold, holdStep, 120, RELAY_CHAIN.counterattackDelay * TICKS + 300, (b) => {
      expect(b.state.guild.hold?.phase).toBe('warning');
    });
  });

  it('a relay hold in the fight with the Guild reinforcement', () => {
    const n = (RELAY_CHAIN.counterattackDelay + RELAY_CHAIN.watchArrive + 4) * TICKS;
    check(hold, holdStep, n, 900, (b) => {
      const g = b.state.guild;
      expect(g.hold).toMatchObject({ lane: 'A', phase: 'fight', reinforced: true });
      expect(g.watch.some((w) => w.route === 'relay:A')).toBe(true);
      expect(b.state.combat.enemies.some((e) => e.id.startsWith('rc:A:'))).toBe(true);
    });
  });

  it('a live Guild Watch fight', () => {
    check(watchFightGame, (sim) => sim.step(IDLE_COMMAND), 240, 900, (b) => {
      const g = b.state.guild;
      expect(g.watch.some((w) => w.mode === 'engage' && w.target !== null)).toBe(true);
      expect(g.watch.some((w) => w.hull < 220 || w.shield < 60 || w.cooldowns.some((x) => x > 0))).toBe(true);
      expect(g.lastRadio).toBeGreaterThan(0);
    });
  });

  it('a convoy link in the middle of a trade', () => {
    const step: Step = (sim, i) => {
      if (i === 20) return sim.step(act(IDLE_COMMAND, { type: 'convoyBuy', slot: 0 }, i));
      if (i === 90) return sim.step(act(IDLE_COMMAND, { type: 'convoySell', resource: 'iron', qty: 30 }, i));
      if (i === 150) return sim.step(act(IDLE_COMMAND, { type: 'convoyFuel', amount: 5 }, i));
      return sim.step(IDLE_COMMAND);
    };
    check(linkedGame, step, 60, 600, (b) => {
      const c = b.state.convoys;
      expect(c.link).not.toBeNull();
      expect(c.trades.get(c.link!.pass)?.bought).toBe(1);
    });
  });

  it('an escort under ambush', () => {
    const setup = () => escortGame().sim;
    const serial = escortGame().contract.serial;
    const step: Step = (sim) => rideEscort(sim, serial);
    // the save point: the first ambush party came out 11 s before, stopped the convoy and hit the trader (found by a probe run)
    const probe = setup();
    let n = 0;
    while (!probe.state.combat.enemies.some((e) => e.id.startsWith('ea:')) && n < 20_000) step(probe, n++);
    expect(n).toBeLessThan(20_000);
    check(setup, step, n + 660, 900, (b) => {
      const e = b.state.convoys.escorts.get(serial)!;
      expect(e.state).toBe('stopped');
      expect(e.hulls[0]).toBeLessThan(ESCORT.traderHull);
      expect(e.fired).toBeGreaterThan(0);
      expect(e.departed).not.toBeNull();
      expect(e.deposit).toBeGreaterThan(0);
      expect(b.state.combat.enemies.some((x) => x.id.startsWith(`ea:${serial}:`))).toBe(true);
    });
  });
});
