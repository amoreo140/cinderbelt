// Discovery names and texts for the UI (part locks, variants, places).
import { parsePartKey, type PartKey } from '../../data/parts';
import { tx } from '../../i18n';
import { partLock, partUnlocked } from '../../sim/discovery/archive';
import type { SimState } from '../../sim/Simulation';

/** "Engine – overpressure" / "Engine" (without the tier). */
export function partBaseName(key: PartKey): string {
  const { partId, variant } = parsePartKey(key);
  return variant ? `${tx().parts[partId]} – ${tx().discovery.variants[variant]}` : tx().parts[partId];
}

/** Why a part can be neither bought nor crafted (null = unlocked). */
export function lockReason(state: SimState, key: PartKey): string | null {
  if (partUnlocked(state, key)) return null;
  const lock = partLock(key);
  if (!lock) return null;
  if ('plan' in lock) return tx().discovery.archive.lockedPlan(partBaseName(key));
  return tx().discovery.archive.lockedPart(tx().discovery.archive.nodes[lock.node]);
}
