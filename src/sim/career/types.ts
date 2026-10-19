// The player's "career" state (M3.5a): contracts and station boards, reputation, named captains, the
// courier, the "First Day" onboarding, market demand and a short log. Everything is saved (save V4) – the
// simulation stays deterministic.
import type { ContractRisk, ContractType } from '../../data/contracts';
import type { RingIndex } from '../../data/economy';
import type { RepFactionId, RepLevel } from '../../data/factions';
import type { PartInventory, PartKey } from '../../data/parts';
import type { PlanId } from '../../data/plans';
import type { Cargo, ResourceId } from '../../data/resources';
import type { SectorModifierId } from '../../data/sector';
import type { TrainingStepId } from '../../data/training';
import type { Vec2 } from '../math/vec2';
import type { LaneId } from '../regions/lanes';
import type { TrainingState } from '../training/types';
import type { StationId } from '../world/stations';

export type ContractTarget =
  /** Deliver `amount` of a resource to station `to`. */
  | { kind: 'delivery'; resource: ResourceId; amount: number; to: StationId }
  /** Mine `amount` of a resource (counted from acceptance). */
  | { kind: 'mining'; resource: ResourceId; amount: number }
  /** Destroy a chunk's pirate group (spawn slot ids). */
  | { kind: 'hunt'; cx: number; cy: number; slots: string[]; pos: Vec2 }
  /** Destroy a named captain (position revealed by the contract). */
  | { kind: 'captain'; captain: number; pos: Vec2 }
  /** A stranded ship needs fuel. */
  | { kind: 'rescue'; pos: Vec2; angle: number; fuel: number }
  /** Deploy buoys at the survey points. */
  | { kind: 'survey'; points: Vec2[] }
  /** Scan (M3.5b): analyse a place (an anomaly, a giant asteroid, a wreck). */
  | { kind: 'scan'; poi: string; what: 'wreck' | 'anomaly' | 'giant'; pos: Vec2 }
  /** Retrieval (M3.5b): load a part from a wreck and bring it to a station; the reward includes a blueprint fragment. */
  | { kind: 'retrieve'; pos: Vec2; angle: number; part: PartKey; plan: PlanId }
  /** Destroy a Rust fortress (M3.6). */
  | { kind: 'fortress'; fortress: string; pos: Vec2 }
  /**
   * Chart a sector (sectors stage 2): survey points or flight coverage after acceptance; the reward
   * covers the chart's sale (the sector is marked sold on turn-in). `pos` = the sector anchor, `points`
   * = its survey points; `first` = the "First chart" offer after the Guild Training.
   */
  | { kind: 'chart'; sector: string; pos: Vec2; points: number; first?: true }
  /**
   * Guild relay (M4d §2.2): repair, power and hold the broken Guild relay mast `relay` (`gr:<lane>`) in
   * `sector`; progress = the lane's relay chain stage (`guild.relays`). A pinned offer, never rolled.
   */
  | { kind: 'relay'; lane: LaneId; relay: string; sector: string; pos: Vec2 }
  /**
   * Escort (M4d §2.7): fly with a convoy along the lane stretch from arc `from` to arc `to` (u along the
   * lane's convoy route, out → U-turn → back, so to > from on both legs – convoys/escort.ts), meeting it
   * at `meet`, to `end`; `ambushes` = the arc points of the ambush parties.
   */
  | { kind: 'escort'; lane: LaneId; from: number; to: number; meet: Vec2; end: Vec2; ambushes: number[] };

/** Why a contract failed (M4d escort: the trader destroyed, the escort abandoned, the player destroyed, the meeting missed). */
export type ContractFailReason = 'traderLost' | 'abandoned' | 'playerLost' | 'missed';
export const CONTRACT_FAIL_REASONS: readonly ContractFailReason[] = ['traderLost', 'abandoned', 'playerLost', 'missed'];

/**
 * What a contract hook of `stepContracts` may do to a contract (M4d relay / escort, career.ts): mark it
 * ready (`contractReady`), or fail it (removed, `contractFailed`, journal entry `contractFailed`).
 */
export interface ContractOutcome {
  ready(c: Contract): void;
  fail(c: Contract, reason: ContractFailReason): void;
}

/** A slip on a station board (the reward is computed live and frozen on acceptance). */
export interface ContractOffer {
  /** `<station>@<period>.<index>` */
  id: string;
  type: ContractType;
  faction: RepFactionId;
  /** The station that issued the contract. */
  station: StationId;
  /** Ring of the contract's place. */
  ring: RingIndex;
  risk: ContractRisk;
  target: ContractTarget;
  /** The area's modifiers at issue (the contract inherits them) and their bonus. */
  modifiers: SectorModifierId[];
  bonus: number;
  /** An exclusive reward – a part (T2 in ring 1). */
  part: PartKey | null;
}

/** An accepted contract (the reward frozen). */
export interface Contract extends ContractOffer {
  /** Serial number of the acceptance. */
  serial: number;
  acceptedTick: number;
  /** Duration estimate at acceptance (s). */
  seconds: number;
  reward: number;
  rep: number;
  /** Data for the Archive on hand-in (Institute contracts, M3.5b; missing = 0). */
  data?: number;
  /** Progress: units mined, pirates destroyed, buoys deployed, 1 = fuel delivered. */
  progress: number;
  /** Counter base (mined at acceptance) – Mining. */
  base: number;
  /** Goals met – waiting to be handed in at a station. */
  ready: boolean;
}

export interface BoardState {
  /** The board's epoch (20 game minutes). */
  epoch: number;
  /** The next slip serial (a new slip after a contract is done). */
  serial: number;
  offers: ContractOffer[];
}

export interface RepState {
  points: number;
  level: RepLevel;
  /** Progress of the next level's assignments by option id. */
  assignments: Record<string, number>;
}

/** Mutable state of a named captain (the static data come from the seed). */
export interface CaptainState {
  /** Promotions on top of the base level. */
  promotions: number;
  defeated: boolean;
  /** Replicas of the player's parts the captain shows off (8.4 / 6.4: the player loses nothing). */
  trophies: PartKey[];
  /** How many times he destroyed the player. */
  kills: number;
}

export interface Shipment {
  id: number;
  from: StationId;
  to: StationId;
  resources: Partial<Cargo>;
  parts: PartInventory;
  /** Game tick of the delivery. */
  arrival: number;
}

export type LogEntry =
  | { tick: number; kind: 'contractAccepted' | 'contractCompleted' | 'contractAbandoned' | 'contractFailed'; type: ContractType; station: StationId }
  | { tick: number; kind: 'levelUp'; faction: RepFactionId; level: RepLevel }
  | { tick: number; kind: 'stationDiscovered'; station: StationId }
  | { tick: number; kind: 'captainDefeated' | 'captainPromoted'; captain: number }
  | { tick: number; kind: 'courierDelivered'; station: StationId }
  /** The former "First Day" onboarding (saves before V10; shown as a plain step). */
  | { tick: number; kind: 'firstDayStep'; step: number }
  /** A Guild Training step done (M3.7). */
  | { tick: number; kind: 'trainingStep'; step: TrainingStepId }
  | { tick: number; kind: 'died' };

export interface TrophyEntry {
  captain: number;
  parts: PartKey[];
}

export interface CareerState {
  nextId: number;
  contracts: Contract[];
  boards: Map<StationId, BoardState>;
  rep: Record<RepFactionId, RepState>;
  /** Only captains whose state changed. */
  captains: Map<number, CaptainState>;
  /** A captain in combat: enemy id → HP share in the last step (escaping below 30 % = a promotion). */
  engaged: Map<number, number>;
  shipments: Shipment[];
  /** Guild Training (M3.7) – the onboarding of a new game. */
  training: TrainingState;
  /** Sold within a demand: station → [epoch, amount]. */
  demandSold: Map<StationId, { epoch: number; amount: number }>;
  /** Completed contracts by type. */
  completed: Partial<Record<ContractType, number>>;
  trophies: TrophyEntry[];
  /** The latest events (newest last, at most LOG_MAX). */
  log: LogEntry[];
}

export const LOG_MAX = 12;
