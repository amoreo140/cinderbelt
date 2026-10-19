import { describe, expect, it } from 'vitest';
import { TEMPLATE_CODE_MAX } from '../../data/fleet';
import { createRng } from '../math/rng';
import { createStarterShip } from '../ship/presets';
import { base64UrlDecode, base64UrlEncode, decodeTemplate, encodeTemplate, templateChecksum } from './codec';
import { normalizeParts, normalizeTemplate, templateProblem } from './normalize';
import { randomShip } from './testShips';
import type { ShipTemplate, TemplatePart } from './types';

const starter: ShipTemplate = { name: 'Ťažiar Ä', parts: normalizeTemplate(createStarterShip())! };

/** A code with any payload (correct checksum) – for testing what comes after the checksum. */
function codeOf(data: unknown, raw?: string): string {
  const payload = base64UrlEncode(new TextEncoder().encode(raw ?? JSON.stringify(data)));
  return `AF1.${payload}.${templateChecksum(payload)}`;
}
const err = (code: unknown) => {
  const r = decodeTemplate(code);
  return r.ok ? 'ok' : r.error;
};

describe('base64url', () => {
  it('round-trips every length and byte value, no padding, URL-safe alphabet', () => {
    const rng = createRng(3);
    for (let len = 0; len < 70; len++) {
      const bytes = Uint8Array.from({ length: len }, () => Math.floor(rng() * 256));
      const text = base64UrlEncode(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(base64UrlDecode(text)).toEqual(bytes);
    }
    expect(base64UrlEncode(Uint8Array.from([0xfb, 0xff]))).toBe('-_8');
  });

  it('rejects foreign characters, impossible lengths and non-canonical tails', () => {
    expect(base64UrlDecode('ab+c')).toBeNull();
    expect(base64UrlDecode('abcde')).toBeNull();
    expect(base64UrlDecode('-_9')).toBeNull(); // the unused low bits must be zero
  });
});

describe('encodeTemplate / decodeTemplate', () => {
  it('has the CB2.<payload>.<4 hex> shape and decodes back', () => {
    const code = encodeTemplate(starter);
    expect(code).toMatch(/^CB2\.[A-Za-z0-9_-]+\.[0-9a-f]{4}$/);
    expect(decodeTemplate(code)).toEqual({ ok: true, template: starter });
  });

  it('round-trips random ships (property) and normalises what it encodes', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const parts = normalizeTemplate(randomShip(seed, 1 + (seed % 60)))!;
      const t: ShipTemplate = { name: `Loď ${seed}`, parts };
      const code = encodeTemplate(t);
      expect(code.length, `seed ${seed}`).toBeLessThanOrEqual(TEMPLATE_CODE_MAX);
      expect(decodeTemplate(code), `seed ${seed}`).toEqual({ ok: true, template: t });
      expect(encodeTemplate((decodeTemplate(code) as { template: ShipTemplate }).template)).toBe(code);
    }
  });

  it('a large ship without shapes fits in the code', () => {
    // a 9 × 9 block (81 parts – more than a T2 cockpit's hull budget allows) of the longest keys
    const parts: TemplatePart[] = [];
    for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) parts.push(x === 0 && y === 0 ? ['cockpit:2:combat', 0, 0, 0] : ['fuelTank:2:extended', x, y, 3]);
    const t: ShipTemplate = { name: 'Ž'.repeat(24), parts: normalizeParts(parts)! };
    const code = encodeTemplate(t);
    expect(code.length).toBeLessThanOrEqual(TEMPLATE_CODE_MAX);
    expect(decodeTemplate(code)).toEqual({ ok: true, template: t });
  });

  it('accepts white space around the code and upper-case checksum digits', () => {
    const code = encodeTemplate(starter);
    expect(err(`  ${code}\n`)).toBe('ok');
    expect(err(code.slice(0, -4) + code.slice(-4).toUpperCase())).toBe('ok');
  });

  it('accepts locked parts and variants (the shipyard shows the lock)', () => {
    const t: ShipTemplate = { name: 'Var', parts: [['cockpit:2:scout', 0, 0, 0], ['engine:2:overdrive', -1, 0, 0]] };
    expect(decodeTemplate(encodeTemplate(t))).toEqual({ ok: true, template: t });
  });

  it('normalises a code whose cockpit is not at (0, 0) and whose parts are unsorted', () => {
    const r = decodeTemplate(codeOf({ v: 1, n: ' A ', p: [['engine:1', 4, 5, 0], ['cockpit:1', 5, 5, 0]] }));
    expect(r).toEqual({ ok: true, template: { name: 'A', parts: [['cockpit:1', 0, 0, 0], ['engine:1', -1, 0, 0]] } });
  });
});

describe('decodeTemplate errors', () => {
  const good = { v: 1, n: 'A', p: [['cockpit:1', 0, 0, 0], ['engine:1', -1, 0, 0]] };

  it('tooLong: over TEMPLATE_CODE_MAX characters', () => {
    expect(err('AF1.' + 'A'.repeat(TEMPLATE_CODE_MAX))).toBe('tooLong');
    expect(err('x'.repeat(10_000_000))).toBe('tooLong');
  });

  it('prefix: wrong prefix, unknown version in the prefix, no prefix', () => {
    const code = encodeTemplate(starter);
    expect(err(code.replace('CB2.', 'CB3.'))).toBe('prefix');
    expect(err(code.replace('CB2.', 'CB0.'))).toBe('prefix');
    expect(err(code.replace('CB2.', 'cb2.'))).toBe('prefix');
    expect(err(code.replace('CB2.', 'af2.'))).toBe('prefix');
    expect(err(code.slice(4))).toBe('prefix');
    expect(err('')).toBe('prefix');
    expect(err('hello')).toBe('prefix');
  });

  it('CB2. with a broken tail: a missing or malformed checksum is checksum, a broken payload is format', () => {
    const code = encodeTemplate(starter);
    // cut off: no checksum, half a checksum, a checksum digit lost
    expect(err(code.slice(0, -5))).toBe('checksum');
    expect(err(code.slice(0, -2))).toBe('checksum');
    expect(err(code.slice(0, -1))).toBe('checksum');
    // a mistyped checksum (not hex, too long) or text pasted behind it
    expect(err(code.slice(0, -4) + 'zz12')).toBe('checksum');
    expect(err(code + '7')).toBe('checksum');
    expect(err(code + ' and more')).toBe('checksum');
    // the payload is empty, has a foreign character or a space, or an extra dot
    expect(err('AF1..0000')).toBe('format');
    expect(err('AF1.')).toBe('format');
    expect(err(code.replace('.', '. '))).toBe('format');
    expect(err(code.slice(0, 10) + '+' + code.slice(11))).toBe('format');
    expect(err(code.slice(0, 10) + '.' + code.slice(10))).toBe('format');
  });

  it('checksum: one changed payload character or checksum digit', () => {
    const code = encodeTemplate(starter);
    const i = 10;
    const flipped = code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1);
    expect(err(flipped)).toBe('checksum');
    const last = code.at(-1) === '0' ? '1' : '0';
    expect(err(code.slice(0, -1) + last)).toBe('checksum');
  });

  it('format: not base64url JSON of the expected shape', () => {
    expect(err(codeOf(null, '{not json'))).toBe('format');
    expect(err(codeOf(null, '￿'.repeat(3)))).toBe('format');
    expect(err(codeOf([1, 2]))).toBe('format');
    expect(err(codeOf('text'))).toBe('format');
    expect(err(codeOf({ n: 'A', p: good.p }))).toBe('format');
    expect(err(codeOf({ ...good, p: 'x' }))).toBe('format');
    expect(err(codeOf({ ...good, p: [] }))).toBe('format');
    expect(err(codeOf({ ...good, p: [['cockpit:1', 0, 0]] }))).toBe('format');
    expect(err(codeOf({ ...good, p: [['cockpit:1', 0.5, 0, 0]] }))).toBe('format');
    expect(err(codeOf({ ...good, p: [['cockpit:1', 0, 0, 4]] }))).toBe('format');
    expect(err(codeOf({ ...good, p: [['cockpit:1', '0', 0, 0]] }))).toBe('format');
    expect(err(codeOf({ ...good, p: [[7, 0, 0, 0]] }))).toBe('format');
    expect(err(codeOf({ ...good, p: [null] }))).toBe('format');
    // invalid UTF-8 bytes in the payload
    const payload = base64UrlEncode(Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d]));
    expect(err(`AF1.${payload}.${templateChecksum(payload)}`)).toBe('format');
  });

  it('version: an unknown format version, or one that does not match the prefix', () => {
    expect(err(codeOf({ ...good, v: 2 }))).toBe('version');
    expect(err(codeOf({ ...good, v: '1' }))).toBe('version');
    // an AF1 payload behind the AF2 / CB2 prefix and the other way round (checksum covers the payload only)
    expect(err(codeOf(good).replace('AF1.', 'AF2.'))).toBe('version');
    expect(err(codeOf(good).replace('AF1.', 'CB2.'))).toBe('version');
    expect(err(encodeTemplate(starter).replace('CB2.', 'AF1.'))).toBe('version');
  });

  it('name: missing, empty, too long or not text', () => {
    expect(err(codeOf({ ...good, n: undefined }))).toBe('name');
    expect(err(codeOf({ ...good, n: '  ' }))).toBe('name');
    expect(err(codeOf({ ...good, n: 'x'.repeat(25) }))).toBe('name');
    expect(err(codeOf({ ...good, n: 5 }))).toBe('name');
    expect(decodeTemplate(codeOf({ ...good, n: 'a\u0000b‮' }))).toMatchObject({ ok: true, template: { name: 'ab' } });
  });

  it('unknownPart, noCockpit, manyCockpits, overlap, outOfBounds, invalidDesign', () => {
    expect(err(codeOf({ ...good, p: [['cockpit:1', 0, 0, 0], ['warpDrive:1', -1, 0, 0]] }))).toBe('unknownPart');
    expect(err(codeOf({ ...good, p: [['cockpit:1', 0, 0, 0], ['engine:3', -1, 0, 0]] }))).toBe('unknownPart');
    expect(err(codeOf({ ...good, p: [['cockpit:1', 0, 0, 0], ['engine:1:scout', -1, 0, 0]] }))).toBe('unknownPart');
    expect(err(codeOf({ ...good, p: [['engine:1', 0, 0, 0]] }))).toBe('noCockpit');
    expect(err(codeOf({ ...good, p: [['cockpit:1', 0, 0, 0], ['cockpit:2', 1, 0, 0]] }))).toBe('manyCockpits');
    expect(err(codeOf({ ...good, p: [['cockpit:1', 0, 0, 0], ['largeCargo:1', -1, -1, 0]] }))).toBe('overlap');
    expect(err(codeOf({ ...good, p: [['cockpit:1', 0, 0, 0], ['engine:1', 99, 0, 0]] }))).toBe('outOfBounds');
    expect(err(codeOf({ ...good, p: [['cockpit:1', 0, 0, 0], ['engine:1', -1e300, 0, 0]] }))).toBe('format');
    const line = [['cockpit:1', 0, 0, 0], ...Array.from({ length: 15 }, (_, i) => ['armor:1', i + 1, 0, 0])];
    expect(err(codeOf({ ...good, p: line }))).toBe('outOfBounds');
    expect(err(codeOf({ ...good, p: [['cockpit:1', 0, 0, 0], ['engine:1', -2, 0, 0]] }))).toBe('invalidDesign');
  });

  it('not a string', () => {
    for (const v of [undefined, null, 42, {}, ['AF1.']]) expect(err(v)).toBe('format');
  });
});

describe('decodeTemplate fuzz', () => {
  const ALPHABET = 'AF1.abcdefABCDEF0123456789-_+/= \n{}[]":,.ÄťžŤ\u0000';

  it('never throws on garbage and mutated codes; anything accepted is a valid normalised template', () => {
    const rng = createRng(99);
    const int = (n: number) => Math.floor(rng() * n);
    const base = [encodeTemplate(starter), ...Array.from({ length: 20 }, (_, i) => encodeTemplate({ name: `F${i}`, parts: normalizeTemplate(randomShip(500 + i))! }))];
    for (let i = 0; i < 5000; i++) {
      let s: string;
      if (i % 3 === 0) {
        s = Array.from({ length: int(80) }, () => ALPHABET[int(ALPHABET.length)]).join('');
        if (i % 2 === 0) s = 'AF1.' + s;
      } else {
        const chars = [...base[int(base.length)]!];
        for (let k = 1 + int(3); k > 0; k--) {
          const at = int(chars.length);
          const op = int(3);
          if (op === 0) chars[at] = ALPHABET[int(ALPHABET.length)]!;
          else if (op === 1) chars.splice(at, 1);
          else chars.splice(at, 0, ALPHABET[int(ALPHABET.length)]!);
        }
        s = chars.join('');
      }
      let r: ReturnType<typeof decodeTemplate> | undefined;
      expect(() => (r = decodeTemplate(s)), s).not.toThrow();
      if (r!.ok) {
        expect(templateProblem(r!.template.parts)).toBeNull();
        expect(normalizeParts(r!.template.parts)).toEqual(r!.template.parts);
      }
    }
  });

  it('valid JSON of the wrong shapes behind a correct checksum never throws', () => {
    const shapes: unknown[] = [
      { v: 1, n: 'A', p: [[['cockpit:1'], 0, 0, 0]] },
      { v: 1, n: 'A', p: [{ 0: 'cockpit:1', 1: 0, 2: 0, 3: 0, length: 4 }] },
      { v: 1, n: { toString: 1 }, p: [] },
      { __proto__: { v: 1 }, n: 'A', p: [['cockpit:1', 0, 0, 0]] },
      { v: 1, n: 'A', p: Array.from({ length: 300 }, () => ['cockpit:1', 0, 0, 0]) },
      { v: 1, n: 'A', p: [['cockpit:1', 1e308, -1e308, 0]] },
      { v: 1, n: 'A', p: [['constructor', 0, 0, 0]] },
      { v: 1, n: 'A', p: [['__proto__', 0, 0, 0]] },
    ];
    for (const s of shapes) expect(() => decodeTemplate(codeOf(s))).not.toThrow();
    expect(err(codeOf(shapes[0]))).toBe('format');
    expect(err(codeOf(shapes[6]))).toBe('unknownPart');
  });
});
