// Fresh state of the M4b world sites (a new game; a save before V17 migrates to this, T11).
import type { SitesState } from './types';

export function createSites(): SitesState {
  return { powered: new Set(), charge: null, berth: null, derelicts: new Map(), graveyards: new Map(), comets: new Map() };
}
