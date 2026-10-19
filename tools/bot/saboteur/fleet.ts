// Saboteur probes for the hangar, the fleet and the ship templates (M4a, task T9). Each
// probe plays the real simulation through station actions (and a few crafted ones a modified client
// could send) and must gain nothing: no net worth, part, cargo or fuel out of thin air, no Guild loan
// part outside a hull, no repair skipped, no slot or name past its limits, no design applied for less
// than the shipyard charges. Setup steps that would take an hour of play (a rich player, the Archive
// node "Ship templates") top up credits / Data directly, like the save fixtures (tools/fixtures) do;
// from then on only actions run, and every gain is measured from after the setup.
import { INSTALL_FEE, partBuyPrice } from '../../../src/data/economy';
import { SHIP_NAME_MAX } from '../../../src/data/fleet';
import { ALL_PART_KEYS, partKey, type PartInventory, type PartKey } from '../../../src/data/parts';
import { RESOURCE_IDS, type Cargo } from '../../../src/data/resources';
import { partUnlocked } from '../../../src/sim/discovery/archive';
import { nextSlotPrice } from '../../../src/sim/fleet/state';
import type { StoredShip } from '../../../src/sim/fleet/types';
import { toSave } from '../../../src/sim/save/serialize';
import type { DeathPenalty } from '../../../src/sim/settings';
import { currentHp, maxHp } from '../../../src/sim/ship/hp';
import { isLoanPart } from '../../../src/sim/ship/loan';
import type { PlacedPart, Rotation } from '../../../src/sim/ship/types';
import { templateOps } from '../../../src/sim/shipyard/template';
import { guildLoanOffer } from '../../../src/sim/station/guildLoan';
import { stationStorage } from '../../../src/sim/station/storage';
import { base64UrlEncode, decodeTemplate, encodeTemplate, templateChecksum, TEMPLATE_CODE_PREFIX } from '../../../src/sim/templates/codec';
import { gridTemplateParts, normalizeParts } from '../../../src/sim/templates/normalize';
import { templateCap } from '../../../src/sim/templates/state';
import type { ShipTemplate, TemplatePart } from '../../../src/sim/templates/types';
import type { SimState } from '../../../src/sim/Simulation';
import { HOME_STATION_ID } from '../../../src/sim/world/stations';
import { planFromOps } from '../shipPlan';
import { cloneSim, Driver, isMiningKey, keyOf, newGame, TPS } from './harness';
import type { LoopResult } from './scenarios';
import { netWorth } from './value';

const COCKPIT: PartKey = 'cockpit:1';
/** Tolerance of the net-worth comparisons (credits are integers, resources may be fractional). */
const EPS = 1;

// ------------------------------------------------------------------------------------------------
// helpers

/** A new game docked at home with `credits` more credits (setup: an hour of mining skipped). */
function richGame(seed: number, penalty: DeathPenalty, credits: number): Driver {
  const d = new Driver(newGame(seed, penalty));
  d.state.credits += credits;
  return d;
}

/** Every part the player owns, by key: mounted (no loans), in storages, on board, shipped, on stored ships. */
export function ownedParts(state: SimState): PartInventory {
  const out: PartInventory = {};
  const add = (k: PartKey, n: number): void => {
    if (n) out[k] = (out[k] ?? 0) + n;
  };
  const addInv = (inv: PartInventory): void => {
    for (const [k, n] of Object.entries(inv) as [PartKey, number][]) add(k, n ?? 0);
  };
  if (!state.player.destroyed) for (const p of state.player.grid.parts) if (!isLoanPart(p)) add(keyOf(p), 1);
  addInv(state.player.salvage);
  for (const s of state.stations.values()) addInv(s.parts);
  for (const sh of state.career.shipments) addInv(sh.parts);
  for (const s of state.fleet.stored) for (const p of s.grid.parts) add(keyOf(p), 1);
  return out;
}

/** Keys whose count differs (b − a), for messages. */
export function partsDiff(a: PartInventory, b: PartInventory): Partial<Record<PartKey, number>> {
  const out: Partial<Record<PartKey, number>> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<PartKey>) {
    const d = (b[k] ?? 0) - (a[k] ?? 0);
    if (d) out[k] = d;
  }
  return out;
}

/** Loan parts on stored ships (hull or blueprint) – the hangar never holds Guild property. */
function strayLoans(state: SimState): number {
  let n = 0;
  for (const s of state.fleet.stored) n += s.grid.parts.filter(isLoanPart).length + s.blueprint.parts.filter(isLoanPart).length;
  return n;
}

/** Fuel in the whole fleet (active tank + stored tanks). */
const fleetFuel = (state: SimState): number => state.player.fuel + state.fleet.stored.reduce((s, x) => s + x.fuel, 0);

/** Resources the player owns in units: cargo, storages, shipments, stored ships' cargo. */
function fleetResources(state: SimState): number {
  const sum = (c: Partial<Cargo>): number => RESOURCE_IDS.reduce((s, r) => s + (c[r] ?? 0), 0);
  let n = sum(state.player.cargo);
  for (const s of state.stations.values()) n += sum(s.resources);
  for (const sh of state.career.shipments) n += sum(sh.resources);
  for (const s of state.fleet.stored) n += sum(s.cargo);
  return n;
}

/** Missing HP of a hull (Σ max − current) – damage a switch, a save or a template must never heal. */
const damage = (parts: readonly PlacedPart[], hp: Map<number, number>): number => parts.reduce((s, p) => s + (maxHp(p) - currentHp(hp, p)), 0);

/** The fleet-related sections of a save (JSON) – what a save → load must give back exactly. */
const fleetSave = (d: Driver): string => {
  const save = toSave(d.sim, { gameId: 'f', name: 'f', createdAt: '2026-10-17T10:00:00.000Z', savedAt: '2026-10-17T10:00:00.000Z', reason: 'manual', gameVersion: 'bot' });
  return JSON.stringify([save.fleet, save.templates, save.credits, save.player, save.stations]);
};

const storedById = (d: Driver, id: number): StoredShip | undefined => d.state.fleet.stored.find((s) => s.record.id === id);

/** Starts a second ship here (cockpit bought), the active one is parked: returns the parked ship's id. */
function parkActive(d: Driver, acquire: 'buy' | undefined = 'buy'): number | null {
  const id = d.state.fleet.active.id;
  const r = d.attempt({ type: 'hangarNewShip', cockpit: COCKPIT, ...(acquire ? { acquire } : {}) });
  return r.ok ? id : null;
}

const result = (
  id: string,
  seed: number,
  penalty: DeathPenalty,
  d: Driver,
  gain: number,
  broken: string[],
  detail: string,
  metrics: Record<string, number>,
  help: Record<string, number> = {},
): LoopResult => ({
  id,
  seed,
  penalty,
  seconds: d.state.tick / TPS,
  gain,
  perHour: 0,
  baselinePerHour: null,
  help,
  exploit: broken.length > 0 || gain > EPS,
  tick: broken.length ? d.state.tick : null,
  detail: broken.length ? `BROKEN: ${broken.join('; ')} – ${detail}` : detail,
  metrics,
});

// ------------------------------------------------------------------------------------------------
// F1 – switch shuffle: switch back and forth (and start / dismantle cockpit ships) to duplicate cargo,
// fuel or parts; sell the cargo, refuel and dock between the switches

export function fleetSwitch(seed: number): LoopResult {
  const penalty: DeathPenalty = 'mild';
  const d = richGame(seed, penalty, 20_000);
  const broken: string[] = [];
  // setup: ore in the hold of the starter (as if mined) – the probe tries to sell it twice
  d.state.player.cargo.iron += 12;
  d.state.player.cargo.copper += 6;
  if (!d.attempt({ type: 'hangarBuySlot' }).ok) broken.push('slot purchase refused');
  const a = parkActive(d);
  if (a === null) return result('fleetSwitch', seed, penalty, d, 0, ['new ship refused'], 'setup failed', {});
  const b = d.state.fleet.active.id;
  const w0 = netWorth(d.state).total;
  const fuel0 = fleetFuel(d.state);
  const res0 = fleetResources(d.state);
  const parts0 = ownedParts(d.state);
  const cargoA = { ...storedById(d, a)!.cargo };
  let switches = 0;
  let maxGain = -Infinity;
  let refuelPaid = 0;
  for (let i = 0; i < 12; i++) {
    const to = d.state.fleet.active.id === a ? b : a;
    if (d.attempt({ type: 'hangarSwitch', shipId: to }).ok) switches++;
    else broken.push(`switch ${i} refused`);
    // the cargo of A comes back with A, never with B
    if (d.state.fleet.active.id === b && RESOURCE_IDS.some((r) => d.state.player.cargo[r] > 1e-9)) broken.push('cargo appeared on the cockpit ship');
    if (i === 0 && d.state.fleet.active.id === a && RESOURCE_IDS.some((r) => Math.abs(d.state.player.cargo[r] - cargoA[r]) > 1e-9)) broken.push('cargo changed while stored');
    d.idle(1);
    maxGain = Math.max(maxGain, netWorth(d.state).total - w0);
  }
  // sell A's cargo once, switch away and back: nothing to sell again
  if (d.state.fleet.active.id !== a) d.attempt({ type: 'hangarSwitch', shipId: a });
  const firstSale = d.sellCargo();
  d.attempt({ type: 'hangarSwitch', shipId: b });
  d.attempt({ type: 'hangarSwitch', shipId: a });
  const secondSale = d.sellCargo();
  if (secondSale > 0) broken.push(`cargo sold twice (${secondSale} kr)`);
  // burn some fuel on a short flight, refuel A, switch to B and back: the fuel bought stays with A,
  // B's tank is still empty
  const home = d.docked()!;
  d.undock();
  d.flyTo({ x: home.pos.x + 150, y: home.pos.y }, { seconds: 25 });
  if (!d.dockAt(home, 120)) broken.push('could not dock back home');
  const credits = d.state.credits;
  d.act({ type: 'refuel', source: 'credits', amount: 'full' });
  refuelPaid = credits - d.state.credits;
  const fuelA = d.state.player.fuel;
  d.attempt({ type: 'hangarSwitch', shipId: b });
  if (d.state.player.fuel > 1e-9) broken.push('fuel appeared in the cockpit ship');
  d.attempt({ type: 'hangarSwitch', shipId: a });
  if (Math.abs(d.state.player.fuel - fuelA) > 1e-9) broken.push('fuel changed while stored');
  // the fleet's resources only fell by the cargo sold; the fuel only rose by what was paid for
  const fuelGain = fleetFuel(d.state) - fuel0;
  if (refuelPaid <= 0 && fuelGain > 1e-6) broken.push(`free fuel ${fuelGain.toFixed(2)}`);
  const resNow = fleetResources(d.state);
  if (resNow > res0 + 1e-6) broken.push(`resources grew ${res0} → ${resNow}`);
  const diff = partsDiff(parts0, ownedParts(d.state));
  if (Object.keys(diff).length) broken.push(`parts changed ${JSON.stringify(diff)}`);
  if (strayLoans(d.state)) broken.push('a loan part on a stored ship');
  // the gain: the cargo sale converts ore to credits (home sell price = valuation), the refuel costs
  const gain = netWorth(d.state).total - w0;
  return result(
    'fleetSwitch',
    seed,
    penalty,
    d,
    Math.max(gain, maxGain),
    broken,
    `${switches} switches A ↔ B; cargo sold once (${firstSale} kr), again after a round-trip ${secondSale} kr; refuel ${refuelPaid} kr stays with A; parts, resources and fuel conserved; net worth ${Math.round(gain)} kr`,
    { switches, firstSale, secondSale, maxGain: Math.round(maxGain), fuelGain: Math.round(fuelGain * 100) / 100 },
  );
}

// ------------------------------------------------------------------------------------------------
// F2 – damaged-part laundering: park a damaged ship (new ship), switch back – the damage stays; dismantle
// it – the damaged parts cost exactly what removing them in the shipyard costs (same repair / scrap)

export function fleetLaunder(seed: number): LoopResult {
  const penalty: DeathPenalty = 'mild';
  const d = richGame(seed, penalty, 20_000);
  const broken: string[] = [];
  d.attempt({ type: 'hangarBuySlot' });
  // a spare cockpit in storage for the new ship and iron for the repairs (same in both branches)
  d.act({ type: 'buyPart', key: COCKPIT, count: 1 });
  d.act({ type: 'buyResource', resource: 'iron', qty: 60 });
  // setup damage through the dev action (as if hit by pirates): the radar and the fuel tank (parts the
  // shipyard can take off the starter without cutting an engine loose)
  const victims = d.state.player.grid.parts.filter((p) => p.partId === 'radar' || p.partId === 'fuelTank');
  for (const p of victims) d.act({ type: 'debugDamage', partId: p.id, hp: Math.max(1, Math.round(maxHp(p) * 0.3)) });
  const dmg0 = damage(d.state.player.grid.parts, d.state.player.hp);
  if (dmg0 <= 0) broken.push('setup: no damage');

  // X: park the damaged ship, switch back (damage kept), park again, dismantle it
  const x = new Driver(cloneSim(d.sim));
  const a = parkActive(x, undefined);
  if (a === null) return result('fleetLaunder', seed, penalty, d, 0, ['new ship from the storage cockpit refused'], 'setup failed', {});
  const b = x.state.fleet.active.id;
  x.attempt({ type: 'hangarSwitch', shipId: a });
  const dmgBack = damage(x.state.player.grid.parts, x.state.player.hp);
  if (Math.abs(dmgBack - dmg0) > 1e-6) broken.push(`switching healed ${dmg0 - dmgBack} HP`);
  // and through a save copy
  const copy = new Driver(cloneSim(x.sim));
  if (Math.abs(damage(copy.state.player.grid.parts, copy.state.player.hp) - dmg0) > 1e-6) broken.push('save → load healed the ship');
  x.attempt({ type: 'hangarSwitch', shipId: b });
  const storedDmg = damage(storedById(x, a)!.grid.parts, storedById(x, a)!.hp);
  if (Math.abs(storedDmg - dmg0) > 1e-6) broken.push('parking healed the ship');
  const wx = netWorth(x.state).total;
  const dis = x.attempt({ type: 'hangarDismantle', shipId: a });
  const fee = dis.events.reduce((s, e) => s + (e.type === 'shipDismantled' ? e.fee : 0), 0);
  const gainX = netWorth(x.state).total - wx;

  // Y: the same damaged parts removed in the shipyard (the honest way)
  const y = new Driver(cloneSim(d.sim));
  const wy = netWorth(y.state).total;
  const cy = y.state.credits;
  const removed = y.commit(victims.map((p) => ({ op: 'remove' as const, id: p.id })));
  const gainY = netWorth(y.state).total - wy;
  const shipyardFee = cy - y.state.credits;
  if (!dis.ok) broken.push(`dismantle refused (${dis.reason})`);
  if (!removed) broken.push('shipyard removal refused');
  // the intact parts and the cargo move 1:1 (neutral), the fuel is lost: X may never beat Y
  const launder = gainX - gainY;
  return result(
    'fleetLaunder',
    seed,
    penalty,
    x,
    launder,
    broken,
    `damage ${Math.round(dmg0)} HP kept through park / switch / save; dismantle fee ${fee} kr vs shipyard removal ${shipyardFee} kr; net worth dismantle ${Math.round(gainX)} vs shipyard ${Math.round(gainY)} kr`,
    { fee, shipyardFee, gainDismantle: Math.round(gainX), gainShipyard: Math.round(gainY), damage: Math.round(dmg0) },
  );
}

// ------------------------------------------------------------------------------------------------
// F3 – Guild loans and the hangar: no loan while a flyable ship stands here; a loan part never parks
// (switching away returns it), cycling switches re-lends but never turns a loan into value

export function fleetLoan(seed: number): LoopResult {
  const penalty: DeathPenalty = 'mild';
  const d = richGame(seed, penalty, 20_000);
  const broken: string[] = [];
  d.attempt({ type: 'hangarBuySlot' });
  const a = parkActive(d);
  if (a === null) return result('fleetLoan', seed, penalty, d, 0, ['new ship refused'], 'setup failed', {});
  const b = d.state.fleet.active.id;
  // B = a cockpit alone: no laser, no engine – but the flyable starter A stands here
  d.idle(2);
  const st = d.docked()!;
  const loansWhileFlyable = d.counts.guildLoan ?? 0;
  if (loansWhileFlyable > 0 || guildLoanOffer(d.state, st).length > 0) broken.push('Guild lent while a flyable ship stands here');
  // B's cockpit wrecked (setup through the dev action: as if shot up) – worth only scrap in the means test
  const cockpit = d.state.player.grid.parts.find((p) => p.partId === 'cockpit')!;
  d.act({ type: 'debugDamage', partId: cockpit.id, hp: 1 });
  // back to A, strip it to the smallest hull (the laser goes too), sell the parts, the cargo and the
  // storage, burn the credits: now the Guild lends A a laser
  d.attempt({ type: 'hangarSwitch', shipId: a });
  d.stripToMinimum();
  d.sellStorageParts();
  d.sellCargo();
  d.burnCredits();
  d.idle(1);
  const w0 = netWorth(d.state).total;
  const parts0 = ownedParts(d.state);
  let returned = 0;
  let maxGain = -Infinity;
  for (let i = 0; i < 6; i++) {
    const to = d.state.fleet.active.id === a ? b : a;
    const r = d.attempt({ type: 'hangarSwitch', shipId: to });
    if (!r.ok) broken.push(`switch ${i} refused (${r.reason})`);
    for (const e of r.events) if (e.type === 'shipSwitched') returned += Object.values(e.loanReturned).reduce((s, n) => s + (n ?? 0), 0);
    d.idle(1);
    if (strayLoans(d.state)) broken.push('a loan part parked in the hangar');
    // try to cash in: take the loan off and sell the storage
    const loans = d.state.player.grid.parts.filter(isLoanPart);
    if (loans.length) d.commit(loans.map((p) => ({ op: 'remove' as const, id: p.id })));
    d.sellStorageParts();
    d.idle(1);
    maxGain = Math.max(maxGain, netWorth(d.state).total - w0);
  }
  // dismantle the parked ship: only its own parts reach the storage
  const parked = d.state.fleet.stored[0];
  let loanInStorage = 0;
  if (parked) {
    d.attempt({ type: 'hangarDismantle', shipId: parked.record.id });
    loanInStorage = Object.entries(stationStorage(d.state, HOME_STATION_ID).parts).filter(([k, n]) => (n ?? 0) > 0 && isMiningKey(k as PartKey)).length;
  }
  const diff = partsDiff(parts0, ownedParts(d.state));
  // dismantling scraps the wrecked cockpit (its scrap goes to storage) and sells nothing else: the
  // owned parts may only drop, never grow
  for (const [k, n] of Object.entries(diff) as [PartKey, number][]) if (n > 0) broken.push(`part ${k} +${n} out of a loan`);
  if (loanInStorage) broken.push('a laser reached the storage');
  const gain = Math.max(maxGain, netWorth(d.state).total - w0);
  return result(
    'fleetLoan',
    seed,
    penalty,
    d,
    gain,
    broken,
    `with the starter parked here the cockpit-only ship got ${loansWhileFlyable} loans; liquidated: ${d.counts.guildLoan ?? 0} loans over 6 switches and cash-in attempts, ${returned} loan parts returned on parking, none parked, stored or sold; net worth ${Math.round(gain)} kr`,
    { loansWhileFlyable, loans: d.counts.guildLoan ?? 0, returned, maxGain: Math.round(maxGain) },
    { guildLoan: d.counts.guildLoan ?? 0 },
  );
}

// ------------------------------------------------------------------------------------------------
// F4 – Hard: scuttle the cockpit ship for a Guild loan hull, switch to the parked ship (the loan hull
// dissolves), try to dismantle / park / sell the loan hull

export function fleetHardHull(seed: number): LoopResult {
  const penalty: DeathPenalty = 'hard';
  const d = richGame(seed, penalty, 12_000);
  const broken: string[] = [];
  d.attempt({ type: 'hangarBuySlot' });
  const a = parkActive(d);
  if (a === null) return result('fleetHardHull', seed, penalty, d, 0, ['new ship refused'], 'setup failed', {});
  const b = d.state.fleet.active.id;
  const w0 = netWorth(d.state).total;
  const parts0 = ownedParts(d.state);
  // scuttle the cockpit-only ship B: Hard → a means-tested loan hull (B's identity stays active)
  const scuttled = d.scuttle();
  if (!scuttled) d.idle(d.opts.deathSeconds + 1);
  const hull = d.state.player.grid.parts;
  const lent = hull.filter(isLoanPart).length;
  const ownedOnHull = hull.length - lent;
  const dock = d.docked();
  let dissolved = false;
  let dismantleDissolved: string | undefined;
  let newShipOk = false;
  if (dock?.id === HOME_STATION_ID) {
    // switch to A: the loan hull has no cockpit of its own → it dissolves, nothing parks
    const r = d.attempt({ type: 'hangarSwitch', shipId: a });
    dissolved = r.events.some((e) => e.type === 'shipDissolved');
    for (const e of r.events) if (e.type === 'shipDissolved' && Object.keys(e.parts).some((k) => isMiningKey(k as PartKey) || k.startsWith('engine'))) broken.push('loan parts reached the storage');
    dismantleDissolved = d.attempt({ type: 'hangarDismantle', shipId: b }).reason;
    if (dismantleDissolved === undefined) broken.push('dismantled a dissolved ship');
    // the slot is free again (A left it): a fresh cockpit ship is paid for in full
    const credits = d.state.credits;
    newShipOk = d.attempt({ type: 'hangarNewShip', cockpit: COCKPIT, acquire: 'buy' }).ok;
    if (newShipOk && credits - d.state.credits < (partBuyPrice(COCKPIT, dock.ring) ?? 0)) broken.push('a new ship cheaper than its cockpit');
  } else broken.push(`respawned at ${dock?.id ?? 'nowhere'}`);
  if (strayLoans(d.state)) broken.push('a loan part stored');
  const diff = partsDiff(parts0, ownedParts(d.state));
  for (const [k, n] of Object.entries(diff) as [PartKey, number][]) if (n > 0 && !(k === COCKPIT && newShipOk && n === 1)) broken.push(`part ${k} +${n}`);
  // the cockpit lost with B, the tow fee and (when bought) the new cockpit's buy-back loss: never positive
  const gain = netWorth(d.state).total - w0;
  return result(
    'fleetHardHull',
    seed,
    penalty,
    d,
    gain,
    broken,
    `scuttled the cockpit ship: loan hull of ${lent} lent + ${ownedOnHull} owned parts; switch to the parked starter ${dissolved ? 'dissolved it' : 'did not dissolve it'}, dismantling it → ${dismantleDissolved ?? 'ok'}; net worth ${Math.round(gain)} kr (the cockpit lost, the tow fee, a new cockpit bought)`,
    { lent, ownedOnHull, dissolved: dissolved ? 1 : 0 },
    { death: d.counts.death ?? 0 },
  );
}

// ------------------------------------------------------------------------------------------------
// F5 – crafted hangar actions: slots at and past the cap, names of 1000 characters / control characters
// / not strings, unknown ships, cockpits that are not cockpits, a switch in flight

export function fleetCrafted(seed: number): LoopResult {
  const penalty: DeathPenalty = 'mild';
  const d = new Driver(newGame(seed, penalty));
  const broken: string[] = [];
  const refused = (label: string, action: Parameters<Driver['attempt']>[0], reason?: string): void => {
    const before = JSON.stringify([d.state.credits, d.state.fleet.slots.size, d.state.fleet.stored.length, d.state.fleet.active.name, d.state.fleet.nextShipId]);
    const r = d.attempt(action);
    if (r.ok) broken.push(`${label} accepted`);
    else if (reason && r.reason !== reason) broken.push(`${label}: ${r.reason} instead of ${reason}`);
    const after = JSON.stringify([d.state.credits, d.state.fleet.slots.size, d.state.fleet.stored.length, d.state.fleet.active.name, d.state.fleet.nextShipId]);
    if (after !== before) broken.push(`${label} changed the state`);
  };
  let checks = 0;
  const check = (label: string, action: Parameters<Driver['attempt']>[0], reason?: string): void => {
    checks++;
    refused(label, action, reason);
  };
  check('slot without credits', { type: 'hangarBuySlot' }, 'notEnoughCredits');
  d.state.credits += 100_000; // setup: a rich player
  const c0 = d.state.credits;
  const prices: number[] = [];
  for (let i = 0; i < 2; i++) {
    const before = d.state.credits;
    if (d.attempt({ type: 'hangarBuySlot' }).ok) prices.push(before - d.state.credits);
  }
  if (prices[0] !== 5000 || prices[1] !== 15000) broken.push(`slot prices ${prices.join(', ')}`);
  check('slot past the cap', { type: 'hangarBuySlot' }, 'slotCap');
  if (nextSlotPrice(d.state) !== null) broken.push('a price past the cap');
  const id = d.state.fleet.active.id;
  check('1000-character name', { type: 'hangarRename', shipId: id, name: 'X'.repeat(1000) }, 'invalidName');
  check('control characters only', { type: 'hangarRename', shipId: id, name: '\u0000​‮\n' }, 'invalidName');
  check('name not a string', { type: 'hangarRename', shipId: id, name: 42 as unknown as string }, 'invalidName');
  check('name an object', { type: 'hangarRename', shipId: id, name: { length: 3 } as unknown as string }, 'invalidName');
  check('rename an unknown ship', { type: 'hangarRename', shipId: 999, name: 'Duch' }, 'unknownShip');
  check('rename id as a string', { type: 'hangarRename', shipId: String(id) as unknown as number, name: 'Duch' }, 'unknownShip');
  // a name with control and bidi characters is cleaned, never stored raw
  checks++;
  d.attempt({ type: 'hangarRename', shipId: id, name: ' Osa\u0000‮​  II\t' });
  const name = d.state.fleet.active.name;
  if (name !== 'Osa II') broken.push(`cleaned name ${JSON.stringify(name)}`);
  checks++;
  d.attempt({ type: 'hangarRename', shipId: id, name: 'Ž'.repeat(SHIP_NAME_MAX) });
  if (Array.from(d.state.fleet.active.name ?? '').length !== SHIP_NAME_MAX) broken.push('a name of the maximum length refused');
  check('cockpit key of an engine', { type: 'hangarNewShip', cockpit: 'engine:1', acquire: 'buy' }, 'invalidDesign');
  check('unknown cockpit key', { type: 'hangarNewShip', cockpit: 'cockpit:9' as PartKey, acquire: 'buy' }, 'unknownPart');
  check('cockpit from an empty storage', { type: 'hangarNewShip', cockpit: COCKPIT }, 'notEnoughParts');
  check('acquire mode "steal"', { type: 'hangarNewShip', cockpit: COCKPIT, acquire: 'steal' as 'buy' }, 'invalidDesign');
  check('locked T2 cockpit', { type: 'hangarNewShip', cockpit: 'cockpit:2', acquire: 'buy' });
  check('switch to the active ship', { type: 'hangarSwitch', shipId: id }, 'unknownShip');
  check('switch to an unknown ship', { type: 'hangarSwitch', shipId: -1 }, 'unknownShip');
  check('dismantle the active ship', { type: 'hangarDismantle', shipId: id }, 'unknownShip');
  // two ships into two slots, a third one has no slot
  const r1 = d.attempt({ type: 'hangarNewShip', cockpit: COCKPIT, acquire: 'buy' });
  const r2 = d.attempt({ type: 'hangarNewShip', cockpit: COCKPIT, acquire: 'buy' });
  if (!r1.ok || !r2.ok) broken.push(`two new ships into two slots refused (${r1.reason ?? ''} ${r2.reason ?? ''})`);
  check('new ship without a free slot', { type: 'hangarNewShip', cockpit: COCKPIT, acquire: 'buy' }, 'noSlot');
  // in flight nothing but a rename works
  const stored = d.state.fleet.stored[0]!.record.id;
  d.undock();
  d.idle(1);
  check('switch in flight', { type: 'hangarSwitch', shipId: stored }, 'notDocked');
  check('dismantle in flight', { type: 'hangarDismantle', shipId: stored }, 'notDocked');
  check('slot in flight', { type: 'hangarBuySlot' }, 'notDocked');
  const spent = c0 - d.state.credits;
  const cockpitPrice = partBuyPrice(COCKPIT, 1) ?? 0;
  if (spent < 20_000 + 2 * cockpitPrice) broken.push(`paid ${spent} kr for 2 slots + 2 cockpits`);
  return result(
    'fleetCrafted',
    seed,
    penalty,
    d,
    0,
    broken,
    `${checks} crafted actions (slot past the cap, 1000-char / control-char / non-string names, unknown ships, wrong cockpits, no slot, in flight) refused or cleaned; slots paid ${prices.join(' + ')} kr`,
    { checks, slot1: prices[0] ?? 0, slot2: prices[1] ?? 0 },
  );
}

// ------------------------------------------------------------------------------------------------
// F6 – templates: crafted template parts and names, tampered export codes (re-signed, locked parts,
// variants, unknown keys, loan flags), and applying a template – never for less than the shipyard
// charges, never healing a moved part

/** The codec's encoding of an arbitrary payload, correctly signed (what a tamperer would produce). */
function signedCode(payload: unknown): string {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${TEMPLATE_CODE_PREFIX}${body}.${templateChecksum(body)}`;
}

export function fleetTemplates(seed: number): LoopResult {
  const penalty: DeathPenalty = 'mild';
  const d = richGame(seed, penalty, 30_000);
  const broken: string[] = [];
  let checks = 0;
  // setup: the Data for the Archive node "Ship templates" (bought with the real action)
  d.state.discovery.dataFund += 100;
  d.state.discovery.dataTotal += 100;
  if (!d.attempt({ type: 'archiveBuy', node: 'templates' }).ok) broken.push('Archive node "templates" refused');
  const starter = normalizeParts(gridTemplateParts(d.state.player.grid))!;
  const bad: [string, unknown][] = [
    ['unknown key', [...starter, ['laser:9', 5, 5, 0]]],
    ['two cockpits', [...starter, ['cockpit:1', 3, 3, 0]]],
    ['overlap', [...starter, [starter[0]![0], starter[0]![1], starter[0]![2], 0]]],
    ['out of the hangar', [['cockpit:1', 0, 0, 0], ['armor:1', 40, 0, 0]]],
    ['disconnected', [['cockpit:1', 0, 0, 0], ['armor:1', 3, 3, 0]]],
    ['loan flag', [['cockpit:1', 0, 0, 0, true]]],
    ['fractional cell', [['cockpit:1', 0.5, 0, 0]]],
    ['rotation 7', [['cockpit:1', 0, 0, 7]]],
    ['empty', []],
    ['not an array', { 0: ['cockpit:1', 0, 0, 0] }],
    ['huge', Array.from({ length: 5000 }, (_, i) => ['armor:1', i, 0, 0])],
  ];
  for (const [label, parts] of bad) {
    checks++;
    const r = d.attempt({ type: 'templateSave', name: label, parts: parts as TemplatePart[] });
    if (r.ok || r.reason !== 'invalidTemplate') broken.push(`templateSave with ${label}: ${r.ok ? 'accepted' : r.reason}`);
  }
  for (const [label, name] of [['1000-char name', 'Y'.repeat(1000)], ['control name', '\u0000‮'], ['number name', 7]] as const) {
    checks++;
    const r = d.attempt({ type: 'templateSave', name: name as string, parts: starter });
    if (r.ok || r.reason !== 'invalidName') broken.push(`templateSave with a ${label}: ${r.ok ? 'accepted' : r.reason}`);
  }
  // the cap: 5 templates, the sixth refused
  for (let i = 0; i < 6; i++) d.attempt({ type: 'templateSave', name: `T${i}`, parts: starter });
  checks++;
  if (d.state.templates.length !== templateCap(d.state)) broken.push(`${d.state.templates.length} templates saved, cap ${templateCap(d.state)}`);

  // tampered codes: flipped character, re-signed payloads
  const code = encodeTemplate({ name: 'Baník', parts: starter });
  const flipped = code.slice(0, 8) + (code[8] === 'A' ? 'B' : 'A') + code.slice(9);
  const tampered: [string, string, boolean][] = [
    ['flipped character', flipped, false],
    ['re-signed unknown key', signedCode({ v: 1, n: 'X', p: [['cockpit:1', 0, 0, 0], ['laser:9', 1, 0, 0]] }), false],
    ['re-signed loan flag', signedCode({ v: 1, n: 'X', p: [['cockpit:1', 0, 0, 0, 1]] }), false],
    ['re-signed version 2', signedCode({ v: 2, n: 'X', p: starter }), false],
    ['re-signed control name', signedCode({ v: 1, n: '‮', p: starter }), false],
  ];
  for (const [label, c, shouldDecode] of tampered) {
    checks++;
    if (decodeTemplate(c).ok !== shouldDecode) broken.push(`code with ${label} decoded`);
  }
  // locked parts (Archive variants) decode – the shipyard shows the lock – but never commit; parts not
  // sold here (a T2 laser in ring 1) commit only when crafted and paid for (audited on a copy)
  const swap = (key: PartKey, match: (k: PartKey) => boolean): TemplatePart[] => starter.map((p): TemplatePart => (match(p[0]) ? [key, p[1], p[2], p[3]] : p));
  const lockedKeys = ALL_PART_KEYS.filter((k) => !partUnlocked(d.state, k) && (k.startsWith('engine:1:') || k.startsWith('miningLaser:1:')));
  let lockedCommits = 0;
  let lockedTried = 0;
  for (const key of lockedKeys) {
    checks++;
    const dec = decodeTemplate(signedCode({ v: 1, n: 'Lock', p: swap(key, (k) => k.split(':')[0] === key.split(':')[0]) }));
    if (!dec.ok) continue;
    lockedTried++;
    if (applyTemplate(new Driver(cloneSim(d.sim)), dec.template, false).committed) lockedCommits++;
  }
  if (lockedCommits) broken.push(`${lockedCommits} templates with locked parts applied`);
  const t2 = decodeTemplate(signedCode({ v: 1, n: 'T2', p: swap('miningLaser:2', isMiningKey) }));
  checks++;
  const t2Apply = t2.ok ? applyTemplate(new Driver(cloneSim(d.sim)), t2.template, true) : null;
  if (t2Apply) broken.push(...t2Apply.broken);

  // apply for less than cost: strip and sell everything, rebuild the starter from the template
  d.stripToMinimum();
  d.sellStorageParts();
  const rebuild = applyTemplate(d, { name: 'Štartér', parts: starter }, true);
  if (!rebuild.committed) broken.push('rebuilding the starter from its template refused');
  broken.push(...rebuild.broken);

  // moving a damaged part with a template keeps its damage (the radar turned by 90°)
  const radar = d.state.player.grid.parts.find((p) => p.partId === 'radar');
  let healed = 0;
  let radarMoved = false;
  if (radar) {
    d.act({ type: 'debugDamage', partId: radar.id, hp: Math.max(1, Math.round(maxHp(radar) * 0.25)) });
    const dmg0 = damage(d.state.player.grid.parts, d.state.player.hp);
    const turned = normalizeParts(gridTemplateParts(d.state.player.grid).map((p): TemplatePart => (p[0].startsWith('radar') ? [p[0], p[1], p[2], ((p[3] + 1) % 4) as Rotation] : p)))!;
    const moved = applyTemplate(d, { name: 'Radar', parts: turned }, true);
    broken.push(...moved.broken);
    radarMoved = moved.committed;
    if (!moved.committed) broken.push('turning the radar with a template refused');
    healed = dmg0 - damage(d.state.player.grid.parts, d.state.player.hp);
    if (moved.committed && healed > 1e-6) broken.push(`a template move healed ${healed} HP`);
  }
  return result(
    'fleetTemplates',
    seed,
    penalty,
    d,
    rebuild.gain,
    broken,
    `${checks} crafted saves / codes refused (or decoded with the lock shown); ${lockedTried} templates with locked variants decoded, ${lockedCommits} applied; a T2-laser template ${t2Apply?.committed ? `crafted for ${t2Apply.paid} kr = the quote` : 'not applicable here'}; starter rebuilt from its template for ${rebuild.paid} kr = the quote (parts +${rebuild.partsAdded}, all paid); a damaged radar turned by a template ${radarMoved ? 'kept its damage' : 'was not moved'}`,
    { checks, lockedTried, lockedCommits, t2Paid: t2Apply?.paid ?? 0, rebuildPaid: rebuild.paid, rebuildGain: Math.round(rebuild.gain), healed },
  );
}

/**
 * Applies a template like the shipyard ("Build from template" → commit): ops from `templateOps`, the
 * usual draft evaluation, the commit. With `audit`, checks that the credits paid are the quote and
 * that every new part was bought, crafted or taken from storage.
 */
export function applyTemplate(d: Driver, template: ShipTemplate, audit: boolean): { committed: boolean; paid: number; gain: number; partsAdded: number; broken: string[] } {
  const broken: string[] = [];
  const st = d.docked();
  if (!st) return { committed: false, paid: 0, gain: 0, partsAdded: 0, broken: ['not docked'] };
  const plan = templateOps(d.state.player.grid, d.state.player.hp, template);
  const draft = planFromOps(d.state, st, plan.ops);
  if (!draft.report.canCommit) return { committed: false, paid: 0, gain: 0, partsAdded: 0, broken };
  const parts0 = ownedParts(d.state);
  const w0 = netWorth(d.state).total;
  const c0 = d.state.credits;
  const ok = d.act({ type: 'shipyardCommit', baseHash: draft.baseHash, ops: draft.ops, acquire: {} });
  const paid = c0 - d.state.credits;
  const gain = netWorth(d.state).total - w0;
  const diff = partsDiff(parts0, ownedParts(d.state));
  const { cost } = draft.report;
  let partsAdded = 0;
  if (ok && audit) {
    if (paid !== cost.credits) broken.push(`paid ${paid} kr, quoted ${cost.credits} kr`);
    for (const [k, n] of Object.entries(diff) as [PartKey, number][]) {
      const expected = (cost.buy[k] ?? 0) + (cost.craft[k] ?? 0) - (cost.scrapped[k] ?? 0);
      if (n !== expected) broken.push(`part ${k}: ${n > 0 ? '+' : ''}${n}, paid for ${expected}`);
      if (n > 0) partsAdded += n;
    }
    if (gain > EPS) broken.push(`net worth +${Math.round(gain)} kr from a template`);
    // every new mounted part beyond the storage stock was paid for: the install fees at least
    if (cost.installCount > 0 && paid < cost.installCount * INSTALL_FEE) broken.push('install fees skipped');
  }
  return { committed: ok, paid, gain, partsAdded, broken };
}

// ------------------------------------------------------------------------------------------------
// F7 – save copies: save → switch → load and switch → save → load give back the same fleet (stored
// HP, fuel, cargo, slots, ids); a copy and the original evolve independently (no shared objects)

export function fleetSaveCopy(seed: number): LoopResult {
  const penalty: DeathPenalty = 'mild';
  const d = richGame(seed, penalty, 20_000);
  const broken: string[] = [];
  d.state.player.cargo.iron += 9; // setup: ore aboard (as if mined)
  const laser = d.state.player.grid.parts.find((p) => isMiningKey(keyOf(p)))!;
  d.act({ type: 'debugDamage', partId: laser.id, hp: Math.max(1, Math.round(maxHp(laser) * 0.5)) });
  d.attempt({ type: 'hangarBuySlot' });
  const a = parkActive(d)!;
  // save → load → the fleet is the same
  const copy1 = new Driver(cloneSim(d.sim));
  if (fleetSave(copy1) !== fleetSave(d)) broken.push('save → load changed the fleet');
  // both switch: same result (direction 1: save, then switch in each)
  d.attempt({ type: 'hangarSwitch', shipId: a });
  copy1.attempt({ type: 'hangarSwitch', shipId: a });
  if (fleetSave(copy1) !== fleetSave(d)) broken.push('switch after load differs');
  // direction 2: switch, save, load, switch back
  const copy2 = new Driver(cloneSim(d.sim));
  const b = d.state.fleet.stored[0]!.record.id;
  d.attempt({ type: 'hangarSwitch', shipId: b });
  copy2.attempt({ type: 'hangarSwitch', shipId: b });
  if (fleetSave(copy2) !== fleetSave(d)) broken.push('switch back after load differs');
  // the copy dismantles A and sells it all; the original still has A exactly as before (no shared state)
  const before = fleetSave(d);
  copy2.attempt({ type: 'hangarDismantle', shipId: a });
  copy2.sellStorageParts();
  copy2.sellCargo();
  if (fleetSave(d) !== before) broken.push('the copy changed the original');
  // a save of a stored ship with a loan part would be refused – the hangar never holds one
  if (strayLoans(d.state)) broken.push('a loan part stored');
  return result(
    'fleetSaveCopy',
    seed,
    penalty,
    d,
    0,
    broken,
    'save → load, then switch (and switch, save → load, switch back) give byte-identical fleets; a copy that dismantles and sells a ship leaves the original untouched',
    {},
  );
}

/** Every fleet probe for one seed (the saboteur suite and the quick test). */
export function fleetProbes(seed: number): LoopResult[] {
  return [fleetSwitch(seed), fleetLaunder(seed), fleetLoan(seed), fleetHardHull(seed), fleetCrafted(seed), fleetTemplates(seed), fleetSaveCopy(seed)];
}
