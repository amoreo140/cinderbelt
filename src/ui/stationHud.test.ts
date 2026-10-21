import { describe, expect, it } from 'vitest';
import { homeStation } from '../sim/world/stations';
import type { Body } from '../sim/physics/body';
import {
  checkDock,
  DOCK_APPROACH_RANGE,
  DOCK_RULES,
  DOCKING_COMPUTER_RULES,
  dockHeading,
  dockPoint,
  undockPose,
  type DockCheck,
  type DockRules,
} from '../sim/station/dock';
import { buildStationContacts, dockPrompt, dockRejectedText, DockReadoutGate, edgeArrow } from './stationHud';

const home = homeStation();
type Status = 'ok' | 'tooFar' | 'tooFast' | 'misaligned' | 'noStation';
const check = (status: Status, distance: number, speed = 0, angle = 0, rules: DockRules = DOCK_RULES): DockCheck => ({
  status,
  station: status === 'noStation' ? null : home,
  point: status === 'noStation' ? null : { x: 18, y: 0 },
  distance,
  speed,
  angle,
  rules,
});
const deg = (d: number) => (d * Math.PI) / 180;

describe('dockPrompt', () => {
  it('invites to land when all three items are in tolerance, with the readout all green', () => {
    const p = dockPrompt(check('ok', 2.34, 1.5, deg(12)), 'Kotva')!;
    expect(p).toMatchObject({ text: 'F – pristáť na stanici Kotva', kind: 'ok' });
    expect(p.approach!.items).toEqual([
      { id: 'distance', label: 'Svorka', value: '2,3 j', limit: '≤ 4 j', ok: true },
      { id: 'speed', label: 'Rýchlosť', value: '1,5 j/s', limit: '≤ 3 j/s', ok: true },
    ]);
    expect(p.approach!.computer).toBe(false);
  });

  it('marks each item out of tolerance and says what to fix first', () => {
    const far = dockPrompt(check('tooFar', 9.6, 5, deg(80)), 'Kotva')!;
    expect(far).toMatchObject({ text: 'Prileť k dokovacej svorke na konci ramena', kind: 'info' });
    expect(far.approach!.items.map((i) => i.ok)).toEqual([false, false]);
    const fast = dockPrompt(check('tooFast', 3, 4.25, deg(10)), 'Kotva')!;
    expect(fast).toMatchObject({ text: 'Spomaľ', kind: 'warn' });
    expect(fast.approach!.items.map((i) => i.ok)).toEqual([true, false]);
    expect(fast.approach!.items[1]!.value).toBe('4,3 j/s');
  });

  it('shows the relaxed limits of the docking computer and no heading item', () => {
    const p = dockPrompt(check('ok', 10, 5.5, deg(170), DOCKING_COMPUTER_RULES), 'Kotva')!;
    expect(p.kind).toBe('ok');
    expect(p.approach!.computer).toBe(true);
    expect(p.approach!.items.map((i) => i.limit)).toEqual(['≤ 12 j', '≤ 6 j/s']);
  });

  it('stays silent beyond the approach range and without a station', () => {
    expect(dockPrompt(check('tooFar', DOCK_APPROACH_RANGE + 0.5), 'Kotva')).toBeNull();
    expect(dockPrompt(check('tooFar', DOCK_APPROACH_RANGE - 0.5), 'Kotva')).not.toBeNull();
    expect(dockPrompt(check('noStation', Infinity), '')).toBeNull();
  });
});

describe('DockReadoutGate', () => {
  // the starter ship's bounding radius is irrelevant here – any radius gives the same docking point logic
  const R = 2;
  const point = dockPoint(home, R);
  /** A pose `offset` u out from the docking point on the dock axis (the home port faces +x). */
  const at = (offset: number, vx = 0, turn = 0): Body => ({
    pos: { x: point.x + offset, y: point.y },
    vel: { x: vx, y: 0 },
    angle: dockHeading(home) + turn,
    angVel: 0,
  });
  const shown = (gate: DockReadoutGate, mode: 'flying' | 'docked', body: Body, rules: DockRules = DOCK_RULES) =>
    gate.update(mode, body, checkDock(body, R, [home], rules));
  /** A gate that has just seen the ship undock (docked one frame, flying the next in the undock pose). */
  const undocked = (rules: DockRules = DOCK_RULES) => {
    const gate = new DockReadoutGate();
    expect(shown(gate, 'docked', undockPose(home, R), rules)).toBe(false);
    return gate;
  };

  it('hides the readout right after undocking, while the ship sits in the undock pose', () => {
    const gate = undocked();
    expect(shown(gate, 'flying', undockPose(home, R))).toBe(false);
    // parked in the undock pose for a long while – still leaving, not approaching
    for (let i = 0; i < 600; i++) shown(gate, 'flying', undockPose(home, R));
    expect(shown(gate, 'flying', undockPose(home, R))).toBe(false);
  });

  it('stays hidden while the departing ship flies away, even turned sideways', () => {
    const gate = undocked();
    expect(shown(gate, 'flying', at(1, 4, Math.PI))).toBe(false);
    expect(shown(gate, 'flying', at(8, 6, Math.PI / 2))).toBe(false);
    expect(shown(gate, 'flying', at(15, 6, 0.3))).toBe(false);
  });

  it('shows the readout once the departing ship closes in', () => {
    const hovering = undocked();
    expect(shown(hovering, 'flying', at(0.5, 0, 0.4))).toBe(false);
    // reversing in with the bow away still counts as an approach
    const reversing = undocked();
    expect(shown(reversing, 'flying', at(6, -1.5, Math.PI))).toBe(true);
    // the departure is over – drifting at rest now shows the readout
    expect(shown(reversing, 'flying', at(5, 0, Math.PI))).toBe(true);
  });

  it('ends the departure when the ship leaves the approach range, so a later approach shows it', () => {
    const gate = undocked();
    expect(shown(gate, 'flying', at(DOCK_APPROACH_RANGE + 2, 6, Math.PI))).toBe(false);
    expect(shown(gate, 'flying', at(20, 0, Math.PI))).toBe(true);
  });

  it('does not hide anything for a ship that was never docked (a loaded flying save)', () => {
    const gate = new DockReadoutGate();
    expect(shown(gate, 'flying', at(10, 0, 1.4))).toBe(true);
    expect(shown(gate, 'flying', at(10, -2, 0))).toBe(true);
  });

  it('hides the readout while the ship moves away from the docking point, unless F would still dock', () => {
    const gate = new DockReadoutGate();
    expect(shown(gate, 'flying', at(10, 3, 0))).toBe(false);
    // a slow drift out within every tolerance keeps the green F prompt
    expect(shown(gate, 'flying', at(2, 1, 0))).toBe(true);
    // beyond the readout range nothing shows
    expect(shown(gate, 'flying', at(DOCK_APPROACH_RANGE + 1, -2, 0))).toBe(false);
  });

  it('keeps the docking computer quiet after undocking too (any heading would be "ready")', () => {
    const gate = undocked(DOCKING_COMPUTER_RULES);
    expect(shown(gate, 'flying', undockPose(home, R), DOCKING_COMPUTER_RULES)).toBe(false);
    expect(shown(gate, 'flying', at(10, -2, Math.PI), DOCKING_COMPUTER_RULES)).toBe(true);
  });
});

describe('dockRejectedText', () => {
  it('names the failing rule with the value and the limit', () => {
    const e = { distance: 7.26, speed: 4.51, angle: deg(62.4) };
    expect(dockRejectedText({ ...e, reason: 'tooFar' }, DOCK_RULES)).toBe('Príliš ďaleko od dokovacej svorky: 7,3 j (treba do 4 j)');
    expect(dockRejectedText({ ...e, reason: 'tooFast' }, DOCK_RULES)).toBe('Príliš rýchlo na pristátie: 4,5 j/s (treba do 3 j/s)');
    expect(dockRejectedText({ ...e, reason: 'noStation' }, DOCK_RULES)).toBe('V okolí nie je žiadna stanica');
    expect(dockRejectedText({ ...e, reason: 'tooFast' }, DOCKING_COMPUTER_RULES)).toBe('Príliš rýchlo na pristátie: 4,5 j/s (treba do 6 j/s)');
  });
});

describe('buildStationContacts', () => {
  it('keeps stations within radar range relative to the ship', () => {
    const far = { ...home, id: 'st:9,9', pos: { x: 500, y: 0 } };
    const contacts = buildStationContacts([home, far], { x: 30, y: 40 }, 180);
    expect(contacts).toEqual([{ x: -30, y: -40, kind: 'home' }]);
  });

  it('pins out-of-range stations to the rim when asked', () => {
    const far = { ...home, id: 'st:9,9', kind: 'station' as const, pos: { x: 500, y: 0 } };
    expect(buildStationContacts([far], { x: 0, y: 0 }, 100, true)).toEqual([{ x: 100, y: 0, kind: 'station', edge: true }]);
  });
});

describe('edgeArrow', () => {
  const view = { width: 1000, height: 600 };

  it('is hidden for points on screen', () => {
    expect(edgeArrow({ x: 500, y: 300 }, view, 40)).toBeNull();
    expect(edgeArrow({ x: 960, y: 300 }, view, 40)).toBeNull();
  });

  it('clamps off-screen points to the margin and points towards them', () => {
    const right = edgeArrow({ x: 3000, y: 300 }, view, 40)!;
    expect(right.x).toBe(960);
    expect(right.y).toBe(300);
    expect(right.angle).toBeCloseTo(0);
    const up = edgeArrow({ x: 500, y: -2000 }, view, 40)!;
    expect(up.y).toBe(40);
    expect(up.x).toBeCloseTo(500);
    expect(up.angle).toBeCloseTo(-Math.PI / 2);
  });

  it('handles points behind the camera by flipping them', () => {
    const behind = edgeArrow({ x: 600, y: 300, behind: true }, view, 40)!;
    expect(behind.x).toBeCloseTo(40);
  });
});
