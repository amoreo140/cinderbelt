// M4b T3: derelict and relay structures are hard obstacles for ships and beams and stop projectiles.
import { describe, expect, it } from 'vitest';
import { DERELICT_LAYOUTS, RELAY_LAYOUT } from '../../data/sites';
import { flyingAt, ofType, run } from '../discovery/testing';
import { add, rotate } from '../math/vec2';
import { createGrid } from '../ship/grid';
import { Simulation } from '../Simulation';
import { derelictCircles, onStructureHit, STRUCTURE_HIT_RANGE, structureColliders, structureHitTargets } from './colliders';
import { siteColliders, siteHitTargets } from './index';
import { sitesInChunk } from './placement';
import type { DerelictSite } from './types';

function firstDerelict(seed: number): DerelictSite {
  for (let r = 5; r < 40; r++) {
    for (let cx = -r; cx <= r; cx++) {
      for (let cy = -r; cy <= r; cy++) {
        if (Math.max(Math.abs(cx), Math.abs(cy)) !== r) continue;
        const d = sitesInChunk(seed, cx, cy).find((s): s is DerelictSite => s.kind === 'derelict');
        if (d) return d;
      }
    }
  }
  throw new Error('no derelict');
}

const SEED = 42;
const d = firstDerelict(SEED);

describe('structure circles', () => {
  it('are the layout circles rotated by the site angle, plus every relay mast', () => {
    const circles = derelictCircles(d);
    const layout = DERELICT_LAYOUTS[d.model];
    expect(circles).toHaveLength(layout.circles.length + d.relays.length * RELAY_LAYOUT.circles.length);
    const first = layout.circles[0]!;
    const want = add(d.pos, rotate(first, d.angle));
    expect(circles[0]!.id).toBe(d.id);
    expect(circles[0]!.circle.pos.x).toBeCloseTo(want.x, 9);
    expect(circles[0]!.circle.pos.y).toBeCloseTo(want.y, 9);
    expect(circles.filter((c) => c.id === d.relays[1]!.id)).toHaveLength(RELAY_LAYOUT.circles.length);
    // cached per site object
    expect(derelictCircles(d)).toBe(circles);
  });

  it('are listed near a derelict and nowhere else', () => {
    const state = new Simulation({ seed: SEED, startDocked: false }).state;
    const near = structureColliders(state, d.pos, 5);
    expect(near.length).toBe(DERELICT_LAYOUTS[d.model].circles.filter((c) => Math.hypot(c.x, c.y) <= 5 + c.r).length);
    expect(near.every((c) => !c.safe)).toBe(true);
    const relay = d.relays[0]!;
    expect(structureColliders(state, relay.pos, 2).map((c) => c.radius)).toEqual(RELAY_LAYOUT.circles.map((c) => c.r));
    expect(structureColliders(state, { x: 0, y: 0 }, 200)).toEqual([]);
    expect(siteColliders(state, relay.pos, 2).length).toBeGreaterThan(0);
  });
});

describe('structures in the game', () => {
  it('stop a ship flying into the derelict', () => {
    const dir = { x: Math.cos(d.angle + Math.PI), y: Math.sin(d.angle + Math.PI) };
    // start 40 u out on the far side from the dock port, nose towards the station
    const game = flyingAt(SEED, add(d.pos, { x: -dir.x * -40, y: -dir.y * -40 }));
    game.state.player.body = { ...game.state.player.body, angle: Math.atan2(-dir.y, -dir.x) };
    game.state.player.prevBody = game.state.player.body;
    let closest = Infinity;
    for (let i = 0; i < 600; i++) {
      run(game, 1, { flight: { forward: 1, strafe: 0, turn: 0 } });
      closest = Math.min(closest, Math.hypot(game.state.player.body.pos.x - d.pos.x, game.state.player.body.pos.y - d.pos.y));
    }
    const core = Math.max(...DERELICT_LAYOUTS[d.model].circles.filter((c) => Math.hypot(c.x, c.y) < 1).map((c) => c.r), 0);
    expect(closest).toBeGreaterThan(core);
  });

  it('stop a mining beam (the derelict is a blocker)', () => {
    const relay = d.relays[1]!;
    const out = { x: relay.pos.x - d.pos.x, y: relay.pos.y - d.pos.y };
    const len = Math.hypot(out.x, out.y);
    // 12 u from the relay (within the laser's range), beam aimed at the mast
    const at = { x: relay.pos.x + (out.x / len) * 12, y: relay.pos.y + (out.y / len) * 12 };
    const game = flyingAt(SEED, at);
    game.state.player.body = { ...game.state.player.body, angle: Math.atan2(-out.y, -out.x) };
    game.state.player.prevBody = game.state.player.body;
    run(game, 5, { mining: true, aim: relay.pos });
    const beams = game.state.player.beams;
    expect(beams.length).toBeGreaterThan(0);
    for (const b of beams) expect(Math.hypot(b.to.x - relay.pos.x, b.to.y - relay.pos.y)).toBeLessThan(RELAY_LAYOUT.circles[0]!.r + 0.5);
  });

  it('take projectiles near the player as spent shots', () => {
    const game = flyingAt(SEED, add(d.pos, { x: 60, y: 0 }));
    const targets = structureHitTargets(game.state);
    expect(new Set(targets.map((t) => t.id))).toEqual(new Set([d.id, ...d.relays.map((r) => r.id)]));
    expect(targets.every((t) => t.kind === 'structure')).toBe(true);
    expect(siteHitTargets(game.state).length).toBeGreaterThanOrEqual(targets.length);
    const events: Parameters<typeof onStructureHit>[3] = [];
    onStructureHit(game.state, targets[0]!, { owner: 'player', pos: { x: 1, y: 2 }, damage: 5, from: { x: 0, y: 0 } }, events);
    expect(events).toEqual([{ type: 'projectileHit', target: 'station', owner: 'player', ref: null, pos: { x: 1, y: 2 }, damage: 5, from: { x: 0, y: 0 }, site: d.id }]);
    const far = flyingAt(SEED, add(d.pos, { x: STRUCTURE_HIT_RANGE + 200, y: 0 }));
    expect(structureHitTargets(far.state)).toEqual([]);
  });

  it('a cannon shot at the derelict stops at it', () => {
    const fighter = createGrid([
      ['cockpit', 0, 0],
      ['cannon', 1, 1, 0],
      ['cannon', 1, -1, 0],
      ['armor', 1, 0, 0],
      ['reactor', -1, 0],
      ['engine', -2, 0, 0],
    ]);
    const game = flyingAt(SEED, add(d.pos, { x: Math.cos(d.angle) * 40, y: Math.sin(d.angle) * 40 }), fighter);
    game.state.player.body = { ...game.state.player.body, angle: d.angle + Math.PI };
    game.state.player.prevBody = game.state.player.body;
    const events = run(game, 90, { fire: true, aim: d.pos });
    const hits = ofType(events, 'projectileHit').filter((e) => e.site !== undefined);
    expect(ofType(events, 'shotFired').length).toBeGreaterThan(0);
    expect(hits.some((h) => h.site === d.id)).toBe(true);
  });
});
