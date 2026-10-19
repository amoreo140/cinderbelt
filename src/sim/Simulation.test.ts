import { oreGrade } from './mining/grade';
import { describe, expect, it } from 'vitest';
import { cargoUsed } from '../data/resources';
import { IDLE_COMMAND, type PlayerCommand } from './commands';
import { length, rotate, add, type Vec2 } from './math/vec2';
import { FUEL_PER_FORCE_SECOND } from './ship/fuel';
import { Simulation } from './Simulation';
import type { ChunkGenerator } from './world/generate';
import { homeStation } from './world/stations';

const forward: PlayerCommand = { ...IDLE_COMMAND, flight: { forward: 1, strafe: 0, turn: 0 } };
const toggle: PlayerCommand = { ...IDLE_COMMAND, toggleDampers: true };

function run(sim: Simulation, cmd: PlayerCommand, steps: number): void {
  for (let i = 0; i < steps; i++) sim.step(cmd);
}

/** Empty space (no asteroids or stations). */
const empty: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

const rockAt = (pos: Vec2, radius = 2, amount = 100): ChunkGenerator => (_s, cx, cy) => ({
  cx,
  cy,
  asteroids:
    cx === 0 && cy === 0
      ? [{ id: 'rock', pos, baseRadius: radius, resource: 'iron', initialAmount: amount, variant: 0 }]
      : [],
});

describe('Simulation – flight', () => {
  it('can start in flight at the origin with dampers on and full tanks', () => {
    const sim = new Simulation({ seed: 1, generator: empty, startDocked: false });
    const p = sim.state.player;
    expect(sim.state.tick).toBe(0);
    expect(sim.state.seed).toBe(1);
    expect(p.body.pos).toEqual({ x: 0, y: 0 });
    expect(p.dampers).toBe(true);
    expect(p.fuel).toBe(p.props.fuelCapacity);
    expect(p.energy).toBe(p.props.batteryCapacity);
    expect(cargoUsed(p.cargo)).toBe(0);
  });

  it('flies forward along +x', () => {
    const sim = new Simulation({ seed: 1, generator: empty });
    run(sim, forward, 60);
    expect(sim.state.tick).toBe(60);
    expect(sim.state.player.body.pos.x).toBeGreaterThan(1);
    expect(Math.abs(sim.state.player.body.pos.y)).toBeLessThan(1e-9);
  });

  it('stops after release with dampers on', () => {
    const sim = new Simulation({ seed: 1, generator: empty, startDocked: false });
    run(sim, forward, 60);
    run(sim, IDLE_COMMAND, 600);
    expect(length(sim.state.player.body.vel)).toBe(0);
  });

  it('keeps drifting with dampers off', () => {
    const sim = new Simulation({ seed: 1, generator: empty, startDocked: false });
    const events = sim.step(toggle);
    expect(events).toEqual([{ type: 'dampersToggled', on: false }]);
    run(sim, forward, 30);
    const speed = length(sim.state.player.body.vel);
    run(sim, IDLE_COMMAND, 120);
    expect(length(sim.state.player.body.vel)).toBeCloseTo(speed);
  });

  it('keeps the previous body for interpolation', () => {
    const sim = new Simulation({ seed: 1, generator: empty, startDocked: false });
    run(sim, forward, 10);
    const before = sim.state.player.body;
    sim.step(forward);
    expect(sim.state.player.prevBody).toBe(before);
  });

  it('records the local force for engine effects', () => {
    const sim = new Simulation({ seed: 1, generator: empty, startDocked: false });
    sim.step(forward);
    expect(sim.state.player.lastLocalForce.x).toBeGreaterThan(0);
  });

  it('loads the world around the player', () => {
    const sim = new Simulation({ seed: 1 });
    expect(sim.state.world.activeChunkCount).toBe(25);
    expect(sim.state.world.asteroids().length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const a = new Simulation({ seed: 5 });
    const b = new Simulation({ seed: 5 });
    const turnLeft: PlayerCommand = { ...IDLE_COMMAND, flight: { forward: 1, strafe: 0.5, turn: 1 } };
    for (const s of [a, b]) {
      s.step({ ...IDLE_COMMAND, actions: [{ reqId: 1, type: 'undock' }] });
      run(s, turnLeft, 90);
      run(s, IDLE_COMMAND, 30);
    }
    expect(a.state).toEqual(b.state);
  });
});

describe('Simulation – fuel', () => {
  it('burns fuel while thrusting', () => {
    const sim = new Simulation({ seed: 1, generator: empty, startDocked: false });
    const p = sim.state.player;
    run(sim, forward, 60);
    expect(p.fuel).toBeCloseTo(p.props.fuelCapacity - p.props.thrust.forward * FUEL_PER_FORCE_SECOND, 3);
  });

  it('cannot thrust without fuel but can still turn', () => {
    const sim = new Simulation({ seed: 1, generator: empty, startDocked: false });
    sim.state.player.fuel = 0;
    run(sim, forward, 30);
    expect(length(sim.state.player.body.vel)).toBe(0);
    sim.step({ ...IDLE_COMMAND, flight: { forward: 0, strafe: 0, turn: 1 } });
    expect(sim.state.player.body.angVel).toBeGreaterThan(0);
  });

  it('reports running out of fuel once', () => {
    const sim = new Simulation({ seed: 1, generator: empty, startDocked: false });
    sim.state.player.fuel = 0.001;
    const events = sim.step(forward);
    expect(events).toContainEqual({ type: 'outOfFuel' });
    expect(sim.state.player.fuel).toBe(0);
    expect(sim.step(forward)).not.toContainEqual({ type: 'outOfFuel' });
  });

  it('ignores emergency return with fuel left', () => {
    const sim = new Simulation({ seed: 1, generator: empty, startDocked: false });
    sim.state.player.body = { ...sim.state.player.body, pos: { x: 300, y: 0 } };
    sim.step({ ...IDLE_COMMAND, emergency: true });
    expect(sim.state.player.body.pos.x).toBe(300);
  });
});

describe('Simulation – mining and collisions', () => {
  it('mines an asteroid in front of the ship', () => {
    const sim = new Simulation({ seed: 1, generator: rockAt({ x: 9, y: 0 }), startDocked: false });
    run(sim, { ...IDLE_COMMAND, mining: true, aim: { x: 9, y: 0 } }, 60);
    const p = sim.state.player;
    const rate = p.props.lasers[0]!.rate;
    const rock = sim.state.world.asteroids()[0]!;
    // the hold gets rock × ore grade (Mining 2.0), the rock loses rock units
    expect(p.cargo.iron).toBeCloseTo(rate * oreGrade(1, rock), 5);
    expect(p.beams).toHaveLength(1);
    expect(sim.state.world.remaining(rock)).toBeCloseTo(100 - rate, 5);
  });

  it('applies the yield multiplier', () => {
    const sim = new Simulation({ seed: 1, generator: rockAt({ x: 9, y: 0 }), settings: { miningYield: 2 }, startDocked: false });
    run(sim, { ...IDLE_COMMAND, mining: true, aim: { x: 9, y: 0 } }, 60);
    const grade = oreGrade(1, sim.state.world.asteroids()[0]!);
    expect(sim.state.player.cargo.iron).toBeCloseTo(2 * sim.state.player.props.lasers[0]!.rate * grade, 5);
  });

  it('clears beams when not mining', () => {
    const sim = new Simulation({ seed: 1, generator: rockAt({ x: 9, y: 0 }), startDocked: false });
    sim.step({ ...IDLE_COMMAND, mining: true, aim: { x: 9, y: 0 } });
    sim.step(IDLE_COMMAND);
    expect(sim.state.player.beams).toEqual([]);
  });

  it('reports full cargo', () => {
    const sim = new Simulation({ seed: 1, generator: rockAt({ x: 9, y: 0 }), startDocked: false });
    const p = sim.state.player;
    p.cargo.ice = p.props.cargoCapacity - 0.01;
    const events = sim.step({ ...IDLE_COMMAND, mining: true, aim: { x: 9, y: 0 } });
    expect(events).toContainEqual({ type: 'cargoFull' });
    expect(cargoUsed(p.cargo)).toBeCloseTo(p.props.cargoCapacity);
  });

  it('regenerates energy up to the battery capacity', () => {
    const sim = new Simulation({ seed: 1, generator: empty, startDocked: false });
    const p = sim.state.player;
    p.energy = 0;
    run(sim, IDLE_COMMAND, 60);
    expect(p.energy).toBeCloseTo(p.props.energyGen, 5);
    run(sim, IDLE_COMMAND, 6000);
    expect(p.energy).toBe(p.props.batteryCapacity);
  });

  it('cannot fly through a station and reports the impact', () => {
    const station = { ...homeStation(), id: 'st:0,0', pos: { x: 20, y: 0 }, colliders: [{ pos: { x: 0, y: 0 }, radius: 5 }] };
    const sim = new Simulation({ seed: 1, generator: (_s, cx, cy) => ({ cx, cy, asteroids: [], ...(cx === 0 && cy === 0 ? { station } : {}) }), startDocked: false });
    const events = [];
    for (let i = 0; i < 300; i++) events.push(...sim.step(forward));
    const p = sim.state.player;
    for (const offset of p.props.cellOffsets) {
      const cell = add(p.body.pos, rotate(offset, p.body.angle));
      expect(Math.hypot(cell.x - 20, cell.y)).toBeGreaterThan(5 + 0.5 - 0.05);
    }
    expect(events.some((e) => e.type === 'collision')).toBe(true);
  });

  it('stops the mining beam at a station', () => {
    const station = { ...homeStation(), id: 'st:0,0', pos: { x: 7, y: 0 }, colliders: [{ pos: { x: 0, y: 0 }, radius: 1 }] };
    const sim = new Simulation({
      seed: 1,
      generator: (s, cx, cy) => ({ ...rockAt({ x: 11, y: 0 })(s, cx, cy), ...(cx === 0 && cy === 0 ? { station } : {}) }),
      startDocked: false,
    });
    run(sim, { ...IDLE_COMMAND, mining: true, aim: { x: 11, y: 0 } }, 30);
    const p = sim.state.player;
    expect(p.cargo.iron).toBe(0);
    expect(p.beams[0]!.asteroidId).toBeNull();
    expect(p.beams[0]!.to.x).toBeCloseTo(6);
  });

  it('cannot fly through an asteroid', () => {
    const sim = new Simulation({ seed: 1, generator: rockAt({ x: 7, y: 0 }), startDocked: false });
    run(sim, forward, 300);
    const p = sim.state.player;
    for (const offset of p.props.cellOffsets) {
      const cell = add(p.body.pos, rotate(offset, p.body.angle));
      expect(Math.hypot(cell.x - 7, cell.y)).toBeGreaterThan(2 + 0.5 - 0.05);
    }
  });
});
