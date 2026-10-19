// Sector charts as a commodity (sectors design §4.2, stage 2): prices of the Cartography section of a
// station Board. Prices are hours of the ring's minimum reference income (MIN_REFERENCE_INCOME, by the
// sector's depth), rounded to 50 cr (a half down): sell = h × income × security × size, buy = 0.02 h ×
// income (250 / 450 / 1 700 cr). Credits only – Data are never bought or sold (§3.2.2). Depth 4+ charts
// are in the outlook (no trade).
//
// Sale price: the design's 0.025 h (300 / 550 / 2 100 cr) is HALVED to 0.0125 h (150 / 250 / 1 050 cr for
// an average Contested sector) by the rule of §6.4 – the econ model (tools/econ/econ-model.mjs,
// CHART_SALE) with the design's charting tempo showed P2 income +15 % while sectors last and the first
// milestones up to −11 % (weapons 36 → 32 min) at the full price; halved: P2 +7 %, milestones −3 … −6 %.
import type { Security } from '../sim/regions/constants';

export const CHART_PRICES = {
  /** Hours of the reference income a sold chart pays (the design's 0.025 halved, see the header). */
  sellHours: 0.0125,
  /** Hours of the reference income a bought chart costs. */
  buyHours: 0.02,
  /** Security multiplier of a sold chart (Quiet and Contested ×1, Pirate ×1.5; Guarded is never sold). */
  security: { quiet: 1, guarded: 1, contested: 1, pirate: 1.5 } as Readonly<Record<Security, number>>,
  /** Size multiplier = sector area / the average area of its depth, clamped. */
  size: [0.7, 1.3] as readonly [number, number],
  /** Prices are rounded to this (cr). */
  round: 50,
  /** Deepest depth with a chart trade (depth 4+ is in the outlook, §4.4). */
  maxDepth: 3,
} as const;

/** A `chart` contract (§4.3): sectors within this distance of the issuing station (u, sector anchor). */
export const CHART_CONTRACT_RANGE = 2600;
/** Duration estimate of a `chart` contract per survey point (fly between points, pulse; s). */
export const CHART_SECONDS_PER_POINT = 40;
