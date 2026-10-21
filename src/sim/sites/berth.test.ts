// M4b T4: berth at a derelict's dock clamp (plan §2.4) – the station manoeuvre rules, relay power, the
// latch, a pinned berthed ship, leaving, and that a berth is never a station dock.
import { describe, expect, it } from 'vitest';
import { DERELICT, DERELICT_LAYOUTS, DERELICT_MODELS } from '../../data/sites';
import { flyingAt, ofType, run } from '../discovery/testing';
import { rotate } from '../math/vec2';
import { act } from '../station/testHarness';
import { dockPose, undockPose } from '../station/dock';
import { berthLatched, derelictDockTarget, nearestBerth } from './berth';
import { atClamp, berthedAt, findDerelict, powerRelays } from './derelictTesting';
import type { DerelictSite } from './types';

const SEED = 42;
const site = findDerelict(SEED, (d) => d.depth === 2);

describe('dock clearance', () => {
  it('a docked ship keeps clear of every derelict model (derelict_a: clamp circle 11.2 vs R 11)', () => {
    for (const model of DERELICT_MODELS) {
      const layout = DERELICT_LAYOUTS[model];
      for (const angle of [0, 1.1, -2.5]) {
        const d: DerelictSite = { ...site, model, angle, pos: { x: 500, y: -300 } };
        for (const bR of [1.5, 3, 5, 8]) {
          const pose = dockPose(derelictDockTarget(d), bR);
          for (const c of layout.circles) {
            const at = rotate(c, angle);
            const gap = Math.hypot(pose.pos.x - d.pos.x - at.x, pose.pos.y - d.pos.y - at.y) - c.r - bR;
            expect(gap, `${model} bR ${bR}`).toBeGreaterThanOrEqual(model === 'a' ? 0.79 : 0.99);
          }
        }
      }
    }
  });
});

describe('berth rules', () => {
  it('needs all three relays powered', () => {
    for (const lit of [0, 2]) {
      const sim = atClamp(SEED, site);
      powerRelays(sim, site, lit);
      const events = run(sim, 1, { dock: true });
      expect(ofType(events, 'berthRejected')).toEqual([expect.objectContaining({ id: site.id, reason: 'relaysUnpowered' })]);
      expect(ofType(events, 'dockRejected')).toEqual([]);
      expect(sim.state.sites.berth).toBeNull();
    }
  });

  it('uses the station manoeuvre rules: too far, too fast', () => {
    const cases: [string, (sim: ReturnType<typeof atClamp>) => void][] = [
      ['tooFar', (sim) => (sim.state.player.body = { ...sim.state.player.body, pos: { x: sim.state.player.body.pos.x + Math.cos(site.angle) * 8, y: sim.state.player.body.pos.y + Math.sin(site.angle) * 8 } })],
      ['tooFast', (sim) => (sim.state.player.body = { ...sim.state.player.body, vel: { x: 4, y: 0 } })],
    ];
    for (const [reason, apply] of cases) {
      const sim = atClamp(SEED, site);
      powerRelays(sim, site);
      apply(sim);
      sim.state.player.prevBody = sim.state.player.body;
      const events = run(sim, 1, { dock: true });
      expect([reason, ofType(events, 'berthRejected').map((e) => e.reason)]).toEqual([reason, [reason]]);
      expect(sim.state.sites.berth).toBeNull();
    }
  });

  it('the docking computer: 10 u off, 5 u/s, sideways still berths', () => {
    const sim = atClamp(SEED, site);
    powerRelays(sim, site);
    sim.state.discovery.archive.add('dockingComputer');
    const b = sim.state.player.body;
    sim.state.player.body = { ...b, pos: { x: b.pos.x + Math.cos(site.angle) * 10, y: b.pos.y + Math.sin(site.angle) * 10 }, vel: { x: 3, y: 4 }, angle: b.angle + Math.PI / 2 };
    sim.state.player.prevBody = sim.state.player.body;
    const events = run(sim, 1, { dock: true });
    expect(ofType(events, 'berthed')).toEqual([{ type: 'berthed', id: site.id }]);
  });

  it('is in play only near the clamp; far away F is the station dock as usual', () => {
    const sim = atClamp(SEED, site);
    expect(nearestBerth(sim.state)?.site.id).toBe(site.id);
    const far = flyingAt(SEED, { x: site.pos.x + 300, y: site.pos.y + 300 });
    expect(nearestBerth(far.state)).toBeNull();
    const events = run(far, 1, { dock: true });
    expect(ofType(events, 'berthRejected')).toEqual([]);
    expect(ofType(events, 'dockRejected')).toHaveLength(1);
  });
});

describe('berthed', () => {
  it('berths, gives the first-visit Data and log, latches in 1 s and is not a station dock', () => {
    const sim = atClamp(SEED, site);
    powerRelays(sim, site);
    // start 2 u off the docking point, slowly drifting
    const b = sim.state.player.body;
    sim.state.player.body = { ...b, pos: { x: b.pos.x + 1.2, y: b.pos.y - 1.6 }, vel: { x: 0.5, y: 0 }, angle: b.angle + 0.2 };
    const respawn = { ...sim.state.respawn };
    const data = sim.state.discovery.dataTotal;
    const events = run(sim, 1, { dock: true });
    const log = (e: (typeof events)[number]): boolean => e.type !== 'journalEntry' || e.id.startsWith('derelictLog_');
    expect(events.filter(log).map((e) => e.type).filter((t) => ['berthed', 'dataGained', 'journalEntry', 'derelictVisited'].includes(t))).toEqual([
      'berthed',
      'dataGained',
      'journalEntry',
      'derelictVisited',
    ]);
    expect(ofType(events, 'derelictVisited')).toEqual([{ type: 'derelictVisited', id: site.id, data: DERELICT.data, journal: `derelictLog_${site.model}` }]);
    expect(sim.state.discovery.dataTotal).toBe(data + DERELICT.data);
    expect(sim.state.sites.berth).toBe(site.id);
    expect(sim.state.player.body.vel).toEqual({ x: 0, y: 0 });
    expect(berthLatched(sim.state)).toBe(false);
    run(sim, 60);
    expect(berthLatched(sim.state)).toBe(true);
    expect(sim.state.player.body).toEqual(dockPose(derelictDockTarget(site), sim.state.player.props.boundingRadius));
    // never a station dock
    expect(sim.state.player.dock).toEqual({ mode: 'flying' });
    expect(sim.state.respawn).toEqual(respawn);
  });

  it('a berthed ship does not move under thrust, turning or currents', () => {
    const sim = berthedAt(SEED, site);
    const pose = sim.state.player.body;
    const events = run(sim, 240, { flight: { forward: 1, strafe: 1, turn: 1 } });
    expect(sim.state.player.body).toEqual(pose);
    expect(sim.state.sites.berth).toBe(site.id);
    expect(ofType(events, 'berthLeft')).toEqual([]);
  });

  it('a second berth gives nothing new; a known log gives only the Data', () => {
    const sim = berthedAt(SEED, site);
    const left = run(sim, 1, { dock: true });
    expect(ofType(left, 'berthLeft')).toEqual([{ type: 'berthLeft', id: site.id }]);
    expect(sim.state.sites.berth).toBeNull();
    expect(sim.state.player.body).toEqual(undockPose(derelictDockTarget(site), sim.state.player.props.boundingRadius));
    // F again at the clamp: the bow points away now – turn back and berth
    sim.state.player.body = dockPose(derelictDockTarget(site), sim.state.player.props.boundingRadius);
    const again = run(sim, 1, { dock: true });
    expect(ofType(again, 'berthed')).toHaveLength(1);
    expect(ofType(again, 'derelictVisited')).toEqual([]);
    expect(ofType(again, 'dataGained')).toEqual([]);

    const other = atClamp(SEED, site);
    powerRelays(other, site);
    other.state.discovery.journal.push({ id: `derelictLog_${site.model}`, tick: 0 });
    const events = run(other, 1, { dock: true });
    expect(ofType(events, 'derelictVisited')).toEqual([{ type: 'derelictVisited', id: site.id, data: DERELICT.data, journal: null }]);
    expect(ofType(events, 'journalEntry').filter((e) => e.id.startsWith('derelictLog_'))).toEqual([]);
  });

  it('berthLeave undocks; not berthed answers notBerthed', () => {
    const sim = berthedAt(SEED, site);
    const events = act(sim, { type: 'berthLeave' });
    expect(ofType(events, 'actionResult')).toEqual([expect.objectContaining({ ok: true })]);
    expect(ofType(events, 'berthLeft')).toEqual([{ type: 'berthLeft', id: site.id }]);
    expect(sim.state.sites.berth).toBeNull();
    const again = act(sim, { type: 'berthLeave' });
    expect(ofType(again, 'actionResult')).toEqual([expect.objectContaining({ ok: false, reason: 'notBerthed' })]);
  });

  it('the berth clears when the ship is destroyed', () => {
    const sim = berthedAt(SEED, site);
    sim.state.player.destroyed = true;
    run(sim, 1);
    expect(sim.state.sites.berth).toBeNull();
  });

  it('is deterministic', () => {
    const play = () => {
      const sim = atClamp(SEED, site);
      powerRelays(sim, site);
      const b = sim.state.player.body;
      sim.state.player.body = { ...b, pos: { x: b.pos.x + 0.7, y: b.pos.y + 0.4 }, angle: b.angle - 0.3 };
      const events = [...run(sim, 1, { dock: true }), ...run(sim, 30, { flight: { forward: 1, strafe: 0, turn: 0 } }), ...run(sim, 1, { dock: true }), ...run(sim, 60, { flight: { forward: 1, strafe: 0, turn: 0 } })];
      return { events, body: sim.state.player.body, sites: sim.state.sites };
    };
    expect(play()).toEqual(play());
  });
});
