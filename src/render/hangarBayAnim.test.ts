import { describe, expect, it } from 'vitest';
import { BAY_RAIL_X, bayArmPose } from './hangarBayAnim';

describe('bayArmPose', () => {
  const frames = Array.from({ length: 60 * 120 }, (_, i) => i / 60);

  it('keeps the carriages on their rails and moves them smoothly', () => {
    for (const arm of [0, 1]) {
      let prev = bayArmPose(0, arm).x;
      for (const t of frames) {
        const { x } = bayArmPose(t, arm);
        expect(x).toBeGreaterThanOrEqual(BAY_RAIL_X[0]);
        expect(x).toBeLessThanOrEqual(BAY_RAIL_X[1]);
        expect(Math.abs(x - prev)).toBeLessThan(0.1);
        prev = x;
      }
    }
  });

  it('welds only while parked, in bursts, with a small head turn', () => {
    for (const arm of [0, 1]) {
      const poses = frames.map((t) => bayArmPose(t, arm));
      const welding = poses.filter((p) => p.welding).length / poses.length;
      expect(welding).toBeGreaterThan(0.15);
      expect(welding).toBeLessThan(0.5);
      for (let i = 1; i < poses.length; i++) {
        if (poses[i]!.welding) expect(poses[i]!.x).toBe(poses[i - 1]!.x);
        expect(Math.abs(poses[i]!.headYaw)).toBeLessThanOrEqual(0.32);
        expect(Math.abs(poses[i]!.headYaw - poses[i - 1]!.headYaw)).toBeLessThan(0.05);
      }
    }
  });

  it('never moves the two arms in step', () => {
    const same = frames.filter((t) => bayArmPose(t, 0).x === bayArmPose(t, 1).x).length;
    expect(same).toBeLessThan(frames.length / 20);
  });
});
