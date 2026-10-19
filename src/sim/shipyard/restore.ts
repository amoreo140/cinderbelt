// "Restore to design" (M3.8): editor operations that turn the current ship back into its blueprint –
// lost parts go back to their cells, damaged ones are swapped for new ones (the removed part is
// repaired into storage, or scrapped, by the usual design rules), parts the blueprint does not have
// are taken off. The shipyard prices and validates the result like any other draft. Shapes (SL2 E2) are
// part of the placement: a part in another shape than the blueprint is taken off and laid again (never
// reshaped in place – a damaged one would be `reshapeDamaged`).
import { partKey } from '../../data/parts';
import { samePlacement } from '../ship/blueprint';
import { currentHp, maxHp } from '../ship/hp';
import type { HpMap, PlacedPart, ShipGrid } from '../ship/types';
import { applyEditorOp, type EditorOp } from './editor';

export interface RestorePlan {
  /** Operations against `grid`, in order (they always replay). */
  ops: EditorOp[];
  /** Blueprint parts that had to be put back. */
  missing: number;
  /** Damaged parts swapped for new ones. */
  repaired: number;
  /** Blueprint parts that could not be placed (their cells are taken). */
  unplaced: number;
}

/** A new part laid like `p` – in its shape too (SL2 E2). */
const placeOp = (p: PlacedPart): EditorOp => ({
  op: 'place',
  key: partKey(p.partId, p.tier, p.variant),
  x: p.x,
  y: p.y,
  rot: p.rot,
  ...(p.shape !== undefined ? { shape: p.shape } : {}),
});

export function restoreOps(grid: ShipGrid, hp: HpMap, blueprint: ShipGrid, options: { repair?: boolean } = {}): RestorePlan {
  const repair = options.repair ?? true;
  const wanted = new Map(blueprint.parts.map((p) => [p.id, p]));
  const ops: EditorOp[] = [];
  let current = grid;
  const run = (op: EditorOp): boolean => {
    const r = applyEditorOp(current, op);
    if (r.ok) {
      current = r.grid;
      ops.push(op);
    }
    return r.ok;
  };

  const kept = new Set<number>();
  for (const p of grid.parts) {
    const b = wanted.get(p.id);
    if (b && samePlacement(p, b)) kept.add(p.id);
    else run({ op: 'remove', id: p.id });
  }

  let repaired = 0;
  if (repair) {
    for (const p of grid.parts) {
      if (!kept.has(p.id) || currentHp(hp, p) >= maxHp(p)) continue;
      // a new part in the same cell right away – the neighbours still hold it in place
      if (run({ op: 'remove', id: p.id }) && run(placeOp(p))) repaired++;
    }
  }

  // lost parts back on their cells (placement is free, so one pass places all that fit; the loop stays
  // as a guard for any future placement rule that depends on order)
  let pending = blueprint.parts.filter((p) => !kept.has(p.id)).sort((a, b) => a.id - b.id);
  const missing = pending.length;
  for (let progress = true; progress && pending.length > 0; ) {
    const before = pending.length;
    pending = pending.filter((p) => !run(placeOp(p)));
    progress = pending.length < before;
  }
  return { ops, missing, repaired, unplaced: pending.length };
}
