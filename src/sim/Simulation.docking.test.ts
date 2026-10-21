import { describe, expect, it } from 'vitest';
import { STARTING_CREDITS } from '../data/economy';
import { normalizeAngle } from './math/angle';
import { IDLE_COMMAND, type GameAction, type GameActionInput, type PlayerCommand } from './commands';
import { createBody } from './physics/body';
import { Simulation, type SimEvent } from './Simulation';
import { DOCK_RULES, DOCKING_COMPUTER_RULES, DOCKING_TICKS, dockPoint, dockPose } from './station/dock';
import type { ChunkGenerator } from './world/generate';
import { HOME_STATION_ID, homeStation } from './world/stations';

/** Only the home station, no asteroids. */
const homeOnly: ChunkGenerator = (_s, cx, cy) => ({
  cx,
  cy,
  asteroids: [],
  ...(cx === 0 && cy === 0 ? { station: homeStation() } : {}),
});

const action = (a: GameActionInput, reqId = 1) => ({ ...IDLE_COMMAND, actions: [{ ...a, reqId } as GameAction] });
const undock = action({ type: 'undock' });
const dock: PlayerCommand = { ...IDLE_COMMAND, dock: true };

function newGame(): Simulation {
  return new Simulation({ seed: 1, generator: homeOnly });
}

/**
 * The ship `off` units out from the home station's docking point along the dock axis (+x), its bow
 * `turn` rad off the station-facing heading, moving at `speed` along +y.
 */
function flyingAt(sim: Simulation, off: number, speed = 0, turn = 0): void {
  sim.step(undock);
  const p = sim.state.player;
  const point = dockPoint(homeStation(), p.props.boundingRadius);
  const body = { ...createBody({ x: point.x + off, y: point.y }, Math.PI + turn), vel: { x: 0, y: speed } };
  p.body = body;
  p.prevBody = body;
}

function run(sim: Simulation, cmd: PlayerCommand, steps: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) events.push(...sim.step(cmd));
  return events;
}

describe('new game', () => {
  it('starts docked at the home station with starting credits and armor in storage', () => {
    const sim = newGame();
    const { player, credits, stations } = sim.state;
    expect(player.dock).toEqual({ mode: 'docked', stationId: HOME_STATION_ID });
    expect(credits).toBe(STARTING_CREDITS);
    expect(stations.get(HOME_STATION_ID)?.parts).toEqual({ 'armor:1': 2, 'cannon:1': 1 });
    const pose = dockPose(homeStation(), player.props.boundingRadius);
    expect(player.body).toEqual(pose);
    expect(player.prevBody).toEqual(pose);
    expect(player.fuel).toBe(player.props.fuelCapacity);
    expect(sim.state.world.discovered.has(HOME_STATION_ID)).toBe(true);
  });

  it('can start in flight for tests', () => {
    const sim = new Simulation({ seed: 1, generator: homeOnly, startDocked: false });
    expect(sim.state.player.dock).toEqual({ mode: 'flying' });
  });
});

describe('undocking', () => {
  it('leaves facing away from the station with zero speed and dampers on', () => {
    const sim = newGame();
    sim.state.player.dampers = false;
    const events = sim.step(undock);
    const p = sim.state.player;
    expect(events).toContainEqual({ type: 'undocked', stationId: HOME_STATION_ID });
    expect(events).toContainEqual({ type: 'actionResult', reqId: 1, ok: true });
    expect(p.dock.mode).toBe('flying');
    expect(p.body.angle).toBe(0);
    expect(p.body.vel).toEqual({ x: 0, y: 0 });
    expect(p.dampers).toBe(true);
  });

  it('does not dock again in the same step', () => {
    const sim = newGame();
    const events = sim.step({ ...undock, dock: true });
    expect(sim.state.player.dock.mode).toBe('flying');
    expect(events.some((e) => e.type === 'dockingStarted')).toBe(false);
  });

  it('rejects station actions in flight with notDocked', () => {
    const sim = newGame();
    sim.step(undock);
    const before = structuredClone({ credits: sim.state.credits, cargo: sim.state.player.cargo });
    const events = sim.step(action({ type: 'undock' }, 7));
    expect(events).toContainEqual({ type: 'actionResult', reqId: 7, ok: false, reason: 'notDocked' });
    const events2 = sim.step(action({ type: 'sellResource', resource: 'iron', qty: 'all', from: 'ship' }, 8));
    expect(events2).toContainEqual({ type: 'actionResult', reqId: 8, ok: false, reason: 'notDocked' });
    expect({ credits: sim.state.credits, cargo: sim.state.player.cargo }).toEqual(before);
  });
});

describe('docking', () => {
  it('rejects a dock request beyond the clamp range with the distance', () => {
    const sim = newGame();
    flyingAt(sim, DOCK_RULES.range + 0.5);
    const rejected = sim.step(dock).find((e) => e.type === 'dockRejected');
    expect(rejected).toMatchObject({ type: 'dockRejected', reason: 'tooFar' });
    if (rejected?.type === 'dockRejected') expect(rejected.distance).toBeCloseTo(DOCK_RULES.range + 0.5, 1);
    expect(sim.state.player.dock.mode).toBe('flying');
  });

  it('accepts a dock request exactly at the clamp range', () => {
    const sim = newGame();
    flyingAt(sim, DOCK_RULES.range);
    expect(sim.step(dock)).toContainEqual({ type: 'dockingStarted', stationId: HOME_STATION_ID });
    expect(sim.state.player.dock.mode).toBe('docking');
  });

  it('no longer docks anywhere around the hull: 12 u from the far side is too far', () => {
    const sim = newGame();
    sim.step(undock);
    const p = sim.state.player;
    const body = createBody({ x: -(14 + p.props.boundingRadius + 3), y: 0 }, 0);
    p.body = body;
    p.prevBody = body;
    expect(sim.step(dock)).toContainEqual(expect.objectContaining({ type: 'dockRejected', reason: 'tooFar' }));
  });

  it('accepts exactly the maximum speed and rejects faster ships', () => {
    const ok = newGame();
    flyingAt(ok, 1, DOCK_RULES.maxSpeed);
    expect(ok.step(dock)).toContainEqual({ type: 'dockingStarted', stationId: HOME_STATION_ID });
    const fast = newGame();
    flyingAt(fast, 1, DOCK_RULES.maxSpeed + 0.05);
    const rejected = fast.step(dock).find((e) => e.type === 'dockRejected');
    expect(rejected).toMatchObject({ reason: 'tooFast' });
    if (rejected?.type === 'dockRejected') expect(rejected.speed).toBeCloseTo(DOCK_RULES.maxSpeed + 0.05, 1);
  });

  it('docks at any heading and the latch turns the ship the shorter way into the dock heading', () => {
    for (const turn of [1, -0.55, Math.PI, 2.9, -2.9]) {
      const sim = newGame();
      flyingAt(sim, 1, 0, turn);
      const start = sim.state.player.body.angle;
      expect(sim.step(dock)).toContainEqual({ type: 'dockingStarted', stationId: HOME_STATION_ID });
      const to = dockPose(homeStation(), sim.state.player.props.boundingRadius).angle;
      let prev = Math.abs(normalizeAngle(start - to));
      let travelled = 0;
      for (let i = 0; i < DOCKING_TICKS && sim.state.player.dock.mode === 'docking'; i++) {
        sim.step(IDLE_COMMAND);
        const left = Math.abs(normalizeAngle(sim.state.player.body.angle - to));
        expect(left, `turn ${turn} tick ${i}`).toBeLessThanOrEqual(prev + 1e-9);
        travelled += prev - left;
        prev = left;
      }
      expect(sim.state.player.dock.mode).toBe('docked');
      expect(sim.state.player.body.angle).toBeCloseTo(to);
      expect(travelled).toBeLessThanOrEqual(Math.PI + 1e-6);
    }
  });

  it('the docking computer from the Archive relaxes the rules (12 u, 6 u/s, any heading)', () => {
    const sim = newGame();
    flyingAt(sim, 11, 5.5, Math.PI);
    expect(sim.step(dock)).toContainEqual(expect.objectContaining({ type: 'dockRejected', reason: 'tooFar' }));
    sim.state.discovery.archive.add('dockingComputer');
    expect(sim.step(dock)).toContainEqual({ type: 'dockingStarted', stationId: HOME_STATION_ID });
    run(sim, IDLE_COMMAND, DOCKING_TICKS);
    expect(sim.state.player.dock).toEqual({ mode: 'docked', stationId: HOME_STATION_ID });
    expect(sim.state.player.body).toEqual(dockPose(homeStation(), sim.state.player.props.boundingRadius));
    const far = newGame();
    far.state.discovery.archive.add('dockingComputer');
    flyingAt(far, DOCKING_COMPUTER_RULES.range + 0.5);
    expect(far.step(dock)).toContainEqual(expect.objectContaining({ type: 'dockRejected', reason: 'tooFar' }));
  });

  it('reports noStation far from any station', () => {
    const sim = newGame();
    sim.step(undock);
    const body = createBody({ x: 3000, y: 0 });
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
    sim.step(IDLE_COMMAND);
    expect(sim.step(dock)).toContainEqual(expect.objectContaining({ type: 'dockRejected', reason: 'noStation' }));
  });

  it('animates for 60 steps and ends exactly in the dock pose', () => {
    const sim = newGame();
    flyingAt(sim, 3, 2);
    const p = sim.state.player;
    p.energy = 0;
    const forward: PlayerCommand = { ...IDLE_COMMAND, flight: { forward: 1, strafe: 1, turn: 1 }, mining: true };
    sim.step(dock);
    const midway = run(sim, forward, DOCKING_TICKS - 2);
    expect(p.dock.mode).toBe('docking');
    expect(midway.some((e) => e.type === 'docked')).toBe(false);
    expect(p.beams).toEqual([]);
    const last = sim.step(forward);
    expect(last).toContainEqual({ type: 'docked', stationId: HOME_STATION_ID });
    expect(p.dock).toEqual({ mode: 'docked', stationId: HOME_STATION_ID });
    expect(p.body).toEqual(dockPose(homeStation(), p.props.boundingRadius));
    expect(p.prevBody).toEqual(p.body);
    expect(p.energy).toBe(p.props.batteryCapacity);
  });

  it('moves smoothly towards the pose during the animation', () => {
    const sim = newGame();
    flyingAt(sim, 3.5, 0, 0.4);
    const p = sim.state.player;
    const target = dockPose(homeStation(), p.props.boundingRadius).pos;
    sim.step(dock);
    let last = Math.hypot(p.body.pos.x - target.x, p.body.pos.y - target.y);
    for (let i = 1; i < DOCKING_TICKS; i++) {
      sim.step(IDLE_COMMAND);
      const d = Math.hypot(p.body.pos.x - target.x, p.body.pos.y - target.y);
      expect(d).toBeLessThanOrEqual(last + 1e-9);
      if (i < DOCKING_TICKS - 1) expect(p.prevBody).not.toBe(p.body);
      last = d;
    }
    expect(last).toBe(0);
  });

  it('keeps the ship frozen while docked whatever the input', () => {
    const sim = newGame();
    const p = sim.state.player;
    const body = p.body;
    const fuel = p.fuel;
    const inputs: PlayerCommand[] = [
      { ...IDLE_COMMAND, flight: { forward: 1, strafe: -1, turn: 1 } },
      { ...IDLE_COMMAND, mining: true, aim: { x: 30, y: 0 } },
      { ...IDLE_COMMAND, toggleDampers: true },
      { ...IDLE_COMMAND, emergency: true },
      dock,
    ];
    const tick = sim.state.tick;
    for (let i = 0; i < 300; i++) sim.step(inputs[i % inputs.length]!);
    expect(p.body).toEqual(body);
    expect(p.prevBody).toEqual(body);
    expect(p.fuel).toBe(fuel);
    expect(p.dampers).toBe(true);
    expect(p.beams).toEqual([]);
    expect(p.dock.mode).toBe('docked');
    expect(sim.state.tick).toBe(tick + 300);
  });

  it('docks at the station with the nearest docking point', () => {
    const near = { ...homeStation(), id: 'st:1,0', pos: { x: 250, y: 100 }, chunk: { cx: 1, cy: 0 } };
    const far = { ...homeStation(), id: 'st:1,1', pos: { x: 250, y: 140 }, chunk: { cx: 1, cy: 0 } };
    const gen: ChunkGenerator = (_s, cx, cy) => ({
      cx,
      cy,
      asteroids: [],
      ...(cx === 1 && cy === 0 ? { station: near } : cx === 1 && cy === 1 ? { station: { ...far, pos: { x: 250, y: 205 } } } : {}),
    });
    const sim = new Simulation({ seed: 1, generator: gen, startDocked: false });
    // both docking points (port angle 0, along +x) are 2 u apart in x; the near one is closer
    const bR = sim.state.player.props.boundingRadius;
    const body = createBody({ x: 250 + 14 + bR + 1 + 2, y: 103 }, Math.PI);
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
    expect(sim.step(dock)).toContainEqual({ type: 'dockingStarted', stationId: 'st:1,0' });
  });
});
