// Pure layout decisions of the derelict terminal (M4b plan T9): which service it is, whether the item
// rows or the fabricator list show, whether the part hold is full and whether the offer is used up.
import { RESOURCE_IDS, type Cargo, type ResourceId } from '../../data/resources';
import { DERELICT } from '../../data/sites';
import type { DerelictTerminalData, FabOption, TerminalItem } from '../../game/sites/types';
import type { DerelictService } from '../../sim/sites/types';

export interface TerminalLayout {
  /** The service heading (null = nothing to name, e.g. an empty mock). */
  service: DerelictService | null;
  /** Item rows (stash parts, plan fragments, the used fabricator's row). */
  rows: TerminalItem[];
  /** The fabricator's choices while it is unused; null otherwise. */
  fabricator: FabOption[] | null;
  /** One more part (`DERELICT.itemCargo`) does not fit into the part hold. */
  holdFull: boolean;
  /** Everything of the service is taken / made. */
  used: boolean;
}

/** The service: from the view model, else from the shape of the offer (kit mocks, older view models). */
function serviceOf(d: DerelictTerminalData): DerelictService | null {
  if (d.service) return d.service;
  if (d.fabricator !== null) return 'fabricator';
  if (d.items.some((i) => i.key !== undefined)) return 'stash';
  return d.items.length > 0 ? 'plan' : null;
}

export function terminalLayout(d: DerelictTerminalData): TerminalLayout {
  // the unused fabricator's single item row is the list itself – no "Take" for a choice
  const fabricator = d.fabricator;
  const rows = fabricator !== null ? [] : d.items;
  return {
    service: serviceOf(d),
    rows,
    fabricator,
    holdFull: d.holdFree < DERELICT.itemCargo,
    used: fabricator === null && d.items.every((i) => i.taken),
  };
}

/** The materials of a fabricator option in the cargo order, without zeros. */
export function materialList(materials: Partial<Cargo>): { id: ResourceId; amount: number }[] {
  const out: { id: ResourceId; amount: number }[] = [];
  for (const id of RESOURCE_IDS) {
    const amount = materials[id] ?? 0;
    if (amount > 0) out.push({ id, amount });
  }
  return out;
}
