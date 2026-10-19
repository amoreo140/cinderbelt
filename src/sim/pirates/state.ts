// Pirate state of the simulation (M3.6): attention, toll demand, hunting party, raid / clan challenge
// and fortress damage. Everything is saved (save V6) – the simulation stays deterministic.
import type { Vec2 } from '../math/vec2';
import type { StationId } from '../world/stations';

export interface Toll {
  /** Group key (`pr:cx,cy`). */
  group: string;
  amount: number;
  /** Tick when the pirates stop waiting and attack. */
  until: number;
}

export type RaidKind = 'raid' | 'challenge';

export interface Raid {
  serial: number;
  kind: RaidKind;
  /** Where the fleet comes. */
  pos: Vec2;
  /** Target station of a raid, or null. */
  station: StationId | null;
  /** Beacon of a clan challenge, or null. */
  beacon: string | null;
  /** Named captain leading the fleet, or null (a nameless flagship). */
  captain: number | null;
  /** Ship count (flagship + escorts). */
  ships: number;
  /** Tick when the fleet arrives; it leaves at `ends`. */
  arrive: number;
  ends: number;
  /** Fleet already spawned in combat. */
  spawned: boolean;
}

export interface FortressState {
  core: number;
  /** HP of the shield generators and turrets (0 = destroyed). */
  gens: number[];
  turrets: number[];
  /** Tick of destruction (rebuilt after FORTRESS.rebuildTicks), or null. */
  destroyed: number | null;
  /** Times destroyed (the first kill gives the Resonator and the full reward). */
  kills: number;
  /** Tick of the next reinforcement and the serial of reinforcement ids. */
  reinforce: number;
  spawned: number;
  /** Ticks until each turret fires again. */
  cooldowns: number[];
}

export interface PirateState {
  /** 0–100. */
  attention: number;
  /** Chunk of the ship in the previous step (`cx,cy`), null when docked. */
  chunk: string | null;
  /** Tick of the last hunting party. */
  lastHunt: number;
  /** Serial for raid and hunting party ids. */
  serial: number;
  raid: Raid | null;
  toll: Toll | null;
  /** Group → tick until which it does not hail again (paid, refused or escaped). */
  tolled: Map<string, number>;
  /** Group → tick until which a paid toll keeps it calm (I1: saved; a hit ends it, I2). */
  paid: Map<string, number>;
  /** Only touched fortresses (missing = intact). */
  fortresses: Map<string, FortressState>;
  /** Beacon → tick from which it can be used again. */
  beacons: Map<string, number>;
}

export function createPirates(): PirateState {
  return {
    attention: 0,
    chunk: null,
    lastHunt: -1_000_000_000,
    serial: 1,
    raid: null,
    toll: null,
    tolled: new Map(),
    paid: new Map(),
    fortresses: new Map(),
    beacons: new Map(),
  };
}
