// Sector charts as a commodity (sectors §4.2–4.4, stage 2): who trades which chart, the prices, the
// Cartography section and the buy / sell actions. Credits only – Data are never bought or sold.
import { describe, expect, it } from 'vitest';
import { CHART_PRICES } from '../../data/charts';
import { MIN_REFERENCE_INCOME } from '../../data/contracts';
import { IDLE_COMMAND, type GameAction, type GameActionInput } from '../commands';
import { neighbours, regionWorld, sectorChunkKeys, sectorInfo, sectorKnowledge, surveyPoints, trainingChartSector } from '../regions';
import { Simulation, type SimEvent } from '../Simulation';
import { stationAt } from '../world/stations';
import { homeStation } from '../world/stations';
import {
  cartography,
  chartBuyPrice,
  chartSellPrice,
  chartSizeMultiplier,
  chartStatus,
  chartTrade,
  firstChartTarget,
} from './charts';

const SEED = 1337;

let req = 0;
const act = (sim: Simulation, a: GameActionInput): SimEvent[] => sim.step({ ...IDLE_COMMAND, actions: [{ ...a, reqId: ++req } as GameAction] });
const result = (events: readonly SimEvent[]) => events.find((e) => e.type === 'actionResult');

/** Explore every chunk of a sector (as if flown over it). */
function exploreAll(sim: Simulation, id: string): void {
  for (const k of sectorChunkKeys(sim.state.seed, id)) sim.state.world.explored.add(k);
}

const regions = (seed = SEED) => regionWorld(seed).regions;

/** A sector the player may sell (depth, not a corner), nearest to home. */
function playerSector(depth: number, seed = SEED): string {
  const r = regions(seed)
    .filter((x) => x.seed.depth === depth && chartTrade(seed, x.seed.id) === 'player' && sectorInfo(seed, x.seed.id)!.startKnowledge !== 'charted')
    .sort((a, b) => Math.hypot(a.seed.x, a.seed.y) - Math.hypot(b.seed.x, b.seed.y))[0];
  if (!r) throw new Error(`no player sector of depth ${depth}`);
  return r.seed.id;
}

/** A Guild sector not Charted at the start. */
function guildSector(seed = SEED): string {
  const r = regions(seed)
    .filter((x) => chartTrade(seed, x.seed.id) === 'guild' && sectorInfo(seed, x.seed.id)!.startKnowledge !== 'charted')
    .sort((a, b) => Math.hypot(a.seed.x, a.seed.y) - Math.hypot(b.seed.x, b.seed.y))[0];
  if (!r) throw new Error('no guild sector');
  return r.seed.id;
}

describe('chart trade rules', () => {
  it('the Guild sells Guarded and lane sectors, buys the rest of depth 1–3; Origin and depth 4+ never trade', () => {
    for (const seed of [1, 2, 3, SEED]) {
      for (const r of regions(seed)) {
        const info = sectorInfo(seed, r.seed.id)!;
        const trade = chartTrade(seed, r.seed.id);
        if (info.origin) expect(trade).toBeNull();
        else if (info.security === 'guarded' || info.onLane) expect(trade).toBe('guild');
        else expect(trade).toBe('player');
      }
      expect(chartTrade(seed, regionWorld(seed).field.regionAt(12_000, 0).id)).toBeNull();
    }
  });

  it('every seed has a sellable depth-1 sector for "First chart"', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const sim = new Simulation({ seed, startDocked: false });
      const target = firstChartTarget(sim.state);
      expect(target, `seed ${seed}`).not.toBeNull();
      expect(target!.depth).toBe(1);
      expect(chartTrade(seed, target!.id)).toBe('player');
      expect(sectorInfo(seed, target!.id)!.corner).toBeNull();
    }
  });
});

describe('chart prices', () => {
  it('sell = 0.0125 h × reference income × security × size, buy = 0.02 h × income, rounded to 50', () => {
    const round50 = (x: number) => Math.max(50, Math.ceil(x / 50 - 0.5) * 50);
    for (const r of regions()) {
      const id = r.seed.id;
      const info = sectorInfo(SEED, id)!;
      const income = MIN_REFERENCE_INCOME[info.depth as 1 | 2 | 3];
      const trade = chartTrade(SEED, id);
      if (trade === 'player') {
        const sec = info.security === 'pirate' ? 1.5 : 1;
        expect(chartSellPrice(SEED, id)).toBe(round50(CHART_PRICES.sellHours * income * sec * chartSizeMultiplier(SEED, id)));
        expect(chartBuyPrice(SEED, id)).toBe(0);
      } else if (trade === 'guild') {
        expect(chartBuyPrice(SEED, id)).toBe(round50(0.02 * income));
        expect(chartSellPrice(SEED, id)).toBe(0);
      }
      const m = chartSizeMultiplier(SEED, id);
      expect(m).toBeGreaterThanOrEqual(CHART_PRICES.size[0]);
      expect(m).toBeLessThanOrEqual(CHART_PRICES.size[1]);
    }
  });

  it('an average sector sells for 150 / 250 / 1 050 (the design 300 / 550 / 2 100 halved by §6.4) and the Guild sells for 250 / 450 / 1 700', () => {
    const round50 = (x: number) => Math.ceil(x / 50 - 0.5) * 50;
    expect([1, 2, 3].map((d) => round50(CHART_PRICES.sellHours * MIN_REFERENCE_INCOME[d as 1 | 2 | 3]))).toEqual([150, 250, 1050]);
    expect([1, 2, 3].map((d) => round50(CHART_PRICES.buyHours * MIN_REFERENCE_INCOME[d as 1 | 2 | 3]))).toEqual([250, 450, 1700]);
  });

  it('a destroyed fortress turns its sector Contested: the chart sells at ×1', () => {
    const [fid, rid] = [...regionWorld(SEED).fortressRegions][0]!;
    expect(chartTrade(SEED, rid)).toBe('player');
    const base = CHART_PRICES.sellHours * MIN_REFERENCE_INCOME[sectorInfo(SEED, rid)!.depth as 1 | 2 | 3] * chartSizeMultiplier(SEED, rid);
    const round50 = (x: number) => Math.max(50, Math.ceil(x / 50 - 0.5) * 50);
    expect(chartSellPrice(SEED, rid)).toBe(round50(base * 1.5));
    expect(chartSellPrice(SEED, rid, { destroyedFortresses: new Set([fid]), secured: new Set() })).toBe(round50(base));
  });
});

describe('selling a chart', () => {
  it('pays credits once for the player\'s own chart – never Data; sold stays Charted', () => {
    const id = playerSector(1);
    const sim = new Simulation({ seed: SEED });
    expect(result(act(sim, { type: 'chartSell', sector: id }))).toMatchObject({ ok: false, reason: 'chartNotCharted' });
    exploreAll(sim, id);
    expect(sectorKnowledge(sim.state, id)).toBe('charted');
    expect(chartStatus(sim.state, id)).toMatchObject({ own: true, sold: false, blocker: null, trade: 'player' });
    const credits = sim.state.credits;
    const data = sim.state.discovery.dataTotal;
    const events = act(sim, { type: 'chartSell', sector: id });
    expect(result(events)).toMatchObject({ ok: true });
    const price = chartSellPrice(SEED, id);
    expect(events).toContainEqual({ type: 'chartSold', id, credits: price });
    expect(events).toContainEqual({ type: 'creditsChanged', delta: price, reason: 'chart' });
    expect(sim.state.credits).toBe(credits + price);
    expect(sim.state.discovery.dataTotal).toBe(data);
    expect(sim.state.regions.sold.has(id)).toBe(true);
    expect(sectorKnowledge(sim.state, id)).toBe('charted');
    // the same chart twice: refused, nothing changes
    expect(result(act(sim, { type: 'chartSell', sector: id }))).toMatchObject({ ok: false, reason: 'chartSold' });
    expect(sim.state.credits).toBe(credits + price);
  });

  it('a chart by survey points sells too; a Guild sector or a start-Charted one never does', () => {
    const id = playerSector(2);
    const sim = new Simulation({ seed: SEED });
    sim.state.regions.points.set(id, (1 << surveyPoints(SEED, id).length) - 1);
    expect(sectorKnowledge(sim.state, id)).toBe('charted');
    expect(result(act(sim, { type: 'chartSell', sector: id }))).toMatchObject({ ok: true });
    const guild = guildSector();
    exploreAll(sim, guild);
    expect(result(act(sim, { type: 'chartSell', sector: guild }))).toMatchObject({ ok: false, reason: 'chartUnavailable' });
    const origin = regionWorld(SEED).field.origin.id;
    expect(result(act(sim, { type: 'chartSell', sector: origin }))).toMatchObject({ ok: false, reason: 'chartUnavailable' });
    expect(result(act(sim, { type: 'chartSell', sector: 'rg:B:nope' }))).toMatchObject({ ok: false, reason: 'chartUnavailable' });
  });

  it('only docked', () => {
    const id = playerSector(1);
    const sim = new Simulation({ seed: SEED, startDocked: false });
    exploreAll(sim, id);
    expect(result(act(sim, { type: 'chartSell', sector: id }))).toMatchObject({ ok: false, reason: 'notDocked' });
    expect(sim.state.regions.sold.size).toBe(0);
  });
});

describe('buying a chart', () => {
  it('Charts the sector, discovers its stations, reports its neighbours – no Data, never sellable', () => {
    const id = guildSector();
    const sim = new Simulation({ seed: SEED });
    sim.state.credits = 10_000;
    const price = chartBuyPrice(SEED, id);
    const data = sim.state.discovery.dataTotal;
    const events = act(sim, { type: 'chartBuy', sector: id });
    expect(result(events)).toMatchObject({ ok: true });
    expect(events).toContainEqual({ type: 'chartBought', id, credits: price });
    expect(sim.state.credits).toBe(10_000 - price);
    expect(sim.state.discovery.dataTotal).toBe(data);
    expect(sectorKnowledge(sim.state, id)).toBe('charted');
    const field = regionWorld(SEED).field;
    for (const n of neighbours(field, field.seedById(id)!)) expect(sectorKnowledge(sim.state, n.id)).not.toBe('uncharted');
    for (const k of sectorChunkKeys(SEED, id)) {
      const [cx, cy] = k.split(',').map(Number) as [number, number];
      const s = stationAt(SEED, cx, cy, sim.state.world.gen);
      if (s && field.regionAt(s.pos.x, s.pos.y).id === id) expect(sim.state.world.discovered.has(s.id)).toBe(true);
    }
    expect(result(act(sim, { type: 'chartBuy', sector: id }))).toMatchObject({ ok: false, reason: 'chartAlreadyCharted' });
    expect(result(act(sim, { type: 'chartSell', sector: id }))).toMatchObject({ ok: false, reason: 'chartUnavailable' });
  });

  it('needs the credits and a Guild sector', () => {
    const id = guildSector();
    const sim = new Simulation({ seed: SEED });
    sim.state.credits = chartBuyPrice(SEED, id) - 1;
    expect(result(act(sim, { type: 'chartBuy', sector: id }))).toMatchObject({ ok: false, reason: 'notEnoughCredits' });
    sim.state.credits = 100_000;
    expect(result(act(sim, { type: 'chartBuy', sector: playerSector(1) }))).toMatchObject({ ok: false, reason: 'chartUnavailable' });
    expect(sim.state.regions.bought.size).toBe(0);
  });
});

describe('Cartography', () => {
  it('lists the own charts to sell and the Guild charts not Charted yet, nearest first', () => {
    const sim = new Simulation({ seed: SEED });
    const own = playerSector(1);
    exploreAll(sim, own);
    const c = cartography(sim.state, homeStation());
    expect(c.sell.map((x) => x.id)).toContain(own);
    expect(c.sell.every((x) => x.trade === 'player' && x.own)).toBe(true);
    expect(c.buy.length).toBeGreaterThan(0);
    expect(c.buy.every((x) => x.trade === 'guild' && x.knowledge !== 'charted' && x.price > 0)).toBe(true);
    // a start-Charted Guild sector is never offered
    const lane = trainingChartSector(SEED);
    expect(c.buy.map((x) => x.id)).not.toContain(lane);
    const d = c.buy.map((x) => Math.hypot(sectorInfo(SEED, x.id)!.anchor.x, sectorInfo(SEED, x.id)!.anchor.y));
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });
});
