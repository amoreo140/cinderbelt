// German texts of Mining 2.0 – the same keys as skMining.ts (MiningTexts); the terms follow GLOSSARY-DE.md.
import type { MiningTexts } from './skMining';

export const deMining: MiningTexts = {
  symbols: { iron: 'Fe', copper: 'Cu', ice: 'Eis', titanium: 'Ti' },
  grade: {
    rich: (r) => `Reiches Erz · ${r}`,
    poor: (r) => `Armes Erz · ${r}`,
    plain: (r) => `Erz · ${r}`,
    value: (p) => `Gehalt ${p}`,
    unknown: 'Gehalt ?',
    pulse: 'ein Puls zeigt ihn',
  },
  nugget: {
    title: (a, s) => `Reicher Brocken · ${a} ${s}`,
    towed: 'Erzbrocken',
    pulled: 'Der Traktorstrahl zieht ihn heran',
    how: 'Durchfliegen oder',
    tractor: 'Traktorstrahl',
    fading: (s) => `Weg in ${s} s`,
    broke: (r, p) => `Ein reicher Brocken ist abgebrochen (${r}, ${p}) – flieg hindurch`,
    collected: (a, r) => `Brocken geladen: +${a} ${r}`,
    pop: (a, s) => `+${a} ${s}`,
  },
  assay: {
    rich: (n, best) => `Scanner: ${n === 1 ? '1 reicher Asteroid' : `${n} reiche Asteroiden`} in der Nähe (bester Gehalt ${best})`,
    plain: (best) => `Scanner: kein reiches Erz in der Nähe (bester Gehalt ${best})`,
  },
  map: {
    best: (p) => `bestes Erz ${p}`,
  },
  laserNote:
    'Jeder Laser feuert seinen eigenen Strahl aus seiner eigenen Mündung: Er baut selbstständig innerhalb von ±60° seiner Ausrichtung ab und hat eigene Hitze. Zwei Laser auf demselben Aderabschnitt bauen ihn doppelt so schnell ab.',
  help: {
    lasers: 'Mehr Laser – jeder baut selbst ab (±60°, eigene Hitze)',
    nuggets: 'Erzbrocken – durchfliegen oder T',
  },
};
