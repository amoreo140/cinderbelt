// Saboteur / exploiter scenarios: each one plays the real simulation through the Driver and measures
// the net worth (liquidation value, see value.ts) it gains per game hour, next to an honest mining
// baseline from the same seed and difficulty. Free help that ends up as positive net value is an
// exploit; the controls (expected 0) show where the rules already hold.
import { EMERGENCY_FUEL_FRACTION, FUEL_BASE_PRICE, INSTALL_FEE, partBuyPrice, partSellPrice, RING_SERVICE_MULT, resourcePrice, towCost } from '../../../src/data/economy';
import type { PartKey } from '../../../src/data/parts';
import { cargoUsed, RESOURCE_IDS, type ResourceId } from '../../../src/data/resources';
import { DEMAND_BONUS, DEMAND_CAP } from '../../../src/data/sector';
import type { ContractOffer } from '../../../src/sim/career/types';
import { IDLE_COMMAND } from '../../../src/sim/commands';
import { currentBoard, quoteOffer } from '../../../src/sim/contracts/board';
import type { DeathPenalty } from '../../../src/sim/settings';
import type { PlacedPart, ShipGrid } from '../../../src/sim/ship/types';
import type { EditorOp } from '../../../src/sim/shipyard/editor';
import { LOAN_LASER_KEY } from '../../../src/sim/station/guildLoan';
import { guaranteedStationChunks, HOME_STATION_ID, homeStation, stationAt, type StationDef } from '../../../src/sim/world/stations';
import { CHUNK_SIZE } from '../../../src/sim/world/chunks';
import { chartingData, regionWorld, sectorChunkKeys, sectorInfo, sectorKnowledge, surveyPoints } from '../../../src/sim/regions';
import { chartBuyPrice, chartSellPrice, chartTrade, firstChartTarget } from '../../../src/sim/charts/charts';
import type { SimEvent } from '../../../src/sim/Simulation';
import { dist, norm } from '../flight';
import { restoreOps } from '../shipPlan';
import { cloneSim, Driver, isMiningKey, keyOf, newGame, TPS } from './harness';
import { runPilot, type PilotRun } from './pilotLoop';
import { ram } from './ram';
import { netWorth } from './value';

export interface LoopResult {
  id: string;
  seed: number;
  penalty: DeathPenalty;
  /** Game seconds the loop ran. */
  seconds: number;
  /** Net worth gained (liquidation value). */
  gain: number;
  perHour: number;
  /** Honest mining baseline of the same seed and difficulty (net worth per hour), when measured. */
  baselinePerHour: number | null;
  /** Free help used (kits, tows, deaths, rations…). */
  help: Record<string, number>;
  /** Positive net value from free help (or a broken rule): a finding. */
  exploit: boolean;
  /** Tick of the first gain from free help (reproduction anchor), or null. */
  tick: number | null;
  detail: string;
  /** Scenario-specific numbers for the report. */
  metrics?: Record<string, number>;
}

const cloneGrid = (g: ShipGrid): ShipGrid => ({ parts: g.parts.map((p) => ({ ...p })), nextId: g.nextId });
const round = (x: number): number => Math.round(x);

// ------------------------------------------------------------------------------------------------
// honest baseline

const baselineCache = new Map<string, PilotRun>();

/** Honest balance-bot play from a new game (cached per seed, difficulty and length). */
export function baseline(seed: number, penalty: DeathPenalty, seconds: number): PilotRun {
  const key = `${seed}:${penalty}:${seconds}`;
  let r = baselineCache.get(key);
  if (!r) {
    r = runPilot(new Driver(newGame(seed, penalty)), seconds);
    baselineCache.set(key, r);
  }
  return r;
}

// ------------------------------------------------------------------------------------------------
// E1 – scuttle farm: strip the ship to the minimum, sell everything, abandon ship, repeat

export function scuttleFarm(seed: number, penalty: DeathPenalty, seconds: number): LoopResult {
  const d = new Driver(newGame(seed, penalty));
  // the usable-ship value: a loan hull counts at the buy-back price of its parts (second review I5)
  const w0 = netWorth(d.state).usable;
  let firstGain: number | null = null;
  let cycles = 0;
  const end = Math.round(seconds * TPS);
  while (d.state.tick < end) {
    if (!d.docked()) break;
    d.stripToMinimum();
    d.sellStorageParts();
    d.idle(d.opts.uiSeconds);
    const before = netWorth(d.state).usable;
    if (!d.scuttle()) break;
    cycles++;
    if (firstGain === null && netWorth(d.state).usable > before + 1) firstGain = d.state.tick;
  }
  const gain = netWorth(d.state).usable - w0;
  const secs = d.state.tick / TPS;
  return {
    id: 'scuttleFarm',
    seed,
    penalty,
    seconds: secs,
    gain,
    perHour: (gain * 3600) / secs,
    baselinePerHour: null,
    help: { death: d.counts.death ?? 0 },
    exploit: gain > 0,
    tick: firstGain,
    metrics: { cycles, perCycle: cycles ? gain / cycles : 0 },
    detail: `${cycles} strip → sell → scuttle cycles; ${d.state.settings.deathPenalty} penalty at the end (started ${penalty}); credits ${d.state.credits}`,
  };
}

// ------------------------------------------------------------------------------------------------
// E2 – Guild loan farm (was the emergency kit farm, X5): sell the own laser, then try to cash in every
// loan the Guild hands out – take it off in the shipyard and sell the storage, again and again. A
// liquidated player is the one the Guild helps, so the loop starts from a liquidation.

export function kitFarm(seed: number, penalty: DeathPenalty, seconds: number): LoopResult {
  const d = new Driver(newGame(seed, penalty));
  // a rich player first: selling the own laser does not make him needy (net-worth test)
  d.commit(d.state.player.grid.parts.filter((p) => isMiningKey(keyOf(p))).map((p) => ({ op: 'remove' as const, id: p.id })));
  d.sellStorageParts(isMiningKey);
  d.idle(1);
  const richLoans = d.counts.guildLoan ?? 0;
  liquidate(d);
  const w0 = netWorth(d.state).total;
  let firstGain: number | null = null;
  let cashIns = 0;
  const end = Math.round(seconds * TPS);
  while (d.state.tick < end) {
    const loans = d.state.player.grid.parts.filter((p) => p.loan);
    if (loans.length) {
      // a removal-only draft – the Guild takes its part back (and lends it again: the need is unchanged)
      d.commit(loans.map((p) => ({ op: 'remove' as const, id: p.id })));
      cashIns++;
    }
    const before = netWorth(d.state).total;
    d.sellStorageParts();
    if (netWorth(d.state).total > before + 1) firstGain ??= d.state.tick;
    d.idle(Math.min(60, (end - d.state.tick) / TPS));
  }
  const gain = netWorth(d.state).total - w0;
  const secs = d.state.tick / TPS;
  return {
    id: 'kitFarm',
    seed,
    penalty,
    seconds: secs,
    gain,
    perHour: (gain * 3600) / secs,
    baselinePerHour: null,
    help: { guildLoan: d.counts.guildLoan ?? 0 },
    exploit: gain > 0 || richLoans > 0,
    tick: firstGain,
    metrics: { kits: d.counts.guildLoan ?? 0, cashIns, richLoans },
    detail:
      `rich player without a laser: ${richLoans} loans; liquidated: ${d.counts.guildLoan ?? 0} loans, ${cashIns} attempts to take one off and sell it – ` +
      `net worth ${round(gain)} kr (loan parts never reach a storage); credits now ${d.state.credits}`,
  };
}

// ------------------------------------------------------------------------------------------------
// E3 – contract quote inflation: strip lasers / holds before accepting – the frozen reward is quoted
// for the stripped ship (slow mining = long estimate = big reward), then rebuild and do the job

const RING1_RESOURCES: readonly ResourceId[] = ['iron', 'copper', 'ice'];

const acceptable = (o: ContractOffer): boolean => o.target.kind === 'mining' && RING1_RESOURCES.includes(o.target.resource);

/** Parts kept when stripping for a quote: the lasers and their reactors (the holds go – tiny cargo = slow trips). */
const keepForQuote = (p: PlacedPart): boolean => isMiningKey(keyOf(p)) || p.partId === 'reactor';

export interface QuoteSurvey {
  seed: number;
  offers: { type: string; starter: number; noLaser: number; minimal: number }[];
  /** Highest stripped/starter reward ratio. */
  maxRatio: number;
}

/** Quotes of the home board for the starter ship, without lasers and for the minimal ship with a laser. */
export function quoteSurvey(seed: number): QuoteSurvey {
  const base = new Driver(newGame(seed, 'mild'));
  const st = base.docked()!;
  const offers = currentBoard(base.state, st).offers;
  const noLaser = new Driver(cloneSim(base.sim));
  noLaser.commit(noLaser.state.player.grid.parts.filter((p) => isMiningKey(keyOf(p))).map((p) => ({ op: 'remove' as const, id: p.id })));
  const minimal = new Driver(cloneSim(base.sim));
  minimal.stripToMinimum(keepForQuote);
  const rows = offers.map((o) => ({
    type: o.target.kind === 'mining' || o.target.kind === 'delivery' ? `${o.type} ${o.target.amount} u` : o.type,
    starter: quoteOffer(base.state, o).reward,
    noLaser: quoteOffer(noLaser.state, o).reward,
    minimal: quoteOffer(minimal.state, o).reward,
  }));
  const maxRatio = Math.max(1, ...rows.map((r) => Math.max(r.noLaser, r.minimal) / Math.max(1, r.starter)));
  return { seed, offers: rows, maxRatio };
}

export function contractInflation(seed: number, seconds: number): LoopResult {
  const penalty: DeathPenalty = 'mild';
  const honest = baseline(seed, penalty, seconds);
  const d = new Driver(newGame(seed, penalty));
  let extra = 0;
  let accepted = 0;
  let firstGain: number | null = null;
  const onDocked = (dd: Driver): void => {
    const st = dd.docked();
    if (!st?.services.shipyard || dd.state.career.contracts.length >= 3) return;
    const offers = currentBoard(dd.state, st).offers.filter(acceptable);
    if (!offers.length) return;
    const honestQuotes = new Map(offers.map((o) => [o.id, quoteOffer(dd.state, o).reward]));
    const design = cloneGrid(dd.state.player.grid);
    if (!dd.stripToMinimum(keepForQuote)) return;
    for (const o of offers) {
      if (dd.state.career.contracts.length >= 3) break;
      const reward = quoteOffer(dd.state, o).reward;
      if (dd.act({ type: 'acceptContract', offerId: o.id })) {
        accepted++;
        extra += reward - (honestQuotes.get(o.id) ?? reward);
        firstGain ??= dd.state.tick;
      }
    }
    // rebuild the same ship from the parts now in storage (install fees only)
    const ops = restoreOps(dd.state.player.grid, design);
    if (ops.length && !dd.commit(ops)) dd.counts.restoreFailed = (dd.counts.restoreFailed ?? 0) + 1;
    // the stripped tank lost its fuel – buy what the credits allow (the pilot only buys a full tank)
    dd.refuel();
  };
  const run = runPilot(d, seconds, { onDocked });
  return {
    id: 'contractInflation',
    seed,
    penalty,
    seconds: run.seconds,
    gain: run.worthEnd - run.worthStart,
    perHour: run.perHour,
    baselinePerHour: honest.perHour,
    help: { contractsAccepted: accepted, contractsCompleted: d.counts.contractCompleted ?? 0 },
    exploit: extra > 0,
    tick: firstGain,
    metrics: { extraReward: extra, accepted, extraPerHour: (extra * 3600) / run.seconds },
    detail: `${accepted} mining contracts accepted on a stripped ship: +${round(extra)} kr of frozen reward above the honest quotes; rebuild failures ${d.counts.restoreFailed ?? 0}; mined ${round(run.mined)} u${run.aborted ? `; pilot aborted: ${run.aborted}` : ''}`,
  };
}

// ------------------------------------------------------------------------------------------------
// E4 – free teleport on the "none" penalty: full hold far from home → abandon ship (cargo is kept,
// the tank refilled, every part repaired) instead of flying back

export function noneTeleport(seed: number, seconds: number): LoopResult {
  const penalty: DeathPenalty = 'none';
  const honest = baseline(seed, penalty, seconds);
  const d = new Driver(newGame(seed, penalty));
  let firstGain: number | null = null;
  const inFlight = (dd: Driver, pilot: { mode: string }): boolean => {
    const p = dd.state.player;
    if (pilot.mode !== 'return' || cargoUsed(p.cargo) < 0.6 * p.props.cargoCapacity) return false;
    const st = dd.nearestStation((s) => s.services.shipyard && s.services.market);
    if (!st || dist(st.pos, p.body.pos) < 300) return false;
    if (!dd.scuttle()) return false;
    firstGain ??= dd.state.tick;
    return true;
  };
  const run = runPilot(d, seconds, { inFlight });
  return {
    id: 'noneTeleport',
    seed,
    penalty,
    seconds: run.seconds,
    gain: run.worthEnd - run.worthStart,
    perHour: run.perHour,
    baselinePerHour: honest.perHour,
    help: { death: d.counts.death ?? 0 },
    exploit: run.perHour > honest.perHour * 1.02,
    tick: firstGain,
    metrics: { scuttles: d.counts.death ?? 0, uplift: honest.perHour > 0 ? run.perHour / honest.perHour - 1 : 0 },
    detail: `${d.counts.death ?? 0} scuttles on the way home (tow fee ${round(-(d.credits.tow ?? 0))} kr in total, cargo kept when paid, the ship as it was); honest ${round(honest.perHour)} kr/h vs ${round(run.perHour)} kr/h`,
  };
}

// ------------------------------------------------------------------------------------------------
// E5 – emergency fuel ration: free fuel can only be burnt (fuel is not sellable) – the most it can
// save is the refuel bill of an honest hour

export function rationCheck(seed: number): LoopResult {
  const d = new Driver(newGame(seed, 'mild'));
  const w0 = netWorth(d.state).total;
  d.stripToMinimum();
  d.sellStorageParts();
  d.burnCredits();
  const w1 = netWorth(d.state).total;
  // burn the tank down outside, come back, take the ration – repeatedly
  let rations = 0;
  const home = homeStation();
  for (let i = 0; i < 4; i++) {
    d.undock();
    const out = { x: home.pos.x + 120, y: home.pos.y + 40 };
    d.flyTo(out, { seconds: 60, until: () => d.state.player.fuel < d.state.player.props.fuelCapacity * 0.2 });
    d.flyTo({ x: home.pos.x - 120, y: home.pos.y - 40 }, { seconds: 60, until: () => d.state.player.fuel < d.state.player.props.fuelCapacity * 0.2 });
    if (!d.dockAt(home, 120)) {
      if (!d.tow()) break;
    }
    if (d.act({ type: 'refuel', source: 'emergency', amount: 'full' })) rations++;
  }
  const gain = netWorth(d.state).total - w1;
  const fuelValue = d.state.player.props.fuelCapacity * EMERGENCY_FUEL_FRACTION * FUEL_BASE_PRICE * RING_SERVICE_MULT[1];
  return {
    id: 'rationCheck',
    seed,
    penalty: 'mild',
    seconds: d.state.tick / TPS,
    gain,
    perHour: 0,
    baselinePerHour: null,
    help: { ration: rations, towFree: d.counts.towFree ?? 0 },
    exploit: gain > 0,
    tick: null,
    detail: `liquidated ${round(w0)} → ${round(w1)} kr; ${rations} free rations (≈ ${round(fuelValue)} kr of fuel each) and ${d.counts.towFree ?? 0} free tows changed the net worth by ${round(gain)} kr – fuel cannot be sold`,
  };
}

// ------------------------------------------------------------------------------------------------
// E6 – paid tow as fast travel: tow cost vs. the honest time value of flying home

export interface TowRow {
  distance: number;
  cost: number;
  flightSeconds: number;
  /** Income per hour above which towing home (from an empty tank) beats flying home. */
  breakEvenPerHour: number;
}

export function towFastTravel(): TowRow[] {
  const cruise = 50;
  // a paid tow no longer tops the tank up for free (X7) – only a free (broke) tow does
  return [600, 1200, 1800, 2400, 3000].map((distance) => {
    const cost = towCost(distance);
    const flightSeconds = distance / cruise + 10;
    const fuelCost = distance * 0.004 * FUEL_BASE_PRICE;
    return { distance, cost, flightSeconds, breakEvenPerHour: round(((cost - fuelCost) * 3600) / flightSeconds) };
  });
}

// ------------------------------------------------------------------------------------------------
// E7 – contract accept / free cancel loop (control)

export function cancelLoop(seed: number): LoopResult {
  const d = new Driver(newGame(seed, 'mild'));
  const st = d.docked()!;
  const w0 = netWorth(d.state).total;
  const credits0 = d.state.credits;
  let loops = 0;
  let rewardDrift = 0;
  for (let i = 0; i < 5; i++) {
    const offer = currentBoard(d.state, st).offers[0];
    if (!offer) break;
    const q = quoteOffer(d.state, offer).reward;
    if (!d.act({ type: 'acceptContract', offerId: offer.id })) break;
    const c = d.state.career.contracts[d.state.career.contracts.length - 1]!;
    rewardDrift = Math.max(rewardDrift, c.reward - q);
    d.idle(30);
    d.act({ type: 'abandonContract', contractId: c.serial });
    loops++;
  }
  const gain = netWorth(d.state).total - w0;
  return {
    id: 'cancelLoop',
    seed,
    penalty: 'mild',
    seconds: d.state.tick / TPS,
    gain,
    perHour: 0,
    baselinePerHour: null,
    help: { cancels: loops },
    exploit: gain > 0 || d.state.credits > credits0 || rewardDrift > 0,
    tick: null,
    detail: `${loops} accept → free cancel loops: credits ${credits0} → ${d.state.credits}, reward drift ${rewardDrift}`,
  };
}

// ------------------------------------------------------------------------------------------------
// E8 – contracts paying an exclusive part: reward + part sold vs. the credit-only reward

export interface PartRewardRow {
  seed: number;
  station: string;
  part: PartKey;
  creditOnly: number;
  reward: number;
  partSell: number;
  /** (reward + part sell value) / credit-only reward. */
  ratio: number;
  /** The part was worth more than the reward and is not paid (credits only). */
  dropped: boolean;
}

export function partRewardSurvey(seed: number, epochs = 6): PartRewardRow[] {
  const d = new Driver(newGame(seed, 'mild'));
  const [g1, g2] = guaranteedStationChunks(seed);
  const stations: StationDef[] = [homeStation(), stationAt(seed, g1.cx, g1.cy), stationAt(seed, g2.cx, g2.cy)].filter((s): s is StationDef => !!s);
  const rows: PartRewardRow[] = [];
  for (let e = 0; e < epochs; e++) {
    for (const st of stations) {
      for (const o of currentBoard(d.state, st).offers) {
        if (!o.part) continue;
        const quote = quoteOffer(d.state, o);
        const creditOnly = quoteOffer(d.state, { ...o, part: null }).reward;
        // the quote drops a part worth more than the whole reward – then the contract pays credits only
        const partSell = quote.part ? partSellPrice(quote.part) : 0;
        rows.push({ seed, station: st.id, part: o.part, creditOnly, reward: quote.reward, partSell, ratio: (quote.reward + partSell) / Math.max(1, creditOnly), dropped: !quote.part });
      }
    }
    d.idle(30 * 60); // next board epoch
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------
// E9 – buy here, sell there: resource round-trips between the guaranteed stations (demand bonus incl.)

export interface ArbitrageRow {
  resource: ResourceId;
  buyAt: string;
  sellAt: string;
  buy: number;
  sell: number;
  sellWithDemand: number;
  /** kr per unit with the demand bonus (≤ DEMAND_CAP units per station and sector epoch). */
  margin: number;
}

export function arbitrageSurvey(seed: number): ArbitrageRow[] {
  const [g1, g2] = guaranteedStationChunks(seed);
  const stations: StationDef[] = [homeStation(), stationAt(seed, g1.cx, g1.cy), stationAt(seed, g2.cx, g2.cy)].filter((s): s is StationDef => !!s);
  const rows: ArbitrageRow[] = [];
  for (const r of RESOURCE_IDS) {
    for (const a of stations) {
      for (const b of stations) {
        const buy = resourcePrice(r, a.ring, a.priceJitter[r]).buy;
        const sell = resourcePrice(r, b.ring, b.priceJitter[r]).sell;
        const sellWithDemand = sell * (1 + DEMAND_BONUS);
        rows.push({ resource: r, buyAt: a.id, sellAt: b.id, buy, sell, sellWithDemand, margin: sellWithDemand - buy });
      }
    }
  }
  return rows.sort((x, y) => y.margin - x.margin);
}

export const ARBITRAGE_CAP = DEMAND_CAP;

// ------------------------------------------------------------------------------------------------
// E10 – a Guild loan survives save → load as a loan (control): the flag is saved, so a reload never
// turns a lent part into an owned one, and no second loan appears

export function saveLoadKit(seed: number): LoopResult {
  const d = new Driver(newGame(seed, 'mild'));
  liquidate(d);
  d.idle(1);
  const loans = d.state.player.grid.parts.filter((p) => p.loan).length;
  const worth = netWorth(d.state).total;
  const reloaded = new Driver(cloneSim(d.sim));
  reloaded.idle(5);
  const after = reloaded.state.player.grid.parts.filter((p) => p.loan).length;
  const gain = netWorth(reloaded.state).total - worth;
  return {
    id: 'saveLoadKit',
    seed,
    penalty: 'mild',
    seconds: reloaded.state.tick / TPS,
    gain,
    perHour: 0,
    baselinePerHour: null,
    help: { guildLoan: (d.counts.guildLoan ?? 0) + (reloaded.counts.guildLoan ?? 0) },
    exploit: after !== loans || gain > 0 || (reloaded.counts.guildLoan ?? 0) > 0,
    tick: null,
    detail: `loan parts before the save: ${loans}, after save → load: ${after}; new loans after the load: ${reloaded.counts.guildLoan ?? 0}; net worth ${round(gain)} kr`,
  };
}

// ------------------------------------------------------------------------------------------------
// S1 – sell everything, burn the credits, then recover with the safety nets only

export interface RecoveryResult {
  seed: number;
  penalty: DeathPenalty;
  /** Net worth before / after the liquidation. */
  worthStart: number;
  worthLiquidated: number;
  /** Game seconds from the end of the liquidation until the ship could mine again. */
  shipReady: number | null;
  /** … until the first sale of mined ore. */
  firstSale: number | null;
  recovered: boolean;
  kits: number;
  rations: number;
  /** What the recovery used (kit / scuttle / bought). */
  route: string;
  /** Net worth after the recovery window and the honest play after it. */
  worthEnd: number;
  /** Net worth of the honest baseline after the same total time. */
  detail: string;
}

/** The minimal liquidation: strip, sell parts, cargo and storage, burn the credits on round-trips. */
export function liquidate(d: Driver): void {
  d.stripToMinimum();
  d.sellStorageParts();
  d.sellCargo();
  d.burnCredits();
}

const canMine = (d: Driver): boolean => {
  const p = d.state.player.props;
  return p.lasers.length > 0 && p.thrust.forward > 0 && p.cargoCapacity > 0;
};

/**
 * Honest recovery at home with the safety nets only: mount a laser from storage (the emergency kit),
 * or buy one when affordable; when even the install fee is missing, sell the kit and wait for the
 * next one (the only way without credits). Fuel: credits, else the emergency ration.
 */
export function recoverAtHome(d: Driver, seconds: number): { ready: boolean; route: string } {
  const end = d.state.tick + Math.round(seconds * TPS);
  let route = '';
  while (d.state.tick < end) {
    const st = d.docked();
    if (!st) return { ready: canMine(d), route: route || 'not docked' };
    if (canMine(d)) break;
    const storage = d.state.stations.get(st.id)?.parts ?? {};
    const spare = (Object.entries(storage) as [PartKey, number][]).find(([k, n]) => n > 0 && isMiningKey(k));
    if (d.state.player.props.lasers.length === 0) {
      if (spare && d.state.credits >= INSTALL_FEE) {
        if (d.placePart(spare[0])) route += 'spare laser mounted; ';
        else d.idle(1);
      } else if (spare) {
        // a spare in reach blocks the Guild loan: sell it (the loan follows when that leaves the player poor)
        d.sellStorageParts(isMiningKey);
        route += 'spare laser sold; ';
      } else if (d.state.credits >= (partBuyPrice(LOAN_LASER_KEY, st.ring) ?? Infinity) + INSTALL_FEE) {
        if (d.placePart(LOAN_LASER_KEY)) route += 'laser bought; ';
        else d.idle(1);
      } else d.idle(2);
    } else d.idle(2);
  }
  // fuel
  const p = d.state.player;
  if (p.fuel < p.props.fuelCapacity - 0.5) {
    if (!d.act({ type: 'refuel', source: 'credits', amount: 'full' })) d.act({ type: 'refuel', source: 'emergency', amount: 'full' });
  }
  return { ready: canMine(d), route: route || 'nothing needed' };
}

export function liquidateAndRecover(seed: number, penalty: DeathPenalty, seconds: number): RecoveryResult {
  const d = new Driver(newGame(seed, penalty));
  const worthStart = netWorth(d.state).total;
  const kits0 = d.counts.guildLoan ?? 0;
  liquidate(d);
  const worthLiquidated = netWorth(d.state).total;
  const t0 = d.state.tick;
  const lentInLiquidation = (d.counts.guildLoan ?? 0) - kits0;
  const rec = recoverAtHome(d, Math.min(seconds, 30 * 60));
  if (lentInLiquidation > 0) rec.route = `Guild loan mounted during the liquidation (${Object.keys(d.kitParts).join(', ')}); ${rec.route === 'nothing needed' ? '' : rec.route}`;
  const shipReady = rec.ready ? (d.state.tick - t0) / TPS : null;
  let firstSale: number | null = null;
  let worthEnd = netWorth(d.state).total;
  let aborted: string | null = null;
  if (rec.ready) {
    const left = seconds - (d.state.tick - t0) / TPS;
    const run = runPilot(d, Math.max(60, left));
    if (run.firstOreSale !== null) firstSale = shipReady! + run.firstOreSale;
    worthEnd = run.worthEnd;
    aborted = run.aborted;
  }
  return {
    seed,
    penalty,
    worthStart,
    worthLiquidated,
    shipReady,
    firstSale,
    recovered: firstSale !== null,
    kits: (d.counts.guildLoan ?? 0) - kits0,
    rations: 0,
    route: rec.route.trim(),
    worthEnd,
    detail: aborted ? `pilot aborted: ${aborted}` : `ship: ${d.state.player.grid.parts.map((x) => keyOf(x)).join(', ')}`,
  };
}

// ------------------------------------------------------------------------------------------------
// E11 – part duplication on the "none" penalty: knock a part off your own ship, load it from the
// wreck, abandon ship – the respawn restores the docked layout (with that part) and keeps the part
// on board (salvage counts as cargo, which "none" keeps)

/** Loads the nearest wreck that carries parts (flies next to it and presses F). */
export function salvageNearestWreck(d: Driver, seconds = 120): boolean {
  const end = d.state.tick + seconds * TPS;
  while (d.state.tick < end && d.state.player.dock.mode === 'flying') {
    const p = d.state.player;
    const wreck = d.state.combat.wrecks
      .filter((w) => Object.values(w.loot.parts).some((n) => (n ?? 0) > 0))
      .sort((a, b) => dist(a.body.pos, p.body.pos) - dist(b.body.pos, p.body.pos))[0];
    if (!wreck) return false;
    const gap = dist(wreck.body.pos, p.body.pos) - wreck.props.boundingRadius - p.props.boundingRadius;
    if (gap <= 4 && Math.hypot(p.body.vel.x - wreck.body.vel.x, p.body.vel.y - wreck.body.vel.y) < 6) {
      const before = Object.keys(p.salvage).length;
      d.step({ ...IDLE_COMMAND, dock: true, aim: { ...p.body.pos } });
      d.step();
      if (Object.keys(d.state.player.salvage).length > before) return true;
      continue;
    }
    // chase: aim a little ahead of the drifting wreck and arrive with its speed
    const side = norm({ x: p.body.pos.x - wreck.body.pos.x, y: p.body.pos.y - wreck.body.pos.y });
    const r = wreck.props.boundingRadius + p.props.boundingRadius + 2;
    const wv = Math.hypot(wreck.body.vel.x, wreck.body.vel.y);
    const lead = { x: wreck.body.pos.x + wreck.body.vel.x * 0.5 + side.x * r, y: wreck.body.pos.y + wreck.body.vel.y * 0.5 + side.y * r };
    const tick = d.state.tick;
    d.flyTo(lead, { seconds: 0.5, maxSpeed: Math.max(15, wv + 15), arriveSpeed: wv });
    // flyTo returns at once when already "there" – match the drifting wreck instead of spinning
    if (d.state.tick === tick) d.step();
  }
  return false;
}

export function noneSalvageDupe(seed: number, penalty: DeathPenalty = 'none'): LoopResult {
  const d = new Driver(newGame(seed, penalty));
  const w0 = netWorth(d.state).total;
  const grid = d.state.player.grid;
  // bow: laser at (2,0); its upper neighbour (2,1) is a backward engine → move the cannon there
  const backUpper = grid.parts.find((p) => p.partId === 'engine' && p.x === 2 && p.y === 1);
  const ops: EditorOp[] = [];
  if (backUpper) ops.push({ op: 'remove', id: backUpper.id });
  ops.push({ op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 }, { op: 'place', key: 'cannon:1', x: 3, y: 1, rot: 0 });
  const built = d.commit(ops);
  const notes: string[] = [built ? 'bow armor (3,0) holds a cannon (3,1)' : 'could not build the bow'];
  let hit = false;
  for (let i = 0; i < 4 && built; i++) {
    hit = ram(d, false, 62) || hit;
    const cannon = d.state.player.grid.parts.some((p) => p.partId === 'cannon');
    if (!cannon) break;
  }
  const loaded = salvageNearestWreck(d);
  notes.push(`ram ${hit ? 'hit' : 'missed'}; cannon on board ${d.state.player.grid.parts.some((p) => p.partId === 'cannon')}; loaded from the wreck ${loaded} (${JSON.stringify(d.state.player.salvage)})`);
  const tick = d.state.tick;
  const before = netWorth(d.state).total;
  d.scuttle();
  const after = netWorth(d.state).total;
  const storage = d.state.stations.get(HOME_STATION_ID)?.parts ?? {};
  notes.push(`after scuttle: ship ${d.state.player.grid.parts.map((p) => keyOf(p)).join(',')}; home storage ${JSON.stringify(storage)}`);
  const gain = after - w0;
  return {
    id: 'noneSalvageDupe',
    seed,
    penalty,
    seconds: d.state.tick / TPS,
    gain,
    perHour: (gain * 3600) / (d.state.tick / TPS),
    baselinePerHour: null,
    help: { death: d.counts.death ?? 0 },
    exploit: loaded && after > before + 1,
    tick,
    metrics: { cycleSeconds: d.state.tick / TPS, perCycle: after - before },
    detail: notes.join('; '),
  };
}

// ------------------------------------------------------------------------------------------------
// E12 – coverage farm (sectors 1b, control): chart a nearby depth-1 sector by flight, then fly its
// explored chunks again and again, also after a save → load – the flat charting Data come once per
// sector (derived from `explored`, which never shrinks), so the farming pays nothing

export function coverageFarm(seed: number, seconds = 15 * 60): LoopResult {
  const d = new Driver(newGame(seed, 'mild'));
  const charted: string[] = [];
  let chartData = 0;
  const tap = (e: SimEvent): void => {
    if (e.type === 'sectorCharted') charted.push(e.id);
    if (e.type === 'dataGained' && e.source === 'chart') chartData += e.amount;
  };
  d.onEvent = tap;
  d.undock();
  const world = regionWorld(seed);
  const target = world.regions
    .filter((r) => r.seed.depth === 1 && !r.seed.origin && r.seed.id !== world.corners.depth1 && sectorInfo(seed, r.seed.id)?.startKnowledge !== 'charted')
    .sort((a, b) => Math.hypot(a.seed.x, a.seed.y) - Math.hypot(b.seed.x, b.seed.y))[0];
  const notes: string[] = [];
  if (!target) notes.push('no depth-1 sector to chart');
  const id = target?.seed.id ?? '';
  // a lawnmower path over the sector's chunks (every third row and column – the 3 × 3 explore window covers the rest)
  const path = sectorChunkKeys(seed, id)
    .map((k) => k.split(',').map(Number) as [number, number])
    .filter(([cx, cy]) => ((cx % 3) + 3) % 3 === 1 && ((cy % 3) + 3) % 3 === 1)
    .sort((a, b) => a[1] - b[1] || (a[1] % 2 === 0 ? a[0] - b[0] : b[0] - a[0]))
    .map(([cx, cy]) => ({ x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE }));
  const end = Math.round(seconds * TPS);
  const lap = (drv: Driver): void => {
    const t0 = drv.state.tick;
    for (const p of path) {
      if (drv.state.tick >= end || drv.state.player.dock.mode !== 'flying') return;
      drv.flyTo(p, { maxSpeed: 45, arriveSpeed: 20, seconds: 90 });
    }
    // a one-waypoint path is reached at once: keep the clock moving
    if (drv.state.tick === t0) drv.idle(1);
  };
  lap(d);
  const firstLap = { charted: charted.length, data: chartData, knowledge: id ? sectorKnowledge(d.state, id) : 'uncharted' };
  // farm: fly the same chunks again, then save → load and once more
  let laps = 1;
  while (d.state.tick < end / 2 && d.state.player.dock.mode === 'flying' && path.length > 0) {
    lap(d);
    laps++;
  }
  const reloaded = new Driver(cloneSim(d.sim));
  reloaded.onEvent = tap;
  while (reloaded.state.tick < end && reloaded.state.player.dock.mode === 'flying' && path.length > 0) {
    lap(reloaded);
    laps++;
  }
  const sameAgain = charted.filter((x) => x === id).length;
  const expected = target ? chartingData(target.seed.depth) : 0;
  notes.push(`sector ${id || '-'}: ${path.length} waypoints, ${laps} laps; first lap ${firstLap.knowledge}, ${firstLap.charted} charted, ${firstLap.data} D`);
  notes.push(`after farming and a save → load: charted events for it ${sameAgain}, charting Data in total ${chartData} D (expected once ${expected} D, ${charted.length} sectors charted)`);
  return {
    id: 'coverageFarm',
    seed,
    penalty: 'mild',
    seconds: reloaded.state.tick / TPS,
    gain: chartData - firstLap.data,
    perHour: 0,
    baselinePerHour: null,
    help: {},
    // a finding: a sector paid twice (laps between the waypoints may still chart a neighbour from new chunks)
    exploit: sameAgain > 1 || new Set(charted).size !== charted.length,
    tick: null,
    metrics: { laps, chartData, firstLapData: firstLap.data, charted: charted.length },
    detail: notes.join('; '),
  };
}

// ------------------------------------------------------------------------------------------------
// E13 – chart farm (sectors stage 2, control): chart the "First chart" sector by its survey points,
// pulse its points again (also after a save → load), sell its chart twice (also from a save copy),
// buy a Guild chart and try to resell it, and take a `chart` contract on a second sector and try to
// sell its chart on top. Every sector pays its Data once, every chart sells once, the contract covers
// its sale – any second payment is a finding.

/** Fly to a survey point and tap Tab there (pulse); true when the pulse fired. */
function pulseAtPoint(d: Driver, pos: { x: number; y: number }): boolean {
  const near = (): boolean => dist(d.state.player.body.pos, pos) < 120;
  d.flyTo(pos, { maxSpeed: 45, arriveSpeed: 8, seconds: 150, until: near });
  if (!near()) return false;
  d.idleUntil(() => d.state.discovery.scanner.cooldown === 0 && d.state.player.energy >= 40, 20);
  let pulsed = false;
  const tap = d.onEvent;
  d.onEvent = (e, drv) => {
    tap?.(e, drv);
    if (e.type === 'scanPulse') pulsed = true;
  };
  d.step({ ...IDLE_COMMAND, scan: true, aim: { ...d.state.player.body.pos } });
  d.step({ ...IDLE_COMMAND, scan: true, aim: { ...d.state.player.body.pos } });
  d.step();
  d.onEvent = tap;
  return pulsed;
}

export function chartFarm(seed: number): LoopResult {
  const d = new Driver(newGame(seed, 'mild'));
  const notes: string[] = [];
  let chartData = 0;
  const chartedEvents = new Map<string, number>();
  const tap = (e: SimEvent): void => {
    if (e.type === 'dataGained' && e.source === 'chart') chartData += e.amount;
    if (e.type === 'sectorCharted') chartedEvents.set(e.id, (chartedEvents.get(e.id) ?? 0) + 1);
  };
  d.onEvent = tap;
  const home = homeStation();
  const first = firstChartTarget(d.state);
  if (!first) {
    return { id: 'chartFarm', seed, penalty: 'mild', seconds: 0, gain: 0, perHour: 0, baselinePerHour: null, help: {}, exploit: false, tick: null, detail: 'no First chart sector', metrics: {} };
  }
  const id = first.id;
  // 1. survey points of the First chart sector (a pulse at each), then the same points again
  d.undock();
  const points = surveyPoints(seed, id);
  let pulses = 0;
  for (const p of points) if (pulseAtPoint(d, p.pos)) pulses++;
  const chartedOnce = sectorKnowledge(d.state, id) === 'charted';
  const dataOnce = chartData;
  for (const p of points) pulseAtPoint(d, p.pos);
  const copy = new Driver(cloneSim(d.sim));
  copy.onEvent = tap;
  for (const p of points.slice(0, 2)) pulseAtPoint(copy, p.pos);
  const surveyFarmData = chartData - dataOnce;
  // 2. sell the chart, again, and again from a save copy made after the sale
  d.dockAt(home, 300);
  const price = chartSellPrice(seed, id);
  const before = d.state.credits;
  const sold1 = d.act({ type: 'chartSell', sector: id });
  const sold2 = d.act({ type: 'chartSell', sector: id });
  const afterSale = new Driver(cloneSim(d.sim));
  const sold3 = afterSale.act({ type: 'chartSell', sector: id });
  const saleGain = d.state.credits - before;
  // 3. buy a Guild chart (paid from the sale and the starting credits) and try to sell it back
  const guild = regionWorld(seed)
    .regions.filter((r) => chartTrade(seed, r.seed.id) === 'guild' && sectorKnowledge(d.state, r.seed.id) !== 'charted' && chartBuyPrice(seed, r.seed.id) <= d.state.credits)
    .sort((a, b) => Math.hypot(a.seed.x, a.seed.y) - Math.hypot(b.seed.x, b.seed.y))[0];
  const dataBeforeBuy = chartData;
  const bought = guild ? d.act({ type: 'chartBuy', sector: guild.seed.id }) : false;
  const resold = guild ? d.act({ type: 'chartSell', sector: guild.seed.id }) : false;
  const buyData = chartData - dataBeforeBuy;
  // 4. a chart contract: chart its sector, try to sell on top, turn in, sell again
  const offer = currentBoard(d.state, home).offers.find((o) => o.target.kind === 'chart');
  let contractSale = false;
  let contractReward = 0;
  let afterTurnIn = false;
  let contractSector = '-';
  if (offer && offer.target.kind === 'chart' && d.act({ type: 'acceptContract', offerId: offer.id })) {
    const c = d.state.career.contracts.at(-1)!;
    contractSector = offer.target.sector;
    d.undock();
    for (const p of surveyPoints(seed, contractSector)) {
      if (c.ready) break;
      pulseAtPoint(d, p.pos);
    }
    d.dockAt(home, 300);
    contractSale = d.act({ type: 'chartSell', sector: contractSector });
    const c0 = d.state.credits;
    if (d.act({ type: 'turnInContract', contractId: c.serial })) contractReward = d.state.credits - c0;
    afterTurnIn = d.act({ type: 'chartSell', sector: contractSector });
  } else notes.push('no chart contract on the home board');
  const twice = [...chartedEvents.values()].some((n) => n > 1);
  notes.push(`sector ${id}: ${pulses}/${points.length} pulses, charted ${chartedOnce}, ${dataOnce} D; the points again (also from a save copy) ${surveyFarmData} D`);
  notes.push(`sale ${sold1 ? 'ok' : 'refused'} ${saleGain} kr (price ${price}), second sale ${sold2 ? '**paid**' : 'refused'}, from a save copy ${sold3 ? '**paid**' : 'refused'}`);
  notes.push(`Guild chart ${guild?.seed.id ?? '-'} bought ${bought}, resold ${resold ? '**paid**' : 'refused'}, Data from the purchase ${buyData} D`);
  notes.push(`chart contract ${contractSector}: sale on top ${contractSale ? '**paid**' : 'refused'}, reward ${contractReward} kr, sale after turn-in ${afterTurnIn ? '**paid**' : 'refused'}`);
  return {
    id: 'chartFarm',
    seed,
    penalty: 'mild',
    seconds: d.seconds,
    gain: (sold2 || sold3 ? price : 0) + (resold ? 1 : 0) + surveyFarmData + buyData,
    perHour: 0,
    baselinePerHour: null,
    help: {},
    exploit: sold2 || sold3 || resold || contractSale || afterTurnIn || twice || surveyFarmData > 0 || buyData > 0 || (sold1 && saleGain !== price),
    tick: null,
    metrics: { pulses, points: points.length, charted: chartedOnce ? 1 : 0, chartData: dataOnce, surveyFarmData, saleGain, price, contractReward, bought: bought ? 1 : 0 },
    detail: notes.join('; '),
  };
}
