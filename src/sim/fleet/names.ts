// Ship (and template) names (M4a, plan §2): sanitising custom names and picking the
// generated name. Pure and deterministic; the name texts themselves are `tx().fleet.names`.
import { SHIP_NAME_COUNT, SHIP_NAME_MAX } from '../../data/fleet';
import { hash3 } from '../world/hash';
import type { ShipId, ShipRecord } from './types';

/** Control and invisible format characters (incl. bidi overrides and zero-width marks). */
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const SPACES = /\s+/gu;

/**
 * A custom name as the game stores it, or null when it is not acceptable: anything but a string,
 * empty after cleaning, or longer than SHIP_NAME_MAX characters (code points). Cleaning: Unicode
 * NFC, control / format characters removed, runs of white space collapsed to one space, trimmed.
 * Too long names are rejected, not cut (the UI limits the field).
 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // a crafted action could send a huge string – do not normalise megabytes
  if (raw.length > SHIP_NAME_MAX * 8) return null;
  const clean = raw.normalize('NFC').replace(CONTROL, '').replace(SPACES, ' ').trim();
  const length = Array.from(clean).length;
  return length >= 1 && length <= SHIP_NAME_MAX ? clean : null;
}

/** Is `name` exactly a stored-form name (what `sanitizeName` returns)? Save validation. */
export const isSanitizedName = (name: unknown): name is string => typeof name === 'string' && sanitizeName(name) === name;

/** Salt of the generated-name hash (keeps it independent of other `hash3(seed, …)` streams). */
const NAME_SALT = 0x5f1ee7;

/**
 * Index of the generated name of ship `shipId` in a game with `seed`: `hash(seed, shipId) % N`.
 * When `taken` is given (indices used by the other ships of the fleet), the next free index after the
 * hashed one is used instead, so ships of one fleet do not share a name while names are left.
 */
export function generatedNameIndex(seed: number, shipId: ShipId, taken?: ReadonlySet<number>): number {
  const start = hash3(seed, shipId, NAME_SALT) % SHIP_NAME_COUNT;
  if (!taken || taken.size >= SHIP_NAME_COUNT) return start;
  for (let k = 0; k < SHIP_NAME_COUNT; k++) {
    const idx = (start + k) % SHIP_NAME_COUNT;
    if (!taken.has(idx)) return idx;
  }
  return start;
}

/**
 * The name to show: the custom name, or the generated one from `names` (the current language's
 * `tx().fleet.names`, passed in so the simulation never reads texts).
 */
export const shipDisplayName = (record: Pick<ShipRecord, 'name' | 'nameIdx'>, names: readonly string[]): string =>
  record.name ?? names[record.nameIdx % names.length] ?? '';
