import { describe, expect, it } from 'vitest';
import { createTraining } from '../../sim/training/training';
import type { TrainingState } from '../../sim/training/types';
import GAME_SOURCE from '../Game.ts?raw';
import { ALL_FEATURES, gateKey, revealedFeatures, unlockStep, YARD_KEYS, type UiFeature } from './reveal';

const SITES = { buoyA: { x: 0, y: 0 }, buoyB: { x: 1, y: 1 }, rock: 'r', rockPos: { x: 2, y: 2 } };
const active = (step: number): TrainingState => ({ ...createTraining(), status: 'active', step, sites: SITES });

describe('revealedFeatures', () => {
  it('first step shows only the flight basics', () => {
    expect([...revealedFeatures(active(0))].sort()).toEqual(['goal', 'fuel', 'helpChip', 'hull', 'radio', 'tow'].sort());
  });

  it('accumulates features over steps', () => {
    const dock = revealedFeatures(active(2));
    expect(dock.has('tab:market')).toBe(true);
    // Overview (with the Service section) is always open: there is no service feature
    expect([...ALL_FEATURES].includes('tab:service' as never)).toBe(false);
    expect(dock.has('tab:shipyard')).toBe(false);
    const checklist = revealedFeatures(active(7));
    expect(checklist.has('map')).toBe(true);
    expect(checklist.has('scanner')).toBe(false);
  });

  it('last step reveals everything except post-training features', () => {
    const last = revealedFeatures(active(8));
    expect(last.has('scanner')).toBe(true);
    expect(last.has('tab:board')).toBe(false);
    expect(last.size).toBe(ALL_FEATURES.size - 6);
  });

  it('shows everything when not in an active training', () => {
    expect(revealedFeatures({ ...active(0), status: 'done' })).toBe(ALL_FEATURES);
    expect(revealedFeatures({ ...active(0), status: 'skipped' })).toBe(ALL_FEATURES);
    expect(revealedFeatures(null)).toBe(ALL_FEATURES);
    expect(revealedFeatures(undefined)).toBe(ALL_FEATURES);
    expect(revealedFeatures({ ...active(0), sites: null })).toBe(ALL_FEATURES);
    expect(revealedFeatures(active(99))).toBe(ALL_FEATURES);
  });

  it('returns a shared instance', () => {
    expect(revealedFeatures(active(3))).toBe(revealedFeatures(active(3)));
  });

  it('ALL_FEATURES contains every feature', () => {
    const samples: UiFeature[] = ['hull', 'tab:shipyard', 'scanner', 'tab:board', 'worldMarks'];
    for (const f of samples) expect(ALL_FEATURES.has(f)).toBe(true);
  });
});

describe('unlockStep', () => {
  it('returns the 1-based step or null', () => {
    expect(unlockStep('tab:shipyard')).toBe(4);
    expect(unlockStep('hull')).toBe(1);
    // the tow is a safety net: open from the start
    expect(unlockStep('tow')).toBe(1);
    expect(unlockStep('tab:board')).toBeNull();
  });
});

describe('gateKey', () => {
  it('ignores keys of unrevealed features', () => {
    expect(gateKey('KeyM', revealedFeatures(active(0)))).toBe(false);
    expect(gateKey('KeyM', revealedFeatures(active(7)))).toBe(true);
    expect(gateKey('key:m', revealedFeatures(active(0)))).toBe(false);
    expect(gateKey('key:m', revealedFeatures(active(7)))).toBe(true);
    expect(gateKey('Tab', revealedFeatures(active(7)))).toBe(false);
  });

  it('gates the dampers key but never the tow key', () => {
    expect(gateKey('key:z', revealedFeatures(active(0)))).toBe(false);
    expect(gateKey('key:z', revealedFeatures(active(4)))).toBe(true);
    expect(gateKey('key:h', revealedFeatures(active(0)))).toBe(true);
    expect(gateKey('KeyH', revealedFeatures(active(0)))).toBe(true);
  });

  it('always lets help and other keys through', () => {
    for (const i of [0, 4, 8]) {
      expect(gateKey('KeyK', revealedFeatures(active(i)))).toBe(true);
      expect(gateKey('key:k', revealedFeatures(active(i)))).toBe(true);
      expect(gateKey('KeyW', revealedFeatures(active(i)))).toBe(true);
    }
  });
});

describe('YARD_KEYS', () => {
  it('lets through every shipyard editor key the training gate would block', () => {
    // the letters Game.yardKey binds (letterKey('x')) – a new binding on a gated key must be listed too
    const src = GAME_SOURCE;
    const body = /private yardKey\([\s\S]*?\r?\n {2}}\r?\n/.exec(src)?.[0] ?? '';
    const letters = [...body.matchAll(/letterKey\('([a-z])'\)/g)].map((m) => m[1]!);
    expect(letters.length).toBeGreaterThan(3);
    const none = revealedFeatures(active(0));
    const bound = [...letters.flatMap((l) => [`Key${l.toUpperCase()}`, `key:${l}`]), ...(body.includes("'Tab'") ? ['Tab'] : [])];
    for (const code of bound.filter((c) => !gateKey(c, none))) {
      expect(YARD_KEYS.has(code), `${code} is gated but the yard editor binds it`).toBe(true);
    }
  });
});
