// Pirate events of M3.6: scavenger, attention, toll, clan challenge, raids and the fortress.
import type { ShipRef } from '../combat/types';
import type { Vec2 } from '../math/vec2';
import type { StationId } from '../world/stations';
import type { RaidKind } from './state';

export type FortressPart = 'turret' | 'generator';

export type PirateEvent =
  /** A scavenger stole loot (fromPlayer = the object the player was towing). */
  | { type: 'scavengerStole'; ref: ShipRef; pos: Vec2; what: 'wreck' | 'container'; fromPlayer: boolean }
  /** Attention crossed a level threshold (0–3). */
  | { type: 'attentionLevel'; level: 0 | 1 | 2 | 3; attention: number }
  | { type: 'tollDemanded'; group: string; amount: number; until: number; pos: Vec2 }
  | { type: 'tollPaid'; group: string; amount: number }
  | { type: 'tollRefused'; group: string; timeout: boolean }
  | { type: 'tollEscaped'; group: string }
  | { type: 'tollFailed'; reason: 'credits' | 'none' }
  | { type: 'huntingParty'; captain: number | null; pos: Vec2 }
  | { type: 'raidAnnounced'; serial: number; kind: RaidKind; pos: Vec2; station: StationId | null; captain: number | null; ships: number; arrive: number }
  | { type: 'raidArrived'; serial: number; pos: Vec2 }
  | { type: 'raidDefeated'; serial: number; credits: number; pos: Vec2 }
  | { type: 'raidEnded'; serial: number }
  | { type: 'challengeIssued'; beacon: string; pos: Vec2 }
  | { type: 'challengeRefused'; reason: 'raidActive' | 'cooldown' }
  // --- fortress (6.5) ---
  | { type: 'fortressPartDestroyed'; fortress: string; part: FortressPart; index: number; pos: Vec2 }
  | { type: 'fortressShieldDown'; fortress: string; pos: Vec2 }
  | { type: 'fortressReinforcements'; fortress: string; count: number; pos: Vec2 }
  | { type: 'fortressDestroyed'; fortress: string; pos: Vec2; credits: number; first: boolean }
  | { type: 'fortressRebuilt'; fortress: string };
