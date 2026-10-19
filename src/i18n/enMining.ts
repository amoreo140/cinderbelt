// English texts of Mining 2.0 – the same keys as skMining.ts (MiningTexts), ready for the English locale.
import type { MiningTexts } from './skMining';

export const enMining: MiningTexts = {
  symbols: { iron: 'Fe', copper: 'Cu', ice: 'Ice', titanium: 'Ti' },
  grade: {
    rich: (r) => `Rich ore · ${r}`,
    poor: (r) => `Poor ore · ${r}`,
    plain: (r) => `Ore · ${r}`,
    value: (p) => `Grade ${p}`,
    unknown: 'Grade ?',
    pulse: 'a pulse reveals it',
  },
  nugget: {
    title: (a, s) => `Rich nugget · ${a} ${s}`,
    towed: 'Ore nugget',
    pulled: 'The tractor beam pulls it in',
    how: 'Fly through it or',
    tractor: 'tractor beam',
    fading: (s) => `Gone in ${s} s`,
    broke: (r, p) => `A rich nugget broke off (${r}, ${p}) – fly through it`,
    collected: (a, r) => `Nugget loaded: +${a} ${r}`,
    pop: (a, s) => `+${a} ${s}`,
  },
  assay: {
    rich: (n, best) => `Scanner: ${n === 1 ? '1 rich rock' : `${n} rich rocks`} nearby (best ${best})`,
    plain: (best) => `Scanner: no rich ore nearby (best ${best})`,
  },
  map: {
    best: (p) => `best ore ${p}`,
  },
  laserNote:
    'Every laser fires its own beam from its own muzzle: it mines on its own within ±60° of where it faces and has its own heat. Two lasers on the same vein segment push it twice as fast.',
  help: {
    lasers: 'More lasers – each mines on its own (±60°, own heat)',
    nuggets: 'Ore nugget – fly through it or T',
  },
};
