// Saboteur scenario for the Guild Training (M3.7): play the training like an exploiter – sell every
// reward part and the crafting kit instead of installing them (the Guild lends loan parts so no step
// gets stuck), try to cash in the loans, skip twice, skip again from a save → load copy, die mid-way –
// and compare the net worth at the end with the most the training may ever hand out: its rewards
// (step credits, crafting kit, reward parts) plus what the player mined himself.
import { partSellPrice } from '../../../src/data/economy';
import type { PartInventory, PartKey } from '../../../src/data/parts';
import { RESOURCE_IDS } from '../../../src/data/resources';
import { TRAINING_STEPS } from '../../../src/data/training';
import { IDLE_COMMAND } from '../../../src/sim/commands';
import type { DeathPenalty } from '../../../src/sim/settings';
import { beginTraining, currentTrainingStep } from '../../../src/sim/training/training';
import { homeStation } from '../../../src/sim/world/stations';
import { homeSellPrice } from '../pilot';
import { cloneSim, Driver, newGame, TPS } from './harness';
import type { LoopResult } from './scenarios';
import { netWorth } from './value';

const partsValue = (inv: PartInventory): number => (Object.entries(inv) as [PartKey, number][]).reduce((s, [k, n]) => s + partSellPrice(k) * (n ?? 0), 0);

/** The most value the whole training can hand out (liquidation value): credits, kit, reward parts. */
export function trainingRewardValue(): number {
  let v = 0;
  for (const s of TRAINING_STEPS) {
    v += s.reward.credits + partsValue(s.reward.parts);
    if (s.reward.kit) v += s.reward.kit.credits + RESOURCE_IDS.reduce((a, r) => a + (s.reward.kit!.resources[r] ?? 0) * homeSellPrice(r), 0);
  }
  return v;
}

const stepId = (d: Driver): string | null => currentTrainingStep(d.state.career.training)?.id ?? null;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** A turn input that brings the bow to `heading` and stops the spin there (bang-bang). */
function turnTo(d: Driver, heading: number): number {
  const { body, props } = d.state.player;
  const e = wrap(heading - body.angle);
  const want = Math.sign(e) * Math.min(1, Math.sqrt(2 * (props.torque / props.inertia) * 0.45 * Math.abs(e)));
  return body.angVel < want - 0.08 ? 1 : body.angVel > want + 0.08 ? -1 : 0;
}

/**
 * Flies a ship with the forward engines only (the Guild's loan hull after a Hard respawn) with the
 * dampers off – the bot's flight helper burns its small tank: match the velocity towards `target`; to
 * stop, turn the tail forward and burn. Commands only – no state is touched.
 */
function forwardOnlyFlight(d: Driver, target: { x: number; y: number }, stop: boolean, until: () => boolean, seconds = 240): boolean {
  const end = d.state.tick + seconds * TPS;
  while (d.state.tick < end && !until()) {
    const p = d.state.player;
    if (p.dock.mode !== 'flying' || p.destroyed) return false;
    const b = p.body;
    const dx = target.x - b.pos.x;
    const dy = target.y - b.pos.y;
    const dist = Math.hypot(dx, dy) || 1e-6;
    const speed = Math.hypot(b.vel.x, b.vel.y);
    const vmax = stop ? Math.min(10, 0.3 * dist + 0.4) : 12;
    const along = (b.vel.x * dx + b.vel.y * dy) / dist;
    let heading: number;
    let burn: boolean;
    if (stop && (speed > vmax + 1.2 || along < -0.6)) {
      heading = Math.atan2(-b.vel.y, -b.vel.x);
      burn = Math.abs(wrap(heading - b.angle)) < 0.3;
    } else {
      const ex = (dx / dist) * vmax - b.vel.x;
      const ey = (dy / dist) * vmax - b.vel.y;
      const err = Math.hypot(ex, ey);
      heading = err < 0.4 ? b.angle : Math.atan2(ey, ex);
      burn = err > 0.6 && Math.abs(wrap(heading - b.angle)) < 0.25;
    }
    const turn = turnTo(d, heading);
    for (let i = 0; i < 3 && !until(); i++) {
      d.step({ ...IDLE_COMMAND, flight: { forward: burn ? 1 : 0, strafe: 0, turn }, toggleDampers: i === 0 && d.state.player.dampers, aim: { ...b.pos } });
    }
  }
  return until();
}

/**
 * Flies to `target`: the bot's flight helper for a ship with a reverse engine (the training hull),
 * the forward-only flight for the loan hull. `stop` = come to rest there; `near` > 0 ends the flight
 * that close to the target.
 */
function fly(d: Driver, target: { x: number; y: number }, stop: boolean, until: () => boolean, near = 0): boolean {
  const done = (): boolean => until() || (near > 0 && Math.hypot(d.state.player.body.pos.x - target.x, d.state.player.body.pos.y - target.y) < near);
  if (d.state.player.props.thrust.backward <= 0) return forwardOnlyFlight(d, target, stop, done);
  return d.flyTo(target, { maxSpeed: stop ? 6 : 12, arriveSpeed: stop ? 3 : 6, seconds: 240, until: done });
}

/**
 * Stops the ship the way the brake step teaches: the bow along the velocity and S (the reverse
 * engine) – or the tail forward and W when that is the smaller turn (or there is no reverse engine).
 * Commands only.
 */
function brakeToStop(d: Driver, until: () => boolean, seconds = 30): boolean {
  const end = d.state.tick + seconds * TPS;
  // the end that needs the smaller turn brakes – picked once, so the ship does not swing between them
  const first = d.state.player;
  const reverse = first.props.thrust.backward > 0 && (first.props.thrust.forward <= 0 || Math.abs(wrap(Math.atan2(first.body.vel.y, first.body.vel.x) - first.body.angle)) < Math.PI / 2);
  while (d.state.tick < end && !until()) {
    const { body, dock } = d.state.player;
    if (dock.mode !== 'flying' || d.state.player.destroyed) return false;
    if (Math.hypot(body.vel.x, body.vel.y) < 0.5) break;
    const along = Math.atan2(body.vel.y, body.vel.x);
    const heading = reverse ? along : along + Math.PI;
    const burn = Math.abs(wrap(heading - body.angle)) < 0.3;
    d.step({ ...IDLE_COMMAND, flight: { forward: burn ? (reverse ? -1 : 1) : 0, strafe: 0, turn: turnTo(d, heading) }, aim: { ...body.pos } });
  }
  return until();
}

/** Docks at home (the training happens around it). */
function home(d: Driver): boolean {
  return d.docked()?.id === homeStation().id || d.dockAt(homeStation(), 240);
}

export function trainingFarm(seed: number, penalty: DeathPenalty): LoopResult {
  const sim = newGame(seed, penalty);
  beginTraining(sim.state);
  const d = new Driver(sim);
  const w0 = netWorth(d.state).total;
  const sites = d.state.career.training.sites!;
  const attempts: Record<string, number> = { loanCashIn: 0, skipAgain: 0, skipFromCopy: 0 };
  const sellAll = (): void => {
    d.sellCargo();
    d.sellStorageParts();
  };
  const cashInLoans = (): void => {
    const loans = d.state.player.grid.parts.filter((p) => p.loan);
    if (loans.length === 0) return;
    attempts.loanCashIn!++;
    d.commit(loans.map((p) => ({ op: 'remove' as const, id: p.id })));
    d.sellStorageParts();
  };
  const guard = d.state.tick + 40 * 60 * TPS;
  while (d.state.career.training.status === 'active' && d.state.tick < guard) {
    // a moment at the dock (a human reads the hub): the Guild lends a missing engine or laser here
    if (d.state.player.dock.mode === 'docked') d.idle(0.5);
    const step = stepId(d);
    switch (step) {
      case 'flyBuoy':
        d.undock();
        fly(d, sites.buoyA, false, () => stepId(d) !== 'flyBuoy');
        break;
      case 'mineIron': {
        d.undock();
        // in front of the rock on its side facing home (the free approach), clear of its surface
        const len = Math.hypot(sites.rockPos.x, sites.rockPos.y) || 1;
        const rock = d.state.world.findAsteroid(sites.rock);
        const gap = (rock ? d.state.world.radiusOf(rock) : 2) + d.state.player.props.boundingRadius + 4;
        const standoff = { x: sites.rockPos.x - (sites.rockPos.x / len) * gap, y: sites.rockPos.y - (sites.rockPos.y / len) * gap };
        fly(d, standoff, true, () => false, 4);
        // the bow on the rock (the laser fires within its arc), the dampers hold the ship
        const end = d.state.tick + 120 * TPS;
        while (stepId(d) === 'mineIron' && d.state.tick < end && d.state.player.dock.mode === 'flying') {
          const pos = d.state.player.body.pos;
          const turn = turnTo(d, Math.atan2(sites.rockPos.y - pos.y, sites.rockPos.x - pos.x));
          d.step({ ...IDLE_COMMAND, flight: { forward: 0, strafe: 0, turn }, toggleDampers: !d.state.player.dampers, mining: true, aim: sites.rockPos });
        }
        break;
      }
      case 'dockSell':
        home(d);
        d.sellCargo();
        d.idle(0.2);
        break;
      case 'brakeBuoy':
        d.undock();
        // fly in close and brake there (the bow along the velocity, S)
        fly(d, sites.buoyB, true, () => stepId(d) !== 'brakeBuoy', 16);
        brakeToStop(d, () => stepId(d) !== 'brakeBuoy');
        // the step is checked on the next simulation steps (and the loop must never spin without ticks)
        d.idleUntil(() => stepId(d) !== 'brakeBuoy', 1);
        break;
      case 'checklist':
        home(d);
        d.refuel();
        d.act({ type: 'trainingSeen', what: 'objectives' });
        d.undock();
        d.act({ type: 'trainingSeen', what: 'map' });
        break;
      default:
        // install / craft steps: sell the rewards (and the kit) instead – the Guild lends, the step passes
        home(d);
        sellAll();
        d.idle(0.2);
        cashInLoans();
    }
    if (d.state.player.dock.mode === 'docked') {
      sellAll();
      cashInLoans();
      // a Hard respawn lends only what the player cannot buy: an honest player buys the missing engine
      if (d.state.player.props.thrust.forward <= 0) d.acquirePart('engine:1', 0);
    }
    // die once mid-training (the respawn must not hand anything out again)
    if (stepId(d) === 'brakeBuoy' && (d.counts.death ?? 0) === 0) d.scuttle();
  }
  const done = d.state.career.training.status;
  // after the end: skip again, skip from a save → load copy, sell what is left
  home(d);
  if (d.act({ type: 'trainingSkip' })) attempts.skipAgain!++;
  const copy = new Driver(cloneSim(d.sim));
  if (copy.act({ type: 'trainingSkip' })) attempts.skipFromCopy!++;
  sellAll();
  cashInLoans();
  const mined = RESOURCE_IDS.reduce((s, r) => s + d.state.stats.mined[r] * homeSellPrice(r), 0);
  const bound = w0 + trainingRewardValue() + mined;
  const w1 = netWorth(d.state).total;
  const secs = d.state.tick / TPS;
  const gain = w1 - w0;
  return {
    id: 'trainingFarm',
    seed,
    penalty,
    seconds: secs,
    gain,
    perHour: (gain * 3600) / secs,
    baselinePerHour: null,
    help: { guildLoan: d.counts.guildLoan ?? 0, death: d.counts.death ?? 0 },
    exploit: w1 > bound + 1 || attempts.skipAgain! > 0 || attempts.skipFromCopy! > 0 || done !== 'done',
    tick: w1 > bound + 1 ? d.state.tick : null,
    metrics: { bound: bound - w0, mined, loans: d.counts.guildLoan ?? 0, ...attempts },
    detail:
      `training ${done} in ${(secs / 60).toFixed(1)} min selling every reward: net worth +${Math.round(gain)} kr ≤ rewards ${Math.round(trainingRewardValue())} + mined ${Math.round(mined)} kr; ` +
      `${d.counts.guildLoan ?? 0} loan parts (worth 0), ${attempts.loanCashIn} cash-in attempts, skip again ${attempts.skipAgain}, skip from a copy ${attempts.skipFromCopy}, deaths ${d.counts.death ?? 0}`,
  };
}
