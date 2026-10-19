// M4b T0 contracts: the skeleton is wired but inert – a new game has empty sites and director state,
// the new actions answer "unavailable", the ion storm consumers see exactly the legacy storms, and the
// data / type changes keep their promises (derived local condition, Archive features, dock targets).
import { describe, expect, it } from 'vitest';
import { ARCHIVE_NODES } from '../../data/archive';
import { DERELICT_LAYOUTS, RELAY } from '../../data/sites';
import { ACTIVE_SECTOR_MODIFIERS, SECTOR_MODIFIERS } from '../../data/sector';
import { IDLE_COMMAND } from '../commands';
import { ionStormAt } from '../discovery/events';
import { createDirector, DIRECTOR_NEVER } from '../events/state';
import { activeEvents } from '../events/director';
import { stormAt } from '../events/storms';
import { securityHere } from '../pirates/sectors';
import { sectorIdAt, sectorSecurity } from '../regions';
import { loadSave } from '../save/load';
import { restoreSimulation, toEnvelope, toSave } from '../save/serialize';
import { testContext } from '../save/testing';
import { Simulation } from '../Simulation';
import { act, dockedSim } from '../station/testHarness';
import { checkDock, dockPose } from '../station/dock';
import { createSites, derelictDockTarget, siteColliders, siteHitTargets, sitesInChunk, type DerelictSite } from './index';

const derelict = (): DerelictSite => ({
  kind: 'derelict',
  id: 'dl:10,0',
  cx: 10,
  cy: 0,
  pos: { x: 2100, y: 100 },
  angle: Math.PI / 2,
  model: 'b',
  depth: 2,
  relays: [],
  defence: 'none',
  service: 'stash',
});

describe('M4b T0 skeleton', () => {
  it('a new game starts with empty sites and a quiet director', () => {
    const sim = new Simulation({ seed: 7, startDocked: false });
    expect(sim.state.sites).toEqual(createSites());
    expect(sim.state.director).toEqual(createDirector());
    expect(sim.state.director.last).toBe(DIRECTOR_NEVER);
  });

  it('a save without M4b state (before V17) restores fresh state', () => {
    const sim = new Simulation({ seed: 7, startDocked: false });
    for (let i = 0; i < 10; i++) sim.step(IDLE_COMMAND);
    const result = loadSave(toEnvelope(toSave(sim, testContext())));
    if (!result.ok) throw new Error('load failed');
    const restored = restoreSimulation(result.save);
    expect(restored.state.sites).toEqual(createSites());
    expect(restored.state.director).toEqual(createDirector());
  });

  it('the skeleton lists no sites, events, colliders or hit targets', () => {
    const sim = new Simulation({ seed: 7, startDocked: false });
    for (let i = 0; i < 30; i++) sim.step(IDLE_COMMAND);
    expect(sitesInChunk(7, 10, 0)).toEqual([]);
    // the director lists legacy events (distress signals, ion storms – M4b T1); nothing rolled in epoch 0
    expect(activeEvents(sim.state).filter((e) => e.kind === 'micrometeors' || e.kind === 'ambush')).toEqual([]);
    expect(siteColliders(sim.state, { x: 0, y: 0 }, 100)).toEqual([]);
    expect(siteHitTargets(sim.state)).toEqual([]);
  });

  it('the new actions answer "unavailable" (the site actions, T4: "not berthed") at a station', () => {
    const sim = dockedSim();
    for (const a of [{ type: 'derelictTake', site: 'dl:1,1', item: 0 }, { type: 'berthLeave' }] as const) {
      const results = act(sim, a).filter((e) => e.type === 'actionResult');
      expect(results).toEqual([expect.objectContaining({ ok: false, reason: 'notBerthed' })]);
    }
    const results = act(sim, { type: 'debugEvent', kind: 'ambush' }).filter((e) => e.type === 'actionResult');
    expect(results).toEqual([expect.objectContaining({ ok: false, reason: 'serviceUnavailable' })]);
  });

  it('stormAt equals the legacy ion storm without derelict storms', () => {
    const sim = new Simulation({ seed: 3, startDocked: false });
    for (const pos of [{ x: 2500, y: 0 }, { x: -4000, y: 3000 }, { x: 6000, y: -6000 }]) {
      for (let tick = 0; tick < 400_000; tick += 3_301) expect(stormAt(sim.state, pos, tick)).toBe(ionStormAt(3, pos, tick));
    }
  });

  it('securityHere is the current security of the sector at the point', () => {
    const sim = new Simulation({ seed: 42, startDocked: false });
    for (const pos of [{ x: 0, y: 0 }, { x: 2600, y: 900 }, { x: -5000, y: 4200 }]) {
      expect(securityHere(sim.state, pos)).toBe(sectorSecurity(42, sectorIdAt(42, pos.x, pos.y)));
    }
  });
});

describe('M4b T0 data', () => {
  it('cometFlyby is derived and never rolled; convoy is derived too since M4d', () => {
    expect(SECTOR_MODIFIERS.cometFlyby.derived).toBe(true);
    expect(ACTIVE_SECTOR_MODIFIERS).not.toContain('cometFlyby');
    expect(SECTOR_MODIFIERS.convoy.derived).toBe(true);
    expect(ACTIVE_SECTOR_MODIFIERS).not.toContain('convoy');
  });

  it('tractorPlus and veinAnalyzer are Archive features', () => {
    for (const id of ['tractorPlus', 'veinAnalyzer'] as const) {
      const node = ARCHIVE_NODES.find((n) => n.id === id)!;
      expect(node.unlock).toEqual({ kind: 'feature', feature: id });
      expect(node.since).toBeUndefined();
    }
  });

  it('a derelict is a dock target: its clamp sits at (R, 0) rotated by its angle', () => {
    const site = derelict();
    const target = derelictDockTarget(site);
    expect(target.radius).toBe(DERELICT_LAYOUTS.b.radius);
    const r = 3;
    const pose = dockPose(target, r);
    expect(pose.pos.x).toBeCloseTo(site.pos.x);
    expect(pose.pos.y).toBeCloseTo(site.pos.y + DERELICT_LAYOUTS.b.radius + r + 1);
    const check = checkDock({ ...pose, vel: { x: 0, y: 0 } }, r, [target]);
    expect(check.status).toBe('ok');
    expect(check.station?.id).toBe(site.id);
  });

  it('relays: three per derelict, 120° apart', () => {
    expect(RELAY.count).toBe(3);
    expect(RELAY.spacingDeg * RELAY.count).toBe(360);
  });
});
