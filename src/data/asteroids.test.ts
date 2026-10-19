import { describe, expect, it } from 'vitest';
import { RESOURCE_IDS } from './resources';
import { boundingSphere, readGlbMeshes } from '../testing/glb';
import { envVar, nodeFs } from '../testing/nodeFs';
import { ASTEROID_MODEL_BOUNDS, ASTEROID_MODEL_VARIANTS, ASTEROID_VEINS, asteroidModelName } from './asteroids';
import veinsCopy from './asteroid_veins.json';

const ASTEROIDS_DIR = 'public/assets/models/asteroids';
const MODELS_FILE = 'src/data/asteroid_models.json';

const round = (x: number): number => Math.round(x * 1e6) / 1e6;

/** One row per model – the file can be read and compared in a diff. */
function formatBounds(table: Record<string, { center: number[]; radius: number }>): string {
  const lines = Object.entries(table).map(
    ([name, b]) => `  "${name}": { "center": [${b.center.map(round).join(', ')}], "radius": ${round(b.radius)} }`,
  );
  return `{\n${lines.join(',\n')}\n}\n`;
}

describe('asteroid vein data', () => {
  it('is an exact copy of veins.json exported by the artist (public/assets)', () => {
    // on mismatch: copy public/assets/models/asteroids/veins.json to src/data/asteroid_veins.json
    const original: unknown = JSON.parse(nodeFs().readFileSync(`${ASTEROIDS_DIR}/veins.json`, 'utf8'));
    expect(veinsCopy).toEqual(original);
  });

  it('has 1–3 veins with u from 0 to 1 for every iron, copper and titanium model, none for ice', () => {
    for (const resource of ['iron', 'copper', 'titanium'] as const) {
      for (let v = 0; v < ASTEROID_MODEL_VARIANTS.length; v++) {
        const veins = ASTEROID_VEINS[asteroidModelName(resource, v)]!;
        expect(veins.length).toBeGreaterThanOrEqual(1);
        expect(veins.length).toBeLessThanOrEqual(3);
        veins.forEach((vein, i) => {
          expect(vein.node).toBe(`Vein_${i}`);
          expect(vein.u[0]).toBe(0);
          expect(vein.u.at(-1)).toBeCloseTo(1);
          expect(vein.points).toHaveLength(vein.u.length);
          expect(vein.type).toBe(resource === 'titanium' ? 'deep' : 'drift');
        });
      }
    }
    for (let v = 0; v < 3; v++) expect(ASTEROID_VEINS[asteroidModelName('ice', v)]).toBeUndefined();
  });
});

describe('asteroid model bounds', () => {
  it('match the bounding spheres of the GLB models (set UPDATE_ASSET_DATA=1 to regenerate)', async () => {
    const fs = nodeFs();
    const computed: Record<string, { center: number[]; radius: number }> = {};
    for (const resource of RESOURCE_IDS) {
      for (let v = 0; v < ASTEROID_MODEL_VARIANTS.length; v++) {
        const name = asteroidModelName(resource, v);
        const meshes = await readGlbMeshes(fs.readFileSync(`${ASTEROIDS_DIR}/${name}.glb`));
        computed[name] = boundingSphere(meshes.flatMap((m) => m.positions));
      }
    }
    if (envVar('UPDATE_ASSET_DATA')) fs.writeFileSync(MODELS_FILE, formatBounds(computed));
    expect(Object.keys(ASTEROID_MODEL_BOUNDS).sort()).toEqual(Object.keys(computed).sort());
    for (const [name, b] of Object.entries(computed)) {
      const stored = ASTEROID_MODEL_BOUNDS[name]!;
      expect(stored.radius, name).toBeCloseTo(b.radius, 4);
      stored.center.forEach((c, k) => expect(c, name).toBeCloseTo(b.center[k]!, 4));
    }
  });
});
