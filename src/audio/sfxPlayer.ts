// Player of one-shot sound recipes (recipes.ts) through the Web Audio API.

import { applyEnvelope } from './envelope';
import { type AudioGraph, type Channel, createFilter, createOscillator, startNoiseLoop } from './graph';
import { clamp } from './math';
import { eventDuration, type SfxEvent } from './recipes';

/** Maximum number of one-shot sounds playing at once. */
export const MAX_ONE_SHOTS = 24;

export interface PlayOptions {
  /** Stereo poloha -1..1. */
  pan?: number;
  /** Multiplier of the volume of the whole recipe. */
  gain?: number;
  /** Absolute start time (immediately by default). */
  when?: number;
}

/**
 * Plays a recipe. Returns false if it was dropped because of the polyphony limit.
 */
export function playRecipe(graph: AudioGraph, channel: Channel, events: readonly SfxEvent[], options: PlayOptions = {}): boolean {
  if (events.length === 0) return false;
  if (graph.activeOneShots >= MAX_ONE_SHOTS) return false;
  const ctx = graph.ctx;
  const t0 = options.when ?? ctx.currentTime + 0.005;
  const nodes: AudioNode[] = [];

  const out = ctx.createGain();
  out.gain.value = options.gain ?? 1;
  nodes.push(out);
  let dryTarget: AudioNode = channel.dry;
  if (options.pan !== undefined && options.pan !== 0 && typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(options.pan, -1, 1);
    panner.connect(channel.dry);
    nodes.push(panner);
    dryTarget = panner;
  }
  out.connect(dryTarget);

  let end = t0;
  let lastSource: AudioScheduledSourceNode | null = null;
  for (const e of events) {
    const start = t0 + e.at;
    const stopAt = t0 + eventDuration(e) + 0.05;
    const env = ctx.createGain();
    env.gain.value = 0;
    nodes.push(env);

    let source: AudioScheduledSourceNode;
    if (e.type === 'tone') {
      const osc = createOscillator(ctx, e.wave, e.freq, e.detuneCents ?? 0);
      osc.frequency.setValueAtTime(e.freq, start);
      if (e.freqEnd !== undefined) {
        const glide = e.glide ?? e.attack + (e.hold ?? 0) + e.release;
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, e.freqEnd), start + Math.max(0.005, glide));
      }
      let head: AudioNode = osc;
      if (e.cutoff !== undefined) {
        const lp = createFilter(ctx, 'lowpass', e.cutoff, 0.7);
        osc.connect(lp);
        nodes.push(lp);
        head = lp;
      }
      head.connect(env);
      source = osc;
      osc.start(start);
    } else {
      const src = startNoiseLoop(graph, e.color, start);
      const filter = createFilter(ctx, e.filter, e.freq, e.q);
      filter.frequency.setValueAtTime(e.freq, start);
      if (e.freqEnd !== undefined) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(10, e.freqEnd), start + e.attack + (e.hold ?? 0) + e.release);
      }
      src.connect(filter);
      filter.connect(env);
      nodes.push(filter);
      source = src;
    }
    nodes.push(source);
    source.stop(stopAt);

    applyEnvelope(env.gain, { peak: e.gain, attack: e.attack, hold: e.hold, release: e.release }, start);
    env.connect(out);
    if (e.send && e.send > 0) {
      const send = ctx.createGain();
      send.gain.value = e.send;
      env.connect(send);
      send.connect(channel.wet);
      nodes.push(send);
    }

    if (stopAt >= end) {
      end = stopAt;
      lastSource = source;
    }
  }

  graph.activeOneShots++;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    graph.activeOneShots = Math.max(0, graph.activeOneShots - 1);
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        // already disconnected
      }
    }
  };
  if (lastSource) lastSource.onended = cleanup;
  return true;
}
