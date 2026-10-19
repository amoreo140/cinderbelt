// Net worth of a game state at liquidation value: credits + everything the player owns valued at what
// the stations pay for it (parts at the 40 % buy-back, damaged parts pro rata, resources at the home
// sell price; Guild loan parts count 0; ships stored in hangar slots like the active ship). A free-help
// loop is an exploit when it raises this number without mining. A damaged shaped plate counts by its
// full-equivalent HP (SL2 E2 §2.3: damage is the HP missing, in full-plate HP – what repair and scrap use).
import { partSellPrice } from '../../../src/data/economy';
import type { PartInventory, PartKey } from '../../../src/data/parts';
import { RESOURCE_IDS, type Cargo } from '../../../src/data/resources';
import { currentHp, fullEquivalentHp, fullMaxHp, maxHp } from '../../../src/sim/ship/hp';
import type { HpMap, PlacedPart } from '../../../src/sim/ship/types';
import type { SimState } from '../../../src/sim/Simulation';
import { homeSellPrice } from '../pilot';
import { keyOf } from './harness';

export interface NetWorth {
  credits: number;
  /** Mounted parts (cockpit included). */
  ship: number;
  /** Parts in station storages, on board (salvage) and in courier shipments. */
  spareParts: number;
  /** Cargo, storage resources and shipped resources. */
  resources: number;
  /** Ships stored in hangar slots (M4a): their parts (damaged pro rata) and their cargo. */
  hangar: number;
  total: number;
  /**
   * Guild loan parts on the hull at the buy-back price: worth nothing when liquidated, but a working
   * hull the player did not pay for (second code review I5 – a loop that turns owned parts into credits
   * and gets a loan hull back is an exploit even though `total` does not grow).
   */
  loanHull: number;
  /** total + loanHull – the usable-ship value of the game. */
  usable: number;
}

/** Share of a mounted part's value its HP leaves (a shaped plate: full-equivalent HP of the full plate's). */
function hpShare(part: PlacedPart, hp: HpMap): number {
  const now = currentHp(hp, part);
  const share = part.shape === undefined ? now / maxHp(part) : fullEquivalentHp(part, now) / fullMaxHp(part);
  return Math.max(0, Math.min(1, share));
}

const partsValue = (inv: PartInventory): number =>
  (Object.entries(inv) as [PartKey, number][]).reduce((s, [k, n]) => s + partSellPrice(k) * (n ?? 0), 0);

const resourcesValue = (c: Partial<Cargo>): number => RESOURCE_IDS.reduce((s, r) => s + (c[r] ?? 0) * homeSellPrice(r), 0);

export function netWorth(state: SimState): NetWorth {
  const p = state.player;
  let ship = 0;
  let loanHull = 0;
  // Guild loan parts are worth nothing to the player – they cannot be sold, stored or scrapped – but
  // they are a usable hull (loanHull)
  if (!p.destroyed) {
    for (const part of p.grid.parts) {
      const value = partSellPrice(keyOf(part)) * hpShare(part, p.hp);
      if (part.loan) loanHull += value;
      else ship += value;
    }
  }
  let spareParts = partsValue(p.salvage);
  let resources = resourcesValue(p.cargo);
  for (const s of state.stations.values()) {
    spareParts += partsValue(s.parts);
    resources += resourcesValue(s.resources);
  }
  for (const sh of state.career.shipments) {
    spareParts += partsValue(sh.parts);
    resources += resourcesValue(sh.resources);
  }
  let hangar = 0;
  for (const s of state.fleet.stored) {
    // a stored ship never holds a loan part (swap.ts); if one slipped in it would count 0 here and the
    // fleet probes report it separately
    for (const part of s.grid.parts) if (!part.loan) hangar += partSellPrice(keyOf(part)) * hpShare(part, s.hp);
    hangar += resourcesValue(s.cargo);
  }
  const total = state.credits + ship + spareParts + resources + hangar;
  return { credits: state.credits, ship, spareParts, resources, hangar, total, loanHull, usable: total + loanHull };
}

/** Sell value of a whole grid (what stripping it down and selling would yield, cockpit included; loans are worth 0). */
export const gridValue = (parts: readonly (Parameters<typeof keyOf>[0] & { loan?: true })[]): number =>
  parts.reduce((s, part) => s + (part.loan ? 0 : partSellPrice(keyOf(part))), 0);
