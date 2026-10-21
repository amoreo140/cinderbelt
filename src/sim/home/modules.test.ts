// Home modules (M4c plan §2.1, T1): building at home, credits, colliders in the World, the Index.
import { describe, expect, it } from 'vitest';
import { HOME_MODULE_IDS, HOME_MODULES, HOME_SLOTS, isBuildableModule, type HomeModuleId } from '../../data/home';
import { STATION_LAYOUTS } from '../../data/stations';
import { IDLE_COMMAND, type PlayerCommand } from '../commands';
import { createBody } from '../physics/body';
import { DOCK_APPROACH_RANGE, DOCK_RULES, DOCKING_COMPUTER_RULES, DOCKING_TICKS, dockPoint, dockPose } from '../station/dock';
import { act, customStation, dockedAt, expectFailure, expectOk, resultOf } from '../station/testHarness';
import { richSim } from '../fleet/testing';
import { HOME_STATION_ID, homeStation } from '../world/stations';
import type { Simulation } from '../Simulation';
import { forgeIndex, homeColliders } from './index';

const BUYABLE = HOME_MODULE_IDS.filter(isBuildableModule);
const FUTURE = HOME_MODULE_IDS.filter((m) => !isBuildableModule(m));

/** The home station's circles in the World near its centre (station + modules). */
const homeCircles = (sim: Simulation) => sim.state.world.stationCirclesNear(homeStation().pos, 1);

/** The world circles a module adds: its `circles` rotated by the station's port angle around its centre. */
function placed(module: HomeModuleId, portAngle = homeStation().portAngle) {
  const { pos } = homeStation();
  const c = Math.cos(portAngle);
  const s = Math.sin(portAngle);
  return HOME_MODULES[module].circles.map((k) => ({ pos: { x: pos.x + k.x * c - k.y * s, y: pos.y + k.x * s + k.y * c }, radius: k.r }));
}

const close = (a: { pos: { x: number; y: number }; radius: number }, b: { pos: { x: number; y: number }; radius: number }) =>
  Math.abs(a.pos.x - b.pos.x) < 1e-9 && Math.abs(a.pos.y - b.pos.y) < 1e-9 && Math.abs(a.radius - b.radius) < 1e-9;

describe('homeBuild', () => {
  it('builds the paint shop and the trophy hall at home: credits deducted exactly, events, owned', () => {
    const sim = richSim(20_000);
    let events = act(sim, { type: 'homeBuild', module: 'paintShop' });
    expectOk(events);
    expect(events).toContainEqual({ type: 'creditsChanged', delta: -8000, reason: 'homeModule' });
    expect(events).toContainEqual({ type: 'homeModuleBuilt', module: 'paintShop' });
    expect(sim.state.credits).toBe(12_000);
    events = act(sim, { type: 'homeBuild', module: 'trophyHall' });
    expectOk(events);
    expect(events).toContainEqual({ type: 'creditsChanged', delta: -5000, reason: 'homeModule' });
    expect(sim.state.credits).toBe(7000);
    expect([...sim.state.home.modules].sort()).toEqual(['paintShop', 'trophyHall']);
  });

  it('refuses a module built already (moduleOwned)', () => {
    const sim = richSim();
    expectOk(act(sim, { type: 'homeBuild', module: 'paintShop' }));
    expectFailure(sim, { type: 'homeBuild', module: 'paintShop' }, 'moduleOwned');
    expect(sim.state.home.modules.size).toBe(1);
  });

  it('refuses without enough credits and changes nothing', () => {
    const sim = richSim(7999);
    expectFailure(sim, { type: 'homeBuild', module: 'paintShop' }, 'notEnoughCredits');
    expect(sim.state.home.modules.size).toBe(0);
    sim.state.credits = 8000;
    expectOk(act(sim, { type: 'homeBuild', module: 'paintShop' }));
    expect(sim.state.credits).toBe(0);
  });

  it('refuses every later-milestone module and unknown ids (moduleUnavailable)', () => {
    const sim = richSim(1_000_000);
    sim.state.stations.get(HOME_STATION_ID)!.resources.titanium = 1000;
    expect(FUTURE.length).toBe(4);
    for (const m of FUTURE) expectFailure(sim, { type: 'homeBuild', module: m }, 'moduleUnavailable');
    expectFailure(sim, { type: 'homeBuild', module: 'hangar' as HomeModuleId }, 'moduleUnavailable');
    expect(sim.state.home.modules.size).toBe(0);
  });

  it('builds only docked at the home station (notHome in flight, while docking and at another station)', () => {
    const flying = richSim();
    act(flying, { type: 'undock' });
    for (const m of BUYABLE) expectFailure(flying, { type: 'homeBuild', module: m }, 'notHome');
    const away = dockedAt(customStation({ id: 'st:0,0', kind: 'station' }));
    away.state.credits = 100_000;
    for (const m of BUYABLE) expectFailure(away, { type: 'homeBuild', module: m }, 'notHome');
    expect(away.state.home.modules.size).toBe(0);
  });
});

describe('home colliders', () => {
  it('the module circles are in the station_layouts frame: centred off their slot, the slot hardpoint in the layout', () => {
    const layout = STATION_LAYOUTS.station_home.circles;
    for (const m of BUYABLE) {
      const def = HOME_MODULES[m];
      const slot = HOME_SLOTS[def.slot];
      // the layout has a hardpoint circle at the attach point (same axes as the module export)
      expect(layout.some((c) => Math.hypot(c.x - slot.x, c.y - slot.y) < 0.5), m).toBe(true);
      for (const c of def.circles) {
        // the module sticks out of the station along the slot's yaw
        const yaw = (slot.yawDeg * Math.PI) / 180;
        const along = (c.x - slot.x) * Math.cos(yaw) + (c.y - slot.y) * Math.sin(yaw);
        const across = -(c.x - slot.x) * Math.sin(yaw) + (c.y - slot.y) * Math.cos(yaw);
        expect(along, m).toBeGreaterThan(0);
        expect(Math.abs(across), m).toBeLessThan(0.01);
      }
    }
  });

  it('homeColliders = the circles of the built modules (station frame, unrotated), in module order', () => {
    const sim = richSim();
    expect(homeColliders(sim.state)).toEqual([]);
    act(sim, { type: 'homeBuild', module: 'trophyHall' });
    act(sim, { type: 'homeBuild', module: 'paintShop' });
    const expected = ['paintShop', 'trophyHall'].flatMap((m) =>
      HOME_MODULES[m as HomeModuleId].circles.map((c) => ({ pos: { x: c.x, y: c.y }, radius: c.r })),
    );
    expect(homeColliders(sim.state)).toEqual(expected);
  });

  it('a built module collides in the World right after the build (rotated by the port angle)', () => {
    const sim = richSim();
    const before = homeCircles(sim);
    act(sim, { type: 'homeBuild', module: 'paintShop' });
    const after = homeCircles(sim);
    expect(after).toHaveLength(before.length + HOME_MODULES.paintShop.circles.length);
    for (const c of placed('paintShop')) expect(after.some((w) => close(w, c))).toBe(true);
    act(sim, { type: 'homeBuild', module: 'trophyHall' });
    for (const c of [...placed('paintShop'), ...placed('trophyHall')]) expect(homeCircles(sim).some((w) => close(w, c))).toBe(true);
  });

  it('the ship bumps into a built module', () => {
    const sim = richSim();
    act(sim, { type: 'homeBuild', module: 'paintShop' });
    act(sim, { type: 'undock' });
    const [c] = placed('paintShop');
    const p = sim.state.player;
    // the ship flies straight at the module's centre from outside
    const dir = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    const start = { x: c!.pos.x + dir.x * (c!.radius + p.props.boundingRadius + 3), y: c!.pos.y + dir.y * (c!.radius + p.props.boundingRadius + 3) };
    const body = { ...createBody(start, 0), vel: { x: -dir.x * 5, y: -dir.y * 5 } };
    p.body = body;
    p.prevBody = body;
    for (let i = 0; i < 120; i++) sim.step(IDLE_COMMAND);
    const gap = Math.hypot(p.body.pos.x - c!.pos.x, p.body.pos.y - c!.pos.y);
    expect(gap).toBeGreaterThan(c!.radius);
  });
});

describe('the dock stays clear', () => {
  it('no module circle reaches into the approach cone of the dock clamp', () => {
    const { radius } = STATION_LAYOUTS.station_home;
    // the old ±35° alignment cone: kept as a design margin for the approach lane
    const half = (35 * Math.PI) / 180;
    for (const m of HOME_MODULE_IDS) {
      for (const c of HOME_MODULES[m].circles) {
        // cone: apex at the dock port (R, 0), axis +x, half angle = 35°,
        // DOCK_APPROACH_RANGE long – distance from the circle centre to the cone surface > r
        const dx = c.x - radius;
        const dy = Math.abs(c.y);
        const theta = Math.atan2(dy, dx);
        let dist: number;
        if (theta <= half && Math.hypot(dx, dy) <= DOCK_APPROACH_RANGE) dist = -1;
        else if (theta - half >= Math.PI / 2) dist = Math.hypot(dx, dy);
        else dist = Math.hypot(dx, dy) * Math.sin(theta - half);
        expect(dist, `${m} (${c.x}, ${c.y})`).toBeGreaterThan(c.r);
      }
    }
  });

  it('no module circle overlaps the dock pose of a big ship', () => {
    for (const bR of [2, 4, 6, 8]) {
      const point = dockPoint(homeStation(), bR);
      for (const m of HOME_MODULE_IDS) {
        for (const c of HOME_MODULES[m].circles) expect(Math.hypot(c.x - point.x, c.y - point.y), m).toBeGreaterThan(c.r + bR);
      }
    }
  });

  const dock: PlayerCommand = { ...IDLE_COMMAND, dock: true };
  const towards = (sim: Simulation, off: number, side: number, speed: number) => {
    const p = sim.state.player;
    const point = dockPoint(homeStation(), p.props.boundingRadius);
    const pos = { x: point.x + off, y: point.y + side };
    const len = Math.hypot(off, side);
    const body = { ...createBody(pos, Math.PI), vel: { x: (-off / len) * speed, y: (-side / len) * speed } };
    p.body = body;
    p.prevBody = body;
    // drift straight in (the dampers would stop the ship short of the clamp)
    p.dampers = false;
  };

  it('with both modules built the ship still docks at home – the manoeuvre and the docking computer', () => {
    for (const computer of [false, true]) {
      const sim = richSim();
      act(sim, { type: 'homeBuild', module: 'paintShop' });
      act(sim, { type: 'homeBuild', module: 'trophyHall' });
      if (computer) sim.state.discovery.archive.add('dockingComputer');
      act(sim, { type: 'undock' });
      const rules = computer ? DOCKING_COMPUTER_RULES : DOCK_RULES;
      towards(sim, rules.range + 6, computer ? 4 : 0, Math.min(rules.maxSpeed, 2.5));
      let started = false;
      for (let i = 0; i < 600 && !started; i++) {
        const events = sim.step(dock);
        started = events.some((e) => e.type === 'dockingStarted');
      }
      expect(started, computer ? 'computer' : 'manoeuvre').toBe(true);
      for (let i = 0; i < DOCKING_TICKS; i++) sim.step(IDLE_COMMAND);
      expect(sim.state.player.dock).toEqual({ mode: 'docked', stationId: HOME_STATION_ID });
      expect(sim.state.player.body).toEqual(dockPose(homeStation(), sim.state.player.props.boundingRadius));
    }
  });
});

describe('forgeIndex', () => {
  it('stays 0 in M4c (the two buildable modules are cosmetic)', () => {
    const sim = richSim();
    expect(forgeIndex(sim.state)).toBe(0);
    act(sim, { type: 'homeBuild', module: 'paintShop' });
    act(sim, { type: 'homeBuild', module: 'trophyHall' });
    expect(forgeIndex(sim.state)).toBe(0);
  });

  it('sums the points of the built modules', () => {
    const sim = richSim();
    sim.state.home.modules.add('homeRefinery');
    sim.state.home.modules.add('observatory');
    sim.state.home.modules.add('laboratory');
    expect(forgeIndex(sim.state)).toBe(2);
  });
});

describe('determinism', () => {
  it('the same commands give the same home state, credits and colliders', () => {
    const run = () => {
      const sim = richSim(30_000);
      const answers = [
        resultOf(act(sim, { type: 'homeBuild', module: 'trophyHall' })),
        resultOf(act(sim, { type: 'homeBuild', module: 'trophyHall' })),
        resultOf(act(sim, { type: 'homeBuild', module: 'paintShop' })),
      ].map((r) => (r && r.type === 'actionResult' ? r.ok : null));
      for (let i = 0; i < 30; i++) sim.step(IDLE_COMMAND);
      return { answers, modules: [...sim.state.home.modules], credits: sim.state.credits, circles: homeCircles(sim), tick: sim.state.tick };
    };
    expect(run()).toEqual(run());
  });
});
