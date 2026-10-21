// Continuous engine loop: main thrust, reverse thrust and side thrusters.

import { ParamSmoother } from '../envelope';
import { type AudioGraph, createFilter, createGain, createLfo, createOscillator, startNoiseLoop, teardown } from '../graph';
import {
  ENGINE_RAMP,
  engineMainParams,
  engineReverseParams,
  engineSideParams,
  type NormalizedThrust,
} from '../loopParams';

const GAIN_EPS = 0.002;
const FREQ_EPS = 1;

export class EngineThrustVoice {
  private readonly nodes: AudioNode[] = [];
  private readonly smoothers: Array<{ apply: (t: NormalizedThrust, now: number) => void }> = [];

  constructor(private readonly graph: AudioGraph) {
    const ctx = graph.ctx;
    const ramp = (param: AudioParam, eps: number) => new ParamSmoother(param, { up: ENGINE_RAMP.up, down: ENGINE_RAMP.down, epsilon: eps });
    const sfx = graph.sfx;

    // ---- main engine ----
    const mainOut = createGain(ctx, 1);
    const mainSend = createGain(ctx, 0.12);
    mainOut.connect(sfx.dry);
    mainOut.connect(mainSend);
    mainSend.connect(sfx.wet);

    const rumbleSrc = startNoiseLoop(graph, 'brown');
    const rumbleFilter = createFilter(ctx, 'lowpass', 110, 0.7);
    const rumbleGain = createGain(ctx, 0);
    rumbleSrc.connect(rumbleFilter).connect(rumbleGain).connect(mainOut);
    // slow filter "breathing" - the engine is not dead static
    const breath = createLfo(ctx, 0.23, 20, rumbleFilter.frequency);

    const humFilter = createFilter(ctx, 'lowpass', 140, 0.7);
    const humGain = createGain(ctx, 0);
    const hum1 = createOscillator(ctx, 'sawtooth', 44);
    const hum2 = createOscillator(ctx, 'sawtooth', 44, 5);
    const hum3 = createOscillator(ctx, 'triangle', 88, -5);
    const hum3Level = createGain(ctx, 0.35);
    hum1.connect(humFilter);
    hum2.connect(humFilter);
    hum3.connect(hum3Level).connect(humFilter);
    humFilter.connect(humGain).connect(mainOut);

    const airSrc = startNoiseLoop(graph, 'pink');
    const airFilter = createFilter(ctx, 'bandpass', 600, 0.7);
    const airGain = createGain(ctx, 0);
    airSrc.connect(airFilter).connect(airGain).connect(mainOut);

    const s = {
      rumbleGain: ramp(rumbleGain.gain, GAIN_EPS),
      rumbleCutoff: ramp(rumbleFilter.frequency, FREQ_EPS),
      humGain: ramp(humGain.gain, GAIN_EPS),
      hum1: ramp(hum1.frequency, 0.2),
      hum2: ramp(hum2.frequency, 0.2),
      hum3: ramp(hum3.frequency, 0.4),
      humCutoff: ramp(humFilter.frequency, FREQ_EPS),
      airGain: ramp(airGain.gain, GAIN_EPS),
      airHz: ramp(airFilter.frequency, FREQ_EPS),
    };
    this.smoothers.push({
      apply: (t, now) => {
        const p = engineMainParams(t.main);
        s.rumbleGain.setTarget(p.rumbleGain, now);
        s.rumbleCutoff.setTarget(p.rumbleCutoff, now);
        s.humGain.setTarget(p.humGain, now);
        s.hum1.setTarget(p.humHz, now);
        s.hum2.setTarget(p.humHz, now);
        s.hum3.setTarget(p.humHz * 2, now);
        s.humCutoff.setTarget(p.humCutoff, now);
        s.airGain.setTarget(p.airGain, now);
        s.airHz.setTarget(p.airHz, now);
      },
    });

    // ---- reverse thrust ----
    const revOut = createGain(ctx, 1);
    const revSend = createGain(ctx, 0.15);
    revOut.connect(sfx.dry);
    revOut.connect(revSend);
    revSend.connect(sfx.wet);
    const revSrc = startNoiseLoop(graph, 'pink');
    const revFilter = createFilter(ctx, 'bandpass', 420, 1.0);
    const revNoiseGain = createGain(ctx, 0);
    revSrc.connect(revFilter).connect(revNoiseGain).connect(revOut);
    const revOsc = createOscillator(ctx, 'triangle', 88);
    const revToneFilter = createFilter(ctx, 'lowpass', 400, 0.7);
    const revToneGain = createGain(ctx, 0);
    revOsc.connect(revToneFilter).connect(revToneGain).connect(revOut);
    const r = {
      noiseGain: ramp(revNoiseGain.gain, GAIN_EPS),
      noiseHz: ramp(revFilter.frequency, FREQ_EPS),
      toneGain: ramp(revToneGain.gain, GAIN_EPS),
      toneHz: ramp(revOsc.frequency, 0.3),
    };
    this.smoothers.push({
      apply: (t, now) => {
        const p = engineReverseParams(t.reverse);
        r.noiseGain.setTarget(p.noiseGain, now);
        r.noiseHz.setTarget(p.noiseHz, now);
        r.toneGain.setTarget(p.toneGain, now);
        r.toneHz.setTarget(p.toneHz, now);
      },
    });

    // ---- side thrusters ----
    const sideSrc = startNoiseLoop(graph, 'white');
    const sideHp = createFilter(ctx, 'highpass', 700, 0.7);
    const sideLp = createFilter(ctx, 'lowpass', 1400, 0.7);
    const sideGain = createGain(ctx, 0);
    sideSrc.connect(sideHp).connect(sideLp).connect(sideGain);
    let sideTail: AudioNode = sideGain;
    let sidePan: ParamSmoother | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      sideGain.connect(panner);
      sideTail = panner;
      sidePan = new ParamSmoother(panner.pan, { up: 0.08, down: 0.08, epsilon: 0.01 });
      this.nodes.push(panner);
    }
    sideTail.connect(sfx.dry);
    const sd = {
      gain: ramp(sideGain.gain, GAIN_EPS),
      cutoff: ramp(sideLp.frequency, FREQ_EPS),
    };
    this.smoothers.push({
      apply: (t, now) => {
        const p = engineSideParams(t.side);
        sd.gain.setTarget(p.gain, now);
        sd.cutoff.setTarget(p.cutoff, now);
        // while releasing we keep the last side so the tail does not "escape" to the centre
        if (p.gain > 0) sidePan?.setTarget(p.pan, now);
      },
    });

    for (const o of [hum1, hum2, hum3, revOsc, breath.osc]) o.start();
    this.nodes.push(
      mainOut, mainSend, rumbleSrc, rumbleFilter, rumbleGain, breath.osc, breath.depth,
      humFilter, humGain, hum1, hum2, hum3, hum3Level, airSrc, airFilter, airGain,
      revOut, revSend, revSrc, revFilter, revNoiseGain, revOsc, revToneFilter, revToneGain,
      sideSrc, sideHp, sideLp, sideGain,
    );
  }

  /** Call every frame; changes are smoothed so input jumps do not click. */
  set(thrust: NormalizedThrust, now = this.graph.ctx.currentTime): void {
    for (const s of this.smoothers) s.apply(thrust, now);
  }

  dispose(): void {
    teardown(this.nodes);
    this.nodes.length = 0;
  }
}
