import { describe, expect, it } from 'vitest';
import { COMET } from '../../data/sites';
import { cometAt, cometDefs, cometPassWindow, cometShards } from '../../sim/sites/comets';
import { QUALITY_PRESETS } from '../quality';
import {
  awayFromHome,
  COMET_LOOK,
  cometFade,
  cometLightsFor,
  dustTailDir,
  moverTarget,
  newlyMined,
  nucleusShrink,
  renderPose,
  sublimationRate,
  tailLength,
  tailYaw,
} from './cometLook';

const SEED = 1234;

/** A tick in the middle of the first pass of the seed's first comet. */
function midPass(): { id: string; tick: number; passTicks: number } {
  const def = cometDefs(SEED)[0]!;
  const w = cometPassWindow(SEED, def.id, 0)!;
  return { id: def.id, tick: Math.floor((w.start + w.end) / 2), passTicks: def.passTicks };
}

describe('renderPose', () => {
  it('runs from the previous step (alpha 0) to the current one (alpha 1)', () => {
    const { id, tick } = midPass();
    const prev = cometAt(SEED, id, tick - 1)!;
    const now = cometAt(SEED, id, tick)!;
    expect(renderPose(SEED, id, tick, 0)!.pos).toEqual(prev.pos);
    const end = renderPose(SEED, id, tick, 1)!;
    expect(end.pos.x).toBeCloseTo(now.pos.x, 9);
    expect(end.pos.y).toBeCloseTo(now.pos.y, 9);
    const mid = renderPose(SEED, id, tick, 0.5)!;
    expect(mid.pos.x).toBeCloseTo((prev.pos.x + now.pos.x) / 2, 9);
    expect(mid.t).toBeGreaterThan(prev.t);
    expect(mid.t).toBeLessThan(now.t);
  });

  it('keeps the side that exists at the pass ends', () => {
    const def = cometDefs(SEED)[0]!;
    const w = cometPassWindow(SEED, def.id, 0)!;
    // first tick of the pass: no previous pose
    expect(cometAt(SEED, def.id, w.start - 1)).toBeNull();
    expect(renderPose(SEED, def.id, w.start, 0.3)).toEqual(cometAt(SEED, def.id, w.start));
    // the pass has just ended: the last pose
    expect(cometAt(SEED, def.id, w.end)).toBeNull();
    expect(renderPose(SEED, def.id, w.end, 0.3)).toEqual(cometAt(SEED, def.id, w.end - 1));
  });
});

describe('tail geometry', () => {
  it('the ion tail points away from home, along the sim shards', () => {
    const { id, tick } = midPass();
    const pose = cometAt(SEED, id, tick)!;
    const axis = awayFromHome(pose.pos);
    expect(Math.hypot(axis.x, axis.y)).toBeCloseTo(1, 9);
    expect(axis.x * pose.pos.x + axis.y * pose.pos.y).toBeGreaterThan(0);
    // every shard lies behind the nucleus along that axis (the sim's own placement)
    for (const s of cometShards(pose)) {
      const along = (s.pos.x - pose.pos.x) * axis.x + (s.pos.y - pose.pos.y) * axis.y;
      expect(along).toBeGreaterThan(COMET.nucleusRadius);
      expect(along).toBeLessThanOrEqual(COMET.tail.length + 1e-9);
    }
  });

  it('tailYaw turns local −X onto the direction (world = x, h, −y)', () => {
    for (const dir of [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -0.6, y: 0.8 }]) {
      const yaw = tailYaw(dir);
      // rotation.y maps local +X to world (cos, 0, −sin); local −X = −that; back to sim (x, −z)
      const minusX = { x: -Math.cos(yaw), y: -Math.sin(yaw) };
      expect(minusX.x).toBeCloseTo(dir.x, 9);
      expect(minusX.y).toBeCloseTo(dir.y, 9);
    }
  });

  it('a faster comet drags a longer tail', () => {
    expect(tailLength(COMET.speed[0])).toBeCloseTo(COMET_LOOK.tailModelLength * COMET_LOOK.tailStretch[0]);
    expect(tailLength(COMET.speed[1])).toBeCloseTo(COMET_LOOK.tailModelLength * COMET_LOOK.tailStretch[1]);
    expect(tailLength(40)).toBeGreaterThan(tailLength(35));
    // never shorter than the shard tail
    expect(tailLength(0)).toBeGreaterThanOrEqual(COMET.tail.length);
  });

  it('the dust tail bends towards the trailing side', () => {
    const axis = { x: 1, y: 0 };
    const d = dustTailDir(axis, { x: 0, y: 40 });
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 9);
    expect(d.y).toBeLessThan(0);
    expect(Math.acos(d.x)).toBeCloseTo(COMET_LOOK.dustBend, 9);
    // flying straight along the axis: nothing to bend to
    expect(dustTailDir(axis, { x: 30, y: 0 })).toEqual(axis);
  });
});

describe('fade and shrink', () => {
  it('fades in and out at the pass ends, full in the middle', () => {
    const passTicks = 180 * 60;
    expect(cometFade(0, passTicks)).toBe(0);
    expect(cometFade(1, passTicks)).toBe(0);
    expect(cometFade(0.5, passTicks)).toBe(1);
    const third = (COMET_LOOK.fadeSeconds * 60) / 3 / passTicks;
    expect(cometFade(third, passTicks)).toBeGreaterThan(0);
    expect(cometFade(third, passTicks)).toBeLessThan(0.5);
    expect(cometFade(1 - third, passTicks)).toBeCloseTo(cometFade(third, passTicks), 9);
  });

  it('the nucleus shrinks as its core is mined, never below the minimum', () => {
    expect(nucleusShrink(COMET.budget)).toBe(1);
    expect(nucleusShrink(0)).toBeCloseTo(COMET_LOOK.minShrink, 9);
    expect(nucleusShrink(COMET.budget / 2)).toBeLessThan(1);
    expect(nucleusShrink(COMET.budget / 2)).toBeGreaterThan(nucleusShrink(COMET.budget / 4));
  });
});

describe('mining', () => {
  it('lists the shards mined since the last look', () => {
    expect(newlyMined(0, 0)).toEqual([]);
    expect(newlyMined(0b101, 0b101)).toEqual([]);
    expect(newlyMined(0b001, 0b1101)).toEqual([2, 3]);
    expect(newlyMined(0, 1 << 23)).toEqual([23]);
  });

  it('parses a mover id into the comet and the shard', () => {
    expect(moverTarget('cm:3')).toEqual({ id: 'cm:3', shard: null });
    expect(moverTarget('cm:3#12')).toEqual({ id: 'cm:3', shard: 12 });
  });
});

describe('quality', () => {
  it('a point light on High only, particles scale with the preset and reduced motion', () => {
    expect(cometLightsFor(QUALITY_PRESETS.high)).toBe(1);
    expect(cometLightsFor(QUALITY_PRESETS.medium)).toBe(0);
    expect(cometLightsFor(QUALITY_PRESETS.low)).toBe(0);
    expect(sublimationRate(1, false)).toBeGreaterThan(sublimationRate(0.35, false));
    expect(sublimationRate(1, true)).toBeLessThan(sublimationRate(1, false));
    expect(sublimationRate(0, false)).toBe(0);
  });
});
