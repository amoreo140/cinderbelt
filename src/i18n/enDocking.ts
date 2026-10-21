// English texts of docking as a manoeuvre – the same keys as skDocking.ts (DockingTexts), ready for the
// English locale.
import type { DockingTexts } from './skDocking';

export const enDocking: DockingTexts = {
  prompt: (station) => `F – dock at ${station}`,
  readout: {
    title: 'Docking',
    distance: 'Clamp',
    speed: 'Speed',
    distanceUnit: 'u',
    speedUnit: 'u/s',
    degree: '°',
    limit: (value) => `≤ ${value}`,
    computer: 'Docking computer',
    fix: {
      tooFar: 'Fly to the dock clamp at the end of the arm',
      tooFast: 'Slow down',
    },
  },
  rejected: {
    tooFar: (d, max) => `Too far from the dock clamp: ${d} u (${max} u at most)`,
    tooFast: (v, max) => `Too fast to dock: ${v} u/s (${max} u/s at most)`,
    noStation: 'No station nearby',
  },
  latch: 'The clamp is catching the ship…',
  archive: {
    name: 'Docking computer',
    effect: 'Dock from up to 12 u away from the dock clamp and at up to 6 u/s.',
  },
};
