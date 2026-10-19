import { describe, expect, it } from 'vitest';
import { fnv1aHex } from '../math/fnv1a';
import { dockedSim } from '../station/testHarness';
import { loadSave } from './load';
import { toEnvelope, toSave } from './serialize';
import { testContext } from './testing';
import type { SaveEnvelope } from './types';

const goodEnvelope = (): SaveEnvelope => toEnvelope(toSave(dockedSim(), testContext()));

describe('loadSave', () => {
  it('loads a valid envelope', () => {
    const env = goodEnvelope();
    const result = loadSave(env);
    expect(result).toMatchObject({ ok: true, fromVersion: 20, warnings: [] });
    if (result.ok) expect(result.save).toEqual(JSON.parse(env.data));
  });

  it('rejects something that is not a save envelope', () => {
    for (const bad of [null, 42, 'x', {}, { ...goodEnvelope(), format: 'other' }, { ...goodEnvelope(), version: 'one' }, { ...goodEnvelope(), data: 5 }]) {
      expect(loadSave(bad)).toMatchObject({ ok: false, error: 'format' });
    }
  });

  it('detects a checksum mismatch', () => {
    const env = goodEnvelope();
    const tampered = { ...env, data: env.data.replace('"credits":250', '"credits":999999') };
    expect(tampered.data).not.toBe(env.data);
    expect(loadSave(tampered)).toMatchObject({ ok: false, error: 'checksum', version: 20 });
  });

  it('still loads a save with the pre-rename format string', () => {
    const env = goodEnvelope();
    expect(loadSave({ ...env, format: 'astra-forge-save' })).toMatchObject({ ok: true });
    expect(loadSave({ ...env, format: 'other-save' })).toMatchObject({ ok: false, error: 'format' });
  });

  it('reports unparsable JSON', () => {
    const data = '{"version":1,';
    expect(loadSave({ format: 'cinderbelt-save', version: 1, checksum: fnv1aHex(data), data })).toMatchObject({ ok: false, error: 'parse' });
  });

  it('refuses a save from a newer game version', () => {
    const data = JSON.stringify({ version: 21 });
    expect(loadSave({ format: 'cinderbelt-save', version: 21, checksum: fnv1aHex(data), data })).toMatchObject({
      ok: false,
      error: 'tooNew',
      version: 21,
    });
  });

  it('detects an envelope version that disagrees with the data', () => {
    const env = goodEnvelope();
    expect(loadSave({ ...env, version: 0 })).toMatchObject({ ok: false, error: 'format' });
  });

  it('reports validation errors', () => {
    const save = toSave(dockedSim(), testContext()) as unknown as Record<string, unknown>;
    const env = toEnvelope({ ...save, credits: -5 } as unknown as { version: number });
    const result = loadSave(env);
    expect(result).toMatchObject({ ok: false, error: 'invalid' });
    if (!result.ok) expect(result.details.join('\n')).toContain('credits');
  });
});
