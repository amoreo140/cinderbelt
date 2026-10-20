// Which flight-HUD parts show, from the unlocked UI features (game/onboarding/reveal.ts). Pure.
// Combat parts (shield and hull gauges, ship silhouette, threat band, enemy arrows, toll band, cannon
// reticle) have no feature: they are never gated, so an attack always shows them.
import type { UiFeature } from '../game/onboarding/reveal';
import { ALL_FEATURES } from '../game/onboarding/reveal';

export interface HudParts {
  radar: boolean;
  energy: boolean;
  heat: boolean;
  cargo: boolean;
  credits: boolean;
  speed: boolean;
  dampers: boolean;
  scanner: boolean;
  location: boolean;
  radarLegend: boolean;
  helpChip: boolean;
  worldMarks: boolean;
}

const cache = new WeakMap<ReadonlySet<UiFeature>, HudParts>();

/** The visibility flags of a reveal set; one shared (read-only) object per set, no allocation per frame. */
export function hudParts(reveal: ReadonlySet<UiFeature> = ALL_FEATURES): HudParts {
  let parts = cache.get(reveal);
  if (!parts) {
    parts = {
      radar: reveal.has('radar'),
      energy: reveal.has('energy'),
      heat: reveal.has('heat'),
      cargo: reveal.has('cargo'),
      credits: reveal.has('credits'),
      speed: reveal.has('speed'),
      dampers: reveal.has('dampers'),
      scanner: reveal.has('scanner'),
      location: reveal.has('location'),
      radarLegend: reveal.has('radar') && reveal.has('radarLegend'),
      helpChip: reveal.has('helpChip'),
      worldMarks: reveal.has('worldMarks'),
    };
    cache.set(reveal, parts);
  }
  return parts;
}

/** Whether `feature` is in the space-separated list of freshly unlocked features (`HudData.fresh`). */
export function isFresh(fresh: string | undefined, feature: UiFeature): boolean {
  return fresh !== undefined && fresh.split(' ').includes(feature);
}
