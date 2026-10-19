// Export and import of a saved game to a file (M2, 4.3 and 12.4) – pure functions over text.
// Export works for a corrupted slot too (raw data); the import of an envelope is checked via loadSave.
import { isSaveEnvelope, loadSave, type LoadError, type LoadWarning } from '../../sim/save/load';
import type { SlotMeta } from '../../sim/save/meta';
import type { SaveEnvelope, SaveGame } from '../../sim/save/types';
import type { SlotRecord } from './SaveStorage';

export const EXPORT_FORMAT = 'cinderbelt-export';
/** The export format before the rename to Cinderbelt; still imported. */
export const LEGACY_EXPORT_FORMAT = 'astra-forge-export';

export interface SaveExportFile {
  format: typeof EXPORT_FORMAT | typeof LEGACY_EXPORT_FORMAT;
  exportVersion: 1;
  /** ISO 8601. */
  exportedAt: string;
  meta: SlotMeta | null;
  current: SaveEnvelope | null;
  backup: SaveEnvelope | null;
}

export function exportSlot(record: SlotRecord, exportedAt: string): string {
  const file: SaveExportFile = {
    format: EXPORT_FORMAT,
    exportVersion: 1,
    exportedAt,
    meta: record.meta,
    current: record.current,
    backup: record.backup,
  };
  return JSON.stringify(file, null, 1);
}

/** "cinderbelt-<name>-<date>.cinder" (long-term design 9.9) – without diacritics and unsafe characters. */
export function exportFileName(name: string, exportedAt: string): string {
  const slug =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'save';
  return `cinderbelt-${slug}-${exportedAt.slice(0, 10)}.cinder`;
}

const isExportFormat = (format: unknown): boolean => format === EXPORT_FORMAT || format === LEGACY_EXPORT_FORMAT;

export type ImportResult =
  | {
      ok: true;
      /** The record that becomes current (for a corrupted current one it is the backup). */
      current: SaveEnvelope;
      backup: SaveEnvelope | null;
      save: SaveGame;
      warnings: LoadWarning[];
      usedBackup: boolean;
    }
  /** `version` = the save version (for `tooNew` – the player sees which version saved it), otherwise null. */
  | { ok: false; error: 'json' | LoadError; details: string[]; version: number | null };

/** Reads an exported file (or a bare save envelope) and checks that it can be loaded. */
export function parseImport(text: string): ImportResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'json', details: [e instanceof Error ? e.message : String(e)], version: null };
  }
  let current: unknown;
  let backup: unknown = null;
  if (isSaveEnvelope(json)) {
    current = json;
  } else if (typeof json === 'object' && json !== null && isExportFormat((json as { format?: unknown }).format)) {
    const file = json as Partial<SaveExportFile>;
    current = file.current;
    backup = file.backup ?? null;
  } else {
    return { ok: false, error: 'format', details: ['not a Cinderbelt save file'], version: null };
  }
  if (!isSaveEnvelope(current) && !isSaveEnvelope(backup)) return { ok: false, error: 'format', details: ['the file contains no save'], version: null };

  const main = loadSave(current);
  if (main.ok) {
    const goodBackup = isSaveEnvelope(backup) && loadSave(backup).ok ? backup : null;
    return { ok: true, current: current as SaveEnvelope, backup: goodBackup, save: main.save, warnings: main.warnings, usedBackup: false };
  }
  if (isSaveEnvelope(backup)) {
    const fallback = loadSave(backup);
    if (fallback.ok) return { ok: true, current: backup, backup: null, save: fallback.save, warnings: fallback.warnings, usedBackup: true };
  }
  return { ok: false, error: main.error, details: main.details, version: main.version };
}
