import { describe, expect, it } from 'vitest';
import { AMBIENT_RINGS } from '../ambientParams';
import { createGraph } from '../graph';
import { LASER_SPIN, LASER_TONES } from '../loopParams';
import { mulberry32 } from '../math';
import { FakeAudioContext, FakeOscillator } from '../testing/fakeAudio';
import { EngineThrustVoice } from './engineThrust';
import { MiningLaserVoice } from './miningLaser';
import { SpaceAmbienceVoice } from './spaceAmbience';

function makeGraph() {
  const ctx = new FakeAudioContext();
  const graph = createGraph(ctx as unknown as AudioContext, mulberry32(4));
  return { ctx, graph };
}

function newOscillators(ctx: FakeAudioContext, from: number): FakeOscillator[] {
  return ctx.nodes.slice(from).filter((n) => n instanceof FakeOscillator) as FakeOscillator[];
}

describe('EngineThrustVoice', () => {
  it('does not flood automation when the throttle is unchanged', () => {
    const { ctx, graph } = makeGraph();
    const start = ctx.nodes.length;
    const voice = new EngineThrustVoice(graph);
    voice.set({ main: 0.5, reverse: 0, side: 0 }, 0);
    const oscs = newOscillators(ctx, start);
    const count = () => oscs.reduce((s, o) => s + o.frequency.calls.length, 0);
    const afterFirst = count();
    for (let i = 1; i < 30; i++) voice.set({ main: 0.5, reverse: 0, side: 0 }, i / 60);
    expect(count()).toBe(afterFirst);
    voice.dispose();
    expect(oscs.every((o) => o.stopped)).toBe(true);
  });
});

describe('MiningLaserVoice', () => {
  it('spins up from a lower pitch to the resource tone', () => {
    const { ctx, graph } = makeGraph();
    const start = ctx.nodes.length;
    const voice = new MiningLaserVoice(graph);
    const base = newOscillators(ctx, start)[0]!;
    voice.set({ active: true, resource: 'ice' }, 1);
    const set = base.frequency.calls.find((c) => c.method === 'setValueAtTime');
    expect(set?.args[0]).toBeCloseTo(LASER_TONES.ice.baseHz * LASER_SPIN.startRatio);
    expect(base.frequency.lastTarget).toBeCloseTo(LASER_TONES.ice.baseHz);
  });

  it('keeps the last tuning when switched off without a resource', () => {
    const { ctx, graph } = makeGraph();
    const start = ctx.nodes.length;
    const voice = new MiningLaserVoice(graph);
    const base = newOscillators(ctx, start)[0]!;
    voice.set({ active: true, resource: 'titanium' }, 0);
    voice.set({ active: false }, 1);
    expect(base.frequency.lastTarget).toBeCloseTo(LASER_TONES.titanium.baseHz * LASER_SPIN.stopRatio);
  });
});

describe('SpaceAmbienceVoice', () => {
  it('is a non-tonal bed: no oscillators except slow LFOs, fades in and out, follows the ring', () => {
    const { ctx, graph } = makeGraph();
    const start = ctx.nodes.length;
    const bed = new SpaceAmbienceVoice(graph, AMBIENT_RINGS[1]);
    // only sub-audio LFOs – nothing that sounds a pitch
    for (const o of newOscillators(ctx, start)) expect(o.frequency.value).toBeLessThan(1);
    expect(bed.isRunning).toBe(false);
    bed.start(0);
    expect(bed.isRunning).toBe(true);
    bed.setParams(AMBIENT_RINGS[4], 1);
    expect(bed.ring).toBe(4);
    bed.stop(2);
    expect(bed.isRunning).toBe(false);
    bed.dispose();
  });
});
