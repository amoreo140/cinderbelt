// Goals of the balance bot, in the order of the econ model's main path (tools/econ/econ-model.mjs,
// `goalsAll`). Each goal is a target composition of the ship: "at least `count` parts of `part` with
// tier >= `tier`". Lower-tier parts of the same type are upgraded in place first, the rest is added.
import type { ArchiveNodeId } from '../../src/data/archive';
import type { PartId, Tier } from '../../src/data/parts';
import type { Rotation } from '../../src/sim/ship/types';

export interface PartRequirement {
  part: PartId;
  tier: Tier;
  count: number;
  /** Rotation of newly added parts (engines: 0 = pushes forward). */
  rot?: Rotation;
  /** Optional requirement: dropped first when the hull budget runs out. */
  optional?: boolean;
}

export interface BotGoal {
  /** Same id as the econ model goal (or a bot-only id). */
  id: string;
  label: string;
  reqs: PartRequirement[];
  /** After this goal the bot mines in ring 2 (titanium). */
  unlocksRing2?: boolean;
  /** Not part of the econ model main path (reported separately). */
  botOnly?: boolean;
  /**
   * Archive nodes the goal's parts need, in buying order (level 1 of a branch before its level 2): the pilot
   * buys them (Data from the fund + the credit fee) before it plans the refit.
   */
  archive?: ArchiveNodeId[];
}

export const BOT_GOALS: readonly BotGoal[] = [
  {
    id: 'firstDayArmor',
    label: 'Mount the 2 starting armor plates (former First Day step)',
    reqs: [{ part: 'armor', tier: 1, count: 2 }],
    botOnly: true,
  },
  { id: 'cargo1', label: 'Cargo hold T1 (1st upgrade)', reqs: [{ part: 'cargo', tier: 1, count: 3 }] },
  {
    id: 'laser2',
    label: '2nd laser + reactor T1',
    reqs: [
      { part: 'reactor', tier: 1, count: 2 },
      { part: 'miningLaser', tier: 1, count: 2 },
    ],
  },
  { id: 'tank', label: 'Extra fuel tank, first trips to P2 (titanium)', reqs: [{ part: 'fuelTank', tier: 1, count: 2 }], unlocksRing2: true },
  {
    id: 'weapons',
    label: 'Cannon x2 + shield + reactor T1 (M3)',
    reqs: [
      { part: 'reactor', tier: 1, count: 3 },
      { part: 'cannon', tier: 1, count: 2 },
      { part: 'shield', tier: 1, count: 1 },
    ],
  },
  { id: 'firstT2', label: 'First T2 part (laser T2)', reqs: [{ part: 'miningLaser', tier: 2, count: 1 }] },
  {
    // starter (14 pts) + First Day armour 2 + cargo 1 + laser/reactor 2 + tank 1 + weapons 4 + this 4 = 28:
    // the model's former "+4 armour, +2 engines" never fitted the T1 hull and is no longer part of the goal
    id: 'fillT1',
    label: 'T1 ship full (28 pts): 3 lasers, 5 holds',
    reqs: [
      { part: 'reactor', tier: 1, count: 4 },
      { part: 'miningLaser', tier: 1, count: 3 },
      { part: 'cargo', tier: 1, count: 5 },
    ],
  },
  { id: 'cockpit2', label: 'Cockpit T2 -> hull 48 pts', reqs: [{ part: 'cockpit', tier: 2, count: 1 }] },
  {
    id: 'refitT2a',
    label: 'T2: lasers x4, reactors x3',
    reqs: [
      { part: 'reactor', tier: 2, count: 3 },
      { part: 'miningLaser', tier: 2, count: 4 },
    ],
  },
  {
    id: 'refitT2b',
    label: 'T2: cargo x8, engines x6, gyros x2, tanks x2, radar',
    reqs: [
      { part: 'cargo', tier: 2, count: 8 },
      { part: 'engine', tier: 2, count: 6, rot: 0 },
      { part: 'gyro', tier: 2, count: 2 },
      { part: 'fuelTank', tier: 2, count: 2 },
      { part: 'radar', tier: 2, count: 1 },
    ],
  },
  {
    id: 'refitT2c',
    label: 'T2: armor x8, cannons x3, shields x2',
    reqs: [
      { part: 'armor', tier: 2, count: 8, optional: true },
      { part: 'cannon', tier: 2, count: 3 },
      { part: 'shield', tier: 2, count: 2 },
    ],
  },
];

