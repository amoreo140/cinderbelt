// Saboteur probes for M4d "Guild and Trade" (task T16): every new
// money path of the Guild and the Free Traders – the convoy trade (cargo sale at 0.9 ×, the 200 u cap per pass,
// refined ore under the W1 ceiling, rare items, tanker fuel), the escort contract (deposit, free cancel, arrival,
// failure), the Guild relay contract (one reward per lane, the hold), the Guild Watch (no friendly fire, no loot of
// its kills), map notes and the convoy link (a free ride). Each probe plays the real simulation through actions
// and flight and must gain nothing. Setup steps that would take hours of play (credits, Guild level 2, a game at
// the tick of a convoy pass, the approach to a moving trade port, the 5 s laser charge of a relay, cargo aboard)
// are written directly like in the fleet / home probes; fights are resolved by lethal player shots (the player's
// guns hitting – what is measured is what the kills pay), flights along a convoy by carrying the ship beside the
// trader. Every gain is measured after the setup, through real actions.
import { archiveNode } from '../../../src/data/archive';
import { BOARD_MAX_OFFERS, FREE_CANCEL_TICKS, HUNT_SECONDS_PER_ENEMY } from '../../../src/data/contracts';
import { CONVOY, ESCORT } from '../../../src/data/convoys';
import { fuelUnitPrice, partSellPrice, purchaseCost, resourcePrice, saleValue, type RingIndex } from '../../../src/data/economy';
import type { RepUnlock } from '../../../src/data/factions';
import { RELAY_CHAIN } from '../../../src/data/guild';
import { NOTES } from '../../../src/data/navigation';
import type { PartKey } from '../../../src/data/parts';
import { RESOURCE_IDS, type ResourceId } from '../../../src/data/resources';
import { cheapestBuy, REFINED_CEILING } from '../../../src/data/workshop';
import type { Contract, ContractOffer } from '../../../src/sim/career/types';
import type { Wreck } from '../../../src/sim/combat/types';
import { IDLE_COMMAND, type GameActionInput } from '../../../src/sim/commands';
import { boardContext, boardEpoch, currentBoard, ensureBoard } from '../../../src/sim/contracts/board';
import { besideTrader } from '../../../src/sim/convoys/convoyTesting';
import { AMBUSH_LEAD, escortAvailable, escortHitTargets, escortOffer } from '../../../src/sim/convoys/escort';
import { linkPose } from '../../../src/sim/convoys/link';
import { convoyAt, convoyComposition, convoyPassWindow } from '../../../src/sim/convoys/schedule';
import { convoyFuelUnit, convoyOffer, convoySellUnit } from '../../../src/sim/convoys/trade';
import { teleport } from '../../../src/sim/discovery/testing';
import { guildRelaySite, MAST_RADIUS } from '../../../src/sim/guild/relaySites';
import { watchFightGame } from '../../../src/sim/save/guildTesting';
import { createRng } from '../../../src/sim/math/rng';
import type { Vec2 } from '../../../src/sim/math/vec2';
import type { LaneId } from '../../../src/sim/regions';
import { loadSave } from '../../../src/sim/save/load';
import { restoreSimulation, toEnvelope, toSave } from '../../../src/sim/save/serialize';
import { currentHp } from '../../../src/sim/ship/hp';
import { refinedSaleValue, refinedUnit } from '../../../src/sim/ship/workshop';
import { Simulation, type SimEvent } from '../../../src/sim/Simulation';
import { CHUNK_SIZE } from '../../../src/sim/world/chunks';
import { ringIndexAt } from '../../../src/sim/world/rings';
import { homeStation, stationsInArea, type StationDef } from '../../../src/sim/world/stations';
import { homeSellPrice } from '../pilot';
import { cloneSim, Driver, TPS } from './harness';
import type { LoopResult } from './scenarios';
import { netWorth } from './value';

/** Tolerance of the credit comparisons (credits are integers, sales round down once). */
const EPS = 1;
const ORES: readonly ResourceId[] = ['iron', 'copper', 'titanium'];
const LANES: readonly LaneId[] = ['A', 'B'];
const UNLOCKS = new Set<RepUnlock>(['contractsBasic', 'contractsRing1', 'contractsRing2']);
/** A human's cruise between a station and a meeting point / a mast (u/s) – flights the probes skip are timed with it. */
const CRUISE = 40;
const r1 = (x: number): string => (Math.round(x * 10) / 10).toString();
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const sum = (xs: Iterable<number>): number => {
  let s = 0;
  for (const x of xs) s += x;
  return s;
};

const result = (id: string, seed: number, d: Driver | null, gain: number, broken: string[], detail: string, metrics: Record<string, number>, perHour = 0): LoopResult => ({
  id,
  seed,
  penalty: 'mild',
  seconds: d ? d.state.tick / TPS : 0,
  gain,
  perHour,
  baselinePerHour: null,
  help: {},
  exploit: broken.length > 0 || gain > EPS,
  tick: broken.length && d ? d.state.tick : null,
  detail: broken.length ? `BROKEN: ${broken.join('; ')} – ${detail}` : detail,
  metrics,
});

function saveOf(d: Driver): ReturnType<typeof toSave> {
  return toSave(d.sim, { gameId: 'g', name: 'g', createdAt: '2026-10-17T10:00:00.000Z', savedAt: '2026-10-17T10:00:00.000Z', reason: 'manual', gameVersion: 'bot' });
}

/** Loads a (crafted) save through the real load path; the restored game or the refusal. */
function loadCrafted(save: ReturnType<typeof toSave>): { d: Driver | null; error: string | null } {
  const loaded = loadSave(toEnvelope(save));
  return loaded.ok ? { d: new Driver(restoreSimulation(loaded.save)), error: null } : { d: null, error: loaded.error };
}

const reasonOf = (r: { ok: boolean; reason?: string }): string => (r.ok ? 'ok' : (r.reason ?? '?'));

// ------------------------------------------------------------------------------------------------
// convoy helpers

/** The convoy trader's ring at a tick (null: the pass is not in flight). */
function traderRing(seed: number, pass: string, tick: number): RingIndex | null {
  const pose = convoyAt(seed, pass, tick);
  if (!pose) return null;
  const t = pose.ships[0]!.pos;
  return ringIndexAt(Math.hypot(t.x, t.y));
}

/** Setup: the ship carried beside the trade port of `pass` (the approach to a moving port skipped), F pressed (real). */
function linkHere(d: Driver, pass: string): boolean {
  const pose = convoyAt(d.state.seed, pass, d.state.tick + 1);
  if (!pose) return false;
  const p = d.state.player;
  const to = linkPose(pose, p.props.boundingRadius + 1);
  const body = { pos: to.pos, vel: { ...pose.vel }, angle: to.angle, angVel: 0 };
  p.body = body;
  p.prevBody = body;
  d.state.world.update(to.pos);
  d.step({ ...IDLE_COMMAND, dock: true });
  return d.state.convoys.link?.pass === pass;
}

/**
 * A fresh game at the tick of a convoy pass whose trader flies in `ring` (setup: the game moved to that tick, the
 * ship beside the trade port), linked through a real F press; `tanker` picks passes with / without a tanker.
 */
function linkedInRing(seed: number, ring: RingIndex, tanker?: boolean): { d: Driver; pass: string } | null {
  for (const lane of LANES) {
    for (let n = 1; n <= 6; n++) {
      if (tanker !== undefined && convoyComposition(seed, lane, n).tanker !== tanker) continue;
      const pass = `cv:${lane}@${n}`;
      const w = convoyPassWindow(seed, pass);
      if (!w) continue;
      for (let tick = w.depart + 30 * 60; tick < w.end - 60 * 60; tick += 20 * 60) {
        if (tick > w.turn - 30 * 60 && tick < w.back + 5 * 60) continue;
        if (traderRing(seed, pass, tick) !== ring) continue;
        let sim: Simulation;
        try {
          sim = besideTrader(seed, pass, tick);
        } catch {
          continue;
        }
        const d = new Driver(sim);
        d.step({ ...IDLE_COMMAND, dock: true });
        if (d.state.convoys.link?.pass === pass) return { d, pass };
      }
    }
  }
  return null;
}

/** One convoy action; its result and the credits it moved. */
function convoyAct(d: Driver, action: GameActionInput): { ok: boolean; reason?: string; credits: number } {
  const before = d.state.credits;
  const r = d.attempt(action);
  return { ok: r.ok, ...(r.reason ? { reason: r.reason } : {}), credits: d.state.credits - before };
}

/** Value of a pirate wreck's loot at liquidation prices (cargo at the home sell price, parts at the buy-back). */
const lootValue = (w: Wreck): number =>
  sum(RESOURCE_IDS.map((r) => (w.loot.cargo[r] ?? 0) * homeSellPrice(r))) + sum((Object.entries(w.loot.parts) as [PartKey, number][]).map(([k, n]) => partSellPrice(k) * (n ?? 0)));

/**
 * Lethal shots of the player at an enemy (setup for a fight: the player's guns hitting): a player-owned projectile
 * fired from just outside the target's shield at a time until it is destroyed. Returns the loot value of the wrecks
 * the kill left (null: not destroyed).
 */
function killByPlayer(d: Driver, id: string, shots = 12, owner = 'player'): number | null {
  const before = new Set(d.state.combat.wrecks.map((w) => w.id));
  for (let i = 0; i < shots; i++) {
    const e = d.state.combat.enemies.find((x) => x.id === id);
    if (!e) break;
    const p = d.state.player.body.pos;
    const away = Math.hypot(p.x - e.body.pos.x, p.y - e.body.pos.y) || 1;
    const u = { x: (p.x - e.body.pos.x) / away, y: (p.y - e.body.pos.y) / away };
    const r = e.props.boundingRadius + 4;
    const from = { x: e.body.pos.x + u.x * r, y: e.body.pos.y + u.y * r };
    d.state.combat.projectiles.push({ id: d.state.combat.nextId++, owner, pos: from, vel: { x: e.body.vel.x - u.x * 300, y: e.body.vel.y - u.y * 300 }, ttl: 20, damage: 5000, tier: 1, origin: { ...from } });
    d.step();
  }
  if (d.state.combat.enemies.some((x) => x.id === id)) return null;
  return sum(d.state.combat.wrecks.filter((w) => !before.has(w.id) && w.cls === 'pirate').map(lootValue));
}

// ------------------------------------------------------------------------------------------------
// C1 – convoy arbitrage: buy ore at a station (real, at home) → sell it at a passing convoy; the convoy sale in
// rings 1–3 against the station sale of the ring and the cheapest buy anywhere (raw and refined – the W1 ceiling).

export function convoyArbitrage(seed: number): LoopResult {
  const broken: string[] = [];
  const notes: string[] = [];
  let worst = -Infinity;
  let worstRatio = 0;
  const metrics: Record<string, number> = {};

  // (1) the real loop at home: tick 0, the first lane-A trader departs 320 u past home
  const d = new Driver(new Simulation({ seed }));
  d.state.credits += 20_000;
  const QTY = 30;
  let cost = 0;
  for (const r of [...ORES, 'ice'] as ResourceId[]) {
    const c0 = d.state.credits;
    d.act({ type: 'buyResource', resource: r, qty: QTY }, { type: 'transfer', resource: r, qty: QTY, to: 'ship' });
    cost += c0 - d.state.credits;
  }
  d.undock();
  const pass0 = LANES.map((l) => `cv:${l}@0`).find((p) => convoyAt(seed, p, d.state.tick + 1) !== null);
  if (pass0 && linkHere(d, pass0)) {
    const ring = convoyOffer(d.state, pass0)!.ring;
    let got = 0;
    let station = 0;
    for (const r of [...ORES, 'ice'] as ResourceId[]) {
      const qty = d.state.player.cargo[r];
      const s = convoyAct(d, { type: 'convoySell', resource: r, qty: 'all' });
      got += s.credits;
      station += saleValue(qty, resourcePrice(r, ring, 1).sell);
      const expect = saleValue(qty, convoySellUnit(r, ring));
      if (Math.abs(s.credits - expect) > EPS) broken.push(`home loop: ${r} paid ${s.credits}, the convoy price says ${expect}`);
    }
    worst = Math.max(worst, got - cost);
    worstRatio = Math.max(worstRatio, got / Math.max(1, station));
    notes.push(`home → ${pass0} (P${ring}): bought ${4 * QTY} u for ${cost} kr, sold to the convoy for ${got} kr (${got - cost} kr; ${(got / Math.max(1, station)).toFixed(3)} × the ring's station sale)`);
    metrics.homeLoop = got - cost;
  } else notes.push('home loop: no pass near home at the start');

  // (2) rings 1–3: raw and refined ore against the station sale and the cheapest buy anywhere (setup: cargo aboard,
  //     the refined units as a refinery leaves them – the refining itself is probed by refineArbitrage)
  for (const ring of [1, 2, 3] as RingIndex[]) {
    const link = linkedInRing(seed, ring);
    if (!link) {
      notes.push(`P${ring}: no pass linked`);
      continue;
    }
    const g = link.d;
    const offerRing = convoyOffer(g.state, link.pass)!.ring;
    const parts: string[] = [];
    for (const r of ORES) {
      for (const refined of [false, true]) {
        const qty = 25;
        // an auto-unlink (a pirate within 300 u): the pirates chased off and linked again (setup – the prices are
        // under test here, not the link rules)
        if (!g.state.convoys.link) {
          const tp = g.state.player.body.pos;
          g.state.combat.enemies = g.state.combat.enemies.filter((e) => dist(e.body.pos, tp) > CONVOY.linkPirateRadius + 100);
        }
        if (!g.state.convoys.link && !linkHere(g, link.pass)) {
          parts.push(`${r}${refined ? '*' : ''} (link lost)`);
          continue;
        }
        g.state.player.cargo[r] = qty;
        g.state.player.refined[r] = refined ? qty : 0;
        const unit = convoySellUnit(r, offerRing);
        const s = convoyAct(g, { type: 'convoySell', resource: r, qty: 'all' });
        if (!s.ok) {
          parts.push(`${r}${refined ? '*' : ''} refused (${s.reason})`);
          continue;
        }
        const expect = refinedSaleValue(r, qty, refined ? qty : 0, unit);
        if (Math.abs(s.credits - expect) > EPS) broken.push(`P${ring} ${r}${refined ? ' refined' : ''}: paid ${s.credits}, the rule says ${expect}`);
        const perUnit = s.credits / qty;
        if (refined && perUnit > REFINED_CEILING[r as 'iron' | 'copper' | 'titanium'] + 1e-9) broken.push(`P${ring} refined ${r} ${perUnit.toFixed(2)} kr/u above the ceiling ${REFINED_CEILING[r as 'iron']}`);
        // raw: ≤ 0.9 × the station sale of the ring; refined: never above the station's refined price of the ring
        const station = resourcePrice(r, offerRing, 1).sell;
        const bound = refined ? refinedUnit(r, station) : CONVOY.sellMult * station;
        if (perUnit > bound + 0.01) broken.push(`P${ring} ${r}${refined ? ' refined' : ''}: ${perUnit.toFixed(2)} kr/u above the station bound ${bound.toFixed(2)}`);
        const margin = s.credits - qty * cheapestBuy(r);
        worst = Math.max(worst, margin);
        if (margin > 0) broken.push(`P${ring} ${r}${refined ? ' refined' : ''}: +${margin} kr over the cheapest buy anywhere`);
        parts.push(`${r}${refined ? '*' : ''} ${perUnit.toFixed(2)}`);
      }
    }
    metrics[`ring${ring}`] = offerRing;
    notes.push(`P${ring} (${link.pass}, quotes P${offerRing}): kr/u ${parts.join(', ')} (* refined) vs the cheapest buy Fe ${cheapestBuy('iron')} / Cu ${cheapestBuy('copper')} / Ti ${cheapestBuy('titanium')}`);
  }
  metrics.worstMargin = Math.round(worst);
  metrics.worstRatio = Math.round(worstRatio * 1000) / 1000;
  return result('convoyArbitrage', seed, d, Math.max(0, worst), broken, `${notes.join('; ')} – any buy → convoy sale loses (0.9 × the station, the refined bonus under the W1 ceiling, never the demand bonus)`, metrics);
}

// ------------------------------------------------------------------------------------------------
// C2 – the 200 u cap per pass: refilled cargo, unlink → relink, a save → load copy, a second pass; never two links.

export function convoyCap(seed: number): LoopResult {
  const broken: string[] = [];
  const notes: string[] = [];
  const link = linkedInRing(seed, 1);
  if (!link) return result('convoyCap', seed, null, 0, [], 'no ring-1 pass linked', {});
  const { d, pass } = link;
  const p = d.state.player;
  let sold = 0;
  let paid = 0;
  let station = 0;
  const sell = (label: string): { ok: boolean; reason?: string } => {
    const before = p.cargo.iron;
    const s = convoyAct(d, { type: 'convoySell', resource: 'iron', qty: 'all' });
    const n = before - p.cargo.iron;
    sold += n;
    paid += s.credits;
    station += saleValue(n, homeSellPrice('iron'));
    notes.push(`${label}: ${r1(n)} u for ${s.credits} kr (${reasonOf(s)})`);
    return s;
  };
  // refilled cargo (setup: more ore aboard) until the cap
  for (let i = 0; i < 3; i++) {
    p.cargo.iron = Math.min(120, p.props.cargoCapacity - 1);
    sell(`sale ${i + 1}`);
  }
  if (sold > CONVOY.buyCap + 1e-6) broken.push(`${r1(sold)} u sold to one pass (cap ${CONVOY.buyCap})`);
  // unlink → relink the same pass
  const un = d.attempt({ type: 'convoyUnlink' });
  d.idle(1);
  const relinked = linkHere(d, pass);
  p.cargo.iron = 50;
  const again = relinked ? sell('after unlink → relink') : { ok: false, reason: 'not relinked' };
  if (again.ok) broken.push('the cap reset by unlink → relink');
  // a save → load copy while linked
  const copy = new Driver(cloneSim(d.sim));
  const cAgain = convoyAct(copy, { type: 'convoySell', resource: 'iron', qty: 'all' });
  if (cAgain.ok) broken.push('the cap reset by save → load');
  notes.push(`unlink ${un.ok ? 'ok' : un.reason}, relinked ${relinked}; the save copy: ${copy.state.convoys.link?.pass === pass ? 'still linked' : 'unlinked'}, sale ${reasonOf(cAgain)}`);
  // two passes at once: F at another pass's port while linked – one link at most
  const other = [...LANES.map((l) => `cv:${l}@0`), ...LANES.flatMap((l) => [1, 2, 3, 4].map((n) => `cv:${l}@${n}`))].find((x) => x !== pass && convoyAt(seed, x, d.state.tick + 1));
  let second = 'no other pass in flight';
  if (other) {
    const ok = linkHere(d, other);
    second = `F at ${other}'s port → link ${d.state.convoys.link?.pass ?? 'none'}${ok ? '' : ' (no link)'}`;
    if (ok) {
      // a new pass has its own cap: still at 0.9 × the station
      p.cargo.iron = 100;
      sell(`second pass ${other}`);
    }
  }
  notes.push(second);
  // net: the convoy paid ≤ 0.9 × what the same ore sells for at home
  const gain = paid - station;
  return result(
    'convoyCap',
    seed,
    d,
    gain,
    broken,
    `${pass}: ${notes.join('; ')}; ${r1(sold)} u for ${paid} kr vs ${Math.round(station)} kr at the home station`,
    { sold: Math.round(sold), relinkSale: again.ok ? 1 : 0, copySale: cAgain.ok ? 1 : 0, ratio: Math.round((paid / Math.max(1, station)) * 1000) / 1000 },
  );
}

// ------------------------------------------------------------------------------------------------
// C3 – rare items: buy every slot, again, after unlink → relink and in a save copy; crafted slots; sell the parts at
// the home station.

export function convoyItems(seed: number): LoopResult {
  const broken: string[] = [];
  const notes: string[] = [];
  const d = new Driver(new Simulation({ seed }));
  d.state.credits += 30_000;
  const w0 = netWorth(d.state).total;
  d.undock();
  const pass = LANES.map((l) => `cv:${l}@0`).find((x) => convoyAt(seed, x, d.state.tick + 1) !== null);
  if (!pass || !linkHere(d, pass)) return result('convoyItems', seed, d, 0, [], 'no pass near home at the start', {});
  const offer = convoyOffer(d.state, pass)!;
  const frag0 = sum(d.state.discovery.fragments.values());
  let spent = 0;
  for (const item of offer.items) {
    const r = convoyAct(d, { type: 'convoyBuy', slot: item.slot });
    if (!r.ok) notes.push(`slot ${item.slot} refused (${r.reason})`);
    else {
      spent -= r.credits;
      if (-r.credits !== item.price) broken.push(`slot ${item.slot} cost ${-r.credits} ≠ ${item.price}`);
    }
    const again = d.attempt({ type: 'convoyBuy', slot: item.slot });
    if (again.ok) broken.push(`slot ${item.slot} bought twice`);
  }
  const crafted = [3, -1, 0.5, Number.NaN, 99].map((slot) => d.attempt({ type: 'convoyBuy', slot }));
  if (crafted.some((c) => c.ok)) broken.push('a crafted slot was sold');
  const copy = new Driver(cloneSim(d.sim));
  const copyBuy = offer.items.map((i) => copy.attempt({ type: 'convoyBuy', slot: i.slot })).filter((c) => c.ok).length;
  if (copyBuy) broken.push(`${copyBuy} slots sold again in a save copy`);
  d.attempt({ type: 'convoyUnlink' });
  d.idle(1);
  const relinked = linkHere(d, pass);
  const relinkBuy = relinked ? offer.items.map((i) => d.attempt({ type: 'convoyBuy', slot: i.slot })).filter((c) => c.ok).length : 0;
  if (relinkBuy) broken.push(`${relinkBuy} slots sold again after unlink → relink`);
  const fragments = sum(d.state.discovery.fragments.values()) + d.state.discovery.plans.size * 0 - frag0;
  // home: the part hold goes to storage at the dock, every part sold back
  d.attempt({ type: 'convoyUnlink' });
  const home = homeStation();
  const docked = d.dockAt(home, 300);
  const back = docked ? d.sellStorageParts() : 0;
  const w1 = netWorth(d.state).total;
  notes.push(
    `${pass} (P${offer.ring}): ${offer.items.map((i) => `${i.kind === 'fragment' ? `fragment ${i.plan}` : i.key} ${i.price} kr`).join(', ')} – paid ${spent} kr, again / crafted (3, −1, 0.5, NaN, 99) / save copy / relink refused; ` +
      `fragments +${fragments}; ${docked ? `parts sold back at home for ${back} kr` : 'could not dock at home'}`,
  );
  // net worth counts the fragment at 0: the purchase is a loss unless a part sells for more than it cost
  return result('convoyItems', seed, d, w1 - w0, broken, notes.join('; '), { spent, back, fragments, items: offer.items.length });
}

// ------------------------------------------------------------------------------------------------
// C4 – tanker fuel: the 60 u cap per pass (also over a save copy), crafted amounts, no way to sell fuel.

export function tankerFuel(seed: number): LoopResult {
  const broken: string[] = [];
  const link = linkedInRing(seed, 1, true);
  if (!link) return result('tankerFuel', seed, null, 0, [], 'no ring-1 pass with a tanker linked', {});
  const { d, pass } = link;
  const p = d.state.player;
  d.state.credits += 5_000;
  const w0 = netWorth(d.state).total;
  const ring = convoyOffer(d.state, pass)!.ring;
  let bought = 0;
  let paid = 0;
  for (let i = 0; i < 4; i++) {
    p.fuel = Math.max(0, p.props.fuelCapacity - 40); // setup: fuel burned in flight
    const f0 = p.fuel;
    const r = convoyAct(d, { type: 'convoyFuel', amount: 'full' });
    if (r.ok) {
      const got = p.fuel - f0;
      bought += got;
      paid -= r.credits;
      const expect = purchaseCost(got, convoyFuelUnit(ring));
      if (Math.abs(-r.credits - expect) > EPS) broken.push(`fuel ${r1(got)} u cost ${-r.credits} ≠ ${expect}`);
    }
  }
  if (bought > CONVOY.fuelCap + 1e-6) broken.push(`${r1(bought)} fuel from one pass (cap ${CONVOY.fuelCap})`);
  const copy = new Driver(cloneSim(d.sim));
  copy.state.player.fuel = 0;
  const cr = copy.attempt({ type: 'convoyFuel', amount: 'full' });
  if (cr.ok) broken.push('the fuel cap reset by save → load');
  const crafted: [string, GameActionInput][] = [
    ['fuel −5', { type: 'convoyFuel', amount: -5 }],
    ['fuel NaN', { type: 'convoyFuel', amount: Number.NaN }],
    ['fuel ∞', { type: 'convoyFuel', amount: Number.POSITIVE_INFINITY }],
    ['sell fuel to the convoy', { type: 'convoySell', resource: 'fuel' as ResourceId, qty: 10 }],
    ['sell fuel at a station', { type: 'sellResource', resource: 'fuel' as ResourceId, qty: 10, from: 'ship' }],
  ];
  const refused = crafted.map(([label, a]) => [label, d.attempt(a)] as const);
  for (const [label, r] of refused) if (r.ok) broken.push(`${label} accepted`);
  const w1 = netWorth(d.state).total;
  const unit = convoyFuelUnit(ring);
  return result(
    'tankerFuel',
    seed,
    d,
    w1 - w0,
    broken,
    `${pass} (P${ring}): ${r1(bought)} u bought in 4 fills for ${paid} kr (${unit.toFixed(2)} kr/u = ${(unit / fuelUnitPrice(ring)).toFixed(2)} × the station), the save copy ${reasonOf(cr)}; crafted ${refused.map(([l, r]) => `${l} ${reasonOf(r)}`).join(', ')} – fuel is never sold back`,
    { bought: Math.round(bought * 10) / 10, paid, copyRefill: cr.ok ? 1 : 0 },
  );
}

// ------------------------------------------------------------------------------------------------
// escort helpers

interface EscortGame {
  d: Driver;
  station: StationDef;
  offer: ContractOffer;
  contract: Contract;
}

/** Lane stations of the seed with an escort draft (nearest to home first) and the drafts' offers. */
function escortOffers(seed: number, d: Driver, count: number): { station: StationDef; offers: ContractOffer[] } | null {
  const stations = stationsInArea(seed, -30, 30, -30, 30)
    .filter((s) => escortAvailable(boardContext(d.state, s)))
    .sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y));
  for (const station of stations) {
    const ctx = { ...boardContext(d.state, station), unlocks: UNLOCKS };
    const offers: ContractOffer[] = [];
    for (let roll = 1; roll <= 80 && offers.length < count; roll++) {
      const draft = escortOffer(ctx, createRng(roll));
      if (!draft || draft.target.kind !== 'escort') continue;
      if (offers.some((o) => o.target.kind === 'escort' && draft.target.kind === 'escort' && o.target.from === draft.target.from && o.target.to === draft.target.to)) continue;
      offers.push({ id: `${station.id}@${boardEpoch(d.state.tick)}.${90 + offers.length}`, type: 'escort', faction: 'guild', station: station.id, ring: draft.ring, risk: draft.risk, target: draft.target, modifiers: [], bonus: 0, part: null });
    }
    if (offers.length >= count) return { station, offers };
  }
  return null;
}

/** Setup: docked at a lane station with these slips on its board (a board roll), `credits` on the account. */
function dockWithSlips(d: Driver, station: StationDef, offers: readonly ContractOffer[]): void {
  d.state.player.dock = { mode: 'docked', stationId: station.id };
  const board = ensureBoard(d.state, station);
  const add = offers.filter((o) => !board.offers.some((x) => x.id === o.id));
  if (!add.length) return;
  // the board keeps at most BOARD_MAX_OFFERS slips (and one free place, as after a real acceptance)
  board.offers = board.offers.slice(0, Math.max(0, BOARD_MAX_OFFERS - 1 - add.length));
  for (const o of add) board.offers.push(structuredClone(o));
}

/**
 * The escort slip of the seed whose first ambush party comes soonest after the acceptance (the flight to the
 * meeting point at the cruise speed + the convoy's way to the arming point) – what an ambush farmer would pick.
 */
function soonestAmbush(seed: number, d: Driver): { station: StationDef; offer: ContractOffer; seconds: number } | null {
  let best: { station: StationDef; offer: ContractOffer; seconds: number } | null = null;
  const stations = stationsInArea(seed, -30, 30, -30, 30).filter((s) => escortAvailable(boardContext(d.state, s)));
  for (const station of stations) {
    const ctx = { ...boardContext(d.state, station), unlocks: UNLOCKS };
    for (let roll = 1; roll <= 40; roll++) {
      const draft = escortOffer(ctx, createRng(roll));
      if (!draft || draft.target.kind !== 'escort') continue;
      const t = draft.target;
      const seconds = dist(station.pos, t.meet) / CRUISE + Math.max(0, t.ambushes[0]! - AMBUSH_LEAD - t.from) / ESCORT.speed;
      if (!best || seconds < best.seconds) {
        best = { station, seconds, offer: { id: `${station.id}@${boardEpoch(d.state.tick)}.95`, type: 'escort', faction: 'guild', station: station.id, ring: draft.ring, risk: draft.risk, target: t, modifiers: [], bonus: 0, part: null } };
      }
    }
  }
  return best;
}

/** An escort slip accepted (real `acceptContract`) at the nearest lane station of the seed (or the soonest ambush). */
function escortAt(seed: number, credits: number, soonest = false): EscortGame | null {
  const d = new Driver(new Simulation({ seed, startDocked: true }));
  d.state.career.rep.guild.level = 2;
  const pick = soonest ? soonestAmbush(seed, d) : null;
  const found = soonest ? (pick ? { station: pick.station, offers: [pick.offer] } : null) : escortOffers(seed, d, 1);
  if (!found) return null;
  const offer = found.offers[0]!;
  dockWithSlips(d, found.station, [offer]);
  d.state.credits = credits;
  const r = d.attempt({ type: 'acceptContract', offerId: offer.id });
  const contract = d.state.career.contracts.find((c) => c.id === offer.id);
  if (!r.ok || !contract) return null;
  return { d, station: found.station, offer, contract };
}

const escortTarget = (c: Contract) => (c.target.kind === 'escort' ? c.target : null);

/** Setup: the flight from the dock to the meeting point (flying, 60 u beside the waiting trader). */
function toMeet(d: Driver, c: Contract): void {
  const t = escortTarget(c)!;
  d.state.player.dock = { mode: 'flying' };
  teleport(d.sim, { x: t.meet.x, y: t.meet.y + 60 });
}

/** One step with the ship carried 60 u beside the escorted trader (setup: keeping pace); other pirates left out. */
function rideStep(d: Driver, serial: number): SimEvent[] {
  const tr = escortHitTargets(d.state).find((t) => t.id === `es:${serial}:trader`);
  if (tr) {
    const p = d.state.player;
    p.body = { pos: { x: tr.pos.x, y: tr.pos.y + 60 }, vel: { ...(tr.vel ?? { x: 0, y: 0 }) }, angle: 0, angVel: 0 };
    p.prevBody = p.body;
    d.state.world.update(p.body.pos);
  }
  d.state.combat.enemies = d.state.combat.enemies.filter((e) => e.id.startsWith('ea:'));
  return d.step();
}

/** Rides the escort until it is ready (ambush parties shot down as they come) or `seconds` pass; loot value of the kills. */
function rideToEnd(d: Driver, c: Contract, seconds: number): { ready: boolean; loot: number; kills: number } {
  let loot = 0;
  let kills = 0;
  const end = d.state.tick + seconds * TPS;
  while (d.state.tick < end) {
    if (d.state.career.contracts.find((x) => x.serial === c.serial)?.ready) return { ready: true, loot, kills };
    if (!d.state.career.contracts.some((x) => x.serial === c.serial)) return { ready: false, loot, kills };
    for (const e of d.state.combat.enemies.filter((x) => x.id.startsWith(`ea:${c.serial}:`))) {
      const v = killByPlayer(d, e.id);
      if (v !== null) {
        loot += v;
        kills++;
      }
    }
    rideStep(d, c.serial);
  }
  return { ready: !!d.state.career.contracts.find((x) => x.serial === c.serial)?.ready, loot, kills };
}

// ------------------------------------------------------------------------------------------------
// E1 – the escort deposit: free cancel loops, a late cancel, a poor pilot, the arrival (once, also over a save copy),
// turn-in twice, a crafted deposit in a save, two escorts on the same stretch.

export function escortDeposit(seed: number): LoopResult {
  const broken: string[] = [];
  const notes: string[] = [];
  const metrics: Record<string, number> = {};
  const g = escortAt(seed, 50_000);
  if (!g) return result('escortDeposit', seed, null, 0, [], 'no escort slip at a lane station', {});
  const { d, station, offer } = g;
  let c = g.contract;
  const deposit = 50_000 - d.state.credits;
  metrics.deposit = deposit;
  metrics.reward = c.reward;
  if (deposit !== Math.round(c.reward * ESCORT.deposit)) broken.push(`deposit ${deposit} ≠ 10 % of ${c.reward}`);
  // (a) free cancel → re-accept, three times
  for (let i = 0; i < 3; i++) {
    const ab = d.attempt({ type: 'abandonContract', contractId: c.serial });
    const back = currentBoard(d.state, station).offers.some((o) => o.id === offer.id);
    const acc = d.attempt({ type: 'acceptContract', offerId: offer.id });
    const next = d.state.career.contracts.find((x) => x.id === offer.id);
    if (!ab.ok || !back || !acc.ok || !next) {
      notes.push(`free cancel loop ${i + 1}: abandon ${reasonOf(ab)}, slip back ${back}, accept ${reasonOf(acc)}`);
      break;
    }
    c = next;
  }
  const afterLoops = d.state.credits;
  if (afterLoops !== 50_000 - deposit) broken.push(`after 3 free-cancel loops ${afterLoops} kr ≠ ${50_000 - deposit}`);
  notes.push(`deposit ${deposit} kr (10 % of ${c.reward}); 3 × free cancel → accept: ${afterLoops - (50_000 - deposit)} kr`);
  // (b) the full escort: ride, ambushers shot down, arrival pays the deposit back once
  toMeet(d, c);
  const copyBefore = saveOf(d);
  const ride = rideToEnd(d, c, 15 * 60);
  const atArrival = d.state.credits;
  if (ride.ready && atArrival - afterLoops !== deposit) broken.push(`arrival paid ${atArrival - afterLoops} kr ≠ the deposit ${deposit}`);
  d.idle(5);
  const copy = new Driver(cloneSim(d.sim));
  copy.idle(30);
  const copyExtra = copy.state.credits - d.state.credits;
  if (copyExtra !== 0) broken.push(`a save copy after the arrival paid ${copyExtra} kr more`);
  const abReady = d.attempt({ type: 'abandonContract', contractId: c.serial });
  // the abandon of a ready contract removes it: test it on a copy, turn in the original
  const turn = new Driver(cloneSim(copy.sim));
  turn.state.player.dock = { mode: 'docked', stationId: station.id }; // setup: the flight back skipped
  const c1 = turn.state.credits;
  const t1 = turn.attempt({ type: 'turnInContract', contractId: c.serial });
  const t2 = turn.attempt({ type: 'turnInContract', contractId: c.serial });
  const paid = turn.state.credits - c1;
  if (t2.ok) broken.push('turned in twice');
  if (t1.ok && paid !== c.reward) broken.push(`turn-in paid ${paid} ≠ ${c.reward}`);
  notes.push(
    `escort ridden: ${ride.ready ? 'ready' : 'not ready'} (${ride.kills} ambushers shot down, loot ${Math.round(ride.loot)} kr), deposit back ${atArrival - afterLoops} kr; ` +
      `save copy +${copyExtra} kr; abandon after arrival ${reasonOf(abReady)} (+${d.state.credits - atArrival} kr); turn-in ${reasonOf(t1)} ${paid} kr, again ${reasonOf(t2)}`,
  );
  metrics.ready = ride.ready ? 1 : 0;
  // (c) a late cancel (> 2 min) loses it; a poor pilot pays only what he has
  const late = escortAt(seed, 50_000);
  if (late) {
    late.d.idle(FREE_CANCEL_TICKS / TPS + 2);
    const before = late.d.state.credits;
    const r = late.d.attempt({ type: 'abandonContract', contractId: late.contract.serial });
    const failed = r.events.some((e) => e.type === 'contractFailed');
    if (late.d.state.credits !== before) broken.push('a late cancel paid the deposit back');
    notes.push(`late cancel: ${late.d.state.credits - before} kr back, failed ${failed}`);
  }
  const poor = escortAt(seed, 37);
  if (poor) {
    const taken = 37 - poor.d.state.credits;
    poor.d.attempt({ type: 'abandonContract', contractId: poor.contract.serial });
    if (poor.d.state.credits !== 37) broken.push(`a poor pilot's free cancel left ${poor.d.state.credits} kr`);
    notes.push(`poor pilot: deposit ${taken} of 37 kr, back on a free cancel`);
    metrics.poorDeposit = taken;
  }
  metrics.honestBroken = broken.length;
  // (d) a crafted save: the escort's deposit raised to 1 000 000 before the arrival / before a free cancel
  let crafted = 0;
  for (const when of ['arrival', 'free cancel'] as const) {
    const s = structuredClone(copyBefore);
    const rec = s.convoys.escorts.find(([serial]) => serial === c.serial);
    if (!rec) continue;
    rec[1].deposit = 1_000_000;
    if (when === 'free cancel') {
      // accepted just now (within the free cancel window)
      const sc = s.career.contracts.find((x) => x.serial === c.serial);
      if (sc) sc.acceptedTick = s.tick;
    }
    const { d: l, error } = loadCrafted(s);
    if (!l) {
      notes.push(`crafted deposit (${when}): refused (${error})`);
      continue;
    }
    const lc = l.state.career.contracts.find((x) => x.serial === c.serial)!;
    const loaded = l.state.convoys.escorts.get(c.serial)?.deposit ?? 0;
    const b0 = l.state.credits;
    if (when === 'arrival') rideToEnd(l, lc, 15 * 60);
    else l.attempt({ type: 'abandonContract', contractId: lc.serial });
    const got = l.state.credits - b0;
    crafted = Math.max(crafted, got - deposit);
    if (got > deposit + EPS) broken.push(`crafted save: a deposit of 1 000 000 loads as ${loaded} and the ${when} pays ${got} kr (the contract's deposit is ${deposit})`);
    notes.push(`crafted deposit 1e6 (${when}): loaded as ${loaded}, paid ${got} kr`);
  }
  metrics.craftedPaid = Math.round(crafted);
  return result('escortDeposit', seed, d, Math.max(afterLoops - (50_000 - deposit), crafted), broken, notes.join('; '), metrics);
}

// ------------------------------------------------------------------------------------------------
// E2 – escort ambush loot through the free cancel: accept → meet → shoot the ambush party down → abandon within the
// 2 min free cancel → accept again → a fresh party. Holds when the cancel of a departed convoy is never free (no
// deposit back, the slip stays off the board – G2, fixed).

export function escortCancelFarm(seed: number): LoopResult {
  const broken: string[] = [];
  const notes: string[] = [];
  const g = escortAt(seed, 50_000, true);
  if (!g) return result('escortCancelFarm', seed, null, 0, [], 'no escort slip at a lane station', {});
  const { d, station, offer } = g;
  let c = g.contract;
  const t0 = escortTarget(c)!;
  const meetFlight = (2 * dist(station.pos, t0.meet)) / CRUISE;
  let loot = 0;
  let cycles = 0;
  let seconds = 0;
  let kills = 0;
  for (let cycle = 0; cycle < 3; cycle++) {
    toMeet(d, c);
    const start = c.acceptedTick;
    // ride until the first party is shot down (or the free cancel window is over)
    let got = 0;
    let k = 0;
    while (d.state.tick - start <= FREE_CANCEL_TICKS - TPS) {
      const party = d.state.combat.enemies.filter((x) => x.id.startsWith(`ea:${c.serial}:`));
      if (party.length) {
        for (const e of party) {
          const v = killByPlayer(d, e.id);
          if (v !== null) {
            got += v;
            k++;
          }
        }
        if (!d.state.combat.enemies.some((x) => x.id.startsWith(`ea:${c.serial}:`))) break;
      }
      rideStep(d, c.serial);
    }
    const used = (d.state.tick - start) / TPS;
    if (k === 0) {
      notes.push(`cycle ${cycle + 1}: no ambush party within the free cancel window (${r1(used)} s)`);
      break;
    }
    const credits = d.state.credits;
    const ab = d.attempt({ type: 'abandonContract', contractId: c.serial });
    const refunded = ab.events.some((e) => e.type === 'contractAbandoned' && e.refunded);
    const refund = d.state.credits - credits;
    dockWithSlips(d, station, []); // setup: the flight back to the station (timed below)
    const back = currentBoard(d.state, station).offers.some((o) => o.id === offer.id);
    const acc = d.attempt({ type: 'acceptContract', offerId: offer.id });
    const next = d.state.career.contracts.find((x) => x.id === offer.id);
    notes.push(`cycle ${cycle + 1}: ${k} ambushers shot down ${r1(used)} s after the acceptance (loot ${Math.round(got)} kr), abandon ${refunded ? `refunded (+${refund} kr)` : ab.ok ? `not free (+${refund} kr, the deposit lost)` : reasonOf(ab)}, slip back ${back}, accept again ${reasonOf(acc)}`);
    loot += got;
    kills += k;
    if (!refunded || !back || !acc.ok || !next) break;
    cycles++;
    seconds += used + meetFlight;
    c = next;
  }
  const perHour = seconds > 0 ? (loot / seconds) * 3600 : 0;
  const slow = seconds + kills * HUNT_SECONDS_PER_ENEMY;
  const perHourSlow = cycles > 0 && slow > 0 ? (loot / slow) * 3600 : 0;
  // a finding when the same slip brings a fresh party again and again with the deposit back each time
  if (cycles >= 2) broken.push(`${cycles} accept → shoot the ambush → free cancel → accept cycles of one slip`);
  return result(
    'escortCancelFarm',
    seed,
    d,
    cycles >= 2 ? loot : 0,
    broken,
    `${notes.join('; ')}; ${kills} kills, loot ${Math.round(loot)} kr in ≈ ${Math.round(seconds)} s (lower bound: fights 0 s, flights station ↔ meeting point at ${CRUISE} u/s) ≈ ${Math.round(perHour)} kr/h, with ${HUNT_SECONDS_PER_ENEMY} s per kill ≈ ${Math.round(perHourSlow)} kr/h (the free cancel needs the kills within 2 min of the acceptance)`,
    { cycles, loot: Math.round(loot), kills, seconds: Math.round(seconds), perHour: Math.round(perHour), perHourSlow: Math.round(perHourSlow) },
    perHour,
  );
}

// ------------------------------------------------------------------------------------------------
// E3 – two escorts on one stretch: two slips of one station on the same leg – each has its own convoy (never a shared
// one), both pay. Measured: the rewards against one escort's estimate (contract stacking, like two scans of an area).

export function escortStack(seed: number): LoopResult {
  const broken: string[] = [];
  const d = new Driver(new Simulation({ seed, startDocked: true }));
  d.state.career.rep.guild.level = 2;
  const found = escortOffers(seed, d, 6);
  if (!found) return result('escortStack', seed, d, 0, [], 'no lane station with two escort slips', {});
  // two slips on the same leg from the same point (the nearest arc of the station)
  const same = found.offers.filter((o) => o.target.kind === 'escort' && found.offers[0]!.target.kind === 'escort' && Math.abs(o.target.from - found.offers[0]!.target.from) < 1);
  if (same.length < 2) return result('escortStack', seed, d, 0, [], `${found.station.id}: no two slips on the same leg`, { pairs: 0 });
  const pair = same.slice(0, 2);
  dockWithSlips(d, found.station, pair);
  d.state.credits = 50_000;
  for (const o of pair) d.attempt({ type: 'acceptContract', offerId: o.id });
  const cs = pair.map((o) => d.state.career.contracts.find((c) => c.id === o.id)).filter((c): c is Contract => !!c);
  if (cs.length < 2) return result('escortStack', seed, d, 0, [], 'the second slip was not accepted', { pairs: 1 });
  const serials = new Set(cs.map((c) => c.serial));
  const convoys = [...d.state.convoys.escorts.keys()].filter((s) => serials.has(s)).length;
  if (convoys !== 2) broken.push(`${convoys} escort convoys for 2 contracts`);
  // ride beside the first trader; the second convoy departs with it (same meeting point)
  toMeet(d, cs[0]!);
  const start = d.state.tick;
  let loot = 0;
  const end = start + 20 * 60 * TPS;
  while (d.state.tick < end && cs.some((c) => d.state.career.contracts.find((x) => x.serial === c.serial && !x.ready))) {
    for (const e of d.state.combat.enemies.filter((x) => x.id.startsWith('ea:'))) loot += killByPlayer(d, e.id) ?? 0;
    rideStep(d, cs[0]!.serial);
  }
  const ready = cs.filter((c) => d.state.career.contracts.find((x) => x.serial === c.serial)?.ready).length;
  const seconds = (d.state.tick - start) / TPS;
  const rewards = sum(cs.map((c) => c.reward));
  const single = Math.max(...cs.map((c) => c.seconds));
  return result(
    'escortStack',
    seed,
    d,
    0,
    broken,
    `${found.station.id}: 2 slips on one leg (${cs.map((c) => `${c.reward} kr / ${c.seconds} s est.`).join(', ')}), ${convoys} convoys (one per contract), ridden together: ${ready}/2 ready in ${Math.round(seconds)} s, ${Math.round(loot)} kr loot – both rewards ${rewards} kr for the time of the longer one (${single} s estimated): contract stacking, each convoy brings its own ambushes`,
    { pairs: 1, convoys, ready, rewards, seconds: Math.round(seconds), single },
  );
}

// ------------------------------------------------------------------------------------------------
// relay helpers

interface RelayGame {
  d: Driver;
  lane: LaneId;
  station: StationDef;
  offer: ContractOffer;
  contract: Contract;
}

/** The station nearest to a lane's relay mast within the offer range. */
function relayStation(seed: number, lane: LaneId): StationDef | null {
  const site = guildRelaySite(seed, lane);
  if (!site) return null;
  const r = Math.ceil(RELAY_CHAIN.offerRange / CHUNK_SIZE);
  const cx = Math.floor(site.pos.x / CHUNK_SIZE);
  const cy = Math.floor(site.pos.y / CHUNK_SIZE);
  return (
    stationsInArea(seed, cx - r, cx + r, cy - r, cy + r)
      .filter((s) => dist(s.pos, site.pos) <= RELAY_CHAIN.offerRange)
      .sort((a, b) => dist(a.pos, site.pos) - dist(b.pos, site.pos))[0] ?? null
  );
}

/** Guild level 2 (setup), docked at the station nearest a relay mast, its pinned relay slip accepted (real). */
function relayAt(seed: number): RelayGame | null {
  for (const lane of LANES) {
    const station = relayStation(seed, lane);
    if (!station) continue;
    const d = new Driver(new Simulation({ seed, startDocked: true }));
    d.state.career.rep.guild.level = 2;
    d.state.credits += 5_000;
    d.state.player.dock = { mode: 'docked', stationId: station.id };
    const offer = currentBoard(d.state, station).offers.find((o) => o.target.kind === 'relay' && o.target.lane === lane);
    if (!offer) continue;
    const snapshot = structuredClone(offer);
    const r = d.attempt({ type: 'acceptContract', offerId: offer.id });
    const contract = d.state.career.contracts.find((c) => c.id === offer.id);
    if (r.ok && contract) return { d, lane, station, offer: snapshot, contract };
  }
  return null;
}

/** Unit vector from home to the mast. */
function outward(pos: Vec2): Vec2 {
  const l = Math.hypot(pos.x, pos.y) || 1;
  return { x: pos.x / l, y: pos.y / l };
}

/** Setup: flown to the mast with the repair materials aboard; F pressed (real repair); the 5 s laser charge as set. */
function repairAndPower(g: RelayGame, broken: string[]): boolean {
  const { d, lane } = g;
  const site = guildRelaySite(d.state.seed, lane)!;
  const p = d.state.player;
  d.state.player.dock = { mode: 'flying' };
  p.cargo.iron = RELAY_CHAIN.repair.iron ?? 0;
  p.cargo.copper = RELAY_CHAIN.repair.copper ?? 0;
  p.cargo.titanium = RELAY_CHAIN.repair.titanium ?? 0;
  const o = outward(site.pos);
  const gap = MAST_RADIUS + p.props.boundingRadius + 4;
  teleport(d.sim, { x: site.pos.x + o.x * gap, y: site.pos.y + o.y * gap });
  d.state.combat.enemies = [];
  const ev = d.step({ ...IDLE_COMMAND, dock: true });
  if (!ev.some((e) => e.type === 'relayRepaired')) {
    broken.push(`setup: the repair F at the ${lane} mast did nothing`);
    return false;
  }
  // the M4b relay charge (probed by relayCharge): lit
  d.state.sites.powered.add(site.id);
  // stand between the mast and the counterattack (the party spawns 320 u out)
  teleport(d.sim, { x: site.pos.x + o.x * 100, y: site.pos.y + o.y * 100 });
  return true;
}

/** Steps (other pirates of the sector left out) until the hold's counterattack ships are spawned, at most `seconds`. */
function untilParty(d: Driver, lane: LaneId, seconds: number): string[] {
  const end = d.state.tick + seconds * TPS;
  while (d.state.tick < end) {
    d.state.combat.enemies = d.state.combat.enemies.filter((e) => e.id.startsWith('rc:'));
    d.step();
    const ids = d.state.combat.enemies.filter((e) => e.id.startsWith(`rc:${lane}:`)).map((e) => e.id);
    if (ids.length >= (RELAY_CHAIN.party[2]?.length ?? 3)) return ids;
  }
  return d.state.combat.enemies.filter((e) => e.id.startsWith(`rc:${lane}:`)).map((e) => e.id);
}

// ------------------------------------------------------------------------------------------------
// R1 – the relay contract pays once per lane: secure the lane (the counterattack shot down), turn in, turn in again,
// a stale slip of the lane, a second relay contract while one is active, a slip accepted after the securing.

export function relayDoublePay(seed: number): LoopResult {
  const broken: string[] = [];
  const notes: string[] = [];
  const g = relayAt(seed);
  if (!g) return result('relayDoublePay', seed, null, 0, [], 'no relay slip (no relay site with a station in range)', {});
  const { d, lane, station, offer } = g;
  const c = g.contract;
  // another relay slip while this one is active: none on any board in range, a stale copy refused
  const other = LANES.filter((l) => l !== lane).map((l) => relayStation(seed, l)).find((s): s is StationDef => !!s);
  if (other) {
    const offers = currentBoard(d.state, other).offers.filter((o) => o.target.kind === 'relay');
    if (offers.length) broken.push(`a second relay slip (${offers[0]!.id}) offered while one is active`);
  }
  const w0 = netWorth(d.state).total;
  if (!repairAndPower(g, broken)) return result('relayDoublePay', seed, d, 0, broken, 'setup failed', {});
  const party = untilParty(d, lane, 60);
  let loot = 0;
  for (const id of party) loot += killByPlayer(d, id) ?? 0;
  d.idle(2);
  const secured = d.state.guild.relays.get(lane)?.stage === 'secured';
  const ready = !!d.state.career.contracts.find((x) => x.serial === c.serial)?.ready;
  notes.push(`lane ${lane}: repaired and lit, ${party.length} counterattack ships shot down (loot ${Math.round(loot)} kr) → ${secured ? 'secured' : 'NOT secured'}, contract ${ready ? 'ready' : 'not ready'}`);
  // turn in at the station (setup: the flight back), twice
  d.state.player.dock = { mode: 'docked', stationId: station.id };
  const c0 = d.state.credits;
  const t1 = d.attempt({ type: 'turnInContract', contractId: c.serial });
  const t2 = d.attempt({ type: 'turnInContract', contractId: c.serial });
  const paid = d.state.credits - c0;
  if (t2.ok) broken.push('turned in twice');
  if (t1.ok && paid !== c.reward) broken.push(`paid ${paid} ≠ ${c.reward}`);
  // the lane is secured: no new slip, a stale one refused, a copy of the game cannot pay the lane again
  const fresh = currentBoard(d.state, station).offers.filter((o) => o.target.kind === 'relay' && o.target.lane === lane).length;
  if (fresh) broken.push('a relay slip for the secured lane is offered');
  ensureBoard(d.state, station).offers.push(structuredClone(offer)); // setup: the slip stored on a board earlier in the epoch
  const stale = d.attempt({ type: 'acceptContract', offerId: offer.id });
  if (stale.ok) broken.push('a stale relay slip of the secured lane accepted');
  const more = d.state.career.contracts.filter((x) => x.target.kind === 'relay').length;
  d.idle(5);
  const extra = d.state.career.contracts.filter((x) => x.target.kind === 'relay' && x.ready).length;
  if (extra) broken.push(`${extra} relay contracts ready again after the turn-in`);
  const w1 = netWorth(d.state).total;
  // the gain beyond one reward: (net worth − the reward) must not be positive (the materials and the loot count)
  const gain = Math.max(0, d.state.credits - c0 - c.reward);
  notes.push(`turn-in ${reasonOf(t1)} ${paid} kr (the reward ${c.reward} kr), again ${reasonOf(t2)}; new slips for lane ${lane}: ${fresh}; a stale slip ${reasonOf(stale)} (relay contracts now ${more}); net worth ${Math.round(w1 - w0)} kr incl. the reward and the counterattack loot`);
  return result('relayDoublePay', seed, d, gain, broken, notes.join('; '), { secured: secured ? 1 : 0, ready: ready ? 1 : 0, paid, reward: c.reward, stale: stale.ok ? 1 : 0, fresh });
}

// ------------------------------------------------------------------------------------------------
// R2 – the relay hold re-arms: shoot all but one counterattack ship down (their loot), leave beyond the hold radius,
// come back. Holds when the re-armed hold brings back only the survivor (G1, fixed): more kills than the party has
// = a fresh party with fresh loot. Measured: loot per cycle and cycles per hour.

export function relayHoldFarm(seed: number): LoopResult {
  const broken: string[] = [];
  const notes: string[] = [];
  const g = relayAt(seed);
  if (!g) return result('relayHoldFarm', seed, null, 0, [], 'no relay slip (no relay site with a station in range)', {});
  const { d, lane } = g;
  if (!repairAndPower(g, broken)) return result('relayHoldFarm', seed, d, 0, broken, 'setup failed', {});
  const site = guildRelaySite(seed, lane)!;
  const o = outward(site.pos);
  let loot = 0;
  let kills = 0;
  let seconds = 0;
  let cycles = 0;
  for (let cycle = 0; cycle < 3; cycle++) {
    const t = d.state.tick;
    const party = untilParty(d, lane, 60);
    if (party.length === 0) {
      notes.push(`cycle ${cycle + 1}: no counterattack (${d.state.guild.relays.get(lane)?.stage ?? 'broken'})`);
      break;
    }
    let got = 0;
    let k = 0;
    for (const id of party.slice(0, party.length - 1)) {
      const v = killByPlayer(d, id);
      if (v !== null) {
        got += v;
        k++;
      }
    }
    const fight = (d.state.tick - t) / TPS;
    // leave beyond the hold radius (setup: the flight, timed at the cruise speed) until the hold is idle
    teleport(d.sim, { x: site.pos.x - o.x * (RELAY_CHAIN.holdRadius + 50), y: site.pos.y - o.y * (RELAY_CHAIN.holdRadius + 50) });
    d.idle(3);
    const idle = d.state.guild.hold?.phase === 'idle';
    // the leaving survivor despawns out of range; back within the re-arm radius
    d.state.combat.enemies = [];
    teleport(d.sim, { x: site.pos.x + o.x * 100, y: site.pos.y + o.y * 100 });
    const flight = (2 * (RELAY_CHAIN.holdRadius + 50 - 100)) / CRUISE;
    notes.push(`cycle ${cycle + 1}: ${party.length} ships, ${k} shot down (loot ${Math.round(got)} kr) ${r1(fight)} s after the warning, hold ${idle ? 'idle after leaving' : (d.state.guild.hold?.phase ?? 'none')}, stage ${d.state.guild.relays.get(lane)?.stage}`);
    loot += got;
    kills += k;
    seconds += fight + flight;
    if (k > 0) cycles++;
    if (d.state.guild.relays.get(lane)?.stage === 'secured') break;
  }
  const perHour = seconds > 0 ? (loot / seconds) * 3600 : 0;
  // with the contract estimate's fight time (75 s per pirate) – the Guild reinforcement arrives 25 s into a fight,
  // so a slower gun also loses kills (no loot) to it and may finish the hold
  const slow = seconds + kills * HUNT_SECONDS_PER_ENEMY;
  const perHourSlow = slow > 0 ? (loot / slow) * 3600 : 0;
  const partySize = RELAY_CHAIN.party[site.depth >= 3 ? 3 : 2].length;
  const farmed = kills > partySize;
  if (farmed) broken.push(`${cycles} counterattacks re-armed with fresh ships (${kills} kills of a ${partySize}-ship party) – the relay hold is a pirate spawn on demand`);
  else notes.push(`${kills} kills of a ${partySize}-ship party in ${cycles} cycle(s) – a re-armed hold brings back only the ships not shot down`);
  return result(
    'relayHoldFarm',
    seed,
    d,
    farmed ? loot : 0,
    broken,
    `lane ${lane}: ${notes.join('; ')}; loot ${Math.round(loot)} kr in ≈ ${Math.round(seconds)} s (lower bound: fights by lethal shots, the way out and back at ${CRUISE} u/s) ≈ ${Math.round(perHour)} kr/h, with ${HUNT_SECONDS_PER_ENEMY} s per kill ≈ ${Math.round(perHourSlow)} kr/h`,
    { cycles, kills, loot: Math.round(loot), seconds: Math.round(seconds), perHour: Math.round(perHour), perHourSlow: Math.round(perHourSlow) },
    perHour,
  );
}

// ------------------------------------------------------------------------------------------------
// W – the Guild Watch and the convoys pay nothing to a shooter: player shots and rams at a live Watch ship, an escort
// convoy ship and a scheduled convoy ship do nothing; pirates the Watch kills leave no cargo loot and are not the
// player's kills (no friendly fire, user decision 2026-10-16).

export function watchNoValue(seed: number): LoopResult {
  const broken: string[] = [];
  const notes: string[] = [];
  // the Watch fight of the save tests (seed 1, a lane-B patrol, a Hammer + Jackal pair)
  const d = new Driver(watchFightGame());
  const kills0 = d.state.stats.kills;
  const rep0 = d.state.career.rep.guild.points;
  const w = d.state.guild.watch[0]!;
  const hull0 = w.hull;
  const shield0 = w.shield;
  // ten player shots straight at the Watch ship
  let hits = 0;
  for (let i = 0; i < 10; i++) {
    const ship = d.state.guild.watch.find((x) => x.id === w.id);
    if (!ship) break;
    const pp = d.state.player.body.pos;
    const away = Math.hypot(pp.x - ship.body.pos.x, pp.y - ship.body.pos.y) || 1;
    const u = { x: (pp.x - ship.body.pos.x) / away, y: (pp.y - ship.body.pos.y) / away };
    const from = { x: ship.body.pos.x + u.x * 12, y: ship.body.pos.y + u.y * 12 };
    d.state.combat.projectiles.push({ id: d.state.combat.nextId++, owner: 'player', pos: from, vel: { x: ship.body.vel.x - u.x * 300, y: ship.body.vel.y - u.y * 300 }, ttl: 20, damage: 50, tier: 1, origin: { ...from } });
    const ev = d.step();
    hits += ev.filter((e) => e.type === 'npcHit' && e.id === w.id && e.by === 'player').length;
  }
  const after = d.state.guild.watch.find((x) => x.id === w.id);
  if (hits || (after && (after.hull < hull0 - 1e-9 || after.shield < Math.min(shield0, after.shield) - 1e-9))) broken.push(`player shots hit the Watch ship (${hits} hits, hull ${after?.hull})`);
  notes.push(`10 player shots at ${w.id}: ${hits} hits, hull ${hull0} → ${after?.hull ?? 'gone'}`);
  // the Watch fights the pirates (5 s), then Watch shots finish them (setup: the fight's outcome): their kills leave
  // no cargo and are not the player's
  let watchKills = 0;
  let watchCargo = 0;
  const wrecks0 = new Set(d.state.combat.wrecks.map((x) => x.id));
  const count = (ev: readonly SimEvent[]): void => {
    for (const e of ev) if (e.type === 'shipDestroyed' && typeof e.by === 'string' && e.by.startsWith('gw:')) watchKills++;
  };
  for (let i = 0; i < 5 * TPS; i++) count(d.sim.step(IDLE_COMMAND));
  const shooter = d.state.guild.watch[0]?.id ?? w.id;
  for (const e of d.state.combat.enemies.filter((x) => x.id.startsWith('test:'))) {
    const tap = (ev: SimEvent): void => count([ev]);
    d.onEvent = tap;
    killByPlayer(d, e.id, 12, shooter);
    d.onEvent = null;
  }
  for (const wr of d.state.combat.wrecks) if (!wrecks0.has(wr.id) && wr.cls === 'pirate') watchCargo += sum(RESOURCE_IDS.map((r) => wr.loot.cargo[r] ?? 0));
  if (watchKills === 0) broken.push('setup: no pirate destroyed by a Watch shot');
  if (watchCargo > 1e-9) broken.push(`Watch kills left ${watchCargo} u of cargo loot`);
  if (d.state.stats.kills !== kills0) broken.push(`the Watch's kills counted as the player's (${d.state.stats.kills - kills0})`);
  notes.push(`${watchKills} pirates destroyed by Watch shots: cargo loot ${watchCargo} u, the player's kills +${d.state.stats.kills - kills0}`);
  // a ram: the ship flown into the Watch ship at 25 u/s
  const ram = d.state.guild.watch[0];
  let ramHull = 0;
  if (ram) {
    const p = d.state.player;
    const h0 = ram.hull;
    const hpOf = (): number => sum(p.grid.parts.map((part) => currentHp(p.hp, part)));
    const hp0 = hpOf();
    const u = { x: ram.body.pos.x - p.body.pos.x, y: ram.body.pos.y - p.body.pos.y };
    const l = Math.hypot(u.x, u.y) || 1;
    const start = { x: ram.body.pos.x - (u.x / l) * 20, y: ram.body.pos.y - (u.y / l) * 20 };
    p.body = { pos: start, vel: { x: (u.x / l) * 25 + ram.body.vel.x, y: (u.y / l) * 25 + ram.body.vel.y }, angle: Math.atan2(u.y, u.x), angVel: 0 };
    p.prevBody = p.body;
    d.idle(3);
    const r2 = d.state.guild.watch.find((x) => x.id === ram.id);
    ramHull = r2 ? h0 - r2.hull : 0;
    if (ramHull > 1e-9) broken.push(`a ram took ${ramHull} hull off the Watch ship`);
    notes.push(`a ram at 25 u/s: Watch hull −${r1(ramHull)}, the player's HP ${r1(hp0)} → ${r1(hpOf())}`);
  }
  // a scheduled convoy ship and an escort convoy ship: player shots pass, nothing is paid
  const link = linkedInRing(seed, 1);
  if (link) {
    const pose = convoyAt(seed, link.pass, link.d.state.tick)!;
    const target = pose.ships[pose.ships.length - 1]!;
    const pp = link.d.state.player.body.pos;
    const from = { x: target.pos.x + (pp.x - target.pos.x) * 0.3, y: target.pos.y + (pp.y - target.pos.y) * 0.3 };
    const l = Math.hypot(target.pos.x - from.x, target.pos.y - from.y) || 1;
    link.d.state.combat.projectiles.push({ id: link.d.state.combat.nextId++, owner: 'player', pos: from, vel: { x: ((target.pos.x - from.x) / l) * 300 + pose.vel.x, y: ((target.pos.y - from.y) / l) * 300 + pose.vel.y }, ttl: 20, damage: 50, tier: 1, origin: { ...from } });
    const c0 = link.d.state.credits;
    const ev = [...link.d.step(), ...link.d.step(), ...link.d.step()];
    const stopped = ev.filter((e) => e.type === 'projectileHit' && 'site' in e && typeof e.site === 'string' && e.site.startsWith('cv:') && e.owner === 'player').length;
    if (stopped) broken.push('a player shot hit a scheduled convoy ship');
    if (link.d.state.credits !== c0) broken.push('a shot at a convoy changed the credits');
    notes.push(`a player shot at ${target.kind} of ${link.pass}: ${stopped ? 'hit' : 'passed through'}, trade still open (link ${link.d.state.convoys.link ? 'kept' : 'lost'})`);
  }
  const esc = escortAt(seed, 50_000);
  if (esc) {
    toMeet(esc.d, esc.contract);
    rideStep(esc.d, esc.contract.serial);
    const tr = escortHitTargets(esc.d.state).find((t) => t.id === `es:${esc.contract.serial}:trader`);
    const rec = esc.d.state.convoys.escorts.get(esc.contract.serial);
    if (tr && rec) {
      const h0 = rec.hulls[0]!;
      const pp = esc.d.state.player.body.pos;
      const away = Math.hypot(pp.x - tr.pos.x, pp.y - tr.pos.y) || 1;
      const u = { x: (pp.x - tr.pos.x) / away, y: (pp.y - tr.pos.y) / away };
      const from = { x: tr.pos.x + u.x * (tr.radius + 3), y: tr.pos.y + u.y * (tr.radius + 3) };
      esc.d.state.combat.projectiles.push({ id: esc.d.state.combat.nextId++, owner: 'player', pos: from, vel: { x: -u.x * 300, y: -u.y * 300 }, ttl: 20, damage: 500, tier: 1, origin: { ...from } });
      esc.d.step();
      esc.d.step();
      const h1 = esc.d.state.convoys.escorts.get(esc.contract.serial)?.hulls[0] ?? 0;
      if (h1 < h0) broken.push(`a player shot took ${h0 - h1} hull off the escorted trader`);
      notes.push(`a player shot at the escorted trader: hull ${h0} → ${h1}`);
    }
  }
  const rep1 = d.state.career.rep.guild.points;
  if (rep1 !== rep0) notes.push(`Guild points ${rep0} → ${rep1}`);
  return result('watchNoValue', seed, d, watchCargo, broken, notes.join('; '), { hits, watchKills, watchCargo, ramHull: Math.round(ramHull * 10) / 10 });
}

// ------------------------------------------------------------------------------------------------
// N – map notes and the route planner create nothing: the Archive node, 35 notes (cap 30), long / control-character
// / non-finite / unknown-icon notes, deletes, ids never reused, a save copy, crafted saves. The route planner is
// game-layer state only (no sim command).

export function mapNotesNoValue(seed: number): LoopResult {
  const broken: string[] = [];
  const notes: string[] = [];
  const d = new Driver(new Simulation({ seed }));
  d.state.credits += 2_000;
  const locked = d.attempt({ type: 'mapNoteSet', pos: { x: 10, y: 10 }, icon: 'star', text: 'x' });
  if (locked.ok) broken.push('a note without the Archive node');
  const node = archiveNode('mapNotes');
  d.state.discovery.dataFund += node.data;
  d.state.discovery.dataTotal += node.data;
  const buy = d.attempt({ type: 'archiveBuy', node: 'mapNotes' });
  const w0 = netWorth(d.state).total;
  let made = 0;
  let full = '';
  for (let i = 0; i < NOTES.max + 5; i++) {
    const r = d.attempt({ type: 'mapNoteSet', pos: { x: i * 100, y: -i * 50 }, icon: 'ore', text: `note ${i}` });
    if (r.ok) made++;
    else full = r.reason ?? '';
  }
  if (made > NOTES.max) broken.push(`${made} notes (max ${NOTES.max})`);
  const ids = d.state.navigation.notes.map((n) => n.id);
  const crafted: [string, GameActionInput][] = [
    ['41 characters', { type: 'mapNoteSet', id: ids[0]!, pos: { x: 0, y: 0 }, icon: 'star', text: 'x'.repeat(NOTES.textMax + 1) }],
    ['control characters only', { type: 'mapNoteSet', id: ids[0]!, pos: { x: 0, y: 0 }, icon: 'star', text: '\u0000\u0007\u001b' }],
    ['NaN position', { type: 'mapNoteSet', id: ids[0]!, pos: { x: Number.NaN, y: 0 }, icon: 'star', text: 'nan' }],
    ['infinite position', { type: 'mapNoteSet', id: ids[0]!, pos: { x: Number.POSITIVE_INFINITY, y: 0 }, icon: 'star', text: 'inf' }],
    ['unknown icon', { type: 'mapNoteSet', id: ids[0]!, pos: { x: 0, y: 0 }, icon: 'gold' as 'star', text: 'icon' }],
    ['unknown id', { type: 'mapNoteSet', id: 9_999, pos: { x: 0, y: 0 }, icon: 'star', text: 'ghost' }],
    ['delete unknown', { type: 'mapNoteDelete', id: 9_999 }],
  ];
  const results = crafted.map(([label, a]) => [label, d.attempt(a)] as const);
  for (const [label, r] of results) if (r.ok) broken.push(`${label} accepted`);
  const edit = d.attempt({ type: 'mapNoteSet', id: ids[0]!, pos: { x: 5, y: 5 }, icon: 'flag', text: ` ${'y'.repeat(NOTES.textMax)}\u0001 ` });
  const del = d.attempt({ type: 'mapNoteDelete', id: ids[1]! });
  const add = d.attempt({ type: 'mapNoteSet', pos: { x: 1, y: 1 }, icon: 'pirate', text: 'again' });
  const newId = d.state.navigation.notes.at(-1)?.id ?? -1;
  if (ids.includes(newId) && add.ok) broken.push(`note id ${newId} reused`);
  const copy = new Driver(cloneSim(d.sim));
  const same = JSON.stringify(copy.state.navigation) === JSON.stringify(d.state.navigation);
  if (!same) broken.push('notes differ after save → load');
  // crafted saves: 100 notes, duplicate ids, a 500-character text
  const s = saveOf(d);
  const nav = s.navigation;
  const many = structuredClone(s);
  many.navigation.notes = Array.from({ length: 100 }, (_, i) => ({ id: i, x: i, y: i, icon: 'star' as const, text: `n${i}` }));
  many.navigation.nextNote = 100;
  const long = structuredClone(s);
  if (long.navigation.notes[0]) long.navigation.notes[0].text = 'z'.repeat(500);
  const dup = structuredClone(s);
  if (dup.navigation.notes[1] && dup.navigation.notes[0]) dup.navigation.notes[1].id = dup.navigation.notes[0].id;
  const loads = (
    [
      ['100 notes', many],
      ['500 characters', long],
      ['duplicate ids', dup],
    ] as const
  ).map(([label, save]) => {
    const { d: l, error } = loadCrafted(save);
    const n = l?.state.navigation.notes ?? [];
    if (l && (n.length > NOTES.max || n.some((x) => x.text.length > NOTES.textMax) || new Set(n.map((x) => x.id)).size !== n.length)) broken.push(`crafted save (${label}) loaded as ${n.length} notes`);
    return `${label} ${l ? `loaded as ${n.length} notes` : `refused (${error})`}`;
  });
  const w1 = netWorth(d.state).total;
  return result(
    'mapNotesNoValue',
    seed,
    d,
    w1 - w0,
    broken,
    `without the node ${reasonOf(locked)}; the node ${reasonOf(buy)} (${node.data} D, ${node.credits} kr); ${made} of ${NOTES.max + 5} notes (then ${full}); crafted ${results.map(([l, r]) => `${l} ${reasonOf(r)}`).join(', ')}; ` +
      `an edit with padding and a control character ${reasonOf(edit)} → "${d.state.navigation.notes.find((n) => n.id === ids[0])?.text.length ?? 0} characters", delete ${reasonOf(del)}, a new note id ${newId} (next ${nav.nextNote}); save copy identical ${same}; crafted saves: ${loads.join(', ')}; net worth ${Math.round(w1 - w0)} kr after the node – notes and routes cost and pay nothing`,
    { made, refused: results.filter(([, r]) => !r.ok).length, copySame: same ? 1 : 0 },
  );
}

// ------------------------------------------------------------------------------------------------
// L – the convoy link as a free ride: riding a pass (fuel, distance, clearance of the station circles at every step,
// no position jump at the unlink), through the turn-around, and a save → load copy while linked.

export function convoyLinkRide(seed: number): LoopResult {
  const broken: string[] = [];
  const notes: string[] = [];
  const metrics: Record<string, number> = {};
  for (const [label, at] of [
    ['departure', (w: { depart: number; turn: number }) => w.depart + 20 * 60],
    ['turn-around', (w: { depart: number; turn: number }) => w.turn - 40 * 60],
  ] as const) {
    let found: { d: Driver; pass: string } | null = null;
    for (const lane of LANES) {
      for (let n = 1; n <= 4 && !found; n++) {
        const pass = `cv:${lane}@${n}`;
        const w = convoyPassWindow(seed, pass);
        if (!w) continue;
        try {
          const d = new Driver(besideTrader(seed, pass, at(w)));
          d.step({ ...IDLE_COMMAND, dock: true });
          if (d.state.convoys.link?.pass === pass) found = { d, pass };
        } catch {
          // not in flight
        }
      }
      if (found) break;
    }
    if (!found) {
      notes.push(`${label}: no pass linked`);
      continue;
    }
    const { d, pass } = found;
    const p = d.state.player;
    const fuel0 = p.fuel;
    let travelled = 0;
    let minClear = Infinity;
    let jump = 0;
    let reason = 'still linked';
    const copy = label === 'departure' ? new Driver(cloneSim(d.sim)) : null;
    let latch = 0;
    for (let i = 0; i < 120 * TPS; i++) {
      const before = { ...p.body.pos };
      const ev = d.step();
      const step = dist(before, p.body.pos);
      travelled += step;
      // the first steps pin the ship to the port (the latch); a jump later would be a teleport
      if (i < 30) latch = Math.max(latch, step);
      else jump = Math.max(jump, step);
      for (const c of d.state.world.stationCirclesNear(p.body.pos, 300)) minClear = Math.min(minClear, dist(c.pos, p.body.pos) - c.radius - p.props.boundingRadius);
      const un = ev.find((e) => e.type === 'convoyUnlinked');
      if (un && un.type === 'convoyUnlinked') {
        reason = un.reason;
        // after the unlink the ship keeps the convoy's velocity: no jump on the next steps
        for (let k = 0; k < 30; k++) {
          const b = { ...p.body.pos };
          d.step();
          jump = Math.max(jump, dist(b, p.body.pos));
        }
        break;
      }
    }
    // the pinned pose swings with the trader's heading at the route's corners (a few u); a teleport would be far more
    if (jump > 10) broken.push(`${label}: the ship jumped ${r1(jump)} u in one step`);
    if (minClear < -1) broken.push(`${label}: the ship sat ${r1(-minClear)} u inside a station circle`);
    if (copy) {
      for (let i = 0; i < 10 * TPS; i++) copy.step();
      const same = dist(copy.state.player.body.pos, d.state.player.body.pos) >= 0 && copy.state.convoys.link?.pass === pass;
      notes.push(`save copy while linked: ${same ? 'still linked' : `link ${copy.state.convoys.link?.pass ?? 'dropped'}`}`);
    }
    const used = fuel0 - p.fuel;
    metrics[`${label}:travelled`] = Math.round(travelled);
    notes.push(`${label} (${pass}): ${Math.round(travelled)} u ridden, fuel ${r1(used)}, ${reason === 'still linked' ? 'still linked after 120 s' : `unlinked (${reason})`}, nearest station circle ${Number.isFinite(minClear) ? `${Math.round(minClear)} u` : '> 300 u'}, largest step ${r1(jump)} u (latch ${r1(latch)} u)`);
  }
  // the ride's worth: the fuel a 10 u/s trip would burn – the free ride saves a few credits per km
  const perKm = 1000 / CONVOY.speed / 60;
  return result('convoyLinkRide', seed, null, 0, broken, `${notes.join('; ')} – a linked ship rides at ${CONVOY.speed} u/s (${r1(perKm)} min per 1 000 u) for free: slower than flying, nothing to sell`, metrics);
}

// ------------------------------------------------------------------------------------------------
// X – crafted convoy commands: not linked (docked, flying), malformed slots / quantities / amounts / resources, two
// buys of one slot in one step, `debugGuild` outside a dev build.

export function convoyCrafted(seed: number): LoopResult {
  const broken: string[] = [];
  const checks: string[] = [];
  const d = new Driver(new Simulation({ seed }));
  d.state.credits += 20_000;
  d.state.player.cargo.iron = 40;
  const notLinked: GameActionInput[] = [
    { type: 'convoyBuy', slot: 0 },
    { type: 'convoySell', resource: 'iron', qty: 10 },
    { type: 'convoyFuel', amount: 'full' },
    { type: 'convoyUnlink' },
  ];
  const c0 = d.state.credits;
  for (const a of notLinked) {
    const r = d.attempt(a);
    if (r.ok) broken.push(`${a.type} accepted while docked`);
    checks.push(`docked ${a.type} ${reasonOf(r)}`);
  }
  d.undock();
  for (const a of notLinked) {
    const r = d.attempt(a);
    if (r.ok) broken.push(`${a.type} accepted while flying unlinked`);
  }
  const pass = LANES.map((l) => `cv:${l}@0`).find((x) => convoyAt(seed, x, d.state.tick + 1) !== null);
  let linked = false;
  let expected = 0;
  if (pass && linkHere(d, pass)) {
    linked = true;
    const offer = convoyOffer(d.state, pass)!;
    const bad: [string, GameActionInput][] = [
      ['slot 7', { type: 'convoyBuy', slot: 7 }],
      ['slot −1', { type: 'convoyBuy', slot: -1 }],
      ['slot 1.5', { type: 'convoyBuy', slot: 1.5 }],
      ['slot NaN', { type: 'convoyBuy', slot: Number.NaN }],
      ['sell −5', { type: 'convoySell', resource: 'iron', qty: -5 }],
      ['sell 0', { type: 'convoySell', resource: 'iron', qty: 0 }],
      ['sell NaN', { type: 'convoySell', resource: 'iron', qty: Number.NaN }],
      ['sell ∞', { type: 'convoySell', resource: 'iron', qty: Number.POSITIVE_INFINITY }],
      ['sell 1e9', { type: 'convoySell', resource: 'iron', qty: 1e9 }],
      ['sell gold', { type: 'convoySell', resource: 'gold' as ResourceId, qty: 1 }],
      ['sell empty copper', { type: 'convoySell', resource: 'copper', qty: 'all' }],
      ['fuel 0', { type: 'convoyFuel', amount: 0 }],
      ['fuel −1', { type: 'convoyFuel', amount: -1 }],
    ];
    for (const [label, a] of bad) {
      const r = d.attempt(a);
      if (r.ok) broken.push(`${label} accepted`);
      checks.push(`${label} ${reasonOf(r)}`);
    }
    // two buys of one slot and two 'all' sales in one step
    const slot = offer.items[0]?.slot ?? 0;
    const before = d.state.credits;
    const both = d.act({ type: 'convoyBuy', slot }, { type: 'convoyBuy', slot });
    const spent = before - d.state.credits;
    expected += offer.items[0]?.price ?? 0;
    if (both || spent > (offer.items[0]?.price ?? 0)) broken.push(`slot ${slot} bought twice in one step (${spent} kr)`);
    const b2 = d.state.credits;
    d.act({ type: 'convoySell', resource: 'iron', qty: 'all' }, { type: 'convoySell', resource: 'iron', qty: 'all' });
    const got = d.state.credits - b2;
    const max = saleValue(40, convoySellUnit('iron', offer.ring));
    if (got > max + EPS) broken.push(`two sales of all iron in one step paid ${got} > ${max}`);
    expected -= got;
    checks.push(`two buys of slot ${slot} in one step: ${spent} kr; two 'all' sales: ${got} kr (40 u worth ${max})`);
  }
  // debugGuild: a dev-build command (production builds refuse it – saboteur.test.ts stubs DEV)
  const dev = !!import.meta.env.DEV;
  const dbg = d.attempt({ type: 'debugGuild', what: 'secure' });
  if (!dev && dbg.ok) broken.push('debugGuild accepted outside a dev build');
  const delta = c0 - d.state.credits - expected;
  return result(
    'convoyCrafted',
    seed,
    d,
    Math.max(0, -delta),
    broken,
    `${linked ? `linked to ${pass}` : 'no link'}: ${checks.join(', ')}; debugGuild with DEV = ${dev}: ${reasonOf(dbg)}`,
    { checks: checks.length, dev: dev ? 1 : 0, debugAccepted: dbg.ok ? 1 : 0 },
  );
}

// ------------------------------------------------------------------------------------------------
// S – a save → load around a link: the link (a pass in flight), the trade record (cap, slots) and crafted trades /
// links (sold below 0 or above the cap, every slot bit, a pass not in flight).

export function convoySaveLoad(seed: number): LoopResult {
  const broken: string[] = [];
  const notes: string[] = [];
  const link = linkedInRing(seed, 1);
  if (!link) return result('convoySaveLoad', seed, null, 0, [], 'no ring-1 pass linked', {});
  const { d, pass } = link;
  d.state.credits += 20_000;
  d.state.player.cargo.iron = 100;
  d.attempt({ type: 'convoySell', resource: 'iron', qty: 100 });
  const offer = convoyOffer(d.state, pass)!;
  if (offer.items[0]) d.attempt({ type: 'convoyBuy', slot: offer.items[0].slot });
  const copy = new Driver(cloneSim(d.sim));
  const co = convoyOffer(copy.state, pass);
  const linkKept = copy.state.convoys.link?.pass === pass;
  if (!co || co.sellLeft !== CONVOY.buyCap - 100) broken.push(`the copy's cap left ${co?.sellLeft} ≠ ${CONVOY.buyCap - 100}`);
  notes.push(`save copy: link ${linkKept ? 'kept' : 'dropped'}, cap left ${co?.sellLeft}, slot ${offer.items[0]?.slot} ${copy.attempt({ type: 'convoyBuy', slot: offer.items[0]?.slot ?? 0 }).ok ? 'SOLD AGAIN' : 'sold'}`);
  // crafted trades: sold −1000 (a bigger cap), every slot bit cleared, a link to a pass that is not in flight
  const s = saveOf(d);
  const trade = s.convoys.trades.find(([p]) => p === pass);
  const variants: [string, (x: typeof s) => void][] = [
    ['sold −1000', (x) => { const t = x.convoys.trades.find(([p]) => p === pass); if (t) t[1].sold = -1000; }],
    ['sold 1e9', (x) => { const t = x.convoys.trades.find(([p]) => p === pass); if (t) t[1].sold = 1e9; }],
    ['bought 0xff', (x) => { const t = x.convoys.trades.find(([p]) => p === pass); if (t) t[1].bought = 0xff; }],
    ['a link to cv:A@999', (x) => { x.convoys.link = { pass: 'cv:A@999', since: 0 }; }],
    ['trades of 5 passes not in flight', (x) => { for (let n = 50; n < 55; n++) x.convoys.trades.push([`cv:B@${n}`, { bought: 0, sold: 0, fuel: 0 }]); }],
  ];
  let extra = 0;
  for (const [label, edit] of variants) {
    const x = structuredClone(s);
    edit(x);
    const { d: l, error } = loadCrafted(x);
    if (!l) {
      notes.push(`${label}: refused (${error})`);
      continue;
    }
    const lo = l.state.convoys.link ? convoyOffer(l.state, l.state.convoys.link.pass) : null;
    const left = lo?.sellLeft ?? 0;
    if (left > CONVOY.buyCap - (trade?.[1].sold ?? 0) + 1e-6 && label.startsWith('sold')) {
      // the cap is per pass: more than what was left before the edit is a gain
      broken.push(`crafted ${label}: ${left} u left to sell`);
      extra = Math.max(extra, (left - (CONVOY.buyCap - (trade?.[1].sold ?? 0))) * convoySellUnit('iron', offer.ring));
    }
    notes.push(`${label}: loaded, link ${l.state.convoys.link?.pass ?? 'none'}, cap left ${left}, trades ${l.state.convoys.trades.size}`);
  }
  return result('convoySaveLoad', seed, d, extra, broken, `${pass}: ${notes.join('; ')}`, { linkKept: linkKept ? 1 : 0, capLeft: co?.sellLeft ?? -1 });
}

/** Every M4d probe of one seed. */
export function guildProbes(seed: number): LoopResult[] {
  return [
    convoyArbitrage(seed),
    convoyCap(seed),
    convoyItems(seed),
    tankerFuel(seed),
    convoySaveLoad(seed),
    convoyLinkRide(seed),
    convoyCrafted(seed),
    escortDeposit(seed),
    escortCancelFarm(seed),
    escortStack(seed),
    relayDoublePay(seed),
    relayHoldFarm(seed),
    watchNoValue(seed),
    mapNotesNoValue(seed),
  ];
}

/** Ids of the probes, for the report and the quick test. */
export const GUILD_PROBE_IDS = [
  'convoyArbitrage',
  'convoyCap',
  'convoyItems',
  'tankerFuel',
  'convoySaveLoad',
  'convoyLinkRide',
  'convoyCrafted',
  'escortDeposit',
  'escortCancelFarm',
  'escortStack',
  'relayDoublePay',
  'relayHoldFarm',
  'watchNoValue',
  'mapNotesNoValue',
] as const;
