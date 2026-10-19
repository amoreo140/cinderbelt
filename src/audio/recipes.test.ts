import { describe, expect, it } from 'vitest';
import { RESOURCE_IDS } from '../data/resources';
import {
  alertRecipe,
  BLIP_BASE_HZ,
  BLIP_STEPS,
  BLIP_STREAK_WINDOW,
  blipFrequency,
  commsRecipe,
  dampersRecipe,
  dockRecipe,
  eventDuration,
  impactRecipe,
  nextBlipStep,
  recipeDuration,
  resourceBlipRecipe,
  sectorEntryRecipe,
  type SfxEvent,
  uiRecipe,
} from './recipes';

function peakSum(events: readonly SfxEvent[]): number {
  return events.reduce((s, e) => s + e.gain, 0);
}

/** Shared "sanity" properties of every recipe. */
function expectSane(events: readonly SfxEvent[], maxDuration: number) {
  expect(events.length).toBeGreaterThan(0);
  for (const e of events) {
    expect(e.at).toBeGreaterThanOrEqual(0);
    expect(e.gain).toBeGreaterThan(0);
    expect(e.gain).toBeLessThanOrEqual(1);
    expect(e.attack).toBeGreaterThan(0);
    expect(e.release).toBeGreaterThan(0);
    expect(e.freq).toBeGreaterThan(20);
    expect(e.freq).toBeLessThan(20000);
    if (e.send !== undefined) {
      expect(e.send).toBeGreaterThanOrEqual(0);
      expect(e.send).toBeLessThanOrEqual(1);
    }
  }
  expect(recipeDuration(events)).toBeLessThanOrEqual(maxDuration);
}

describe('eventDuration / recipeDuration', () => {
  it('adds offset, attack, hold and release', () => {
    const e: SfxEvent = { type: 'tone', at: 0.1, wave: 'sine', freq: 440, gain: 0.1, attack: 0.01, hold: 0.02, release: 0.3 };
    expect(eventDuration(e)).toBeCloseTo(0.43);
    expect(recipeDuration([e, { ...e, at: 0 }])).toBeCloseTo(0.43);
    expect(recipeDuration([])).toBe(0);
  });
});

describe('impactRecipe', () => {
  it('is sane for the whole intensity range', () => {
    for (const i of [0, 0.25, 0.5, 0.75, 1]) expectSane(impactRecipe(i), 2);
  });

  it('gets louder and longer with intensity', () => {
    const soft = impactRecipe(0.1);
    const hard = impactRecipe(1);
    expect(peakSum(hard)).toBeGreaterThan(peakSum(soft));
    expect(recipeDuration(hard)).toBeGreaterThan(recipeDuration(soft));
  });

  it('adds the metallic ring only for strong impacts', () => {
    expect(impactRecipe(0.2)).toHaveLength(2);
    expect(impactRecipe(0.9).length).toBeGreaterThan(2);
  });

  it('clamps intensity', () => {
    expect(impactRecipe(7)).toEqual(impactRecipe(1));
    expect(impactRecipe(-1)).toEqual(impactRecipe(0));
  });

  it('thud pitch drops (downward glide)', () => {
    const thud = impactRecipe(0.5)[0]!;
    expect(thud.type).toBe('tone');
    expect(thud.freqEnd).toBeLessThan(thud.freq);
  });
});

describe('resource blip', () => {
  it('streak climbs the pentatonic scale and resets after a pause', () => {
    expect(nextBlipStep(0, 0.2)).toBe(1);
    expect(nextBlipStep(1, 0.2)).toBe(2);
    expect(nextBlipStep(BLIP_STEPS.length - 1, 0.2)).toBe(BLIP_STEPS.length - 1);
    expect(nextBlipStep(3, BLIP_STREAK_WINDOW + 0.01)).toBe(0);
  });

  it('frequency follows the resource and the step', () => {
    for (const id of RESOURCE_IDS) {
      expect(blipFrequency(id, 0)).toBeCloseTo(BLIP_BASE_HZ[id]);
      expect(blipFrequency(id, 3)).toBeGreaterThan(blipFrequency(id, 0));
    }
    expect(blipFrequency('iron', 99)).toBeCloseTo(blipFrequency('iron', BLIP_STEPS.length - 1));
  });

  it('blip is short and quiet', () => {
    const r = resourceBlipRecipe('copper', 2);
    expectSane(r, 0.25);
    expect(peakSum(r)).toBeLessThan(0.2);
  });
});

describe('alerts', () => {
  it('both alerts are sane, short and distinct', () => {
    const cargo = alertRecipe('cargoFull');
    const fuel = alertRecipe('outOfFuel');
    expectSane(cargo, 1.2);
    expectSane(fuel, 1.2);
    expect(cargo).not.toEqual(fuel);
  });

  it('fuel warning uses a filtered square wave so it is not harsh', () => {
    for (const e of alertRecipe('outOfFuel')) {
      if (e.type === 'tone' && e.wave === 'square') expect(e.cutoff).toBeDefined();
    }
  });
});

describe('dampers / ui / dock', () => {
  it('dampers on sweeps up, off sweeps down', () => {
    const on = dampersRecipe(true)[0]!;
    const off = dampersRecipe(false)[0]!;
    expect(on.freqEnd!).toBeGreaterThan(on.freq);
    expect(off.freqEnd!).toBeLessThan(off.freq);
    expectSane(dampersRecipe(true), 0.5);
  });

  it('ui sounds are very short and soft', () => {
    expectSane(uiRecipe('hover'), 0.1);
    expectSane(uiRecipe('click'), 0.15);
    expect(peakSum(uiRecipe('hover'))).toBeLessThan(peakSum(uiRecipe('click')));
  });

  it('the radio opens with a short static burst; danger and the Echo sound different', () => {
    for (const kind of ['radio', 'danger', 'echo'] as const) {
      expectSane(commsRecipe(kind), 0.6);
      expect(commsRecipe(kind)[0]!.type).toBe('noise');
    }
    expect(commsRecipe('danger')).not.toEqual(commsRecipe('radio'));
    expect(commsRecipe('echo')).not.toEqual(commsRecipe('radio'));
    // softer than a click burst + alert: the radio must not shout over the game
    expect(peakSum(commsRecipe('radio'))).toBeLessThan(0.25);
  });

  it('dock and undock are distinct sequences under two seconds', () => {
    expectSane(dockRecipe(true), 2);
    expectSane(dockRecipe(false), 2);
    expect(dockRecipe(true)).not.toEqual(dockRecipe(false));
  });

  it('sharp waveforms are always low-pass filtered', () => {
    const all = [...dockRecipe(true), ...dockRecipe(false), ...dampersRecipe(true), ...alertRecipe('outOfFuel')];
    for (const e of all) {
      if (e.type === 'tone' && (e.wave === 'sawtooth' || e.wave === 'square')) expect(e.cutoff).toBeLessThanOrEqual(1200);
    }
  });
});

describe('sector entry chime (sectors §5.2)', () => {
  const tones = ['quiet', 'guarded', 'contested', 'pirate'] as const;
  it('is short and soft, its own per security, without radio static', () => {
    for (const s of tones) {
      expectSane(sectorEntryRecipe(s, true), 0.7);
      expect(sectorEntryRecipe(s, true).every((e) => e.type === 'tone')).toBe(true);
      expect(peakSum(sectorEntryRecipe(s, true))).toBeLessThan(0.2);
      for (const e of sectorEntryRecipe(s, true)) if (e.type === 'tone' && (e.wave === 'square' || e.wave === 'sawtooth')) expect(e.cutoff).toBeLessThanOrEqual(1200);
    }
    const all = tones.map((s) => JSON.stringify(sectorEntryRecipe(s, true)));
    expect(new Set(all).size).toBe(tones.length);
    expect(sectorEntryRecipe('guarded', true)).not.toEqual(commsRecipe('radio'));
  });

  it('a sector seen before plays only the first note, quieter', () => {
    for (const s of tones) {
      const short = sectorEntryRecipe(s, false);
      expect(short.length).toBeGreaterThan(0);
      expect(recipeDuration(short)).toBeLessThanOrEqual(recipeDuration(sectorEntryRecipe(s, true)));
      expect(peakSum(short)).toBeLessThan(peakSum(sectorEntryRecipe(s, true)) + 1e-9);
    }
  });
});
