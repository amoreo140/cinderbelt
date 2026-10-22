import { describe, expect, it } from 'vitest';
import { toEnvelope, toSave } from '../../sim/save/serialize';
import { testContext } from '../../sim/save/testing';
import { dockedSim } from '../../sim/station/testHarness';
import { fakeSave } from './storageContract';
import { MAX_IMPORT_BYTES, downloadTextFile, readFileText } from './fileTransfer';
import { exportFileName, exportSlot, parseImport } from './transfer';

describe('exportSlot / parseImport', () => {
  it('round-trips a slot with its backup', () => {
    const cur = fakeSave('g1', 20);
    const old = fakeSave('g1', 10);
    const text = exportSlot({ current: cur.envelope, backup: old.envelope, meta: cur.meta }, '2026-10-17T13:00:00.000Z');
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({ format: 'cinderbelt-export', exportVersion: 1, exportedAt: '2026-10-17T13:00:00.000Z' });
    const result = parseImport(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.current).toEqual(cur.envelope);
    expect(result.backup).toEqual(old.envelope);
    expect(result.save.credits).toBe(20);
    expect(result.usedBackup).toBe(false);
  });

  it('imports a file in the pre-rename formats (astra-forge-export / astra-forge-save)', () => {
    const cur = fakeSave('g1', 20);
    const legacyEnvelope = { ...cur.envelope, format: 'astra-forge-save' };
    const legacyExport = JSON.stringify({ ...JSON.parse(exportSlot({ current: cur.envelope, backup: null, meta: cur.meta }, '2026-10-17T13:00:00.000Z')), format: 'astra-forge-export', current: legacyEnvelope });
    const fromExport = parseImport(legacyExport);
    expect(fromExport.ok).toBe(true);
    if (fromExport.ok) expect(fromExport.save.credits).toBe(20);
    expect(parseImport(JSON.stringify(legacyEnvelope)).ok).toBe(true);
  });

  it('exports raw data even for a corrupted slot', () => {
    const cur = fakeSave('g1', 20);
    const corrupt = { ...cur.envelope, checksum: '00000000' };
    const text = exportSlot({ current: corrupt, backup: null, meta: null }, '2026-10-17T13:00:00.000Z');
    expect(JSON.parse(text).current).toEqual(corrupt);
    expect(parseImport(text)).toMatchObject({ ok: false, error: 'checksum' });
  });

  it('falls back to a good backup when the exported current record is corrupted', () => {
    const cur = fakeSave('g1', 20);
    const old = fakeSave('g1', 10);
    const text = exportSlot({ current: { ...cur.envelope, data: 'x' }, backup: old.envelope, meta: null }, '2026-10-17T13:00:00.000Z');
    const result = parseImport(text);
    expect(result).toMatchObject({ ok: true, usedBackup: true });
    if (result.ok) {
      expect(result.current).toEqual(old.envelope);
      expect(result.backup).toBeNull();
    }
  });

  it('accepts a bare save envelope', () => {
    const env = toEnvelope(toSave(dockedSim(), testContext()));
    expect(parseImport(JSON.stringify(env))).toMatchObject({ ok: true, current: env, backup: null });
  });

  it('rejects files that are not exports', () => {
    expect(parseImport('not json')).toMatchObject({ ok: false, error: 'json' });
    expect(parseImport('{"format":"something"}')).toMatchObject({ ok: false, error: 'format' });
    expect(parseImport('{"format":"astra-forge-export","exportVersion":1}')).toMatchObject({ ok: false, error: 'format' });
  });

  it('refuses an export from a newer game', () => {
    const data = JSON.stringify({ version: 99 });
    const env = { format: 'cinderbelt-save', version: 99, checksum: '', data };
    expect(parseImport(JSON.stringify({ ...env, checksum: toEnvelope({ version: 99 }).checksum }))).toMatchObject({ ok: false, error: 'tooNew', version: 99 });
  });
});

describe('exportFileName', () => {
  it('builds a safe file name from the save name and date', () => {
    expect(exportFileName('Kotva / Lyra: 1', '2026-10-17T13:00:00.000Z')).toBe('cinderbelt-kotva-lyra-1-2026-10-17.cinder');
    expect(exportFileName('', '2026-10-17T13:00:00.000Z')).toBe('cinderbelt-save-2026-10-17.cinder');
    expect(exportFileName('Útočisko Ďaleko', '2026-01-02T00:00:00.000Z')).toBe('cinderbelt-utocisko-daleko-2026-01-02.cinder');
  });
});

describe('file helpers (thin DOM layer)', () => {
  it('downloads text through a temporary object URL and anchor', () => {
    const calls: string[] = [];
    const anchor = { href: '', download: '', click: () => calls.push(`click ${anchor.download}`), remove: () => calls.push('remove') };
    const doc = { createElement: () => anchor, body: { append: () => calls.push('append') } } as unknown as Document;
    const url = { createObjectURL: () => 'blob:1', revokeObjectURL: (u: string) => calls.push(`revoke ${u}`) };
    downloadTextFile('a.json', '{}', { document: doc, url, defer: (fn) => fn() });
    expect(anchor.href).toBe('blob:1');
    expect(calls).toEqual(['append', 'click a.json', 'remove', 'revoke blob:1']);
  });

  it('reads a file as text', async () => {
    expect(await readFileText(new Blob(['hello']))).toBe('hello');
  });

  it('rejects a file above the size limit without reading it', async () => {
    let read = false;
    const huge = { size: MAX_IMPORT_BYTES + 1, text: async () => ((read = true), 'x') } as unknown as Blob;
    await expect(readFileText(huge)).rejects.toThrow(/too large/);
    expect(read).toBe(false);
    const edge = { size: MAX_IMPORT_BYTES, text: async () => 'ok' } as unknown as Blob;
    expect(await readFileText(edge)).toBe('ok');
  });
});
