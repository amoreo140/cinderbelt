// The derelict terminal view model (M4b T7, drawn by src/ui/sites/DerelictTerminal.tsx): the sim's
// `terminalOffer` turned into texts – item rows with their reasons (hold full, taken), the fabricator's
// choices with the materials from the ship's cargo and what is missing, the free part hold. The Data and
// the log are handed out at the berth itself (`terminalOffer` then says null for both), so the caller
// passes them from that berth's `derelictVisited` event (`TerminalVisit`).
import { RECIPES } from '../../data/economy';
import type { JournalId } from '../../data/journal';
import { partKey, type PartKey } from '../../data/parts';
import { RESOURCE_IDS } from '../../data/resources';
import { DERELICT } from '../../data/sites';
import { VARIANTS } from '../../data/variants';
import { tx } from '../../i18n';
import { sectorInfoAt } from '../../sim/regions/sectors';
import { siteById, terminalOffer } from '../../sim/sites';
import { fabricateBlocker, fabricatorKeys, partHoldFree } from '../../sim/sites/terminal';
import type { TerminalOfferItem } from '../../sim/sites/types';
import type { SimState } from '../../sim/Simulation';
import { sectorName } from '../../ui/sectors/sectorText';
import { partBaseName } from '../discovery/names';
import { partName } from '../shipyardView';
import type { DerelictTerminalData, FabOption, TerminalItem } from './types';

/** What the first berth at a derelict handed out (`derelictVisited { id, data, journal }`). */
export interface TerminalVisit {
  id: string;
  data: number;
  /** The journal entry unlocked with it (null = this model's log was read at another station). */
  journal: string | null;
}

/** "Derelict station Rusty Sill": the derelict's kind and the name of its sector. */
export function derelictName(state: SimState, pos: { x: number; y: number }): string {
  return `${tx().world.derelict.name} ${sectorName(sectorInfoAt(state.seed, pos.x, pos.y).name)}`;
}

/** "Missing 8 titanium, 6 copper" – what the cargo lacks for the recipe of `key` (null = nothing). */
export function missingMaterials(state: SimState, key: PartKey): string | null {
  const need = RECIPES[key].resources;
  const list: string[] = [];
  for (const r of RESOURCE_IDS) {
    const short = (need[r] ?? 0) - state.player.cargo[r];
    if (short > 1e-9) list.push(`${Math.ceil(short - 1e-9)} ${tx().resources[r]}`);
  }
  return list.length > 0 ? tx().crafting.missing(list.join(', ')) : null;
}

/** Why the fabricator cannot make `key` now, as a text (undefined = it can). */
function fabReason(state: SimState, key: PartKey): string | undefined {
  const blocker = fabricateBlocker(state, key);
  if (blocker === null) return undefined;
  if (blocker === 'noMaterials') return missingMaterials(state, key) ?? tx().actionErrors.noMaterials;
  return tx().actionErrors[blocker];
}

/** The fabricator's choices: the ones it can make first, each group in the part order. */
export function fabOptions(state: SimState): FabOption[] {
  const options = fabricatorKeys(state).map<FabOption>((key) => {
    const reason = fabReason(state, key);
    return { key, label: partName(key), materials: { ...RECIPES[key].resources }, ...(reason !== undefined ? { reason } : {}) };
  });
  return [...options.filter((o) => o.reason === undefined), ...options.filter((o) => o.reason !== undefined)];
}

function itemRow(state: SimState, item: TerminalOfferItem, holdFree: number): TerminalItem {
  const t = tx().world.derelict.terminal;
  const { what } = item;
  switch (what.kind) {
    case 'part': {
      const full = !item.taken && holdFree + 1e-9 < DERELICT.itemCargo;
      return { index: item.index, label: partName(what.key), key: what.key, taken: item.taken, ...(full ? { reason: tx().actionErrors.holdFull } : {}) };
    }
    case 'fragments':
      return { index: item.index, label: t.planItem(what.count, partBaseName(partKey(VARIANTS[what.plan].base, 1, what.plan))), taken: item.taken };
    case 'fabricate':
      return { index: item.index, label: t.fabricateItem, taken: item.taken };
  }
}

/** The open terminal of derelict `id` (null when it is not a derelict of this seed). */
export function terminalData(state: SimState, id: string, visit: TerminalVisit | null): DerelictTerminalData | null {
  const offer = terminalOffer(state, id);
  const site = siteById(state.seed, id);
  if (!offer || !site || site.kind !== 'derelict') return null;
  const holdFree = partHoldFree(state);
  const items = offer.items.map((i) => itemRow(state, i, holdFree));
  const fab = offer.items.find((i) => i.what.kind === 'fabricate');
  const mine = visit && visit.id === id ? visit : null;
  const journal = mine?.journal ? tx().journal[mine.journal as JournalId] : undefined;
  return {
    id,
    name: derelictName(state, site.pos),
    model: offer.model,
    service: offer.service,
    log: journal?.text ?? null,
    data: mine ? mine.data : offer.data,
    items,
    fabricator: fab && !fab.taken ? fabOptions(state) : null,
    holdFree,
  };
}

/** The `derelictTake` item index of the fabricator (null when the derelict has none). */
export function fabricatorItem(state: SimState, id: string): number | null {
  return terminalOffer(state, id)?.items.find((i) => i.what.kind === 'fabricate')?.index ?? null;
}
