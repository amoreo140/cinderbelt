// Loading the save envelope (M2): format → checksum → JSON → migrations → validation.
import { fnv1aHex } from '../math/fnv1a';
import { LATEST_SAVE_VERSION, MIGRATIONS, migrate, type MigrationTable } from './migrations';
import { LEGACY_SAVE_FORMAT, SAVE_FORMAT, type SaveEnvelope, type SaveGame } from './types';
import { validateSave, type LoadWarning } from './validate';
import { gridFromSave } from './serialize';
import { blockedExhausts } from '../ship/exhaust';

/** The first save version written when covered nozzles started to burn parts (I15). */
export const EXHAUST_BURN_VERSION = 9;

export type { LoadWarning } from './validate';

/**
 * format – not a save envelope; checksum – the data got corrupted; parse – the JSON cannot be read;
 * tooNew – saved by a newer version of the game (do not load, do not overwrite); migration – the migration failed;
 * invalid – the data did not pass validation.
 */
export type LoadError = 'format' | 'checksum' | 'parse' | 'tooNew' | 'migration' | 'invalid';

export type LoadResult =
  | { ok: true; save: SaveGame; fromVersion: number; warnings: LoadWarning[] }
  | { ok: false; error: LoadError; version: number | null; details: string[] };

export interface LoadOptions {
  /** Only for tests of the migration framework. */
  migrations?: MigrationTable;
  latest?: number;
}

export function isSaveEnvelope(value: unknown): value is SaveEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.format === SAVE_FORMAT || v.format === LEGACY_SAVE_FORMAT) &&
    typeof v.version === 'number' &&
    Number.isInteger(v.version) &&
    v.version >= 0 &&
    typeof v.checksum === 'string' &&
    typeof v.data === 'string'
  );
}

/** A quick check without parsing – the checksum matches. */
export const envelopeIntact = (env: SaveEnvelope): boolean => fnv1aHex(env.data) === env.checksum;

export function loadSave(envelope: unknown, options: LoadOptions = {}): LoadResult {
  const fail = (error: LoadError, version: number | null, ...details: string[]): LoadResult => ({ ok: false, error, version, details });
  if (!isSaveEnvelope(envelope)) return fail('format', null, 'not a save envelope');
  const { version } = envelope;
  if (!envelopeIntact(envelope)) return fail('checksum', version, `checksum ${envelope.checksum} does not match the data`);

  let data: unknown;
  try {
    data = JSON.parse(envelope.data);
  } catch (e) {
    return fail('parse', version, e instanceof Error ? e.message : String(e));
  }
  const inner = typeof data === 'object' && data !== null ? (data as { version?: unknown }).version : undefined;
  if (inner !== version) return fail('format', version, `envelope version ${version} differs from data version ${String(inner)}`);

  const latest = options.latest ?? LATEST_SAVE_VERSION;
  const migrated = migrate(data, version, options.migrations ?? MIGRATIONS, latest);
  if (!migrated.ok) return fail(migrated.error, version, migrated.detail);

  const valid = validateSave(migrated.data);
  if (!valid.ok) return fail('invalid', version, ...valid.errors);
  const warnings = [...valid.warnings];
  // a ship built before exhaust burns may blow into its own parts – they burn now (I15)
  if (version < EXHAUST_BURN_VERSION) {
    const engines = new Set(blockedExhausts(gridFromSave(valid.save.player.grid)).map((b) => b.engineId)).size;
    if (engines > 0) warnings.push({ code: 'coveredNozzleLegacy', engines });
  }
  return { ok: true, save: valid.save, fromVersion: version, warnings };
}
