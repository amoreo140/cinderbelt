// M4b T5: Archive "Tractor beam+" (`tractorPlus`) – tractor range ×1.5 and wrecks 2 parts larger.
import { describe, expect, it } from 'vitest';
import { PART_DEFS } from '../../data/parts';
import { TOW_BREAK, TRACTOR_PLUS } from '../../data/salvage';
import { createWreck, emptyLoot } from '../combat/wrecks';
import { flyingAt, ofType, run } from '../discovery/testing';
import type { Vec2 } from '../math/vec2';
import { createGrid } from '../ship/grid';
import { computeProperties } from '../ship/properties';
import type { Simulation } from '../Simulation';
import { createContainer } from './containers';
import { playerTractorPower, tractorPower } from './tractor';

const SEED = 4242;

const salvager = () =>
  createGrid([
    ['cockpit', 0, 0],
    ['miningLaser', 1, 0],
    ['tractorBeam', 0, 1],
    ['reactor', -1, 0],
    ['cargo', 0, -1],
    ['engine', -2, 0],
  ]);

/** A quiet spot near home: no rocks, no stations (deterministic for SEED). */
function quietSpot(): Vec2 {
  const probe = flyingAt(SEED, { x: 0, y: 400 });
  for (let r = 320; r < 560; r += 20) {
    for (let a = 0; a < 64; a++) {
      const p = { x: Math.cos(a / 10) * r, y: Math.sin(a / 10) * r };
      probe.state.world.update(p);
      if (probe.state.world.circlesNear(p, 90).length > 0) continue;
      if (probe.state.world.stationCirclesNear(p, 220).length > 0) continue;
      return p;
    }
  }
  throw new Error('no quiet spot');
}
const Q = quietSpot();

const withPlus = (sim: Simulation): Simulation => {
  sim.state.discovery.archive.add('tractorPlus');
  return sim;
};

/** A container `gap` u from the ship's hull, straight up. */
function containerAt(sim: Simulation, gap: number) {
  const r = sim.state.player.props.boundingRadius;
  const c = createContainer(sim.state.combat.nextId++, { x: Q.x, y: Q.y + r + 0.9 + gap }, { x: 0, y: 0 }, emptyLoot());
  sim.state.combat.containers.push(c);
  return c;
}

const T1 = PART_DEFS.tractorBeam[1].tractor!;

describe('tractorPlus', () => {
  it('scales the beam: range ×1.5, maxParts +2', () => {
    const mounts = computeProperties(salvager()).tractors;
    const plain = tractorPower(mounts)!;
    const plus = tractorPower(mounts, true)!;
    expect(plain.range).toBe(T1.range);
    expect(plus.range).toBe(T1.range * TRACTOR_PLUS.rangeMult);
    expect(plus.maxParts).toBe(T1.maxParts + TRACTOR_PLUS.maxPartsBonus);
    expect(plus.pull).toBe(plain.pull);
    const sim = flyingAt(SEED, Q, salvager());
    expect(playerTractorPower(sim.state)!.range).toBe(plain.range);
    expect(playerTractorPower(withPlus(sim).state)!.range).toBe(plus.range);
  });

  it('locks onto and holds an object beyond the plain reach', () => {
    const gap = T1.range * 1.3;
    const plain = flyingAt(SEED, Q, salvager());
    const c0 = containerAt(plain, gap);
    expect(ofType(run(plain, 1, { tractor: true, aim: c0.body.pos }), 'tractorFailed')[0]).toMatchObject({ reason: 'noTarget' });
    const plus = withPlus(flyingAt(SEED, Q, salvager()));
    const c1 = containerAt(plus, gap);
    expect(ofType(run(plus, 1, { tractor: true, aim: c1.body.pos }), 'tractorLocked')).toHaveLength(1);
    // beyond the plain break distance the upgraded beam still holds and pulls it in
    expect(gap).toBeGreaterThan(T1.range * TOW_BREAK);
    expect(ofType(run(plus, 120), 'tractorReleased')).toHaveLength(0);
    expect(plus.state.player.tractor).not.toBeNull();
  });

  it('pulls a wreck 2 parts larger whole', () => {
    const five = createGrid([
      ['cockpit', 0, 0],
      ['armor', 1, 0],
      ['armor', 2, 0],
      ['armor', 3, 0],
      ['armor', 4, 0],
    ]);
    const place = (sim: Simulation) => {
      const source = { body: { pos: { x: Q.x, y: Q.y + 14 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 }, props: { centerOfMass: { x: 2, y: 0 } } };
      const w = createWreck(sim.state.combat.nextId++, five.parts, source, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'pirate');
      sim.state.combat.wrecks.push(w);
      return w;
    };
    const plain = flyingAt(SEED, Q, salvager());
    const w0 = place(plain);
    expect(ofType(run(plain, 1, { tractor: true, aim: w0.body.pos }), 'tractorFailed')[0]).toMatchObject({ reason: 'tooHeavy' });
    const plus = withPlus(flyingAt(SEED, Q, salvager()));
    const w1 = place(plus);
    expect(ofType(run(plus, 1, { tractor: true, aim: w1.body.pos }), 'tractorLocked')[0]).toMatchObject({ rip: false });
  });
});
