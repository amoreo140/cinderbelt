// English texts of docking as a manoeuvre – the same keys as skDocking.ts (DockingTexts), ready for the
// English locale.
import type { DockingTexts } from './skDocking';

export const enDocking: DockingTexts = {
  prompt: (station) => `F – dock at ${station}`,
  readout: {
    title: 'Docking',
    distance: 'Clamp',
    speed: 'Speed',
    bow: 'Bow',
    distanceUnit: 'u',
    speedUnit: 'u/s',
    degree: '°',
    limit: (value) => `≤ ${value}`,
    anyHeading: 'any',
    computer: 'Docking computer',
    fix: {
      tooFar: 'Fly to the dock clamp at the end of the arm',
      tooFast: 'Slow down',
      misaligned: 'Turn the bow to the station',
    },
  },
  rejected: {
    tooFar: (d, max) => `Too far from the dock clamp: ${d} u (${max} u at most)`,
    tooFast: (v, max) => `Too fast to dock: ${v} u/s (${max} u/s at most)`,
    misaligned: (deg, max) => `The bow does not point at the station: ${deg}° off (${max}° at most)`,
    noStation: 'No station nearby',
  },
  latch: 'The clamp is catching the ship…',
  autoApproach: 'The docking computer flies the ship to the clamp…',
  archive: {
    name: 'Docking computer',
    effect: 'Dock within 12 u of the dock clamp, at up to 6 u/s and at any heading – the computer flies the ship to the clamp.',
  },
};
