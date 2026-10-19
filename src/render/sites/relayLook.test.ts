import { describe, expect, it } from 'vitest';
import { RELAY_CHAIN } from '../../data/guild';
import { arcDots, brokenSpark, dockLamp, guildRelayLamp, holdEdgeFade, holdRing, mineLamp, mineWarning, noise2, relayLamp, relayLook, stormFade, windowLevel, WINDOWS_POWERED, WINDOWS_TRICKLE } from './relayLook';

describe('relay look', () => {
  it('has a look per owner (the Guild relay of M4d is a data change)', () => {
    expect(relayLook('derelict').lit).not.toEqual(relayLook('guild').lit);
    expect(relayLook('derelict').charge.some((c) => c > 1)).toBe(true);
  });

  it('lamp: dark → charging (brighter and faster with the charge) → lit steady', () => {
    expect(relayLamp(0, 3, false)).toEqual({ state: 'dark', intensity: 0 });
    expect(relayLamp(1, 3, false)).toEqual({ state: 'lit', intensity: 1 });
    const peak = (c: number) => Math.max(...Array.from({ length: 400 }, (_, i) => relayLamp(c, i / 400, false).intensity));
    expect(peak(0.9)).toBeGreaterThan(peak(0.2));
    for (let i = 0; i < 50; i++) expect(relayLamp(0.5, i * 0.07, false).state).toBe('charging');
    // the pulse quickens: more zero crossings per second near full
    const crossings = (c: number) => {
      let n = 0;
      let prev = relayLamp(c, 0, false).intensity;
      for (let i = 1; i <= 1000; i++) {
        const v = relayLamp(c, i / 1000, false).intensity;
        if ((v - 0.7 * (0.3 + 0.7 * c)) * (prev - 0.7 * (0.3 + 0.7 * c)) < 0) n++;
        prev = v;
      }
      return n;
    };
    expect(crossings(0.95)).toBeGreaterThan(crossings(0.05));
  });

  it('reduced motion: steady levels that still order dark < charging < lit', () => {
    const a = relayLamp(0.2, 0, true).intensity;
    expect(relayLamp(0.2, 1.37, true).intensity).toBe(a);
    expect(relayLamp(0.8, 0, true).intensity).toBeGreaterThan(a);
    expect(relayLamp(0.8, 0, true).intensity).toBeLessThan(1);
  });
});

describe('derelict lights', () => {
  it('dead with no relay powered, flickers faintly with some, on with all', () => {
    for (let i = 0; i < 100; i++) expect(windowLevel(0, 3, i * 0.13, 7, false)).toBe(0);
    const some = Array.from({ length: 400 }, (_, i) => windowLevel(2, 3, i * 0.125, 7, false));
    expect(Math.max(...some)).toBeLessThanOrEqual(WINDOWS_TRICKLE);
    expect(some.some((v) => v > 0)).toBe(true);
    expect(some.some((v) => v === 0)).toBe(true);
    const all = Array.from({ length: 400 }, (_, i) => windowLevel(3, 3, i * 0.125, 7, false));
    expect(all.filter((v) => v === WINDOWS_POWERED).length).toBeGreaterThan(300);
    expect(windowLevel(3, 3, 5, 7, true)).toBe(WINDOWS_POWERED);
    expect(windowLevel(1, 3, 5, 7, true)).toBeCloseTo(WINDOWS_TRICKLE / 3);
  });

  it('dock lamps blink, steady with reduced motion', () => {
    const v = Array.from({ length: 100 }, (_, i) => dockLamp(i / 50, 0, false));
    expect(new Set(v).size).toBe(2);
    expect(dockLamp(0.37, 1, true)).toBe(1);
  });

  it('noise is deterministic and in [0, 1)', () => {
    expect(noise2(3, 4)).toBe(noise2(3, 4));
    for (let i = 0; i < 200; i++) {
      const n = noise2(i, i * 7 - 3);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});

describe('mines and storms', () => {
  it('mine lamp: slow pulse idle, fast blink armed, steady with reduced motion', () => {
    const blinks = (armed: number | null) => {
      let n = 0;
      let prev = mineLamp(0, 0, armed, false) > 0.5;
      for (let i = 1; i <= 1000; i++) {
        const on = mineLamp(i / 1000, 0, armed, false) > 0.5;
        if (on !== prev) n++;
        prev = on;
      }
      return n;
    };
    expect(blinks(0.5)).toBeGreaterThan(4 * Math.max(1, blinks(null)));
    expect(mineLamp(0.3, 0.2, null, true)).toBe(mineLamp(0.9, 0.7, null, true));
    expect(mineLamp(0.3, 0, 0.4, true)).toBe(1);
  });

  it('mine warning ramps up towards the arming distance', () => {
    expect(mineWarning(50, 12, 40)).toBe(0);
    expect(mineWarning(10, 12, 40)).toBe(1);
    expect(mineWarning(20, 12, 40)).toBeGreaterThan(mineWarning(30, 12, 40));
  });

  it('storm fades in and out inside its window only', () => {
    expect(stormFade(99, 100, 1000)).toBe(0);
    expect(stormFade(1000, 100, 1000)).toBe(0);
    expect(stormFade(160, 100, 1000)).toBeCloseTo(0.5);
    expect(stormFade(500, 100, 1000)).toBe(1);
    expect(stormFade(940, 100, 1000)).toBeCloseTo(0.5);
  });
});

describe('Guild relay mast (M4d)', () => {
  it('lamp by stage: broken dark, repaired an amber standby blink, charging pulses, powered and secured lit', () => {
    expect(guildRelayLamp('broken', 0, 1, false)).toEqual({ state: 'dark', intensity: 0 });
    for (let i = 0; i < 40; i++) expect(guildRelayLamp('repaired', 0, i * 0.11, false).state).toBe('idle');
    const idle = Array.from({ length: 400 }, (_, i) => guildRelayLamp('repaired', 0, i / 100, false).intensity);
    // a short bright flash now and then over a dim glow
    expect(Math.max(...idle)).toBe(1);
    expect(Math.min(...idle)).toBeGreaterThan(0);
    expect(idle.filter((v) => v === 1).length).toBeLessThan(idle.length * 0.25);
    expect(guildRelayLamp('repaired', 0.5, 2, false)).toEqual(relayLamp(0.5, 2, false));
    expect(guildRelayLamp('powered', 1, 2, false)).toEqual({ state: 'lit', intensity: 1 });
    expect(guildRelayLamp('secured', 1, 2, false)).toEqual({ state: 'lit', intensity: 1 });
    // reduced motion: steady
    expect(guildRelayLamp('repaired', 0, 0.3, true)).toEqual(guildRelayLamp('repaired', 0, 7.1, true));
  });

  it('the Guild look has its own standby colour; the derelict one idles like it charges', () => {
    expect(relayLook('guild').idle).not.toEqual(relayLook('guild').lit);
    expect(relayLook('derelict').idle).toEqual(relayLook('derelict').charge);
  });

  it('broken: the torn cable crackles in bursts (deterministic), steady under reduced motion', () => {
    const v = Array.from({ length: 600 }, (_, i) => brokenSpark(i / 60, 3, false));
    expect(v.every((x) => x >= 0 && x <= 1)).toBe(true);
    const on = v.filter((x) => x > 0).length;
    expect(on).toBeGreaterThan(30);
    expect(on).toBeLessThan(450);
    expect(brokenSpark(1.234, 3, false)).toBe(brokenSpark(1.234, 3, false));
    expect(brokenSpark(0.1, 3, true)).toBe(brokenSpark(5.3, 3, true));
    expect(brokenSpark(0.1, 3, true)).toBeGreaterThan(0);
  });

  it('hold ring: the hold boundary while warning / fighting, the re-arm circle when interrupted', () => {
    const w = holdRing('warning', 1, false);
    const f = holdRing('fight', 1, false);
    const i = holdRing('idle', 1, false);
    expect(w.radius).toBe(RELAY_CHAIN.holdRadius);
    expect(f.radius).toBe(RELAY_CHAIN.holdRadius);
    expect(i.radius).toBe(RELAY_CHAIN.rearmRadius);
    expect(w.color).not.toEqual(f.color);
    // red reads as danger: the fight colour is the reddest
    expect(f.color[0] / f.color[1]).toBeGreaterThan(w.color[0] / w.color[1]);
    for (const r of [w, f, i]) expect(r.alpha).toBeGreaterThan(0);
    expect(holdRing('warning', 0.1, true)).toEqual(holdRing('warning', 2.7, true));
  });

  it('hold edge: shown only when the ship is near the circle, brightest on it', () => {
    expect(holdEdgeFade(900, 900)).toBe(1);
    expect(holdEdgeFade(500, 900)).toBe(0);
    expect(holdEdgeFade(1300, 900)).toBe(0);
    expect(holdEdgeFade(800, 900)).toBeGreaterThan(holdEdgeFade(700, 900));
    expect(holdEdgeFade(1000, 900)).toBeGreaterThan(0);
  });

  it('arc dots: evenly spaced on the circle around the point nearest the ship', () => {
    const c = { x: 100, y: -50 };
    const dots = arcDots(c, 400, { x: 100 + 380, y: -50 }, 120, 10);
    expect(dots.length).toBe(25);
    for (const d of dots) expect(Math.hypot(d.pos.x - c.x, d.pos.y - c.y)).toBeCloseTo(400, 6);
    // the middle dot faces the ship, the ends fade out
    const mid = dots[12]!;
    expect(mid.pos.x).toBeCloseTo(500, 6);
    expect(mid.pos.y).toBeCloseTo(-50, 6);
    expect(mid.fade).toBe(1);
    expect(dots[0]!.fade).toBeLessThan(0.1);
    const gap = Math.hypot(dots[1]!.pos.x - dots[0]!.pos.x, dots[1]!.pos.y - dots[0]!.pos.y);
    expect(gap).toBeCloseTo(10, 1);
  });
});
