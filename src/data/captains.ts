// Named captains of the Rust clans (long-term design 6.4): names, temperaments and rules as data.
// The concrete 30 captains are generated from the seed (sim/captains/captains.ts).
import type { FactionId } from './factions';

export const CAPTAIN_COUNT = 30;

/** Names (proper names are content, not translation – that is why they live here). */
export const CAPTAIN_NAMES: readonly string[] = [
  'Korma', 'Vlasta', 'Brano', 'Jarka', 'Dušan', 'Ilka', 'Mirko', 'Zora', 'Tibor', 'Hela', 'Radim', 'Soňa', 'Ondro', 'Vanda', 'Kazi',
];

/**
 * Number of captain nicknames (epithets). The sim picks an index; the nickname itself is a text in
 * the current language (`tx().goals.captains.nicknames`, skGoals.ts / enGoals.ts).
 */
export const CAPTAIN_NICKNAME_COUNT = 15;

export type CaptainTrait = 'cautious' | 'reckless' | 'vengeful' | 'showoff' | 'greedy';
export const CAPTAIN_TRAITS: readonly CaptainTrait[] = ['cautious', 'reckless', 'vengeful', 'showoff', 'greedy'];

export interface TraitDef {
  /** A captain who leaves combat below this HP fraction has "escaped" and gets promoted. */
  escapeHull: number;
  /** How many part replicas the captain takes after destroying the player. */
  replicas: number;
  /** Bounty multiplier. */
  bountyMult: number;
}

export const TRAITS: Record<CaptainTrait, TraitDef> = {
  cautious: { escapeHull: 0.4, replicas: 1, bountyMult: 1 },
  reckless: { escapeHull: 0.15, replicas: 1, bountyMult: 1 },
  vengeful: { escapeHull: 0.3, replicas: 1, bountyMult: 1.1 },
  showoff: { escapeHull: 0.3, replicas: 2, bountyMult: 1 },
  greedy: { escapeHull: 0.35, replicas: 1, bountyMult: 1.25 },
};

export const CAPTAIN_CLANS: readonly FactionId[] = ['rust', 'cauldron', 'slantedStar'];

/**
 * Bounty (Starsector-style) in hours of the reference income of the captain's ring: 0.1 h +
 * 0.075 h × level. M3.5a had a fixed 5,000 + 4,000 × level – in P2 (minimum 22k/h) hunting a
 * level-3 captain would pay ~115k/h; now it is ~2× mining and in P3/P4 the bounty grows with the ring.
 */
export const BOUNTY_HOURS_BASE = 0.1;
export const BOUNTY_HOURS_PER_LEVEL = 0.075;
/** Level 1–3 when generated; the maximum after promotions. */
export const CAPTAIN_MIN_LEVEL = 1;
export const CAPTAIN_START_LEVELS = 3;
export const CAPTAIN_MAX_LEVEL = 5;
/** From this level on the captain flies T2 parts. */
export const CAPTAIN_T2_LEVEL = 3;
/** A captain "took part" in the player's death if they were this close. */
export const CAPTAIN_KILL_RANGE = 350;
