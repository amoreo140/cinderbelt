import { describe, expect, it } from 'vitest';
import { homeStation } from '../sim/world/stations';
import { DOCKING_TICKS } from '../sim/station/dock';
import { beaconLevel, clampJawTarget, dockView, FOCUS_BLEND_TIME, guideLightLevel, insetShift, mixDockView, moduleFocusView, stepClampJaw, stepFocusBlend } from './stationAnim';

describe('beaconLevel', () => {
  it('flashes briefly once per period and stays dim otherwise', () => {
    const levels = Array.from({ length: 240 }, (_, i) => beaconLevel(i / 60, 0));
    const bright = levels.filter((l) => l > 0.9).length;
    expect(bright).toBeGreaterThan(5);
    expect(bright).toBeLessThan(80);
    expect(Math.min(...levels)).toBeGreaterThanOrEqual(0.1);
    expect(Math.max(...levels)).toBeLessThanOrEqual(1);
  });

  it('offsets beacons from each other', () => {
    const a = Array.from({ length: 120 }, (_, i) => beaconLevel(i / 60, 0));
    const b = Array.from({ length: 120 }, (_, i) => beaconLevel(i / 60, 1));
    expect(a).not.toEqual(b);
  });
});

describe('guideLightLevel', () => {
  it('chases outwards: each light peaks after the previous one', () => {
    const peak = (index: number) => {
      let best = 0;
      let at = 0;
      for (let i = 0; i < 60; i++) {
        const l = guideLightLevel(i / 60, index, 4);
        if (l > best) {
          best = l;
          at = i;
        }
      }
      return at;
    };
    expect(peak(0)).toBeLessThan(peak(1));
    expect(peak(1)).toBeLessThan(peak(2));
    expect(peak(2)).toBeLessThan(peak(3));
  });
});

describe('dockView', () => {
  it('frames the station and the docked ship', () => {
    const view = dockView(homeStation(), 3);
    expect(view.target.x).toBeGreaterThan(0);
    expect(view.target.x).toBeLessThan(14 + 3 + 1);
    expect(view.target.y).toBeCloseTo(0);
    expect(view.distance).toBeGreaterThan(40);
    expect(view.distance).toBeLessThan(140);
  });
});

describe('insetShift', () => {
  it('shifts the camera target to centre the scene in the free part of the screen', () => {
    expect(insetShift(0, 1280, 60, 50, 16 / 9)).toBe(0);
    const shift = insetShift(640, 1280, 60, 50, 16 / 9);
    // visible width ≈ 2 × 60 × tan(25°) × 16/9 ≈ 99.5 → a shift by a quarter
    expect(shift).toBeCloseTo(24.9, 0);
  });
});

describe('clamp jaws', () => {
  const body = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };

  it('are open while no ship is held and close along the latch at their station only', () => {
    expect(clampJawTarget({ mode: 'flying' }, 100, 'home')).toBe(0);
    const docking = { mode: 'docking', stationId: 'home', startTick: 100, from: body, to: body } as const;
    expect(clampJawTarget(docking, 100, 'home')).toBe(0);
    expect(clampJawTarget(docking, 100 + DOCKING_TICKS / 2, 'home')).toBeCloseTo(0.5);
    expect(clampJawTarget(docking, 100 + DOCKING_TICKS, 'home')).toBe(1);
    expect(clampJawTarget(docking, 130, 'st:1,2')).toBe(0);
    expect(clampJawTarget({ mode: 'docked', stationId: 'home' }, 5, 'home')).toBe(1);
    expect(clampJawTarget({ mode: 'docked', stationId: 'home' }, 5, 'st:1,2')).toBe(0);
  });

  it('follow a closing latch at once and open at a steady pace (instantly with reduced motion)', () => {
    expect(stepClampJaw(0.2, 0.6, 1 / 60)).toBe(0.6);
    const opening = stepClampJaw(1, 0, 0.1);
    expect(opening).toBeGreaterThan(0.8);
    expect(opening).toBeLessThan(1);
    expect(stepClampJaw(0.05, 0, 0.1)).toBe(0);
    expect(stepClampJaw(1, 0, 0.1, true)).toBe(0);
  });
});

describe('moduleFocusView', () => {
  const home = homeStation();

  it('frames the trophy hall (rl) close – it fills the view left of the hub – centred on the module', () => {
    const view = moduleFocusView(home, 'rl', 3);
    const dock = dockView(home, 3);
    // the hall sits back-left of the hub: circle (-9.97, 9.97) r 2.6
    expect(view.target.x).toBeCloseTo(-9.97, 1);
    expect(view.target.y).toBeCloseTo(9.97, 1);
    expect(view.distance).toBeLessThan(dock.distance * 0.35);
    expect(view.distance).toBeGreaterThanOrEqual(9);
    expect(view.distance).toBeLessThan(12);
  });

  it('frames the paint shop (fl) together with the docked ship', () => {
    const small = moduleFocusView(home, 'fl', 3);
    const big = moduleFocusView(home, 'fl', 9);
    // between the shop (9.9, 9.9) and the ship on the dock axis (y = 0)
    expect(small.target.y).toBeGreaterThan(0);
    expect(small.target.y).toBeLessThan(9.9);
    expect(small.target.x).toBeGreaterThan(9.9);
    expect(big.distance).toBeGreaterThan(small.distance);
  });

  it('turns with the station', () => {
    const turned = { ...home, pos: { x: 50, y: 20 }, portAngle: Math.PI };
    const view = moduleFocusView(turned, 'rl', 3);
    expect(view.target.x).toBeCloseTo(50 + 9.97, 1);
    expect(view.target.y).toBeCloseTo(20 - 9.97, 1);
  });
});

describe('focus blend', () => {
  it('takes FOCUS_BLEND_TIME both ways and cuts with reduced motion', () => {
    let k = 0;
    for (let i = 0; i < 6; i++) k = stepFocusBlend(k, 1, FOCUS_BLEND_TIME / 6);
    expect(k).toBeCloseTo(1, 6);
    expect(stepFocusBlend(1, 0, FOCUS_BLEND_TIME / 2)).toBeCloseTo(0.5, 6);
    expect(stepFocusBlend(0, 1, 0.01, true)).toBe(1);
    expect(stepFocusBlend(1, 0, 0.01, true)).toBe(0);
  });

  it('mixes the dock and module views with an eased blend', () => {
    const a = { target: { x: 0, y: 0 }, distance: 50 };
    const b = { target: { x: 10, y: -10 }, distance: 20 };
    expect(mixDockView(a, b, 0)).toEqual(a);
    expect(mixDockView(a, b, 1)).toEqual(b);
    const mid = mixDockView(a, b, 0.5);
    expect(mid.target.x).toBeCloseTo(5, 6);
    expect(mid.distance).toBeCloseTo(35, 6);
    expect(mixDockView(a, b, 0.1).target.x).toBeLessThan(1);
  });
});
