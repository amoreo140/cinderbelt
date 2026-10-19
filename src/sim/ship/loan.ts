// Guild loan parts (saboteur report, rule 1): the only form of free help. A loan part is flagged on
// the hull, works like any other part, but has no value – it can only ever be on the hull it was lent
// to (removing it returns it to the Guild, losing it in flight leaves nothing to salvage).
import { createStarterShip } from './presets';
import type { PlacedPart, ShipGrid } from './types';

export const isLoanPart = (p: Pick<PlacedPart, 'loan'>): boolean => p.loan === true;

/** The same grid with every part lent by the Guild. */
export function asLoan(grid: ShipGrid): ShipGrid {
  return { nextId: grid.nextId, parts: grid.parts.map((p) => ({ ...p, loan: true as const })) };
}

/** The starter hull as a Guild loan (Hard / Hardcore respawn, an unreadable ship in a save). */
export const loanStarterShip = (): ShipGrid => asLoan(createStarterShip());
