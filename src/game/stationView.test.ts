import { describe, expect, it } from 'vitest';
import { stationStorage } from '../sim/station/actions';
import { customStation, dockedSim } from '../sim/station/testHarness';
import { HOME_STATION_ID, homeStation } from '../sim/world/stations';
import { craftingRows, partsMarketRows, repairView } from './stationView';

const plain = (s: string): string => s.replace(/ /g, ' ');

describe('partsMarketRows', () => {
  it('lists parts of a tier with stock, prices and what can be done', () => {
    const rows = partsMarketRows(homeStation(), { 'armor:1': 2 }, 400, 1);
    expect(rows).toHaveLength(18);
    const armor = rows.find((r) => r.key === 'armor:1')!;
    expect(armor).toMatchObject({ name: 'Pancier', inStorage: 2, buy: 390, sell: 105, canBuy: true, canSell: true, maxBuy: 1 });
    expect(armor.icon).toBe('assets/icons/parts/armor_t1.png');
    const engine = rows.find((r) => r.key === 'engine:1')!;
    expect(engine).toMatchObject({ inStorage: 0, canBuy: false, canSell: false, maxBuy: 0 });
  });

  it('T2 parts are not sold in ring 1 but can be sold back', () => {
    const row = partsMarketRows(homeStation(), { 'engine:2': 1 }, 10_000, 2).find((r) => r.key === 'engine:2')!;
    expect(row).toMatchObject({ buy: null, canBuy: false, canSell: true, sell: 895 });
    expect(partsMarketRows(customStation({ ring: 2 }), {}, 10_000, 2).find((r) => r.key === 'engine:2')!.buy).toBe(3695);
  });

  it('has nothing to trade without a parts market', () => {
    const outpost = customStation({ services: { ...homeStation().services, partsMarket: false } });
    expect(partsMarketRows(outpost, { 'armor:1': 2 }, 10_000, 1).every((r) => !r.canBuy && !r.canSell)).toBe(true);
  });
});

describe('craftingRows', () => {
  it('shows needs against storage + cargo, counts and market alternative', () => {
    const sim = dockedSim();
    stationStorage(sim.state, HOME_STATION_ID).resources.iron = 20;
    sim.state.player.cargo.iron = 12.3;
    sim.state.player.cargo.copper = 10;
    sim.state.credits = 1240;
    const rows = craftingRows(sim.state, homeStation(), 1);
    expect(rows.map((r) => r.partId)).toEqual([
      'cockpit', 'armor', 'engine', 'gyro', 'miningLaser', 'cargo', 'fuelTank', 'reactor', 'radar', 'cannon', 'shield',
      'heavyLaser', 'largeCargo', 'battery', 'tractorBeam', 'largeReactor', 'repairModule', 'refinery',
    ]);
    const cargo = rows.find((r) => r.key === 'cargo:1')!;
    expect(cargo.ingredients).toEqual([
      { resource: 'iron', name: 'Železo', symbol: 'Fe', need: 30, have: 32.3, ok: true },
      { resource: 'copper', name: 'Meď', symbol: 'Cu', need: 10, have: 10, ok: true },
    ]);
    expect(cargo.credits).toEqual({ need: 900, have: 1240, ok: true });
    expect(cargo).toMatchObject({ canCraft: true, maxCount: 1, marketBuy: 1605, inStorage: 0, onShip: 2 });
    expect(cargo.stats.find((s) => s.id === 'cargo')!.value).toBe(60);
    const engine = rows.find((r) => r.key === 'engine:1')!;
    expect(engine.canCraft).toBe(false);
    expect(engine.ingredients.find((i) => i.resource === 'copper')).toMatchObject({ ok: false });
  });

  it('reports crafting as unavailable without the service', () => {
    const sim = dockedSim();
    const outpost = customStation({ services: { ...homeStation().services, crafting: false } });
    expect(craftingRows(sim.state, outpost, 1).every((r) => !r.canCraft && r.maxCount === 0)).toBe(true);
  });
});

describe('repairView', () => {
  it('is empty for an undamaged ship', () => {
    const sim = dockedSim();
    const v = repairView(sim.state, homeStation(), true);
    expect(v.damaged).toBe(false);
    expect(v.rows).toEqual([]);
    expect(v.hull).toEqual({ current: 390, max: 390, fraction: 1 });
  });

  it('lists damaged parts with formatted costs', () => {
    const sim = dockedSim();
    sim.state.player.hp.set(11, 10);
    sim.state.player.hp.set(1, 48);
    stationStorage(sim.state, HOME_STATION_ID).resources.iron = 10;
    const v = repairView(sim.state, homeStation(), true);
    expect(v.damaged).toBe(true);
    expect(v.rows.map((r) => [r.id, r.name, r.hp, r.maxHp, plain(r.text)])).toEqual([
      [1, 'Kokpit T1', 48, 60, '75 kr + 3 Fe'],
      [11, 'Motor T1', 10, 25, '72 kr + 4 Fe'],
    ]);
    expect(v.rows[1]!.fraction).toBeCloseTo(0.4);
    expect(plain(v.all.text)).toBe('147 kr + 7 Fe');
    expect(v.all).toMatchObject({ total: 147, autoBuyCredits: 0, ok: true });
    expect(v.hull.current).toBe(363);
  });
});
