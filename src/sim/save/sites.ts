// World sites and the events director <-> save (V17, M4b "World Comes Alive"): powered relays, the relay charge,
// the berth, the touched derelicts / graveyards / comets, the armed mines' fuses, and the director's
// quiet window and one-shot keys. Sets and maps as sorted arrays, so a save is canonical.
import { createDirector } from '../events/state';
import type { DirectorState } from '../events/types';
import { armedMineList, restoreArmedMines } from '../sites/mines';
import { createSites } from '../sites/state';
import type { GraveyardState, SitesState } from '../sites/types';
import type { SavedDirectorV17, SavedPartyV17, SavedSitesV17 } from './types';

const byKey = <T>(a: [string, T], b: [string, T]): number => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

const PARTY: readonly GraveyardState['party'][] = ['asleep', 'awake', 'cleared'];

export const partyToSave = (p: GraveyardState['party']): SavedPartyV17 => PARTY.indexOf(p) as SavedPartyV17;
export const partyFromSave = (p: SavedPartyV17): GraveyardState['party'] => PARTY[p]!;

export function sitesToSave(s: SitesState): SavedSitesV17 {
  return {
    powered: [...s.powered].sort(),
    charge: s.charge ? { id: s.charge.id, progress: s.charge.progress } : null,
    berth: s.berth,
    derelicts: [...s.derelicts].sort(byKey).map(([id, d]) => [id, { woke: d.woke, taken: d.taken, visited: d.visited }]),
    graveyards: [...s.graveyards]
      .sort(byKey)
      .map(([id, g]) => [id, { mines: g.mines, party: partyToSave(g.party), data: g.data, rolls: g.rolls }]),
    comets: [...s.comets].sort(byKey).map(([id, c]) => [id, { pass: c.pass, core: c.core, tail: c.tail }]),
    armed: armedMineList(s),
  };
}

export function sitesFromSave(s: SavedSitesV17): SitesState {
  const sites: SitesState = {
    powered: new Set(s.powered),
    charge: s.charge ? { id: s.charge.id, progress: s.charge.progress } : null,
    berth: s.berth,
    derelicts: new Map(s.derelicts.map(([id, d]) => [id, { woke: d.woke, taken: d.taken, visited: d.visited }])),
    graveyards: new Map(s.graveyards.map(([id, g]) => [id, { mines: g.mines, party: partyFromSave(g.party), data: g.data, rolls: g.rolls }])),
    comets: new Map(s.comets.map(([id, c]) => [id, { pass: c.pass, core: c.core, tail: c.tail }])),
  };
  restoreArmedMines(sites, s.armed);
  return sites;
}

export function directorToSave(d: DirectorState): SavedDirectorV17 {
  return { last: d.last, fired: [...d.fired].sort(byKey).map(([k, t]) => [k, t]) };
}

export function directorFromSave(d: SavedDirectorV17): DirectorState {
  return { last: d.last, fired: new Map(d.fired) };
}

/** The sites of a save before V17 (the 16 → 17 migration): nothing touched. */
export const legacySites = (): SavedSitesV17 => sitesToSave(createSites());

/** The director of a save before V17: no event yet, the quiet window open. */
export const legacyDirector = (): SavedDirectorV17 => directorToSave(createDirector());
