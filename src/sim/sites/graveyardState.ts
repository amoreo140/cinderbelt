// The saved state of a graveyard (M4b plan §2.5, `SitesState.graveyards`): only touched graveyards are
// stored. A module of its own so the wreck rules (discovery/wrecks.ts) can read and change it without
// importing the graveyard logic (which builds its wrecks with them).
import type { SimState } from '../Simulation';
import type { GraveyardState } from './types';

const fresh = (): GraveyardState => ({ mines: 0, party: 'asleep', data: false, rolls: 0 });

/** The saved state of a graveyard (a fresh one for an untouched graveyard – not stored until changed). */
export function graveyardState(state: SimState, id: string): GraveyardState {
  return state.sites.graveyards.get(id) ?? fresh();
}

/** The graveyard's state, stored (call before changing it). */
export function touchGraveyard(state: SimState, id: string): GraveyardState {
  let g = state.sites.graveyards.get(id);
  if (!g) {
    g = fresh();
    state.sites.graveyards.set(id, g);
  }
  return g;
}
