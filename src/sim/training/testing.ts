// Test helpers for the Guild Training (not used by the game): a training game and a scripted
// playthrough that completes every step through commands and station actions.
import type { PartKey } from '../../data/parts';
import { IDLE_COMMAND, type GameAction, type GameActionInput, type PlayerCommand } from '../commands';
import type { Vec2 } from '../math/vec2';
import { createBody } from '../physics/body';
import { SIM_DT, Simulation, type SimEvent } from '../Simulation';
import type { Rotation } from '../ship/types';
import { draftBaseHash } from '../shipyard/commit';
import { applyStroke, createDraft, draftOps } from '../shipyard/draft';
import type { EditorOp } from '../shipyard/editor';
import { undockPose } from '../station/dock';
import { stationStorage } from '../station/storage';
import { HOME_STATION_ID, homeStation } from '../world/stations';
import { beginTraining, currentTrainingStep } from './training';

let reqId = 0;

/** A new game with the training (the real world of the seed). */
export function trainingSim(seed = 1337): Simulation {
  const sim = new Simulation({ seed, settings: { seedText: String(seed) } });
  beginTraining(sim.state);
  return sim;
}

export function step(sim: Simulation, cmd: Partial<PlayerCommand> = {}, n = 1): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.step({ ...IDLE_COMMAND, ...cmd }));
  return out;
}

export function act(sim: Simulation, action: GameActionInput): SimEvent[] {
  return sim.step({ ...IDLE_COMMAND, actions: [{ ...action, reqId: ++reqId } as GameAction] });
}

export const okOf = (events: readonly SimEvent[]): boolean => events.some((e) => e.type === 'actionResult' && e.ok);

/** Places the ship (stopped) and loads the chunks around. */
export function teleport(sim: Simulation, pos: Vec2, angle = 0): void {
  const body = createBody(pos, angle);
  sim.state.player.body = body;
  sim.state.player.prevBody = body;
  sim.state.world.update(pos);
}

/** Undock (the real action). */
export function undock(sim: Simulation): SimEvent[] {
  return act(sim, { type: 'undock' });
}

/** Docks at home: stopped at the port, F, the docking animation. */
export function dockHome(sim: Simulation): SimEvent[] {
  const pose = undockPose(homeStation(), sim.state.player.props.boundingRadius);
  teleport(sim, pose.pos, Math.PI);
  return [...step(sim, { dock: true }), ...step(sim, {}, 70)];
}

/** Mines at the training rock until `amount` more iron is in the hold (or `maxSeconds` pass). */
export function mineAtRock(sim: Simulation, amount: number, maxSeconds = 120): SimEvent[] {
  const sites = sim.state.career.training.sites!;
  const rock = sim.state.world.findAsteroid(sites.rock);
  const r = rock ? sim.state.world.radiusOf(rock) : 2;
  // in front of the rock on its side facing home (the free approach), the bow towards the rock
  const d = Math.hypot(sites.rockPos.x, sites.rockPos.y) || 1;
  const gap = r + sim.state.player.props.boundingRadius + 5;
  teleport(sim, { x: sites.rockPos.x - (sites.rockPos.x / d) * gap, y: sites.rockPos.y - (sites.rockPos.y / d) * gap }, Math.atan2(sites.rockPos.y, sites.rockPos.x));
  const start = sim.state.stats.mined.iron;
  const out: SimEvent[] = [];
  for (let i = 0; i < maxSeconds / SIM_DT && sim.state.stats.mined.iron - start < amount; i++) {
    out.push(...step(sim, { mining: true, aim: sites.rockPos }));
  }
  return out;
}

/** Commits shipyard editor ops at the docked station (the parts from the storage). */
export function commit(sim: Simulation, ops: EditorOp[]): SimEvent[] {
  const { player } = sim.state;
  const at = player.dock.mode === 'docked' ? player.dock.stationId : HOME_STATION_ID;
  const draft = applyStroke(createDraft(at, player.grid, player.hp, stationStorage(sim.state, at).parts), ops).draft;
  return act(sim, { type: 'shipyardCommit', baseHash: draftBaseHash(draft), ops: draftOps(draft), acquire: draft.acquire });
}

export const place = (key: PartKey, x: number, y: number, rot: Rotation = 0): EditorOp => ({ op: 'place', key, x, y, rot });

export const stepId = (sim: Simulation): string | null => currentTrainingStep(sim.state.career.training)?.id ?? null;

/**
 * Plays the whole training the way a player would (teleports stand in for the flying): returns the
 * events of the run. Each phase asserts nothing – tests check the outcome.
 */
export function playTraining(sim: Simulation): SimEvent[] {
  const out: SimEvent[] = [];
  const sites = () => sim.state.career.training.sites!;
  // 1 fly to the buoy
  out.push(...undock(sim));
  teleport(sim, sites().buoyA);
  out.push(...step(sim, {}, 2));
  // 2 mine 20 iron
  out.push(...mineAtRock(sim, 21));
  // 3 dock and sell
  out.push(...dockHome(sim));
  out.push(...act(sim, { type: 'sellResource', resource: 'iron', qty: 'all', from: 'ship' }));
  out.push(...step(sim, {}, 2));
  // 4 side engines (left thrust on the right side, right thrust on the left side)
  out.push(...commit(sim, [place('engine:1', 0, -1, 1), place('engine:1', 0, 1, 3)]));
  out.push(...step(sim, {}, 2));
  // 5 stop at the second buoy
  out.push(...undock(sim));
  teleport(sim, sites().buoyB);
  out.push(...step(sim, {}, 2));
  // 6 the second reverse engine at the bow (the training hull has the first one at (2, 1))
  out.push(...dockHome(sim));
  out.push(...commit(sim, [place('engine:1', 2, -1, 2)]));
  out.push(...step(sim, {}, 2));
  // 7 craft a cargo hold and install it
  out.push(...act(sim, { type: 'craft', key: 'cargo:1', count: 1 }));
  out.push(...commit(sim, [place('cargo:1', 1, 1)]));
  out.push(...step(sim, {}, 2));
  // 8 refuel, map, objectives
  out.push(...act(sim, { type: 'refuel', source: 'credits', amount: 'full' }));
  out.push(...act(sim, { type: 'trainingSeen', what: 'objectives' }));
  out.push(...undock(sim));
  out.push(...act(sim, { type: 'trainingSeen', what: 'map' }));
  out.push(...step(sim, {}, 2));
  // 9 the rest of the ship
  out.push(...dockHome(sim));
  out.push(...commit(sim, [place('reactor:1', 1, -1), place('radar:1', -1, -1), place('gyro:1', -1, 1), place('engine:1', -2, 1, 0)]));
  out.push(...step(sim, {}, 2));
  return out;
}
