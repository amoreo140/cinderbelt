import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraRig, COMBAT_MAX_DISTANCE, cameraOffset, combatLean, DEFAULT_DISTANCE, frameDistance, lookAheadOffset } from './CameraRig';

describe('cameraOffset', () => {
  it('places the camera above and behind (south) of the target', () => {
    const o = cameraOffset(10, 55);
    expect(o.x).toBe(0);
    expect(o.y).toBeCloseTo(10 * Math.sin((55 * Math.PI) / 180));
    expect(o.z).toBeCloseTo(10 * Math.cos((55 * Math.PI) / 180));
    expect(o.length()).toBeCloseTo(10);
  });
});

describe('lookAheadOffset', () => {
  it('is zero at rest', () => {
    const o = lookAheadOffset({ x: 0, y: 0 });
    expect(o.x).toBeCloseTo(0);
    expect(o.y).toBeCloseTo(0);
  });

  it('leads in the direction of velocity', () => {
    expect(lookAheadOffset({ x: 10, y: 0 })).toEqual({ x: 3.5, y: 0 });
    const o = lookAheadOffset({ x: 0, y: -4 });
    expect(o.x).toBeCloseTo(0);
    expect(o.y).toBeCloseTo(-1.4);
  });

  it('is capped at the maximum offset', () => {
    const o = lookAheadOffset({ x: 300, y: 400 }, 12);
    expect(Math.hypot(o.x, o.y)).toBeCloseTo(12);
    expect(o.x / o.y).toBeCloseTo(0.75);
  });
});

describe('CameraRig shake (M3.8)', () => {
  const rigAt = () => {
    const rig = new CameraRig(new PerspectiveCamera());
    rig.update(new Vector3(0, 0, 0), 1 / 60);
    return rig;
  };
  const offsetFromRest = (rig: CameraRig) => rig.camera.position.clone().sub(cameraOffset(rig.distance, rig.pitchDeg)).length();

  it('shakes the camera after a hit and settles back', () => {
    const rig = rigAt();
    rig.shake(1);
    let max = 0;
    for (let i = 0; i < 10; i++) {
      rig.update(new Vector3(0, 0, 0), 1 / 60);
      max = Math.max(max, offsetFromRest(rig));
    }
    expect(max).toBeGreaterThan(0.05);
    for (let i = 0; i < 120; i++) rig.update(new Vector3(0, 0, 0), 1 / 60);
    expect(offsetFromRest(rig)).toBeLessThan(1e-3);
  });

  it('a bigger blow shakes harder', () => {
    const peak = (k: number) => {
      const rig = rigAt();
      rig.shake(k);
      let max = 0;
      for (let i = 0; i < 10; i++) {
        rig.update(new Vector3(0, 0, 0), 1 / 60);
        max = Math.max(max, offsetFromRest(rig));
      }
      return max;
    };
    expect(peak(1)).toBeGreaterThan(peak(0.2));
  });

  it('does nothing when switched off', () => {
    const rig = rigAt();
    rig.shakeEnabled = false;
    rig.shake(1);
    rig.update(new Vector3(0, 0, 0), 1 / 60);
    expect(offsetFromRest(rig)).toBeLessThan(1e-9);
  });
});

describe('frameDistance (combat zoom-out, R1)', () => {
  const view = { fovDeg: 50, aspect: 16 / 9, pitchDeg: 55 };
  /** Where a plane point lands on screen (NDC) for a rig at distance d looking at the origin. */
  const ndc = (p: { x: number; y: number }, d: number) => {
    const camera = new PerspectiveCamera(view.fovDeg, view.aspect, 0.1, 5000);
    const rig = new CameraRig(camera);
    rig.shakeEnabled = false;
    rig.update(new Vector3(0, 0, 0), 1 / 60, d);
    camera.updateMatrixWorld();
    return new Vector3(p.x, 0, -p.y).project(camera);
  };

  it('is zero for the target itself', () => {
    expect(frameDistance([{ x: 0, y: 0 }], view)).toBeCloseTo(0);
  });

  it('puts the furthest point exactly on the margin', () => {
    for (const p of [{ x: 60, y: 0 }, { x: -60, y: 0 }, { x: 0, y: 40 }, { x: 0, y: -40 }, { x: 30, y: -25 }]) {
      const d = frameDistance([p], view, 0.8);
      const s = ndc(p, d);
      expect(Math.max(Math.abs(s.x), Math.abs(s.y))).toBeCloseTo(0.8, 3);
    }
  });

  it('a point towards the camera (south) needs more distance than the same point north', () => {
    expect(frameDistance([{ x: 0, y: -50 }], view)).toBeGreaterThan(frameDistance([{ x: 0, y: 50 }], view));
  });

  it('takes the most demanding of several points and grows with a smaller margin', () => {
    const a = frameDistance([{ x: 50, y: 0 }], view);
    const b = frameDistance([{ x: 0, y: -50 }], view);
    expect(frameDistance([{ x: 50, y: 0 }, { x: 0, y: -50 }], view)).toBeCloseTo(Math.max(a, b));
    expect(frameDistance([{ x: 50, y: 0 }], view, 0.6)).toBeGreaterThan(a);
  });
});

describe('CameraRig combat zoom (R1)', () => {
  const run = (rig: CameraRig, required: number | null, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) rig.frameCombat(required, 1 / 60);
  };

  it('starts at the new default zoom', () => {
    const rig = new CameraRig(new PerspectiveCamera());
    expect(rig.distance).toBe(DEFAULT_DISTANCE);
    expect(DEFAULT_DISTANCE).toBeGreaterThanOrEqual(45);
    expect(rig.maxDistance).toBeGreaterThanOrEqual(200);
    expect(rig.viewDistance).toBe(DEFAULT_DISTANCE);
  });

  it('zooms out smoothly to frame the fight, capped', () => {
    const rig = new CameraRig(new PerspectiveCamera());
    rig.frameCombat(120, 1 / 60);
    expect(rig.viewDistance).toBeGreaterThan(DEFAULT_DISTANCE);
    expect(rig.viewDistance).toBeLessThan(DEFAULT_DISTANCE + 3);
    run(rig, 120, 4);
    expect(rig.viewDistance).toBeCloseTo(120, 0);
    expect(rig.combatZoomActive).toBe(true);
    run(rig, 900, 6);
    expect(rig.viewDistance).toBeCloseTo(COMBAT_MAX_DISTANCE, 0);
  });

  it('never goes closer than the player zoom', () => {
    const rig = new CameraRig(new PerspectiveCamera());
    rig.distance = 100;
    run(rig, 60, 3);
    expect(rig.viewDistance).toBe(100);
    rig.distance = 190;
    run(rig, 120, 1);
    expect(rig.viewDistance).toBe(190);
  });

  it('holds after the fight, then returns smoothly to the player zoom', () => {
    const rig = new CameraRig(new PerspectiveCamera());
    run(rig, 130, 5);
    const peak = rig.viewDistance;
    run(rig, null, 1.5);
    expect(rig.viewDistance).toBeCloseTo(peak, 5);
    run(rig, null, 1.5);
    expect(rig.viewDistance).toBeLessThan(peak);
    expect(rig.viewDistance).toBeGreaterThan(DEFAULT_DISTANCE + 10);
    run(rig, null, 10);
    expect(rig.viewDistance).toBe(DEFAULT_DISTANCE);
    expect(rig.combatZoomActive).toBe(false);
  });

  it('a wheel zoom-in after the fight is not stuck behind an old zoom-out', () => {
    const rig = new CameraRig(new PerspectiveCamera());
    rig.distance = 180;
    run(rig, null, 1);
    rig.distance = 30;
    run(rig, null, 1 / 60);
    expect(rig.viewDistance).toBe(30);
  });
});

describe('CameraRig combat zoom – in the fight', () => {
  it('narrows slower than it opens while the fight goes on (no pumping)', () => {
    const rig = new CameraRig(new PerspectiveCamera());
    for (let t = 0; t < 4; t += 1 / 60) rig.frameCombat(130, 1 / 60);
    const open = rig.viewDistance;
    for (let t = 0; t < 1; t += 1 / 60) rig.frameCombat(60, 1 / 60);
    // one second of a close pass moves the camera in only a little
    expect(open - rig.viewDistance).toBeLessThan((open - 60) * 0.35);
    expect(rig.viewDistance).toBeGreaterThan(60);
  });
});

describe('combatLean', () => {
  it('leans part of the way towards the attacker, capped', () => {
    expect(combatLean({ x: 50, y: 0 })).toEqual({ x: 15, y: 0 });
    const far = combatLean({ x: 0, y: -400 });
    expect(far.x).toBeCloseTo(0);
    expect(far.y).toBeCloseTo(-40);
    expect(combatLean({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('the rig eases the lean in during a fight and back out after it', () => {
    const rig = new CameraRig(new PerspectiveCamera());
    for (let t = 0; t < 5; t += 1 / 60) rig.frameCombat(120, 1 / 60, { x: 20, y: 10 });
    expect(rig.combatLean.x).toBeCloseTo(20, 0);
    for (let t = 0; t < 1; t += 1 / 60) rig.frameCombat(null, 1 / 60);
    expect(rig.combatLean.x).toBeCloseTo(20, 0);
    for (let t = 0; t < 10; t += 1 / 60) rig.frameCombat(null, 1 / 60);
    expect(Math.abs(rig.combatLean.x)).toBeLessThan(0.1);
  });
});

describe('CameraRig – explicit zoom wins', () => {
  it('a wheel or a test hook during a fight stands the combat zoom-out down until the fight ends', () => {
    const rig = new CameraRig(new PerspectiveCamera());
    for (let t = 0; t < 3; t += 1 / 60) rig.frameCombat(130, 1 / 60);
    expect(rig.viewDistance).toBeGreaterThan(100);
    rig.onWheel(-300);
    const chosen = rig.distance;
    expect(rig.viewDistance).toBeCloseTo(chosen);
    for (let t = 0; t < 2; t += 1 / 60) rig.frameCombat(130, 1 / 60);
    expect(rig.viewDistance).toBeCloseTo(chosen);
    rig.distance = 25;
    rig.frameCombat(130, 1 / 60);
    expect(rig.viewDistance).toBe(25);
    // the fight ends, the hold passes – the next fight zooms out again
    for (let t = 0; t < 3; t += 1 / 60) rig.frameCombat(null, 1 / 60);
    for (let t = 0; t < 3; t += 1 / 60) rig.frameCombat(130, 1 / 60);
    expect(rig.viewDistance).toBeGreaterThan(100);
  });

  it('setting the distance outside a fight takes effect at once', () => {
    const rig = new CameraRig(new PerspectiveCamera());
    rig.distance = 90;
    expect(rig.viewDistance).toBe(90);
    rig.frameCombat(null, 1 / 60);
    expect(rig.viewDistance).toBe(90);
  });
});
