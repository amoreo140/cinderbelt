import { describe, expect, it } from 'vitest';
import { createBody } from '../physics/body';
import { homeStation, type StationDef } from '../world/stations';
import { DOCK_RULES, DOCKING_COMPUTER_RULES, checkDock, dockPoint, dockPose, rebuiltDockPose, smoothstep, undockPose } from './dock';

const station = (id: string, x: number, y: number, portAngle = 0): StationDef => ({
  ...homeStation(),
  id,
  pos: { x, y },
  portAngle,
});

describe('dockPose', () => {
  it('puts the ship centre bR + 1 beyond the dock port with the bow towards the station', () => {
    const pose = dockPose(station('a', 100, 50, Math.PI / 2), 3);
    expect(pose.pos.x).toBeCloseTo(100);
    expect(pose.pos.y).toBeCloseTo(50 + 14 + 3 + 1);
    expect(pose.angle).toBeCloseTo(-Math.PI / 2);
    expect(pose.vel).toEqual({ x: 0, y: 0 });
    expect(pose.angVel).toBe(0);
  });

  it('undocks at the same place facing away from the station', () => {
    const s = station('a', 0, 0, 0);
    const pose = undockPose(s, 2.5);
    expect(pose.pos).toEqual(dockPose(s, 2.5).pos);
    expect(pose.angle).toBe(0);
  });
});

describe('checkDock', () => {
  const s = station('a', 0, 0);
  const bR = 3;
  /** The docking point (ship centre when docked) of station s: (R + bR + 1, 0). */
  const P = 14 + bR + 1;
  /** A ship `off` units out along the dock axis, bow `turn` rad off the station-facing heading. */
  const at = (off: number, speed = 0, turn = 0, side = 0) => ({
    ...createBody({ x: P + off, y: side }, Math.PI + turn),
    vel: { x: 0, y: speed },
  });

  it('reports no station when none is loaded', () => {
    expect(checkDock(at(1), bR, []).status).toBe('noStation');
  });

  it('measures the distance to the docking point by the clamp, not to the hull', () => {
    expect(dockPoint(s, bR)).toEqual({ x: P, y: 0 });
    const c = checkDock(at(2, 0, 0, 1), bR, [s]);
    expect(c.distance).toBeCloseTo(Math.hypot(2, 1));
    expect(c.point).toEqual({ x: P, y: 0 });
  });

  it('accepts exactly the clamp range and rejects beyond it (also beside the axis)', () => {
    expect(checkDock(at(DOCK_RULES.range), bR, [s]).status).toBe('ok');
    expect(checkDock(at(DOCK_RULES.range + 0.01), bR, [s]).status).toBe('tooFar');
    // the old rule (12 u from the hull anywhere around) no longer docks: the far side of the station
    const farSide = { ...createBody({ x: -(14 + bR + 2), y: 0 }, 0) };
    expect(checkDock(farSide, bR, [s]).status).toBe('tooFar');
  });

  it('accepts exactly the maximum speed and rejects faster ships', () => {
    expect(checkDock(at(1, DOCK_RULES.maxSpeed), bR, [s]).status).toBe('ok');
    expect(checkDock(at(1, DOCK_RULES.maxSpeed + 0.01), bR, [s]).status).toBe('tooFast');
  });

  it('accepts any heading, also the bow away from the station (the undock heading)', () => {
    expect(DOCK_RULES.maxAngle).toBeNull();
    for (const turn of [0, 0.7, -1.5, Math.PI / 2, Math.PI, -Math.PI + 0.01]) {
      expect(checkDock(at(1, 0, turn), bR, [s]).status, `turn ${turn}`).toBe('ok');
    }
    expect(checkDock(at(1, 0, Math.PI), bR, [s]).angle).toBeCloseTo(Math.PI);
  });

  it('follows the port angle of the station', () => {
    const turned = station('t', 100, 0, Math.PI / 2);
    // dock axis points +y: the docking point is above the station, the bow points −y
    const body = createBody({ x: 100, y: P + 1 }, -Math.PI / 2);
    expect(checkDock(body, bR, [turned]).status).toBe('ok');
    expect(checkDock({ ...body, angle: 0 }, bR, [turned]).status).toBe('ok');
    expect(checkDock({ ...body, angle: 0 }, bR, [turned]).angle).toBeCloseTo(Math.PI / 2);
  });

  it('reports the first failing rule: distance, then speed', () => {
    expect(checkDock(at(40, 20, 2), bR, [s]).status).toBe('tooFar');
    expect(checkDock(at(1, 20, 2), bR, [s]).status).toBe('tooFast');
  });

  it('picks the station whose docking point is nearest', () => {
    const far = station('far', 60, 0);
    const result = checkDock(createBody({ x: 25, y: 0 }, Math.PI), bR, [far, s]);
    expect(result.station?.id).toBe('a');
    expect(result.distance).toBeCloseTo(25 - P);
  });

  it('the docking computer extends the reach: 12 u and 6 u/s', () => {
    expect(DOCKING_COMPUTER_RULES).toMatchObject({ range: 12, maxSpeed: 6, maxAngle: null });
    expect(checkDock(at(12, 6, Math.PI), bR, [s], DOCKING_COMPUTER_RULES).status).toBe('ok');
    expect(checkDock(at(12.1), bR, [s], DOCKING_COMPUTER_RULES).status).toBe('tooFar');
    expect(checkDock(at(1, 6.1), bR, [s], DOCKING_COMPUTER_RULES).status).toBe('tooFast');
  });
});

describe('smoothstep', () => {
  it('eases from 0 to 1', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(2)).toBe(1);
  });
});

describe('rebuiltDockPose', () => {
  const station: StationDef = { ...homeStation(), pos: { x: 100, y: -50 }, portAngle: Math.PI / 2 };

  it('keeps the grid origin sideways and the dock distance for the new radius', () => {
    const body = dockPose(station, 3);
    // bow at the station (angle −π/2): local +y → world +x, i.e. sideways at the port on +y
    const pose = rebuiltDockPose(station, body, { x: 0, y: 0 }, { x: 0.5, y: 0.25 }, 4);
    expect(pose.pos.x).toBeCloseTo(station.pos.x + 0.25);
    expect(pose.pos.y).toBeCloseTo(station.pos.y + station.radius + 4 + 1);
    expect(pose.angle).toBe(body.angle);
    expect(pose.vel).toEqual({ x: 0, y: 0 });
  });

  it('equals the dock pose when the center of mass does not move', () => {
    const body = dockPose(station, 3);
    const pose = rebuiltDockPose(station, body, { x: 1, y: 1 }, { x: 1, y: 1 }, 3);
    expect(pose.pos.x).toBeCloseTo(body.pos.x);
    expect(pose.pos.y).toBeCloseTo(body.pos.y);
  });
});

describe('a custom alignment rule still reports misaligned', () => {
  it('rules with maxAngle reject a bow outside the cone', () => {
    const s = station('a', 0, 0);
    const rules = { range: 4, maxSpeed: 3, maxAngle: 0.5 };
    const p = dockPoint(s, 2);
    expect(checkDock({ pos: p, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 }, 2, [s], rules).status).toBe('misaligned');
    expect(checkDock({ pos: p, vel: { x: 0, y: 0 }, angle: Math.PI + 0.1, angVel: 0 }, 2, [s], rules).status).toBe('ok');
  });
});
