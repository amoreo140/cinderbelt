// Shader warm-up samples of the hull shell (SL2 E1 T11, render/warmup.ts): a small shelled ship – a
// clipped (bevelled) armour corner, torn edges with soot, seams and corner guards – built and baked
// like a flight view, so the merged hull batches with shell geometry and the clipped armour are drawn
// in the warm-up frame; one more per clan set that has loaded (their part meshes may lay out their
// attributes differently). The nav light sample is NavLights.warmUp.
import { CAPTAIN_CLANS } from '../../data/captains';
import type { FactionId } from '../../data/factions';
import { createGrid } from '../../sim/ship/grid';
import { cellKey, gridCellKeys } from '../../sim/ship/outline';
import { computeProperties } from '../../sim/ship/properties';
import type { ModelLibrary } from '../assets/ModelLibrary';
import { ShipView } from '../ShipView';
import type { WarmUpZoo } from '../warmup';

/** A T2 cockpit flanked by armour (convex corners → bevels for the player), an engine and a cannon. */
const SAMPLE = createGrid([
  ['cockpit', 1, 0, 0, 2],
  ['gyro', 0, 0],
  ['engine', -1, 0],
  ['armor', 1, 1],
  ['armor', 1, -1],
  ['cannon', 2, 0],
]);
/** The sample before it lost a part next to the gyro: torn edges. */
const SAMPLE_BEFORE = new Set([...gridCellKeys(SAMPLE), cellKey(0, 1)]);

/**
 * Adds the shell samples to the zoo; their views are disposed with it (their materials are the
 * templates' and stay). Nothing without the swatch table (no shell is drawn then).
 * @returns the sample views (tests)
 */
export function shellWarmUpSamples(zoo: WarmUpZoo, library: ModelLibrary): ShipView[] {
  if (library.hasSwatches !== true) return [];
  const props = computeProperties(SAMPLE);
  const clans: (FactionId | null)[] = [null, ...CAPTAIN_CLANS.filter((c) => library.clans.ready(c))];
  const views = clans.map((clan) => {
    const view = new ShipView(SAMPLE, props, library, clan, { shell: true, mode: 'flight', tornFrom: SAMPLE_BEFORE });
    view.bake();
    zoo.add(view.group);
    zoo.onDispose(() => view.dispose());
    return view;
  });
  return views;
}
