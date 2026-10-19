// Slovak texts of Mining 2.0: ore grade, rich nuggets, the scanner's ore
// assay, the map and radar marks, the laser note in the part info and the controls help. The shape is
// the exported `MiningTexts` interface; enMining.ts implements the same keys in English.
import type { ResourceId } from '../data/resources';
import { skPlural as plural } from './plural';

export interface MiningTexts {
  /** Short resource symbols for the pickup pop ("+12,5 Fe"). */
  symbols: Record<ResourceId, string>;
  grade: {
    /** Callout titles by class of the rock. */
    rich: (resource: string) => string;
    poor: (resource: string) => string;
    plain: (resource: string) => string;
    /** "Kvalita 145 %". */
    value: (percent: string) => string;
    /** Grade not assayed yet. */
    unknown: string;
    /** Keycap action next to the unknown grade (Tab). */
    pulse: string;
  };
  nugget: {
    /** Callout title of a nugget drifting near the ship. */
    title: (amount: string, symbol: string) => string;
    /** What the tractor beam holds (HUD line). */
    towed: string;
    /** Callout detail while the tractor beam pulls it in. */
    pulled: string;
    /** How to get it: fly through, or the tractor (keycap T). */
    how: string;
    tractor: string;
    /** The nugget is about to be gone. */
    fading: (seconds: number) => string;
    /** Toasts. */
    broke: (resource: string, percent: string) => string;
    collected: (amount: string, resource: string) => string;
    /** The pop next to the cargo gauge. */
    pop: (amount: string, symbol: string) => string;
  };
  assay: {
    /** Pulse toast: rich rocks around and the best grade. */
    rich: (count: number, best: string) => string;
    /** No rich rock around – the best grade. */
    plain: (best: string) => string;
  };
  map: {
    /** Best grade seen in a remembered field. */
    best: (percent: string) => string;
  };
  /** Note in the part info of mining lasers (multiple lasers). */
  laserNote: string;
  /** Lines of the controls help (K), "keys – text". */
  help: { lasers: string; nuggets: string };
}

export const skMining: MiningTexts = {
  symbols: { iron: 'Fe', copper: 'Cu', ice: 'Ľad', titanium: 'Ti' },
  grade: {
    rich: (r) => `Bohatá ruda · ${r}`,
    poor: (r) => `Chudobná ruda · ${r}`,
    plain: (r) => `Ruda · ${r}`,
    value: (p) => `Kvalita ${p}`,
    unknown: 'Kvalita ?',
    pulse: 'pulz odhalí',
  },
  nugget: {
    title: (a, s) => `Bohatý úlomok · ${a} ${s}`,
    towed: 'Úlomok rudy',
    pulled: 'Vlečný lúč ho ťahá k lodi',
    how: 'Preleť cez neho alebo',
    tractor: 'vlečný lúč',
    fading: (s) => `Zmizne o ${s} s`,
    broke: (r, p) => `Odlomil sa bohatý úlomok (${r}, ${p}) – preleť cez neho`,
    collected: (a, r) => `Úlomok naložený: +${a} ${r}`,
    pop: (a, s) => `+${a} ${s}`,
  },
  assay: {
    rich: (n, best) => `Skener: ${n} ${plural(n, 'bohatý kameň', 'bohaté kamene', 'bohatých kameňov')} v okolí (najlepší ${best})`,
    plain: (best) => `Skener: bez bohatej rudy v okolí (najlepšia ${best})`,
  },
  map: {
    best: (p) => `najlepšia ruda ${p}`,
  },
  laserNote:
    'Každý laser má vlastný lúč z vlastného ústia: ťaží sám v oblúku ±60° od smeru, kam je otočený, a má vlastné teplo. Dva lasery na tom istom úseku žily ho posúvajú 2× rýchlejšie.',
  help: {
    lasers: 'Viac laserov – každý ťaží sám (±60°, vlastné teplo)',
    nuggets: 'Úlomok rudy – preleť cez neho alebo T',
  },
};
