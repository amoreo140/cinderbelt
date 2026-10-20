import { describe, expect, it } from 'vitest';
import { TRAINING_STEPS } from '../../data/training';
import type { Rotation, ShipGrid } from '../../sim/ship/types';
import { applyEditorOp } from '../../sim/shipyard/editor';
import { teleport, trainingSim, undock } from '../../sim/training/testing';
import type { Simulation } from '../../sim/Simulation';
import { HOME_STATION_ID } from '../../sim/world/stations';
import { dockPoint } from '../../sim/station/dock';
import { installNeeds, trainingCallouts, trainingGuide, trainingObjective, type TrainingContext } from './trainingView';
import { homeStation } from '../../sim/world/stations';

const ctx = (patch: Partial<TrainingContext> = {}): TrainingContext => ({ tab: 'overview', craftKey: null, yard: null, mapOpen: false, inCombat: false, ...patch });
const at = (sim: Simulation, id: (typeof TRAINING_STEPS)[number]['id']): void => {
  sim.state.career.training.step = TRAINING_STEPS.findIndex((s) => s.id === id);
};
const yard = (grid: ShipGrid, selected: string | null, rot: Rotation, dirty = false): TrainingContext['yard'] => ({ selected: selected as never, rot, grid, dirty });

describe('training guide – flight and dock', () => {
  it('docked at the start: undock is highlighted; in flight: W, S (the reverse engine), A/D and the dampers note', () => {
    const sim = trainingSim(1337);
    const docked = trainingGuide(sim.state, ctx())!;
    expect(docked).toMatchObject({ index: 0, total: 9, stepLabel: 'Krok 1/9', title: 'Doleť k bóji Cechu' });
    expect(docked.highlight).toEqual(['[data-testid="undock"]']);
    expect(docked.reward).toMatch(/50 kr/);
    undock(sim);
    const flying = trainingGuide(sim.state, ctx({ tab: null }))!;
    expect(flying.phases.map((p) => p.state)).toEqual(['done', 'current']);
    expect(flying.phases[1]!.keys).toEqual(['W', 'S', 'A', 'D']);
    expect(flying.hint).toMatch(/Tlmiče \(Z\) brzdia samy/);
    expect(flying.highlight).toEqual([]);
  });

  it('with the instructor on the radio the panel keeps the why text and the hints', () => {
    const sim = trainingSim(1337);
    const docked = trainingGuide(sim.state, ctx())!;
    expect(docked.why).toMatch(/cvičný trup/);
    undock(sim);
    const flying = trainingGuide(sim.state, ctx({ tab: null }))!;
    expect(flying.phases.map((p) => p.state)).toEqual(['done', 'current']);
    expect(flying.why).toBe(docked.why);
    expect(flying.hint).toMatch(/Tlmiče/);
    expect(flying.title).toBe('Doleť k bóji Cechu');
    expect(flying.reward).toMatch(/50 kr/);
    at(sim, 'brakeBuoy');
    teleport(sim, sim.state.career.training.sites!.buoyB);
    sim.state.player.body.vel = { x: 3, y: 0 };
    expect(trainingGuide(sim.state, ctx({ tab: null }))!.hint).toMatch(/zastav pod 1,5/);
  });

  it('stays in combat, dimmed', () => {
    const sim = trainingSim(1337);
    const g = trainingGuide(sim.state, ctx({ inCombat: true }))!;
    expect(g).not.toBeNull();
    expect(g.dimmed).toBe(true);
    expect(g.why.length).toBeGreaterThan(0);
    expect(trainingGuide(sim.state, ctx())!.dimmed).toBe(false);
  });

  it('copies the live target from the context', () => {
    const sim = trainingSim(1337);
    expect(trainingGuide(sim.state, ctx())!.target).toBeNull();
    expect(trainingGuide(sim.state, ctx({ target: { distance: 120, bearing: 0.5 } }))!.target).toEqual({ distance: 120, bearing: 0.5 });
  });

  it('every step has exactly one current phase unless all are done', () => {
    const sim = trainingSim(1337);
    for (const s of TRAINING_STEPS) {
      at(sim, s.id);
      for (const dock of [true, false]) {
        if (!dock && sim.state.player.dock.mode === 'docked') undock(sim);
        for (const tab of ['overview', 'shipyard', 'crafting', 'service'] as const) {
          const g = trainingGuide(sim.state, ctx({ tab: dock ? tab : null, yard: tab === 'shipyard' && dock ? yard(sim.state.player.grid, null, 0) : null }))!;
          const current = g.phases.filter((p) => p.state === 'current').length;
          const allDone = g.phases.every((p) => p.state === 'done');
          expect(allDone ? 0 : current, `${s.id} ${dock} ${tab}`).toBe(allDone ? 0 : 1);
        }
      }
    }
  });

  it('the dock step points at the overview tab, then at "sell the whole cargo"', () => {
    const sim = trainingSim(1337);
    at(sim, 'dockSell');
    expect(trainingGuide(sim.state, ctx({ tab: 'market' }))!.highlight).toEqual(['[data-testid="tab-overview"]']);
    expect(trainingGuide(sim.state, ctx({ tab: 'overview' }))!.highlight).toEqual(['[data-testid="sell-all"]']);
  });

  it('the dock step: docked on the overview → three phases done, selling is current; far in flight → all to do', () => {
    const sim = trainingSim(1337);
    at(sim, 'dockSell');
    expect(trainingGuide(sim.state, ctx({ tab: 'overview' }))!.phases.map((p) => p.state)).toEqual(['done', 'done', 'done', 'current']);
    expect(trainingGuide(sim.state, ctx({ tab: 'market' }))!.phases.map((p) => p.state)).toEqual(['done', 'done', 'current', 'todo']);
    undock(sim);
    teleport(sim, { x: homeStation().pos.x + 3000, y: homeStation().pos.y });
    const far = trainingGuide(sim.state, ctx({ tab: null }))!;
    expect(far.phases.map((p) => p.state)).toEqual(['current', 'todo', 'todo', 'todo']);
    expect(far.hint).toMatch(/Svorka loď prichytí/);
  });

  it('labels the buoy, the rock and the stopping buoy in the world; the objective has the same target', () => {
    const sim = trainingSim(1337);
    const sites = sim.state.career.training.sites!;
    expect(trainingCallouts(sim.state)).toEqual([]); // docked
    undock(sim);
    expect(trainingCallouts(sim.state)[0]).toMatchObject({ id: 'training:buoyA', world: sites.buoyA });
    expect(trainingObjective(sim.state)).toMatchObject({ id: 'training:flyBuoy', target: sites.buoyA });
    at(sim, 'mineIron');
    expect(trainingCallouts(sim.state)[0]).toMatchObject({ id: 'training:rock', world: sites.rockPos });
    at(sim, 'brakeBuoy');
    teleport(sim, { x: sites.buoyB.x + 30, y: sites.buoyB.y });
    expect(trainingCallouts(sim.state)[0]?.detail).toMatch(/j\/s/);
    expect(trainingGuide(sim.state, ctx({ tab: null }))!.hint).toMatch(/zastav pod 1,5/);
  });

  it('flying to a dock step teaches the dock clamp manoeuvre and labels the clamp in the world', () => {
    const sim = trainingSim(1337);
    at(sim, 'dockSell');
    undock(sim);
    const g = trainingGuide(sim.state, ctx({ tab: null }))!;
    expect(g.phases.map((p) => p.text).join(' ')).toMatch(/dokovacej svorke na konci ramena.*prídou ku stanici/);
    expect(g.phases[1]!.keys).toEqual(['F']);
    // the label sits where the clamp marker rings the docking point (the docked ship's centre)
    const clamp = dockPoint(homeStation(), sim.state.player.props.boundingRadius);
    expect(Math.hypot(clamp.x - homeStation().pos.x, clamp.y - homeStation().pos.y)).toBeGreaterThan(14);
    expect(trainingCallouts(sim.state)[0]).toMatchObject({ id: 'training:dock', world: clamp, keys: 'F' });
  });

  it('the checklist ticks off what is done and points at the service tab first', () => {
    const sim = trainingSim(1337);
    at(sim, 'checklist');
    sim.state.player.fuel = 50;
    const g = trainingGuide(sim.state, ctx({ tab: 'overview' }))!;
    expect(g.phases.map((p) => p.state)).toEqual(['current', 'todo', 'todo']);
    expect(g.highlight).toEqual(['[data-testid="tab-service"]']);
    expect(trainingGuide(sim.state, ctx({ tab: 'service' }))!.highlight).toEqual(['[data-testid="refuel-full"]']);
    sim.state.career.training.flags = 1 | 4;
    const after = trainingGuide(sim.state, ctx({ tab: 'service' }))!;
    expect(after.phases.map((p) => p.state)).toEqual(['done', 'current', 'done']);
    expect(after.hint).toMatch(/Mapa sa otvára v lete/);
  });
});

describe('training guide – the shipyard, step by step', () => {
  it('open the shipyard → pick the engine → rotate (R) → place on a suggested cell → confirm', () => {
    const sim = trainingSim(1337);
    at(sim, 'installSide');
    const grid = sim.state.player.grid;
    expect(trainingGuide(sim.state, ctx({ tab: 'overview' }))!.highlight).toEqual(['[data-testid="tab-shipyard"]']);
    expect(trainingGuide(sim.state, ctx({ tab: 'shipyard', yard: yard(grid, null, 0) }))!.highlight).toEqual(['[data-testid="palette-engine"]']);
    const rotate = trainingGuide(sim.state, ctx({ tab: 'shipyard', yard: yard(grid, 'engine:1', 0) }))!;
    expect(rotate.phases.find((p) => p.state === 'current')!.keys).toEqual(['R']);
    expect(rotate.highlight).toEqual(['[data-testid="yard-ghost"]']);
    // rot 1 pushes left: the suggested cells are valid and give left thrust, on the right side (exhaust outwards)
    const place = trainingGuide(sim.state, ctx({ tab: 'shipyard', yard: yard(grid, 'engine:1', 1) }))!;
    expect(place.cells.length).toBeGreaterThan(0);
    for (const c of place.cells) {
      const r = applyEditorOp(grid, { op: 'place', key: 'engine:1', x: c.x, y: c.y, rot: 1 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(installNeeds('installSide', r.grid).map((n) => n.rots)).toEqual([[3]]);
    }
    expect(place.cells.every((c) => c.y < 0)).toBe(true);
    // both placed in the draft → confirm
    const one = applyEditorOp(grid, { op: 'place', key: 'engine:1', x: 0, y: -1, rot: 1 });
    const two = one.ok ? applyEditorOp(one.grid, { op: 'place', key: 'engine:1', x: 0, y: 1, rot: 3 }) : one;
    if (!two.ok) throw new Error('placement failed');
    const confirm = trainingGuide(sim.state, ctx({ tab: 'shipyard', yard: yard(two.grid, 'engine:1', 3, true) }))!;
    expect(confirm.phases.find((p) => p.state === 'current')!.keys).toEqual(['Enter']);
    expect(confirm.phases.map((p) => p.state)).toEqual(['done', 'done', 'done', 'done', 'current']);
    expect(confirm.highlight).toEqual(['[data-testid="yard-commit"]']);
  });

  it("the reverse step asks for the second reverse engine only (the hull has the first) and suggests free cells", () => {
    const sim = trainingSim(1337);
    at(sim, 'installReverse');
    const grid = sim.state.player.grid;
    expect(installNeeds('installReverse', grid)).toHaveLength(1);
    const place = trainingGuide(sim.state, ctx({ tab: 'shipyard', yard: yard(grid, 'engine:1', 2) }))!;
    expect(place.cells.length).toBeGreaterThan(0);
    for (const c of place.cells) {
      const r = applyEditorOp(grid, { op: 'place', key: 'engine:1', x: c.x, y: c.y, rot: 2 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(installNeeds('installReverse', r.grid)).toEqual([]);
    }
  });

  it('the cargo step crafts first (crafting tab → recipe → craft), then installs', () => {
    const sim = trainingSim(1337);
    at(sim, 'craftCargo');
    expect(trainingGuide(sim.state, ctx({ tab: 'overview' }))!.highlight).toEqual(['[data-testid="tab-crafting"]']);
    expect(trainingGuide(sim.state, ctx({ tab: 'crafting' }))!.highlight).toEqual(['[data-testid="recipe-cargo:1"]']);
    expect(trainingGuide(sim.state, ctx({ tab: 'crafting', craftKey: 'cargo:1' }))!.highlight).toEqual(['[data-testid="craft"]']);
    sim.state.stations.get(HOME_STATION_ID)!.parts['cargo:1'] = 1;
    expect(trainingGuide(sim.state, ctx({ tab: 'crafting', craftKey: 'cargo:1' }))!.highlight).toEqual(['[data-testid="tab-shipyard"]']);
  });

  it('the crafted cargo hold keeps the craft phases done after undocking', () => {
    const sim = trainingSim(1337);
    at(sim, 'craftCargo');
    sim.state.stations.get(HOME_STATION_ID)!.parts['cargo:1'] = 1;
    undock(sim);
    const g = trainingGuide(sim.state, ctx({ tab: null }))!;
    expect(g.phases.map((p) => p.state)).toEqual(['current', 'done', 'done', 'done', 'todo', 'todo', 'todo']);
  });

  it('the last step lists what is missing and picks it one by one', () => {
    const sim = trainingSim(1337);
    at(sim, 'finishShip');
    const g = trainingGuide(sim.state, ctx({ tab: 'shipyard', yard: yard(sim.state.player.grid, null, 0) }))!;
    expect(g.phases.map((p) => p.text)).toEqual(expect.arrayContaining(['Reaktor', 'Radar', 'Gyroskop', 'Druhý motor dopredu']));
    expect(g.phases.length).toBeLessThanOrEqual(7);
    expect(g.highlight).toEqual(['[data-testid="palette-reactor"]']);
  });

  it('tells where the reward parts wait when the ship is elsewhere', () => {
    const sim = trainingSim(1337);
    at(sim, 'installSide');
    undock(sim);
    expect(trainingGuide(sim.state, ctx({ tab: null }))!.hint).toMatch(/čakajú v sklade stanice/);
  });
});
