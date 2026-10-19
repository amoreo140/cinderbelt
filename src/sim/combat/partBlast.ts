// Large reactor blast (M4c): a part with `blast > 0` that
// drops to 0 HP by any cause damages every other part 8-adjacent to its footprint by `blast`, straight
// to HP (shields do not absorb), cause 'blast'; chains resolve breadth-first in part-id order, each
// reactor once, before `splitGrid` (combat.ts `resolveDestroyed`). Adjacency is per cell (`partCells`),
// so shaped and 2×1 parts count by the cells they occupy; a shaped plate takes the blast on its own max HP.
import { partDef } from '../../data/parts';
import { partCells, partCenter } from '../ship/grid';
import { currentHp } from '../ship/hp';
import type { PlacedPart, ShipGrid } from '../ship/types';
import type { SimEvent, SimState } from '../Simulation';
import { cellOwners, gridToWorld } from './geometry';
import type { CombatShip, ShipRef } from './types';

/** Blast damage of a part (0 = not explosive). */
export const blastOf = (p: PlacedPart): number => partDef(p.partId, p.tier, p.variant).blast ?? 0;

/** Ids (ascending) of the other parts with a cell 8-adjacent to `part`'s footprint. */
export function blastNeighbours(grid: ShipGrid, part: PlacedPart): number[] {
  const owners = cellOwners(grid);
  const out = new Set<number>();
  for (const c of partCells(part)) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const id = owners.get(`${c.x + dx},${c.y + dy}`);
        if (id !== undefined && id !== part.id) out.add(id);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The destroyed set of ship `ref` grown by the blasts it sets off: returns every part id that is gone
 * after all blasts (a superset of `destroyed`; `destroyed` itself when nothing blows), pushes
 * `partBlast` events and applies the blast damage to the surviving neighbours' HP.
 */
export function expandBlasts(
  _state: SimState,
  ref: ShipRef,
  ship: CombatShip,
  destroyed: ReadonlySet<number>,
  events: SimEvent[],
): ReadonlySet<number> {
  const byId = (a: PlacedPart, b: PlacedPart) => a.id - b.id;
  let wave = ship.grid.parts.filter((p) => destroyed.has(p.id) && blastOf(p) > 0);
  if (wave.length === 0) return destroyed;
  const gone = new Set(destroyed);
  const blown = new Set<number>();
  const parts = new Map(ship.grid.parts.map((p) => [p.id, p] as const));
  while (wave.length > 0) {
    const next: PlacedPart[] = [];
    for (const reactor of wave.sort(byId)) {
      if (blown.has(reactor.id)) continue;
      blown.add(reactor.id);
      const damage = blastOf(reactor);
      events.push({ type: 'partBlast', ref, partId: reactor.id, pos: gridToWorld(ship.body, ship.props.centerOfMass, partCenter(reactor)), damage });
      for (const id of blastNeighbours(ship.grid, reactor)) {
        if (gone.has(id)) continue;
        const part = parts.get(id)!;
        const hp = currentHp(ship.hp, part);
        if (hp <= 0) continue;
        const after = Math.max(0, hp - damage);
        ship.hp.set(id, after);
        if (after > 0) continue;
        gone.add(id);
        if (blastOf(part) > 0) next.push(part);
      }
    }
    wave = next;
  }
  return gone;
}
