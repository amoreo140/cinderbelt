// Slovak texts of docking as a manoeuvre: the prompt, the approach
// readout, the rejection toasts, the latch and the Archive's docking computer. The shape is the exported
// `DockingTexts` interface; enDocking.ts implements the same keys in English.

export interface DockingTexts {
  /** All three items in tolerance: "F – dock at Anchor station" (the key becomes a keycap). */
  prompt: (station: string) => string;
  /** The approach readout near a dock clamp. */
  readout: {
    /** Stencil label of the band. */
    title: string;
    /** Item labels (stencil). */
    distance: string;
    speed: string;
    /** Units. */
    distanceUnit: string;
    speedUnit: string;
    degree: string;
    /** The limit next to a value: "≤ 4 j". */
    limit: (value: string) => string;
    /** Tag of the band when the docking computer relaxes the rules. */
    computer: string;
    /** What to fix first when an item is out of tolerance. */
    fix: { tooFar: string; tooFast: string };
  };
  /** Toasts after F away from the tolerances (formatted numbers). */
  rejected: {
    tooFar: (distance: string, max: string) => string;
    tooFast: (speed: string, max: string) => string;
    noStation: string;
  };
  /** The hint while the clamp pulls the ship in and turns it to the dock heading. */
  latch: string;
  /** The Archive node "Docking computer". */
  archive: { name: string; effect: string };
}

export const skDocking: DockingTexts = {
  prompt: (station) => `F – pristáť na stanici ${station}`,
  readout: {
    title: 'Dokovanie',
    distance: 'Svorka',
    speed: 'Rýchlosť',
    distanceUnit: 'j',
    speedUnit: 'j/s',
    degree: '°',
    limit: (value) => `≤ ${value}`,
    computer: 'Dokovací počítač',
    fix: {
      tooFar: 'Prileť k dokovacej svorke na konci ramena',
      tooFast: 'Spomaľ',
    },
  },
  rejected: {
    tooFar: (d, max) => `Príliš ďaleko od dokovacej svorky: ${d} j (treba do ${max} j)`,
    tooFast: (v, max) => `Príliš rýchlo na pristátie: ${v} j/s (treba do ${max} j/s)`,
    noStation: 'V okolí nie je žiadna stanica',
  },
  latch: 'Svorka zachytáva loď…',
  archive: {
    name: 'Dokovací počítač',
    effect: 'Pristátie až do 12 j od dokovacej svorky a pri rýchlosti do 6 j/s.',
  },
};
