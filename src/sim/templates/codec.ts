// Template export / import code (M4a; AF2 from SL2 E2; CB2 from the rename to Cinderbelt):
//
//   CB2.<payload>.<checksum>   what the encoder writes today: the AF2 payload and checksum below under a new prefix
//   AF1.<payload>.<checksum>   a template without shapes (legacy, read only)
//   payload  = base64url (RFC 4648 §5, no padding) of the UTF-8 JSON {"v":1,"n":name,"p":[[key,x,y,rot],…]}
//   AF2.<payload>.<checksum>   a template with at least one shaped part (legacy, read only; CB2 has the same payload)
//   payload  = base64url of {"v":2,"n":name,"k":[key,…],"p":[[ki,x,y,rot,m?],…]} – `k` is a dictionary of
//              the part keys (in first-use order of the normalised parts), `ki` an index into it, `m` the
//              shape's code (`ShapeDef.code`: w, c, r, a, h, n, wl, wr, n2), left out for a full part;
//              a `t` key (superstructure, SL2 E3) is not readable yet: `version`
//   checksum = 4 lowercase hex digits: FNV-1a 32 of the payload text, folded to 16 bits (hi ^ lo)
//
// The encoder always writes CB2 (the AF2 payload; shaped or not); the decoder reads CB2, AF2 and the old AF1
// codes (golden.test.ts keeps recorded AF1 codes decoding). At most TEMPLATE_CODE_MAX characters.
// Decoding is pure, never throws, and answers error codes, not texts (the UI picks the text). Decoding
// accepts locked parts and variants – the shipyard shows the lock; the simulation validates the parts
// again in `templateSave`.
import { TEMPLATE_CODE_MAX } from '../../data/fleet';
import { isPartKey, type PartKey } from '../../data/parts';
import { SHAPES, shapeOfCode } from '../../data/shapes';
import { sanitizeName } from '../fleet/names';
import { fnv1a32 } from '../math/fnv1a';
import type { Rotation } from '../ship/types';
import { isTemplatePart, normalizeParts, templateProblem } from './normalize';
import type { ShipTemplate, TemplateDecodeError, TemplateDecodeResult, TemplatePart } from './types';

/** Legacy prefix of a code without shapes (decoded, no longer written). */
export const TEMPLATE_CODE_PREFIX = 'AF1.';
/** Format version inside an AF1 payload. */
export const TEMPLATE_CODE_VERSION = 1;
/** Legacy prefix of a code with shapes (SL2 E2; decoded, no longer written). */
export const TEMPLATE_CODE_PREFIX_AF2 = 'AF2.';
/** Prefix of every code the game writes (the AF2 payload under the Cinderbelt name). */
export const TEMPLATE_CODE_PREFIX_V2 = 'CB2.';
/** Format version inside an AF2 / CB2 payload. */
export const TEMPLATE_CODE_VERSION_V2 = 2;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

/** Bytes → base64url without padding. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let k = 0; k < chars; k++) out += B64[(n >> (18 - 6 * k)) & 63];
  }
  return out;
}

/** base64url without padding → bytes; null for a character outside the alphabet or an impossible length / tail. */
export function base64UrlDecode(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const bytes = new Uint8Array(Math.floor((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let j = 0;
  for (const c of text) {
    const v = B64_INDEX.get(c);
    if (v === undefined) return null;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[j++] = (acc >> bits) & 0xff;
    }
  }
  // canonical form: the unused low bits of the last character are zero
  if ((acc & ((1 << bits) - 1)) !== 0) return null;
  return bytes;
}

/** The 4-hex checksum of a payload. */
export function templateChecksum(payload: string): string {
  const h = fnv1a32(payload);
  return (((h >>> 16) ^ h) & 0xffff).toString(16).padStart(4, '0');
}

/** The AF2 payload object of normalised parts: a key dictionary and index tuples with shape codes. */
function af2Payload(name: string, parts: readonly TemplatePart[]): { v: number; n: string; k: PartKey[]; p: (string | number)[][] } {
  const keys: PartKey[] = [];
  const index = new Map<PartKey, number>();
  for (const [key] of parts) {
    if (!index.has(key)) {
      index.set(key, keys.length);
      keys.push(key);
    }
  }
  const p = parts.map(([key, x, y, rot, shape]) => (shape === undefined ? [index.get(key)!, x, y, rot] : [index.get(key)!, x, y, rot, SHAPES[shape].code]));
  return { v: TEMPLATE_CODE_VERSION_V2, n: name, k: keys, p };
}

/** The export code of a template (its parts normalised; the name as stored): always CB2. */
export function encodeTemplate(template: ShipTemplate): string {
  const parts = normalizeParts(template.parts) ?? template.parts;
  const json = JSON.stringify(af2Payload(template.name, parts));
  const payload = base64UrlEncode(new TextEncoder().encode(json));
  return `${TEMPLATE_CODE_PREFIX_V2}${payload}.${templateChecksum(payload)}`;
}

const CODE = /^(AF1|AF2|CB2)\.([A-Za-z0-9_-]+)\.([0-9a-fA-F]{4})$/;
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

const fail = (error: TemplateDecodeError): TemplateDecodeResult => ({ ok: false, error });

const PAYLOAD = /^[A-Za-z0-9_-]+$/;
const CHECKSUM = /^[0-9a-fA-F]{4}$/;
const PREFIXES = [TEMPLATE_CODE_PREFIX, TEMPLATE_CODE_PREFIX_AF2, TEMPLATE_CODE_PREFIX_V2] as const;

/**
 * Why a text is not `CB2.<payload>.<4 hex>` (or the legacy `AF1.` / `AF2.`): without either prefix it is not
 * a template code at all (`prefix`); with one, a missing or malformed checksum tail means a cut or
 * mistyped code (`checksum`), and an empty payload or one with foreign characters / extra dots is `format`.
 */
function shapeError(text: string): TemplateDecodeError {
  const prefix = PREFIXES.find((pre) => text.startsWith(pre));
  if (prefix === undefined) return 'prefix';
  const rest = text.slice(prefix.length);
  const dot = rest.lastIndexOf('.');
  const payload = dot < 0 ? rest : rest.slice(0, dot);
  if (!PAYLOAD.test(payload)) return 'format';
  return dot < 0 || !CHECKSUM.test(rest.slice(dot + 1)) ? 'checksum' : 'format';
}

function parsePayload(payload: string): unknown {
  const bytes = base64UrlDecode(payload);
  if (!bytes) return undefined;
  try {
    return JSON.parse(UTF8.decode(bytes));
  } catch {
    return undefined;
  }
}

type PartsResult = { ok: true; parts: TemplatePart[] } | { ok: false; error: TemplateDecodeError };

/** AF1 parts: `[key, x, y, rot]` each – form first (a key may be unknown here), then the keys. */
function af1Parts(p: readonly unknown[]): PartsResult {
  for (const raw of p) {
    if (!Array.isArray(raw) || raw.length !== 4 || typeof raw[0] !== 'string') return { ok: false, error: 'format' };
    if (!isTemplatePart(raw)) return { ok: false, error: isTemplatePart(['cockpit:1', raw[1], raw[2], raw[3]]) ? 'unknownPart' : 'format' };
  }
  return { ok: true, parts: p as TemplatePart[] };
}

const isRotation = (rot: unknown): rot is Rotation => rot === 0 || rot === 1 || rot === 2 || rot === 3;

/**
 * AF2 parts: the key dictionary `k` (strings, no duplicates) and `[ki, x, y, rot, m?]` tuples (an index in
 * range, integer cells, a rotation, a string shape code) – all `format`; then every dictionary key
 * (`unknownPart`), then the shape codes (`unknownShape`).
 */
function af2Parts(k: unknown, p: readonly unknown[]): PartsResult {
  if (!Array.isArray(k) || !k.every((key) => typeof key === 'string') || new Set(k).size !== k.length) return { ok: false, error: 'format' };
  for (const raw of p) {
    if (!Array.isArray(raw) || (raw.length !== 4 && raw.length !== 5)) return { ok: false, error: 'format' };
    const [ki, x, y, rot] = raw as unknown[];
    if (!Number.isInteger(ki) || (ki as number) < 0 || (ki as number) >= k.length) return { ok: false, error: 'format' };
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !isRotation(rot)) return { ok: false, error: 'format' };
    if (raw.length === 5 && typeof raw[4] !== 'string') return { ok: false, error: 'format' };
  }
  if (!k.every(isPartKey)) return { ok: false, error: 'unknownPart' };
  const keys = k as PartKey[];
  const parts: TemplatePart[] = [];
  for (const raw of p as unknown[][]) {
    const [ki, x, y, rot] = raw as [number, number, number, Rotation];
    if (raw.length === 4) {
      parts.push([keys[ki]!, x, y, rot]);
      continue;
    }
    const shape = shapeOfCode(raw[4] as string);
    if (shape === null) return { ok: false, error: 'unknownShape' };
    parts.push([keys[ki]!, x, y, rot, shape]);
  }
  return { ok: true, parts };
}

/**
 * Reads an export code (white space around it is ignored, so a pasted line works). Checks in this
 * order: length, `CB2.` / `AF1.` / `AF2.` prefix, the payload / checksum shape (`shapeError`), checksum,
 * base64url / UTF-8 / JSON shape, version (the prefix's; an AF2 `t` key is `version` too), name, part
 * form and keys (AF2: the dictionary and its indexes), shape codes, then `templateProblem`: shapes on
 * parts that cannot have them, cockpits, overlap, hangar bounds, the rest of `validateGrid`. The
 * template comes back normalised.
 */
export function decodeTemplate(code: unknown): TemplateDecodeResult {
  if (typeof code !== 'string') return fail('format');
  if (code.length > TEMPLATE_CODE_MAX * 2) return fail('tooLong');
  const text = code.trim();
  if (text.length > TEMPLATE_CODE_MAX) return fail('tooLong');
  const m = CODE.exec(text);
  if (!m) return fail(shapeError(text));
  const [, prefix, payload, checksum] = m as unknown as [string, 'AF1' | 'AF2' | 'CB2', string, string];
  if (templateChecksum(payload) !== checksum.toLowerCase()) return fail('checksum');

  const data = parsePayload(payload);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return fail('format');
  const { v, n, k, p } = data as Record<string, unknown>;
  if (v === undefined) return fail('format');
  const af2 = prefix !== 'AF1';
  if (v !== (af2 ? TEMPLATE_CODE_VERSION_V2 : TEMPLATE_CODE_VERSION)) return fail('version');
  // a superstructure (SL2 E3) this version cannot build yet
  if (af2 && Object.prototype.hasOwnProperty.call(data, 't')) return fail('version');
  const name = sanitizeName(n);
  if (name === null) return fail('name');
  if (!Array.isArray(p) || p.length === 0) return fail('format');
  const read = af2 ? af2Parts(k, p) : af1Parts(p);
  if (!read.ok) return fail(read.error);
  const parts = read.parts;
  const problem = templateProblem(parts);
  switch (problem) {
    case null:
      break;
    case 'unknownPart':
    case 'unknownShape':
    case 'shapeNotAllowed':
    case 'noCockpit':
    case 'overlap':
    case 'outOfBounds':
      return fail(problem);
    case 'multipleCockpits':
      return fail('manyCockpits');
    case 'tooMany':
      return fail('outOfBounds');
    default:
      return fail('invalidDesign');
  }
  return { ok: true, template: { name, parts: normalizeParts(parts)! } };
}
