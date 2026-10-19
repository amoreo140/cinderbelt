// Development tab view model (M4c T2): module rows with their states and reasons, the Index Kovania,
// the paint shop / trophy hall sections and the memo that keeps the view model stable between redraws.
import { afterEach, describe, expect, it } from 'vitest';
import { FORGE_INDEX_MAX, HOME_MODULE_IDS, homeModuleIconPath } from '../../data/home';
import { setLocale, tx } from '../../i18n';
import { formatCredits } from '../../ui/format';
import { richSim } from '../../sim/fleet/testing';
import { act, expectOk } from '../../sim/station/testHarness';
import { createDevelopmentMemo, developmentView, moduleRows, type HomeUiState } from './developmentView';

const UI: HomeUiState = { selected: 'paintShop', selectedShip: null, preview: null };

afterEach(() => setLocale('sk'));

describe('moduleRows', () => {
  it('lists every module in the Rozvoj order with name, effect, price and icon', () => {
    const rows = moduleRows(richSim().state);
    expect(rows.map((r) => r.id)).toEqual(HOME_MODULE_IDS);
    const paint = rows[0]!;
    expect(paint).toEqual({
      id: 'paintShop',
      name: tx().home.modules.paintShop.name,
      effect: tx().home.modules.paintShop.effect,
      credits: 8000,
      state: 'buyable',
      icon: homeModuleIconPath('paintShop'),
    });
    expect(rows[1]).toMatchObject({ id: 'trophyHall', credits: 5000, state: 'buyable' });
    expect(rows[1]).not.toHaveProperty('reason');
  });

  it('future modules are locked with their milestone ("Comes with M5a")', () => {
    const rows = moduleRows(richSim().state);
    const refinery = rows.find((r) => r.id === 'homeRefinery')!;
    expect(refinery).toMatchObject({ state: 'future', since: 'M5a', reason: 'Príde s M5a', resources: { titanium: 200 } });
    for (const id of ['observatory', 'laboratory', 'droneHub'] as const) {
      expect(rows.find((r) => r.id === id)).toMatchObject({ state: 'future', since: 'M5b', reason: tx().home.status.comesWith('M5b') });
    }
  });

  it('missing credits: the row stays buyable with the shortfall as the reason', () => {
    const rows = moduleRows(richSim(6000).state);
    expect(rows[0]).toMatchObject({ state: 'buyable', reason: tx().home.status.missingCredits(formatCredits(2000)) });
    expect(rows[0]!.reason).toMatch(/^Chýba 2\s?000/);
    expect(rows[1]).not.toHaveProperty('reason');
  });

  it('a built module is owned (no reason)', () => {
    const sim = richSim();
    expectOk(act(sim, { type: 'homeBuild', module: 'paintShop' }));
    const row = moduleRows(sim.state)[0]!;
    expect(row.state).toBe('owned');
    expect(row).not.toHaveProperty('reason');
  });

  it('English texts', () => {
    setLocale('en');
    const rows = moduleRows(richSim(6000).state);
    expect(rows[0]!.name).toBe('Paint shop');
    expect(rows[0]!.reason).toBe(`Short by ${formatCredits(2000)}`);
    expect(rows[2]!.reason).toBe('Comes with M5a');
  });
});

describe('developmentView', () => {
  it('the Index Kovania 0 / 7, sections null until built', () => {
    const sim = richSim();
    const d = developmentView(sim.state, UI);
    expect(d).toMatchObject({ forgeIndex: 0, forgeMax: FORGE_INDEX_MAX, selected: 'paintShop', paintShop: null, trophyHall: null });
    expectOk(act(sim, { type: 'homeBuild', module: 'paintShop' }));
    expectOk(act(sim, { type: 'homeBuild', module: 'trophyHall' }));
    const built = developmentView(sim.state, { ...UI, selected: 'trophyHall' });
    expect(built.selected).toBe('trophyHall');
    expect(built.paintShop?.ships).toHaveLength(1);
    expect(built.trophyHall?.shelf).toHaveLength(6);
  });

  it('trophies without a hall are listed greyed; with the hall they move into the hall', () => {
    const sim = richSim();
    expect(developmentView(sim.state, UI).trophiesWithoutHall).toEqual([]);
    sim.state.career.trophies.push({ captain: 1, parts: [] });
    const before = developmentView(sim.state, UI);
    expect(before.trophyHall).toBeNull();
    expect(before.trophiesWithoutHall!.map((c) => c.id)).toEqual(['cap:1']);
    expectOk(act(sim, { type: 'homeBuild', module: 'trophyHall' }));
    const after = developmentView(sim.state, UI);
    expect(after.trophiesWithoutHall).toEqual([]);
    expect(after.trophyHall!.all.map((c) => c.id)).toEqual(['cap:1']);
  });
});

describe('createDevelopmentMemo', () => {
  it('returns the same object while nothing it shows changed, a new one after a change', () => {
    const sim = richSim();
    sim.state.career.trophies.push({ captain: 1, parts: [] });
    expectOk(act(sim, { type: 'homeBuild', module: 'trophyHall' }));
    const memo = createDevelopmentMemo();
    const a = memo(sim.state, UI);
    expect(memo(sim.state, { ...UI })).toBe(a);
    sim.state.credits -= 1;
    const b = memo(sim.state, UI);
    expect(b).not.toBe(a);
    expect(memo(sim.state, { ...UI, preview: 'navy' })).not.toBe(b);
    const c = memo(sim.state, UI);
    expectOk(act(sim, { type: 'trophyPin', id: 'cap:1', pinned: true }));
    const d = memo(sim.state, UI);
    expect(d).not.toBe(c);
    expect(d.trophyHall!.all[0]!.pinned).toBe(true);
    // a language switch rebuilds the texts
    setLocale('en');
    const e = memo(sim.state, UI);
    expect(e).not.toBe(d);
    expect(e.modules[0]!.name).toBe('Paint shop');
  });
});
