// Combat HUD state outside the simulation (M3b): a record of the ship silhouette (parts that broke off
// or were destroyed, and their order for the death card) and toast texts for loot events.
import { RESOURCE_IDS, type Cargo } from '../data/resources';
import { tx } from '../i18n';
import { PLAYER_REF } from '../sim/combat/types';
import type { SimEvent } from '../sim/Simulation';
import { formatAmount } from '../ui/format';
import type { ToastKind } from '../ui/GameUi';
import type { Silhouette, SilhouetteCell } from './combatView';
import { formatParts, formatResources, partName } from './shipyardView';
import type { PartKey } from '../data/parts';

/**
 * Remembers the cells of all parts the ship had during the flight. Destroyed and detached parts vanish
 * from the simulation grid – the death card has to show them as destroyed, in the order they fell.
 */
export class SilhouetteTrack {
  private known = new Map<number, SilhouetteCell[]>();
  private order: number[] = [];
  private readonly lost = new Set<number>();
  /** Grid version at the last record (null = nothing yet, or after reset). */
  private version: number | null = null;
  /**
   * Hull outline of the first record of the flight (SL2 E1 T10): a flight only loses parts, so the
   * first record is the whole ship – the death card frames the destroyed parts with it.
   */
  private outline: string | undefined;

  /**
   * Records the ship only when its grid changed (`gridVersion`) – reads the silhouette lazily via `read`.
   * Parts that vanished from the grid since the last record without `partDestroyed` (they broke off)
   * are counted as lost. Call it both before and after a simulation step (after `lose`).
   */
  sync(version: number, read: () => Silhouette): void {
    if (version === this.version) return;
    const s = read();
    if (this.version !== null) {
      const present = new Set(s.cells.map((c) => c.part));
      const detached = [...this.known.keys()].filter((part) => !present.has(part));
      this.lose(detached);
    }
    this.version = version;
    this.observe(s);
  }

  /** Records the current ship state (cells of parts that are not lost yet). */
  observe(s: Silhouette): void {
    if (this.outline === undefined) this.outline = s.outline;
    const byPart = new Map<number, SilhouetteCell[]>();
    for (const c of s.cells) {
      const list = byPart.get(c.part);
      if (list) list.push(c);
      else byPart.set(c.part, [c]);
    }
    for (const [part, cells] of byPart) if (!this.lost.has(part)) this.known.set(part, cells);
  }

  /** Parts from `partDestroyed` events (player). */
  lose(parts: readonly number[]): void {
    for (const p of parts) {
      if (this.lost.has(p)) continue;
      this.lost.add(p);
      this.order.push(p);
    }
  }

  get lostCount(): number {
    return this.order.length;
  }

  reset(): void {
    this.known.clear();
    this.order = [];
    this.lost.clear();
    this.version = null;
    this.outline = undefined;
  }

  /** Silhouette with the lost parts (HP 0) and the order in which they were lost. */
  snapshot(current: Silhouette): { silhouette: Silhouette; order: number[]; total: number } {
    const lost = new Set(this.order);
    const cells: SilhouetteCell[] = current.cells.map((c) => (lost.has(c.part) ? { ...c, fraction: 0 } : c));
    const present = new Set(current.cells.map((c) => c.part));
    for (const part of this.order) {
      if (present.has(part)) continue;
      for (const c of this.known.get(part) ?? []) cells.push({ ...c, fraction: 0 });
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const damaged = new Set<number>();
    for (const c of cells) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
      if (c.fraction < 1) damaged.add(c.part);
    }
    if (cells.length === 0) minX = maxX = minY = maxY = 0;
    const total = new Set(cells.map((c) => c.part)).size;
    return {
      silhouette: { cells, minX, maxX, minY, maxY, damaged: damaged.size, outline: this.outline ?? current.outline },
      order: this.order.filter((p) => cells.some((c) => c.part === p)),
      total,
    };
  }
}

export interface CombatToast {
  text: string;
  kind: ToastKind;
  seconds: number;
}

const cargoTotal = (cargo: Partial<Cargo>): number => RESOURCE_IDS.reduce((s, r) => s + (cargo[r] ?? 0), 0);

/** Loot list: "12 Fe, 3.5 Cu, 1× Cannon T1". */
export function lootList(cargo: Partial<Cargo>, parts: Parameters<typeof formatParts>[0]): string {
  return [formatResources(cargo), formatParts(parts)].filter(Boolean).join(', ');
}

/** "Part lost: Armor T1 (impact)", several grouped by kind: "Parts lost: 2× Armor T1, Engine T1 (hit)". */
export function lostPartsText(keys: readonly PartKey[], cause: Extract<SimEvent, { type: 'partsLost' }>['cause']): string {
  const counts = new Map<PartKey, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  const list = [...counts].map(([k, n]) => (n > 1 ? `${n}× ${partName(k)}` : partName(k))).join(', ');
  const text = keys.length === 1 ? tx().flight.lost.one(list) : tx().flight.lost.many(list);
  return tx().flight.lost.withCause(text, tx().flight.lost.cause[cause]);
}

/** Toast for loot and cargo-loss events; other events → null. */
export function combatToast(event: SimEvent, ctx: { stationName: (id: string) => string }): CombatToast | null {
  const t = tx().combat;
  switch (event.type) {
    case 'salvaged': {
      const list = lootList(event.cargo, event.parts);
      if (!list) return { text: t.salvagedNothing, kind: 'error', seconds: 3 };
      // intact parts of a dismantled wreck pay Data too – say so (M21)
      const data = event.data ? t.salvagedData(event.data) : '';
      if (event.cargoFull) return { text: t.salvagedFull(list) + data, kind: 'info', seconds: 5 };
      return { text: t.salvaged(list) + data, kind: 'ok', seconds: 4 };
    }
    case 'salvageStored':
      return { text: t.salvageStored(formatParts(event.parts), ctx.stationName(event.stationId)), kind: 'ok', seconds: 5 };
    case 'cargoSpilled':
      return { text: t.cargoSpilled(formatAmount(cargoTotal(event.cargo)), event.toWreck !== null), kind: 'error', seconds: 5 };
    case 'partsLost':
      return { text: lostPartsText(event.parts.map((p) => p.key), event.cause), kind: 'error', seconds: 5 };
    default:
      return null;
  }
}

/**
 * The player's large reactor blew up in this step (M4c): one toast that says the blast first and then what
 * it took (the step's `partsLost` and `cargoSpilled` notes) – separate toasts would replace each other in
 * the same frame and the blast would never be seen. Null when the player had no blast in the step.
 */
export function blastToast(events: readonly SimEvent[], ctx: { stationName: (id: string) => string }): CombatToast | null {
  const blast = events.find((e): e is Extract<SimEvent, { type: 'partBlast' }> => e.type === 'partBlast' && e.ref === PLAYER_REF);
  if (!blast) return null;
  const texts = [tx().home.workshop.blast(tx().parts.largeReactor, blast.damage)];
  for (const e of events) {
    if (e.type !== 'partsLost' && e.type !== 'cargoSpilled') continue;
    const note = combatToast(e, ctx);
    if (note) texts.push(note.text);
  }
  // every note as a sentence of its own (the lost-parts note ends without a full stop)
  const text = texts.map((t) => (/[.!?…]$/.test(t) ? t : `${t}.`)).join(' ');
  return { text, kind: 'error', seconds: texts.length > 1 ? 7 : 4 };
}
