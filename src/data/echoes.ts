// Forge-smith Echoes (long-term design 5.7.2): the first story milestones as data. The gates are rules
// of the world, not passwords: the player finds Echo-0 by triangulation (a scanner skill), Echo-1 sounds only
// with the frequency decoder (Archive, a hidden node revealed by the Echo-0 log) and Echo-2 stays silent until the ship
// carries a glowing Forge-smith shard, the kind pirates collect (the rule "shards resonate with Echoes").
import type { RingIndex } from './economy';

export type EchoIndex = 0 | 1 | 2;
export const ECHO_INDICES: readonly EchoIndex[] = [0, 1, 2];

/** What the scanner needs to hear the Echo. */
export type EchoGate = 'none' | 'decoder' | 'shard';

export interface EchoDef {
  index: EchoIndex;
  ring: RingIndex;
  /** Distance from home (u) and the bearing offset from the Echo-0 direction (rad, ± from the seed). */
  distance: number;
  spread: number;
  /** A pulse picks up the Echo within this distance (u). */
  hearRange: number;
  gate: EchoGate;
}

export const ECHOES: readonly [EchoDef, EchoDef, EchoDef] = [
  { index: 0, ring: 1, distance: 950, spread: 0, hearRange: 2600, gate: 'none' },
  { index: 1, ring: 2, distance: 2350, spread: 0.45, hearRange: 3000, gate: 'decoder' },
  { index: 2, ring: 2, distance: 3300, spread: 0.6, hearRange: 3000, gate: 'shard' },
];

/** Echo triangulation: this many pulses from different places (at least `ECHO_BASELINE` apart). */
export const ECHO_FIXES = 3;
export const ECHO_BASELINE = 150;
/** Radius of the Echo's uncertainty circle after the first pulse (u); each further place shrinks it. */
export const ECHO_FIRST_RADIUS = 500;
/** Echo analysis (hold Tab) from this distance – the beacon is large. */
export const ECHO_RADIUS = 9;

/** Key items (6.6) – never lost, not part of the cargo. */
export type KeyItemId = 'shard' | 'resonator';
/** shard = glowing Forge-smith shard (Echo-2); resonator = Resonator from the Rust fortress (5.7.2, M3.6). */
export const KEY_ITEMS: readonly KeyItemId[] = ['shard', 'resonator'];
