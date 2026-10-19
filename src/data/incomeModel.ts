// Model of a ship's mining income – a mirror of the econ model constants (tools/econ/econ-model.mjs,
// function trip/income). The contracts' reference income (8.3) is computed from it. A test keeps it in
// line with the model: src/data/econOracle.test.ts.
import type { RingIndex } from './economy';

export interface RingTrip {
  /** Round trip flight (s). */
  travel: number;
  /** Share of time the laser is really mining (searching, manoeuvring). */
  search: number;
  /** Time multiplier for danger. */
  hazard: number;
  /** Operating costs (fuel, repairs) as a share of income. */
  opcost: number;
}

export const RING_TRIP: Record<RingIndex, RingTrip> = {
  1: { travel: 25, search: 0.9, hazard: 1.0, opcost: 0.04 },
  2: { travel: 60, search: 0.45, hazard: 1.15, opcost: 0.08 },
  3: { travel: 80, search: 0.4, hazard: 1.25, opcost: 0.1 },
  4: { travel: 100, search: 0.35, hazard: 1.35, opcost: 0.12 },
};

/** Trip overhead (dock, selling, refuelling) in seconds. */
export const TRIP_OVERHEAD = 40;
/** A human's efficiency against the ideal trip. */
export const HUMAN_EFFICIENCY = 0.75;
/** Average vein bonus at ordinary skill. */
export const VEIN_SKILL = 1.15;
