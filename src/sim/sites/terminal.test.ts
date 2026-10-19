// M4b T4: the derelict terminal (plan §2.4) – deterministic offers, one-time items (stash parts, plan
// fragments, a free fabrication from the ship's cargo), the part hold, and the derelictTake action.
import { describe, expect, it } from 'vitest';
import { RECIPES } from '../../data/economy';
import { parsePartKey, type PartKey } from '../../data/parts';
import { PLAN_IDS, PLAN_WEIGHTS } from '../../data/plans';
import { RESOURCE_IDS } from '../../data/resources';
import { DERELICT } from '../../data/sites';
import { ofType, run } from '../discovery/testing';
import type { GameActionInput } from '../commands';
import { act } from '../station/testHarness';
import type { Simulation } from '../Simulation';
import { derelictState } from './derelict';
import { berthedAt, findDerelict } from './derelictTesting';
import { fabricateBlocker, fabricatorKeys, partHoldFree, stashParts, STASH_POOL, terminalOffer, terminalPlan } from './terminal';
import type { DerelictSite } from './types';

const SEED = 42;
const stashSite = findDerelict(SEED, (d) => d.service === 'stash');
const planSite = findDerelict(SEED, (d) => d.service === 'plan');
const fabSite = findDerelict(SEED, (d) => d.service === 'fabricator');

const take = (sim: Simulation, site: DerelictSite, item: number, key?: PartKey) =>
  act(sim, { type: 'derelictTake', site: site.id, item, ...(key ? { key } : {}) } as GameActionInput);
const result = (events: ReturnType<typeof act>) => ofType(events, 'actionResult')[0]!;

describe('terminal offer', () => {
  it('is a pure function of the seed and the site', () => {
    const a = berthedAt(SEED, stashSite);
    const b = berthedAt(SEED, stashSite);
    expect(terminalOffer(a.state, stashSite.id)).toEqual(terminalOffer(b.state, stashSite.id));
    expect(terminalOffer(a.state, 'dl:999,999')).toBeNull();
    expect(terminalOffer(a.state, 'gy:1,1')).toBeNull();
  });

  it('stash: 2–3 distinct parts, tier by depth, about 20 % carry a variant', () => {
    let variants = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const depth = i % 2 === 0 ? 2 : 3;
      const site: DerelictSite = { ...stashSite, id: `dl:${i},${-i}`, depth };
      const keys = stashParts(SEED, site);
      expect(keys.length).toBeGreaterThanOrEqual(DERELICT.stashParts[0]);
      expect(keys.length).toBeLessThanOrEqual(DERELICT.stashParts[1]);
      expect(new Set(keys.map((k) => parsePartKey(k).partId)).size).toBe(keys.length);
      for (const k of keys) {
        const p = parsePartKey(k);
        expect(p.tier).toBe(depth >= DERELICT.stashT2FromDepth ? 2 : 1);
        if (p.variant) variants++;
        else expect(STASH_POOL).toContain(p.partId);
      }
    }
    expect(variants / N).toBeGreaterThan(DERELICT.stashVariantChance - 0.04);
    expect(variants / N).toBeLessThan(DERELICT.stashVariantChance + 0.04);
  });

  it('first berth: the offer shows the Data and the log as given; items untaken', () => {
    const sim = berthedAt(SEED, stashSite);
    const offer = terminalOffer(sim.state, stashSite.id)!;
    expect(offer).toMatchObject({ site: stashSite.id, model: stashSite.model, data: null, log: null, service: 'stash' });
    expect(offer.items.map((i) => i.index)).toEqual(stashParts(SEED, stashSite).map((_, i) => i));
    expect(offer.items.every((i) => !i.taken && i.what.kind === 'part')).toBe(true);
  });
});

describe('derelictTake', () => {
  it('stash: each part once into the part hold; the bitmask stays', () => {
    const sim = berthedAt(SEED, stashSite);
    const keys = stashParts(SEED, stashSite);
    const first = take(sim, stashSite, 1);
    expect(result(first)).toMatchObject({ ok: true });
    expect(ofType(first, 'derelictTaken')).toEqual([{ type: 'derelictTaken', id: stashSite.id, item: 1, what: { kind: 'part', key: keys[1] } }]);
    expect(sim.state.player.salvage[keys[1]!]).toBe(1);
    expect(derelictState(sim.state, stashSite.id).taken).toBe(0b10);
    expect(result(take(sim, stashSite, 1))).toMatchObject({ ok: false, reason: 'itemTaken' });
    expect(terminalOffer(sim.state, stashSite.id)!.items.map((i) => i.taken)).toEqual(keys.map((_, i) => i === 1));
    // leave and berth again: still taken
    run(sim, 1, { dock: true });
    sim.state.player.body = { ...sim.state.player.body, angle: sim.state.player.body.angle + Math.PI };
    run(sim, 1, { dock: true });
    expect(sim.state.sites.berth).toBe(stashSite.id);
    expect(result(take(sim, stashSite, 1))).toMatchObject({ ok: false, reason: 'itemTaken' });
    expect(result(take(sim, stashSite, 0))).toMatchObject({ ok: true });
  });

  it('refuses when not berthed there, an unknown item, or a full hold', () => {
    const sim = berthedAt(SEED, stashSite);
    expect(result(take(sim, planSite, 0))).toMatchObject({ ok: false, reason: 'notBerthed' });
    expect(result(take(sim, stashSite, 7))).toMatchObject({ ok: false, reason: 'serviceUnavailable' });
    expect(result(take(sim, stashSite, -1))).toMatchObject({ ok: false, reason: 'serviceUnavailable' });
    // fill the hold: cargo up to 5 units below the capacity
    sim.state.player.cargo.iron = sim.state.player.props.cargoCapacity - 5;
    expect(partHoldFree(sim.state)).toBeCloseTo(5, 9);
    expect(result(take(sim, stashSite, 0))).toMatchObject({ ok: false, reason: 'holdFull' });
    expect(derelictState(sim.state, stashSite.id).taken).toBe(0);
    // parts on board count 10 each
    sim.state.player.cargo.iron = 0;
    const room = sim.state.player.props.cargoCapacity;
    sim.state.player.salvage = { 'armor:1': Math.floor(room / DERELICT.itemCargo) };
    expect(partHoldFree(sim.state)).toBeLessThan(DERELICT.itemCargo);
    expect(result(take(sim, stashSite, 0))).toMatchObject({ ok: false, reason: 'holdFull' });
    // not berthed at all
    run(sim, 1, { dock: true });
    expect(result(take(sim, stashSite, 0))).toMatchObject({ ok: false, reason: 'notBerthed' });
  });

  it('plan: two fragments of one plan through awardFragment, once', () => {
    const sim = berthedAt(SEED, planSite);
    const offer = terminalOffer(sim.state, planSite.id)!;
    const plan = terminalPlan(sim.state, planSite);
    expect(offer.items).toEqual([{ index: 0, what: { kind: 'fragments', plan, count: DERELICT.planFragments }, taken: false }]);
    const events = take(sim, planSite, 0);
    expect(result(events)).toMatchObject({ ok: true });
    expect(ofType(events, 'fragmentFound').map((e) => [e.plan, e.count])).toEqual([
      [plan, 1],
      [plan, 2],
    ]);
    expect(sim.state.discovery.fragments.get(plan)).toBe(2);
    expect(result(take(sim, planSite, 0))).toMatchObject({ ok: false, reason: 'itemTaken' });
  });

  it('plan: prefers a plan not completed yet; all completed → duplicates give Data', () => {
    const sim = berthedAt(SEED, planSite);
    const weighted = PLAN_IDS.filter((p) => (PLAN_WEIGHTS.derelict[p] ?? 0) > 0);
    for (const p of weighted.slice(1)) sim.state.discovery.plans.add(p);
    expect(terminalPlan(sim.state, planSite)).toBe(weighted[0]);
    sim.state.discovery.plans.add(weighted[0]!);
    const data = sim.state.discovery.dataTotal;
    const events = take(sim, planSite, 0);
    expect(ofType(events, 'fragmentFound').every((e) => e.duplicate)).toBe(true);
    expect(sim.state.discovery.dataTotal).toBeGreaterThan(data);
  });

  it('fabricator: one free craft from the ship cargo, no credits, once', () => {
    const sim = berthedAt(SEED, fabSite);
    const key: PartKey = 'engine:1';
    expect(fabricatorKeys(sim.state)).toContain(key);
    expect(fabricatorKeys(sim.state).every((k) => parsePartKey(k).tier <= DERELICT.fabricatorMaxTier)).toBe(true);
    expect(result(take(sim, fabSite, 0, key))).toMatchObject({ ok: false, reason: 'noMaterials' });
    expect(result(take(sim, fabSite, 0))).toMatchObject({ ok: false, reason: 'unknownPart' });
    expect(result(take(sim, fabSite, 0, 'engine:2:overdrive'))).toMatchObject({ ok: false, reason: 'partLocked' });
    const recipe = RECIPES[key].resources;
    for (const r of RESOURCE_IDS) sim.state.player.cargo[r] = (recipe[r] ?? 0) + 1;
    expect(fabricateBlocker(sim.state, key)).toBeNull();
    const credits = sim.state.credits;
    const events = take(sim, fabSite, 0, key);
    expect(result(events)).toMatchObject({ ok: true });
    expect(ofType(events, 'derelictTaken')).toEqual([{ type: 'derelictTaken', id: fabSite.id, item: 0, what: { kind: 'crafted', key } }]);
    expect(ofType(events, 'creditsChanged')).toEqual([]);
    expect(sim.state.credits).toBe(credits);
    for (const r of RESOURCE_IDS) expect(sim.state.player.cargo[r]).toBeCloseTo(1, 9);
    expect(sim.state.player.salvage[key]).toBe(1);
    expect(result(take(sim, fabSite, 0, key))).toMatchObject({ ok: false, reason: 'itemTaken' });
  });

  it('taken parts stay on board after leaving the berth', () => {
    const sim = berthedAt(SEED, stashSite);
    take(sim, stashSite, 0);
    run(sim, 1, { dock: true });
    expect(sim.state.sites.berth).toBeNull();
    expect(Object.values(sim.state.player.salvage).reduce((a, b) => a + (b ?? 0), 0)).toBe(1);
  });

  it('is deterministic', () => {
    const play = () => {
      const sim = berthedAt(SEED, stashSite);
      const events = [...take(sim, stashSite, 0), ...take(sim, stashSite, 0), ...run(sim, 1, { dock: true }), ...run(sim, 10)];
      // (reqIds count up across the test file)
      const plain = events.map((e) => (e.type === 'actionResult' ? { ...e, reqId: 0 } : e));
      return { plain, sites: sim.state.sites, salvage: sim.state.player.salvage, data: sim.state.discovery.dataTotal };
    };
    expect(play()).toEqual(play());
  });
});
