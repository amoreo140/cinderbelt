// M4c T7: the new parts and variants are plain PartKeys –
// templates with them round-trip through whichever codec applies (CB2 with or without shapes).
import { describe, expect, it } from 'vitest';
import { createGrid } from '../ship/grid';
import type { ShipGrid } from '../ship/types';
import { decodeTemplate, encodeTemplate } from './codec';
import { normalizeTemplate, templateProblem } from './normalize';
import type { ShipTemplate } from './types';

function workshopShip(shaped: boolean): ShipGrid {
  const grid = createGrid([
    ['cockpit', 0, 0],
    ['largeReactor', -2, 0],
    ['repairModule', 1, 0],
    ['refinery', 0, 1, 0, 2],
    ['armor', 0, -1, 0, 1, shaped ? 'wedge' : undefined],
    ['cannon', 1, -1],
    ['miningLaser', 2, 0],
  ]);
  grid.parts[4]!.variant = 'light';
  grid.parts[5]!.variant = 'longBarrel';
  grid.parts[6]!.variant = 'focused';
  return grid;
}

describe('templates with the M4c parts and variants', () => {
  for (const [codec, shaped] of [['unshaped', false], ['shaped', true]] as const) {
    it(`${codec}: round trip and a stable re-encode`, () => {
      const t: ShipTemplate = { name: 'Dielňa', parts: normalizeTemplate(workshopShip(shaped))! };
      expect(templateProblem(t.parts)).toBeNull();
      const keys = t.parts.map((p) => p[0]);
      for (const k of ['largeReactor:1', 'repairModule:1', 'refinery:2', 'armor:1:light', 'cannon:1:longBarrel', 'miningLaser:1:focused']) expect(keys).toContain(k);
      const code = encodeTemplate(t);
      expect(code.startsWith('CB2.')).toBe(true);
      const r = decodeTemplate(code);
      expect(r).toEqual({ ok: true, template: t });
      expect(encodeTemplate((r as { template: ShipTemplate }).template)).toBe(code);
    });
  }
});
