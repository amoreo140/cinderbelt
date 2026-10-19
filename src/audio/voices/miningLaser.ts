// Mining laser: a tonal beam hum + a rock-crackle layer on impact.

import { ParamSmoother, timeConstantFor } from '../envelope';
import { type AudioGraph, createFilter, createGain, createLfo, createOscillator, startNoiseLoop, teardown } from '../graph';
import { LASER_LEVELS, LASER_SPIN, type LaserInput, laserTargets, type LaserTone } from '../loopParams';

export class MiningLaserVoice {
  private readonly nodes: AudioNode[] = [];
  private readonly oscillators: Array<{ osc: OscillatorNode; ratio: number }>;
  private readonly toneFilter: BiquadFilterNode;
  private readonly beamFilter: BiquadFilterNode;
  private readonly crackleFilter: BiquadFilterNode;
  private readonly shimmerLevel: GainNode;
  private readonly humGain: ParamSmoother;
  private readonly crackleGain: ParamSmoother;
  private readonly bodyGain: ParamSmoother;
  private active = false;
  private tone: LaserTone | null = null;

  constructor(private readonly graph: AudioGraph) {
    const ctx = graph.ctx;
    const sfx = graph.sfx;

    const out = createGain(ctx, 1);
    const send = createGain(ctx, 0.25);
    out.connect(sfx.dry);
    out.connect(send);
    send.connect(sfx.wet);

    // ---- beam hum ----
    const osc1 = createOscillator(ctx, 'sine', 196);
    const osc2 = createOscillator(ctx, 'triangle', 392, 4);
    const osc3 = createOscillator(ctx, 'sine', 294);
    const osc2Level = createGain(ctx, 0.3);
    this.shimmerLevel = osc2Level;
    const osc3Level = createGain(ctx, 0.18);
    this.toneFilter = createFilter(ctx, 'lowpass', 1000, 0.7);
    osc1.connect(this.toneFilter);
    osc2.connect(osc2Level).connect(this.toneFilter);
    osc3.connect(osc3Level).connect(this.toneFilter);

    // gentle vibrato (in cents, independent of pitch)
    const vibrato = createLfo(ctx, 5.5, 7, osc1.detune);
    vibrato.depth.connect(osc2.detune);
    vibrato.depth.connect(osc3.detune);

    // fast tremolo gives an "energetic" character without harshness
    const tremolo = createGain(ctx, 0.85);
    const tremoloLfo = createLfo(ctx, 23, 0.15, tremolo.gain);
    this.toneFilter.connect(tremolo);

    // narrow noise band - the beam's "hiss"
    const beamSrc = startNoiseLoop(graph, 'pink');
    this.beamFilter = createFilter(ctx, 'bandpass', 800, 5);
    const beamLevel = createGain(ctx, LASER_LEVELS.beam / LASER_LEVELS.hum);
    beamSrc.connect(this.beamFilter).connect(beamLevel).connect(tremolo);

    const humGain = createGain(ctx, 0);
    tremolo.connect(humGain).connect(out);
    this.humGain = new ParamSmoother(humGain.gain, { up: LASER_SPIN.upSeconds * 0.5, down: LASER_SPIN.downSeconds, epsilon: 0.001 });

    // ---- praskanie horniny ----
    const crackleSrc = startNoiseLoop(graph, 'crackle');
    this.crackleFilter = createFilter(ctx, 'bandpass', 1500, 1);
    const crackleGain = createGain(ctx, 0);
    crackleSrc.connect(this.crackleFilter).connect(crackleGain).connect(out);
    this.crackleGain = new ParamSmoother(crackleGain.gain, { up: 0.05, down: 0.15, epsilon: 0.001 });

    // muffled rumble of vaporising rock
    const bodySrc = startNoiseLoop(graph, 'brown');
    const bodyFilter = createFilter(ctx, 'lowpass', 380, 0.8);
    const bodyGain = createGain(ctx, 0);
    bodySrc.connect(bodyFilter).connect(bodyGain).connect(out);
    this.bodyGain = new ParamSmoother(bodyGain.gain, { up: 0.08, down: 0.2, epsilon: 0.001 });

    this.oscillators = [
      { osc: osc1, ratio: 1 },
      { osc: osc2, ratio: 2 },
      { osc: osc3, ratio: 1.5 },
    ];
    for (const o of [osc1, osc2, osc3, vibrato.osc, tremoloLfo.osc]) o.start();
    this.nodes.push(
      out, send, osc1, osc2, osc3, osc2Level, osc3Level, this.toneFilter, vibrato.osc, vibrato.depth,
      tremolo, tremoloLfo.osc, tremoloLfo.depth, beamSrc, this.beamFilter, beamLevel, humGain,
      crackleSrc, this.crackleFilter, crackleGain, bodySrc, bodyFilter, bodyGain,
    );
  }

  /** Call every frame (or on a state change). */
  set(input: LaserInput, now = this.graph.ctx.currentTime): void {
    const targets = laserTargets(input);
    // with no resource given we keep the last tuning (e.g. when the beam turns off)
    const tone = input.resource == null && this.tone ? this.tone : targets.tone;
    const starting = input.active && !this.active;
    const stopping = !input.active && this.active;

    if (starting) this.spin(tone.baseHz * LASER_SPIN.startRatio, tone.baseHz, LASER_SPIN.upSeconds, now, true);
    else if (stopping) this.spin(null, tone.baseHz * LASER_SPIN.stopRatio, LASER_SPIN.downSeconds, now, false);
    else if (input.active && this.tone !== tone) this.spin(null, tone.baseHz, 0.12, now, false);

    if (this.tone !== tone) this.applyTimbre(tone, now);
    this.tone = tone;
    this.active = input.active;

    this.humGain.setTarget(targets.humGain, now);
    this.crackleGain.setTarget(targets.crackleGain, now);
    this.bodyGain.setTarget(targets.bodyGain, now);
  }

  private spin(from: number | null, to: number, seconds: number, now: number, jump: boolean): void {
    for (const { osc, ratio } of this.oscillators) {
      if (jump && from !== null) {
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setValueAtTime(from * ratio, now);
      }
      osc.frequency.setTargetAtTime(to * ratio, now, timeConstantFor(seconds));
    }
  }

  private applyTimbre(tone: LaserTone, now: number): void {
    const tc = timeConstantFor(0.15);
    this.toneFilter.frequency.setTargetAtTime(tone.baseHz * (4 + 4 * tone.shimmer), now, tc);
    this.beamFilter.frequency.setTargetAtTime(tone.baseHz * 4, now, tc);
    this.crackleFilter.frequency.setTargetAtTime(tone.crackleHz, now, tc);
    this.crackleFilter.Q.setTargetAtTime(tone.crackleQ, now, tc);
    this.shimmerLevel.gain.setTargetAtTime(0.15 + 0.4 * tone.shimmer, now, tc);
  }

  dispose(): void {
    teardown(this.nodes);
    this.nodes.length = 0;
  }
}
