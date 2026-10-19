import { describe, expect, it } from 'vitest';
import { STATION_KIND_RADIUS } from '../../data/stations';
import {
  inDockCorridor,
  KIND_SPECS,
  LANE_DEPTH,
  SPAWN_RANGE,
  trafficMix,
  trafficRole,
  trafficSlots,
  TRAFFIC_BY_STATION,
  turnDelta,
  vehicleAt,
  wrapAngle,
  wrapNear,
  type TrafficRole,
} from './schedule';

const KINDS = ['home', 'station', 'outpost'] as const;
/** Every traffic role with the radius of its station kind. */
const ROLES: readonly (readonly [TrafficRole, number])[] = [
  ['home', STATION_KIND_RADIUS.home],
  ['station', STATION_KIND_RADIUS.station],
  ['trade', STATION_KIND_RADIUS.station],
  ['refinery', STATION_KIND_RADIUS.station],
  ['research', STATION_KIND_RADIUS.station],
  ['outpost', STATION_KIND_RADIUS.outpost],
];

describe('traffic mix by station role', () => {
  it('the role follows the station model for plain stations, the kind otherwise', () => {
    expect(trafficRole('home', 'station_home')).toBe('home');
    expect(trafficRole('outpost', 'outpost_b')).toBe('outpost');
    expect(trafficRole('station', 'station_a')).toBe('trade');
    expect(trafficRole('station', 'station_b')).toBe('refinery');
    expect(trafficRole('station', 'station_c')).toBe('station');
    expect(trafficRole('station', 'station_d')).toBe('research');
    expect(trafficRole('station', 'station_e')).toBe('trade');
  });

  it('mining stations get barges, the Institute the survey ship, trade posts tankers and couriers', () => {
    const at = (role: TrafficRole) => trafficMix(role, 1);
    expect(at('home')).toContain('miner_barge');
    expect(at('refinery')).toContain('miner_barge');
    expect(at('research')).toContain('survey_ship');
    expect(at('trade')).toEqual(expect.arrayContaining(['tanker', 'courier']));
    expect(at('station')).toEqual(expect.arrayContaining(['tanker', 'courier']));
    expect(at('outpost')).toContain('courier');
    // the survey ship belongs to the Institute only, the barges to mining
    for (const role of ['station', 'trade', 'outpost', 'home'] as const) expect(at(role)).not.toContain('survey_ship');
    for (const role of ['station', 'trade', 'research', 'outpost'] as const) expect(at(role)).not.toContain('miner_barge');
  });

  it('has as many vehicles of each kind as the table says (full density)', () => {
    for (const [role] of ROLES) {
      const mix = trafficMix(role, 1);
      for (const [k, n] of Object.entries(TRAFFIC_BY_STATION[role])) expect(mix.filter((m) => m === k).length).toBe(n);
    }
  });

  it('long hulls that dock alongside never take neighbouring berths', () => {
    for (const [role] of ROLES) {
      for (const density of [0.35, 0.7, 1]) {
        const mix = trafficMix(role, density);
        for (let i = 1; i < mix.length; i++) expect(KIND_SPECS[mix[i]!].alongside && KIND_SPECS[mix[i - 1]!].alongside).toBe(false);
      }
    }
  });

  it('Low keeps the big batch-C ships away (draw calls), High shows them', () => {
    for (const [role] of ROLES) {
      const low = trafficMix(role, 0.35);
      for (const k of ['miner_barge', 'tanker', 'survey_ship'] as const) expect(low).not.toContain(k);
    }
    expect(trafficMix('home', 1).length).toBeLessThanOrEqual(10);
  });
});

describe('trafficSlots', () => {
  it('home is the busiest, outposts the sparsest', () => {
    const n = (k: (typeof KINDS)[number]) => trafficSlots(`s-${k}`, k, 1).length;
    expect(n('home')).toBeGreaterThan(n('station'));
    expect(n('station')).toBeGreaterThan(n('outpost'));
    expect(n('home')).toBe(Object.values(TRAFFIC_BY_STATION.home).reduce((a, b) => a + b, 0));
  });

  it('density scales the count; the home station keeps at least one shuttle', () => {
    expect(trafficSlots('home', 'home', 0.35).length).toBeLessThan(trafficSlots('home', 'home', 1).length);
    expect(trafficSlots('home', 'home', 0.05).length).toBe(1);
    expect(trafficSlots('out', 'outpost', 0)).toEqual([]);
  });

  it('is the same for the same station and differs between stations', () => {
    expect(trafficSlots('st:1', 'station', 1)).toEqual(trafficSlots('st:1', 'station', 1));
    expect(trafficSlots('st:1', 'station', 1)).not.toEqual(trafficSlots('st:2', 'station', 1));
  });

  it('berths are all different', () => {
    const slots = trafficSlots('home', 'home', 1);
    const angles = slots.map((s) => s.berthAngle).sort((a, b) => a - b);
    for (let i = 1; i < angles.length; i++) expect(angles[i]! - angles[i - 1]!).toBeGreaterThan(0.2);
  });
});

describe('vehicleAt', () => {
  for (const [kind, R] of ROLES) {
    it(`${kind}: never enters the dock corridor or the station, appears and vanishes far below`, () => {
      for (const id of ['a', 'b', 'c', 'home']) {
        const slots = trafficSlots(`${kind}-${id}`, kind, 1);
        let seen = 0;
        for (const slot of slots) {
          for (let t = 0; t < 900; t += 0.37) {
            const v = vehicleAt(`${kind}-${id}`, slot, R, t);
            if (!v) continue;
            seen++;
            expect(inDockCorridor(v.x, v.z, R)).toBe(false);
            const r = Math.hypot(v.x, v.z);
            // near the plane it stays outside the station rim
            if (v.y > -8) expect(r).toBeGreaterThan(R + 1.5);
            // where it is barely visible (small), it is far away and deep below
            if (v.scale < 0.05) {
              expect(r).toBeGreaterThan(SPAWN_RANGE[0] * 0.8);
              expect(v.y).toBeLessThan(-LANE_DEPTH * 0.8);
            }
            expect(Number.isFinite(v.heading)).toBe(true);
            expect(v.throttle).toBeGreaterThanOrEqual(0);
            expect(v.throttle).toBeLessThanOrEqual(1);
          }
        }
        expect(seen).toBeGreaterThan(0);
      }
    });
  }

  it('moves continuously (no teleports while visible)', () => {
    // a trader (the fast shuttles cover ~60 u/s at the far end of the lane)
    const slot = trafficSlots('home', 'home', 1).find((s) => s.kind === 'trader')!;
    let prev: ReturnType<typeof vehicleAt> = null;
    for (let t = 0; t < 600; t += 0.05) {
      const v = vehicleAt('home', slot, 14, t);
      if (v && prev && v.scale > 0.5 && prev.scale > 0.5) {
        expect(Math.hypot(v.x - prev.x, v.y - prev.y, v.z - prev.z)).toBeLessThan(3);
      }
      prev = v;
    }
  });

  it('holds still at the berth while docked', () => {
    const slot = trafficSlots('home', 'home', 1)[0]!;
    const poses = [];
    for (let t = 0; t < slot.period * 2; t += 0.5) {
      const v = vehicleAt('home', slot, 14, t);
      if (v?.phase === 'docked') poses.push(v);
    }
    expect(poses.length).toBeGreaterThan(10);
    for (const p of poses) {
      expect(p.throttle).toBe(0);
      expect(Math.hypot(p.x - poses[0]!.x, p.z - poses[0]!.z)).toBeLessThan(1e-9);
    }
  });
});

describe('inDockCorridor', () => {
  it('covers the approach along +X and nothing behind the station', () => {
    expect(inDockCorridor(40, 0, 14)).toBe(true);
    expect(inDockCorridor(40, 20, 14)).toBe(true);
    expect(inDockCorridor(-40, 0, 14)).toBe(false);
    expect(inDockCorridor(0, 40, 14)).toBe(false);
    expect(inDockCorridor(600, 0, 14)).toBe(false);
  });
});

describe('turning (no doubled animation)', () => {
  const wrap = (d: number) => Math.atan2(Math.sin(d), Math.cos(d));
  for (const [kind, R] of ROLES) {
    it(`${kind}: the heading changes smoothly frame to frame, one way through every turn (incl. the ±π reversal)`, () => {
      for (const id of ['a', 'b', 'c', 'home', 'st:7']) {
        for (const slot of trafficSlots(`${kind}-${id}`, kind, 1)) {
          let prev: ReturnType<typeof vehicleAt> = null;
          let lastTurn = 0;
          for (let t = 0; t < slot.period * 2; t += 1 / 60) {
            const v = vehicleAt(`${kind}-${id}`, slot, R, t);
            if (v && prev && v.scale > 0.2 && prev.scale > 0.2) {
              const d = wrap(v.heading - prev.heading);
              // at most ~1 rad/s – never a jump to another orientation
              expect(Math.abs(d)).toBeLessThan(0.05);
              // no flip-flop: the turn direction does not reverse from one frame to the next
              if (Math.abs(d) > 1e-4 && Math.abs(lastTurn) > 1e-4) expect(Math.sign(d) === Math.sign(lastTurn) || Math.abs(d) < 0.004).toBe(true);
              if (Math.abs(d) > 1e-4) lastTurn = d;
            } else lastTurn = 0;
            prev = v;
          }
        }
      }
    });
  }
});

describe('turn math across the ±π wrap', () => {
  it('wrapAngle lands in (−π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(wrapAngle(Math.PI - 0.1 + 4 * Math.PI)).toBeCloseTo(Math.PI - 0.1, 9);
    expect(wrapAngle(-0.2)).toBeCloseTo(-0.2, 9);
  });

  it('179° → −179° is a 2° turn, not 358°', () => {
    const from = (179 * Math.PI) / 180;
    const to = (-179 * Math.PI) / 180;
    expect(turnDelta(from, to, 0, 1)).toBeCloseTo((2 * Math.PI) / 180, 9);
  });

  it('a reversal turns the preferred way, whatever noise says', () => {
    for (const noise of [-1e-9, 0, 1e-9, -0.01, 0.01]) {
      expect(turnDelta(0, Math.PI + noise, 0, 1)).toBeGreaterThan(3);
      expect(turnDelta(0, Math.PI + noise, 0, -1)).toBeLessThan(-3);
    }
  });

  it('wrapNear keeps a noisy reversal on one branch', () => {
    const ref = Math.PI;
    for (const noise of [-0.02, -1e-6, 0, 1e-6, 0.02]) {
      // the shortest-arc value would flip between +π and −π here
      const d = wrapNear(-Math.PI + noise, ref);
      expect(d).toBeCloseTo(Math.PI + noise, 9);
    }
  });
});

describe('vehicleAt per-cycle cache', () => {
  it('a slot that remembers its cycle turns poses exactly like a fresh one', () => {
    for (const [role, radius] of ROLES) {
      const warm = trafficSlots(`st:${role}`, role, 1);
      for (let t = 0; t < 400; t += 0.37) {
        const fresh = trafficSlots(`st:${role}`, role, 1);
        warm.forEach((slot, i) => {
          expect(vehicleAt(`st:${role}`, slot, radius, t)).toEqual(vehicleAt(`st:${role}`, fresh[i]!, radius, t));
        });
      }
    }
  });
});
