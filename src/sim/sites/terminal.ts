// The derelict terminal (M4b plan §2.4, open question 2) – OWNED BY T4.
//
// Rules:
// - First berth at a derelict (`visitDerelict`, called by the berth): `DERELICT.data` Data (source
//   'derelict') + the journal log of its model (`derelictLog_<model>`, unlocked once per model – a second
//   derelict of the same model gives the Data but no new entry); `visited` stops both for good.
// - Plus ONE one-time service rolled per derelict (`DerelictSite.service`, placement.ts), offered as items:
//   - stash: 2–3 distinct parts (`DERELICT.stashParts`) of the stash pool, T1 at depth 2 / T2 from
//     `DERELICT.stashT2FromDepth`; with `DERELICT.stashVariantChance` the last one is a part variant the
//     player may not have unlocked (a real part). One item per part.
//   - plan: one item = `DERELICT.planFragments` fragments of one plan through `awardFragment` (a
//     completed plan → duplicate → Data, as usual). The plan is weighted by `PLAN_WEIGHTS.derelict`
//     and picked among the plans not completed yet (all completed → any): a guaranteed source, so the
//     pity counters never move.
//   - fabricator: one item = one free craft of any part ≤ `DERELICT.fabricatorMaxTier` the player can
//     craft at a station (`partUnlocked` + a recipe), materials from the SHIP's cargo, no credit fee.
// - Every taken part (stash or crafted) goes to the ship's part hold (`player.salvage`, like salvaged
//   parts); the hold counts `DERELICT.itemCargo` cargo per part on board (`partHoldFree`) and an item
//   that does not fit is refused (`holdFull`).
// - The offer is a pure function of the seed and the site id (the plan also of the completed plans);
//   `DerelictState.taken` (bitmask by item index) makes every item one-time, also across save / load.
import { RECIPES } from '../../data/economy';
import type { JournalId } from '../../data/journal';
import { ALL_PART_KEYS, isPartKey, parsePartKey, partKey, type PartId, type PartKey, type Tier } from '../../data/parts';
import { PLAN_IDS, PLAN_WEIGHTS, type PlanId } from '../../data/plans';
import { cargoUsed, RESOURCE_IDS } from '../../data/resources';
import { DERELICT, type DerelictModel } from '../../data/sites';
import { VARIANT_IDS, VARIANTS } from '../../data/variants';
import { partUnlocked } from '../discovery/archive';
import { gainData, hasJournal, unlockJournal } from '../discovery/state';
import { fnv1a32 } from '../math/fnv1a';
import type { SimEvent, SimState } from '../Simulation';
import type { ActionError } from '../station/actions';
import { hash3 } from '../world/hash';
import { derelictById, derelictState, setDerelictState } from './derelict';
import type { DerelictSite, TerminalItemWhat, TerminalOffer } from './types';

/** Salt of the terminal rolls: fnv1a32("m4terminal"). */
const TERMINAL_SALT = fnv1a32('m4terminal');

/** Parts a stash can hold (no cockpit – a stash is spares, not a ship). */
export const STASH_POOL: readonly PartId[] = ['engine', 'armor', 'gyro', 'miningLaser', 'cargo', 'fuelTank', 'reactor', 'radar', 'cannon', 'shield', 'battery'];

/** Roll k of a derelict's terminal, in [0, 1). */
const roll = (seed: number, id: string, k: number): number => hash3(seed ^ TERMINAL_SALT, fnv1a32(id), k) / 4294967296;

/** Fixed roll indices (every roll has its own index – a retune never shifts another). */
const R_COUNT = 0;
const R_VARIANT = 1;
const R_VARIANT_PICK = 2;
const R_PLAN = 3;
const R_PART = 10;

const LOG_IDS: Record<DerelictModel, JournalId> = { a: 'derelictLog_a', b: 'derelictLog_b', c: 'derelictLog_c', d: 'derelictLog_d' };

/** The journal entry of a derelict model's log (its text: `tx().journal[id]`). */
export const derelictLogId = (model: DerelictModel): JournalId => LOG_IDS[model];

/** The parts of a derelict's stash (only meaningful for the 'stash' service). Pure. */
export function stashParts(seed: number, site: DerelictSite): PartKey[] {
  const [lo, hi] = DERELICT.stashParts;
  const n = lo + Math.min(hi - lo, Math.floor(roll(seed, site.id, R_COUNT) * (hi - lo + 1)));
  const tier: Tier = site.depth >= DERELICT.stashT2FromDepth ? 2 : 1;
  const pool = [...STASH_POOL];
  const keys: PartKey[] = [];
  for (let i = 0; i < n; i++) {
    const j = Math.min(pool.length - 1, Math.floor(roll(seed, site.id, R_PART + i) * pool.length));
    keys.push(partKey(pool[j]!, tier));
    pool.splice(j, 1);
  }
  if (roll(seed, site.id, R_VARIANT) < DERELICT.stashVariantChance) {
    // a variant of a part type the other items do not have
    const others = new Set(keys.slice(0, n - 1).map((k) => parsePartKey(k).partId));
    const variants = VARIANT_IDS.filter((v) => !others.has(VARIANTS[v].base));
    const v = variants[Math.min(variants.length - 1, Math.floor(roll(seed, site.id, R_VARIANT_PICK) * variants.length))]!;
    keys[n - 1] = partKey(VARIANTS[v].base, tier, v);
  }
  return keys;
}

/** The plan of a derelict's plan service: weighted by `PLAN_WEIGHTS.derelict`, plans not completed first. */
export function terminalPlan(state: SimState, site: DerelictSite): PlanId {
  const weights = PLAN_WEIGHTS.derelict;
  const all = PLAN_IDS.filter((p) => (weights[p] ?? 0) > 0);
  const open = all.filter((p) => !state.discovery.plans.has(p));
  const pool = open.length > 0 ? open : all;
  const total = pool.reduce((sum, p) => sum + weights[p]!, 0);
  let r = roll(state.seed, site.id, R_PLAN) * total;
  for (const p of pool) {
    r -= weights[p]!;
    if (r < 0) return p;
  }
  return pool.at(-1)!;
}

/** What the terminal's items are (by index). */
function serviceItems(state: SimState, site: DerelictSite): TerminalItemWhat[] {
  switch (site.service) {
    case 'stash':
      return stashParts(state.seed, site).map((key) => ({ kind: 'part', key }));
    case 'plan':
      return [{ kind: 'fragments', plan: terminalPlan(state, site), count: DERELICT.planFragments }];
    case 'fabricator':
      return [{ kind: 'fabricate' }];
  }
}

/** What the terminal of derelict `id` offers now (null when the id is not a derelict of this seed). */
export function terminalOffer(state: SimState, id: string): TerminalOffer | null {
  const site = derelictById(state, id);
  if (!site) return null;
  const ds = derelictState(state, id);
  const log = derelictLogId(site.model);
  return {
    site: id,
    model: site.model,
    data: ds.visited ? null : DERELICT.data,
    log: hasJournal(state, log) ? null : log,
    service: site.service,
    items: serviceItems(state, site).map((what, index) => ({ index, what, taken: (ds.taken & (1 << index)) !== 0 })),
  };
}

/** First berth at a derelict: the Data and the model's log, once (`visited`). */
export function visitDerelict(state: SimState, site: DerelictSite, events: SimEvent[]): void {
  if (derelictState(state, site.id).visited) return;
  setDerelictState(state, site.id, { visited: true });
  gainData(state, DERELICT.data, 'derelict', events);
  const log = derelictLogId(site.model);
  const fresh = !hasJournal(state, log);
  unlockJournal(state, log, events);
  events.push({ type: 'derelictVisited', id: site.id, data: DERELICT.data, journal: fresh ? log : null });
}

// ---------------------------------------------------------------------------
// the part hold and the fabricator (also for the game layer's terminal view, T7)

/** Parts on board (`player.salvage`). */
export function partsOnBoard(state: SimState): number {
  let n = 0;
  for (const c of Object.values(state.player.salvage)) n += c ?? 0;
  return n;
}

/** Free room of the ship's part hold in cargo units: capacity − cargo − `DERELICT.itemCargo` per part on board. */
export const partHoldFree = (state: SimState): number =>
  state.player.props.cargoCapacity - cargoUsed(state.player.cargo) - DERELICT.itemCargo * partsOnBoard(state);

/** Parts the fabricator can make: ≤ `DERELICT.fabricatorMaxTier`, unlocked for crafting, with a recipe. */
export function fabricatorKeys(state: SimState): PartKey[] {
  return ALL_PART_KEYS.filter((key) => parsePartKey(key).tier <= DERELICT.fabricatorMaxTier && RECIPES[key] !== undefined && partUnlocked(state, key));
}

/** Why the fabricator cannot make `key` now (null = it can): unknownPart, partLocked, noMaterials, holdFull. */
export function fabricateBlocker(state: SimState, key: unknown): ActionError | null {
  if (!isPartKey(key) || parsePartKey(key).tier > DERELICT.fabricatorMaxTier || !RECIPES[key]) return 'unknownPart';
  if (!partUnlocked(state, key)) return 'partLocked';
  const need = RECIPES[key].resources;
  let used = 0;
  for (const r of RESOURCE_IDS) {
    const n = need[r] ?? 0;
    if (state.player.cargo[r] + 1e-9 < n) return 'noMaterials';
    used += n;
  }
  // the materials leave the cargo before the part goes in
  if (partHoldFree(state) + used + 1e-9 < DERELICT.itemCargo) return 'holdFull';
  return null;
}
