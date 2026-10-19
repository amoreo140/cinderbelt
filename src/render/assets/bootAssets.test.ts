// The boot list (perf O14): every file it downloads ahead of the game is shipped, none twice, and the
// effect textures come last.
import { describe, expect, it } from 'vitest';
import { nodeFs } from '../../testing/nodeFs';
import { VFX_TEXTURES, vfxTexturePath } from '../fx/textures';
import { bootAssetList } from './bootAssets';

describe('boot list', () => {
  const list = bootAssetList();
  const all = [...list.early, ...list.start, ...list.late];

  it('lists only shipped files, each once', () => {
    const fs = nodeFs();
    expect(all.length).toBeGreaterThan(60);
    for (const path of all) expect(fs.existsSync(`public/${path}`), path).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  it('downloads every effect texture after the files the warm-up waits for', () => {
    expect(list.late).toEqual(VFX_TEXTURES.map(vfxTexturePath));
    expect(list.early).toContain('assets/models/stations/hangar_bay.glb');
  });
});
