// M4b T7: the derelict terminal view model – item rows and their reasons (hold full, taken), the
// fabricator's choices with the missing materials, the Data and the log from the berth's visit event.
import { describe, expect, it } from 'vitest';
import { RECIPES } from '../../data/economy';
import { RESOURCE_IDS } from '../../data/resources';
import { tx } from '../../i18n';
import { ofType, run } from '../../sim/discovery/testing';
import { atClamp, findDerelict, powerRelays } from '../../sim/sites/derelictTesting';
import type { DerelictSite } from '../../sim/sites/types';
import { act } from '../../sim/station/testHarness';
import type { Simulation } from '../../sim/Simulation';
import { partName } from '../shipyardView';
import { fabricatorItem, missingMaterials, terminalData, type TerminalVisit } from './terminalView';

const SEED = 42;
const stashSite = findDerelict(SEED, (d) => d.service === 'stash');
const planSite = findDerelict(SEED, (d) => d.service === 'plan');
const fabSite = findDerelict(SEED, (d) => d.service === 'fabricator');

/** Berths at the site and returns the sim with the visit handed out by that berth. */
function berth(site: DerelictSite): { sim: Simulation; visit: TerminalVisit } {
  const sim = atClamp(SEED, site);
  powerRelays(sim, site);
  const events = run(sim, 1, { dock: true });
  const v = ofType(events, 'derelictVisited')[0];
  if (!v || sim.state.sites.berth !== site.id) throw new Error('berth failed');
  return { sim, visit: { id: v.id, data: v.data, journal: v.journal } };
}

const emptyCargo = (sim: Simulation) => {
  for (const r of RESOURCE_IDS) sim.state.player.cargo[r] = 0;
};

describe('terminal view', () => {
  it('first visit: the Data and the log come from the berth event; later the terminal says they are done', () => {
    const { sim, visit } = berth(stashSite);
    const d = terminalData(sim.state, stashSite.id, visit)!;
    expect(d.id).toBe(stashSite.id);
    expect(d.name.startsWith(tx().world.derelict.name)).toBe(true);
    expect(d.model).toBe(stashSite.model);
    expect(d.service).toBe('stash');
    expect(d.data).toBe(visit.data);
    expect(d.log).toBe(tx().journal[`derelictLog_${stashSite.model}`].text);
    // no visit (a reload while berthed) or another derelict's visit: already given
    expect(terminalData(sim.state, stashSite.id, null)).toMatchObject({ data: null, log: null });
    expect(terminalData(sim.state, stashSite.id, { ...visit, id: 'dl:0,0' })).toMatchObject({ data: null, log: null });
    expect(terminalData(sim.state, 'dl:999,999', null)).toBeNull();
  });

  it('stash: part rows; a full part hold is the reason, a taken row has none', () => {
    const { sim } = berth(stashSite);
    emptyCargo(sim);
    const d = terminalData(sim.state, stashSite.id, null)!;
    expect(d.fabricator).toBeNull();
    expect(d.items.length).toBeGreaterThanOrEqual(2);
    for (const item of d.items) {
      expect(item.key).toBeDefined();
      expect(item.label).toBe(partName(item.key!));
      expect(item).toMatchObject({ taken: false });
      expect(item.reason).toBeUndefined();
    }
    act(sim, { type: 'derelictTake', site: stashSite.id, item: 0 });
    // fill the hold: nothing more fits
    sim.state.player.cargo.iron = sim.state.player.props.cargoCapacity;
    const full = terminalData(sim.state, stashSite.id, null)!;
    expect(full.holdFree).toBeLessThan(10);
    expect(full.items[0]).toMatchObject({ taken: true });
    expect(full.items[0]!.reason).toBeUndefined();
    expect(full.items[1]!.reason).toBe(tx().actionErrors.holdFull);
  });

  it('plan: one row with the fragments of the plan', () => {
    const { sim } = berth(planSite);
    const d = terminalData(sim.state, planSite.id, null)!;
    expect(d.service).toBe('plan');
    expect(d.items).toHaveLength(1);
    expect(d.items[0]!.label).toMatch(/2/);
    expect(d.items[0]!.key).toBeUndefined();
    expect(d.fabricator).toBeNull();
  });

  it('fabricator: choices with the missing materials, the makeable ones first; gone once used', () => {
    const { sim } = berth(fabSite);
    emptyCargo(sim);
    const d = terminalData(sim.state, fabSite.id, null)!;
    expect(d.service).toBe('fabricator');
    expect(d.fabricator!.length).toBeGreaterThan(0);
    for (const o of d.fabricator!) {
      expect(o.reason).toBe(missingMaterials(sim.state, o.key)!);
      expect(o.reason!.startsWith(tx().crafting.missing('').trim())).toBe(true);
    }
    // cargo for one recipe: that part can be made and comes first
    const key = d.fabricator!.find((o) => o.key === 'engine:1')?.key ?? d.fabricator![0]!.key;
    for (const r of RESOURCE_IDS) sim.state.player.cargo[r] = RECIPES[key].resources[r] ?? 0;
    const ready = terminalData(sim.state, fabSite.id, null)!;
    const opts = ready.fabricator!;
    const makeable = opts.filter((o) => o.reason === undefined);
    expect(makeable.map((o) => o.key)).toContain(key);
    // every makeable option comes before every blocked one
    expect(opts.slice(0, makeable.length)).toEqual(makeable);
    expect(opts.find((o) => o.key === key)!.materials).toEqual(RECIPES[key].resources);
    const item = fabricatorItem(sim.state, fabSite.id)!;
    act(sim, { type: 'derelictTake', site: fabSite.id, item, key });
    const used = terminalData(sim.state, fabSite.id, null)!;
    expect(used.fabricator).toBeNull();
    expect(used.items[item]).toMatchObject({ taken: true, label: tx().world.derelict.terminal.fabricateItem });
  });

  it('missing materials: whole units rounded up, in the cargo order', () => {
    const { sim } = berth(fabSite);
    emptyCargo(sim);
    const key = 'engine:1';
    const need = RECIPES[key].resources;
    const first = RESOURCE_IDS.find((r) => (need[r] ?? 0) > 0)!;
    sim.state.player.cargo[first] = (need[first] ?? 0) - 0.5;
    expect(missingMaterials(sim.state, key)).toContain(`1 ${tx().resources[first]}`);
    for (const r of RESOURCE_IDS) sim.state.player.cargo[r] = need[r] ?? 0;
    expect(missingMaterials(sim.state, key)).toBeNull();
  });
});
