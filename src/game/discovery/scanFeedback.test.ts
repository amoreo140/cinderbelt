import { describe, expect, it } from 'vitest';
import { findPoi, flyingAt, tapScan } from '../../sim/discovery/testing';
import { radarRangeOf } from '../../sim/discovery/scanner';
import { isRich, oreGrade } from '../../sim/mining/grade';
import { gradeKnown } from '../../sim/mining/nuggets';
import { Simulation, type SimEvent } from '../../sim/Simulation';
import { createBody } from '../../sim/physics/body';
import {
  collectScanFinds,
  FIND_LIFE,
  findAlpha,
  findPop,
  SCAN_WAVE,
  ScanFeedback,
  waveAlpha,
  waveArrival,
  waveRadius,
} from './scanFeedback';

describe('scan wave over time', () => {
  it('starts at the ship, eases in and reaches the radar range at the end', () => {
    expect(waveRadius(0, 180)).toBe(0);
    expect(waveRadius(SCAN_WAVE.seconds, 180)).toBeCloseTo(180);
    expect(waveRadius(SCAN_WAVE.seconds * 3, 180)).toBeCloseTo(180);
    // slow near the ship: after 0.3 s still on a zoomed-in screen (< 20 u), after 1 s mid-way
    expect(waveRadius(0.3, 180)).toBeLessThan(20);
    expect(waveRadius(0.3, 180)).toBeGreaterThan(3);
    expect(waveRadius(1, 180)).toBeGreaterThan(30);
    expect(waveRadius(1, 180)).toBeLessThan(90);
    // monotonic
    let last = -1;
    for (let t = 0; t <= SCAN_WAVE.seconds; t += 0.05) {
      const r = waveRadius(t, 180);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });

  it('is fully visible at first and fades out by the radar range', () => {
    expect(waveAlpha(0)).toBe(1);
    expect(waveAlpha(SCAN_WAVE.seconds * 0.5)).toBe(1);
    expect(waveAlpha(SCAN_WAVE.seconds * 0.8)).toBeGreaterThan(0);
    expect(waveAlpha(SCAN_WAVE.seconds * 0.8)).toBeLessThan(1);
    expect(waveAlpha(SCAN_WAVE.seconds)).toBe(0);
    expect(waveAlpha(-0.1)).toBe(0);
  });

  it('with reduced motion stands at the radar range and only fades in and out', () => {
    expect(waveRadius(0, 180, true)).toBe(180);
    expect(waveRadius(1, 180, true)).toBe(180);
    expect(waveAlpha(0, true)).toBe(0);
    expect(waveAlpha(0.3, true)).toBeGreaterThan(0.5);
    expect(waveAlpha(SCAN_WAVE.reducedSeconds, true)).toBe(0);
  });

  it('arrives at a distance exactly when the front passes it', () => {
    for (const d of [10, 60, 150]) {
      const t = waveArrival(d, 180);
      expect(waveRadius(t, 180)).toBeCloseTo(d, 5);
    }
    // beyond the radar range: as the wave ends; reduced motion: at once
    expect(waveArrival(500, 180)).toBeCloseTo(SCAN_WAVE.seconds);
    expect(waveArrival(100, 180, true)).toBe(0);
  });
});

describe('find highlight lifetime', () => {
  it('pops in, holds and fades out within the lifetime', () => {
    expect(findAlpha(-0.01)).toBe(0);
    expect(findAlpha(0)).toBe(0);
    expect(findAlpha(FIND_LIFE.popSeconds)).toBe(1);
    expect(findAlpha(FIND_LIFE.seconds - FIND_LIFE.fadeSeconds)).toBe(1);
    expect(findAlpha(FIND_LIFE.seconds - FIND_LIFE.fadeSeconds / 2)).toBeCloseTo(0.5);
    expect(findAlpha(FIND_LIFE.seconds)).toBe(0);
    // 3–4 s on screen
    expect(FIND_LIFE.seconds).toBeGreaterThanOrEqual(3);
    expect(FIND_LIFE.seconds).toBeLessThanOrEqual(4);
  });

  it('the pop shrinks from big to rest; reduced motion has no pop and no fade-in', () => {
    expect(findPop(0)).toBeCloseTo(1.8);
    expect(findPop(FIND_LIFE.popSeconds / 2)).toBeGreaterThan(1);
    expect(findPop(FIND_LIFE.popSeconds)).toBe(1);
    expect(findPop(0, true)).toBe(1);
    expect(findAlpha(0.01, true)).toBe(1);
  });
});

describe('finds of a pulse', () => {
  it('a pulse in an asteroid field highlights the rich rocks it assayed, nearest first', () => {
    const s = new Simulation({ seed: 11, startDocked: false });
    s.state.player.body = createBody({ x: 75, y: 45 });
    s.state.player.prevBody = s.state.player.body;
    s.state.world.update(s.state.player.body.pos);
    const events = tapScan(s);
    const found = collectScanFinds(s.state, events)!;
    expect(found).not.toBeNull();
    expect(found.range).toBeCloseTo(radarRangeOf(s.state));
    // the same rocks the pulse's toast counts
    const assay = events.find((e) => e.type === 'oreAssayed') as Extract<SimEvent, { type: 'oreAssayed' }>;
    expect(assay.rich).toBeGreaterThan(0);
    const finds = found.finds.filter((f) => f.kind === 'rich');
    expect(finds.length).toBe(Math.min(16, assay.rich));
    for (const f of finds) {
      expect(isRich(f.grade!)).toBe(true);
      expect(f.resource).toBeDefined();
      const rock = s.state.world.asteroids().find((a) => `rich:${a.id}` === f.id)!;
      expect(gradeKnown(s.state, rock)).toBe(true);
      expect(oreGrade(11, rock)).toBeCloseTo(f.grade!);
    }
    for (let i = 1; i < finds.length; i++) expect(finds[i]!.dist).toBeGreaterThanOrEqual(finds[i - 1]!.dist);
  });

  it('a pulse from afar turns a place into a signal find', () => {
    const anomaly = findPoi(1337, 'anomaly');
    const sim = flyingAt(1337, { x: anomaly.pos.x + 380, y: anomaly.pos.y + 40 });
    const events = tapScan(sim);
    const found = collectScanFinds(sim.state, events)!;
    const signal = found.finds.find((f) => f.id === `signal:${anomaly.id}`);
    expect(signal).toMatchObject({ kind: 'signal', signal: 'anomaly' });
    expect(signal!.radius).toBeGreaterThan(0);
  });

  it('no pulse in the step = nothing', () => {
    const sim = flyingAt(1337, { x: 0, y: 0 });
    expect(collectScanFinds(sim.state, [])).toBeNull();
  });
});

describe('ScanFeedback', () => {
  it('shows the wave, then the finds as the front reaches them, then nothing', () => {
    const anomaly = findPoi(1337, 'anomaly');
    const sim = flyingAt(1337, { x: anomaly.pos.x + 380, y: anomaly.pos.y + 40 });
    const fb = new ScanFeedback();
    fb.onEvents(sim.state, tapScan(sim), 10);
    const early = fb.view(10.2, false)!;
    expect(early.wave).not.toBeNull();
    expect(early.wave!.radius).toBeLessThan(10);
    // the signal is far beyond the radar range – it lights up when the wave ends
    expect(early.finds.find((f) => f.kind === 'signal')).toBeUndefined();
    const late = fb.view(10 + SCAN_WAVE.seconds + 1, false)!;
    expect(late.wave).toBeNull();
    expect(late.finds.find((f) => f.kind === 'signal')!.alpha).toBe(1);
    expect(fb.view(10 + SCAN_WAVE.seconds + FIND_LIFE.seconds + 0.1, false)).toBeNull();
    // gone for good
    expect(fb.view(10.1, false)).toBeNull();
  });

  it('reduced motion: everything at once, no pop', () => {
    const anomaly = findPoi(1337, 'anomaly');
    const sim = flyingAt(1337, { x: anomaly.pos.x + 380, y: anomaly.pos.y + 40 });
    const fb = new ScanFeedback();
    fb.onEvents(sim.state, tapScan(sim), 0);
    const v = fb.view(0.1, true)!;
    expect(v.finds.length).toBeGreaterThan(0);
    for (const f of v.finds) expect(f.pop).toBe(1);
  });
});
