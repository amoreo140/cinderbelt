import { describe, expect, it } from 'vitest';
import {
  applyEnvelope,
  ENV_FLOOR,
  envelopeDuration,
  envelopePoints,
  MIN_ATTACK,
  ParamSmoother,
  timeConstantFor,
} from './envelope';
import { FakeParam } from './testing/fakeAudio';

describe('envelopePoints', () => {
  it('starts and ends at zero and reaches the peak after attack', () => {
    const pts = envelopePoints({ peak: 0.5, attack: 0.01, release: 0.2 }, 1);
    expect(pts[0]).toEqual({ kind: 'set', time: 1, value: 0 });
    expect(pts[1]).toEqual({ kind: 'linear', time: 1.01, value: 0.5 });
    const last = pts[pts.length - 1]!;
    expect(last.value).toBe(0);
    expect(last.time).toBeCloseTo(1 + 0.01 + 0.2 + 0.005);
  });

  it('includes a hold segment when requested', () => {
    const pts = envelopePoints({ peak: 1, attack: 0.01, hold: 0.1, release: 0.1 }, 0);
    expect(pts).toContainEqual({ kind: 'linear', time: 0.11, value: 1 });
  });

  it('enforces a minimal attack so the sound never clicks', () => {
    const pts = envelopePoints({ peak: 1, attack: 0, release: 0.1 }, 0);
    expect(pts[1]!.time).toBe(MIN_ATTACK);
  });

  it('uses exponential release towards a non-zero floor', () => {
    const pts = envelopePoints({ peak: 1, attack: 0.01, release: 0.1 }, 0);
    const exp = pts.find((p) => p.kind === 'exp');
    expect(exp?.value).toBe(ENV_FLOOR);
  });

  it('times are monotonically non-decreasing', () => {
    const pts = envelopePoints({ peak: 0.3, attack: 0.02, hold: 0.05, release: 0.4 }, 2);
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.time).toBeGreaterThanOrEqual(pts[i - 1]!.time);
  });

  it('duration matches the scheduled points (minus the final tiny fade)', () => {
    const spec = { peak: 1, attack: 0.02, hold: 0.03, release: 0.5 };
    const pts = envelopePoints(spec, 0);
    expect(pts[pts.length - 2]!.time).toBeCloseTo(envelopeDuration(spec));
  });
});

describe('applyEnvelope', () => {
  it('schedules all points on the param and returns end time', () => {
    const p = new FakeParam(0);
    const end = applyEnvelope(p, { peak: 0.4, attack: 0.01, release: 0.1 }, 0);
    expect(p.calls.map((c) => c.method)).toEqual([
      'setValueAtTime',
      'linearRampToValueAtTime',
      'exponentialRampToValueAtTime',
      'linearRampToValueAtTime',
    ]);
    expect(end).toBeCloseTo(0.115);
  });
});

describe('timeConstantFor', () => {
  it('is a third of the ramp time and never zero', () => {
    expect(timeConstantFor(0.3)).toBeCloseTo(0.1);
    expect(timeConstantFor(0)).toBeGreaterThan(0);
  });
});

describe('ParamSmoother', () => {
  it('schedules only on meaningful changes', () => {
    const p = new FakeParam(0);
    const s = new ParamSmoother(p, { up: 0.1, down: 0.3, epsilon: 0.01 });
    expect(s.setTarget(0.5, 0)).toBe(true);
    expect(s.setTarget(0.505, 0.016)).toBe(false);
    expect(s.setTarget(0.6, 0.032)).toBe(true);
    expect(p.calls.filter((c) => c.method === 'setTargetAtTime')).toHaveLength(2);
  });

  it('uses the faster time constant going up and slower going down', () => {
    const p = new FakeParam(0);
    const s = new ParamSmoother(p, { up: 0.15, down: 0.6 });
    s.setTarget(1, 0);
    s.setTarget(0, 1);
    const tcs = p.calls.map((c) => c.args[2]);
    expect(tcs[0]).toBeCloseTo(0.05);
    expect(tcs[1]).toBeCloseTo(0.2);
  });

  it('jump cancels scheduled values and sets immediately', () => {
    const p = new FakeParam(0.7);
    const s = new ParamSmoother(p, { up: 0.1, down: 0.1 });
    s.jump(0, 2);
    expect(p.calls.map((c) => c.method)).toEqual(['cancelScheduledValues', 'setValueAtTime']);
    expect(s.target).toBe(0);
    expect(s.setTarget(0, 3)).toBe(false);
  });
});
