// Scanner (long-term design 5.4): a pulse (tap Tab) reveals signals, analysis (hold Tab on an object)
// gives Data, a journal entry and the wreck's contents. The numbers are here, the logic in src/sim/discovery/scanner.ts.

export const SCANNER = {
  /** Pulse: energy and charge time (s). */
  pulseEnergy: 15,
  pulseCooldown: 8,
  /** Dosah pulzu = dosah radaru × toto. */
  pulseRangeMult: 3,
  /** Tap = released before this (s); holding longer starts the analysis. */
  tapSeconds: 0.3,
  /** Analysis lasts from the press (s) and costs energy (on start). */
  analyzeSeconds: 2,
  analyzeEnergy: 10,
  /** Analysis target: an object within this distance of the cursor (u, beyond the object's radius). */
  aimSlack: 30,
  /** Uncertainty circle of a signal = distance × this (min / max). */
  signalRadiusFactor: 0.15,
  signalRadiusMin: 15,
  signalRadiusMax: 300,
  /** A signal (the question mark) disappears from the HUD and map after this time without a new pulse (s). */
  signalSeconds: 4 * 60,
  /** How often it is checked whether POIs are within radar range (steps). */
  discoverInterval: 30,
} as const;
