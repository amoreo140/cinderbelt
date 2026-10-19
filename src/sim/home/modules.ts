// Home modules (M4c plan §2.1): `homeBuild`, collision circles, Forge Index.
import { HOME_MODULE_IDS, HOME_MODULES, isBuildableModule, type HomeModuleDef, type HomeModuleId } from '../../data/home';
import type { Circle } from '../physics/collide';
import type { SimEvent, SimState } from '../Simulation';
import type { ActionError } from '../station/actions';
import { availableResources, isEmptyResources, missingResources, takeResources } from '../station/storage';
import { HOME_STATION_ID } from '../world/stations';

/** The player is docked (not docking) at the home station. */
export const dockedAtHome = (state: SimState): boolean => {
  const { dock } = state.player;
  return dock.mode === 'docked' && dock.stationId === HOME_STATION_ID;
};

/** The definition of a module id from a command (unknown ids → null). */
const moduleDef = (module: unknown): HomeModuleDef | null =>
  typeof module === 'string' && Object.hasOwn(HOME_MODULES, module) ? HOME_MODULES[module as HomeModuleId] : null;

/**
 * Builds `module` at the home station (docked there, buildable, not owned, enough credits and
 * resources): pushes `creditsChanged` + `homeModuleBuilt` and refreshes the station colliders.
 * Returns the error (nothing changed), or null.
 */
export function homeBuild(state: SimState, module: HomeModuleId, events: SimEvent[]): ActionError | null {
  if (!dockedAtHome(state)) return 'notHome';
  const def = moduleDef(module);
  if (!def || !isBuildableModule(def.id)) return 'moduleUnavailable';
  if (state.home.modules.has(def.id)) return 'moduleOwned';
  if (state.credits < def.credits) return 'notEnoughCredits';
  const resources = def.resources ?? {};
  if (!isEmptyResources(missingResources(resources, availableResources(state, HOME_STATION_ID)))) return 'notEnoughResources';

  // --- apply (everything checked) ---
  state.credits -= def.credits;
  takeResources(state, HOME_STATION_ID, resources);
  state.home.modules.add(def.id);
  state.world.setStationExtraColliders(HOME_STATION_ID, homeColliders(state));
  if (def.credits > 0) events.push({ type: 'creditsChanged', delta: -def.credits, reason: 'homeModule' });
  events.push({ type: 'homeModuleBuilt', module: def.id });
  return null;
}

/**
 * Collision circles of the built modules in the home station's frame (unrotated, like
 * `StationDef.colliders`; the module export uses the axes of `station_layouts.json`), in
 * `HOME_MODULE_IDS` order. `World.setStationExtraColliders(HOME_STATION_ID, …)` takes them.
 */
export function homeColliders(state: SimState): Circle[] {
  const out: Circle[] = [];
  for (const id of HOME_MODULE_IDS) {
    if (!state.home.modules.has(id)) continue;
    for (const c of HOME_MODULES[id].circles) out.push({ pos: { x: c.x, y: c.y }, radius: c.r });
  }
  return out;
}

/** Forge Index: the points of the built modules (0 in M4c – the buildable modules are cosmetic). */
export function forgeIndex(state: SimState): number {
  let sum = 0;
  for (const id of state.home.modules) sum += HOME_MODULES[id]?.forgeIndex ?? 0;
  return sum;
}

/** Per-step home upkeep (none in M4c; M5 modules hook here). */
export function stepHome(_state: SimState, _events: SimEvent[]): void {}
