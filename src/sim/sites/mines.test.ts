// M4b T5: live graveyard mines – arming, the fuse, the blast and its fall-off, shooting them from range.
import { describe, expect, it } from 'vitest';
import { GRAVEYARD, MINE } from '../../data/sites';
import { createEnemy } from '../combat/enemies';
import { hullHp } from '../ship/hp';
import { flyingAt, ofType, run, teleport } from '../discovery/testing';
import { add } from '../math/vec2';
import type { SimEvent, SimState, Simulation } from '../Simulation';
import { graveyardState } from './graveyard';
import { mineId } from './graveyardKeys';
import { liveMines, MINE_FUSE_TICKS, mineBlastDamage, mineHitTargets } from './mines';
import { sitesInChunk } from './placement';
import type { GraveyardSite } from './types';

function firstGraveyard(seed: number): GraveyardSite {
  const out: GraveyardSite[] = [];
  for (let cx = -30; cx <= 30; cx++) for (let cy = -30; cy <= 30; cy++) for (const s of sitesInChunk(seed, cx, cy)) if (s.kind === 'graveyard' && s.mines.length > 0) out.push(s);
  return out.sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y))[0]!;
}

const SEED = 42;
const G = firstGraveyard(SEED);
const M = G.mines[0]!;
const ID = mineId(G.id, 0);

/** Steps with only the ships the test put there (regular pirates and sleepers kept out). */
function runAlone(sim: Simulation, n: number, keep: (id: string) => boolean = () => false): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    out.push(...run(sim, 1));
    sim.state.combat.enemies = sim.state.combat.enemies.filter((e) => keep(e.id));
  }
  return out;
}

/** The player parked with its hull `gap` u from mine 0 (east of it). */
function parkedAt(gap: number): Simulation {
  const game = flyingAt(SEED, add(G.pos, { x: 0, y: GRAVEYARD.radius + 100 }));
  const r = game.state.player.props.boundingRadius;
  teleport(game, add(M, { x: gap + r, y: 0 }));
  return game;
}

const hull = (state: SimState): number => hullHp(state.player.grid, state.player.hp).current;

describe('live mines', () => {
  it('arm when a hull comes within 12 u, not farther', () => {
    expect(ofType(runAlone(parkedAt(MINE.armRange + 1), 5), 'mineArmed')).toHaveLength(0);
    const armed = ofType(runAlone(parkedAt(MINE.armRange - 1), 5), 'mineArmed');
    expect(armed).toEqual([{ type: 'mineArmed', id: ID, pos: M }]);
  });

  it('blow after the 1.5 s fuse; the blast falls off with the distance', () => {
    const game = parkedAt(4);
    const before = hull(game.state);
    const events = runAlone(game, MINE_FUSE_TICKS + 2);
    const armedAt = events.findIndex((e) => e.type === 'mineArmed');
    const blew = events.findIndex((e) => e.type === 'mineExploded');
    expect(armedAt).toBeGreaterThanOrEqual(0);
    expect(blew).toBeGreaterThan(armedAt);
    expect(ofType(events, 'mineExploded')).toEqual([{ type: 'mineExploded', id: ID, pos: M }]);
    expect(before - hull(game.state)).toBe(mineBlastDamage(4));
    expect(mineBlastDamage(0)).toBe(MINE.damage);
    expect(mineBlastDamage(MINE.blastRadius / 2)).toBe(MINE.damage / 2);
    expect(mineBlastDamage(MINE.blastRadius)).toBe(0);
    // gone for good: no target, not listed, the bit is saved
    expect(graveyardState(game.state, G.id).mines & 1).toBe(1);
    expect(mineHitTargets(game.state).some((t) => t.id === ID)).toBe(false);
    expect(liveMines(game.state, G.pos).some((m) => m.id === ID)).toBe(false);
  });

  it('spare a ship that got out of the blast before the fuse ran out', () => {
    const game = parkedAt(MINE.armRange - 1);
    runAlone(game, 2);
    const before = hull(game.state);
    teleport(game, add(M, { x: MINE.blastRadius + game.state.player.props.boundingRadius + 5, y: 0 }));
    const events = runAlone(game, MINE_FUSE_TICKS);
    expect(ofType(events, 'mineExploded')).toHaveLength(1);
    expect(hull(game.state)).toBe(before);
  });

  it('show the fuse to the render while armed', () => {
    const game = parkedAt(MINE.armRange - 1);
    runAlone(game, 1 + MINE_FUSE_TICKS / 2);
    const m = liveMines(game.state, G.pos).find((x) => x.id === ID)!;
    expect(m.fuse).toBeGreaterThan(0.3);
    expect(m.fuse).toBeLessThan(0.7);
    expect(liveMines(game.state, G.pos).filter((x) => x.id !== ID).every((x) => x.fuse === null)).toBe(true);
  });

  it('blow at once when a projectile hits them – safe from range', () => {
    const game = flyingAt(SEED, add(M, { x: 60, y: 0 }));
    const state = game.state;
    const before = hull(state);
    state.combat.projectiles.push({ id: 9_999, owner: 'player', pos: add(M, { x: 3, y: 0 }), vel: { x: -80, y: 0 }, ttl: 60, damage: 8, tier: 1, origin: add(M, { x: 60, y: 0 }) });
    const events = runAlone(game, 2);
    expect(ofType(events, 'mineArmed')).toHaveLength(0);
    expect(ofType(events, 'mineExploded').map((e) => e.id)).toEqual([ID]);
    expect(state.combat.projectiles.some((p) => p.id === 9_999)).toBe(false);
    expect(hull(state)).toBe(before);
  });

  it('can be set off by a pirate, which takes the blast', () => {
    const game = flyingAt(SEED, add(M, { x: 150, y: 0 }));
    const state = game.state;
    const e = createEnemy({ id: 'pr:mine:0', kind: 'jackal', tier: 1, pos: { x: 0, y: 0 }, angle: 0, home: M, orbit: 1 });
    e.body = { ...e.body, pos: add(M, { x: e.props.boundingRadius + 2, y: 0 }) };
    e.prevBody = e.body;
    state.combat.enemies = [e];
    const events = runAlone(game, MINE_FUSE_TICKS + 2, (id) => id === 'pr:mine:0');
    expect(ofType(events, 'mineArmed').map((x) => x.id)).toContain(ID);
    expect(ofType(events, 'mineExploded').map((x) => x.id)).toContain(ID);
    const hit = state.combat.enemies.find((x) => x.id === 'pr:mine:0');
    // damaged, or blown to pieces
    expect(!hit || hit.hp.size > 0 || hit.gridVersion > 0).toBe(true);
  });

  it('stay gone across a reload of the sites state and a trip away', () => {
    const game = parkedAt(4);
    runAlone(game, MINE_FUSE_TICKS + 2);
    const state = game.state;
    // a load builds a fresh sites object (the fuse map is beside it, the gone bits are in it)
    state.sites = { ...state.sites, graveyards: new Map([...state.sites.graveyards].map(([k, v]) => [k, { ...v }])) };
    teleport(game, add(G.pos, { x: 3000, y: 0 }));
    runAlone(game, 31);
    teleport(game, add(M, { x: 2 + state.player.props.boundingRadius, y: 0 }));
    const events = runAlone(game, MINE_FUSE_TICKS + 2);
    expect(ofType(events, 'mineArmed').some((x) => x.id === ID)).toBe(false);
    expect(ofType(events, 'mineExploded').some((x) => x.id === ID)).toBe(false);
  });

  it('is deterministic', () => {
    const play = (): string => {
      const game = parkedAt(MINE.armRange - 3);
      const out: string[] = [];
      for (let i = 0; i < 200; i++) out.push(...run(game, 1, { flight: { forward: 0, strafe: i < 60 ? 0.3 : 0, turn: 0 } }).map((e) => `${e.type}@${game.state.tick}`));
      return out.join(',') + JSON.stringify([...game.state.player.hp]) + JSON.stringify([...game.state.sites.graveyards]);
    };
    expect(play()).toBe(play());
  });
});
