// Pirate clan part sets (art/README §2.7.21, legibility plan §3): every clan has its own
// models for the parts pirate ships fly, with the player's footprint, nodes and pivots. Visual only –
// the part keeps its PartId/tier (and drops as the player's part). The sets load lazily: a clan's
// files are fetched the first time a ship of that clan shows up; until then (and for any part the
// manifest does not cover) the ship uses the player's part.
import { Mesh, type Material, type Object3D } from 'three';
import type { FactionId } from '../../data/factions';
import type { PartId, Tier } from '../../data/parts';
import type { ConnectorKind } from './catalog';

export const CLAN_MANIFEST_PATH = 'assets/models/parts_pirate/manifest.json';

/** The parts of `public/assets/models/parts_pirate/manifest.json` the game reads. */
export interface ClanManifest {
  /** clan → PartId → tier ("1" | "2") → asset path (relative to BASE_URL). */
  parts: Partial<Record<string, Partial<Record<string, Partial<Record<string, string>>>>>>;
  /** clan → hull connectors in clan colours. */
  connectors: Partial<Record<string, Partial<Record<ConnectorKind, string>>>>;
}

/** Model path of a clan's part, or null = use the player's part (no entry for that clan/part/tier). */
export function clanPartPath(manifest: ClanManifest, clan: FactionId, partId: PartId, tier: Tier): string | null {
  return manifest.parts[clan]?.[partId]?.[String(tier)] ?? null;
}

/** Model path of a clan's hull connector, or null = the player's connector. */
export function clanConnectorPath(manifest: ClanManifest, clan: FactionId, kind: ConnectorKind): string | null {
  return manifest.connectors[clan]?.[kind] ?? null;
}

/** Every file of a clan's set (parts of all tiers + connectors), without duplicates. */
export function clanSetPaths(manifest: ClanManifest, clan: FactionId): string[] {
  const out = new Set<string>();
  for (const tiers of Object.values(manifest.parts[clan] ?? {})) for (const path of Object.values(tiers ?? {})) if (path) out.add(path);
  for (const path of Object.values(manifest.connectors[clan] ?? {})) if (path) out.add(path);
  return [...out];
}

/** Material of a clan part: the old `pirate` livery must not touch it (combat/livery.ts). */
export const isClanMaterial = (m: Material): boolean => typeof m.userData.afClan === 'string';

function tagClan(scene: Object3D, clan: FactionId): void {
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.userData.afClan = clan;
  });
}

export type ClanSetStatus = 'idle' | 'loading' | 'ready';

/** Loads one model (null = missing or broken – the player's part is used). */
export type SceneLoader = (path: string) => Promise<Object3D | null>;
export type ManifestLoader = () => Promise<ClanManifest | null>;

/** Lazily loaded clan part sets. Without loaders (tests, ModelLibrary.empty) nothing ever loads. */
export class ClanParts {
  private manifest: Promise<ClanManifest | null> | null = null;
  private readonly status = new Map<FactionId, ClanSetStatus>();
  private readonly models = new Map<string, Object3D>();
  /** The manifest a ready set was loaded from (null = none – the player's parts). */
  private readonly byClan = new Map<FactionId, ClanManifest | null>();
  /** Load time of each finished set (ms, debugging and the e2e check). */
  readonly loadMs = new Map<FactionId, number>();
  /** Bumps whenever a set finishes loading (views built before it rebuild). */
  version = 0;
  /** Sets still loading (the shader warm-up waits for them). */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly loadScene: SceneLoader | null,
    private readonly loadManifest: ManifestLoader | null,
  ) {}

  state(clan: FactionId): ClanSetStatus {
    return this.status.get(clan) ?? 'idle';
  }

  ready(clan: FactionId): boolean {
    return this.state(clan) === 'ready';
  }

  /** Starts loading a clan's set (once); resolves when it is ready. Never rejects. */
  ensure(clan: FactionId): Promise<void> {
    if (!this.loadScene || !this.loadManifest || this.status.has(clan)) return Promise.resolve();
    this.status.set(clan, 'loading');
    const load = this.loadScene;
    const t0 = performance.now();
    this.manifest ??= this.loadManifest().catch((e: unknown) => {
      console.warn('Pirate clan manifest failed to load – pirates use the standard parts', e);
      return null;
    });
    const done = this.manifest.then(async (manifest) => {
      const paths = manifest ? clanSetPaths(manifest, clan) : [];
      const scenes = await Promise.all(paths.map((p) => load(p).catch(() => null)));
      paths.forEach((path, i) => {
        const scene = scenes[i];
        if (!scene) return;
        tagClan(scene, clan);
        this.models.set(path, scene);
      });
      this.byClan.set(clan, manifest);
      this.status.set(clan, 'ready');
      this.loadMs.set(clan, performance.now() - t0);
      this.version++;
    });
    this.inFlight.add(done);
    void done.finally(() => this.inFlight.delete(done));
    return done;
  }

  /** Resolves when every set requested so far has loaded. */
  settled(): Promise<void> {
    return Promise.all([...this.inFlight]).then(() => undefined);
  }

  /** The loaded templates (clone, do not modify) – the shader warm-up's samples. */
  templates(): Object3D[] {
    return [...this.models.values()];
  }

  /** Template of a clan's part (clone, do not modify), or null → the player's part. */
  part(clan: FactionId, partId: PartId, tier: Tier): Object3D | null {
    const manifest = this.byClan.get(clan);
    const path = manifest ? clanPartPath(manifest, clan, partId, tier) : null;
    return (path ? this.models.get(path) : undefined) ?? null;
  }

  /** Template of a clan's hull connector, or null → the player's connector. */
  connector(clan: FactionId, kind: ConnectorKind): Object3D | null {
    const manifest = this.byClan.get(clan);
    const path = manifest ? clanConnectorPath(manifest, clan, kind) : null;
    return (path ? this.models.get(path) : undefined) ?? null;
  }
}
