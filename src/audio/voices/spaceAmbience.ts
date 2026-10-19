// Space ambience: a quiet non-tonal bed (wandering band of brown-noise "wind" + faint high "air").
// Replaces the old generative drone pad – the music now carries the harmony.

import { type AmbientParams, RING_CROSSFADE_SECONDS } from '../ambientParams';
import { timeConstantFor } from '../envelope';
import { type AudioGraph, createFilter, createGain, createLfo, startNoiseLoop, teardown } from '../graph';

const FADE_IN_SECONDS = 5;
const FADE_OUT_SECONDS = 3;
const SEND_LEVEL = 0.5;
const WIND_SCALE = 0.45;
const AIR_SCALE = 0.05;

export class SpaceAmbienceVoice {
  private readonly nodes: AudioNode[] = [];
  private readonly out: GainNode;
  private readonly windFilter: BiquadFilterNode;
  private readonly windLfo: { osc: OscillatorNode; depth: GainNode };
  private readonly windGain: GainNode;
  private readonly airGain: GainNode;
  private params: AmbientParams;
  private running = false;

  constructor(
    private readonly graph: AudioGraph,
    initial: AmbientParams,
  ) {
    const ctx = graph.ctx;
    this.params = initial;

    this.out = createGain(ctx, 0);
    const send = createGain(ctx, SEND_LEVEL);
    this.out.connect(graph.ambient.dry);
    this.out.connect(send);
    send.connect(graph.ambient.wet);

    // wind – brown noise in a wide band whose centre slowly wanders
    const windSrc = startNoiseLoop(graph, 'brown');
    this.windFilter = createFilter(ctx, 'bandpass', initial.windHz, 0.6);
    this.windLfo = createLfo(ctx, initial.windRate, initial.windDrift, this.windFilter.frequency);
    this.windGain = createGain(ctx, 0);
    windSrc.connect(this.windFilter).connect(this.windGain).connect(this.out);

    // air – pink noise high up, breathing slowly
    const airSrc = startNoiseLoop(graph, 'pink');
    const airHigh = createFilter(ctx, 'highpass', 2800, 0.5);
    const airLow = createFilter(ctx, 'lowpass', 7500, 0.5);
    const airBreath = createGain(ctx, 0.6);
    const breathLfo = createLfo(ctx, 0.07, 0.4, airBreath.gain);
    this.airGain = createGain(ctx, 0);
    airSrc.connect(airHigh).connect(airLow).connect(airBreath).connect(this.airGain).connect(this.out);

    this.windLfo.osc.start();
    breathLfo.osc.start();
    this.nodes.push(
      this.out, send, windSrc, this.windFilter, this.windLfo.osc, this.windLfo.depth, this.windGain,
      airSrc, airHigh, airLow, airBreath, breathLfo.osc, breathLfo.depth, this.airGain,
    );
    this.applyTexture(initial, ctx.currentTime, 0.05);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get ring(): number {
    return this.params.ring;
  }

  start(now = this.graph.ctx.currentTime): void {
    if (this.running) return;
    this.running = true;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(this.params.level, now, timeConstantFor(FADE_IN_SECONDS));
  }

  stop(now = this.graph.ctx.currentTime): void {
    if (!this.running) return;
    this.running = false;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(0, now, timeConstantFor(FADE_OUT_SECONDS));
  }

  /** Smooth change to another ring's colour. */
  setParams(params: AmbientParams, now = this.graph.ctx.currentTime): void {
    if (params === this.params) return;
    this.params = params;
    this.applyTexture(params, now, RING_CROSSFADE_SECONDS);
    if (this.running) this.out.gain.setTargetAtTime(params.level, now, timeConstantFor(RING_CROSSFADE_SECONDS));
  }

  private applyTexture(p: AmbientParams, now: number, seconds: number): void {
    const tc = timeConstantFor(seconds);
    this.windFilter.frequency.setTargetAtTime(p.windHz, now, tc);
    this.windLfo.osc.frequency.setTargetAtTime(p.windRate, now, tc);
    this.windLfo.depth.gain.setTargetAtTime(p.windDrift, now, tc);
    this.windGain.gain.setTargetAtTime(WIND_SCALE * p.wind, now, tc);
    this.airGain.gain.setTargetAtTime(AIR_SCALE * p.air, now, tc);
  }

  dispose(): void {
    teardown(this.nodes);
    this.nodes.length = 0;
  }
}
