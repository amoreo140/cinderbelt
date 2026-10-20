// Which UI parts a player has unlocked: derived from the Guild Training step (no saved state).
import type { TrainingStepId } from '../../data/training';
import { TRAINING_STEPS } from '../../data/training';
import type { TrainingState } from '../../sim/training/types';

export type UiFeature =
  | 'hull' | 'fuel' | 'goal' | 'helpChip' | 'radio'
  | 'radar' | 'energy' | 'heat' | 'cargo'
  | 'dockPrompt' | 'credits' | 'tab:market' | 'tab:service'
  | 'tab:shipyard'
  | 'speed' | 'dampers'
  | 'tab:crafting'
  | 'map' | 'objectives' | 'location' | 'radioLog'
  | 'scanner' | 'radarLegend' | 'storage'
  | 'tab:board' | 'tab:archive' | 'tab:development' | 'journal' | 'tow' | 'tractor' | 'worldMarks';

/** Features that appear when the given step becomes the current one. */
const BY_STEP: Record<TrainingStepId, readonly UiFeature[]> = {
  flyBuoy: ['hull', 'fuel', 'goal', 'helpChip', 'radio', 'tow'],
  mineIron: ['radar', 'energy', 'heat', 'cargo'],
  dockSell: ['dockPrompt', 'credits', 'tab:market', 'tab:service'],
  installSide: ['tab:shipyard'],
  brakeBuoy: ['speed', 'dampers'],
  installReverse: [],
  craftCargo: ['tab:crafting'],
  checklist: ['map', 'objectives', 'location', 'radioLog'],
  finishShip: ['scanner', 'radarLegend', 'storage'],
};

/** Features that unlock only after the training. */
const AFTER: readonly UiFeature[] = ['tab:board', 'tab:archive', 'tab:development', 'journal', 'tractor', 'worldMarks'];

/** CUMULATIVE[i] = features of steps 0..i (one shared Set per step index). */
const CUMULATIVE: readonly ReadonlySet<UiFeature>[] = (() => {
  const sets: Set<UiFeature>[] = [];
  const acc = new Set<UiFeature>();
  for (const step of TRAINING_STEPS) {
    for (const f of BY_STEP[step.id]) acc.add(f);
    sets.push(new Set(acc));
  }
  return sets;
})();

export const ALL_FEATURES: ReadonlySet<UiFeature> = new Set<UiFeature>([...TRAINING_STEPS.flatMap((s) => BY_STEP[s.id]), ...AFTER]);

/** Features unlocked now. Not active, no training, or no sites = ALL_FEATURES. */
export function revealedFeatures(training: TrainingState | null | undefined): ReadonlySet<UiFeature> {
  if (!training || training.status !== 'active' || training.sites === null) return ALL_FEATURES;
  return CUMULATIVE[training.step] ?? ALL_FEATURES;
}

/** The 1-based training step that unlocks a feature, or null when it unlocks after the training. */
export function unlockStep(feature: UiFeature): number | null {
  const i = TRAINING_STEPS.findIndex((s) => BY_STEP[s.id].includes(feature));
  return i < 0 ? null : i + 1;
}

/** Feature behind a key. Both forms the game sees: the physical code and the layout-independent `key:<letter>`. */
const KEY_FEATURE = new Map<string, UiFeature>();
for (const [letter, feature] of [['m', 'map'], ['g', 'objectives'], ['j', 'journal'], ['l', 'radioLog'], ['i', 'storage'], ['h', 'tow'], ['t', 'tractor'], ['z', 'dampers']] as const) {
  KEY_FEATURE.set(`Key${letter.toUpperCase()}`, feature);
  KEY_FEATURE.set(`key:${letter}`, feature);
}
KEY_FEATURE.set('Tab', 'scanner');
KEY_FEATURE.set('Slash', 'radarLegend');
KEY_FEATURE.set('key:?', 'radarLegend');

/** Whether a key code may act now; keys of unrevealed features are ignored. K (help) always works. */
export function gateKey(code: string, revealed: ReadonlySet<UiFeature>): boolean {
  const feature = KEY_FEATURE.get(code);
  return feature === undefined || revealed.has(feature);
}
