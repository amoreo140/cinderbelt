// German texts of docking as a manoeuvre – the same keys as skDocking.ts (DockingTexts); the terms follow GLOSSARY-DE.md.
import type { DockingTexts } from './skDocking';

export const deDocking: DockingTexts = {
  prompt: (station) => `F – an ${station} andocken`,
  readout: {
    title: 'Andocken',
    distance: 'Klammer',
    speed: 'Tempo',
    bow: 'Bug',
    distanceUnit: 'E',
    speedUnit: 'E/s',
    degree: '°',
    limit: (value) => `≤ ${value}`,
    anyHeading: 'beliebig',
    computer: 'Andockcomputer',
    fix: {
      tooFar: 'Flieg zur Andockklammer am Ende des Arms',
      tooFast: 'Abbremsen',
      misaligned: 'Dreh den Bug zur Station',
    },
  },
  rejected: {
    tooFar: (d, max) => `Zu weit von der Andockklammer: ${d} E (höchstens ${max} E)`,
    tooFast: (v, max) => `Zu schnell zum Andocken: ${v} E/s (höchstens ${max} E/s)`,
    misaligned: (deg, max) => `Der Bug zeigt nicht zur Station: ${deg}° daneben (höchstens ${max}°)`,
    noStation: 'Keine Station in der Nähe',
  },
  latch: 'Die Klammer fängt das Schiff…',
  autoApproach: 'Der Andockcomputer fliegt das Schiff zur Klammer…',
  archive: {
    name: 'Andockcomputer',
    effect: 'Andocken bis 12 E von der Andockklammer, mit bis zu 6 E/s und in jeder Ausrichtung – der Computer fliegt das Schiff zur Klammer.',
  },
};
