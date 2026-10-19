// Mining a comet on the move and hitting one (M4b T2, plan §2.3): the nucleus fills the hold with the
// ice / titanium mix up to its per-pass budget, which refreshes on the next pass; tail shards shatter
// once per pass; nuggets come only from the rich core; a moving nucleus rams a parked ship; the same
// commands give the same state.
import { describe, expect, it } from 'vitest';
import { COMET } from '../../data/sites';
import { IDLE_COMMAND, type PlayerCommand } from '../commands';
import type { Vec2 } from '../math/vec2';
import { Simulation, type SimEvent } from '../Simulation';
import type { ChunkGenerator } from '../world/generate';
import { cometAt, cometDefs, cometPassWindow, cometShards, cometStepTick } from './comets';
import { miningMovers } from './cometMining';

const SEED = 7;
const empty: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

/** A ship flying alongside comet `n` (matched velocity, dampers off), `gap` u beside the nucleus centre. */
function alongside(n = 0, intoPass = 3_000, gap = 12): { sim: Simulation; id: string } {
  const sim = new Simulation({ seed: SEED, startDocked: false, generator: empty });
  const id = cometDefs(SEED)[n]!.id;
  const w = cometPassWindow(SEED, id, 0)!;
  sim.state.tick = w.start + intoPass;
  const pose = cometAt(SEED, id, cometStepTick(sim.state))!;
  const v = Math.hypot(pose.vel.x, pose.vel.y);
  const side = { x: -pose.vel.y / v, y: pose.vel.x / v };
  const pos = { x: pose.pos.x + side.x * gap, y: pose.pos.y + side.y * gap };
  // the ship moves with the comet during the step: start one tick back so it ends the step beside it
  sim.state.player.body = { pos: { x: pos.x - pose.vel.x / 60, y: pos.y - pose.vel.y / 60 }, vel: { ...pose.vel }, angle: Math.atan2(-side.y, -side.x), angVel: 0 };
  sim.state.player.prevBody = sim.state.player.body;
  sim.state.player.dampers = false;
  return { sim, id };
}

/** Mines toward a target point given per step (the comet moves – the cursor follows it). */
function mine(sim: Simulation, steps: number, target: (tick: number) => Vec2): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    const cmd: PlayerCommand = { ...IDLE_COMMAND, mining: true, aim: target(cometStepTick(sim.state)) };
    events.push(...sim.step(cmd));
  }
  return events;
}

const nucleusAt = (id: string) => (tick: number): Vec2 => cometAt(SEED, id, tick)!.pos;

describe('mining a comet nucleus on the move', () => {
  it('fills the hold with the ice / titanium mix and books the pass budget', () => {
    const { sim, id } = alongside();
    const events = mine(sim, 120, nucleusAt(id));
    const { cargo } = sim.state.player;
    expect(cargo.ice).toBeGreaterThan(0.5);
    expect(cargo.titanium / (cargo.ice + cargo.titanium)).toBeCloseTo(COMET.mix.titanium!, 1);
    const st = sim.state.sites.comets.get(id)!;
    expect(st.pass).toBe(cometAt(SEED, id, sim.state.tick)!.pass);
    expect(st.core).toBeGreaterThan(0);
    // ore = rock units × grade
    const nuggetOre = events.filter((e) => e.type === 'nuggetSpawned').reduce((t, e) => t + (e.type === 'nuggetSpawned' ? e.amount : 0), 0);
    expect(cargo.ice + cargo.titanium + nuggetOre).toBeCloseTo(st.core * COMET.grade, 6);
    expect(sim.state.player.beams[0]!.mover).toBe(id);
  });

  it('respects the per-pass budget and refreshes it on the next pass', () => {
    const { sim, id } = alongside();
    const pass = cometAt(SEED, id, cometStepTick(sim.state))!.pass;
    sim.state.sites.comets.set(id, { pass, core: COMET.budget - 0.05, tail: 0 });
    mine(sim, 60, nucleusAt(id));
    const got = sim.state.player.cargo.ice + sim.state.player.cargo.titanium;
    expect(got).toBeCloseTo(0.05 * COMET.grade, 6);
    expect(sim.state.sites.comets.get(id)!.core).toBeCloseTo(COMET.budget, 6);

    // the next pass: the old entry is dropped, the nucleus is full again
    const def = cometDefs(SEED)[0]!;
    const next = alongside(0, 3_000 + def.periodTicks);
    next.sim.state.sites.comets.set(id, { pass, core: COMET.budget, tail: 0xff });
    next.sim.step(IDLE_COMMAND);
    expect(next.sim.state.sites.comets.has(id)).toBe(false);
    expect(miningMovers(next.sim.state).find((m) => m.id === id)!.left).toBe(COMET.budget);
    mine(next.sim, 30, nucleusAt(id));
    expect(next.sim.state.sites.comets.get(id)!.pass).toBe(pass + 1);
    expect(next.sim.state.player.cargo.ice).toBeGreaterThan(0);
  });

  it('a comet away from its pass is dropped from the saved budgets', () => {
    const { sim, id } = alongside();
    const w = cometPassWindow(SEED, id, sim.state.tick)!;
    sim.state.sites.comets.set(id, { pass: w.pass, core: 10, tail: 1 });
    sim.state.tick = w.end + 10;
    sim.step(IDLE_COMMAND);
    expect(sim.state.sites.comets.size).toBe(0);
  });

  it('rolls nuggets from the rich core (they keep the comet velocity)', () => {
    const { sim, id } = alongside(0, 2_000);
    sim.state.player.props.cargoCapacity = 10_000;
    const events = mine(sim, 60 * 90, nucleusAt(id));
    const spawned = events.filter((e): e is Extract<SimEvent, { type: 'nuggetSpawned' }> => e.type === 'nuggetSpawned');
    expect(spawned.length).toBeGreaterThan(0);
    for (const e of spawned) {
      expect(['ice', 'titanium']).toContain(e.resource);
      expect(e.grade).toBe(COMET.grade);
      expect(Math.hypot(e.vel.x, e.vel.y)).toBeGreaterThan(20);
    }
    expect(sim.state.sites.comets.get(id)!.core).toBeLessThanOrEqual(COMET.budget);
  });
});

describe('tail shards', () => {
  it('a shard shatters into the hold once per pass and never rolls a nugget', () => {
    const { sim, id } = alongside(0, 3_000, 0);
    // fly at the tail instead: put the ship beside shard 20
    const pose = cometAt(SEED, id, cometStepTick(sim.state))!;
    const shard = cometShards(pose)[20]!;
    const v = Math.hypot(pose.vel.x, pose.vel.y);
    const side = { x: -pose.vel.y / v, y: pose.vel.x / v };
    sim.state.player.body = {
      pos: { x: shard.pos.x + side.x * 9 - pose.vel.x / 60, y: shard.pos.y + side.y * 9 - pose.vel.y / 60 },
      vel: { ...pose.vel },
      angle: Math.atan2(-side.y, -side.x),
      angVel: 0,
    };
    const shardAt = (tick: number): Vec2 => cometShards(cometAt(SEED, id, tick)!)[20]!.pos;
    const events = mine(sim, 1, shardAt);
    // the beam shatters the first shard on its way (shard 20 or one in front of it)
    const hit = sim.state.player.beams[0]!.mover!;
    expect(hit.startsWith(`${id}#`)).toBe(true);
    const index = Number(hit.split('#')[1]);
    const st = sim.state.sites.comets.get(id)!;
    expect(st.tail).toBe(1 << index);
    expect(sim.state.player.cargo.ice).toBeCloseTo(COMET.tail.units, 6);
    expect(sim.state.player.cargo.titanium).toBe(0);
    expect(events.some((e) => e.type === 'nuggetSpawned')).toBe(false);
    // gone for this pass: the next beam goes on to another shard, never the same one again
    expect(miningMovers(sim.state).some((m) => m.id === hit)).toBe(false);
    for (let i = 0; i < 30; i++) {
      mine(sim, 1, shardAt);
      const mover = sim.state.player.beams[0]?.mover;
      expect(mover).not.toBe(hit);
    }
    const shattered = sim.state.sites.comets.get(id)!.tail;
    let count = 0;
    for (let t = shattered; t; t &= t - 1) count++;
    expect(sim.state.player.cargo.ice).toBeCloseTo(count * COMET.tail.units, 6);
  });
});

describe('a moving nucleus is an obstacle', () => {
  it('rams a parked ship with its own speed', () => {
    const sim = new Simulation({ seed: SEED, startDocked: false, generator: empty });
    const id = cometDefs(SEED)[1]!.id;
    const w = cometPassWindow(SEED, id, 0)!;
    sim.state.tick = w.start + 2_000;
    const ahead = cometAt(SEED, id, sim.state.tick + 30)!;
    sim.state.player.body = { pos: { ...ahead.pos }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.player.body.pos = { x: ahead.pos.x + ahead.vel.x * 0.2, y: ahead.pos.y + ahead.vel.y * 0.2 };
    const events: SimEvent[] = [];
    for (let i = 0; i < 90; i++) events.push(...sim.step(IDLE_COMMAND));
    const hit = events.find((e) => e.type === 'collision');
    expect(hit).toBeDefined();
    if (hit?.type === 'collision') {
      expect(hit.speed).toBeGreaterThan(25);
      expect(hit.damage ?? 0).toBeGreaterThan(0);
    }
  });

  it('flying alongside at its speed and touching it does not hurt', () => {
    const { sim, id } = alongside(0, 3_000, 6.5 + 1.2);
    const events: SimEvent[] = [];
    for (let i = 0; i < 30; i++) events.push(...sim.step({ ...IDLE_COMMAND, aim: nucleusAt(id)(cometStepTick(sim.state)) }));
    expect(events.filter((e) => e.type === 'collision' && (e.damage ?? 0) > 0)).toEqual([]);
  });
});

describe('determinism', () => {
  it('the same commands give the same comet state, cargo and nuggets', () => {
    const run = (): unknown => {
      const { sim, id } = alongside(0, 2_000);
      mine(sim, 600, nucleusAt(id));
      const p = sim.state.player;
      return { cargo: p.cargo, comets: [...sim.state.sites.comets], nuggets: sim.state.mining.nuggets.map((n) => [n.id, n.resource, n.amount, n.body]), body: p.body };
    };
    expect(run()).toEqual(run());
  });

  it('comet positions come from the seed and the tick only (no saved state)', () => {
    const a = alongside().sim;
    const b = new Simulation({ seed: SEED, startDocked: false, generator: empty });
    b.state.tick = a.state.tick;
    const id = cometDefs(SEED)[0]!.id;
    a.state.sites.comets.set(id, { pass: 0, core: 5, tail: 3 });
    expect(cometAt(a.state.seed, id, a.state.tick)).toEqual(cometAt(b.state.seed, id, b.state.tick));
  });
});

describe('sighting', () => {
  it('a comet within radar range becomes known once (cometSighted) and leaves the signals', () => {
    const { sim, id } = alongside(0, 3_000, 40);
    sim.state.discovery.signals.push({ id, kind: 'comet', pos: { x: 0, y: 0 }, radius: 100, tick: sim.state.tick });
    const first = sim.step(IDLE_COMMAND);
    expect(first.filter((e) => e.type === 'cometSighted').map((e) => (e.type === 'cometSighted' ? e.id : ''))).toEqual([id]);
    expect(sim.state.discovery.known.has(id)).toBe(true);
    expect(sim.state.discovery.signals.some((s) => s.id === id)).toBe(false);
    expect(sim.step(IDLE_COMMAND).some((e) => e.type === 'cometSighted')).toBe(false);
  });
});

describe('composition read-out (veinAnalyzer)', () => {
  it('shows the mix and what is left within radar range, 2× with the Archive "Vein analyser"', async () => {
    const { cometReadout, cometAssayRange } = await import('./comets');
    const { radarRangeOf } = await import('../discovery/scanner');
    const { sim, id } = alongside(0, 3_000, 40);
    const pose = cometAt(SEED, id, sim.state.tick)!;
    const radar = radarRangeOf(sim.state);
    const v = Math.hypot(pose.vel.x, pose.vel.y);
    const far = (d: number) => ({ x: pose.pos.x - (pose.vel.y / v) * d, y: pose.pos.y + (pose.vel.x / v) * d });
    sim.state.player.body = { ...sim.state.player.body, pos: far(radar * 1.5) };
    expect(cometReadout(sim.state, id)).toBeNull();
    sim.state.discovery.archive.add('veinAnalyzer');
    expect(cometAssayRange(sim.state)).toBeCloseTo(2 * radar);
    sim.state.sites.comets.set(id, { pass: pose.pass, core: 60, tail: 0b101 });
    expect(cometReadout(sim.state, id)).toEqual({ mix: COMET.mix, core: COMET.budget - 60, budget: COMET.budget, shardsLeft: COMET.tail.shards - 2 });
  });
});
