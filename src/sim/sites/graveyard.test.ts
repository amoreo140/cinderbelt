// M4b T5: ship graveyards – the wreck field, its dismantling state, Data and fragments, the sleeping party.
import { describe, expect, it } from 'vitest';
import { WRECK_CONTAINERS } from '../../data/salvage';
import { GRAVEYARD, MINE } from '../../data/sites';
import { createEnemy } from '../combat/enemies';
import { lootEmpty } from '../combat/wrecks';
import type { Enemy } from '../combat/types';
import { flyingAt, holdScan, ofType, run, teleport } from '../discovery/testing';
import { onWreckSalvaged, resolveContents, seedWreck } from '../discovery/wrecks';
import { add, type Vec2 } from '../math/vec2';
import { cutJoint, jointParts } from '../salvage/dismantle';
import { SIM_DT, type SimEvent, type SimState, type Simulation } from '../Simulation';
import { AI_BUDGET, buildGraveyardLayout, graveyardLayout, graveyardState, graveyardWreckData, sleeperDisguised, stepGraveyards, wakeGraveyardsNear } from './graveyard';
import { sitesInChunk } from './placement';
import type { GraveyardSite } from './types';

function graveyards(seed: number, r = 40): GraveyardSite[] {
  const out: GraveyardSite[] = [];
  for (let cx = -r; cx <= r; cx++) for (let cy = -r; cy <= r; cy++) for (const s of sitesInChunk(seed, cx, cy)) if (s.kind === 'graveyard') out.push(s);
  return out.sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y));
}

const SEED = 42;
const ALL = graveyards(SEED);
/** The nearest graveyard with a sleeping party. */
const G = ALL.find((g) => g.sleepers.length > 0)!;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** A point `r` from the graveyard's centre as far as possible from its sleepers. */
function quietSpot(g: GraveyardSite, r: number): Vec2 {
  const sleepers = graveyardLayout(SEED, g).sleepers;
  let best = g.pos;
  let bestD = -1;
  for (let k = 0; k < 36; k++) {
    const p = add(g.pos, { x: Math.cos((k * Math.PI) / 18) * r, y: Math.sin((k * Math.PI) / 18) * r });
    const d = Math.min(...sleepers.map((s) => dist(s.pos, p)));
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Steps with the regular pirates kept out (they would muddle the party tests). */
function runCalm(sim: Simulation, n: number, cmd: Parameters<typeof run>[2] = {}): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    out.push(...run(sim, 1, cmd));
    sim.state.combat.enemies = sim.state.combat.enemies.filter((e) => e.id.startsWith('gs:'));
  }
  return out;
}

const party = (state: SimState, g: GraveyardSite): Enemy[] => state.combat.enemies.filter((e) => e.id.startsWith(`gs:${g.cx},${g.cy}:`));

describe('graveyard layout', () => {
  it('is pure: the memo and a fresh build agree, ids and counts by the site', () => {
    const a = graveyardLayout(SEED, G);
    const b = buildGraveyardLayout(SEED, { ...G });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.wrecks.every((w) => w.id === `${G.id}#${w.index}`)).toBe(true);
    expect(a.sleepers.map((s) => s.id)).toEqual(G.sleepers.map((_, i) => `gs:${G.cx},${G.cy}:${i}`));
    expect(a.sleepers.map((s) => s.kind)).toEqual([...G.sleepers]);
  });

  it('places 10–20 wrecks in the field, clear of mines, of each other; containers capped per graveyard', () => {
    let placed = 0;
    let total = 0;
    for (const seed of [42, 7, 1234]) {
      for (const g of graveyards(seed, 30)) {
        const l = graveyardLayout(seed, g);
        total += g.wrecks;
        placed += l.wrecks.length;
        expect(g.wrecks).toBeGreaterThanOrEqual(GRAVEYARD.wrecks[0]);
        expect(g.wrecks).toBeLessThanOrEqual(GRAVEYARD.wrecks[1]);
        expect(l.wrecks.reduce((s, w) => s + w.containers, 0)).toBeLessThanOrEqual(GRAVEYARD.containersMax);
        for (const w of l.wrecks) {
          expect(dist(w.pos, g.pos) + w.radius).toBeLessThanOrEqual(GRAVEYARD.radius);
          expect(w.containers).toBeLessThanOrEqual(WRECK_CONTAINERS[w.size]);
          // a ship by the wreck (its hull) never arms a mine
          for (const m of g.mines) expect(dist(w.pos, m) - w.radius).toBeGreaterThan(MINE.armRange);
          for (const o of l.wrecks) if (o !== w) expect(dist(w.pos, o.pos)).toBeGreaterThanOrEqual(w.radius + o.radius);
        }
        for (const s of l.sleepers) for (const m of g.mines) expect(dist(s.pos, m)).toBeGreaterThan(MINE.armRange + 5);
      }
    }
    expect(placed / total).toBeGreaterThan(0.97);
  });

  it('rolls classes and sizes by the table and T2 from depth 3', () => {
    const cls = { pirate: 0, freighter: 0, miner: 0 };
    const size = [0, 0, 0];
    let n = 0;
    for (const seed of [42, 7, 1234, 99]) {
      for (const g of graveyards(seed, 30)) {
        for (const w of graveyardLayout(seed, g).wrecks) {
          cls[w.cls]++;
          size[w.size]!++;
          n++;
          expect(w.ring).toBe(g.depth);
        }
      }
    }
    expect(cls.pirate / n).toBeCloseTo(GRAVEYARD.classWeights.pirate, 1);
    expect(cls.freighter / n).toBeCloseTo(GRAVEYARD.classWeights.freighter, 1);
    expect(size[1]! / n).toBeCloseTo(GRAVEYARD.sizeWeights[1], 1);
    const deep = ALL.find((g) => g.depth >= GRAVEYARD.wreckT2FromDepth)!;
    const state = flyingAt(SEED, deep.pos).state;
    const w = seedWreck(state, graveyardLayout(SEED, deep).wrecks.find((x) => x.cls !== 'miner')!)!;
    expect(w.grid.parts.every((p) => p.tier === 2)).toBe(true);
  });
});

describe('graveyard wrecks', () => {
  it('spawn within 300 u of the player and go when the player leaves', () => {
    const game = flyingAt(SEED, quietSpot(G, 150));
    runCalm(game, 1);
    const layout = graveyardLayout(SEED, G);
    const near = layout.wrecks.filter((w) => dist(w.pos, game.state.player.body.pos) <= GRAVEYARD.spawnRadius);
    const keys = new Set(game.state.combat.wrecks.map((w) => w.poi));
    expect(near.length).toBeGreaterThan(0);
    for (const w of near) expect(keys.has(w.id)).toBe(true);
    teleport(game, add(G.pos, { x: 2000, y: 0 }));
    runCalm(game, 31);
    expect(game.state.combat.wrecks.some((w) => w.poi?.startsWith(`${G.id}#`))).toBe(false);
    expect(game.state.combat.containers.some((c) => c.poi?.startsWith(`ct:${G.id}#`))).toBe(false);
  });

  it('remember their dismantling in discovery.cut / opened (cut a joint, leave, come back – the same wreck)', () => {
    const layout = graveyardLayout(SEED, G);
    const def = layout.wrecks.find((w) => w.size >= 1 && jointParts(seedWreck(flyingAt(SEED, G.pos).state, w)!.grid).size > 0)!;
    const game = flyingAt(SEED, add(def.pos, { x: 0, y: def.radius + 40 }));
    runCalm(game, 1);
    const state = game.state;
    const w = state.combat.wrecks.find((x) => x.poi === def.id)!;
    const joint = [...jointParts(w.grid)][0]!;
    cutJoint(state, w, joint, []);
    expect(state.discovery.cut.get(def.id)).toContain(joint);
    // the pieces carry the graveyard key as their origin
    expect(state.combat.wrecks.some((x) => x.from === def.id)).toBe(true);
    const kept = state.combat.wrecks.find((x) => x.poi === def.id)!.grid.parts.map((p) => p.id).sort();
    teleport(game, add(G.pos, { x: 2500, y: 0 }));
    runCalm(game, 31);
    expect(state.combat.wrecks.some((x) => x.poi === def.id)).toBe(false);
    teleport(game, add(def.pos, { x: 0, y: def.radius + 40 }));
    runCalm(game, 31);
    const back = state.combat.wrecks.find((x) => x.poi === def.id)!;
    expect(back.grid.parts.map((p) => p.id).sort()).toEqual(kept);
  });

  it('pay the graveyard Data once (the first analysed wreck), 0 for the others', () => {
    const state = flyingAt(SEED, G.pos).state;
    const [a, b] = graveyardLayout(SEED, G).wrecks;
    expect(graveyardWreckData(state, { poi: a!.id })).toBe(GRAVEYARD.data);
    expect(graveyardWreckData(state, { poi: b!.id })).toBe(0);
    expect(graveyardState(state, G.id).data).toBe(true);
    expect(graveyardWreckData(state, { poi: 'wreck:1,2' })).toBeNull();
  });

  it('pay through the scanner: 40 D for the first analysis, 0 D for the next wreck', () => {
    const layout = graveyardLayout(SEED, G);
    const [a, b] = [...layout.wrecks].sort((x, y) => dist(x.pos, G.pos) - dist(y.pos, G.pos));
    const game = flyingAt(SEED, add(a!.pos, { x: 0, y: a!.radius + 15 }));
    runCalm(game, 1);
    const first = ofType(holdScan(game, a!.pos), 'analysisDone').find((e) => e.target === a!.id);
    expect(first?.data).toBe(GRAVEYARD.data);
    teleport(game, add(b!.pos, { x: 0, y: b!.radius + 15 }));
    runCalm(game, 31);
    const second = ofType(holdScan(game, b!.pos), 'analysisDone').find((e) => e.target === b!.id);
    expect(second?.data).toBe(0);
  });

  it('give at most 2 fragment rolls per graveyard (the first wrecks loaded); a looted wreck never refills', () => {
    for (const g of ALL.slice(0, 8)) {
      const state = flyingAt(SEED, g.pos).state;
      const events: SimEvent[] = [];
      const defs = graveyardLayout(SEED, g).wrecks;
      for (const def of defs) {
        const w = seedWreck(state, def)!;
        onWreckSalvaged(state, w, events);
        // loading the same wreck again (partly loaded) takes no second roll
        onWreckSalvaged(state, w, events);
      }
      expect(graveyardState(state, g.id).rolls).toBe(Math.min(GRAVEYARD.fragmentRolls, defs.length));
      expect(ofType(events, 'fragmentFound').length).toBeLessThanOrEqual(GRAVEYARD.fragmentRolls);
      for (const def of defs) {
        expect(state.discovery.opened.has(def.id)).toBe(true);
        const again = seedWreck(state, def)!;
        expect(again.loot.cargo.iron + Object.keys(again.loot.parts).length).toBe(0);
        if (def.size === 0) expect(lootEmpty(again.loot)).toBe(true);
      }
    }
  });

  it('show no fragment once the graveyard rolls are used', () => {
    const state = flyingAt(SEED, G.pos).state;
    const defs = graveyardLayout(SEED, G).wrecks;
    for (const def of defs.slice(0, 2)) onWreckSalvaged(state, seedWreck(state, def)!, []);
    for (const def of defs.slice(2)) expect(resolveContents(state, seedWreck(state, def)!).fragment).toBeNull();
  });
});

describe('the sleeping party', () => {
  it('spawns dormant among the wrecks: no thrust, no fire, shield down, disguised until analysed', () => {
    const game = flyingAt(SEED, quietSpot(G, 260));
    runCalm(game, 1);
    const members = party(game.state, G);
    expect(members.map((e) => e.kind)).toEqual([...G.sleepers]);
    const at = members.map((e) => ({ ...e.body.pos }));
    const events = runCalm(game, 600);
    expect(ofType(events, 'sleepersWoke')).toHaveLength(0);
    for (const [i, e] of party(game.state, G).entries()) {
      expect(e.ai.mode).toBe('dormant');
      expect(e.shield).toBe(0);
      expect(dist(e.body.pos, at[i]!)).toBeLessThan(0.01);
      expect(sleeperDisguised(game.state, e)).toBe(true);
    }
    expect(ofType(events, 'shotFired').filter((s) => s.owner.startsWith('gs:'))).toHaveLength(0);
    game.state.discovery.scanned.add(members[0]!.id);
    expect(sleeperDisguised(game.state, party(game.state, G)[0]!)).toBe(false);
  });

  it('despawns asleep with the player away and comes back untouched', () => {
    const game = flyingAt(SEED, quietSpot(G, 260));
    runCalm(game, 1);
    expect(party(game.state, G).length).toBe(G.sleepers.length);
    teleport(game, add(G.pos, { x: GRAVEYARD.spawnRadius + 150, y: 0 }));
    runCalm(game, 1);
    expect(party(game.state, G)).toHaveLength(0);
    teleport(game, quietSpot(G, 260));
    runCalm(game, 1);
    expect(party(game.state, G).length).toBe(G.sleepers.length);
    expect(graveyardState(game.state, G.id).party).toBe('asleep');
  });

  const wakeBy = (trigger: (game: Simulation, members: Enemy[]) => SimEvent[]) => {
    const game = flyingAt(SEED, quietSpot(G, 260));
    runCalm(game, 1);
    const members = party(game.state, G);
    const events = trigger(game, members);
    return { game, events };
  };

  it('wakes when the player comes within 60 u of a sleeper', () => {
    const { game, events } = wakeBy((game, members) => {
      teleport(game, add(members[0]!.body.pos, { x: GRAVEYARD.wakeRange - 5, y: 0 }));
      return runCalm(game, 1);
    });
    expect(ofType(events, 'sleepersWoke')).toEqual([{ type: 'sleepersWoke', id: G.id, pos: G.pos }]);
    expect(party(game.state, G).every((e) => e.ai.mode === 'attack')).toBe(true);
    expect(graveyardState(game.state, G.id).party).toBe('awake');
  });

  it('wakes when a wreck within 150 u is cut or taken by the tractor', () => {
    for (const type of ['wreckCut', 'tractorLocked'] as const) {
      const { game, events } = wakeBy((game, members) => {
        const pos = add(members[0]!.body.pos, { x: GRAVEYARD.wakeWreckRange - 10, y: 0 });
        const e: SimEvent =
          type === 'wreckCut' ? { type, wreckId: 1, partId: 1, pos, pieces: [], blast: 0 } : { type, target: { kind: 'wreck', id: 1 }, pos, rip: false };
        const out: SimEvent[] = [e];
        stepGraveyards(game.state, out, SIM_DT);
        return out;
      });
      expect(ofType(events, 'sleepersWoke')).toHaveLength(1);
      expect(graveyardState(game.state, G.id).party).toBe('awake');
    }
    // farther away: nothing
    const { events } = wakeBy((game, members) => {
      const out: SimEvent[] = [{ type: 'wreckCut', wreckId: 1, partId: 1, pos: add(members[0]!.body.pos, { x: 400, y: 0 }), pieces: [], blast: 0 }];
      stepGraveyards(game.state, out, SIM_DT);
      return out;
    });
    expect(ofType(events, 'sleepersWoke')).toHaveLength(0);
  });

  it('wakes when a sleeper is hit, and when a mine blows within 150 u', () => {
    const hit = wakeBy((game, members) => {
      members[1]!.hp.set(members[1]!.grid.parts[0]!.id, 1);
      return runCalm(game, 1);
    });
    expect(ofType(hit.events, 'sleepersWoke')).toHaveLength(1);
    const blast = wakeBy((game, members) => {
      const out: SimEvent[] = [];
      wakeGraveyardsNear(game.state, add(members[0]!.body.pos, { x: 100, y: 0 }), out);
      return out;
    });
    expect(ofType(blast.events, 'sleepersWoke')).toHaveLength(1);
  });

  it('wakes once: asleep → awake → cleared, never again after a return', () => {
    const { game } = wakeBy((game, members) => {
      teleport(game, add(members[0]!.body.pos, { x: 30, y: 0 }));
      return runCalm(game, 1);
    });
    game.state.combat.enemies = game.state.combat.enemies.filter((e) => !e.id.startsWith('gs:'));
    runCalm(game, 1);
    expect(graveyardState(game.state, G.id).party).toBe('cleared');
    teleport(game, add(G.pos, { x: 3000, y: 0 }));
    runCalm(game, 31);
    teleport(game, quietSpot(G, 260));
    const events = runCalm(game, 61);
    expect(party(game.state, G)).toHaveLength(0);
    expect(ofType(events, 'sleepersWoke')).toHaveLength(0);
  });

  it('keeps the AI budget: the party waits while it would not fit', () => {
    const game = flyingAt(SEED, quietSpot(G, 260));
    const state = game.state;
    const filler = (i: number): Enemy =>
      createEnemy({ id: `pr:test:${i}`, kind: 'jackal', tier: 1, pos: add(G.pos, { x: 500, y: i * 10 }), angle: 0, home: G.pos, orbit: 1 });
    state.combat.enemies = Array.from({ length: AI_BUDGET - G.sleepers.length + 1 }, (_, i) => filler(i));
    stepGraveyards(state, [], SIM_DT);
    expect(party(state, G)).toHaveLength(0);
    state.combat.enemies.pop();
    stepGraveyards(state, [], SIM_DT);
    expect(party(state, G)).toHaveLength(G.sleepers.length);
    expect(state.combat.enemies.length).toBeLessThanOrEqual(AI_BUDGET);
  });

  it('is deterministic: the same commands give the same fight', () => {
    const play = () => {
      const target = graveyardLayout(SEED, G).sleepers[0]!.pos;
      // 90 u from the first sleeper, nose on it: drift in until it wakes, then trade fire
      const start = add(target, { x: 90, y: 0 });
      const game = flyingAt(SEED, start);
      teleport(game, start, Math.PI);
      const events: string[] = [];
      for (let i = 0; i < 900; i++) {
        const p = game.state.player.body.pos;
        const aim = { x: target.x, y: target.y };
        const forward = dist(p, target) > 50 ? 0.4 : 0;
        events.push(...run(game, 1, { aim, fire: i % 3 === 0, flight: { forward, strafe: 0, turn: 0 } }).map((e) => e.type));
      }
      return { events: events.join(','), enemies: JSON.stringify(game.state.combat.enemies.map((e) => [e.id, e.ai.mode, e.body.pos, [...e.hp]])), gy: JSON.stringify([...game.state.sites.graveyards]) };
    };
    const a = play();
    expect(play()).toEqual(a);
    expect(a.events).toContain('sleepersWoke');
  });
});
