// Template slot rule (M4a, long-term design 3.4.3): 0 before the Archive node `templates`, 5 with it,
// 20 with `templates20`. Shared by the template actions, the view models and the save validation.
import { TEMPLATE_SLOTS } from '../../data/fleet';
import { hasFeature } from '../discovery/archive';
import type { SimState } from '../Simulation';

export function templateCap(state: SimState): number {
  if (hasFeature(state, 'templates20')) return TEMPLATE_SLOTS.plus;
  if (hasFeature(state, 'templates')) return TEMPLATE_SLOTS.base;
  return TEMPLATE_SLOTS.none;
}
