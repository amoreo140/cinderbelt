import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { CAPTAIN_CLANS, CAPTAIN_MAX_LEVEL } from '../../data/captains';
import { captainGrid } from '../../sim/captains/captains';
import { ENEMY_KINDS } from '../../sim/combat/types';
import { ENEMY_TEMPLATES } from '../../sim/combat/enemies';
import { nodeFs } from '../../testing/nodeFs';
import { applyDerelict, applyLivery, derelictShade, DERELICT_SHADES } from '../combat/livery';
import { PALETTE_MATERIAL, restorePaletteBaseColor } from './gltf';
import { ClanParts, CLAN_MANIFEST_PATH, clanConnectorPath, clanPartPath, clanSetPaths, isClanMaterial, type ClanManifest } from './clanParts';

const manifest = (): ClanManifest => JSON.parse(nodeFs().readFileSync(`public/${CLAN_MANIFEST_PATH}`, 'utf8')) as ClanManifest;

describe('clan part paths (manifest)', () => {
  it('maps clan + part + tier to the clan file, and to null (= player part) without an entry', () => {
    const m = manifest();
    expect(clanPartPath(m, 'rust', 'cannon', 1)).toBe('assets/models/parts_pirate/rust/cannon_iron.glb');
    expect(clanPartPath(m, 'slantedStar', 'shield', 2)).toBe('assets/models/parts_pirate/slantedStar/shield_generator_titanium.glb');
    expect(clanPartPath(m, 'cauldron', 'miningLaser', 1)).toBeNull();
    expect(clanPartPath(m, 'guild', 'cannon', 1)).toBeNull();
    expect(clanConnectorPath(m, 'cauldron', 'edge')).toBe('assets/models/parts_pirate/cauldron/hull_connector_edge.glb');
    expect(clanConnectorPath(m, 'wardens', 'corner')).toBeNull();
    expect(clanPartPath({ parts: {}, connectors: {} }, 'rust', 'cannon', 1)).toBeNull();
  });

  it('every file of every clan set ships', () => {
    const m = manifest();
    const { existsSync } = nodeFs();
    for (const clan of CAPTAIN_CLANS) {
      const paths = clanSetPaths(m, clan);
      expect(paths.length).toBe(22);
      for (const p of paths) expect(existsSync(`public/${p}`), p).toBe(true);
    }
  });

  it('covers every part pirates and captains fly, in both tiers', () => {
    const m = manifest();
    const grids = [...ENEMY_KINDS.flatMap((k) => [ENEMY_TEMPLATES[k](1), ENEMY_TEMPLATES[k](2)])];
    for (let level = 1; level <= CAPTAIN_MAX_LEVEL; level++) grids.push(captainGrid(level));
    for (const clan of CAPTAIN_CLANS) {
      for (const grid of grids) for (const p of grid.parts) expect(clanPartPath(m, clan, p.partId, p.tier), `${clan} ${p.partId} T${p.tier}`).not.toBeNull();
    }
  });
});

const box = (): Object3D => {
  const g = new Group();
  g.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
  return g;
};

describe('ClanParts (lazy sets)', () => {
  it('loads a clan once, tags its materials and falls back per part', async () => {
    const loaded: string[] = [];
    const m: ClanManifest = {
      parts: { rust: { cannon: { '1': 'a/cannon.glb' }, engine: { '1': 'a/missing.glb' } } },
      connectors: { rust: { edge: 'a/edge.glb' } },
    };
    let manifests = 0;
    const clans = new ClanParts(
      async (path) => {
        loaded.push(path);
        return path.includes('missing') ? null : box();
      },
      async () => {
        manifests++;
        return m;
      },
    );
    expect(clans.part('rust', 'cannon', 1)).toBeNull();
    const first = clans.ensure('rust');
    expect(clans.state('rust')).toBe('loading');
    await Promise.all([first, clans.ensure('rust')]);
    expect(clans.ready('rust')).toBe(true);
    expect(loaded.sort()).toEqual(['a/cannon.glb', 'a/edge.glb', 'a/missing.glb']);
    const cannon = clans.part('rust', 'cannon', 1)!;
    expect(cannon).not.toBeNull();
    let tagged = 0;
    cannon.traverse((o) => {
      if (o instanceof Mesh && isClanMaterial(o.material as MeshStandardMaterial)) tagged++;
    });
    expect(tagged).toBe(1);
    expect(clans.part('rust', 'engine', 1)).toBeNull(); // file missing → player part
    expect(clans.part('rust', 'cannon', 2)).toBeNull(); // no T2 entry → player part
    expect(clans.connector('rust', 'edge')).not.toBeNull();
    expect(clans.connector('rust', 'corner')).toBeNull();
    await clans.ensure('cauldron');
    expect(manifests).toBe(1);
    expect(clans.part('cauldron', 'cannon', 1)).toBeNull();
    expect(clans.version).toBe(2);
  });

  it('without loaders nothing loads (empty library, tests)', async () => {
    const clans = new ClanParts(null, null);
    await clans.ensure('rust');
    expect(clans.state('rust')).toBe('idle');
    expect(clans.part('rust', 'cannon', 1)).toBeNull();
  });
});

describe('liveries on clan parts', () => {
  it('the old pirate livery leaves clan materials alone', () => {
    const node = box();
    const mesh = node.children[0] as Mesh;
    const mat = mesh.material as MeshStandardMaterial;
    mat.userData.afClan = 'rust';
    applyLivery(node, 'pirate');
    expect(mesh.material).toBe(mat);
  });

  it('derelict shades are deterministic per wreck and part, within 0.7–1.0', () => {
    for (let part = 0; part < 40; part++) {
      const s = derelictShade(17, part);
      expect(s).toBe(derelictShade(17, part));
      expect(s).toBeGreaterThanOrEqual(0.7);
      expect(s).toBeLessThanOrEqual(1);
    }
    const spread = new Set(Array.from({ length: 40 }, (_, i) => derelictShade(17, i)));
    expect(spread.size).toBeGreaterThan(2);
    expect(DERELICT_SHADES[0]).toBe(0.7);
  });

  it('a derelict hull has no emission and parts get their own shade', () => {
    const root = new Group();
    const parts = [0, 1, 2, 3, 4, 5].map((id) => {
      const n = box();
      n.userData.afPart = id;
      const m = (n.children[0] as Mesh).material as MeshStandardMaterial;
      m.emissiveIntensity = 1;
      root.add(n);
      return n;
    });
    applyDerelict(root, 5);
    for (const n of parts) {
      const m = (n.children[0] as Mesh).material as MeshStandardMaterial;
      expect(m.emissiveIntensity).toBe(0);
      expect(m.color.r).toBeCloseTo(derelictShade(5, n.userData.afPart as number));
    }
  });
});

describe('restorePaletteBaseColor', () => {
  it('binds the shared base colour atlas to a palette material exported without it', async () => {
    const atlas = new Texture();
    const broken = new MeshStandardMaterial({ name: PALETTE_MATERIAL, roughnessMap: new Texture() });
    const fine = new MeshStandardMaterial({ name: PALETTE_MATERIAL, map: new Texture(), roughnessMap: new Texture() });
    const other = new MeshStandardMaterial({ name: 'AF_CometTail' });
    const root = new Group();
    for (const m of [broken, fine, other]) root.add(new Mesh(new BoxGeometry(), m));
    const n = await restorePaletteBaseColor(root, (kind) => Promise.resolve(kind === 'basecolor' ? atlas : null));
    expect(n).toBe(1);
    expect(broken.map).toBe(atlas);
    expect(fine.map).not.toBe(atlas);
    expect(other.map).toBeNull();
  });
});
