import { describe, expect, it } from 'vitest';
import { makeDormant, think, wakeEnemy } from '../../sim/combat/ai';
import { createEnemy } from '../../sim/combat/enemies';
import { enemyLook, idleSweep, salvoTell, SALVO_CHARGE_TICKS, standbyBlink, SWEEP_HALF } from './enemyLooks';

const gunnerAt = (x: number) => createEnemy({ id: 'pr:test:g', kind: 'gunner', tier: 2, pos: { x, y: 0 }, angle: Math.PI, home: { x, y: 0 }, orbit: 1 });

describe('enemy looks (M4b T14)', () => {
  it('a sleeper is dressed dormant until it wakes; a sentry as a sentry; the rest as pirates', () => {
    const e = createEnemy({ id: 'gs:test:1', kind: 'jackal', tier: 1, pos: { x: 0, y: 0 }, angle: 0, home: { x: 0, y: 0 }, orbit: 1 });
    expect(enemyLook(e)).toBe('pirate');
    makeDormant(e);
    expect(enemyLook(e)).toBe('dormant');
    wakeEnemy(e);
    expect(enemyLook(e)).toBe('pirate');
    const s = createEnemy({ id: 'dd:test:1', kind: 'sentry', tier: 1, pos: { x: 0, y: 0 }, angle: 0, home: { x: 0, y: 0 }, orbit: 1 });
    expect(enemyLook(s)).toBe('sentry');
  });

  it('every salvo of the real Gunner AI is told: the charge runs ~0.9 s and peaks right before the first shot', () => {
    const g = gunnerAt(0);
    const target = { pos: { x: -85, y: 0 }, vel: { x: 0, y: 0 } };
    const holder = { rng: 7 };
    let fired = 0;
    let lastFire = false;
    let charging = 0;
    let peak = 0;
    for (let i = 0; i < 60 * 20; i++) {
      // the tell the renderer shows for the state before this step (alpha 1 = right before it)
      const tell = salvoTell(g, true, 1);
      const { cmd } = think(g, target, holder);
      if (cmd.fire && !lastFire) {
        fired++;
        // the salvo's first shot: the window is open and the tell was building up to it
        if (fired > 1) {
          expect(peak).toBeGreaterThan(0.95);
          expect(charging).toBeGreaterThanOrEqual(SALVO_CHARGE_TICKS - 2);
        }
      }
      if (tell.charge > 0 && !tell.firing) {
        charging++;
        peak = Math.max(peak, tell.charge);
      } else if (tell.firing) {
        charging = 0;
        peak = 0;
      }
      if (cmd.fire) expect(tell.firing).toBe(true);
      lastFire = cmd.fire;
    }
    expect(fired).toBeGreaterThan(4);
  });

  it('no tell when not attacking, out of reach or not a Gunner', () => {
    const g = gunnerAt(0);
    g.ai.mode = 'attack';
    g.ai.breakOff = 150;
    expect(salvoTell(g, true, 0).charge).toBeGreaterThan(0);
    expect(salvoTell(g, false, 0).charge).toBe(0);
    g.ai.mode = 'evade';
    expect(salvoTell(g, true, 0).charge).toBe(0);
    const j = createEnemy({ id: 'pr:test:j', kind: 'jackal', tier: 1, pos: { x: 0, y: 0 }, angle: 0, home: { x: 0, y: 0 }, orbit: 1 });
    j.ai.mode = 'attack';
    j.ai.breakOff = 150;
    expect(salvoTell(j, true, 0).charge).toBe(0);
  });

  it('the idle sweep stays within its arc in front of the drone; the standby blink is a short pulse', () => {
    const v = { x: 0, y: 0 };
    let maxA = 0;
    for (let t = 0; t < 12; t += 0.05) {
      idleSweep(t, 1.3, v);
      const a = Math.atan2(v.y, v.x);
      maxA = Math.max(maxA, Math.abs(a));
      expect(v.x).toBeGreaterThan(0);
    }
    expect(maxA).toBeCloseTo(SWEEP_HALF, 2);
    let lit = 0;
    for (let t = 0; t < 26; t += 0.01) if (standbyBlink(t, 0.4) > 0) lit++;
    // 10 pulses of 0.18 s in 26 s: lit ~7 % of the time
    expect(lit / 2600).toBeGreaterThan(0.05);
    expect(lit / 2600).toBeLessThan(0.09);
  });
});
