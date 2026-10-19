// M4d "Guild and trade" – convoys of the Free Traders on the Guild Lanes, their trade
// and the escort contract (M4d plan §2.5–§2.7, §3).
// Every number lives here – the logic is in src/sim/convoys. The values are the starting tune; the
// econ/bot task (T16) may retune them within ±30 % and reports it.
//
// User decisions 2026-10-16: no friendly fire (convoys cannot be hit by the player, so a pass's trade is
// never closed by a shot); convoys as proposed (3 rare items per pass, cargo sale 0.9 × max 200 u,
// tanker fuel 1.5 ×, schedule on the map).
import type { RingIndex } from './economy';

/** Salt of the convoy stream: fnv1a32("m4convoy"). Composition per pass: hash3(seed ^ salt, lane, n). */
export const CONVOY_SALT = 0xca69_7eda;
/** Salt of the escort contract stream: fnv1a32("m4escort"). */
export const ESCORT_SALT = 0x72db_cb0c;

export type ConvoyShipKind = 'trader' | 'tanker' | 'cutter';
export const CONVOY_SHIP_KINDS: readonly ConvoyShipKind[] = ['trader', 'tanker', 'cutter'];

const TICKS = 60;

export const CONVOY = {
  /** Cruise speed along the lane (u/s). */
  speed: 10,
  /** A departure per lane every 25 game minutes; lane B is offset by half a period. */
  periodTicks: 25 * 60 * TICKS,
  laneOffsetTicks: { A: 0, B: (25 * 60 * TICKS) / 2 } as const,
  /** The route starts this far past home along the lane (u). */
  startOffset: 320,
  /** Turn-around at the lane end (s). */
  turnSeconds: 60,
  /** The route is the lane centre line offset this far to the right of the direction of travel (u). */
  side: 20,
  tankerChance: 0.5,
  /** The tanker flies this far behind the trader (u) – the hulls need ≥ 14.3 u (art collision circles). */
  tankerGap: 16,
  /** A cosmetic Guild cutter escort (a plain convoy ship in M4d, not a Watch ship). */
  escortChance: 0.3,
  /** The cosmetic cutter flies this far ahead of the trader and off to the left (u). */
  escortAhead: 18,
  escortSide: 12,
  /** Link: the trade port within this distance of the ship's hull (u)… */
  linkRange: 4,
  /** …at most this relative speed (u/s)… */
  linkSpeed: 2.5,
  /** …and no pirate within this distance (u; also the auto-unlink radius). */
  linkPirateRadius: 300,
  /** Flyby warning: a pass within this distance of the flying player (u)… */
  flybyRadius: 1500,
  /** …in the next this many seconds. */
  flybyLead: 120,
  /** Rare items per pass (slot 0 fragment, slot 1 variant part, slot 2 T2 part in ring 1 / a second variant). */
  slots: 3,
  /** Plan fragment price by the ring at the trader (kr). */
  fragmentPrice: { 1: 1200, 2: 2000, 3: 3000 } as Readonly<Record<1 | 2 | 3, number>>,
  /** Parts cost this multiple of the market price. */
  rareMarkup: 1.2,
  /** Cargo sale at this multiple of the ring's station sale price (jitter 1.0, never the demand bonus). */
  sellMult: 0.9,
  /** At most this many units of cargo per pass (all resources together). */
  buyCap: 200,
  /** Tanker fuel at this multiple of the ring's fuel price, at most `fuelCap` units per pass. */
  fuelMult: 1.5,
  fuelCap: 60,
} as const;

/** Rings convoys fly (the lanes cover rings 1–3; a ring-4 position quotes ring 3). */
export const CONVOY_RINGS: readonly RingIndex[] = [1, 2, 3];

/** A collision circle in a convoy ship's local frame: x = glTF X (bow), y = −glTF Z (left / port positive). */
export interface ConvoyCircle {
  x: number;
  y: number;
  r: number;
}

export interface ConvoyShape {
  circles: readonly ConvoyCircle[];
  /** Bounding radius of the circles around the origin (u). */
  radius: number;
  /** The trader's `trade_port` node (port side); a linked ship sits at tradePort + its bounding radius along +y. */
  tradePort?: { x: number; y: number };
}

const shape = (circles: readonly ConvoyCircle[], tradePort?: { x: number; y: number }): ConvoyShape => ({
  circles,
  radius: Math.max(...circles.map((c) => Math.hypot(c.x, c.y) + c.r)),
  ...(tradePort ? { tradePort } : {}),
});

/**
 * Convoy ship circles, copied from the art export `public/assets/models/npc/npc_ships.json` → `collision`
 * (art commit 851e08c; src/data/convoys.test.ts guards the copy). The cutter is the Watch cutter's circle.
 */
export const CONVOY_SHAPES: Readonly<Record<ConvoyShipKind, ConvoyShape>> = {
  trader: shape(
    [
      { x: -5.5, y: 0, r: 2.9 },
      { x: -2.4, y: 0, r: 2.75 },
      { x: 0.4, y: 0, r: 2.75 },
      { x: 2.5, y: -1.35, r: 1.5 },
      { x: 4.3, y: 0, r: 1.4 },
      { x: 5.7, y: 0, r: 1.4 },
    ],
    { x: 4.5, y: 1.5 },
  ),
  tanker: shape([
    { x: -4.4, y: 0, r: 1.85 },
    { x: -2.75, y: 0, r: 1.45 },
    { x: -0.25, y: 0, r: 1.5 },
    { x: 2.75, y: 0, r: 1.5 },
    { x: 4.8, y: 0, r: 1.05 },
  ]),
  cutter: shape([{ x: 0, y: 0, r: 3.6 }]),
};

/** The escort contract (§2.7). */
export const ESCORT = {
  /** Offered only at stations within this distance of a lane (u). */
  offerRange: 600,
  /** Length of the escorted lane stretch (u). */
  segment: [2000, 4000] as readonly [number, number],
  /** Ambush parties spawn this far off the lane, ahead of the convoy (u), at points this far apart (u). */
  ambushDistance: 300,
  ambushSpacing: 600,
  /** The convoy stops while a pirate is within this distance (u) and resumes this long after (s). */
  stopRadius: 250,
  resumeSeconds: 5,
  /** Failure `abandoned`: the player farther than this from the departed convoy (u) for this long (s). */
  awayRadius: 800,
  awaySeconds: 60,
  /** The convoy waits at the meeting point this long after acceptance (s), departs when the player is this close (u). */
  waitSeconds: 600,
  departRadius: 150,
  /** Escort cruise speed (u/s); after success it flies on this long and despawns (s). */
  speed: 10,
  flyOnSeconds: 20,
  /** Deposit taken on acceptance (share of the frozen reward; refunded by a free cancel). */
  deposit: 0.1,
  tankerChance: 0.5,
  /**
   * Hull of the escorted ships (no shields). The ambushers fire at the trader alone: a 2–3 ship party takes
   * ~20 hull/s off it, and the P2 ship (2 T1 cannons) needs 1–4 min per party – the plan's 400 / 300 was
   * lost in ~20 s. 2 000 lets a P2 escort through both risk levels (T6 fairness, convoys/escort.test.ts: a
   * plain test pilot let the trader take ≤ 1 300 at risk 0.5 over 20 seeds, ~2 000 once against a depth-3
   * Gunner leader). The tanker only takes stray hits.
   */
  traderHull: 2000,
  tankerHull: 600,
} as const;
