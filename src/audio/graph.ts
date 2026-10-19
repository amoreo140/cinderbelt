// Shared audio graph: master → compressor → output, the SFX/ambient channels and the reverb.

import {
  DEFAULT_REVERB,
  fillBrownNoise,
  fillCrackle,
  fillImpulseResponse,
  fillPinkNoise,
  fillWhiteNoise,
  applyLoopFade,
} from './buffers';
import type { Rng } from './math';
import type { NoiseColor } from './recipes';

/**
 * A channel with a dry and a "wet" (into the reverb) branch. The channel volume is set
 * on both, so a muted channel is not heard in the reverb either.
 */
export interface Channel {
  dry: GainNode;
  wet: GainNode;
}

export interface NoiseBank {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
  crackle: AudioBuffer;
}

export interface AudioGraph {
  ctx: BaseAudioContext;
  master: GainNode;
  sfx: Channel;
  ambient: Channel;
  /** Pre-rendered music (its files carry their own reverb, so there is no send). */
  music: GainNode;
  noise: NoiseBank;
  rand: Rng;
  /** Number of one-shot sounds playing right now (overload guard). */
  activeOneShots: number;
}

export const REVERB_RETURN_GAIN = 0.35;
const NOISE_SECONDS = 4;

export function createMonoBuffer(ctx: BaseAudioContext, seconds: number, fill: (data: Float32Array, sampleRate: number) => void): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  fill(buffer.getChannelData(0), ctx.sampleRate);
  return buffer;
}

export function createNoiseBank(ctx: BaseAudioContext, rand: Rng): NoiseBank {
  const steps = noiseBankSteps(ctx, rand);
  for (const step of steps.steps) step();
  return steps.bank();
}

/**
 * The noise bank as separate steps (one buffer each). The order of the steps is the order in
 * which the shared random generator is consumed, so the result is the same as building at once.
 */
function noiseBankSteps(ctx: BaseAudioContext, rand: Rng): { steps: (() => void)[]; bank: () => NoiseBank } {
  const loopFade = (data: Float32Array, sr: number) => applyLoopFade(data, Math.floor(sr * 0.02));
  const bank: Partial<NoiseBank> = {};
  return {
    steps: [
      () => (bank.white = createMonoBuffer(ctx, NOISE_SECONDS, (d) => fillWhiteNoise(d, rand))),
      () =>
        (bank.pink = createMonoBuffer(ctx, NOISE_SECONDS, (d, sr) => {
          fillPinkNoise(d, rand);
          loopFade(d, sr);
        })),
      () =>
        (bank.brown = createMonoBuffer(ctx, NOISE_SECONDS, (d, sr) => {
          fillBrownNoise(d, rand);
          loopFade(d, sr);
        })),
      () => (bank.crackle = createMonoBuffer(ctx, 3, (d, sr) => fillCrackle(d, sr, rand))),
    ],
    bank: () => bank as NoiseBank,
  };
}

function createChannel(ctx: BaseAudioContext, master: AudioNode, reverb: AudioNode): Channel {
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.connect(master);
  wet.connect(reverb);
  return { dry, wet };
}

/**
 * Builds the graph piece by piece: each `step()` does one bounded chunk of work (one noise
 * buffer, one reverb channel, the convolver setup) and returns true once the graph is complete.
 * The game runs the steps in idle time before the first user gesture, so the gesture itself only
 * resumes the context (audit 2026-10-16, issue #7). `finish()` runs whatever is left at once.
 */
export interface GraphBuilder {
  readonly ctx: BaseAudioContext;
  readonly done: boolean;
  step(): boolean;
  finish(): AudioGraph;
}

export function createGraphBuilder(ctx: BaseAudioContext, rand: Rng): GraphBuilder {
  // the reverb impulse response comes first – the same random sequence as the original one-shot build
  const irLength = Math.floor(ctx.sampleRate * DEFAULT_REVERB.seconds);
  let ir: AudioBuffer | null = null;
  let convolver: ConvolverNode | null = null;
  const noise = noiseBankSteps(ctx, rand);
  let graph: AudioGraph | null = null;
  const steps: (() => void)[] = [
    () => {
      ir = ctx.createBuffer(2, irLength, ctx.sampleRate);
      fillImpulseResponse(ir.getChannelData(0), ctx.sampleRate, rand);
    },
    () => fillImpulseResponse(ir!.getChannelData(1), ctx.sampleRate, rand),
    () => {
      // setting the buffer prepares the FFT partitions synchronously – the most expensive single step
      convolver = ctx.createConvolver();
      convolver.buffer = ir;
    },
    ...noise.steps,
    () => (graph = assembleGraph(ctx, rand, convolver!, noise.bank())),
  ];
  let next = 0;
  const builder: GraphBuilder = {
    ctx,
    get done() {
      return graph !== null;
    },
    step() {
      if (next < steps.length) steps[next++]!();
      return graph !== null;
    },
    finish() {
      while (!builder.step());
      return graph!;
    },
  };
  return builder;
}

function assembleGraph(ctx: BaseAudioContext, rand: Rng, reverb: ConvolverNode, noise: NoiseBank): AudioGraph {
  const compressor = ctx.createDynamicsCompressor();
  // gentle "glue" and protection against overdrive, not pumping
  compressor.threshold.value = -12;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.25;
  compressor.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(compressor);

  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = REVERB_RETURN_GAIN;
  reverb.connect(reverbReturn);
  reverbReturn.connect(master);

  const music = ctx.createGain();
  music.connect(master);

  return {
    ctx,
    master,
    sfx: createChannel(ctx, master, reverb),
    ambient: createChannel(ctx, master, reverb),
    music,
    noise,
    rand,
    activeOneShots: 0,
  };
}

export function createGraph(ctx: BaseAudioContext, rand: Rng): AudioGraph {
  return createGraphBuilder(ctx, rand).finish();
}

/** Starts a noise loop at a random offset (so that several loops are not in phase). */
export function startNoiseLoop(graph: AudioGraph, color: NoiseColor | 'crackle', when?: number): AudioBufferSourceNode {
  const src = graph.ctx.createBufferSource();
  const buffer = graph.noise[color];
  src.buffer = buffer;
  src.loop = true;
  src.start(when ?? graph.ctx.currentTime, graph.rand() * buffer.duration * 0.9);
  return src;
}

export function createGain(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

export function createFilter(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, q = 0.707): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  return f;
}

export function createOscillator(ctx: BaseAudioContext, type: OscillatorType, frequency: number, detuneCents = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = frequency;
  o.detune.value = detuneCents;
  return o;
}

/** A slow LFO connected to a parameter with the given depth. */
export function createLfo(ctx: BaseAudioContext, rateHz: number, depth: number, target: AudioParam, type: OscillatorType = 'sine'): { osc: OscillatorNode; depth: GainNode } {
  const osc = createOscillator(ctx, type, rateHz);
  const amount = createGain(ctx, depth);
  osc.connect(amount);
  amount.connect(target);
  return { osc, depth: amount };
}

/** Stops and disconnects the nodes at once (ignores those already stopped). */
export function teardown(nodes: readonly AudioNode[]): void {
  for (const node of nodes) {
    if ('stop' in node && typeof (node as AudioScheduledSourceNode).stop === 'function') {
      try {
        (node as AudioScheduledSourceNode).stop();
      } catch {
        // the node was already stopped
      }
    }
  }
  for (const node of nodes) {
    try {
      node.disconnect();
    } catch {
      // nothing to do
    }
  }
}
