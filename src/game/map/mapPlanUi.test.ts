// M4d T9: the map planner in the game layer – the route as session state (set, cleared, never in the
// sim), the planned route's data and flight mark, the notes as memoised views and commands, the notes in
// flight gated by the Archive node and the setting, and the stale marks fed from what the radar shows.
import { describe, expect, it } from 'vitest';
import { NOTES } from '../../data/navigation';
import type { GameActionInput } from '../../sim/commands';
import { createEnemy } from '../../sim/combat/enemies';
import { flyingAt } from '../../sim/discovery/testing';
import type { Simulation } from '../../sim/Simulation';
import { MapPlanUi } from './mapPlanUi';

function setup(): { sim: Simulation; plan: MapPlanUi; sent: GameActionInput[]; renders: number[] } {
  const sim = flyingAt(1, { x: 0, y: 0 });
  const sent: GameActionInput[] = [];
  const renders: number[] = [];
  const plan = new MapPlanUi({ state: () => sim.state, send: (a) => sent.push(a), render: () => renders.push(1) });
  return { sim, plan, sent, renders };
}

describe('the route', () => {
  it('is set and cleared by the handlers (game state, redraws the UI) and cleared with the session', () => {
    const { sim, plan, renders } = setup();
    expect(plan.mapData(sim.state, null).route).toBeNull();
    plan.handlers.route({ x: 3000, y: 4000 }, 'Kotva');
    expect(renders).toHaveLength(1);
    const r = plan.mapData(sim.state, null).route!;
    expect(r).toMatchObject({ to: { x: 3000, y: 4000 }, label: 'Kotva' });
    expect(r.distance).toBeCloseTo(5000, 6);
    expect(r.seconds).toBeGreaterThan(0);
    expect(plan.routeMark(sim.state)).toMatchObject({ pos: { x: 3000, y: 4000 }, distance: r.distance });
    plan.handlers.clearRoute();
    expect(plan.route).toBeNull();
    plan.handlers.route({ x: 1, y: 1 }, 'x');
    plan.clear();
    expect(plan.routeMark(sim.state)).toBeNull();
  });
});

describe('the route data', () => {
  it('is the same object while nothing it shows changes; a move past the step, fuel or a new target recompute it', () => {
    const { sim, plan } = setup();
    plan.handlers.route({ x: 3000, y: 4000 }, 'Kotva');
    const a = plan.mapData(sim.state, null).route!;
    expect(plan.mapData(sim.state, null).route).toBe(a);
    const p = sim.state.player;
    p.body = { ...p.body, pos: { x: 1, y: -1 } };
    expect(plan.mapData(sim.state, null).route).toBe(a);
    p.body = { ...p.body, pos: { x: 40, y: 0 } };
    const b = plan.mapData(sim.state, null).route!;
    expect(b).not.toBe(a);
    expect(b.distance).toBeCloseTo(Math.hypot(3000 - 40, 4000), 6);
    p.fuel -= 10;
    const c = plan.mapData(sim.state, null).route!;
    expect(c).not.toBe(b);
    expect(c.rangeOneWay).toBeLessThan(b.rangeOneWay);
    plan.handlers.route({ x: 3000, y: 4000 }, 'Iná');
    expect(plan.mapData(sim.state, null).route!.label).toBe('Iná');
  });
});

describe('notes', () => {
  it('commands for new, edited and deleted notes', () => {
    const { plan, sent } = setup();
    plan.handlers.noteSet({ pos: { x: 1, y: 2 }, icon: 'ore', text: 'Ti' });
    plan.handlers.noteSet({ id: 4, pos: { x: 1, y: 2 }, icon: 'star', text: 'Echo' });
    plan.handlers.noteDelete(4);
    expect(sent).toEqual([
      { type: 'mapNoteSet', pos: { x: 1, y: 2 }, icon: 'ore', text: 'Ti' },
      { type: 'mapNoteSet', id: 4, pos: { x: 1, y: 2 }, icon: 'star', text: 'Echo' },
      { type: 'mapNoteDelete', id: 4 },
    ]);
  });

  it('views are memoised; locked without the Archive node; flight marks need the node and the setting', () => {
    const { sim, plan } = setup();
    const nav = sim.state.navigation;
    nav.notes.push({ id: 1, pos: { x: 100, y: 0 }, icon: 'ore', text: 'near' }, { id: 2, pos: { x: NOTES.flightRange + 500, y: 0 }, icon: 'flag', text: 'far' });
    nav.nextNote = 3;
    const a = plan.mapData(sim.state, null);
    expect(a.notes.map((n) => n.id)).toEqual([1, 2]);
    expect(plan.mapData(sim.state, null).notes).toBe(a.notes);
    expect(a.notesLocked).toBe(true);
    expect(plan.noteMarks(sim.state, true)).toEqual([]);
    sim.state.discovery.archive.add('mapNotes');
    expect(plan.mapData(sim.state, null).notesLocked).toBe(false);
    expect(plan.noteMarks(sim.state, true).map((n) => n.text)).toEqual(['near']);
    expect(plan.noteMarks(sim.state, false)).toEqual([]);
    nav.notes[0]!.text = 'edited';
    expect(plan.mapData(sim.state, null).notes).not.toBe(a.notes);
  });
});

describe('stale marks', () => {
  it('a pirate group seen and then out of sight leaves a fading mark; seen again it is live', () => {
    const { sim, plan } = setup();
    const e = createEnemy({ id: 'pr:9,9:0', kind: 'sentry', tier: 1, pos: { x: 150, y: 0 }, angle: 0, home: { x: 150, y: 0 }, orbit: 1 });
    sim.state.combat.enemies.push(e);
    plan.observe(sim.state, 300);
    expect(plan.mapData(sim.state, null).stale).toEqual([]);
    sim.state.combat.enemies = [];
    sim.state.tick += 60 * 120;
    plan.observe(sim.state, 300);
    const marks = plan.mapData(sim.state, null).stale;
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ kind: 'pirates', pos: { x: 150, y: 0 } });
    expect(marks[0]!.alpha).toBeLessThan(1);
    sim.state.combat.enemies.push(e);
    sim.state.tick += 1;
    plan.observe(sim.state, 300);
    expect(plan.mapData(sim.state, null).stale).toEqual([]);
  });
});
