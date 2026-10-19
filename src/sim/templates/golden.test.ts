// Golden AF1 codes (SL2 E2 S7): recorded before the AF2 codec and the CB2 prefix existed. The game no longer
// writes them, but players keep such codes: they must keep decoding to exactly these templates – never regenerate them.
import { describe, expect, it } from 'vitest';
import { createStarterShip } from '../ship/presets';
import { decodeTemplate, encodeTemplate } from './codec';
import { HANGAR_TEMPLATES } from './golden.testing';
import { normalizeTemplate } from './normalize';
import { randomShip } from './testShips';
import type { ShipTemplate } from './types';

const STARTER_CODE =
  'AF1.eyJ2IjoxLCJuIjoixaRhxb5pYXIgw4QiLCJwIjpbWyJjYXJnbzoxIiwtMSwtMSwwXSxbImNhcmdvOjEiLC0xLDEsMF0sWyJjb2NrcGl0OjEiLDAsMCwwXSxbImVuZ2luZToxIiwtMiwtMSwwXSxbImVuZ2luZToxIiwtMiwxLDBdLFsiZW5naW5lOjEiLC0xLC0yLDFdLFsiZW5naW5lOjEiLC0xLDIsM10sWyJlbmdpbmU6MSIsMSwtMSwyXSxbImVuZ2luZToxIiwxLDEsMl0sWyJmdWVsVGFuazoxIiwwLDEsMF0sWyJneXJvOjEiLC0xLDAsMF0sWyJtaW5pbmdMYXNlcjoxIiwxLDAsMF0sWyJyYWRhcjoxIiwwLC0xLDBdLFsicmVhY3RvcjoxIiwtMiwwLDBdXX0.5f8b';

const HANGAR_CODES = [
  'AF1.eyJ2IjoxLCJuIjoiQmFuw61rIiwicCI6W1siYXJtb3I6MSIsLTIsMiwwXSxbImFybW9yOjEiLDAsMiwwXSxbImNhbm5vbjoxIiwtMywyLDBdLFsiY2Fubm9uOjEiLC0yLDMsMF0sWyJjYXJnbzoxIiwtMywzLDBdLFsiY2FyZ286MSIsLTEsMCwwXSxbImNhcmdvOjEiLDAsLTIsMF0sWyJjYXJnbzoxIiwwLDEsMF0sWyJjYXJnbzoxIiwxLC0yLDBdLFsiY29ja3BpdDoyIiwwLDAsMF0sWyJlbmdpbmU6MSIsLTMsMCwwXSxbImVuZ2luZToxIiwtMywxLDBdLFsiZW5naW5lOjEiLC0xLC0xLDFdLFsiZW5naW5lOjEiLC0xLDEsM10sWyJlbmdpbmU6MSIsMSwtMSwyXSxbImVuZ2luZToxIiwxLDEsMl0sWyJmdWVsVGFuazoxIiwtMiwwLDBdLFsiZnVlbFRhbms6MSIsMCwzLDBdLFsiZ3lybzoxIiwtMiwxLDBdLFsibWluaW5nTGFzZXI6MiIsMSwwLDBdLFsibWluaW5nTGFzZXI6MiIsMiwtMiwwXSxbIm1pbmluZ0xhc2VyOjIiLDIsMiwwXSxbIm1pbmluZ0xhc2VyOjIiLDIsMywwXSxbInJhZGFyOjEiLC0yLC0xLDBdLFsicmVhY3RvcjoxIiwtMiwtMiwwXSxbInJlYWN0b3I6MiIsMCwtMSwwXSxbInJlYWN0b3I6MiIsMSwyLDBdLFsicmVhY3RvcjoyIiwxLDMsMF0sWyJzaGllbGQ6MSIsLTMsLTEsMF1dfQ.f19f',
  'AF1.eyJ2IjoxLCJuIjoiU3TDrWhhxI0iLCJwIjpbWyJhcm1vcjoyIiwxLDAsMF0sWyJjYW5ub246MiIsMSwtMSwwXSxbImNhbm5vbjoyIiwxLDEsMF0sWyJjb2NrcGl0OjIiLDAsMCwwXSxbImVuZ2luZToxIiwwLC0yLDFdLFsiZW5naW5lOjEiLDAsMiwzXSxbImVuZ2luZToxIiwxLC0yLDJdLFsiZW5naW5lOjEiLDEsMiwyXSxbImVuZ2luZToyIiwtMiwtMSwwXSxbImVuZ2luZToyIiwtMiwwLDBdLFsiZW5naW5lOjIiLC0yLDEsMF0sWyJmdWVsVGFuazoxIiwtMSwtMSwwXSxbImd5cm86MSIsLTEsMCwwXSxbInJlYWN0b3I6MiIsMCwtMSwwXSxbInJlYWN0b3I6MiIsMCwxLDBdLFsic2hpZWxkOjIiLC0xLDEsMF1dfQ.4ccf',
  'AF1.eyJ2IjoxLCJuIjoixaB0YXJ0w6lyIiwicCI6W1siY2FyZ286MSIsLTEsLTEsMF0sWyJjYXJnbzoxIiwtMSwxLDBdLFsiY29ja3BpdDoxIiwwLDAsMF0sWyJlbmdpbmU6MSIsLTIsLTEsMF0sWyJlbmdpbmU6MSIsLTIsMSwwXSxbImVuZ2luZToxIiwtMSwtMiwxXSxbImVuZ2luZToxIiwtMSwyLDNdLFsiZW5naW5lOjEiLDEsLTEsMl0sWyJlbmdpbmU6MSIsMSwxLDJdLFsiZnVlbFRhbms6MSIsMCwxLDBdLFsiZ3lybzoxIiwtMSwwLDBdLFsibWluaW5nTGFzZXI6MSIsMSwwLDBdLFsicmFkYXI6MSIsMCwtMSwwXSxbInJlYWN0b3I6MSIsLTIsMCwwXV19.7f40',
];

/** Random ships 1–3 (the first three of the 300 below). */
const RANDOM_FIRST = [
  'AF1.eyJ2IjoxLCJuIjoiTG_EjyAxIiwicCI6W1siY29ja3BpdDoxOnNjb3V0IiwwLDAsM10sWyJmdWVsVGFuazoyIiwwLC0xLDFdXX0.d7de',
  'AF1.eyJ2IjoxLCJuIjoiTG_EjyAyIiwicCI6W1siY29ja3BpdDoyOmNvbWJhdCIsMCwwLDJdLFsiZnVlbFRhbms6MTpleHRlbmRlZCIsMSwxLDBdLFsicmVhY3RvcjoyIiwwLDEsMV1dfQ.9d19',
  'AF1.eyJ2IjoxLCJuIjoiTG_EjyAzIiwicCI6W1siY2Fubm9uOjEiLDAsMSwwXSxbImNvY2twaXQ6Mjpjb21iYXQiLDAsMCwwXV19.f809',
];
const randomTemplate = (seed: number): ShipTemplate => ({ name: `Loď ${seed}`, parts: normalizeTemplate(randomShip(seed, 1 + (seed % 60)))! });

describe('golden AF1 codes (templates without shapes, now read only)', () => {
  it('the starter ship', () => {
    const template = { name: 'Ťažiar Ä', parts: normalizeTemplate(createStarterShip())! };
    expect(decodeTemplate(STARTER_CODE)).toEqual({ ok: true, template });
    expect(encodeTemplate(template)).toMatch(/^CB2\./);
  });

  it('the hangar fixture templates', () => {
    for (const [i, code] of HANGAR_CODES.entries()) expect(decodeTemplate(code)).toEqual({ ok: true, template: HANGAR_TEMPLATES[i] });
  });

  it('random ships: the old code and the new CB2 code decode to the same template', () => {
    for (const [i, code] of RANDOM_FIRST.entries()) {
      const template = randomTemplate(i + 1);
      expect(decodeTemplate(code)).toEqual({ ok: true, template });
      expect(decodeTemplate(encodeTemplate(template))).toEqual({ ok: true, template });
    }
  });
});
