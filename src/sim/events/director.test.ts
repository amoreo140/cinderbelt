// Events director (M4b T1): rolls, rates, gating, one-shots, listing, debugEvent, determinism.
import { describe, expect, it } from 'vitest';
import type { RingIndex } from '../../data/economy';
import { AMBUSH, DIRECTOR, MICROMETEORS, ROLLED_EVENT_ORDER, type RolledEventKind } from '../../data/events';
import { SECTOR_EPOCH_TICKS } from '../../data/sector';
import { IDLE_COMMAND } from '../commands';
import { distressAt, distressBucket, ionStormIn } from '../discovery/events';
import { createEnemy } from '../combat/enemies';
import type { Security } from '../regions';
import { sectorIdAt, sectorInfoAt, sectorSecurity } from '../regions';
import { WORLD_GEN_LATEST } from '../world/worldGen';
import { HOME_STATION_ID, stationAt } from '../world/stations';
import {
  activeEvents,
  BUCKET_TICKS,
  directorAction,
  parseRolledKey,
  pickRolledKind,
  rollBucket,
  rollContext,
  rolledChance,
  rolledKey,
  type RollContext,
} from './director';
import { ambushBudgetOk } from './ambush';
import { findSpot, findTrigger, ofType, parkedAt, steps } from './testing';
import { Simulation } from '../Simulation';

const SEED = 4242;
const ctx = (over: Partial<RollContext> = {}): RollContext => ({ depth: 2, security: 'contested', corridor: false, modifiers: [], budget: true, ...over });

describe('director rolls', () => {
  it('the same (seed, sector, bucket) gives the same draw; another bucket another one', () => {
    expect(rollBucket(1, 'rg:A:2.3', 77)).toEqual(rollBucket(1, 'rg:A:2.3', 77));
    expect(rollBucket(1, 'rg:A:2.3', 77)).not.toEqual(rollBucket(1, 'rg:A:2.3', 78));
    expect(rollBucket(1, 'rg:A:2.3', 77)).not.toEqual(rollBucket(2, 'rg:A:2.3', 77));
    const r = rollBucket(9, 'rg:A:1.0', 5);
    expect(r.offset).toBeGreaterThanOrEqual(0);
    expect(r.offset).toBeLessThan(DIRECTOR.offsetSeconds[1] * 60);
    expect(Object.keys(r.rolls).sort()).toEqual([...ROLLED_EVENT_ORDER].sort());
  });

  it('every roll is drawn whatever the outcome: the micrometeor roll does not depend on the ambush chance', () => {
    let both = 0;
    for (let b = 0; b < 4000; b++) {
      const roll = rollBucket(SEED, 'rg:A:2.1', b);
      const withAmbush = pickRolledKind(roll, ctx());
      const without = pickRolledKind(roll, ctx({ security: 'guarded' }));
      // without ambushes, micrometeors fire exactly when their own roll succeeds
      expect(without === 'micrometeors').toBe(roll.rolls.micrometeors < MICROMETEORS.rate[2]);
      // the first kind in order wins
      if (roll.rolls.ambush < AMBUSH.rate[2]) expect(withAmbush).toBe('ambush');
      else expect(withAmbush).toBe(without);
      if (roll.rolls.ambush < AMBUSH.rate[2] && roll.rolls.micrometeors < MICROMETEORS.rate[2]) both++;
    }
    expect(both).toBeGreaterThan(0);
  });

  it.each([1, 2, 3, 4] as RingIndex[])('rates of depth %i within ±10 % of the table (Monte Carlo)', (depth) => {
    const cases: [Security, boolean][] = [['quiet', false], ['guarded', false], ['contested', false], ['pirate', false], ['contested', true]];
    for (const [security, corridor] of cases) {
      const c = ctx({ depth, security, corridor });
      for (const kind of ROLLED_EVENT_ORDER) {
        const p = rolledChance(kind, c);
        const n = 20_000;
        let hits = 0;
        for (let b = 0; b < n; b++) if (rollBucket(SEED + depth, `rg:A:${depth}.${security}`, b).rolls[kind] < p) hits++;
        if (p === 0) expect(hits).toBe(0);
        else expect(Math.abs(hits / n - p) / p).toBeLessThan(0.1);
      }
    }
  });

  it('the chance table: Quiet and Guarded never ambush, Pirate ×1.4, corridor ×0.2, local conditions, AI budget', () => {
    for (const depth of [1, 2, 3, 4] as RingIndex[]) {
      expect(rolledChance('ambush', ctx({ depth, security: 'quiet' }))).toBe(0);
      expect(rolledChance('ambush', ctx({ depth, security: 'guarded' }))).toBe(0);
      expect(rolledChance('micrometeors', ctx({ depth, security: 'guarded' }))).toBe(MICROMETEORS.rate[depth]);
      expect(rolledChance('micrometeors', ctx({ depth, security: 'quiet', corridor: true }))).toBe(MICROMETEORS.rate[depth]);
    }
    expect(rolledChance('ambush', ctx({ depth: 1 }))).toBe(0);
    expect(rolledChance('ambush', ctx())).toBeCloseTo(0.1);
    expect(rolledChance('ambush', ctx({ security: 'pirate' }))).toBeCloseTo(0.14);
    expect(rolledChance('ambush', ctx({ corridor: true }))).toBeCloseTo(0.02);
    expect(rolledChance('ambush', ctx({ modifiers: ['huntingGrounds'] }))).toBeCloseTo(0.15);
    expect(rolledChance('ambush', ctx({ modifiers: ['pirateWar'] }))).toBeCloseTo(0.05);
    expect(rolledChance('ambush', ctx({ modifiers: ['demand'] }))).toBeCloseTo(0.1);
    expect(rolledChance('ambush', ctx({ budget: false }))).toBe(0);
    expect(rolledChance('micrometeors', ctx({ budget: false }))).toBeCloseTo(0.08);
    // over many buckets a Guarded sector never rolls an ambush
    for (let b = 0; b < 5000; b++) expect(pickRolledKind(rollBucket(SEED, 'rg:A:2.9', b), ctx({ security: 'guarded' }))).not.toBe('ambush');
  });

  it('keys round-trip; foreign keys are not the director’s', () => {
    expect(parseRolledKey(rolledKey('ambush', 'rg:A:2.13', 812))).toEqual({ kind: 'ambush', sector: 'rg:A:2.13', bucket: 812 });
    expect(parseRolledKey(rolledKey('micrometeors', 'rg:A:0', 3))).toEqual({ kind: 'micrometeors', sector: 'rg:A:0', bucket: 3 });
    expect(parseRolledKey('ev:comet:cm:2@4')).toBeNull();
    expect(parseRolledKey('ev:ambush:rg:A:2.13@812#end')).toBeNull();
  });
});

describe('director gating (at the trigger tick)', () => {
  const setup = (kind: RolledEventKind = 'micrometeors', security: Security = 'contested') => {
    const probe = new Simulation({ seed: SEED, startDocked: false });
    const spot = findSpot(probe, 2, security);
    const sim = parkedAt(SEED, spot.pos);
    const tick = findTrigger(sim, spot, kind);
    return { sim, spot, tick };
  };
  // rolled events only (a comet flyby – T2 – may be announced anywhere)
  const warnings = (sim: Simulation) => ofType(sim.step(IDLE_COMMAND), 'eventWarning').filter((e) => e.kind === 'micrometeors' || e.kind === 'ambush');

  it('fires the bucket’s event at its trigger tick with the radio lead and starts it after the lead', () => {
    const { sim, spot, tick } = setup();
    sim.state.tick = tick - 1;
    expect(warnings(sim)).toEqual([]);
    const w = warnings(sim);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ kind: 'micrometeors', inSeconds: MICROMETEORS.leadSeconds, key: rolledKey('micrometeors', spot.sector, Math.floor(tick / BUCKET_TICKS)) });
    expect(typeof w[0]!.dir).toBe('number');
    expect(sim.state.director.fired.get(w[0]!.key)).toBe(tick);
    const listed = activeEvents(sim.state).find((e) => e.key === w[0]!.key)!;
    expect(listed.start).toBe(tick + MICROMETEORS.leadSeconds * 60);
    expect(listed.end - listed.start).toBeGreaterThanOrEqual(MICROMETEORS.duration[0] * 60);
    expect(listed.end - listed.start).toBeLessThanOrEqual(MICROMETEORS.duration[1] * 60);
    const ev = steps(sim, MICROMETEORS.leadSeconds * 60 + 1);
    expect(ofType(ev, 'eventStarted').map((e) => e.key)).toEqual([w[0]!.key]);
    // the quiet window holds: no other event until the shower ended + 120 s
    expect(sim.state.director.last).toBe(listed.end);
  });

  it('no event while docked, berthed, destroyed, in the Guild Training, near a station or in the quiet window', () => {
    const variants: [string, (sim: Simulation) => void][] = [
      ['docked', (sim) => (sim.state.player.dock = { mode: 'docked', stationId: HOME_STATION_ID })],
      ['berthed', (sim) => (sim.state.sites.berth = 'dl:3,4')],
      ['destroyed', (sim) => (sim.state.player.destroyed = true)],
      ['training', (sim) => (sim.state.career.training.status = 'active')],
      ['quiet', (sim) => (sim.state.director.last = sim.state.tick - 60 * 60)],
    ];
    for (const [name, apply] of variants) {
      const { sim, tick } = setup();
      sim.state.tick = tick;
      apply(sim);
      expect([name, warnings(sim)]).toEqual([name, []]);
    }
    // just outside the quiet window it fires
    const { sim, tick } = setup();
    sim.state.tick = tick;
    sim.state.director.last = tick - DIRECTOR.quietSeconds * 60;
    expect(warnings(sim)).toHaveLength(1);
  });

  it('epoch 0 (the first 30 min) is calm', () => {
    const probe = new Simulation({ seed: SEED, startDocked: false });
    const spot = findSpot(probe, 2, 'contested');
    const sim = parkedAt(SEED, spot.pos);
    let fired = 0;
    for (let b = 1; b * BUCKET_TICKS < SECTOR_EPOCH_TICKS; b++) {
      sim.state.tick = b * BUCKET_TICKS + rollBucket(SEED, spot.sector, b).offset;
      fired += warnings(sim).length;
    }
    expect(fired).toBe(0);
    expect(sim.state.director.fired.size).toBe(0);
  });

  it('never within 600 u of a station', () => {
    // a depth-2 Contested station; the ship parked 300 u from it
    let found: { x: number; y: number } | null = null;
    for (let cx = -40; cx <= 40 && !found; cx++) {
      for (let cy = -40; cy <= 40 && !found; cy++) {
        const s = stationAt(SEED, cx, cy, WORLD_GEN_LATEST);
        if (!s) continue;
        const near = { x: s.pos.x + 300, y: s.pos.y };
        const info = sectorInfoAt(SEED, near.x, near.y);
        if (info.depth === 2 && sectorSecurity(SEED, info.id) === 'contested') found = near;
      }
    }
    expect(found).not.toBeNull();
    const sim = parkedAt(SEED, found!);
    const sector = sectorIdAt(SEED, found!.x, found!.y);
    let rolled = 0;
    let fired = 0;
    for (let b = Math.ceil(SECTOR_EPOCH_TICKS / BUCKET_TICKS), n = 0; n < 300; b++, n++) {
      const roll = rollBucket(SEED, sector, b);
      sim.state.tick = b * BUCKET_TICKS + roll.offset;
      sim.state.director.last = -1e9;
      if (pickRolledKind(roll, rollContext(sim.state, sector, found!))) rolled++;
      fired += warnings(sim).length;
      sim.state.player.body = { ...sim.state.player.body, pos: found!, vel: { x: 0, y: 0 } };
    }
    expect(rolled).toBeGreaterThan(0);
    expect(fired).toBe(0);
  });

  it('the AI budget blocks an ambush (and lets a micrometeor shower through)', () => {
    const { sim, spot, tick } = setup('ambush');
    const roll = rollBucket(SEED, spot.sector, Math.floor(tick / BUCKET_TICKS));
    for (let i = 0; i < AMBUSH.maxEnemies; i++) {
      sim.state.combat.enemies.push(createEnemy({ id: `pr:900,${i}:0`, kind: 'jackal', tier: 1, pos: { x: spot.pos.x + 700 + i * 30, y: spot.pos.y }, angle: 0, home: { x: 0, y: 0 }, orbit: 1 }));
    }
    expect(ambushBudgetOk(sim.state)).toBe(false);
    sim.state.tick = tick;
    const w = warnings(sim);
    expect(w.some((e) => e.kind === 'ambush')).toBe(false);
    expect(w.length).toBe(roll.rolls.micrometeors < MICROMETEORS.rate[2] ? 1 : 0);
  });

  it('a Guarded sector gets micrometeors but never an ambush', () => {
    const probe = new Simulation({ seed: SEED, startDocked: false });
    const spot = findSpot(probe, 3, 'guarded', 'any');
    const sim = parkedAt(SEED, spot.pos);
    const kinds = new Set<string>();
    for (let b = Math.ceil(SECTOR_EPOCH_TICKS / BUCKET_TICKS), n = 0; n < 400; b++, n++) {
      sim.state.tick = b * BUCKET_TICKS + rollBucket(SEED, spot.sector, b).offset;
      sim.state.director.last = -1e9;
      for (const w of warnings(sim)) kinds.add(w.kind);
      sim.state.player.body = { ...sim.state.player.body, pos: spot.pos, vel: { x: 0, y: 0 } };
    }
    expect(kinds.has('ambush')).toBe(false);
    expect(kinds.has('micrometeors')).toBe(true);
  });
});

describe('listing and pruning', () => {
  it('legacy events are listed with their generators’ values', () => {
    // a distress signal in hearing range and an ion storm, found by their generators
    const seed = 3;
    let found: { pos: { x: number; y: number }; tick: number } | null = null;
    for (let t = 0; t < 300 && !found; t++) {
      const tick = t * 3 * 60 * 60 + 90 * 60;
      for (const pos of [{ x: 2500, y: 0 }, { x: 0, y: 2600 }, { x: -2600, y: 300 }, { x: 1800, y: -2200 }]) {
        const s = ionStormIn(seed, pos, tick);
        if (s && tick >= s.start && tick < s.end) {
          found = { pos, tick };
          break;
        }
      }
    }
    expect(found).not.toBeNull();
    const sim = parkedAt(seed, found!.pos);
    sim.state.tick = found!.tick;
    const storm = ionStormIn(seed, found!.pos, found!.tick)!;
    const listed = activeEvents(sim.state).filter((e) => e.kind === 'ionStorm');
    expect(listed).toEqual([expect.objectContaining({ start: storm.start, end: storm.end })]);
    expect(listed[0]!.key).toMatch(/^ev:ionStorm:-?\d+,-?\d+@\d+$/);
    // distress: every listed signal is the generator's, within hearing
    for (const e of activeEvents(sim.state).filter((x) => x.kind === 'distress')) {
      const m = /^ds:(-?\d+),(-?\d+)@(\d+)$/.exec(e.key)!;
      const ds = distressAt(seed, Number(m[1]), Number(m[2]), Number(m[3]))!;
      expect(Number(m[3])).toBe(distressBucket(found!.tick));
      expect(e.pos).toEqual(ds.pos);
      expect(e.end).toBe(ds.until);
    }
  });

  it('prunes its own keys two buckets after the event is over, foreign keys two buckets after their tick', () => {
    const probe = new Simulation({ seed: SEED, startDocked: false });
    const spot = findSpot(probe, 2, 'contested');
    const sim = parkedAt(SEED, spot.pos);
    const tick = findTrigger(sim, spot, 'micrometeors');
    sim.state.tick = tick;
    // foreign keys (comet flybys store their end tick) go two buckets after their tick
    sim.state.director.fired.set('ev:comet:cm:1@2', tick + 100);
    sim.state.director.fired.set('ev:comet:cm:2@7', tick - DIRECTOR.pruneBuckets * BUCKET_TICKS - 1);
    const key = ofType(sim.step(IDLE_COMMAND), 'eventWarning').find((e) => e.kind === 'micrometeors')!.key;
    const end = activeEvents(sim.state).find((e) => e.key === key)!.end;
    sim.state.tick = end + DIRECTOR.pruneBuckets * BUCKET_TICKS - 100;
    sim.step(IDLE_COMMAND);
    expect(sim.state.director.fired.has(key)).toBe(true);
    expect(sim.state.director.fired.has('ev:comet:cm:2@7')).toBe(false);
    expect(activeEvents(sim.state).some((e) => e.key === key)).toBe(false);
    sim.state.tick = end + DIRECTOR.pruneBuckets * BUCKET_TICKS + 10;
    sim.step(IDLE_COMMAND);
    expect(sim.state.director.fired.has(key)).toBe(false);
    expect(sim.state.director.fired.has('ev:comet:cm:1@2')).toBe(false);
  });
});

describe('debugEvent', () => {
  it('forces micrometeors or an ambush in the current sector and bucket; once per bucket; only in flight', () => {
    const probe = new Simulation({ seed: SEED, startDocked: false });
    const spot = findSpot(probe, 2, 'contested');
    const sim = parkedAt(SEED, spot.pos);
    sim.state.tick = 1000;
    const ok = directorAction(sim.state, { type: 'debugEvent', kind: 'micrometeors', reqId: 1 });
    expect(ok[0]).toMatchObject({ type: 'actionResult', ok: true });
    expect(ofType(ok, 'eventWarning')[0]!.key).toBe(rolledKey('micrometeors', spot.sector, 0));
    expect(directorAction(sim.state, { type: 'debugEvent', kind: 'micrometeors', reqId: 2 })[0]).toMatchObject({ ok: false });
    expect(directorAction(sim.state, { type: 'debugEvent', kind: 'ionStorm', reqId: 3 })[0]).toMatchObject({ ok: false, reason: 'serviceUnavailable' });
    sim.state.player.dock = { mode: 'docked', stationId: HOME_STATION_ID };
    expect(directorAction(sim.state, { type: 'debugEvent', kind: 'ambush', reqId: 4 })[0]).toMatchObject({ ok: false, reason: 'serviceUnavailable' });
  });
});

describe('determinism', () => {
  it('the same commands give the same events and state', () => {
    const run = () => {
      const probe = new Simulation({ seed: SEED, startDocked: false });
      const spot = findSpot(probe, 2, 'contested');
      const sim = parkedAt(SEED, spot.pos);
      sim.state.tick = SECTOR_EPOCH_TICKS;
      const events = [];
      for (let i = 0; i < 60 * 60 * 4; i++) {
        // forced events (dev action) plus whatever the director rolls on the way
        const actions = i === 10 ? [{ type: 'debugEvent' as const, kind: 'micrometeors' as const, reqId: 1 }] : i === 60 * 60 * 2 ? [{ type: 'debugEvent' as const, kind: 'ambush' as const, reqId: 2 }] : [];
        events.push(...sim.step({ ...IDLE_COMMAND, actions, flight: { forward: i % 600 < 200 ? 0.3 : 0, strafe: 0, turn: i % 900 < 100 ? 0.5 : 0 } }));
      }
      return { events: events.filter((e) => ['eventWarning', 'eventStarted', 'eventEnded', 'micrometeorHit', 'ambushSpawned'].includes(e.type)), director: [...sim.state.director.fired], last: sim.state.director.last, hp: [...sim.state.player.hp] };
    };
    const a = run();
    const b = run();
    expect(b).toEqual(a);
    expect(a.events.some((e) => e.type === 'micrometeorHit')).toBe(true);
    expect(a.events.some((e) => e.type === 'ambushSpawned')).toBe(true);
  }, 15_000);
});
