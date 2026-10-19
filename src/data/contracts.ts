// Contracts (long-term design 8.3): types, reward coefficients and generator parameters as data.
// Types that depend on systems of later milestones are here with `since` and the generator skips them.
import type { RingIndex } from './economy';
import type { RepFactionId, RepUnlock } from './factions';
import type { ResourceId } from './resources';

export type ContractType = 'delivery' | 'mining' | 'hunt' | 'rescue' | 'survey' | 'scan' | 'escort' | 'retrieve' | 'build' | 'fortress' | 'chart' | 'relay';

export const CONTRACT_TYPES: readonly ContractType[] = ['delivery', 'mining', 'hunt', 'rescue', 'survey', 'scan', 'escort', 'retrieve', 'build', 'fortress', 'chart', 'relay'];

export interface ContractTypeDef {
  type: ContractType;
  faction: RepFactionId;
  /** k_type in the reward formula (8.3). */
  k: number;
  /** The unlock by the ring of the contract's place (missing = not offered in that ring). */
  unlock: Partial<Record<RingIndex, RepUnlock>>;
  /** The milestone that brings the type (missing = playable now). */
  since?: string;
  /** Weight in the slip roll. */
  weight: number;
}

export const CONTRACT_DEFS: Record<ContractType, ContractTypeDef> = {
  delivery: { type: 'delivery', faction: 'guild', k: 0.8, unlock: { 1: 'contractsBasic', 2: 'contractsRing2' }, weight: 3 },
  // mining: mine X yourself (veins); not in table 8.3, the M3.5a brief asks for it – k like a Delivery without goods
  mining: { type: 'mining', faction: 'guild', k: 0.8, unlock: { 1: 'contractsBasic', 2: 'contractsRing2' }, weight: 2 },
  hunt: { type: 'hunt', faction: 'guild', k: 1.1, unlock: { 2: 'contractsRing2' }, weight: 2 },
  rescue: { type: 'rescue', faction: 'guild', k: 0.9, unlock: { 1: 'contractsRing1', 2: 'contractsRing2' }, weight: 2 },
  // Survey: from level 0 in M3.5a (the Scan with the scanner came in M3.5b), ring 3 from Institute 3
  survey: { type: 'survey', faction: 'institute', k: 0.9, unlock: { 1: 'surveyRing1', 2: 'surveyRing2', 3: 'surveyRing3' }, weight: 2 },
  // Scan (M3.5b): scan a place – Institute 1; Retrieval: a part from a wreck – the Archive licence (L1)
  scan: { type: 'scan', faction: 'institute', k: 0.9, unlock: { 1: 'scanContracts', 2: 'scanContracts', 3: 'scanContracts' }, weight: 2 },
  // Escort (M4d, DH 8.3): fly with a Free Traders convoy through a dangerous lane stretch; offered only at
  // stations near a Guild Lane (data/convoys.ts ESCORT.offerRange, src/sim/convoys/escort.ts)
  escort: { type: 'escort', faction: 'guild', k: 1.0, unlock: { 1: 'contractsRing1', 2: 'contractsRing2' }, weight: 2 },
  retrieve: { type: 'retrieve', faction: 'institute', k: 1.0, unlock: { 1: 'retrieveContracts', 2: 'retrieveContracts', 3: 'retrieveContracts' }, weight: 1 },
  build: { type: 'build', faction: 'guild', k: 0.7, unlock: {}, since: 'M7', weight: 0 },
  // Destroy the fortress (M3.6, design 2.3 example "Destroy the Rust Fortress"): the guild pays for a boss fight in ring 2
  fortress: { type: 'fortress', faction: 'guild', k: 1.3, unlock: { 2: 'contractsRing2' }, weight: 1 },
  // Chart sector X (sectors design §4.3): the Guild pays for charting a sector it buys charts of; the
  // reward (k 0.9, never below the chart's sale price) covers the sale – the sector is marked sold
  chart: { type: 'chart', faction: 'guild', k: 0.9, unlock: { 1: 'contractsBasic', 2: 'contractsRing2', 3: 'contractsRing2' }, weight: 1 },
  // Guild relay (M4d plan §2.2): repair, power and hold a broken Guild relay mast in a Contested lane
  // sector – the sector becomes Guarded for good. Never rolled (weight 0): a pinned offer like the "First
  // chart" (src/sim/guild/relayChain.ts `relayOffer`), from Guild level 2 (data/guild.ts RELAY_CHAIN)
  relay: { type: 'relay', faction: 'guild', k: 1.2, unlock: { 2: 'guildRelay', 3: 'guildRelay' }, weight: 0 },
};

/** Types playable in this version. */
export const PLAYABLE_CONTRACT_TYPES: readonly ContractType[] = CONTRACT_TYPES.filter((t) => !CONTRACT_DEFS[t].since);

/**
 * The lowest reference income of a ring (kr/h, 8.3). Ring 2 was 45 k – with the starter ship (~9 k/h)
 * contracts dominated; M3.5b ties it to the model: at most 1.5× the mining of the ship the main path
 * enters the ring with (guarded by econOracle.test.ts).
 */
export const MIN_REFERENCE_INCOME: Record<RingIndex, number> = { 1: 12_000, 2: 22_000, 3: 85_000, 4: 180_000 };

/** Contract risk (reward multiplier 1 + risk). */
export type ContractRisk = 0 | 0.25 | 0.5;
export const RISKS: readonly ContractRisk[] = [0, 0.25, 0.5];

/** Board: 4–6 slips per station, refreshed every 20 game minutes (8.3). */
export const BOARD_MIN_OFFERS = 4;
export const BOARD_MAX_OFFERS = 6;
export const BOARD_REFRESH_TICKS = 20 * 60 * 60;
/** Max. active contracts (5 with the captain's licence – Guild 5, later). */
export const MAX_ACTIVE_CONTRACTS = 3;
/** A free cancel (the slip goes back on the board) within 2 game minutes. */
export const FREE_CANCEL_TICKS = 2 * 60 * 60;
/** A short contract (◷) – estimate up to 6 minutes. */
export const SHORT_CONTRACT_SECONDS = 6 * 60;

/** Duration estimates: average cruise speed and overhead (loading, dock). */
export const CRUISE_SPEED = 25;
export const CONTRACT_OVERHEAD_SECONDS = 90;
/** The duration estimate stays in a sensible band (short ◷ from 2 min, a hunt up to 30 min). */
export const MIN_CONTRACT_SECONDS = 2 * 60;
export const MAX_CONTRACT_SECONDS = 30 * 60;

/** Delivery: amount by resource and ring (u). */
export const DELIVERY_AMOUNT: Record<ResourceId, readonly [number, number]> = {
  iron: [30, 90],
  copper: [20, 60],
  ice: [30, 80],
  titanium: [15, 45],
};
/** Mining: how much to mine (u). */
export const MINING_AMOUNT: readonly [number, number] = [25, 70];
/** Delivery destinations: stations within this range (u). */
export const DELIVERY_RANGE = 2600;
/** Rescue: the stranded ship's distance (u) and the fuel it needs. */
export const RESCUE_DISTANCE: readonly [number, number] = [250, 900];
export const RESCUE_FUEL: readonly [number, number] = [12, 30];
/** Survey: the area centre from the station (u), the spread of the 3 points (u). */
export const SURVEY_DISTANCE: readonly [number, number] = [300, 1000];
export const SURVEY_SPREAD: readonly [number, number] = [60, 120];
export const SURVEY_BUOYS = 3;
/** Reach of the F interaction at a survey point / a stranded ship (gap to the ship's hull). */
export const INTERACT_RANGE = 10;
/** Hunt: a pirate group within this distance of the station (u). */
export const HUNT_RANGE = 1800;
/** Fight time per pirate for the duration estimate (s). */
export const HUNT_SECONDS_PER_ENEMY = 75;
/** Reputation per contract: base + per minute of the estimate. */
export const REP_BASE = 12;
export const REP_PER_MINUTE = 2;
/** Share of slips with an exclusive reward (a T2 part) in ring 1 – T2 parts cannot be bought there otherwise. */
export const PART_REWARD_CHANCE = 0.15;
/** Scan: a place (anomaly, giant, wreck) within this distance of the station (u). */
export const SCAN_DISTANCE: readonly [number, number] = [250, 1500];
/** Destroy the fortress: a living fortress within this distance of the station (j) and the fight estimate (s). */
export const FORTRESS_CONTRACT_RANGE = 3200;
export const FORTRESS_FIGHT_SECONDS = 6 * 60;
/** Retrieval: the wreck with the part at this distance (u). */
export const RETRIEVE_DISTANCE: readonly [number, number] = [300, 1100];
/** Parts the Institute wants back (by the ring's tier). */
export const RETRIEVE_PARTS = ['engine', 'cargo', 'reactor', 'radar', 'gyro', 'fuelTank'] as const;
