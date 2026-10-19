// CI oracle (M3.5a): the key prices, recipes and parameters of the game must match the economy model
// (tools/econ/econ-model.mjs). The model is imported directly – its output does not run on import.
// A number changed in the game = changed in the model and the tables regenerated (and vice versa).
import { describe, expect, it } from 'vitest';
import {
  avgPrice,
  cargoIncome,
  chartCreditsPerHour,
  chartingPerHour,
  convoySaleLoss,
  dataPerHour,
  escortRate,
  income,
  MODEL,
  refIncome,
  refineryCredits,
  relayReward,
  run,
  workshopIncome,
} from '../../tools/econ/econ-model.mjs';
import { COMET, DERELICT, GRAVEYARD, SITES } from './sites';
import { kindLootMult } from '../sim/combat/combat';
import { CHART_PRICES } from './charts';
import { REGION_GEN } from '../sim/regions/constants';
import { ALL_PART_KEYS, COCKPIT_HULL_BUDGET, PART_DEFS, parsePartKey, partDefOf, partKey, type PartId } from './parts';
import {
  FUEL_BASE_PRICE,
  fuelUnitPrice,
  HANGAR,
  PART_BUY_MARKUP,
  PART_SELL_FACTOR,
  partBuyPrice,
  partSellPrice,
  partValue,
  RECIPES,
  repairMaterial,
  REPAIR_CREDIT_FACTOR,
  REPAIR_MATERIAL_FACTOR,
  PRICE_JITTER_MAX,
  PRICE_JITTER_MIN,
  resourcePrice,
  RESOURCE_BASE_PRICE,
  RING_INDICES,
  RING_PART_MULT,
  RING_RESOURCE_MULT,
  RING_SERVICE_MULT,
  SELL_SPREAD,
} from './economy';
import { HOME_MODULE_IDS, HOME_MODULES, isBuildableModule } from './home';
import { REFINED_BONUS, REFINED_CEILING } from './workshop';
import { refinedBonusAt, refinedUnit } from '../sim/ship/workshop';
import { PLAN_VARIANTS, VARIANT_FEE_MULT, VARIANTS } from './variants';
import { sizeHullPoints } from '../sim/ship/budget';
import { HUMAN_EFFICIENCY, RING_TRIP, TRIP_OVERHEAD, VEIN_SKILL } from './incomeModel';
import { averageSellPrice, miningIncome } from '../sim/contracts/reward';
import { ARCHIVE_NODES } from './archive';
import { CONTRACT_DEFS, CONTRACT_OVERHEAD_SECONDS, CRUISE_SPEED, HUNT_SECONDS_PER_ENEMY, MIN_REFERENCE_INCOME } from './contracts';
import { CONVOY, CONVOY_RINGS, ESCORT } from './convoys';
import { RELAY_CHAIN } from './guild';
import { RESOURCE_IDS } from './resources';
import { contractReward } from '../sim/contracts/reward';
import { convoyAt, convoyRoutes, departureTick } from '../sim/convoys/schedule';
import { convoyFuelUnit, convoyOffer, convoySellUnit } from '../sim/convoys/trade';
import { escortDepositOf, escortSeconds } from '../sim/convoys/escort';
import { guildRelaySites } from '../sim/guild/relaySites';
import { relaySeconds } from '../sim/guild/relayChain';
import type { LaneId } from '../sim/regions';
import { Simulation } from '../sim/Simulation';
import { CHUNK_SIZE } from '../sim/world/chunks';
import { ringIndexAt } from '../sim/world/rings';
import { stationsInArea } from '../sim/world/stations';
import { DATA_REWARDS, INSTITUTE_DATA_RATE, POI_DENSITY, POI_KINDS } from './poi';
import { createGrid } from '../sim/ship/grid';
import { computeProperties } from '../sim/ship/properties';

const RES = { iron: 'fe', copper: 'cu', ice: 'ice', titanium: 'ti' } as const;
const PART = {
  cockpit: 'cockpit',
  armor: 'armor',
  engine: 'engine',
  gyro: 'gyro',
  miningLaser: 'laser',
  cargo: 'cargo',
  fuelTank: 'tank',
  reactor: 'reactor',
  radar: 'radar',
  cannon: 'cannon',
  shield: 'shield',
} as const satisfies Partial<Record<PartId, string>>;

describe('econ model oracle', () => {
  it('resource base prices and ring multipliers match', () => {
    for (const [game, model] of Object.entries(RES) as [keyof typeof RES, (typeof RES)[keyof typeof RES]][]) {
      expect(RESOURCE_BASE_PRICE[game], game).toBe(MODEL.BASE[model]);
      for (const ring of RING_INDICES) expect(RING_RESOURCE_MULT[ring][game], `${game} P${ring}`).toBe(MODEL.RING_MULT[ring][model]);
    }
    expect(SELL_SPREAD).toBe(MODEL.SELL_SPREAD);
  });

  it('part values (recipe resources at base prices + fee) match the model for T1 and T2', () => {
    for (const tier of [1, 2] as const) {
      for (const [game, model] of Object.entries(PART) as [keyof typeof PART, (typeof PART)[keyof typeof PART]][]) {
        expect(partValue(partKey(game, tier)), `${game} T${tier}`).toBe(MODEL.V[tier][model]);
      }
    }
  });

  it('mining lasers, cargo holds, cockpit cargo and hull budgets match', () => {
    for (const tier of [1, 2] as const) {
      expect(PART_DEFS.miningLaser[tier].mining!.rate).toBe(MODEL.LASER_RATE[tier]);
      expect(PART_DEFS.cargo[tier].cargo).toBe(MODEL.CARGO_PER_HOLD[tier]);
      expect(PART_DEFS.cockpit[tier].cargo).toBe(MODEL.COCKPIT_CARGO[tier]);
    }
    for (const t of [1, 2, 3, 4] as const) expect(COCKPIT_HULL_BUDGET[t]).toBe(MODEL.HULL_CAP[t]);
  });

  it('the contract income model mirrors the trip model', () => {
    for (const ring of RING_INDICES) {
      const r = MODEL.RING[ring];
      expect(RING_TRIP[ring]).toEqual({ travel: r.travel, search: r.search, hazard: r.hazard, opcost: r.opcost });
    }
    expect(TRIP_OVERHEAD).toBe(MODEL.OVERHEAD);
    expect(HUMAN_EFFICIENCY).toBe(MODEL.HUMAN_EFF);
    expect(VEIN_SKILL).toBe(MODEL.VEIN);
    // ring 1: the game mix = the model mix
    expect(averageSellPrice(1)).toBeCloseTo(avgPrice(1), 2);
  });

  it('a starter-like ship earns what the model says (same build)', () => {
    // model: cockpit T1, 1 laser T1, 2 cargo holds T1 (the starter ship)
    const build = { cockpit: 1 as const, lasers: 1, laserTier: 1 as const, holds: 2, holdTier: 1 as const };
    const ship = computeProperties(
      createGrid([
        ['cockpit', 0, 0],
        ['miningLaser', 1, 0],
        ['cargo', 0, 1],
        ['cargo', 0, -1],
      ]),
    );
    expect(miningIncome(ship, 1)).toBeCloseTo(income(build, 1).mining, 0);
  });

  it('places and Data per visit match the model (5.3, 3.2.2)', () => {
    for (const kind of POI_KINDS) {
      const m = MODEL.POI[kind];
      for (const ring of RING_INDICES) {
        expect(POI_DENSITY[kind][ring], `${kind} P${ring}`).toBe(m.dens[ring]);
        const d = DATA_REWARDS[kind];
        expect(typeof d === 'number' ? d : d[ring], `${kind} Data P${ring}`).toBe(typeof m.d === 'number' ? m.d : m.d[ring]);
      }
    }
    expect(INSTITUTE_DATA_RATE).toEqual(MODEL.INSTITUTE.rate);
  });

  it('charting Data per sector match the model (sectors 4.1, 6.4)', () => {
    for (const depth of [1, 2, 3, 4] as const) expect(REGION_GEN.charting.data[depth], `depth ${depth}`).toBe(MODEL.CHARTING.data[depth]);
    // the model's tempo keeps the extra Data small next to the POI Data (≤ +10 % in P2 after halving)
    expect(chartingPerHour(2)).toBeLessThanOrEqual(dataPerHour(2) * 0.1 + 1e-9);
  });

  it('chart sale prices match the model and stay a side income (sectors 4.2, 6.4)', () => {
    // the model's average price per depth = the game's formula for an average sector × the measured
    // security / size mix (Pirate ×1.5 on ~15–35 % of the sellable sectors): within 0.95–1.3 × the base
    for (const depth of [1, 2, 3] as const) {
      const base = CHART_PRICES.sellHours * MIN_REFERENCE_INCOME[depth];
      expect(MODEL.CHART_SALE.price[depth] / base, `depth ${depth}`).toBeGreaterThanOrEqual(0.95);
      expect(MODEL.CHART_SALE.price[depth] / base, `depth ${depth}`).toBeLessThanOrEqual(1.3);
    }
    // credits from charts while sectors last: ≤ 15 % of the income of the ship entering the ring
    // (design 6.4 item 6; the design's full price gave ~22 % in P2)
    const t1 = { cockpit: 1, lasers: 1, laserTier: 1, holds: 2, holdTier: 1 } as const;
    expect(chartCreditsPerHour(1)).toBeLessThanOrEqual(income(t1, 1).total * 0.15);
    expect(chartCreditsPerHour(2)).toBeLessThanOrEqual(income({ ...t1, lasers: 2 }, 2).total * 0.15);
  });

  it('archive key thresholds are the model thresholds and node prices lie in the fund ranges', () => {
    const thresholds = new Set(Object.values(MODEL.DATA_THRESHOLDS));
    for (const n of ARCHIVE_NODES) {
      if (n.threshold !== undefined) {
        expect(thresholds.has(n.threshold), n.id).toBe(true);
        continue;
      }
      if (n.revealedBy) continue;
      const pool = MODEL.POOL.filter((p) => p.lvl === n.level).map((p) => p.cost);
      expect(n.data, n.id).toBeGreaterThanOrEqual(Math.min(...pool));
      // level 4 has higher prices in table 3.2.4 than the fund – the upper bound with a margin
      expect(n.data, n.id).toBeLessThanOrEqual(Math.max(...pool) * (n.level === 4 ? 1.1 : 1));
    }
  });

  it('hangar slot prices are the model side goals "Hangar slot 2 / 3" (M4a)', () => {
    // the 2nd ship's slot is the first one bought, the 3rd ship's the second
    expect(HANGAR.slotPrices[0]).toBe(MODEL.HANGAR_SLOT[2]);
    expect(HANGAR.slotPrices[0]).toBe(5000);
    expect(HANGAR.slotPrices[1]).toBe(MODEL.HANGAR_SLOT[3]);
  });

  it('contract reference income minimums stay near the ship that enters the ring (no dominant contracts)', () => {
    const main = run().log.filter((e) => e.kind === 'main');
    for (const ring of RING_INDICES) {
      const entry = main.find((e) => e.ring === ring && e.b);
      const mining = income(entry!.b!, ring).mining;
      expect(MIN_REFERENCE_INCOME[ring], `P${ring}`).toBeLessThanOrEqual(mining * 1.5);
      expect(MIN_REFERENCE_INCOME[ring], `P${ring}`).toBeGreaterThanOrEqual(mining * 0.75);
    }
  });

  it('M4b world sites: densities and Data are the model POI derelict / graveyard', () => {
    for (const ring of RING_INDICES) {
      expect(SITES.derelict.density[ring], `derelict P${ring}`).toBe(MODEL.POI.derelict.dens[ring]);
      expect(SITES.graveyard.density[ring], `graveyard P${ring}`).toBe(MODEL.POI.graveyard.dens[ring]);
    }
    expect(DERELICT.data).toBe(MODEL.POI.derelict.d);
    expect(GRAVEYARD.data).toBe(MODEL.POI.graveyard.d);
    // the terminal services the model pays credits for
    expect(DERELICT.service.stash).toBe(MODEL.M4B.derelictService.stash);
    expect(DERELICT.service.fabricator).toBe(MODEL.M4B.derelictService.fabricator);
  });

  it('M4b comets: ore mix and grade are the model comet', () => {
    expect(COMET.grade).toBe(MODEL.M4B.comet.grade);
    expect(COMET.mix).toEqual({ ice: MODEL.M4B.comet.mix.ice, titanium: MODEL.M4B.comet.mix.ti });
    // the model's ambush loot counts the Hammer and the Gunner leaders with double cargo
    expect(kindLootMult('gunner')).toBe(kindLootMult('hammer'));
  });

  it('M4b keeps P2 within the overview limits: Data/h ≤ +10 %, income ≤ +8 % over the game without it', () => {
    expect(dataPerHour(2, 1) / dataPerHour(2, 0) - 1).toBeLessThanOrEqual(0.1);
    const p2 = run().log.filter((e) => e.kind === 'main' && e.ring === 2 && e.b);
    expect(p2.length).toBeGreaterThan(3);
    for (const e of p2) {
      const up = income(e.b!, 2, 1).total / income(e.b!, 2, 0).total - 1;
      expect(up, e.g.id).toBeLessThanOrEqual(0.08);
      // new sources, not a hidden sink: income does not drop either
      expect(up, e.g.id).toBeGreaterThan(-0.02);
    }
  });
  it('M4c workshop parts: specs, values and hull points are the model refinery / repair module / large reactor', () => {
    const M = MODEL.M4C;
    expect(REFINED_BONUS).toBe(M.refinedBonus);
    for (const tier of [1, 2] as const) {
      const ref = PART_DEFS.refinery[tier];
      expect(ref.refinery, `refinery T${tier}`).toEqual({ orePerSecond: M.refinery[tier].ore, icePerSecond: M.refinery[tier].ice, energyPerSecond: M.refinery[tier].energy });
      expect(sizeHullPoints(ref.size)).toBe(M.refineryHull);
      const rep = PART_DEFS.repairModule[tier];
      expect(rep.repair, `repair module T${tier}`).toEqual({ hpPerSecond: M.repair[tier].hp, energyPerSecond: M.repair[tier].energy });
      expect(sizeHullPoints(rep.size)).toBe(M.repairHull);
      const lr = PART_DEFS.largeReactor[tier];
      expect(lr.energyGen, `large reactor T${tier}`).toBe(M.largeReactor[tier].energy);
      expect(sizeHullPoints(lr.size)).toBe(M.largeReactorHull);
      expect(PART_DEFS.reactor[tier].energyGen).toBe(M.reactor[tier].energy);
      // part values (recipe resources at base prices + fee) = the model's values
      expect(partValue(partKey('largeReactor', tier))).toBe(M.largeReactor[tier].value);
      expect(partValue(partKey('refinery', tier))).toBe(M.value.refinery[tier]);
      expect(partValue(partKey('repairModule', tier))).toBe(M.value.repairModule[tier]);
    }
    // the Archive fees of the two workshop nodes (the model's side goal pays them)
    const fee = (id: string): number => ARCHIVE_NODES.find((n) => n.id === id)!.credits;
    expect(fee('refinery') + fee('repairModule')).toBe(M.archiveFees);
  });

  it('M4d W1 bound: a refined unit sells below the cheapest buy anywhere; the model refinery (rings 1–2) keeps its full bonus', () => {
    const jitters = [PRICE_JITTER_MIN, 1, PRICE_JITTER_MAX];
    for (const r of ['iron', 'copper', 'titanium'] as const) {
      const cheapest = Math.min(...RING_INDICES.flatMap((ring) => jitters.map((j) => resourcePrice(r, ring, j).buy)));
      // the ceiling is one 0.1 kr price step below the cheapest buy (iron 4.2, copper 5.8, titanium 11.2)
      expect(REFINED_CEILING[r], r).toBeCloseTo(cheapest - 0.1, 9);
      for (const ring of RING_INDICES) {
        for (const j of jitters) {
          const sell = resourcePrice(r, ring, j).sell;
          // buy anywhere → refine → sell anywhere loses at least 0.1 kr per unit
          expect(refinedUnit(r, sell), `${r} P${ring} ×${j}`).toBeLessThanOrEqual(cheapest - 0.1 + 1e-9);
          // the model's refinery income (flat REFINED_BONUS) is exact where its main path refines: rings 1–2
          if (ring <= 2) expect(refinedBonusAt(r, sell), `${r} P${ring} ×${j}`).toBeCloseTo(MODEL.M4C.refinedBonus, 9);
        }
      }
    }
  });

  it('M4c repair module: the credit share of the station repair the module saves is the recipes share', () => {
    for (const tier of [1, 2] as const) {
      let credits = 0;
      let material = 0;
      for (const key of ALL_PART_KEYS) {
        const p = parsePartKey(key);
        if (p.tier !== tier || p.variant) continue;
        const r = RECIPES[key];
        const mat = repairMaterial(key);
        credits += REPAIR_CREDIT_FACTOR * r.credits;
        material += REPAIR_MATERIAL_FACTOR * (r.resources[mat] ?? 0) * resourcePrice(mat, 1, 1).buy;
        expect(partDefOf(key).hp, key).toBeGreaterThan(0);
      }
      expect(credits / (credits + material), `T${tier}`).toBeCloseTo(MODEL.M4C.repairCreditShare[tier], 2);
    }
  });

  it('M4c home modules and variants: prices are the model side goals (13 000 kr for the paint shop + trophy hall)', () => {
    const M = MODEL.M4C;
    for (const id of HOME_MODULE_IDS) {
      expect(HOME_MODULES[id].credits, id).toBe(M.home[id].credits);
      expect(HOME_MODULES[id].resources?.titanium ?? 0, id).toBe(M.home[id].ti ?? 0);
    }
    expect(HOME_MODULE_IDS.filter(isBuildableModule)).toEqual(['paintShop', 'trophyHall']);
    expect(M.home.paintShop.credits + M.home.trophyHall.credits).toBe(13_000);
    // the side goal "3 variants" ≈ three T2 plan variant parts (value incl. the ×1.3 fee), with a margin for the plans
    expect(VARIANT_FEE_MULT).toBe(M.variantFeeMult);
    const t2 = PLAN_VARIANTS.map((v) => partValue(partKey(VARIANTS[v].base, 2, v)));
    const three = (3 * t2.reduce((a, b) => a + b, 0)) / t2.length;
    expect(M.variantsSide).toBeGreaterThanOrEqual(three * 0.9);
    expect(M.variantsSide).toBeLessThanOrEqual(three * 1.4);
  });

  it('M4c workshop stays a side build: P2 income ≤ +12 % and the refinery never beats 2 more holds', () => {
    const main = run().log.filter((e) => e.kind === 'main' && (e.ring === 2 || e.ring === 3) && e.b);
    expect(main.length).toBeGreaterThan(8);
    for (const e of main) {
      const w = workshopIncome(e.b!, e.ring!, 1, 1);
      if (e.ring === 2) expect(w.total / w.base - 1, e.g.id).toBeLessThanOrEqual(0.12);
      expect(w.refinery, e.g.id).toBeGreaterThanOrEqual(0);
      // "not dominant": the refinery's 2 hull points earn less than the same 2 points of cargo
      expect(w.base + refineryCredits(e.b!, e.ring!, 1, 1, 1), e.g.id).toBeLessThan(cargoIncome(e.b!, e.ring!));
    }
    // the large reactor: denser energy than the reactor (the blast is its price), but not more than 2.5×
    const M = MODEL.M4C;
    for (const tier of [1, 2] as const) {
      const ratio = M.largeReactor[tier].energy / M.largeReactorHull / M.reactor[tier].energy;
      expect(ratio).toBeGreaterThan(1.2);
      expect(ratio).toBeLessThanOrEqual(2.5);
    }
  });

  it('M4d convoy, escort and relay data are the model M4D (src/data/convoys.ts, guild.ts, contracts.ts, economy.ts)', () => {
    const M = MODEL.M4D;
    expect(CONVOY.sellMult).toBe(M.convoy.sellMult);
    expect(CONVOY.buyCap).toBe(M.convoy.buyCap);
    expect(CONVOY.fuelMult).toBe(M.convoy.fuelMult);
    expect(CONVOY.fuelCap).toBe(M.convoy.fuelCap);
    expect(CONVOY.fragmentPrice).toEqual(M.convoy.fragmentPrice);
    expect(CONVOY.rareMarkup).toBe(M.convoy.rareMarkup);
    expect(CONVOY.periodTicks).toBe(M.convoy.periodMinutes * 60 * 60);
    expect(ESCORT.deposit).toBe(M.escort.deposit);
    expect(CONTRACT_DEFS.escort.k).toBe(M.escort.k);
    expect(CONTRACT_DEFS.escort.weight).toBe(M.escort.weight);
    expect(CONTRACT_DEFS.relay.k).toBe(M.relay.k);
    expect(CONTRACT_DEFS.relay.weight).toBe(0);
    expect(RELAY_CHAIN.risk).toBe(M.relay.risk);
    expect(RELAY_CHAIN.repair).toEqual({ iron: M.relay.repair.fe, copper: M.relay.repair.cu, titanium: M.relay.repair.ti });
    for (const ring of RING_INDICES) {
      expect(MIN_REFERENCE_INCOME[ring], `P${ring}`).toBe(M.minRef[ring]);
      expect(RING_SERVICE_MULT[ring], `P${ring}`).toBe(M.serviceMult[ring]);
      expect(RING_PART_MULT[ring], `P${ring}`).toBe(M.partRingMult[ring]);
    }
    expect(FUEL_BASE_PRICE).toBe(M.fuelBase);
    expect(PART_BUY_MARKUP).toBe(M.partBuy);
    expect(PART_SELL_FACTOR).toBe(M.partSell);
    // the escort deposit is 10 % of the frozen reward; the escort pays k × (1 + risk) per estimated hour
    expect(escortDepositOf(12_345)).toBe(Math.round(12_345 * M.escort.deposit));
    expect(escortRate(0.5)).toBeCloseTo(M.escort.k * 1.5, 9);
    // the escort duration estimate: to the meeting point at the cruise speed, the stretch at the convoy speed and
    // `ambushShips` × the hunt time per ambush (a P2 pilot's convoy stood still a median 77 s per ambush, seeds 1–10)
    const t = { kind: 'escort' as const, lane: 'A' as LaneId, from: 1000, to: 3500, meet: { x: 3000, y: 4000 }, end: { x: 0, y: 0 }, ambushes: [1500, 3000] };
    const est = escortSeconds({ x: 0, y: 0 }, t);
    expect(est).toBeCloseTo(5000 / CRUISE_SPEED + 2500 / ESCORT.speed + 2 * M.escort.ambushShips * HUNT_SECONDS_PER_ENEMY, 6);
    expect(M.escort.ambushShips * HUNT_SECONDS_PER_ENEMY).toBeGreaterThanOrEqual(1.0 * 77);
    expect(M.escort.ambushShips * HUNT_SECONDS_PER_ENEMY).toBeLessThanOrEqual(1.6 * 77);
  });

  it('M4d relay contract: the model reward is the game formula; the duration estimate of seeds 1–5 is the model one', () => {
    const b = { cockpit: 1, lasers: 3, laserTier: 2, holds: 5, holdTier: 1 } as const;
    const ref = refIncome(b, 2);
    expect(ref).toBeGreaterThanOrEqual(MIN_REFERENCE_INCOME[2]);
    expect(Math.abs(relayReward(b) - contractReward({ type: 'relay', seconds: MODEL.M4D.relay.seconds, risk: RELAY_CHAIN.risk, bonus: 0, refIncome: ref }))).toBeLessThanOrEqual(5);
    // the estimate from the nearest station within the offer range: overhead + round trip + 30 + 6 + 3 × 75 s
    const secs: number[] = [];
    const reach = Math.ceil((4000 + RELAY_CHAIN.offerRange) / CHUNK_SIZE);
    for (let seed = 1; seed <= 5; seed++) {
      const stations = stationsInArea(seed, -reach, reach, -reach, reach);
      for (const site of guildRelaySites(seed)) {
        expect(site.depth, `seed ${seed} ${site.lane}`).toBe(MODEL.M4D.relay.ring);
        const t = { kind: 'relay' as const, lane: site.lane, relay: site.id, sector: site.sector, pos: site.pos };
        const near = stations
          .map((st) => ({ st, d: Math.hypot(st.pos.x - site.pos.x, st.pos.y - site.pos.y) }))
          .filter((x) => x.d <= RELAY_CHAIN.offerRange)
          .sort((x, y) => x.d - y.d)[0];
        expect(near, `seed ${seed} ${site.lane}: a station in the offer range`).toBeDefined();
        const s = CONTRACT_OVERHEAD_SECONDS + relaySeconds(near!.st.pos, t);
        expect(s - CONTRACT_OVERHEAD_SECONDS - (2 * near!.d) / CRUISE_SPEED).toBeCloseTo(30 + RELAY_CHAIN.counterattackDelay + 3 * HUNT_SECONDS_PER_ENEMY, 6);
        secs.push(s);
      }
    }
    secs.sort((x, y) => x - y);
    const median = secs[Math.floor(secs.length / 2)]!;
    expect(median / MODEL.M4D.relay.seconds).toBeGreaterThan(0.8);
    expect(median / MODEL.M4D.relay.seconds).toBeLessThan(1.25);
  });

  it('M4d convoy bounds 1–5 (plan §2.6): no resource for sale, cargo ≤ 0.9 × the station, parts ≥ 1.2 × the market, fuel 1.5 ×, rings 1–3', () => {
    const SEED = 3;
    const sim = new Simulation({ seed: SEED });
    const jitters = [PRICE_JITTER_MIN, 1, PRICE_JITTER_MAX];
    // 5. convoys fly rings 1–3 only: every route point of seeds 1–20 lies in ring ≤ 3
    expect(CONVOY_RINGS).toEqual([1, 2, 3]);
    for (let seed = 1; seed <= 20; seed++) {
      for (const route of convoyRoutes(seed)) for (const p of route.points) expect(ringIndexAt(Math.hypot(p.x, p.y)), `seed ${seed} ${route.lane}`).toBeLessThanOrEqual(3);
    }
    // 2. the cargo sale: ≤ 0.9 × the station sale of the ring (jitter 1.0), refined units under the ceiling – any buy
    //    (anywhere, any jitter) → convoy sale loses, and a refined unit never sells above the station's refined price
    for (const ring of CONVOY_RINGS) {
      for (const r of RESOURCE_IDS) {
        const unit = convoySellUnit(r, ring);
        expect(unit, `${r} P${ring}`).toBeLessThanOrEqual(MODEL.M4D.convoy.sellMult * resourcePrice(r, ring, 1).sell + 1e-9);
        const cheapest = Math.min(...RING_INDICES.flatMap((q) => jitters.map((j) => resourcePrice(r, q, j).buy)));
        expect(refinedUnit(r, unit), `${r} P${ring} refined`).toBeLessThan(cheapest);
        expect(refinedUnit(r, unit), `${r} P${ring} refined vs station refined`).toBeLessThanOrEqual(refinedUnit(r, resourcePrice(r, ring, 1).sell) + 1e-9);
      }
      // 4. fuel cannot be resold; the tanker asks 1.5 × the station
      expect(convoyFuelUnit(ring)).toBeCloseTo(MODEL.M4D.convoy.fuelMult * fuelUnitPrice(ring), 9);
      expect(convoySaleLoss(ring)).toBeGreaterThan(0);
    }
    // 1., 3., 4. the rare items of real passes with the trader in rings 1, 2 and 3 (an offer preview at that tick)
    const seen = new Set<number>();
    for (const lane of ['A', 'B'] as LaneId[]) {
      for (let n = 1; n <= 2; n++) {
        const pass = `cv:${lane}@${n}`;
        for (let s = 0; s < 3 * 3600; s += 120) {
          const tick = departureTick(lane, n) + s * 60;
          if (!convoyAt(SEED, pass, tick)) continue;
          sim.state.tick = tick;
          const offer = convoyOffer(sim.state, pass);
          if (!offer) continue;
          seen.add(offer.ring);
          for (const item of offer.items) {
            // 1. no raw resources for sale – plan fragments and parts only
            expect(['fragment', 'part'], pass).toContain(item.kind);
            if (item.kind === 'fragment') {
              expect(item.price).toBe(MODEL.M4D.convoy.fragmentPrice[offer.ring as 1 | 2 | 3]);
              continue;
            }
            // 3. a part at a convoy costs ≥ 1.2 × the market price (variants: the market formula; a T2 part in ring 1:
            //    the ring-2 market) and the station buys it back at 0.4 × its value – a loss
            const market = partBuyPrice(item.key, offer.ring) ?? partBuyPrice(item.key, 2) ?? partValue(item.key) * PART_BUY_MARKUP * RING_PART_MULT[offer.ring];
            expect(item.price, `${pass} ${item.key}`).toBeGreaterThanOrEqual(MODEL.M4D.convoy.rareMarkup * market - 5);
            expect(partSellPrice(item.key), `${pass} ${item.key}`).toBeLessThan(item.price);
          }
        }
      }
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });
});
