// Death and respawn (spec M2, 9.5; decisions 15.2 and 15.7). The trigger lives in combat (M3a): losing
// the cockpit sets player.destroyed and emits playerDestroyed; after the explosion sequence the game
// layer calls applyDeath. This module holds only data and pure state transformations. A death never
// loads a save: the current state is changed by the difficulty's rule and saved right away (reason
// `death`), so the penalty cannot be dodged by loading.
//
// Saboteur report fixes: the Hard respawn hull is a Guild loan (X1) – means-tested: the Guild lends only
// the starter parts the player cannot buy with what they still have (second code review I5); salvage on
// board is lost on every death (X3); a world death on None / Mild brings the ship back as it was right
// before the fatal event – parts lost earlier stay lost, they are the blueprint's gaps (I6) – and takes
// every copy of the restored parts out of the player's own wrecks; and a VOLUNTARY scuttle is a separate player action that is
// never cheaper than a tow (X4): the cargo stays in the abandoned wreck (combat.ts scuttlePlayer – no
// free ride home with a full hold), the Guild's tow fee is charged (free when broke), the ship arrives
// as it was (no repair, no refuel, no lost part back), and the difficulty's penalty applies on top. Deaths caused by the world keep the binding rules of
// spec 15.2 (DEATH_RULES).
import { partSellPrice, scrapResources, towCost } from '../../data/economy';
import { partKey } from '../../data/parts';
import { emptyCargo, RESOURCE_IDS } from '../../data/resources';
import { components } from '../combat/damage';
import type { DeathPenalty } from '../settings';
import type { SimEvent, Simulation } from '../Simulation';
import { currentHp, maxHp } from '../ship/hp';
import { asLoan } from '../ship/loan';
import { createStarterShip } from '../ship/presets';
import { computeProperties } from '../ship/properties';
import type { HpMap, ShipGrid } from '../ship/types';
import { dockPose } from '../station/dock';
import { priceHere, storedWorth } from '../station/guildLoan';
import { homeStation, type StationDef, type StationId } from '../world/stations';

export interface DeathRule {
  /**
   * respawnSnapshot = the ship as it was right before the fatal event (I6; parts lost earlier stay
   * lost); starter = the starter ship as a Guild loan (saboteur report X1 – a new hull is never value the
   * player could sell), means-tested (I5).
   */
  ship: 'respawnSnapshot' | 'starter';
  /** HP of every part after the respawn as a share of the maximum. */
  partHpFraction: number;
  keepCargo: boolean;
  fuelFraction: number;
  /** Hardcore: the game moves to this difficulty (the save is not deleted, spec 15.7). */
  fallTo: DeathPenalty | null;
}

/**
 * None – nothing is lost; Mild – cargo + ship damage; Hard – installed parts and cargo (credits and
 * station storages stay); Hardcore – the Hard penalty and the game falls to Hard.
 */
export const DEATH_RULES: Record<DeathPenalty, DeathRule> = {
  none: { ship: 'respawnSnapshot', partHpFraction: 1, keepCargo: true, fuelFraction: 1, fallTo: null },
  mild: { ship: 'respawnSnapshot', partHpFraction: 0.4, keepCargo: false, fuelFraction: 0.25, fallTo: null },
  hard: { ship: 'starter', partHpFraction: 1, keepCargo: false, fuelFraction: 1, fallTo: null },
  hardcore: { ship: 'starter', partHpFraction: 1, keepCargo: false, fuelFraction: 1, fallTo: 'hard' },
};

export interface ScuttleTerms {
  /** Tow fee from the wreck to the station the ship is brought to. */
  fee: number;
  /** The player cannot pay it: no fee (the cargo is in the wreck anyway; anything left on board is lost). */
  free: boolean;
}

export interface DeathPlan {
  penalty: DeathPenalty;
  rule: DeathRule;
  /** The last visited station (respawn point); unknown → home. */
  respawnStation: StationDef;
  /**
   * Free evacuation: the player lost the installed parts and the respawn point has no shipyard
   * (outpost) – the nearest discovered station with a shipyard (to the respawn point). Else null.
   * Also when the restored layout has no forward thrust (mild / none penalty, bot report F1).
   */
  evacuation: StationDef | null;
  /** The player abandoned the ship (voluntary scuttle): the tow fee to the default destination. */
  scuttle: ScuttleTerms | null;
}

export interface DeathOutcome {
  penalty: DeathPenalty;
  stationId: StationId;
  evacuated: boolean;
  /** The game just fell from hardcore to Hard → the game layer moves the save (SaveService.fallFromHardcore). */
  fellFromHardcore: boolean;
  /** stationDiscovered…, creditsChanged (scuttle fee) and docked – handle like step events (opens the hub). */
  events: SimEvent[];
}

/** The tow fee of a voluntary scuttle to `station` (free when the player cannot pay). */
export function scuttleTerms(sim: Simulation, station: StationDef): ScuttleTerms {
  const { pos } = sim.state.player.body;
  const fee = towCost(Math.hypot(station.pos.x - pos.x, station.pos.y - pos.y));
  return { fee, free: sim.state.credits < fee };
}

/** What a death would do – pure, no state change (also for the UI with the evacuation choice). */
export function planDeath(sim: Simulation): DeathPlan {
  const { state } = sim;
  const penalty = state.settings.deathPenalty;
  const rule = DEATH_RULES[penalty];
  const respawnStation = sim.station(state.respawn.stationId) ?? homeStation();
  const voluntary = state.player.scuttled === true;
  // The restored layout could not fly either (no forward thrust, e.g. engines shot off before the
  // fatal hit): respawning at a station without a shipyard would be a soft-lock (bot report F1). The
  // ship comes back as it was before the fatal event (I6) - a scuttled one as it was - so its layout decides.
  const layout = state.player.grid;
  const strandedLayout = rule.ship === 'respawnSnapshot' && computeProperties(layout).thrust.forward <= 0;
  let evacuation: StationDef | null = null;
  if ((rule.ship === 'starter' || strandedLayout) && !respawnStation.services.shipyard) {
    let bestDist = Infinity;
    for (const id of state.world.discovered) {
      const s = sim.station(id);
      if (!s || !s.services.shipyard) continue;
      const d = Math.hypot(s.pos.x - respawnStation.pos.x, s.pos.y - respawnStation.pos.y);
      if (d < bestDist) {
        bestDist = d;
        evacuation = s;
      }
    }
    evacuation ??= homeStation();
  }
  const scuttle = voluntary ? scuttleTerms(sim, evacuation ?? respawnStation) : null;
  return { penalty, rule, respawnStation, evacuation, scuttle };
}

/**
 * The ship keeps its damage - a scuttled one and, since I6, one destroyed by the world: the HP it had
 * before the fatal event (parts destroyed by it come back whole), at most the penalty's share. A death
 * repairs nothing.
 */
function keptHp(grid: ShipGrid, before: HpMap, fraction: number): HpMap {
  const hp: HpMap = new Map();
  for (const p of grid.parts) {
    const max = maxHp(p);
    const now = Math.min(currentHp(before, p), fraction >= 1 ? max : Math.max(1, Math.round(max * fraction)));
    if (now < max) hp.set(p.id, now);
  }
  return hp;
}

/**
 * The restored ship brings back the parts the fatal event knocked off; every copy of them in the
 * player's own wrecks - the intact part or its scrap - would be a duplicate to load later (saboteur
 * report X3, second review I6), so it goes back with the ship. Matched by part id, which is stable on a
 * hull but repeats across the ships of a fleet (M4a): only the wrecks of the ship that died count – a
 * wreck of another (stored) ship keeps its parts. An untagged wreck (made outside combat) counts.
 */
function reclaimRestoredFromWrecks(sim: Simulation, restored: ShipGrid): void {
  const ids = new Set(restored.parts.map((p) => p.id));
  const ship = sim.state.fleet.active.id;
  for (const w of sim.state.combat.wrecks) {
    if (w.livery !== 'default' || w.poi || w.from) continue;
    if (w.ship !== undefined && w.ship !== ship) continue;
    for (const p of w.grid.parts) {
      if (!ids.has(p.id)) continue;
      const key = partKey(p.partId, p.tier, p.variant);
      const n = w.loot.parts[key] ?? 0;
      if (n > 0) {
        if (n <= 1) delete w.loot.parts[key];
        else w.loot.parts[key] = n - 1;
        continue;
      }
      // a damaged part became scrap: take back at most what a whole one scraps into
      const scrap = scrapResources(key, maxHp(p), maxHp(p));
      for (const r of RESOURCE_IDS) w.loot.cargo[r] = Math.max(0, w.loot.cargo[r] - (scrap[r] ?? 0));
    }
  }
}

/**
 * The Hard respawn hull (I5): the starter layout lent by the Guild, but only the parts the player cannot
 * buy at `station` with what they still have (credits and this station's storage) - the Guild never
 * lends what the player could pay for, like the station loan - and never more hull than the death took:
 * the lent parts are worth (buy-back price) at most what the lost hull was worth (`lost`), so stripping
 * and selling a ship before a scuttle cannot be topped up by the Guild. A part is left out only while
 * the rest stays one piece with the cockpit (always lent); the most expensive parts go first. The
 * blueprint is the full starter layout, so the hub offers "Restore to design" for what is missing; a
 * missing laser or forward engine the player cannot buy is lent at the shipyard (guildLoan).
 */
export function meansTestedStarter(sim: Simulation, station: StationDef, lost: number): ShipGrid {
  const starter = createStarterShip();
  let worth = storedWorth(sim.state, station);
  let parts = starter.parts;
  const keyOf = (p: (typeof parts)[number]) => partKey(p.partId, p.tier, p.variant);
  const priced = parts
    .filter((p) => p.partId !== 'cockpit')
    .map((p) => ({ p, price: priceHere(keyOf(p), station) }))
    .sort((a, b) => b.price - a.price || a.p.id - b.p.id);
  const drop = (p: (typeof parts)[number]): boolean => {
    const rest = parts.filter((q) => q !== p);
    if (components(rest).length !== 1) return false;
    parts = rest;
    return true;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const { p, price } of priced) {
      if (!parts.includes(p) || price > worth || !drop(p)) continue;
      worth -= price;
      changed = true;
    }
  }
  const lentValue = () => parts.reduce((s, p) => s + partSellPrice(keyOf(p)), 0);
  for (let changed = true; changed && lentValue() > lost; ) {
    changed = false;
    for (const { p } of priced) {
      if (lentValue() <= lost) break;
      if (parts.includes(p) && drop(p)) changed = true;
    }
  }
  return asLoan({ nextId: starter.nextId, parts });
}

/**
 * Applies the death penalty to the current state and docks the ship at the respawn station. Call it
 * between simulation steps; then save with reason `death` (with `fellFromHardcore` through
 * SaveService.fallFromHardcore). `evacuate: false` = the player declined the evacuation.
 */
export function applyDeath(sim: Simulation, options: { evacuate?: boolean } = {}): DeathOutcome {
  const plan = planDeath(sim);
  const { rule } = plan;
  const { state } = sim;
  const player = state.player;
  const evacuated = (options.evacuate ?? true) && plan.evacuation !== null;
  const station = evacuated ? plan.evacuation! : plan.respawnStation;
  const voluntary = plan.scuttle !== null;
  // a scuttle pays the Guild's tow fee to where the ship is brought; a broke player pays with the cargo
  const terms = voluntary ? scuttleTerms(sim, station) : null;
  const paid = terms && !terms.free ? terms.fee : 0;
  const keepCargo = rule.keepCargo && !terms?.free;

  // Hard: the old hull (and any Guild loan on it) is gone, the new hull is a means-tested loan (I5). On
  // none / mild the ship comes back as it was right before the fatal event - a scuttled one as it is;
  // parts lost earlier stay lost (I6, the blueprint's gaps)
  if (!keepCargo) player.cargo = emptyCargo();
  // own parts loaded from wrecks never survive a death (X3: on "none" they were a duplicate)
  player.salvage = {};
  state.credits -= paid;
  const source = player.grid;
  const lost = source.parts.reduce((s, p) => s + partSellPrice(partKey(p.partId, p.tier, p.variant)), 0);
  const grid: ShipGrid = rule.ship === 'starter' ? meansTestedStarter(sim, station, lost) : { nextId: source.nextId, parts: source.parts.map((p) => ({ ...p })) };
  const props = computeProperties(grid);
  const hpBefore = player.hp;
  const fuelBefore = player.fuel;
  player.grid = grid;
  player.gridVersion++;
  // a fresh starter ship is a new design (the full starter layout - what the Guild did not lend is its
  // gap); the restored ship keeps the old blueprint (M3.8)
  if (rule.ship === 'starter') player.blueprint = createStarterShip();
  player.props = props;
  player.hp = rule.ship === 'starter' ? new Map() : keptHp(grid, hpBefore, rule.partHpFraction);
  if (!voluntary && rule.ship === 'respawnSnapshot') reclaimRestoredFromWrecks(sim, grid);
  player.destroyed = false;
  player.scuttled = false;
  // a scuttle never refuels: the tank as it was, at most the penalty's share
  const fuelCap = props.fuelCapacity * rule.fuelFraction;
  player.fuel = voluntary ? Math.min(fuelBefore, rule.ship === 'starter' ? props.fuelCapacity : fuelCap) : fuelCap;
  player.dampers = true;

  const pose = dockPose(station, props.boundingRadius);
  const events: SimEvent[] = state.world.update(pose.pos).map((stationId) => ({ type: 'stationDiscovered', stationId }));
  if (paid > 0) events.push({ type: 'creditsChanged', delta: -paid, reason: 'tow' });
  const stored = sim.enterDocked(station.id, pose);
  events.push({ type: 'docked', stationId: station.id }, ...stored);
  state.respawn = { stationId: station.id, grid };
  state.stats.deaths++;
  // the active ship keeps its identity through death and respawn; stored ships are never touched (M4a)
  state.fleet.active.log.deaths++;

  const fellFromHardcore = rule.fallTo !== null;
  if (rule.fallTo) {
    state.settings = { ...state.settings, deathPenalty: rule.fallTo, fallenFromHardcore: true };
  }
  return { penalty: plan.penalty, stationId: station.id, evacuated, fellFromHardcore, events };
}
