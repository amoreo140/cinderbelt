// Trophies (M4c plan §2.3): the derived list, the shelf of six pedestals and the player's pins.
// Trophies are never stored twice: captains come from `career.trophies` (defeat order), fortresses from
// `pirates.fortresses` entries with kills ≥ 1. Only the pins live in `state.home`.
import { TROPHY_PEDESTALS } from '../../data/home';
import { fortressSites } from '../pirates/sites';
import type { SimEvent, SimState } from '../Simulation';
import type { ActionError } from '../station/actions';
import { dockedAtHome } from './modules';
import type { TrophyId, TrophyItem } from './types';

/**
 * Every trophy: captains in defeat order (newest last), then the fortresses destroyed at least once in
 * site order. A captain's id is `cap:<captain index>`, a fortress's id is its site id (`fort:<i>`).
 */
export function trophiesOf(state: SimState): TrophyItem[] {
  const out: TrophyItem[] = [];
  const seen = new Set<number>();
  for (const t of state.career.trophies) {
    // a captain is defeated once; a duplicate entry (never written by the game) is ignored
    if (seen.has(t.captain)) continue;
    seen.add(t.captain);
    out.push({ id: `cap:${t.captain}`, kind: 'captain', captain: t.captain, fortress: null, replicas: [...t.parts], order: out.length });
  }
  for (const site of fortressSites(state.seed)) {
    const f = state.pirates.fortresses.get(site.id);
    if (!f || f.kills < 1) continue;
    out.push({ id: site.id as TrophyId, kind: 'fortress', captain: null, fortress: site.id, replicas: [], order: out.length });
  }
  return out;
}

/**
 * What stands on the six pedestals: the pins in pin order, then the newest unpinned captains, then
 * unpinned fortresses (site order), then null. Always TROPHY_PEDESTALS entries; pins that no longer
 * resolve are skipped.
 */
export function trophyShelf(state: SimState): (TrophyId | null)[] {
  const all = trophiesOf(state);
  const known = new Set<TrophyId>(all.map((t) => t.id));
  const shelf: TrophyId[] = [];
  const placed = new Set<TrophyId>();
  const put = (id: TrophyId) => {
    if (shelf.length >= TROPHY_PEDESTALS || placed.has(id)) return;
    shelf.push(id);
    placed.add(id);
  };
  for (const id of state.home.trophyPins) if (known.has(id)) put(id);
  const captains = all.filter((t) => t.kind === 'captain');
  for (let i = captains.length - 1; i >= 0; i--) put(captains[i]!.id);
  for (const t of all) if (t.kind === 'fortress') put(t.id);
  return Array.from({ length: TROPHY_PEDESTALS }, (_, i) => shelf[i] ?? null);
}

/**
 * Pins / unpins a trophy (docked at home, the trophy hall built). Pinning an already pinned trophy or
 * unpinning one that is not pinned succeeds without a change. Pushes `trophyPinned` on a change.
 * Returns the error (nothing changed), or null.
 */
export function trophyPin(state: SimState, id: string, pinned: boolean, events: SimEvent[]): ActionError | null {
  if (!dockedAtHome(state)) return 'notHome';
  if (!state.home.modules.has('trophyHall')) return 'noTrophyHall';
  const trophy = trophiesOf(state).find((t) => t.id === id);
  if (!trophy) return 'unknownTrophy';
  const pins = state.home.trophyPins;
  const at = pins.indexOf(trophy.id);
  if (pinned === true) {
    if (at >= 0) return null;
    if (pins.length >= TROPHY_PEDESTALS) return 'shelfFull';
    pins.push(trophy.id);
  } else {
    if (at < 0) return null;
    pins.splice(at, 1);
  }
  events.push({ type: 'trophyPinned', id: trophy.id, pinned: pinned === true });
  return null;
}
