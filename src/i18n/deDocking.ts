// German texts of docking as a manoeuvre – the same keys as skDocking.ts (DockingTexts); the terms follow GLOSSARY-DE.md.
import type { DockingTexts } from './skDocking';

export const deDocking: DockingTexts = {
  prompt: (station) => `F – an ${station} andocken`,
  readout: {
    title: 'Andocken',
    distance: 'Klammer',
    speed: 'Tempo',
    distanceUnit: 'E',
    speedUnit: 'E/s',
    degree: '°',
    limit: (value) => `≤ ${value}`,
    computer: 'Andockcomputer',
    fix: {
      tooFar: 'Flieg zur Andockklammer am Ende des Arms',
      tooFast: 'Abbremsen',
    },
  },
  rejected: {
    tooFar: (d, max) => `Zu weit von der Andockklammer: ${d} E (höchstens ${max} E)`,
    tooFast: (v, max) => `Zu schnell zum Andocken: ${v} E/s (höchstens ${max} E/s)`,
    noStation: 'Keine Station in der Nähe',
  },
  latch: 'Die Klammer fängt das Schiff…',
  archive: {
    name: 'Andockcomputer',
    effect: 'Andocken aus bis zu 12 E Entfernung von der Andockklammer und mit bis zu 6 E/s.',
  },
};
