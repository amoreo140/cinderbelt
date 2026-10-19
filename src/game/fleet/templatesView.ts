// Templates view models (M4a, T4): the Templates modal and the death card's
// "Rebuild from a template". Pure, from `SimState`; reasons are finished texts.
import { parsePartKey, type Tier } from '../../data/parts';
import { tx } from '../../i18n';
import { hullPoints } from '../../sim/ship/budget';
import type { SimState } from '../../sim/Simulation';
import { normalizeTemplate, templateGrid, templateProblem } from '../../sim/templates/normalize';
import { templateCap } from '../../sim/templates/state';
import type { ShipTemplate, TemplatePart } from '../../sim/templates/types';
import type { ShipGrid } from '../../sim/ship/types';
import type { StationDef } from '../../sim/world/stations';
import { lockReason } from '../discovery/names';
import { dockedStation, gridSilhouette, templatesLockText } from './hangarView';
import type { DeathTemplateView, TemplateItemView, TemplatesView } from './types';

/** Why a template cannot be loaded into the shipyard now (null = it can): destroyed, not docked, no shipyard. */
export function applyTemplateError(state: SimState, station: StationDef | null): 'serviceUnavailable' | 'notDocked' | null {
  if (state.player.destroyed) return 'serviceUnavailable';
  if (!station) return 'notDocked';
  return station.services.shipyard ? null : 'serviceUnavailable';
}

function cockpitTier(parts: readonly TemplatePart[]): Tier {
  const cockpit = parts.find((p) => parsePartKey(p[0]).partId === 'cockpit');
  return cockpit ? parsePartKey(cockpit[0]).tier : 1;
}

/** One row of the Templates modal. */
export function templateItem(state: SimState, template: ShipTemplate, index: number, applyReason?: string): TemplateItemView {
  const grid = templateGrid(template.parts);
  const item: TemplateItemView = {
    index,
    name: template.name,
    parts: template.parts.length,
    hullPoints: hullPoints(grid),
    cockpitTier: cockpitTier(template.parts),
    locked: template.parts.filter((p) => lockReason(state, p[0]) !== null).length,
    silhouette: gridSilhouette(grid, new Map()),
  };
  if (applyReason) item.applyReason = applyReason;
  return item;
}

/** The Templates modal's view model (`station` = where the player is docked, null in flight). */
export function templatesView(state: SimState, station: StationDef | null = dockedStation(state)): TemplatesView {
  const cap = templateCap(state);
  const error = applyTemplateError(state, station);
  const applyReason = error ? tx().actionErrors[error] : undefined;
  const view: TemplatesView = { cap, items: state.templates.map((t, i) => templateItem(state, t, i, applyReason)) };
  if (cap <= 0 && state.templates.length === 0) view.lockReason = templatesLockText();
  else if (state.templates.length >= cap) view.saveReason = tx().actionErrors.templateCap;
  return view;
}

/** Template parts of a grid when it is a valid design to save (null otherwise: no cockpit, loose parts, …). */
export function savableParts(grid: ShipGrid): TemplatePart[] | null {
  const parts = normalizeTemplate(grid);
  return parts && templateProblem(parts) === null ? parts : null;
}

/**
 * Where "Rebuild from a template" on the death card respawns: the respawn station when it has a shipyard,
 * else the evacuation station (always a shipyard) – `evacuate` says which death option to take.
 */
export interface DeathTemplateTarget {
  view: DeathTemplateView;
  evacuate: boolean;
}

/** The death card's template action: hidden without a template, disabled without a shipyard to rebuild at. */
export function deathTemplate(state: SimState, respawn: StationDef | null, evacuation: StationDef | null): DeathTemplateTarget {
  if (state.templates.length === 0) return { view: null, evacuate: false };
  if (respawn?.services.shipyard) return { view: {}, evacuate: false };
  if (evacuation?.services.shipyard) return { view: {}, evacuate: true };
  return { view: { reason: tx().actionErrors.serviceUnavailable }, evacuate: false };
}
