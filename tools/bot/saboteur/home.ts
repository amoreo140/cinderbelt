// Saboteur probes for M4c "Home and Workshop" (task T13): the
// on-board refinery (refined ore +15 % from the ship only), the repair module (Fe / Ti from the cargo, no
// credits, a saved HP bank), the large reactor's blast, the home modules, paints and trophies. Each probe plays
// the real simulation through station actions and flight (and the crafted actions a modified client could send)
// and must gain nothing: no refined bonus on ore that was not refined in flight, no bonus twice, no refined ore
// off the ship, no repair from station storage or from a crafted bank, no loot from a blast, no module, paint
// or pin past its rules. Setup steps that would take hours of play (a rich player, the Data of the Archive
// nodes, defeated captains) are written directly, like the fleet and shape probes; every gain is measured
// after the setup, through real actions.
import { archiveNode, type ArchiveNodeId } from '../../../src/data/archive';
import { purchaseCost, RECIPES, repairCost, resourcePrice, saleValue, type RingIndex } from '../../../src/data/economy';
import { HOME_MODULE_IDS, HOME_MODULES, isBuildableModule, TROPHY_PEDESTALS } from '../../../src/data/home';
import { PAINT_IDS } from '../../../src/data/paints';
import type { PartKey } from '../../../src/data/parts';
import { RESOURCE_IDS, type ResourceId } from '../../../src/data/resources';
import { DEMAND_BONUS, SECTOR_EPOCH_TICKS } from '../../../src/data/sector';
import { CUT_BLAST } from '../../../src/data/salvage';
import { REFINED_BONUS } from '../../../src/data/workshop';
import type { Contract } from '../../../src/sim/career/types';
import { gridToWorld } from '../../../src/sim/combat/geometry';
import { IDLE_COMMAND } from '../../../src/sim/commands';
import { captainDefs } from '../../../src/sim/captains/captains';
import { fortressStatus } from '../../../src/sim/pirates/fortress';
import { fortressSites } from '../../../src/sim/pirates/sites';
import { loadSave } from '../../../src/sim/save/load';
import { restoreSimulation, toEnvelope, toSave } from '../../../src/sim/save/serialize';
import { demandOf, sectorAt, sectorEpoch } from '../../../src/sim/sector/sector';
import { stationDemand } from '../../../src/sim/sector/market';
import { partCells, partCenter } from '../../../src/sim/ship/grid';
import { currentHp, maxHp } from '../../../src/sim/ship/hp';
import type { PlacedPart } from '../../../src/sim/ship/types';
import { REFINE_ORDER, refinedUnit, repairMaterialPerHp, shipSaleValue } from '../../../src/sim/ship/workshop';
import type { SimEvent } from '../../../src/sim/Simulation';
import { stationStorage } from '../../../src/sim/station/storage';
import { CHUNK_SIZE } from '../../../src/sim/world/chunks';
import { guaranteedStationChunks, HOME_STATION_ID, homeStation, stationAt, stationsInArea, type StationDef } from '../../../src/sim/world/stations';
import { homeSellPrice } from '../pilot';
import { ownedParts, partsDiff } from './fleet';
import { cloneSim, Driver, newGame, TPS } from './harness';
import { salvageNearestWreck, type LoopResult } from './scenarios';
import { netWorth } from './value';

/** Tolerance of the credit / net-worth comparisons (credits are integers, resources may be fractional). */
const EPS = 1;
const ORES: readonly ResourceId[] = ['iron', 'copper', 'titanium'];
const sum = (xs: Iterable<number>): number => {
  let s = 0;
  for (const x of xs) s += x;
  return s;
};
const r1 = (x: number): string => (Math.round(x * 10) / 10).toString();

// ------------------------------------------------------------------------------------------------
// helpers

/** A new game docked at home with `credits` more credits (setup: hours of mining skipped). */
function richGame(seed: number, credits: number): Driver {
  const d = new Driver(newGame(seed, 'mild'));
  d.state.credits += credits;
  return d;
}

const result = (id: string, seed: number, d: Driver, gain: number, broken: string[], detail: string, metrics: Record<string, number>): LoopResult => ({
  id,
  seed,
  penalty: 'mild',
  seconds: d.state.tick / TPS,
  gain,
  perHour: 0,
  baselinePerHour: null,
  help: {},
  exploit: broken.length > 0 || gain > EPS,
  tick: broken.length ? d.state.tick : null,
  detail: broken.length ? `BROKEN: ${broken.join('; ')} – ${detail}` : detail,
  metrics,
});

/** Archive nodes bought with real actions; their Data are written into the fund first (setup). */
function unlockNodes(d: Driver, nodes: readonly ArchiveNodeId[], broken: string[]): void {
  const data = sum(nodes.map((n) => archiveNode(n).data));
  d.state.discovery.dataFund += data;
  d.state.discovery.dataTotal += data;
  for (const n of nodes) {
    if (d.state.discovery.archive.has(n)) continue;
    const r = d.attempt({ type: 'archiveBuy', node: n });
    if (!r.ok) broken.push(`setup: Archive node ${n} refused (${r.reason})`);
  }
}
const REFINERY_NODES: readonly ArchiveNodeId[] = ['battery', 'refinery'];
const REPAIR_NODES: readonly ArchiveNodeId[] = ['largeCargo', 'repairModule'];
const REACTOR_NODES: readonly ArchiveNodeId[] = ['largeCargo', 'largeReactor'];

/** Buys the recipe resources the docked station's storage + cargo lack for `key` (setup for a craft). */
function buyRecipe(d: Driver, key: PartKey): void {
  const st = d.docked()!;
  const have = stationStorage(d.state, st.id).resources;
  for (const r of RESOURCE_IDS) {
    const short = Math.ceil((RECIPES[key].resources[r] ?? 0) - have[r] - d.state.player.cargo[r] - 1e-6);
    if (short > 0) d.act({ type: 'buyResource', resource: r, qty: short });
  }
}

/** Mounts `key` at `at` (or the best free cell), crafted by the shipyard from bought resources; the part or null. */
function mount(d: Driver, key: PartKey, at?: { x: number; y: number }): PlacedPart | null {
  buyRecipe(d, key);
  const next = d.state.player.grid.nextId;
  if (!d.placePart(key, 0, at)) return null;
  return d.state.player.grid.parts.find((p) => p.id >= next) ?? null;
}

/** Free cells around the hull with how many parts each one touches (by edge). */
function freeCells(d: Driver): { x: number; y: number; touches: PlacedPart[] }[] {
  const grid = d.state.player.grid;
  const owner = new Map<string, PlacedPart>();
  for (const p of grid.parts) for (const c of partCells(p)) owner.set(`${c.x},${c.y}`, p);
  const out = new Map<string, { x: number; y: number; touches: PlacedPart[] }>();
  for (const p of grid.parts) {
    for (const c of partCells(p)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = `${c.x + dx},${c.y + dy}`;
        if (owner.has(k) || out.has(k)) continue;
        const x = c.x + dx;
        const y = c.y + dy;
        const touches = new Set<PlacedPart>();
        for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const o = owner.get(`${x + ex},${y + ey}`);
          if (o) touches.add(o);
        }
        out.set(k, { x, y, touches: [...touches] });
      }
    }
  }
  return [...out.values()];
}

/**
 * Undocks, parks ~170 u out and idles in flight until `done` or `seconds` (the workshop works in flight only);
 * `watch` runs before every step from the undock on.
 */
function flyAndIdle(d: Driver, done: () => boolean, seconds: number, watch: () => void = () => {}): void {
  const st = d.docked();
  d.undock();
  const stopped = (): boolean => Math.hypot(d.state.player.body.vel.x, d.state.player.body.vel.y) < 0.5;
  if (st) d.flyTo({ x: st.pos.x + 160, y: st.pos.y + 60 }, { seconds: 40, until: () => (watch(), false) });
  d.idleUntil(() => (watch(), stopped()), 10);
  d.idleUntil(() => (watch(), done()), seconds);
}

const unrefined = (d: Driver): number => sum(ORES.map((r) => Math.max(0, d.state.player.cargo[r] - d.state.player.refined[r])));

/** The two guaranteed stations of the seed (G1 in ring 1 at 900–1200 u, G2 in ring 2). */
function guaranteed(d: Driver): StationDef[] {
  return guaranteedStationChunks(d.state.seed)
    .map((c) => stationAt(d.state.seed, c.cx, c.cy, d.state.world.gen))
    .filter((s): s is StationDef => !!s);
}

/** Sells `r` from the ship (all) and returns the credits, the refined units sold and the demand units. */
function sellShip(d: Driver, r: ResourceId): { credits: number; refined: number; qty: number; raw: number; expected: number; demand: number } {
  const st = d.docked()!;
  const qty = d.state.player.cargo[r];
  const refined = Math.min(qty, d.state.player.refined[r]);
  const unit = resourcePrice(r, st.ring, st.priceJitter[r]).sell;
  const info = stationDemand(d.state, st);
  const demand = info && info.resource === r ? Math.min(qty, info.left) : 0;
  const raw = demand > 0 ? saleValue(demand, unit * (1 + DEMAND_BONUS)) + saleValue(qty - demand, unit) : saleValue(qty, unit);
  const expected = shipSaleValue(r, qty, refined, demand, unit);
  const before = d.state.credits;
  d.act({ type: 'sellResource', resource: r, qty: 'all', from: 'ship' });
  return { credits: d.state.credits - before, refined, qty, raw, expected, demand };
}

// ------------------------------------------------------------------------------------------------
// W1 – refine arbitrage: buy ore at station A, refine it in flight, sell it at station B – between the home
// station and the guaranteed station G1 (both legs), and at a station with an active sector demand (the
// refined bonus never stacks with it). Plus the survey of every station of rings 1–4 (`refineSurvey`).

export function refineArbitrage(seed: number): LoopResult {
  const broken: string[] = [];
  const d = richGame(seed, 40_000);
  unlockNodes(d, REFINERY_NODES, broken);
  const ref = mount(d, 'refinery:1');
  if (!ref) broken.push('setup: refinery not mounted');
  const home = homeStation();
  const [g1] = guaranteed(d);
  const legs: string[] = [];
  let worst = -Infinity;
  let refinedUnits = 0;
  let stacked = 0;
  const QTY = 40;
  /** Buys QTY of each ore here, refines in flight, docks at `to` and sells; the margin (credits − cost). */
  const leg = (to: StationDef, label: string, resources: readonly ResourceId[] = ORES): void => {
    const st = d.docked();
    if (!st) {
      broken.push(`${label}: not docked`);
      return;
    }
    let cost = 0;
    for (const r of resources) {
      const unit = resourcePrice(r, st.ring, st.priceJitter[r]).buy;
      const c0 = d.state.credits;
      d.act({ type: 'buyResource', resource: r, qty: QTY }, { type: 'transfer', resource: r, qty: QTY, to: 'ship' });
      cost += c0 - d.state.credits;
      if (Math.abs(c0 - d.state.credits - purchaseCost(QTY, unit)) > EPS) broken.push(`${label}: ${r} cost ${c0 - d.state.credits} ≠ ${purchaseCost(QTY, unit)}`);
    }
    d.act({ type: 'refuel', source: 'credits', amount: 'full' });
    flyAndIdle(d, () => unrefined(d) < 1e-6, 400);
    const done = sum(resources.map((r) => d.state.player.refined[r]));
    refinedUnits += done;
    if (!d.dockAt(to, 400)) {
      broken.push(`${label}: could not dock at ${to.id}`);
      return;
    }
    let got = 0;
    for (const r of resources) {
      const s = sellShip(d, r);
      got += s.credits;
      if (Math.abs(s.credits - s.expected) > EPS) broken.push(`${label}: ${r} paid ${s.credits}, the sale rule says ${s.expected}`);
      // never more than max(demand, refined) per unit: the bonuses do not stack
      const cap = Math.floor(s.qty * resourcePrice(r, to.ring, to.priceJitter[r]).sell * (1 + Math.max(DEMAND_BONUS, REFINED_BONUS)) + 1e-9);
      if (s.credits > cap + EPS) broken.push(`${label}: ${r} paid ${s.credits} > ${cap} (stacked bonuses)`);
      if (s.demand > 0) stacked += Math.max(0, s.credits - s.raw - Math.max(0, s.refined - s.demand) * resourcePrice(r, to.ring, to.priceJitter[r]).sell * REFINED_BONUS - EPS);
    }
    const margin = got - cost;
    worst = Math.max(worst, margin);
    legs.push(`${label}: bought ${resources.length * QTY} u for ${cost} kr, ${r1(done)} u refined, sold for ${got} kr (${margin >= 0 ? '+' : ''}${margin} kr)`);
  };
  if (ref && g1) {
    leg(g1, `home → ${g1.id}`);
    leg(home, `${g1.id} → home`);
  } else if (!g1) broken.push('no guaranteed station G1');

  // with a sector demand: the first epoch (≤ 2 h ahead) in which home or G1 wants an ore
  let demandNote = 'no ore demand at home or G1 within 2 h';
  const candidates = [home, ...(g1 ? [g1] : [])];
  let found: { st: StationDef; epoch: number; r: ResourceId } | null = null;
  const e0 = sectorEpoch(d.state.tick);
  for (let e = e0; e <= e0 + 4 && !found; e++) {
    for (const st of candidates) {
      const r = demandOf(sectorAt(d.state.seed, st.pos, Math.max(d.state.tick, e * SECTOR_EPOCH_TICKS)));
      if (r && ORES.includes(r)) {
        found = { st, epoch: e, r };
        break;
      }
    }
  }
  if (found && ref && g1) {
    const from = found.st.id === HOME_STATION_ID ? g1 : home;
    d.act({ type: 'refuel', source: 'credits', amount: 'full' });
    if (d.docked()?.id !== from.id) {
      d.undock();
      d.dockAt(from, 400);
    }
    demandNote = `demand for ${found.r} at ${found.st.id} in epoch ${found.epoch}, but the probe could not dock at ${from.id}`;
    // wait docked until the demand epoch starts (minus the refining flight)
    const startTick = found.epoch * SECTOR_EPOCH_TICKS;
    if (d.state.tick < startTick - 600 * TPS) d.idle((startTick - 600 * TPS - d.state.tick) / TPS);
    if (d.docked()?.id === from.id) {
      leg(found.st, `${from.id} → ${found.st.id} (demand ${found.r})`, [found.r]);
      demandNote = `demand for ${found.r} at ${found.st.id} in epoch ${found.epoch}`;
    }
  }
  return result(
    'refineArbitrage',
    seed,
    d,
    worst,
    broken,
    `${legs.join('; ') || 'no leg'}; ${demandNote} – refined ≤ 0.92 × base per unit at the same ring multiplier, the demand units sell at the demand price and the refined bonus covers only the rest (stacked bonus credits ${Math.round(stacked)})`,
    { refined: Math.round(refinedUnits), legs: legs.length, worstMargin: worst, stacked: Math.round(stacked), demand: legs.length > 2 ? 1 : 0 },
  );
}

export interface SurveyRow {
  resource: ResourceId;
  buyAt: string;
  buyRing: RingIndex;
  buy: number;
  sellAt: string;
  sellRing: RingIndex;
  /** Refined sale price per unit (`refinedUnit`: sell × 1.15 under the W1 ceiling). */
  refined: number;
  margin: number;
  distance: number;
}

/**
 * Every station of rings 1–4 within `radius` of home: the best buy → refine → sell margin per resource (the
 * cheapest buy, the dearest refined sale) and the closest pair with a positive margin. Without a refinery no
 * pair gains (sell × 0.8 vs buy × 1.25 at most ×1.3 / ×0.9 ring multipliers and ±5 % jitter); the refined
 * bonus is the only thing that could turn a ring spread into a margin – the W1 ceiling (`REFINED_CEILING`, M4d)
 * keeps every refined price below the cheapest buy anywhere, so no pair gains.
 */
export function refineSurveyRows(seed: number, gen: Driver['state']['world']['gen'], radius = 9000): { best: SurveyRow[]; closest: SurveyRow[]; stations: number } {
  const c = Math.ceil(radius / CHUNK_SIZE);
  const stations = stationsInArea(seed, -c, c, -c, c, gen).filter((s) => Math.hypot(s.pos.x, s.pos.y) <= radius);
  const best: SurveyRow[] = [];
  const closest: SurveyRow[] = [];
  for (const r of REFINE_ORDER) {
    const rows = stations.map((s) => {
      const p = resourcePrice(r, s.ring, s.priceJitter[r]);
      return { s, buy: p.buy, refined: Math.floor(refinedUnit(r, p.sell) * 1000 + 1e-9) / 1000 };
    });
    const buyer = rows.reduce((a, b) => (b.buy < a.buy ? b : a));
    const seller = rows.reduce((a, b) => (b.refined > a.refined ? b : a));
    const row = (a: (typeof rows)[number], b: (typeof rows)[number]): SurveyRow => ({
      resource: r,
      buyAt: a.s.id,
      buyRing: a.s.ring,
      buy: a.buy,
      sellAt: b.s.id,
      sellRing: b.s.ring,
      refined: b.refined,
      margin: Math.round((b.refined - a.buy) * 1000) / 1000,
      distance: Math.round(Math.hypot(a.s.pos.x - b.s.pos.x, a.s.pos.y - b.s.pos.y)),
    });
    best.push(row(buyer, seller));
    // the closest positive pair (a player would take the shortest route)
    let near: SurveyRow | null = null;
    const sellers = rows.filter((x) => x.refined > buyer.buy - 1e-9).sort((a, b) => b.refined - a.refined).slice(0, 60);
    const buyers = rows.filter((x) => x.buy < seller.refined + 1e-9).sort((a, b) => a.buy - b.buy).slice(0, 60);
    for (const a of buyers) {
      for (const b of sellers) {
        if (b.refined - a.buy <= 1e-9) continue;
        const cand = row(a, b);
        if (!near || cand.distance < near.distance) near = cand;
      }
    }
    if (near) closest.push(near);
  }
  return { best, closest, stations: stations.length };
}

export function refineSurvey(seed: number): LoopResult {
  const d = new Driver(newGame(seed, 'mild'));
  const { best, closest, stations } = refineSurveyRows(seed, d.state.world.gen);
  const top = best.reduce((a, b) => (b.margin > a.margin ? b : a));
  // a cycle with the T2 hauler of the main path (refitT2b: cockpit 15 + 8 holds × 90 = 735 u) and one T2
  // refinery (0.9 u/s): the hold refines in ~14 min of flight; the margin of the closest positive pair
  const hold = 735;
  const near = closest.length ? closest.reduce((a, b) => (b.margin * hold > a.margin * hold ? b : a)) : null;
  const perCycle = near ? Math.round(near.margin * hold) : 0;
  // round trip at ~50 u/s cruise, at least the refining time of the hold
  const cycleH = near ? Math.max((2 * near.distance) / 50, hold / 0.9) / 3600 : 0;
  const detail =
    `${stations} stations within 9 000 u; best buy → refine → sell per unit: ${best.map((b) => `${b.resource} ${b.buyAt} (P${b.buyRing}) ${b.buy} → ${b.sellAt} (P${b.sellRing}) ${r1(b.refined)} = ${b.margin >= 0 ? '+' : ''}${b.margin.toFixed(2)} kr/u (${b.distance} u)`).join('; ')}` +
    (near
      ? `; closest positive pair ${near.resource} ${near.buyAt} (P${near.buyRing}) → ${near.sellAt} (P${near.sellRing}) +${near.margin.toFixed(2)} kr/u, ${near.distance} u apart: ${perCycle} kr per 735 u hold, ≈ ${Math.round(perCycle / Math.max(1e-9, cycleH))} kr/h before fuel`
      : '; no pair gains');
  return {
    id: 'refineSurvey',
    seed,
    penalty: 'mild',
    seconds: 0,
    gain: top.margin,
    perHour: near ? perCycle / Math.max(1e-9, cycleH) : 0,
    baselinePerHour: null,
    help: {},
    // a positive margin would be finding W1 again (closed in M4d by the refined price ceiling)
    exploit: top.margin > 1e-9,
    tick: null,
    detail,
    metrics: {
      stations,
      bestMargin: top.margin,
      positivePairs: closest.length,
      perCycle,
      nearDistance: near?.distance ?? 0,
      ...Object.fromEntries(best.map((b) => [`margin:${b.resource}`, b.margin])),
    },
  };
}

// ------------------------------------------------------------------------------------------------
// W2 – refined ore off the ship: transfer to storage and back (also within one step), the swap trick (sell the
// refined units from storage, buy fresh ones, back to the ship in one step), a ship switch in the hangar, the
// courier, a delivery contract. Ledger: the bonus credits ≤ the units refined in flight × price × 15 %.

export function refinedCarry(seed: number): LoopResult {
  const broken: string[] = [];
  const d = richGame(seed, 60_000);
  unlockNodes(d, REFINERY_NODES, broken);
  if (!mount(d, 'refinery:1')) broken.push('setup: refinery not mounted');
  const p = d.state.player;
  // the courier needs Guild level 2 (setup)
  d.state.career.rep.guild.level = 2;
  d.state.career.rep.guild.points = Math.max(d.state.career.rep.guild.points, 250);
  // 60 Fe + 60 Cu bought (the starter hold takes 130 u), refined in flight
  for (const r of ['iron', 'copper'] as const) if (stationStorage(d.state, HOME_STATION_ID).resources[r] > 0) d.act({ type: 'sellResource', resource: r, qty: 'all', from: 'storage' });
  d.act({ type: 'buyResource', resource: 'iron', qty: 60 }, { type: 'buyResource', resource: 'copper', qty: 60 });
  d.act({ type: 'transfer', resource: 'iron', qty: 60, to: 'ship' }, { type: 'transfer', resource: 'copper', qty: 60, to: 'ship' });
  let produced = 0;
  const before0 = p.refined.iron + p.refined.copper;
  flyAndIdle(d, () => unrefined(d) < 1e-6, 450);
  produced += p.refined.iron + p.refined.copper - before0;
  const home = homeStation();
  if (!d.dockAt(home, 300)) broken.push('could not dock at home');
  const notes: string[] = [];
  const grew = (label: string, beforeSum: number): void => {
    const now = sum(RESOURCE_IDS.map((r) => p.refined[r]));
    if (now > beforeSum + 1e-6) broken.push(`${label}: refined grew ${r1(beforeSum)} → ${r1(now)}`);
    for (const r of RESOURCE_IDS) if (p.refined[r] > p.cargo[r] + 1e-6) broken.push(`${label}: refined ${r} ${p.refined[r]} > cargo ${p.cargo[r]}`);
  };
  const refinedNow = (): number => sum(RESOURCE_IDS.map((r) => p.refined[r]));
  // (1) transfer 30 Fe to storage and back in two steps – the units that come back are raw
  let s0 = refinedNow();
  const fe0 = p.refined.iron;
  d.act({ type: 'transfer', resource: 'iron', qty: 30, to: 'storage' });
  const afterOut = p.refined.iron;
  d.act({ type: 'transfer', resource: 'iron', qty: 30, to: 'ship' });
  grew('transfer out / back', s0);
  if (p.refined.iron > afterOut + 1e-6) broken.push('units back from storage came back refined');
  notes.push(`transfer 30 Fe out and back: refined Fe ${r1(fe0)} → ${r1(afterOut)} → ${r1(p.refined.iron)}`);
  // (2) the same in ONE step (the clamp runs after every action): the units come back raw as well
  s0 = refinedNow();
  const cu0 = p.refined.copper;
  d.act({ type: 'transfer', resource: 'copper', qty: 30, to: 'storage' }, { type: 'transfer', resource: 'copper', qty: 30, to: 'ship' });
  const sameStep = p.refined.copper;
  grew('one-step transfer', s0);
  if (sameStep > Math.max(0, cu0 - 30) + 1e-6) broken.push(`out and back in one step: refined Cu ${r1(cu0)} → ${r1(sameStep)} (kept through storage)`);
  notes.push(`out and back in one step: refined Cu ${r1(sameStep)}`);
  // (3) the swap trick in one step: the refined Cu sold from storage (raw price), fresh Cu bought and loaded –
  // the refined count moves onto the bought units: net = buy/sell spread, never a gain over selling directly
  s0 = refinedNow();
  const c3 = d.state.credits;
  d.act(
    { type: 'transfer', resource: 'copper', qty: 60, to: 'storage' },
    { type: 'sellResource', resource: 'copper', qty: 60, from: 'storage' },
    { type: 'buyResource', resource: 'copper', qty: 60 },
    { type: 'transfer', resource: 'copper', qty: 60, to: 'ship' },
  );
  const swapCost = c3 - d.state.credits;
  grew('swap trick', s0);
  notes.push(`swap trick (refined Cu sold from storage, 60 Cu bought and loaded in one step): −${swapCost} kr, refined Cu ${r1(p.refined.copper)}`);
  // (4) the hangar: park the refinery ship (new cockpit ship), switch back – twice
  const parkedId = d.state.fleet.active.id;
  const cargoBefore = { ...p.cargo };
  s0 = refinedNow();
  if (!d.act({ type: 'hangarBuySlot' })) broken.push('setup: hangar slot refused');
  let switches = 0;
  for (let i = 0; i < 2; i++) {
    const otherId = d.state.fleet.stored.length ? d.state.fleet.stored[0]!.record.id : null;
    const r = otherId === null ? d.attempt({ type: 'hangarNewShip', cockpit: 'cockpit:1', acquire: 'buy' }) : d.attempt({ type: 'hangarSwitch', shipId: otherId });
    if (!r.ok) broken.push(`hangar step ${i}: ${r.reason}`);
    // now the refinery ship is parked: the active ship has none of its refined ore
    if (d.state.player.grid.parts.every((x) => x.partId !== 'refinery') && refinedNow() > 1e-6) broken.push('the parked ship\'s refined ore is on the new ship');
    const back = d.attempt({ type: 'hangarSwitch', shipId: parkedId });
    if (!back.ok) broken.push(`switch back ${i}: ${back.reason}`);
    else switches += 2;
  }
  grew('hangar switches', s0);
  if (RESOURCE_IDS.some((r) => Math.abs(p.cargo[r] - cargoBefore[r]) > 1e-6)) broken.push('cargo changed over the switches');
  notes.push(`hangar: ${switches} switches, refined ${r1(s0)} → ${r1(refinedNow())}`);
  // (5) courier: the refined Fe moved to storage and couriered to G1 – storage and shipments hold raw ore only
  const [g1] = guaranteed(d);
  let couriered = 0;
  if (g1) {
    d.state.world.discovered.add(g1.id);
    s0 = refinedNow();
    d.act({ type: 'transfer', resource: 'iron', qty: 20, to: 'storage' });
    const r = d.attempt({ type: 'courierSend', from: HOME_STATION_ID, to: g1.id, resources: { iron: 20 }, parts: {} });
    if (r.ok) couriered = 20;
    else notes.push(`courier refused (${r.reason})`);
    const sh = d.state.career.shipments.at(-1);
    if (sh && 'refined' in (sh as object)) broken.push('a shipment carries refined ore');
    grew('courier', s0);
  }
  // (6) a delivery contract of 30 Cu turned in from the cargo (storage empty): raw units go first
  s0 = refinedNow();
  const storageCu = stationStorage(d.state, HOME_STATION_ID).resources.copper;
  if (storageCu > 0) d.act({ type: 'sellResource', resource: 'copper', qty: 'all', from: 'storage' });
  const contract: Contract = {
    id: 'saboteur@0.0',
    type: 'delivery',
    faction: 'guild',
    station: HOME_STATION_ID,
    ring: 1,
    risk: 0,
    target: { kind: 'delivery', resource: 'copper', amount: 30, to: HOME_STATION_ID },
    modifiers: [],
    bonus: 0,
    part: null,
    serial: 990_001,
    acceptedTick: d.state.tick,
    seconds: 60,
    reward: 300,
    rep: 0,
    progress: 0,
    base: 0,
    ready: false,
  };
  d.state.career.contracts.push(contract);
  const cuBefore = p.cargo.copper;
  const refCuBefore = p.refined.copper;
  const turned = d.attempt({ type: 'turnInContract', contractId: contract.serial });
  if (!turned.ok) notes.push(`delivery refused (${turned.reason})`);
  grew('delivery contract', s0);
  notes.push(`delivery 30 Cu from the hold: cargo Cu ${r1(cuBefore)} → ${r1(p.cargo.copper)}, refined Cu ${r1(refCuBefore)} → ${r1(p.refined.copper)}`);
  // (7) sell everything left from the ship: the bonus paid ≤ the refined units still on board × price × 15 %
  let bonus = 0;
  let allowed = 0;
  for (const r of ['iron', 'copper'] as const) {
    if (p.cargo[r] <= 1e-6) continue;
    const st = d.docked()!;
    const unit = resourcePrice(r, st.ring, st.priceJitter[r]).sell;
    const refinedLeft = p.refined[r];
    const s = sellShip(d, r);
    bonus += s.credits - s.raw;
    allowed += refinedLeft * unit * REFINED_BONUS;
  }
  // the whole ledger: no more bonus than the units the refinery produced
  const st = d.docked()!;
  const maxUnit = Math.max(...(['iron', 'copper'] as const).map((r) => resourcePrice(r, st.ring, st.priceJitter[r]).sell));
  if (bonus > produced * maxUnit * REFINED_BONUS + EPS) broken.push(`bonus ${bonus} kr > produced ${r1(produced)} u × 15 %`);
  return result(
    'refinedCarry',
    seed,
    d,
    bonus - allowed,
    broken,
    `${r1(produced)} u refined in flight; ${notes.join('; ')}; courier ${couriered} u (storage and shipments hold raw ore only); bonus paid at the end ${Math.round(bonus)} kr ≤ the refined units on board × 15 % (${Math.round(allowed)} kr). Units moved to storage come back raw even within one step (the clamp runs after every action), so the swap trick only loses the buy/sell spread`,
    { produced: Math.round(produced), sameStep: Math.round(sameStep), swapCost, switches, couriered, bonus: Math.round(bonus), allowed: Math.round(allowed) },
  );
}

// ------------------------------------------------------------------------------------------------
// W3 – sell the refined ore twice: one unit at a time, 'all' and again, several sales in one step, the same
// units sold from storage in the step they are transferred, crafted quantities.

export function refinedSellTwice(seed: number): LoopResult {
  const broken: string[] = [];
  const d = richGame(seed, 40_000);
  unlockNodes(d, REFINERY_NODES, broken);
  if (!mount(d, 'refinery:1')) broken.push('setup: refinery not mounted');
  const p = d.state.player;
  for (const r of ORES) if (stationStorage(d.state, HOME_STATION_ID).resources[r] > 0) d.act({ type: 'sellResource', resource: r, qty: 'all', from: 'storage' });
  d.act({ type: 'buyResource', resource: 'titanium', qty: 40 }, { type: 'buyResource', resource: 'copper', qty: 40 }, { type: 'buyResource', resource: 'iron', qty: 40 });
  d.act({ type: 'transfer', resource: 'titanium', qty: 40, to: 'ship' }, { type: 'transfer', resource: 'copper', qty: 40, to: 'ship' }, { type: 'transfer', resource: 'iron', qty: 40, to: 'ship' });
  flyAndIdle(d, () => unrefined(d) < 1e-6, 450);
  if (!d.dockAt(homeStation(), 300)) broken.push('could not dock at home');
  const st = d.docked() ?? homeStation();
  const unit = (r: ResourceId): number => resourcePrice(r, st.ring, st.priceJitter[r]).sell;
  const ceiling = (r: ResourceId, qty: number): number => Math.floor(qty * unit(r) * (1 + REFINED_BONUS) + 1e-9);
  let gain = -Infinity;
  const notes: string[] = [];
  // (1) titanium one unit at a time, then 'all', then 'all' again
  {
    const qty = p.cargo.titanium;
    const c0 = d.state.credits;
    let n = 0;
    while (p.cargo.titanium >= 1 && n < 80) {
      d.act({ type: 'sellResource', resource: 'titanium', qty: 1, from: 'ship' });
      n++;
    }
    d.act({ type: 'sellResource', resource: 'titanium', qty: 'all', from: 'ship' });
    const again = d.attempt({ type: 'sellResource', resource: 'titanium', qty: 'all', from: 'ship' });
    const got = d.state.credits - c0;
    gain = Math.max(gain, got - ceiling('titanium', qty));
    notes.push(`Ti ${qty} u in ${n} single sales + 'all': ${got} kr ≤ ${ceiling('titanium', qty)} kr (all refined); a 3rd sale ${again.ok ? `paid ${d.state.credits - c0 - got} kr` : `refused (${again.reason})`}`);
    if (p.refined.titanium > 1e-6) broken.push(`refined Ti left after selling the hold: ${p.refined.titanium}`);
  }
  // (2) copper: three sales in one step (20 + 20 + all)
  {
    const qty = p.cargo.copper;
    const c0 = d.state.credits;
    d.act(
      { type: 'sellResource', resource: 'copper', qty: 20, from: 'ship' },
      { type: 'sellResource', resource: 'copper', qty: 20, from: 'ship' },
      { type: 'sellResource', resource: 'copper', qty: 'all', from: 'ship' },
    );
    const got = d.state.credits - c0;
    gain = Math.max(gain, got - ceiling('copper', qty));
    notes.push(`Cu ${qty} u in three sales of one step: ${got} kr ≤ ${ceiling('copper', qty)} kr`);
  }
  // (3) iron: moved to storage and sold from there in the same step – the raw price, never the bonus;
  // then back to the ship in the next step – the refined count is gone
  {
    const qty = p.cargo.iron;
    const stored = stationStorage(d.state, st.id).resources.iron;
    const c0 = d.state.credits;
    d.act({ type: 'transfer', resource: 'iron', qty: 'all', to: 'storage' }, { type: 'sellResource', resource: 'iron', qty: 'all', from: 'storage' });
    const got = d.state.credits - c0;
    const raw = saleValue(qty + stored, unit('iron'));
    gain = Math.max(gain, got - raw);
    if (p.refined.iron > 1e-6) broken.push(`refined Fe ${p.refined.iron} left with an empty hold`);
    notes.push(`Fe ${qty} u moved to storage and sold there in one step: ${got} kr = raw ${raw} kr`);
  }
  // (4) crafted quantities
  let refusals = 0;
  for (const qty of [-5, 0, Number.NaN, 1e9, 0.5] as number[]) {
    const r = d.attempt({ type: 'sellResource', resource: 'copper', qty, from: 'ship' });
    if (!r.ok) refusals++;
    else if (qty !== 0.5) broken.push(`sale of ${qty} Cu accepted`);
  }
  return result(
    'refinedSellTwice',
    seed,
    d,
    gain,
    broken,
    `${notes.join('; ')}; crafted quantities (−5, 0, NaN, 1e9) refused (${refusals}/5 incl. 0.5 of an empty hold)`,
    { worst: gain, refusals },
  );
}

// ------------------------------------------------------------------------------------------------
// W4 – the repair module with its material only in station storage, then with 2 Fe in the hold; a T1 and a T2
// part next to one module (the bank switching material); its price next to the station repair.

/**
 * A repair module on a free cell touching one hull part, and one armour plate per tier on the module's free
 * edge cells (they hang on the module) – its damaged neighbours are exactly those plates.
 */
function repairRig(d: Driver, tiers: (1 | 2)[], broken: string[]): { module: PlacedPart; plates: PlacedPart[] } | null {
  unlockNodes(d, REPAIR_NODES, broken);
  const occupied = (): Set<string> => new Set(d.state.player.grid.parts.flatMap((p) => partCells(p).map((c) => `${c.x},${c.y}`)));
  const around = (x: number, y: number): { x: number; y: number }[] =>
    ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([dx, dy]) => ({ x: x + dx, y: y + dy })).filter((c) => !occupied().has(`${c.x},${c.y}`));
  const cells = freeCells(d)
    .filter((c) => c.touches.length === 1)
    .sort((a, b) => around(b.x, b.y).length - around(a.x, a.y).length || a.x - b.x || Math.abs(a.y) - Math.abs(b.y));
  for (const c of cells) {
    if (around(c.x, c.y).length < tiers.length) continue;
    const module = mount(d, 'repairModule:1', c);
    if (!module) continue;
    const plates: PlacedPart[] = [];
    for (const tier of tiers) {
      for (const f of around(c.x, c.y)) {
        const plate = mount(d, `armor:${tier}` as PartKey, f);
        if (plate) {
          plates.push(plate);
          break;
        }
      }
    }
    if (plates.length === tiers.length) return { module, plates };
    d.commit([...plates.map((pl) => ({ op: 'remove' as const, id: pl.id })), { op: 'remove', id: module.id }]);
  }
  broken.push(`setup: no spot for a repair module with ${tiers.length} plate(s)`);
  return null;
}

export function repairStorageOnly(seed: number): LoopResult {
  const broken: string[] = [];
  const d = richGame(seed, 40_000);
  const rig = repairRig(d, [1], broken);
  const notes: string[] = [];
  let gain = 0;
  const metrics: Record<string, number> = {};
  if (rig) {
    const plate = rig.plates[0]!;
    const p = d.state.player;
    const max = maxHp(plate);
    d.act({ type: 'debugDamage', partId: plate.id, hp: max / 4 });
    // all iron to storage, 60 more bought there – nothing in the hold
    if (p.cargo.iron > 0) d.act({ type: 'transfer', resource: 'iron', qty: 'all', to: 'storage' });
    d.act({ type: 'buyResource', resource: 'iron', qty: 60 });
    const storage0 = stationStorage(d.state, HOME_STATION_ID).resources.iron;
    flyAndIdle(d, () => false, 30);
    const hp1 = currentHp(p.hp, plate);
    if (hp1 > max / 4 + 1e-6) broken.push(`repaired ${r1(hp1 - max / 4)} HP with no Fe in the hold`);
    if (stationStorage(d.state, HOME_STATION_ID).resources.iron !== storage0) broken.push('the module drew iron from the station storage');
    notes.push(`Fe only in storage: 30 s in flight, plate ${r1(max / 4)} → ${r1(hp1)} HP, lamp ${p.workshop.repairIdle ?? 'working'}`);
    metrics.storageOnlyHp = hp1 - max / 4;
    // 2 Fe in the hold
    d.dockAt(homeStation(), 300);
    d.act({ type: 'transfer', resource: 'iron', qty: 2, to: 'ship' });
    const { perHp } = repairMaterialPerHp(plate);
    const fe0 = p.cargo.iron;
    const hp2 = currentHp(p.hp, plate);
    flyAndIdle(d, () => false, 60);
    const healed = currentHp(p.hp, plate) - hp2;
    const used = fe0 - p.cargo.iron;
    const bank = p.repair?.part === plate.id ? p.repair.bank : 0;
    // material paid = HP healed + HP still in the bank, at the station's material per HP
    gain = Math.max(gain, (healed + bank) * perHp - used);
    if (used > 2 + 1e-9) broken.push(`used ${used} Fe of 2`);
    notes.push(`2 Fe in the hold: healed ${r1(healed)} HP (+${r1(bank)} HP in the bank) for ${r1(used)} Fe at ${perHp.toFixed(4)} Fe/HP`);
    // the station repair of the same HP (ring 1): credits + Fe
    const quote = repairCost('armor:1', max - healed, max, 1);
    const fePrice = homeSellPrice('iron');
    const moduleKr = used * resourcePrice('iron', 1, homeStation().priceJitter.iron).buy;
    notes.push(`the station repair of the same ${r1(healed)} HP: ${quote.credits} kr + ${quote.amount} Fe (≈ ${Math.round(quote.credits + quote.amount * fePrice)} kr) vs the module ${r1(used)} Fe (≈ ${Math.round(moduleKr)} kr at the buy price) – cheaper by design (no credits), and the HP restores only own damage`);
    metrics.healed = Math.round(healed * 10) / 10;
    metrics.used = used;
    metrics.stationKr = Math.round(quote.credits + quote.amount * fePrice);
    metrics.moduleKr = Math.round(moduleKr);
  }
  // a T1 and a T2 plate next to one module, both damaged, 3 Fe + 3 Ti in the hold: the bank changes material
  const d2 = richGame(seed, 60_000);
  const rig2 = repairRig(d2, [1, 2], broken);
  if (rig2) {
    const p = d2.state.player;
    const [t1, t2] = rig2.plates as [PlacedPart, PlacedPart];
    d2.act({ type: 'debugDamage', partId: t1.id, hp: maxHp(t1) / 2 }, { type: 'debugDamage', partId: t2.id, hp: maxHp(t2) / 3 });
    for (const r of ['iron', 'titanium'] as const) if (p.cargo[r] > 0) d2.act({ type: 'transfer', resource: r, qty: 'all', to: 'storage' });
    d2.act({ type: 'buyResource', resource: 'titanium', qty: 3 }, { type: 'buyResource', resource: 'iron', qty: 3 });
    d2.act({ type: 'transfer', resource: 'iron', qty: 3, to: 'ship' }, { type: 'transfer', resource: 'titanium', qty: 3, to: 'ship' });
    const hp0 = [currentHp(p.hp, t1), currentHp(p.hp, t2)];
    // the bank's part, step by step: a change from one material to the other must never drop the old bank
    let switches = 0;
    let bankPart: number | null = null;
    flyAndIdle(d2, () => false, 120, () => {
      const now = d2.state.player.repair?.part ?? null;
      if (now !== null && bankPart !== null && now !== bankPart) switches++;
      if (now !== null) bankPart = now;
    });
    const healed = [currentHp(p.hp, t1) - hp0[0]!, currentHp(p.hp, t2) - hp0[1]!];
    const used = { iron: 3 - p.cargo.iron, titanium: 3 - p.cargo.titanium };
    const bank = p.repair;
    const paid = healed[0]! * repairMaterialPerHp(t1).perHp + (bank?.part === t1.id ? bank.bank * repairMaterialPerHp(t1).perHp : 0);
    const paidTi = healed[1]! * repairMaterialPerHp(t2).perHp + (bank?.part === t2.id ? bank.bank * repairMaterialPerHp(t2).perHp : 0);
    gain = Math.max(gain, paid - used.iron, paidTi - used.titanium);
    // what the same material would have healed without the switches
    const could = [Math.min(maxHp(t1) - hp0[0]!, used.iron / repairMaterialPerHp(t1).perHp), Math.min(maxHp(t2) - hp0[1]!, used.titanium / repairMaterialPerHp(t2).perHp)];
    // burned = units drawn beyond the whole units the healed HP (+ the bank) needed; the remainder of the
    // last unit of a part repaired to full HP is the station's whole-unit rounding, not a burn
    const wasted = Math.max(0, used.iron - Math.ceil(paid - 1e-9)) + Math.max(0, used.titanium - Math.ceil(paidTi - 1e-9));
    notes.push(
      `T1 plate at 50 % + T2 plate at 33 % beside one module, 3 Fe + 3 Ti: healed ${r1(healed[0]!)} HP (T1) for ${r1(used.iron)} Fe and ${r1(healed[1]!)} HP (T2) for ${r1(used.titanium)} Ti ` +
        `(the material would heal ${r1(could[0]!)} + ${r1(could[1]!)} HP): ${switches} bank switches between Fe and Ti, ${r1(wasted)} units burned (B1, fixed: 0 expected), never a gain`,
    );
    metrics.mixedFe = used.iron;
    metrics.mixedTi = used.titanium;
    metrics.mixedSwitches = switches;
    metrics.mixedWasted = Math.round(wasted * 100) / 100;
    metrics.mixedHealedT1 = Math.round(healed[0]! * 10) / 10;
    metrics.mixedHealedT2 = Math.round(healed[1]! * 10) / 10;
  }
  return result('repairStorageOnly', seed, d, gain, broken, notes.join('; ') || 'no rig', metrics);
}

// ------------------------------------------------------------------------------------------------
// W5 – the repair bank through save → load: a copy mid-repair plays on identically; a crafted save with a huge
// bank is repaired to one unit's worth; a bank for a missing part or a negative bank is dropped / refused.

function saveOf(d: Driver): ReturnType<typeof toSave> {
  return toSave(d.sim, { gameId: 'w', name: 'w', createdAt: '2026-10-17T10:00:00.000Z', savedAt: '2026-10-17T10:00:00.000Z', reason: 'manual', gameVersion: 'bot' });
}

export function repairBank(seed: number): LoopResult {
  const broken: string[] = [];
  const d = richGame(seed, 40_000);
  const rig = repairRig(d, [1], broken);
  const notes: string[] = [];
  let gain = 0;
  const metrics: Record<string, number> = {};
  if (rig) {
    const plate = rig.plates[0]!;
    const p = d.state.player;
    const max = maxHp(plate);
    d.act({ type: 'debugDamage', partId: plate.id, hp: 2 });
    if (p.cargo.iron > 0) d.act({ type: 'transfer', resource: 'iron', qty: 'all', to: 'storage' });
    d.act({ type: 'buyResource', resource: 'iron', qty: 2 }, { type: 'transfer', resource: 'iron', qty: 2, to: 'ship' });
    // fly until a partly used bank is there
    flyAndIdle(d, () => (p.repair?.bank ?? 0) > 0.5 && currentHp(p.hp, plate) > 4, 60);
    const bank0 = p.repair?.bank ?? 0;
    metrics.bank = Math.round(bank0 * 100) / 100;
    // (1) save → load copy plays on identically
    const copy = new Driver(cloneSim(d.sim));
    d.idle(20);
    copy.idle(20);
    const same = JSON.stringify([d.state.player.repair, [...d.state.player.hp], d.state.player.cargo]) === JSON.stringify([copy.state.player.repair, [...copy.state.player.hp], copy.state.player.cargo]);
    if (!same) broken.push('a save → load copy repairs differently');
    notes.push(`bank ${r1(bank0)} HP mid-repair: the save → load copy repairs identically (${same})`);
    // (2) a crafted save: bank 1e6 HP for the plate → the load clamps it to one unit of Fe
    const { perHp } = repairMaterialPerHp(plate);
    const crafted = saveOf(d);
    const hpNow = currentHp(d.state.player.hp, plate);
    crafted.player.repair = { part: plate.id, bank: 1e6 };
    const loaded = loadSave(toEnvelope(crafted));
    if (!loaded.ok) notes.push(`a 1e6 HP bank refused (${loaded.error})`);
    else {
      const c = new Driver(restoreSimulation(loaded.save));
      const bankLoaded = c.state.player.repair?.bank ?? 0;
      if (bankLoaded * perHp > 1 + 1e-6) broken.push(`a crafted bank loads as ${bankLoaded} HP (${bankLoaded * perHp} Fe)`);
      // no Fe in the hold: whatever it heals comes from the crafted bank
      const fe = c.state.player.cargo.iron;
      if (fe > 0) c.state.player.cargo.iron = 0;
      c.idle(Math.min(60, max));
      const healed = currentHp(c.state.player.hp, plate) - hpNow;
      gain = Math.max(gain, healed * perHp - 1);
      notes.push(`crafted bank 1e6 HP: loaded as ${r1(bankLoaded)} HP (${(bankLoaded * perHp).toFixed(2)} Fe – the clamp to one unit), healed ${r1(healed)} HP from it`);
      metrics.craftedBankFe = Math.round(bankLoaded * perHp * 1000) / 1000;
      metrics.craftedHealed = Math.round(healed * 10) / 10;
    }
    // (3) a bank for a part that is not in the grid, and a negative bank
    for (const [label, bank] of [
      ['missing part', { part: 999_999, bank: 5 }],
      ['negative bank', { part: plate.id, bank: -5 }],
    ] as const) {
      const s = saveOf(d);
      s.player.repair = bank;
      const l = loadSave(toEnvelope(s));
      const kept = l.ok ? restoreSimulation(l.save).state.player.repair : null;
      if (l.ok && kept && (kept.part === 999_999 || kept.bank < 0)) broken.push(`${label}: loaded as ${JSON.stringify(kept)}`);
      notes.push(`${label}: ${l.ok ? `loaded, bank ${JSON.stringify(kept)}` : `refused (${l.error})`}`);
    }
  }
  return result('repairBank', seed, d, gain, broken, notes.join('; ') || 'no rig', metrics);
}

// ------------------------------------------------------------------------------------------------
// W6 – the large reactor's blast and the player's own detached wreck: a large reactor shot on the hull blows
// once (its neighbours lose 40 HP, the destroyed ones drop nothing); a large reactor torn off with its link
// plate comes back intact from the wreck – a player's wreck is not dismantlable, so a laser cannot cut (and blow)
// it – and nothing is duplicated.

/**
 * A shot at a part of the player's own ship (a pirate's projectile, the shapes probe does the same), fired
 * from just outside one of the part's free edge cells so nothing else is in its way.
 */
function shootPart(d: Driver, part: PlacedPart, damage: number): SimEvent[] {
  const p = d.state.player;
  const at = gridToWorld(p.body, p.props.centerOfMass, partCenter(part));
  const occupied = new Set(p.grid.parts.flatMap((q) => partCells(q).map((c) => `${c.x},${c.y}`)));
  let side: { x: number; y: number } = { x: 1, y: 0 };
  search: for (const c of partCells(part)) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      // free for two cells out: the projectile starts in open space
      if (!occupied.has(`${c.x + dx},${c.y + dy}`) && !occupied.has(`${c.x + 2 * dx},${c.y + 2 * dy}`)) {
        side = { x: c.x + 2 * dx, y: c.y + 2 * dy };
        break search;
      }
    }
  }
  const ahead = gridToWorld(p.body, p.props.centerOfMass, side);
  const dir = { x: at.x - ahead.x, y: at.y - ahead.y };
  const len = Math.hypot(dir.x, dir.y);
  d.state.combat.projectiles.push({
    id: 990_101 + d.state.tick,
    owner: 'pr:saboteur:0',
    pos: ahead,
    vel: { x: (dir.x / len) * 300 + p.body.vel.x, y: (dir.y / len) * 300 + p.body.vel.y },
    ttl: 6,
    damage,
    tier: 1,
    origin: ahead,
  });
  const events: SimEvent[] = [];
  for (let i = 0; i < 0.5 * TPS; i++) events.push(...d.step());
  return events;
}

/** A large reactor mounted beside a new armour plate on a free cell where it touches only that plate. */
function reactorRig(d: Driver, broken: string[]): { plate: PlacedPart; reactor: PlacedPart } | null {
  unlockNodes(d, REACTOR_NODES, broken);
  const cells = freeCells(d).sort((a, b) => a.touches.length - b.touches.length || b.x - a.x);
  for (const c of cells) {
    const plate = mount(d, 'armor:1', c);
    if (!plate) continue;
    // the reactor on a free cell next to the plate, touching nothing else
    for (const r of freeCells(d).filter((f) => f.touches.length === 1 && f.touches[0]!.id === plate.id)) {
      for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as const) {
        const at = { x: r.x + ox, y: r.y + oy };
        const op = { op: 'place' as const, key: 'largeReactor:1' as PartKey, x: at.x, y: at.y, rot: 0 as const };
        if (!d.canCommit([op]) && !(buyRecipe(d, 'largeReactor:1'), d.canCommit([op]))) continue;
        const reactor = mount(d, 'largeReactor:1', at);
        if (!reactor) continue;
        const grid = d.state.player.grid;
        const owner = new Map<string, number>();
        for (const q of grid.parts) for (const cc of partCells(q)) owner.set(`${cc.x},${cc.y}`, q.id);
        const touches = new Set<number>();
        for (const cc of partCells(reactor)) {
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const o = owner.get(`${cc.x + dx},${cc.y + dy}`);
            if (o !== undefined && o !== reactor.id) touches.add(o);
          }
        }
        if (touches.size === 1 && touches.has(plate.id)) return { plate, reactor };
        // touches more: take it off again and try the next spot
        d.commit([{ op: 'remove', id: reactor.id }]);
      }
    }
    d.commit([{ op: 'remove', id: plate.id }]);
  }
  broken.push('setup: no spot where a large reactor hangs on one plate');
  return null;
}

export function blastOwnWreck(seed: number): LoopResult {
  const broken: string[] = [];
  const notes: string[] = [];
  const metrics: Record<string, number> = {};
  let gain = -Infinity;
  // (1) the reactor blows on the hull: 1 HP, shot
  const d = richGame(seed, 60_000);
  const rig = reactorRig(d, broken);
  if (rig) {
    d.act({ type: 'debugDamage', partId: rig.reactor.id, hp: 1 });
    flyAndIdle(d, () => false, 3);
    const parts0 = ownedParts(d.state);
    const w0 = netWorth(d.state).total;
    const wrecks0 = new Set(d.state.combat.wrecks.map((w) => w.id));
    const events = shootPart(d, rig.reactor, 5);
    d.idle(2);
    const blasts = events.filter((e) => e.type === 'partBlast');
    if (blasts.length !== 1) broken.push(`${blasts.length} blasts for one large reactor`);
    const diff = partsDiff(parts0, ownedParts(d.state));
    if (Object.values(diff).some((n) => (n ?? 0) > 0)) broken.push(`parts appeared: ${JSON.stringify(diff)}`);
    // the new wrecks carry no destroyed part
    const loot: Record<string, number> = {};
    for (const w of d.state.combat.wrecks.filter((x) => !wrecks0.has(x.id))) for (const [k, n] of Object.entries(w.loot.parts)) loot[k] = (loot[k] ?? 0) + (n ?? 0);
    if ((loot['largeReactor:1'] ?? 0) > 0) broken.push('the blown reactor is in a wreck');
    gain = Math.max(gain, netWorth(d.state).total - w0);
    notes.push(`a 1 HP large reactor shot on the hull: ${blasts.length} blast (${blasts[0] && blasts[0].type === 'partBlast' ? blasts[0].damage : 0} dmg), parts ${JSON.stringify(diff)}, wreck loot ${JSON.stringify(loot)}`);
    metrics.blasts = blasts.length;
  }
  // (2) the reactor torn off with its link plate: an intact player wreck, no cut, loaded back once
  const d2 = richGame(seed, 60_000);
  const rig2 = reactorRig(d2, broken);
  if (rig2) {
    flyAndIdle(d2, () => false, 3);
    const parts0 = ownedParts(d2.state);
    const w0 = netWorth(d2.state).total;
    const wrecks0 = new Set(d2.state.combat.wrecks.map((w) => w.id));
    shootPart(d2, rig2.plate, maxHp(rig2.plate) + 5);
    const wreck = d2.state.combat.wrecks.find((w) => !wrecks0.has(w.id) && w.grid.parts.some((q) => q.partId === 'largeReactor'));
    if (!wreck) broken.push('no wreck with the large reactor');
    else {
      if (wreck.dismantle) broken.push('a player wreck is dismantlable');
      // the mining laser on the wreck for 8 s: no cut, no blast
      let cuts = 0;
      for (let i = 0; i < 8 * TPS; i++) {
        const ev = d2.step({ ...IDLE_COMMAND, mining: true, aim: { ...wreck.body.pos } });
        cuts += ev.filter((e) => e.type === 'wreckCut' || e.type === 'cutBlast' || e.type === 'partBlast').length;
      }
      if (cuts) broken.push(`${cuts} cuts / blasts on the player's own wreck`);
      notes.push(`the plate shot off: the large reactor drifts off in a player wreck (loot ${JSON.stringify(wreck.loot.parts)}, not dismantlable – CUT_BLAST.largeReactor ${CUT_BLAST.largeReactor} only applies to POI wrecks); 8 s of laser on it: ${cuts} cuts`);
      metrics.cuts = cuts;
    }
    const loaded = salvageNearestWreck(d2, 240);
    d2.dockAt(homeStation(), 400);
    const diff = partsDiff(parts0, ownedParts(d2.state));
    if (Object.values(diff).some((n) => (n ?? 0) > 0)) broken.push(`parts appeared: ${JSON.stringify(diff)}`);
    gain = Math.max(gain, netWorth(d2.state).total - w0);
    notes.push(
      loaded
        ? `loaded back, parts ${JSON.stringify(diff)} (only the destroyed plate lost)`
        : `the drifting wreck was not caught in 240 s – parts ${JSON.stringify(diff)}, the reactor stays in its wreck (nothing gained either way)`,
    );
    metrics.reactorBack = (diff['largeReactor:1'] ?? 0) === 0 ? 1 : 0;
  }
  return result('blastOwnWreck', seed, d, gain, broken, notes.join('; ') || 'no rig', metrics);
}

// ------------------------------------------------------------------------------------------------
// W7 – paints: a ship stored at another station, the active ship away from home, in flight, a crafted id of
// another game's ship, unknown paints; a paint is free and changes nothing else.

/** Everything a paint must not change (credits, parts, cargo, storage, fleet except the paint fields). */
const valueSnapshot = (d: Driver): string =>
  JSON.stringify([
    d.state.credits,
    d.state.player.grid,
    d.state.player.cargo,
    [...d.state.stations.entries()],
    d.state.fleet.stored.map((s) => [s.record.id, s.stationId, s.grid, s.cargo, s.fuel]),
  ]);

export function paintElsewhere(seed: number): LoopResult {
  const broken: string[] = [];
  const d = richGame(seed, 60_000);
  const notes: string[] = [];
  if (!d.act({ type: 'homeBuild', module: 'paintShop' })) broken.push('setup: paint shop not built');
  const [g1] = guaranteed(d);
  let checks = 0;
  const expect = (label: string, shipId: number, reasons: readonly string[]): void => {
    const before = valueSnapshot(d);
    const r = d.attempt({ type: 'paintShip', shipId, paint: 'racing' });
    checks++;
    if (r.ok || !reasons.includes(r.reason ?? '')) broken.push(`${label}: ${r.ok ? 'painted' : r.reason} (expected ${reasons.join(' / ')})`);
    if (valueSnapshot(d) !== before) broken.push(`${label}: state changed`);
    notes.push(`${label}: ${r.ok ? 'ok' : r.reason}`);
  };
  if (g1) {
    // the active ship flies to G1 with a hangar there: buy a slot, park it, a new cockpit ship is active
    d.act({ type: 'refuel', source: 'credits', amount: 'full' });
    d.undock();
    if (!d.dockAt(g1, 400)) broken.push('could not dock at G1');
    const awayId = d.state.fleet.active.id;
    expect('the active ship docked at G1', awayId, ['shipNotHome', 'notHome']);
    if (!d.act({ type: 'hangarBuySlot' })) broken.push('setup: slot at G1 refused');
    if (!d.act({ type: 'hangarNewShip', cockpit: 'cockpit:1', acquire: 'buy' })) broken.push('setup: new ship at G1 refused');
    // the new ship gets two engines and a tank here, then flies home
    for (const k of ['engine:1', 'engine:1', 'fuelTank:1'] as PartKey[]) d.acquirePart(k);
    d.act({ type: 'refuel', source: 'credits', amount: 'full' });
    d.undock();
    const home = homeStation();
    if (!d.dockAt(home, 600)) notes.push('the cockpit ship did not reach home');
    if (d.docked()?.id === HOME_STATION_ID) {
      expect('a ship stored at G1, painted from home', awayId, ['shipNotHome']);
      // the active ship docked at home: allowed, free
      const homeId = d.state.fleet.active.id;
      const c0 = d.state.credits;
      const r = d.attempt({ type: 'paintShip', shipId: homeId, paint: 'navy' });
      if (!r.ok) broken.push(`the active ship docked at home: ${r.reason}`);
      if (d.state.credits !== c0) broken.push('a paint cost credits');
      checks++;
      // park it at home, fly a third ship to G1 and paint the one at home from there
      if (d.act({ type: 'hangarBuySlot' }) && d.act({ type: 'hangarNewShip', cockpit: 'cockpit:1', acquire: 'buy' })) {
        for (const k of ['engine:1', 'engine:1', 'fuelTank:1'] as PartKey[]) d.acquirePart(k);
        d.act({ type: 'refuel', source: 'credits', amount: 'full' });
        d.undock();
        if (d.dockAt(g1, 600)) expect('a ship stored at home, painted from G1', homeId, ['notHome']);
        else notes.push('the third ship did not reach G1');
      }
    }
  }
  // in flight
  d.undock();
  expect('the active ship in flight', d.state.fleet.active.id, ['shipNotHome', 'notHome']);
  return result('paintElsewhere', seed, d, 0, broken, `${notes.join('; ')}; a paint costs nothing and changes only the paint field`, { checks });
}

export function paintCrafted(seed: number): LoopResult {
  const broken: string[] = [];
  const d = richGame(seed, 60_000);
  if (!d.act({ type: 'homeBuild', module: 'paintShop' })) broken.push('setup: paint shop not built');
  // a second game with three ships: its ids (and ids that exist nowhere) sent to this game
  const other = richGame(seed + 1000, 60_000);
  other.act({ type: 'hangarBuySlot' });
  other.act({ type: 'hangarNewShip', cockpit: 'cockpit:1', acquire: 'buy' });
  const otherIds = [other.state.fleet.active.id, ...other.state.fleet.stored.map((s) => s.record.id)];
  const ours = new Set([d.state.fleet.active.id, ...d.state.fleet.stored.map((s) => s.record.id)]);
  let refused = 0;
  let checks = 0;
  const notes: string[] = [];
  for (const id of [...otherIds.filter((x) => !ours.has(x)), 999_999, -1, 0.5, Number.NaN, '1' as unknown as number, null as unknown as number]) {
    const before = valueSnapshot(d);
    const r = d.attempt({ type: 'paintShip', shipId: id, paint: 'racing' });
    checks++;
    if (r.ok) broken.push(`ship id ${String(id)} painted`);
    else refused++;
    if (valueSnapshot(d) !== before) broken.push(`ship id ${String(id)}: state changed`);
  }
  // an id this game shares with the other one paints this game's own ship only
  const shared = otherIds.find((x) => ours.has(x));
  if (shared !== undefined) {
    const r = d.attempt({ type: 'paintShip', shipId: shared, paint: 'racing' });
    checks++;
    notes.push(`shared id ${shared}: ${r.ok ? "this game's own ship painted" : r.reason}`);
    if (other.state.fleet.active.paint !== undefined || other.state.fleet.stored.some((s) => s.record.paint !== undefined)) broken.push('the other game changed');
  }
  // unknown paints and the same paint again
  for (const paint of ['gold', '', 'Racing', 42 as unknown as string]) {
    const before = valueSnapshot(d);
    const r = d.attempt({ type: 'paintShip', shipId: d.state.fleet.active.id, paint: paint as 'racing' });
    checks++;
    if (r.ok) broken.push(`paint ${String(paint)} accepted`);
    else refused++;
    if (valueSnapshot(d) !== before) broken.push(`paint ${String(paint)}: state changed`);
  }
  const same = d.attempt({ type: 'paintShip', shipId: d.state.fleet.active.id, paint: d.state.fleet.active.paint ?? 'factory' });
  checks++;
  if (same.ok || same.reason !== 'samePaint') broken.push(`the same paint again: ${same.ok ? 'ok' : same.reason}`);
  // every paint id once: free
  const c0 = d.state.credits;
  for (const paint of PAINT_IDS) d.attempt({ type: 'paintShip', shipId: d.state.fleet.active.id, paint });
  if (d.state.credits !== c0) broken.push(`painting cost ${c0 - d.state.credits} kr`);
  return result('paintCrafted', seed, d, 0, broken, `${refused} crafted ids / paints refused (other game's ids ${otherIds.join(', ')}, 999999, −1, 0.5, NaN, "1", null; paints gold, "", Racing, 42); ${notes.join('; ') || 'no shared id'}; same paint → samePaint; every paint free`, { checks, refused });
}

// ------------------------------------------------------------------------------------------------
// W8 – homeBuild twice, away from home, in flight, a future (`since`) module, an unknown id, too poor; the
// module survives save → load and cannot be bought again from the copy.

export function homeBuildCrafted(seed: number): LoopResult {
  const broken: string[] = [];
  const d = richGame(seed, 40_000);
  const c0 = d.state.credits;
  const notes: string[] = [];
  let checks = 0;
  const expectFail = (label: string, module: string, reasons: readonly string[]): void => {
    const before = [d.state.credits, [...d.state.home.modules]].join();
    const r = d.attempt({ type: 'homeBuild', module: module as 'paintShop' });
    checks++;
    if (r.ok || !reasons.includes(r.reason ?? '')) broken.push(`${label}: ${r.ok ? 'built' : r.reason} (expected ${reasons.join(' / ')})`);
    if ([d.state.credits, [...d.state.home.modules]].join() !== before) broken.push(`${label}: state changed`);
  };
  if (!d.act({ type: 'homeBuild', module: 'paintShop' })) broken.push('the paint shop refused');
  expectFail('the paint shop again', 'paintShop', ['moduleOwned']);
  if (!d.act({ type: 'homeBuild', module: 'trophyHall' })) broken.push('the trophy hall refused');
  for (const id of HOME_MODULE_IDS.filter((m) => !isBuildableModule(m))) expectFail(`future module ${id} (${HOME_MODULES[id].since})`, id, ['moduleUnavailable']);
  for (const id of ['forge', '', 'paint_shop', '__proto__']) expectFail(`unknown module "${id}"`, id, ['moduleUnavailable']);
  // two actions in one step: the second is refused (owned)
  const d2 = richGame(seed, 40_000);
  const start2 = d2.state.credits;
  d2.act({ type: 'homeBuild', module: 'paintShop' }, { type: 'homeBuild', module: 'paintShop' });
  if (start2 - d2.state.credits !== HOME_MODULES.paintShop.credits) broken.push(`two builds in one step cost ${start2 - d2.state.credits} kr`);
  checks++;
  // too poor
  const poor = new Driver(newGame(seed, 'mild'));
  const pr = poor.attempt({ type: 'homeBuild', module: 'trophyHall' });
  checks++;
  if (pr.ok || pr.reason !== 'notEnoughCredits') broken.push(`a poor player: ${pr.ok ? 'built' : pr.reason}`);
  // save → load: owned in the copy, not again
  const copy = new Driver(cloneSim(d.sim));
  const again = copy.attempt({ type: 'homeBuild', module: 'paintShop' });
  checks++;
  if (again.ok || !copy.state.home.modules.has('paintShop')) broken.push('the copy lost the module or built it again');
  // away from home: G1, and in flight
  const [g1] = guaranteed(d);
  d.act({ type: 'refuel', source: 'credits', amount: 'full' });
  d.undock();
  expectFail('in flight', 'paintShop', ['notHome']);
  expectFail('in flight (not owned)', 'trophyHall', ['notHome']);
  if (g1 && d.dockAt(g1, 400)) {
    const d3 = new Driver(cloneSim(d.sim));
    // a fresh copy that owns nothing … the same rule at G1
    d3.state.home.modules.clear();
    const r = d3.attempt({ type: 'homeBuild', module: 'paintShop' });
    checks++;
    if (r.ok || r.reason !== 'notHome') broken.push(`at G1: ${r.ok ? 'built' : r.reason}`);
    notes.push(`at ${g1.id}: ${r.ok ? 'built' : r.reason}`);
  }
  const spent = c0 - d.state.credits;
  const price = HOME_MODULES.paintShop.credits + HOME_MODULES.trophyHall.credits;
  const fuel = d.credits.refuel ?? 0;
  // credits went only to the two modules (and the fuel)
  const gain = price - (spent + fuel);
  return result(
    'homeBuildCrafted',
    seed,
    d,
    Math.max(0, gain),
    broken,
    `paint shop + trophy hall ${price} kr once; again → moduleOwned; future modules → moduleUnavailable; unknown ids → moduleUnavailable; two builds in one step pay once; poor → notEnoughCredits; save → load keeps it (no second build); in flight / at another station → notHome${notes.length ? ` (${notes.join(', ')})` : ''}; modules ${[...d.state.home.modules].join(', ')}`,
    { checks, spent, price },
  );
}

// ------------------------------------------------------------------------------------------------
// W9 – trophy pins: unknown ids, a captain not defeated, a fortress not destroyed, malformed ids, a 7th pin, no
// hall, away from home, a crafted save with unknown / duplicate pins.

export function trophyPinCrafted(seed: number): LoopResult {
  const broken: string[] = [];
  const d = richGame(seed, 40_000);
  const s = d.state;
  // setup: six captains defeated and the nearest fortress destroyed (as the career and the fortress leave them)
  const defs = captainDefs(s.seed);
  const defeated = defs.slice(0, 6);
  for (const def of defeated) {
    s.career.captains.set(def.index, { promotions: 1, defeated: true, trophies: [], kills: 1 });
    s.career.trophies.push({ captain: def.index, parts: [] });
  }
  const sites = [...fortressSites(s.seed)].sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y));
  const site = sites[0]!;
  const f = structuredClone(fortressStatus(s, site.id));
  s.pirates.fortresses.set(site.id, { ...f, core: 0, destroyed: s.tick, kills: 1, turrets: f.turrets.map(() => 0), gens: f.gens.map(() => 0) });
  let checks = 0;
  const notes: string[] = [];
  const expectFail = (label: string, id: unknown, reasons: readonly string[], pinned: unknown = true): void => {
    const before = JSON.stringify(s.home.trophyPins);
    const r = d.attempt({ type: 'trophyPin', id: id as 'cap:0', pinned: pinned as boolean });
    checks++;
    if (r.ok || !reasons.includes(r.reason ?? '')) broken.push(`${label}: ${r.ok ? 'pinned' : r.reason} (expected ${reasons.join(' / ')})`);
    if (JSON.stringify(s.home.trophyPins) !== before) broken.push(`${label}: pins changed`);
  };
  expectFail('no trophy hall', `cap:${defeated[0]!.index}`, ['noTrophyHall']);
  if (!d.act({ type: 'homeBuild', module: 'trophyHall' })) broken.push('setup: trophy hall not built');
  const notDefeated = defs.find((x) => !defeated.includes(x));
  if (notDefeated) expectFail('a captain not defeated', `cap:${notDefeated.index}`, ['unknownTrophy']);
  const alive = sites.find((x) => x.id !== site.id);
  if (alive) expectFail('a fortress not destroyed', alive.id, ['unknownTrophy']);
  for (const id of ['cap:999', 'cap:-1', 'cap:0.5', 'fort:999', 'xyz', '', 'CAP:0', 42, null, { id: 'cap:0' }]) expectFail(`malformed id ${JSON.stringify(id)}`, id, ['unknownTrophy']);
  // pin all seven: six fit, the seventh → shelfFull; pinning twice adds nothing
  const all = [...defeated.map((x) => `cap:${x.index}`), site.id];
  let pinned = 0;
  for (const id of all.slice(0, TROPHY_PEDESTALS)) if (d.act({ type: 'trophyPin', id: id as 'cap:0', pinned: true })) pinned++;
  d.act({ type: 'trophyPin', id: all[0] as 'cap:0', pinned: true });
  expectFail('a seventh pin', all[TROPHY_PEDESTALS]!, ['shelfFull']);
  if (s.home.trophyPins.length !== TROPHY_PEDESTALS || new Set(s.home.trophyPins).size !== s.home.trophyPins.length) broken.push(`pins ${JSON.stringify(s.home.trophyPins)}`);
  // a truthy non-boolean `pinned` is an unpin (never a second pin)
  d.attempt({ type: 'trophyPin', id: all[1] as 'cap:0', pinned: 'yes' as unknown as boolean });
  checks++;
  if (s.home.trophyPins.length > TROPHY_PEDESTALS) broken.push('a crafted `pinned` added a pin');
  // crafted saves: duplicate / too many / malformed pins are refused; a well-formed pin of a trophy the
  // player does not have (a captain not defeated) is dropped on load
  const crafted = (pins: string[]): string => {
    const save = saveOf(d);
    (save as unknown as { home: { trophyPins: string[] } }).home.trophyPins = pins;
    const loaded = loadSave(toEnvelope(save));
    checks++;
    if (!loaded.ok) return `refused (${loaded.error})`;
    const got = restoreSimulation(loaded.save).state.home.trophyPins;
    if (got.some((x) => !all.includes(x)) || new Set(got).size !== got.length || got.length > TROPHY_PEDESTALS) broken.push(`crafted save pins ${JSON.stringify(pins)} load as ${JSON.stringify(got)}`);
    return `loaded with ${got.length} pins`;
  };
  notes.push(`crafted save with a duplicate pin: ${crafted([all[0]!, all[0]!])}`);
  notes.push(`with 9 pins: ${crafted([...all, 'cap:998', 'cap:999'])}`);
  notes.push(`with "xyz": ${crafted(['xyz'])}`);
  if (notDefeated) notes.push(`with a captain not defeated: ${crafted([`cap:${notDefeated.index}`, all[0]!])}`);
  // away from home
  d.undock();
  expectFail('in flight', all[0], ['notHome'], false);
  return result(
    'trophyPinCrafted',
    seed,
    d,
    0,
    broken,
    `6 captains + 1 fortress defeated (setup): no hall → noTrophyHall; a captain not defeated, a fortress not destroyed and 10 malformed ids → unknownTrophy; ${pinned} pins, the 7th → shelfFull, a pin twice adds nothing; ${notes.join('; ')}; in flight → notHome. A pin has no value – the check is that no id outside the player's trophies is ever pinned`,
    { checks, pinned },
  );
}

/** Every M4c probe of one seed (rows of the report's controls and its M4c section). */
export function homeProbes(seed: number): LoopResult[] {
  return [
    refineArbitrage(seed),
    refineSurvey(seed),
    refinedCarry(seed),
    refinedSellTwice(seed),
    repairStorageOnly(seed),
    repairBank(seed),
    blastOwnWreck(seed),
    paintElsewhere(seed),
    paintCrafted(seed),
    homeBuildCrafted(seed),
    trophyPinCrafted(seed),
  ];
}
