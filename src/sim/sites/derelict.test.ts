// M4b T4: a derelict's defence (plan §2.4) – wakes once on the 2nd lit relay: sentry drones on posts
// around the station (never respawn), a local ion storm (75 s, 400 u, via stormAt) or nothing.
import { describe, expect, it } from 'vitest';
import { DERELICT, DERELICT_LAYOUTS, RELAY_LAYOUT } from '../../data/sites';
import { flyingAt, ofType, run } from '../discovery/testing';
import { stormAt } from '../events/storms';
import { ionStormAt } from '../discovery/events';
import type { SimEvent } from '../Simulation';
import { DERELICT_EXTENT } from './placement';
import { receiverPos } from './relays';
import { derelictState, sentryPosts, sentryTier, siteStorms, stepDerelicts, STORM_TICKS } from './derelict';
import { findDerelict, powerRelays } from './derelictTesting';
import type { DerelictSite } from './types';

const SEED = 42;

const lit = (site: DerelictSite, n: number): SimEvent => ({ type: 'relayPowered', id: site.relays[n - 1]!.id, site: site.id, lit: n });

/** A ship flying 100 u from the derelict (the relays' distance). */
const near = (site: DerelictSite) => flyingAt(SEED, { x: site.pos.x + 100, y: site.pos.y });

describe('derelict defence', () => {
  it('sentries wake once on the 2nd lit relay: dd: ids, the derelict as home, tier by depth', () => {
    for (const depth of [2, 3] as const) {
      const site = findDerelict(SEED, (d) => d.defence === 'sentries' && d.depth === depth);
      const sim = near(site);
      const first: SimEvent[] = [lit(site, 1)];
      stepDerelicts(sim.state, first, 1 / 60);
      expect(ofType(first, 'derelictWoke')).toEqual([]);
      expect(derelictState(sim.state, site.id).woke).toBeNull();

      sim.state.tick = 1234;
      const second: SimEvent[] = [lit(site, 2)];
      stepDerelicts(sim.state, second, 1 / 60);
      expect(ofType(second, 'derelictWoke')).toEqual([{ type: 'derelictWoke', id: site.id, defence: 'sentries' }]);
      expect(derelictState(sim.state, site.id).woke).toBe(1234);
      const sentries = sim.state.combat.enemies.filter((e) => e.id.startsWith('dd:'));
      expect(sentries.map((e) => e.id)).toEqual(Array.from({ length: DERELICT.sentries[depth] }, (_, i) => `dd:${site.cx},${site.cy}:${i}`));
      for (const e of sentries) {
        expect(e.kind).toBe('sentry');
        expect(e.home).toEqual(site.pos);
        expect(e.grid.parts.every((p) => p.tier === sentryTier(site))).toBe(true);
      }
      expect(sentryTier(site)).toBe(depth >= DERELICT.sentryT2FromDepth ? 2 : 1);

      // the 3rd relay (or the same event again after a reload) wakes nothing more
      sim.state.combat.enemies = sim.state.combat.enemies.filter((e) => e.id !== sentries[0]!.id);
      const third: SimEvent[] = [lit(site, 3), lit(site, 2)];
      stepDerelicts(sim.state, third, 1 / 60);
      expect(ofType(third, 'derelictWoke')).toEqual([]);
      expect(sim.state.combat.enemies.filter((e) => e.id.startsWith('dd:'))).toHaveLength(sentries.length - 1);
    }
  });

  it('sentry posts sit clear of the station, its relays and the clamp approach', () => {
    for (const model of ['a', 'b', 'c', 'd'] as const) {
      const site = { ...findDerelict(SEED, (d) => d.defence === 'sentries'), model };
      for (const post of sentryPosts(site)) {
        const r = Math.hypot(post.pos.x - site.pos.x, post.pos.y - site.pos.y);
        expect(r).toBeGreaterThan(DERELICT_LAYOUTS[model].clearRadius);
        expect(r).toBeLessThan(DERELICT_EXTENT);
        for (const relay of site.relays) expect(Math.hypot(post.pos.x - relay.pos.x, post.pos.y - relay.pos.y)).toBeGreaterThan(RELAY_LAYOUT.clearRadius + 10);
        // not in front of the clamp (±30° of the dock direction)
        const dir = Math.atan2(post.pos.y - site.pos.y, post.pos.x - site.pos.x) - site.angle;
        expect(Math.abs(Math.atan2(Math.sin(dir), Math.cos(dir)))).toBeGreaterThan(Math.PI / 6);
      }
    }
  });

  it('a destroyed sentry never respawns', () => {
    const site = findDerelict(SEED, (d) => d.defence === 'sentries');
    const sim = near(site);
    powerRelays(sim, site, 1);
    stepDerelicts(sim.state, [lit(site, 2)], 1 / 60);
    const id = `dd:${site.cx},${site.cy}:0`;
    sim.state.combat.enemies = sim.state.combat.enemies.filter((e) => e.id !== id);
    sim.state.combat.defeated.set(id, sim.state.tick);
    run(sim, 30);
    sim.state.tick += 30 * 60 * 60;
    run(sim, 30);
    expect(sim.state.combat.enemies.some((e) => e.id === id)).toBe(false);
  });

  it('the storm defence: a local ion storm for 75 s within 400 u, through stormAt', () => {
    const site = findDerelict(SEED, (d) => d.defence === 'storm');
    const sim = near(site);
    expect(siteStorms(sim.state)).toEqual([]);
    sim.state.tick = 5000;
    const events: SimEvent[] = [lit(site, 2)];
    stepDerelicts(sim.state, events, 1 / 60);
    expect(ofType(events, 'derelictWoke')).toEqual([{ type: 'derelictWoke', id: site.id, defence: 'storm' }]);
    expect(sim.state.combat.enemies.some((e) => e.id.startsWith('dd:'))).toBe(false);
    expect(siteStorms(sim.state)).toEqual([{ id: site.id, pos: site.pos, radius: DERELICT.storm.radius, start: 5000, end: 5000 + STORM_TICKS }]);
    expect(STORM_TICKS).toBe(DERELICT.storm.seconds * 60);
    const at = (d: number) => ({ x: site.pos.x + d, y: site.pos.y });
    expect(stormAt(sim.state, at(399), 5100)).toBe(true);
    expect(stormAt(sim.state, at(401), 5100)).toBe(false);
    // before the wake only the legacy area storm counts
    expect(stormAt(sim.state, at(0), 4999)).toBe(ionStormAt(SEED, at(0), 4999));
    sim.state.tick = 5000 + STORM_TICKS;
    expect(siteStorms(sim.state)).toEqual([]);
  });

  it('no defence: the wake is recorded, nothing spawns, no storm', () => {
    const site = findDerelict(SEED, (d) => d.defence === 'none');
    const sim = near(site);
    const events: SimEvent[] = [lit(site, 2)];
    stepDerelicts(sim.state, events, 1 / 60);
    expect(ofType(events, 'derelictWoke')).toEqual([{ type: 'derelictWoke', id: site.id, defence: 'none' }]);
    expect(sim.state.combat.enemies.some((e) => e.id.startsWith('dd:'))).toBe(false);
    expect(siteStorms(sim.state)).toEqual([]);
  });

  it('in the game: the laser lights the 2nd relay and the sentries wake', () => {
    const site = findDerelict(SEED, (d) => d.defence === 'sentries' && d.depth === 2);
    const target = site.relays[1]!;
    const out = { x: target.pos.x - site.pos.x, y: target.pos.y - site.pos.y };
    const len = Math.hypot(out.x, out.y);
    const sim = flyingAt(SEED, { x: target.pos.x + (out.x / len) * 14, y: target.pos.y + (out.y / len) * 14 });
    sim.state.player.body = { ...sim.state.player.body, angle: Math.atan2(-out.y, -out.x) };
    sim.state.player.prevBody = sim.state.player.body;
    powerRelays(sim, site, 1);
    const events = run(sim, 5 * 60 + 30, { mining: true, aim: receiverPos(target) });
    expect(ofType(events, 'relayPowered')).toEqual([{ type: 'relayPowered', id: target.id, site: site.id, lit: 2 }]);
    expect(ofType(events, 'derelictWoke')).toEqual([{ type: 'derelictWoke', id: site.id, defence: 'sentries' }]);
    const woke = derelictState(sim.state, site.id).woke!;
    expect(woke).toBeGreaterThan(0);
    // the drones exist (they may have moved since)
    expect(sim.state.combat.enemies.filter((e) => e.id.startsWith(`dd:${site.cx},${site.cy}:`)).length).toBe(DERELICT.sentries[site.depth]);
  });
});
