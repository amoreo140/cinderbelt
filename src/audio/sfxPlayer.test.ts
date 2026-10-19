import { describe, expect, it } from 'vitest';
import { createGraph } from './graph';
import { mulberry32 } from './math';
import { impactRecipe, type SfxEvent } from './recipes';
import { MAX_ONE_SHOTS, playRecipe } from './sfxPlayer';
import { FakeAudioContext, FakeBufferSource, FakeGain, FakeOscillator } from './testing/fakeAudio';

function makeGraph() {
  const ctx = new FakeAudioContext();
  const graph = createGraph(ctx as unknown as AudioContext, mulberry32(9));
  return { ctx, graph };
}

const TONE: SfxEvent = { type: 'tone', at: 0.1, wave: 'sine', freq: 440, freqEnd: 220, gain: 0.3, attack: 0.01, release: 0.2, send: 0.5 };

describe('playRecipe', () => {
  it('schedules a tone with glide, envelope and stop time', () => {
    const { ctx, graph } = makeGraph();
    ctx.currentTime = 1;
    expect(playRecipe(graph, graph.sfx, [TONE], { when: 2 })).toBe(true);
    const osc = ctx.nodes.find((n) => n instanceof FakeOscillator) as FakeOscillator;
    expect(osc.started).toBe(true);
    expect(osc.stopped).toBe(true);
    expect(osc.frequency.calls[0]).toEqual({ method: 'setValueAtTime', args: [440, 2.1] });
    expect(osc.frequency.calls[1]!.method).toBe('exponentialRampToValueAtTime');
    expect(osc.frequency.calls[1]!.args[0]).toBe(220);
  });

  it('routes the send into the channel wet bus', () => {
    const { graph } = makeGraph();
    playRecipe(graph, graph.sfx, [TONE]);
    const wet = graph.sfx.wet as unknown as FakeGain;
    const ctx = wet.ctx;
    const senders = ctx.nodes.filter((n) => n.connections.includes(wet));
    expect(senders.length).toBe(1);
  });

  it('uses looped noise for noise events', () => {
    const { ctx, graph } = makeGraph();
    playRecipe(graph, graph.sfx, impactRecipe(0.5));
    const noise = ctx.nodes.filter((n) => n instanceof FakeBufferSource) as FakeBufferSource[];
    expect(noise.length).toBe(1);
    expect(noise[0]!.loop).toBe(true);
    expect(noise[0]!.buffer).not.toBeNull();
  });

  it('caps polyphony and frees slots when sounds end', () => {
    const { ctx, graph } = makeGraph();
    for (let i = 0; i < MAX_ONE_SHOTS; i++) expect(playRecipe(graph, graph.sfx, [TONE])).toBe(true);
    expect(playRecipe(graph, graph.sfx, [TONE])).toBe(false);
    const osc = ctx.nodes.find((n) => n instanceof FakeOscillator) as FakeOscillator;
    osc.onended?.();
    expect(graph.activeOneShots).toBe(MAX_ONE_SHOTS - 1);
    expect(playRecipe(graph, graph.sfx, [TONE])).toBe(true);
  });

  it('ignores empty recipes', () => {
    const { graph } = makeGraph();
    expect(playRecipe(graph, graph.sfx, [])).toBe(false);
  });
});
