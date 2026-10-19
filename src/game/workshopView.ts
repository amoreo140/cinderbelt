// The on-board workshop in the flight HUD (M4c T10): two
// small lamps – RAF (refinery) and OPR (repair module) – with a tooltip saying what they do or why they
// stand, and the refined ore count beside them. Reads only the simulation state (`player.workshop`, set by
// `stepWorkshop`); the texts come from skHome `workshop`.
//
// The simulation may flicker between work and an idle reason step by step (the battery at the workshop
// floor, ore trickling in from the laser): the lamps show work at once, but an idle state – and a change
// of the idle reason – only once it has lasted `IDLE_HOLD` seconds.
import { RESOURCE_IDS, type ResourceId } from '../data/resources';
import { REFINED_BONUS, WORKSHOP_MIN_BATTERY } from '../data/workshop';
import { tx } from '../i18n';
import type { SimState } from '../sim/Simulation';
import { currentHp, maxHp } from '../sim/ship/hp';
import { playerMounts, repairMaterialPerHp, type WorkshopIdleReason } from '../sim/ship/workshop';
import { partKey } from '../data/parts';
import { formatInt, formatPercent } from '../ui/format';
import { partName } from './shipyardView';

/** Seconds an idle state (or a new idle reason) must last before the lamp shows it. */
export const IDLE_HOLD = 0.75;

export type RefineryLamp = 'fuel' | 'ore' | 'idle';
export type RepairLamp = 'working' | 'idle';

/** What the HUD draws (null = no workshop part and no refined ore: nothing is drawn). */
export interface WorkshopLampsData {
  /** null = the ship has no refinery. */
  refinery: RefineryLamp | null;
  /** null = the ship has no repair module. */
  repair: RepairLamp | null;
  /** Why the refinery / the repair module stands (only with an 'idle' lamp). */
  refineryReason?: WorkshopIdleReason;
  repairReason?: WorkshopIdleReason;
  /** Tooltips: what the lamp's part does or why it stands. */
  refineryTip: string | null;
  repairTip: string | null;
  /** Whole refined units in the cargo (0 = the count is hidden). */
  refined: number;
  refinedTip: string | null;
}

/** The raw (unsmoothed) lamp states of this step. */
export interface RawLamps {
  refinery: RefineryLamp | null;
  refineryReason?: WorkshopIdleReason;
  repair: RepairLamp | null;
  repairReason?: WorkshopIdleReason;
}

/** The lamp states straight from the simulation (in flight; docked the HUD is not drawn). */
export function rawLamps(state: SimState): RawLamps {
  const { player } = state;
  const mounts = playerMounts(player);
  const w = player.workshop;
  const out: RawLamps = { refinery: null, repair: null };
  if (mounts.refineries.length > 0) {
    if (w.refining) out.refinery = w.refining;
    else {
      out.refinery = 'idle';
      // the first step after undocking has no reason yet: nothing to do is the honest guess
      out.refineryReason = w.refineryIdle ?? 'nothing';
    }
  }
  if (mounts.repairs.length > 0) {
    if (w.repairing.length > 0) out.repair = 'working';
    else {
      out.repair = 'idle';
      out.repairReason = w.repairIdle ?? 'nothing';
    }
  }
  return out;
}

interface LampMemo<L> {
  shown: L | null;
  shownReason: WorkshopIdleReason | undefined;
  /** Since when the raw lamp has been idle (null = it works or is absent). */
  idleSince: number | null;
  /** The raw idle reason and since when it holds. */
  reason: WorkshopIdleReason | undefined;
  reasonSince: number;
}

const freshMemo = <L>(): LampMemo<L> => ({ shown: null, shownReason: undefined, idleSince: null, reason: undefined, reasonSince: 0 });

/** One lamp through the idle hold. */
function smooth<L extends string>(m: LampMemo<L>, raw: L | null, reason: WorkshopIdleReason | undefined, now: number): void {
  if (raw === null) {
    Object.assign(m, freshMemo<L>());
    return;
  }
  if (raw !== 'idle') {
    // work shows at once
    m.shown = raw;
    m.shownReason = undefined;
    m.idleSince = null;
    m.reason = undefined;
    return;
  }
  if (m.idleSince === null) m.idleSince = now;
  if (reason !== m.reason) {
    m.reason = reason;
    m.reasonSince = now;
  }
  // a lamp that appears idle (just undocked, a part mounted) shows it at once – there is nothing to flicker from
  const fresh = m.shown === null;
  if (fresh || now - m.idleSince >= IDLE_HOLD - 1e-9) {
    if (m.shown !== raw) {
      m.shown = raw;
      m.shownReason = reason;
    } else if (now - m.reasonSince >= IDLE_HOLD - 1e-9 || m.shownReason === undefined) {
      m.shownReason = reason;
    }
  }
}

const pct = (v: number): string => formatPercent(Math.round(v * 100));
/** "15 %" – the texts say "15 % more expensive" / "15 % more". */
const bonus = (): string => formatPercent(Math.round(REFINED_BONUS * 100));
const lower = (s: string): string => s.toLocaleLowerCase();

/** The repair material the damaged neighbours of the repair modules need ("iron or titanium"). */
function neededMaterial(state: SimState): string {
  const { player } = state;
  const byId = new Map(player.grid.parts.map((p) => [p.id, p]));
  const need = new Set<ResourceId>();
  for (const m of playerMounts(player).repairs) {
    for (const id of m.neighbours) {
      const p = byId.get(id);
      if (p && currentHp(player.hp, p) < maxHp(p) - 1e-6) need.add(repairMaterialPerHp(p).material);
    }
  }
  const names = RESOURCE_IDS.filter((r) => need.has(r)).map((r) => lower(tx().resources[r]));
  const w = tx().home.workshop;
  if (names.length === 0) return w.or(lower(tx().resources.iron), lower(tx().resources.titanium));
  return names.reduce((a, b) => w.or(a, b));
}

/** "Pancier T1 (45 %), Motor T1 (80 %)" – the parts the repair modules work on now. */
function repairTargets(state: SimState): string {
  const { player } = state;
  const byId = new Map(player.grid.parts.map((p) => [p.id, p]));
  const seen = new Set<number>();
  const out: string[] = [];
  for (const r of player.workshop.repairing) {
    const p = byId.get(r.target);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(`${partName(partKey(p.partId, p.tier, p.variant))} (${pct(currentHp(player.hp, p) / maxHp(p))})`);
  }
  return out.join(', ');
}

/** The tooltip of the refinery lamp. */
function refineryTip(state: SimState, lamp: RefineryLamp, reason: WorkshopIdleReason | undefined): string {
  const w = tx().home.workshop;
  const { player } = state;
  if (lamp === 'fuel') return w.refiningFuel(pct(player.props.fuelCapacity > 0 ? player.fuel / player.props.fuelCapacity : 0));
  if (lamp === 'ore') return w.refiningOre(bonus());
  if (reason === 'energy') return w.idle.refineryEnergy(pct(WORKSHOP_MIN_BATTERY));
  if (reason === 'material') return w.idle.refineryMaterial;
  return w.idle.refineryNothing;
}

/** The tooltip of the repair lamp. */
function repairTip(state: SimState, lamp: RepairLamp, reason: WorkshopIdleReason | undefined): string {
  const w = tx().home.workshop;
  if (lamp === 'working') return w.repairing(repairTargets(state));
  if (reason === 'energy') return w.idle.repairEnergy(pct(WORKSHOP_MIN_BATTERY));
  if (reason === 'material') return w.idle.repairMaterial(neededMaterial(state));
  return w.idle.repairNothing;
}

/** Whole refined units of the cargo and the tooltip listing them ("Ti 12 · Fe 30"). */
export function refinedCount(state: SimState): { count: number; tip: string | null } {
  const refined = state.player.refined;
  const parts = RESOURCE_IDS.filter((r) => Math.floor(refined[r] + 1e-9) >= 1).map((r) => `${tx().resourceSymbols[r]} ${formatInt(Math.floor(refined[r] + 1e-9))}`);
  const count = RESOURCE_IDS.reduce((s, r) => s + Math.floor(refined[r] + 1e-9), 0);
  return { count, tip: count > 0 ? tx().home.workshop.refinedTip(parts.join(' · '), bonus()) : null };
}

/**
 * The lamps' view model with the idle hold. Game owns one (transient, never saved) and asks it at every
 * HUD redraw; `reset()` on docking, a new ship or a load.
 */
export class WorkshopLamps {
  private refinery = freshMemo<RefineryLamp>();
  private repair = freshMemo<RepairLamp>();

  reset(): void {
    this.refinery = freshMemo();
    this.repair = freshMemo();
  }

  /** null = nothing to draw (no workshop part, no refined ore). */
  view(state: SimState, now: number): WorkshopLampsData | null {
    const raw = rawLamps(state);
    smooth(this.refinery, raw.refinery, raw.refineryReason, now);
    smooth(this.repair, raw.repair, raw.repairReason, now);
    const refined = refinedCount(state);
    const ref = this.refinery.shown;
    const rep = this.repair.shown;
    if (ref === null && rep === null && refined.count === 0) return null;
    return {
      refinery: ref,
      repair: rep,
      ...(ref === 'idle' && this.refinery.shownReason ? { refineryReason: this.refinery.shownReason } : {}),
      ...(rep === 'idle' && this.repair.shownReason ? { repairReason: this.repair.shownReason } : {}),
      refineryTip: ref === null ? null : refineryTip(state, ref, this.refinery.shownReason),
      repairTip: rep === null ? null : repairTip(state, rep, this.repair.shownReason),
      refined: refined.count,
      refinedTip: refined.tip,
    };
  }
}
