// Mining a comet on the move (M4b plan §2.3) – OWNED BY T2. `miningMovers` lists the nucleus (grade
// `COMET.grade`, mix `COMET.mix`, budget `COMET.budget` per pass minus `sites.comets.core`) and the
// unmined tail shards within laser reach; `runMining` (mining.ts) raycasts against them and reports
// `moverExtractions`; `applyMoverExtractions` books `sites.comets` (dropping older passes) and rolls
// nuggets for the rich core (Mining 2.0).
//
// Tail shards are small: the first beam that touches one shatters it – the shard's ice goes into the
// hold at once (as much as fits) and its bit is set, so a shard never needs a saved partial amount.
import { NUGGET } from '../../data/ore';
import { cargoUsed, RESOURCE_IDS, type ResourceId } from '../../data/resources';
import { COMET } from '../../data/sites';
import { nuggetChance, nuggetRoll, spawnMoverNugget } from '../mining/nuggets';
import type { MiningMover } from '../mining/movers';
import type { MiningResult } from '../mining/mining';
import type { SimEvent, SimState } from '../Simulation';
import { cometAt, cometLeft, cometShards, cometsNear, cometStepTick } from './comets';
import type { CometPose, CometState } from './types';

const SHARD_MARK = '#';
const SHARD_MIX: Partial<Record<ResourceId, number>> = { ice: 1 };
/** Grade of a tail shard (plain ice). */
const SHARD_GRADE = 1;

/** Laser reach of the player's ship (centre to the farthest beam end). */
function laserReach(state: SimState): number {
  const props = state.player.props;
  return props.boundingRadius + props.lasers.reduce((m, l) => Math.max(m, l.range), 0);
}

/** Moving mining targets within the ship's laser reach this step. */
export function miningMovers(state: SimState): MiningMover[] {
  const player = state.player;
  if (player.destroyed || player.props.lasers.length === 0) return [];
  const reach = laserReach(state);
  const at = player.body.pos;
  const out: MiningMover[] = [];
  for (const pose of cometsNear(state.seed, at, reach + COMET.nucleusRadius + COMET.tail.length + 2, cometStepTick(state))) {
    const left = cometLeft(state, pose.id, pose.pass);
    if (Math.hypot(pose.pos.x - at.x, pose.pos.y - at.y) <= reach + COMET.nucleusRadius) {
      out.push({
        id: pose.id,
        pos: pose.pos,
        vel: pose.vel,
        radius: COMET.nucleusRadius,
        resource: 'ice',
        mix: COMET.mix,
        left: left.core,
        grade: COMET.grade,
        nuggets: true,
      });
    }
    for (const shard of cometShards(pose)) {
      if (left.tail & (1 << shard.index)) continue;
      if (Math.hypot(shard.pos.x - at.x, shard.pos.y - at.y) > reach + shard.radius) continue;
      out.push({
        id: `${pose.id}${SHARD_MARK}${shard.index}`,
        pos: shard.pos,
        vel: pose.vel,
        radius: shard.radius,
        resource: 'ice',
        mix: SHARD_MIX,
        left: COMET.tail.units,
        grade: SHARD_GRADE,
        nuggets: false,
      });
    }
  }
  return out;
}

/** The comet's budget entry of this pass (a new pass starts fresh; an older entry is replaced). */
function touch(state: SimState, id: string, pass: number): CometState {
  const comets = state.sites.comets;
  let st = comets.get(id);
  if (!st || st.pass !== pass) {
    st = { pass, core: 0, tail: 0 };
    comets.set(id, st);
  }
  return st;
}

/** Books what `runMining` took out of movers (budgets, shard bits, nuggets, events). */
export function applyMoverExtractions(state: SimState, result: MiningResult, events: SimEvent[]): void {
  if (result.moverExtractions.length === 0) return;
  const tick = cometStepTick(state);
  const poses = new Map<string, CometPose | null>();
  const poseOf = (id: string): CometPose | null => {
    if (!poses.has(id)) poses.set(id, cometAt(state.seed, id, tick));
    return poses.get(id)!;
  };
  // what the lasers took out of each shard in this step (several lasers may share one)
  const shardTaken = new Map<string, number>();
  for (const x of result.moverExtractions) {
    if (x.mover.includes(SHARD_MARK)) shardTaken.set(x.mover, (shardTaken.get(x.mover) ?? 0) + x.taken);
  }
  for (const x of result.moverExtractions) {
    const mark = x.mover.indexOf(SHARD_MARK);
    const id = mark < 0 ? x.mover : x.mover.slice(0, mark);
    const pose = poseOf(id);
    if (!pose) continue;
    const st = touch(state, id, pose.pass);
    if (mark >= 0) {
      // a tail shard shatters: the rest of its ice goes into the hold at once (as much as fits)
      const taken = shardTaken.get(x.mover);
      if (taken === undefined) continue;
      shardTaken.delete(x.mover);
      st.tail |= 1 << Number(x.mover.slice(mark + 1));
      const free = state.player.props.cargoCapacity - cargoUsed(state.player.cargo);
      const rest = Math.min(Math.max(0, free), Math.max(0, COMET.tail.units - taken) * SHARD_GRADE);
      if (rest > 0) {
        state.player.cargo.ice += rest;
        if (!result.cargoFilled && free - rest <= 1e-9) events.push({ type: 'cargoFull' });
      }
      continue;
    }
    // the nucleus: book the rock units, then roll nuggets every NUGGET.stepUnits of the pass
    const minedBefore = COMET.budget - x.before;
    st.core = Math.min(COMET.budget, st.core + x.taken);
    rollCoreNuggets(state, pose, st, x, minedBefore, events);
  }
}

/** Nugget rolls of a nucleus extraction (Mining 2.0 – rich core, never from the tail). */
function rollCoreNuggets(
  state: SimState,
  pose: CometPose,
  st: CometState,
  x: MiningResult['moverExtractions'][number],
  minedBefore: number,
  events: SimEvent[],
): void {
  const k0 = Math.floor(minedBefore / NUGGET.stepUnits + 1e-9);
  const k1 = Math.floor((minedBefore + x.taken) / NUGGET.stepUnits + 1e-9);
  if (k1 <= k0) return;
  const chance = nuggetChance({ onVein: false, grade: x.grade, laserRate: x.laserRate, bonus: 1 });
  const key = `${pose.id}@${pose.pass}`;
  for (let k = k0 + 1; k <= k1; k++) {
    const h = nuggetRoll(state.seed, key, k);
    if (h / 4294967296 >= chance) continue;
    // the nugget is taken out of the pass budget; the core keeps a little rock
    const rock = Math.min(NUGGET.seconds * x.laserRate, COMET.budget - st.core - NUGGET.keepRock);
    if (rock < NUGGET.minRock) return;
    st.core += rock;
    spawnMoverNugget(
      state,
      h,
      { source: pose.id, resource: pickResource(h), rock, grade: x.grade, center: pose.pos, radius: COMET.nucleusRadius, vel: pose.vel, to: x.to },
      events,
    );
  }
}

/** The nugget's ore by the nucleus mix (from the roll hash). */
function pickResource(h: number): ResourceId {
  let r = ((Math.imul(h ^ 0x5bd1e995, 0x27d4eb2f) >>> 0) / 4294967296) * 0.999999;
  let last: ResourceId = 'ice';
  for (const id of RESOURCE_IDS) {
    const share = COMET.mix[id];
    if (!share) continue;
    last = id;
    r -= share;
    if (r < 0) return id;
  }
  return last;
}
