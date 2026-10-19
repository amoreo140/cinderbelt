// Guild Training ("Guild Training", M3.7): the one onboarding of a new game. The Guild lends a
// minimal training hull and pays every step with parts the player installs himself; at the end the
// ship equals the starter ship of a game that skipped the training. Texts are in i18n/skTraining.ts.
import type { PartInventory } from './parts';
import type { Cargo } from './resources';

export type TrainingStepId =
  | 'flyBuoy'
  | 'mineIron'
  | 'dockSell'
  | 'installSide'
  | 'brakeBuoy'
  | 'installReverse'
  | 'craftCargo'
  | 'checklist'
  | 'finishShip';

export interface TrainingReward {
  credits: number;
  /** Guild reputation points. */
  rep: number;
  /** Parts put into the storage of the reward station. */
  parts: PartInventory;
  /** Crafting kit (materials into the storage + the crafting fee in credits). */
  kit?: { resources: Partial<Cargo>; credits: number };
}

export interface TrainingStepDef {
  id: TrainingStepId;
  /** Counter target (1 = done / not done). */
  amount: number;
  reward: TrainingReward;
}

/**
 * The steps in order. Rewards add up to the starter ship minus the training hull (4 engines – two
 * side, the second reverse and the second forward one –, a cargo hold as a crafting kit, reactor,
 * radar, gyroscope) plus the starting storage (2 armor plates, the cannon), 900 kr and 72 Guild
 * points – what the former "First Day" paid. The hull brings the first reverse engine itself.
 */
export const TRAINING_STEPS: readonly TrainingStepDef[] = [
  { id: 'flyBuoy', amount: 1, reward: { credits: 50, rep: 8, parts: {} } },
  { id: 'mineIron', amount: 20, reward: { credits: 100, rep: 8, parts: {} } },
  { id: 'dockSell', amount: 1, reward: { credits: 100, rep: 8, parts: { 'engine:1': 2 } } },
  { id: 'installSide', amount: 2, reward: { credits: 100, rep: 8, parts: {} } },
  { id: 'brakeBuoy', amount: 1, reward: { credits: 100, rep: 8, parts: { 'engine:1': 1 } } },
  {
    // counts the reverse engines on the hull: the training hull has one, the reward adds the second
    id: 'installReverse',
    amount: 2,
    reward: { credits: 100, rep: 8, parts: {}, kit: { resources: { iron: 30, copper: 10 }, credits: 900 } },
  },
  { id: 'craftCargo', amount: 2, reward: { credits: 100, rep: 8, parts: {} } },
  {
    id: 'checklist',
    amount: 3,
    reward: { credits: 150, rep: 8, parts: { 'reactor:1': 1, 'radar:1': 1, 'gyro:1': 1, 'engine:1': 1, 'armor:1': 2, 'cannon:1': 1 } },
  },
  { id: 'finishShip', amount: 4, reward: { credits: 100, rep: 8, parts: {} } },
];

export const TRAINING_STEP_COUNT = TRAINING_STEPS.length;

export const stepIndex = (id: TrainingStepId): number => TRAINING_STEPS.findIndex((s) => s.id === id);

/** The ship must pass within this distance of the first buoy (u). */
export const BUOY_REACH = 25;
/** Stopping at the second buoy: closer than this (u) … */
export const BRAKE_REACH = 22;
/** … and slower than this (u/s). */
export const BRAKE_SPEED = 1.5;

/** Checklist bits of the `checklist` step. */
export const CHECK_REFUEL = 1;
export const CHECK_MAP = 2;
export const CHECK_OBJECTIVES = 4;
/** `dockSell`: something was sold during the step. */
export const FLAG_SOLD = 1;
