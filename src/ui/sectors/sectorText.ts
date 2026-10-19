// Player-facing words of a sector (sectors design):
// the name from its name key (src/sim/regions/sectors.ts keeps indexes only), the security word, the
// threat line and the knowledge glyph – all through `tx().sectors`, read at call time.
import { tx } from '../../i18n';
import type { SectorName } from '../../sim/regions/sectors';
import type { LandmarkKind } from '../../sim/world/landmarks';

const ROMAN: readonly [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** Roman numeral of a positive integer (1 → I, 14 → XIV). */
export function roman(n: number): string {
  let rest = Math.max(1, Math.floor(n));
  let out = '';
  for (const [v, s] of ROMAN) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return out;
}

/** The trailing number of an id like `fort:2` or `crystal_spire:3` (0 when there is none). */
const idIndex = (id: string): number => {
  const m = /:(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
};

/** The player-facing name of a sector. */
export function sectorName(name: SectorName): string {
  const t = tx().sectors;
  switch (name.kind) {
    case 'origin':
      return t.origin;
    case 'corner':
      return name.corner === 1 ? t.corner1 : t.corner2;
    case 'fortress':
      return t.fortress(roman(idIndex(name.fortress) + 1));
    case 'landmark': {
      const list = t.landmarks[name.landmarkKind as LandmarkKind] ?? [];
      const i = idIndex(name.landmark);
      if (list.length === 0) return tx().landmarks.names[name.landmarkKind as LandmarkKind] ?? name.landmark;
      // more landmarks of a kind than hand-made names: the names repeat with a numeral
      const base = list[i % list.length]!;
      const round = Math.floor(i / list.length);
      return round > 0 ? `${base} ${roman(round + 1)}` : base;
    }
    case 'generated': {
      const base = t.generated(name.adjective, name.noun);
      return name.numeral > 0 ? `${base} ${roman(name.numeral + 1)}` : base;
    }
  }
}
