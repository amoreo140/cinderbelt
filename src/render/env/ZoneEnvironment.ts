// The zone's surroundings (visual polish): the visible sun and the light it casts, the planets far
// below the plane with a slow parallax, the distant silhouette and fog layers, the dust colour, the
// sky tint and the colour grade – all from the zone look (zoneLook.ts) of the player's sector (depth +
// environment, sectors design §5.2) and cross-faded when the player crosses into a sector that looks
// different. A new crossing in the middle of a fade starts from the look shown at that moment.
import { Color, Group, Vector3, type BufferGeometry, type DirectionalLight, type HemisphereLight, type Mesh, type PerspectiveCamera } from 'three';
import type { RingIndex } from '../../data/economy';
import type { Biome } from '../../sim/regions/sectors';
import { SOFTWARE_LOW, type QualityPreset } from '../quality';
import { BACKGROUND_BRIGHTNESS_DEFAULT, backdropLook, type BackdropLook } from './backdrop';
import { DepthLayers } from './DepthLayers';
import { LandmarkLayer } from './LandmarkLayer';
import { planetAssetsReady, planetCatalog, planetTextureReady, type PlanetDef } from './planetAssets';
import { PlanetView, type PlanetLight } from './PlanetView';
import { SunFlare } from './SunFlare';
import {
  copyMixedLook,
  createMixedLook,
  keepOffCenter,
  LANDMARK_PLANETS,
  landmarkPlanetFade,
  zonePlanetOpacity,
  lightDirection,
  lookAheadAtDepth,
  mixLookInto,
  parallaxLag,
  ZONE_LOOKS,
  zoneLookFor,
  type Grade,
  type MixedLook,
  type PlanetSpec,
  type ZoneLook,
} from './zoneLook';
import type { WarmUpZoo } from '../warmup';

/** Length of the cross-fade between two zone looks (s). */
const FADE_SECONDS = 4;
/** Planet parallax: lag per travelled unit, and the travel at which it saturates. */
const PARALLAX_K = 0.25;
const PARALLAX_LIMIT = 1600;
/** Planets stay at least this far out (1 = the screen edge, ellipse) – never behind the ship. */
const OFF_CENTER = 0.72;
/** Nominal camera height above the plane for the screen extent at depth (default zoom). */
const CAMERA_HEIGHT = 23;
const TAN_HALF_FOV = Math.tan((25 * Math.PI) / 180);
const SIN_PITCH = Math.sin((55 * Math.PI) / 180);
const PITCH = 55;
/** Planets are lit dimmer than the gameplay plane: they sit deep in the haze and must not outshine it. */
const PLANET_LIGHT = 0.6;
/** Key of the landmark planets in the planet map (zone planets are keyed by depth 1–4). */
const LANDMARK_KEY = 0;

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

const approach = (v: number, target: number, step: number): number => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

interface ZoneLights {
  sun: DirectionalLight;
  fill: DirectionalLight;
  hemisphere: HemisphereLight;
}

interface PlanetEntry {
  view: PlanetView;
  light: PlanetLight;
}

/** The zone the player is in: the sector's depth (its panorama and planets) and environment. */
export interface ZoneRef {
  depth: RingIndex;
  environment: Biome;
}

export class ZoneEnvironment {
  readonly object = new Group();
  readonly sun = new SunFlare();
  readonly layers: DepthLayers;
  /** Far landmarks deep below the plane and the Echo light columns (readability §2). */
  readonly landmarks: LandmarkLayer;
  /** Unit direction toward the sun light (for the shadow rig and the light position). */
  readonly lightDir = new Vector3(0.4, 0.8, -0.4).normalize();
  /** The cross-faded look of this frame (grade, dust colour, sky tint…). */
  private readonly look: MixedLook = createMixedLook(ZONE_LOOKS[1]);
  /** The look the running cross-fade started from. */
  private readonly fromLook: MixedLook = createMixedLook(ZONE_LOOKS[1]);
  /** Multiplier of the skybox environment light this frame. */
  envScale = 1;
  private to: { key: string; depth: RingIndex; look: ZoneLook } | null = null;
  private fading = false;
  private t = 1;
  /** Planets by depth (1–4) and the landmark planets (LANDMARK_KEY). */
  private readonly planets = new Map<number, PlanetEntry[]>();
  /** Linear fade level (0..1) per planet key – survives a quality rebuild. */
  private readonly levels = new Map<number, number>();
  private catalog: Record<string, PlanetDef> | null = null;
  private readonly lightColor = new Color();
  private readonly ambient = new Color();
  private readonly tmp = new Vector3();
  private readonly tmpColor = new Color();
  private segments = 96;
  private detail = true;
  private textureSize = 2048;
  private planetsOn = true;
  /** Depths whose planet textures were requested (at the quality `prefetchedAt`). */
  private readonly prefetched = new Map<RingIndex, Promise<void>>();
  private prefetchedAt = '';
  private time = 0;
  private disposed = false;
  /** Background brightness setting (readability): dims the planets, sun, fog and silhouettes. */
  private backdrop: BackdropLook = backdropLook(BACKGROUND_BRIGHTNESS_DEFAULT);

  constructor(
    seed: number,
    private readonly lights: ZoneLights,
  ) {
    this.object.name = 'zone-environment';
    this.object.userData.noShadow = true;
    this.layers = new DepthLayers(seed);
    this.landmarks = new LandmarkLayer(seed);
    this.object.add(this.sun.object, this.layers.object, this.landmarks.object);
    void planetCatalog().then((c) => {
      if (!this.disposed) this.catalog = c;
    });
  }

  /** The cross-faded grade of this frame. */
  get grade(): Grade {
    return this.look.grade;
  }

  /** The cross-faded SpaceDust colour of this frame (hex). */
  get dust(): number {
    return this.look.dust;
  }

  /** The cross-faded sky panorama tint of this frame (hex multiplier). */
  get skyTint(): number {
    return this.look.skyTint;
  }

  /** Zone look key shown (or faded to) now and whether a cross-fade runs (tests, stats). */
  get zoneState(): { key: string | null; fading: boolean } {
    return { key: this.to?.key ?? null, fading: this.fading };
  }

  setBackdrop(look: BackdropLook): void {
    this.backdrop = look;
    this.landmarks.setDim(look.planets);
  }

  /**
   * What the first frame needs from the network: the planet catalogue and the gas-giant ring model
   * (the shader warm-up waits for them, bounded).
   */
  assetsReady(): Promise<void> {
    return planetAssetsReady();
  }

  /**
   * Starts decoding and uploading the planet textures of these depths – the current zone's and the
   * ones the ship may cross into next (SectorZoneTracker.depthsNear) – so a planet that fades in
   * after a crossing finds its textures on the GPU (audit 2026-10-16, issue #9). Cheap when nothing
   * changed; resolves when the textures are in (null before the catalogue).
   */
  prefetch(depths: readonly RingIndex[]): Promise<void> | null {
    if (!this.catalog || !this.planetsOn) return null;
    const quality = `${this.textureSize}:${this.detail}`;
    if (quality !== this.prefetchedAt) {
      this.prefetchedAt = quality;
      this.prefetched.clear();
    }
    const loads: Promise<void>[] = [];
    for (const depth of depths) {
      let done = this.prefetched.get(depth);
      if (!done) {
        const files: Promise<void>[] = [];
        for (const spec of ZONE_LOOKS[depth].planets) {
          const def = this.catalog[spec.kind];
          if (!def || (spec.minor && !this.detail)) continue;
          // the same textures (and sizes) PlanetView asks for
          files.push(planetTextureReady(def.albedo, false, this.textureSize));
          if (this.detail && def.normal) files.push(planetTextureReady(def.normal, true));
          if (def.emissive) files.push(planetTextureReady(def.emissive, false, this.textureSize));
          if (this.detail && def.clouds) files.push(planetTextureReady(def.clouds.texture, false, this.textureSize));
        }
        done = Promise.all(files).then(() => undefined);
        this.prefetched.set(depth, done);
      }
      loads.push(done);
    }
    return Promise.all(loads).then(() => undefined);
  }

  /**
   * Shader warm-up: one planet of every catalogue kind at this quality (body with its normal and
   * emissive variant, clouds, halo, rings – programs only, no textures loaded) and the landmarks'
   * materials. `palette` = a gameplay atlas mesh the landmark copies are made from.
   */
  warmUp(zoo: WarmUpZoo, palette: Mesh | null): void {
    this.landmarks.warmUp(zoo, palette);
    if (!this.catalog || !this.planetsOn) return;
    const light: PlanetLight = { dir: new Vector3(0, 1, 0), color: this.lightColor, ambient: this.ambient };
    for (const [kind, def] of Object.entries(this.catalog)) {
      if (kind.startsWith('_') || !def || typeof def !== 'object' || !('albedo' in def)) continue;
      const spec: PlanetSpec = { kind, radius: 1, depth: 0, offset: { x: 0, y: 0 }, tilt: { x: 0, z: 0 }, spin: 0, backlight: 0, rings: !!def.ringSystem };
      const view = new PlanetView(spec, def, light, 8, this.detail, this.textureSize, false);
      view.opacity = 1;
      view.group.traverse((o) => {
        const g = (o as { geometry?: BufferGeometry }).geometry;
        // the spheres are the sample's own; the ring geometry is the shared template's
        if (g?.type === 'SphereGeometry') zoo.geometry(g);
      });
      zoo.addBackdrop(view.group);
    }
  }

  /** The software-rasterizer Low (SOFTWARE_LOW) has no planets and no sun flare. */
  setQuality(preset: QualityPreset): void {
    const planets = preset !== SOFTWARE_LOW;
    this.sun.object.visible = planets;
    if (planets !== this.planetsOn) {
      this.planetsOn = planets;
      this.disposePlanets();
    }
    this.layers.setQuality(preset.debrisLayers, preset.fogLayers);
    this.landmarks.setQuality(preset);
    this.sun.setDetail(preset.fogLayers > 0);
    if (preset.planetSegments === this.segments && preset.planetDetail === this.detail && preset.planetTextureSize === this.textureSize) return;
    this.segments = preset.planetSegments;
    this.detail = preset.planetDetail;
    this.textureSize = preset.planetTextureSize;
    // rebuilt with the new detail on the next update; the fade levels are kept apart from the views
    this.disposePlanets();
  }

  private disposePlanets(): void {
    for (const entries of this.planets.values()) for (const e of entries) e.view.dispose();
    this.planets.clear();
  }

  private ensurePlanets(key: number, specs: readonly PlanetSpec[]): PlanetEntry[] | null {
    const have = this.planets.get(key);
    if (have) return have;
    if (!this.catalog || !this.planetsOn) return null;
    const entries: PlanetEntry[] = [];
    for (const spec of specs) {
      const def = this.catalog[spec.kind];
      if (!def || (spec.minor && !this.detail)) continue;
      // a planet with its own brightness gets its own light colours (scaled each frame)
      const own = spec.light !== undefined && spec.light !== 1;
      const light: PlanetLight = { dir: new Vector3(0, 1, 0), color: own ? new Color() : this.lightColor, ambient: own ? new Color() : this.ambient };
      const view = new PlanetView(spec, def, light, this.segments, this.detail, this.textureSize);
      this.object.add(view.group);
      entries.push({ view, light });
    }
    this.planets.set(key, entries);
    return entries;
  }

  /**
   * @param zone the zone of the player's sector (with hysteresis – SectorZoneTracker)
   * @param target the point the camera looks at on the gameplay plane
   */
  update(zone: ZoneRef, camera: PerspectiveCamera, target: Vector3, dt: number): void {
    this.time += dt;
    const key = `${zone.depth}:${zone.environment}`;
    if (this.to === null) {
      // the first frame (a new game, a loaded save): the zone is set silently
      this.to = { key, depth: zone.depth, look: zoneLookFor(zone.depth, zone.environment) };
      mixLookInto(this.look, null, this.to.look, 1);
      this.levels.set(zone.depth, 1);
    } else if (key !== this.to.key) {
      copyMixedLook(this.fromLook, this.look);
      this.to = { key, depth: zone.depth, look: zoneLookFor(zone.depth, zone.environment) };
      this.fading = true;
      this.t = 0;
    }
    // outside a fade the look already is the target's (t = 1 copies it exactly)
    if (this.fading) {
      this.t = Math.min(1, this.t + dt / FADE_SECONDS);
      mixLookInto(this.look, this.fromLook, this.to.look, smooth(this.t));
      if (this.t >= 1) this.fading = false;
    }
    const look = this.look;

    // sun sprite and the light from its azimuth
    this.sun.brightness = this.backdrop.sun;
    this.sun.update(camera, look.sunNdcX, look.sunNdcY, look.sunColor, look.sunSize, dt);
    const d = lightDirection(this.sun.direction.x, this.sun.direction.z, look.sunElevationDeg);
    this.lightDir.set(d.x, d.y, d.z);

    const { sun, fill, hemisphere } = this.lights;
    sun.color.setHex(look.sunLightColor);
    sun.intensity = look.sunLightIntensity;
    fill.color.setHex(look.fillColor);
    fill.intensity = look.fillIntensity;
    hemisphere.color.setHex(look.hemiSky);
    hemisphere.groundColor.setHex(look.hemiGround);
    hemisphere.intensity = look.hemiIntensity;
    this.envScale = look.envScale;

    // planets: HDR light of the sun colour, a faint ambient of the fill colour
    this.lightColor.copy(sun.color).multiplyScalar(PLANET_LIGHT * this.backdrop.planets);
    this.ambient.copy(this.tmpColor.setHex(look.fillColor)).multiplyScalar(0.035);
    this.updatePlanets(camera, target, dt);

    this.layers.setZone(zone.depth, this.to.look.debris);
    this.layers.update(target, dt, look.haze, look.hazeStrength * this.backdrop.haze, look.nebula, look.nebulaOpacity * this.backdrop.fog, this.backdrop.debris);
    this.landmarks.update(camera, target, dt, look.haze);
  }

  /**
   * Zone planets fade with the depth (the current depth's in, the others out over the cross-fade);
   * the landmark planets fade with the camera's distance from their anchor, whatever the zone, and
   * while one is in view the zone's major planet gives way to it (`zonePlanetOpacity`).
   */
  private updatePlanets(camera: PerspectiveCamera, target: Vector3, dt: number): void {
    const step = dt / FADE_SECONDS;
    const toDepth = this.to!.depth;
    for (const [k, level] of this.levels) {
      if (k === LANDMARK_KEY) continue;
      this.levels.set(k, approach(level, k === toDepth ? 1 : 0, step));
    }
    if (!this.levels.has(toDepth)) this.levels.set(toDepth, 0);

    // landmark planets: the nearest anchor decides (one gas giant today)
    let sight = 0;
    for (const spec of LANDMARK_PLANETS) {
      const site = spec.landmark ? this.landmarks.siteOf(spec.landmark) : null;
      const fade = site ? landmarkPlanetFade(Math.hypot(site.pos.x - target.x, -site.pos.y - target.z)) : 0;
      sight = Math.max(sight, fade);
    }
    const landmarkLevel = this.levels.get(LANDMARK_KEY);
    this.levels.set(LANDMARK_KEY, landmarkLevel === undefined ? sight : approach(landmarkLevel, sight, step));

    const landmarkShown = smooth(this.levels.get(LANDMARK_KEY) ?? 0);
    for (const [k, level] of this.levels) {
      if (level <= 0) {
        // a finished fade frees the planets of that key
        const entries = this.planets.get(k);
        if (entries) {
          for (const e of entries) e.view.dispose();
          this.planets.delete(k);
        }
        if (k !== toDepth && k !== LANDMARK_KEY) this.levels.delete(k);
        continue;
      }
      const entries = this.ensurePlanets(k, k === LANDMARK_KEY ? LANDMARK_PLANETS : ZONE_LOOKS[k as RingIndex].planets);
      if (entries) this.placePlanets(entries, smooth(level), k === LANDMARK_KEY ? 0 : landmarkShown, camera, target, dt);
    }
  }

  private placePlanets(entries: readonly PlanetEntry[], opacity: number, landmark: number, camera: PerspectiveCamera, target: Vector3, dt: number): void {
    const lag = parallaxLag({ x: target.x, y: target.z }, PARALLAX_K, PARALLAX_LIMIT);
    for (const e of entries) {
      const spec = e.view.spec;
      e.view.opacity = zonePlanetOpacity(opacity, landmark, spec.minor === true);
      // half the view on the planet's depth plane (nominal zoom) – the planet keeps off its middle
      const dist = (spec.depth + CAMERA_HEIGHT) / SIN_PITCH;
      const half = { x: dist * TAN_HALF_FOV * camera.aspect, y: (dist * TAN_HALF_FOV) / SIN_PITCH };
      const site = spec.landmark ? this.landmarks.siteOf(spec.landmark) : null;
      if (site) {
        // a world-anchored compass (the gas giant): true parallax, it may pass behind the ship
        e.view.group.position.set(site.pos.x, -spec.depth, -site.pos.y);
      } else {
        const d = keepOffCenter({ x: spec.offset.x - lag.x, y: spec.offset.y - lag.y }, half, OFF_CENTER, spec.offset);
        e.view.group.position.set(target.x + d.x, -spec.depth, target.z - lookAheadAtDepth(spec.depth, PITCH) + d.y);
      }
      e.light.dir.copy(this.lightDir).lerp(this.tmp.copy(this.sun.direction), spec.backlight).normalize();
      if (e.light.color !== this.lightColor) {
        e.light.color.copy(this.lightColor).multiplyScalar(spec.light ?? 1);
        e.light.ambient.copy(this.ambient).multiplyScalar(spec.light ?? 1);
      }
      e.view.update(dt, this.time);
    }
  }

  /** Planets currently in the scene (tests). */
  planetCount(): number {
    let n = 0;
    for (const entries of this.planets.values()) n += entries.filter((e) => e.view.group.visible).length;
    return n;
  }

  dispose(): void {
    this.disposed = true;
    this.disposePlanets();
    this.sun.dispose();
    this.layers.dispose();
    this.landmarks.dispose();
    this.object.removeFromParent();
  }
}
