// M4d T5: the link with a convoy trader (plan §2.5 "Link") – the port range, the relative speed and
// pirates near (each rejection), the pinned pose riding along the route, every way the link ends, and a
// save in the middle of the link (the hold is stateless: the same state continues exactly).
import { describe, expect, it } from 'vitest';
import { CONVOY } from '../../data/convoys';
import { createEnemy } from '../combat/enemies';
import { IDLE_COMMAND } from '../commands';
import { flyingAt, ofType, run } from '../discovery/testing';
import { normalizeAngle } from '../math/angle';
import type { Vec2 } from '../math/vec2';
import { Simulation } from '../Simulation';
import { chunkCoord } from '../world/chunks';
import { generateChunk, type ChunkGenerator } from '../world/generate';
import { act } from '../station/testHarness';
import { besideTrader, linkedTo, pressF } from './convoyTesting';
import { linkLatched, linkPose, tradePort } from './link';
import { convoyAt, convoyPassWindow, departureTick } from './schedule';

const SEED = 3;
const T = 60;
const PASS = 'cv:A@2';
const TICK = departureTick('A', 2) + 60 * T;

const pirateAt = (sim: Simulation, pos: Vec2): void => {
  sim.state.combat.enemies.push(createEnemy({ id: 'pr:test:0', kind: 'jackal', tier: 1, pos, angle: 0, home: pos, orbit: 1 }));
};

const poseGap = (sim: Simulation): number => {
  const pose = convoyAt(SEED, sim.state.convoys.link!.pass, sim.state.tick)!;
  const to = linkPose(pose, sim.state.player.props.boundingRadius);
  const b = sim.state.player.body;
  return Math.hypot(b.pos.x - to.pos.x, b.pos.y - to.pos.y);
};

describe('linking to a convoy trader', () => {
  it('links with F beside the trade port at the convoy speed', () => {
    const sim = besideTrader(SEED, PASS, TICK, 2);
    const events = pressF(sim);
    expect(ofType(events, 'convoyLinked')).toEqual([{ type: 'convoyLinked', pass: PASS }]);
    expect(ofType(events, 'linkRejected')).toEqual([]);
    expect(ofType(events, 'dockRejected')).toEqual([]);
    expect(sim.state.convoys.link).toEqual({ pass: PASS, since: TICK });
    expect(sim.state.player.dock.mode).toBe('flying');
  });

  it.each([
    ['tooFar', 6, { x: 0, y: 0 }],
    ['tooFast', 1, { x: 3, y: 0 }],
  ] as const)('refuses %s', (reason, gap, rel) => {
    const sim = besideTrader(SEED, PASS, TICK, gap, rel);
    const events = pressF(sim);
    const rejected = ofType(events, 'linkRejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe(reason);
    if (reason === 'tooFar') expect(rejected[0]!.distance).toBeCloseTo(gap, 0);
    if (reason === 'tooFast') expect(rejected[0]!.speed).toBeCloseTo(3, 1);
    expect(sim.state.convoys.link).toBeNull();
    // a refusal is the answer to F: no station dock attempt
    expect(ofType(events, 'dockRejected')).toEqual([]);
  });

  it('refuses with a pirate within 300 u, links with one farther away', () => {
    const sim = besideTrader(SEED, PASS, TICK, 1);
    const at = sim.state.player.body.pos;
    pirateAt(sim, { x: at.x + 290, y: at.y });
    expect(ofType(pressF(sim), 'linkRejected').map((e) => e.reason)).toEqual(['pirates']);
    const far = besideTrader(SEED, PASS, TICK, 1);
    const at2 = far.state.player.body.pos;
    pirateAt(far, { x: at2.x + 310, y: at2.y });
    expect(ofType(pressF(far), 'convoyLinked')).toHaveLength(1);
  });

  it('F away from every convoy is the usual station dock', () => {
    const sim = flyingAt(SEED, { x: 5000, y: -5000 });
    const events = pressF(sim);
    expect(ofType(events, 'linkRejected')).toEqual([]);
    expect(ofType(events, 'convoyLinked')).toEqual([]);
    expect(ofType(events, 'dockRejected')).toHaveLength(1);
  });

  it('a trader in its turn-around is not in play', () => {
    const w = convoyPassWindow(SEED, PASS)!;
    const sim = besideTrader(SEED, PASS, Math.ceil(w.turn) + 10 * T, 1);
    const events = pressF(sim);
    expect(ofType(events, 'convoyLinked')).toEqual([]);
    expect(ofType(events, 'linkRejected')).toEqual([]);
  });
});

describe('linked', () => {
  it('latches beside the port within ~1 s and rides along for 60 s without drift, thrust ignored', () => {
    const sim = linkedTo(SEED, 'A', 2, 60);
    run(sim, T);
    expect(poseGap(sim)).toBeLessThan(0.01);
    let worst = 0;
    let latched = 0;
    for (let i = 0; i < 60 * T; i++) {
      sim.step({ ...IDLE_COMMAND, flight: { forward: 1, strafe: 1, turn: 1 } });
      worst = Math.max(worst, poseGap(sim));
      if (linkLatched(sim.state)) latched++;
    }
    // exact between the corners of the route; at a corner it swings round the trader for a moment
    expect(latched / (60 * T)).toBeGreaterThan(0.7);
    expect(worst).toBeLessThan(5);
    expect(sim.state.convoys.link?.pass).toBe('cv:A@2');
    // the velocity is the convoy's, the heading the trader's (once latched)
    run(sim, 3 * T);
    const pose = convoyAt(SEED, 'cv:A@2', sim.state.tick)!;
    expect(sim.state.player.body.vel).toEqual(pose.vel);
    if (linkLatched(sim.state)) expect(sim.state.player.body.angle).toBeCloseTo(tradePort(pose).heading, 9);
  });

  it('a corner of the route swings the linked ship round smoothly – no sideways jump – and it latches again', () => {
    // the sharpest corner of the out leg (the trader's heading snaps there) with no other one 2 s after it
    const w = convoyPassWindow(SEED, PASS)!;
    const turnAt = (t: number): number => Math.abs(normalizeAngle(tradePort(convoyAt(SEED, PASS, t + 1)!).heading - tradePort(convoyAt(SEED, PASS, t)!).heading));
    let corner = -1;
    let sharpest = 0;
    for (let t = w.depart + 30 * T; t < w.turn - 30 * T; t++) {
      const d = turnAt(t);
      if (d <= sharpest) continue;
      let alone = true;
      for (let u = t + 1; u <= t + 2 * T && alone; u++) alone = turnAt(u) < 0.005;
      if (alone) {
        sharpest = d;
        corner = t;
      }
    }
    expect(sharpest).toBeGreaterThan(0.3);
    const sim = linkedTo(SEED, 'A', 2, Math.floor((corner - w.depart) / T) - 10);
    const bR = sim.state.player.props.boundingRadius;
    // the pinned pose itself jumps sideways there
    const pin = (t: number) => linkPose(convoyAt(SEED, PASS, t)!, bR).pos;
    const vel = convoyAt(SEED, PASS, corner + 1)!.vel;
    const pinJump = Math.hypot(pin(corner + 1).x - pin(corner).x - vel.x / T, pin(corner + 1).y - pin(corner).y - vel.y / T);
    expect(pinJump).toBeGreaterThan(2);
    let worstStep = 0;
    let worstTurn = 0;
    let latchedAt = -1;
    while (sim.state.tick < corner + 2 * T) {
      const before = sim.state.player.body;
      sim.step(IDLE_COMMAND);
      const b = sim.state.player.body;
      expect(sim.state.convoys.link?.pass).toBe(PASS);
      // the step beyond the convoy's own travel
      worstStep = Math.max(worstStep, Math.hypot(b.pos.x - before.pos.x - b.vel.x / T, b.pos.y - before.pos.y - b.vel.y / T));
      worstTurn = Math.max(worstTurn, Math.abs(normalizeAngle(b.angle - before.angle)));
      if (sim.state.tick > corner && latchedAt < 0 && linkLatched(sim.state)) latchedAt = sim.state.tick;
    }
    expect(worstStep).toBeLessThan(0.3);
    expect(worstTurn).toBeLessThanOrEqual(1.5 / T + 1e-9);
    expect(latchedAt).toBeGreaterThan(corner);
    expect(latchedAt - corner).toBeLessThan(2 * T);
  });

  it('F leaves the link, flying on with the convoy velocity', () => {
    const sim = linkedTo(SEED, 'A', 2, 60);
    run(sim, 30);
    const events = pressF(sim);
    expect(ofType(events, 'convoyUnlinked')).toEqual([{ type: 'convoyUnlinked', pass: 'cv:A@2', reason: 'player' }]);
    expect(sim.state.convoys.link).toBeNull();
    const pose = convoyAt(SEED, 'cv:A@2', sim.state.tick)!;
    expect(sim.state.player.body.vel.x).toBeCloseTo(pose.vel.x, 6);
    expect(sim.state.player.body.vel.y).toBeCloseTo(pose.vel.y, 6);
  });

  it('the convoyUnlink command leaves the link', () => {
    const sim = linkedTo(SEED, 'A', 2, 60);
    const events = act(sim, { type: 'convoyUnlink' });
    expect(events.find((e) => e.type === 'actionResult')).toMatchObject({ ok: true });
    expect(ofType(events, 'convoyUnlinked').map((e) => e.reason)).toEqual(['player']);
    expect(sim.state.convoys.link).toBeNull();
  });

  it('the turn-around ends the link', () => {
    const w = convoyPassWindow(SEED, 'cv:A@2')!;
    const seconds = Math.floor((w.turn - w.depart) / T) - 3;
    const sim = linkedTo(SEED, 'A', 2, seconds);
    const events = run(sim, 5 * T);
    expect(ofType(events, 'convoyUnlinked').map((e) => e.reason)).toEqual(['turnaround']);
    expect(sim.state.convoys.link).toBeNull();
  });

  it('a pirate coming within 300 u ends the link', () => {
    const sim = linkedTo(SEED, 'A', 2, 60);
    run(sim, 10);
    const at = sim.state.player.body.pos;
    pirateAt(sim, { x: at.x + 250, y: at.y });
    const events = run(sim, 1);
    expect(ofType(events, 'convoyUnlinked').map((e) => e.reason)).toEqual(['pirates']);
  });

  it('a destroyed or no longer flying ship is never linked (cleared silently)', () => {
    const dead = linkedTo(SEED, 'A', 2, 60);
    dead.state.player.destroyed = true;
    expect(ofType(run(dead, 1), 'convoyUnlinked')).toEqual([]);
    expect(dead.state.convoys.link).toBeNull();
    const docked = linkedTo(SEED, 'A', 2, 60);
    docked.enterDocked('st:0,0', docked.state.player.body);
    run(docked, 1);
    expect(docked.state.convoys.link).toBeNull();
  });

  it('a save in the middle of the latch continues exactly (the same state, the same poses)', () => {
    const sim = linkedTo(SEED, 'A', 2, 60);
    run(sim, 12);
    // "load": a fresh simulation with the saved link, tick and pose (prevBody = body, as a load does)
    const copy = new Simulation({ seed: SEED, startDocked: false });
    copy.state.tick = sim.state.tick;
    copy.state.player.body = { ...sim.state.player.body };
    copy.state.player.prevBody = copy.state.player.body;
    copy.state.world.update(copy.state.player.body.pos);
    copy.state.convoys.link = { ...sim.state.convoys.link! };
    for (let i = 0; i < 3 * T; i++) {
      sim.step(IDLE_COMMAND);
      copy.step(IDLE_COMMAND);
      expect(copy.state.player.body).toEqual(sim.state.player.body);
    }
    expect(copy.state.convoys.link).toEqual(sim.state.convoys.link);
  });

  it('is deterministic', () => {
    const a = linkedTo(42, 'B', 1, 200);
    const b = linkedTo(42, 'B', 1, 200);
    run(a, 2 * T);
    run(b, 2 * T);
    expect(a.state.player.body).toEqual(b.state.player.body);
  });

  it('a rock in the way of the pinned ship ends the link 1.5 s ahead and holds the ship back – never dragged through it', () => {
    const start = TICK + 30 * T;
    const bR = new Simulation({ seed: SEED, startDocked: false }).state.player.props.boundingRadius;
    // a rock right on the pinned pose 10 s later (the real world plus this one rock)
    const rock = linkPose(convoyAt(SEED, PASS, start + 10 * T)!, bR).pos;
    const generator: ChunkGenerator = (seed, cx, cy, gen) => {
      const chunk = generateChunk(seed, cx, cy, gen);
      if (cx !== chunkCoord(rock.x) || cy !== chunkCoord(rock.y)) return chunk;
      return { ...chunk, asteroids: [...chunk.asteroids, { id: `${cx},${cy}:999`, pos: rock, baseRadius: 2, resource: 'iron', initialAmount: 100, variant: 0 }] };
    };
    const sim = new Simulation({ seed: SEED, startDocked: false, generator });
    const pose = convoyAt(SEED, PASS, start + 1)!;
    const to = linkPose(pose, bR + 1);
    sim.state.tick = start;
    sim.state.player.body = { pos: to.pos, vel: { ...pose.vel }, angle: to.angle, angVel: 0 };
    sim.state.player.prevBody = sim.state.player.body;
    sim.state.world.update(to.pos);
    expect(ofType(pressF(sim), 'convoyLinked')).toHaveLength(1);
    let unlinked: string[] = [];
    for (let i = 0; i < 12 * T && unlinked.length === 0; i++) unlinked = ofType(sim.step(IDLE_COMMAND), 'convoyUnlinked').map((e) => e.reason);
    expect(unlinked).toEqual(['blocked']);
    expect(sim.state.convoys.link).toBeNull();
    // released 1.5 s before the hull would touch the rock (2.5 s before the centre reaches it), stopped
    expect(sim.state.tick - (start + 10 * T)).toBeGreaterThanOrEqual(-150);
    expect(sim.state.tick - (start + 10 * T)).toBeLessThanOrEqual(-90);
    expect(sim.state.player.body.vel).toEqual({ x: 0, y: 0 });
    const gap = (): number => Math.hypot(sim.state.player.body.pos.x - rock.x, sim.state.player.body.pos.y - rock.y) - 2 - bR;
    expect(gap()).toBeGreaterThan(5);
    run(sim, 10 * T);
    expect(gap()).toBeGreaterThan(5);
  });

  it('the link range is CONVOY.linkRange from the hull', () => {
    expect(ofType(pressF(besideTrader(SEED, PASS, TICK, CONVOY.linkRange - 0.5)), 'convoyLinked')).toHaveLength(1);
    expect(ofType(pressF(besideTrader(SEED, PASS, TICK, CONVOY.linkRange + 0.5)), 'linkRejected').map((e) => e.reason)).toEqual(['tooFar']);
  });
});
