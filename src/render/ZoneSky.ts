// Sky per zone: a dome with two panoramas (one per sector depth) that cross-fade smoothly when the
// player's sector changes depth, tinted by the sector environment (`tint`, cross-faded by the zone
// environment). The backdrop look (background brightness setting) dims, desaturates and compresses
// its highlights.
import {
  BackSide,
  Color,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  type Scene,
  type Texture,
  type Vector3,
} from 'three';
import type { RingIndex } from '../data/economy';
import type { BackdropLook } from './env/backdrop';
import {
  BACKGROUND_INTENSITY,
  ENVIRONMENT_INTENSITY,
  envFade,
  skyMix,
  type LoadedSkybox,
  type SkyboxCache,
} from './skybox';

/** Length of the sky cross-fade (s). */
const CROSSFADE_SECONDS = 2.5;
const DOME_RADIUS = 2500;

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// equirect UV as in three.js (equirectUv), rotated about the Y axis
const fragmentShader = /* glsl */ `
uniform sampler2D mapA;
uniform sampler2D mapB;
uniform float mixAB;
uniform float intensity;
uniform float rotation;
uniform float saturation;
uniform float knee;
uniform float highlight;
uniform vec3 tint;
varying vec3 vDir;
const float PI = 3.141592653589793;
vec2 equirect(vec3 d) {
  float u = atan(d.z, d.x) * (0.5 / PI) + 0.5;
  float v = asin(clamp(d.y, -1.0, 1.0)) * (1.0 / PI) + 0.5;
  return vec2(u, v);
}
void main() {
  vec3 d = normalize(vDir);
  float c = cos(rotation);
  float s = sin(rotation);
  d = vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
  vec2 uv = equirect(d);
  vec3 a = texture2D(mapA, uv).rgb;
  vec3 b = texture2D(mapB, uv).rgb;
  vec3 col = mix(a, b, mixAB);
  // stars and glow stars (bright) are compressed above the knee, the dim nebula keeps its tone
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float lc = l > knee ? knee + (l - knee) * highlight : l;
  col *= lc / max(l, 1e-5);
  col = mix(vec3(lc), col, saturation);
  gl_FragColor = vec4(col * tint * intensity, 1.0);
}
`;

interface Fade {
  from: LoadedSkybox;
  to: LoadedSkybox;
  toRing: RingIndex;
  t: number;
  envSwapped: boolean;
}

/**
 * Drives the skybox: lazy loading of the depths around the ship and a cross-fade without a jump.
 * The textures belong to the SkyboxCache (shared between games of one renderer) – ZoneSky does not free them.
 */
export class ZoneSky {
  private readonly requested = new Set<RingIndex>();
  private readonly loaded = new Map<RingIndex, LoadedSkybox>();
  private readonly dome: Mesh<SphereGeometry, ShaderMaterial>;
  private shown: { ring: RingIndex; sky: LoadedSkybox } | null = null;
  private fade: Fade | null = null;
  private disposed = false;
  /** Multiplier of the environment light (zone look – deeper shadows where the sun is harsh). */
  environmentScale = 1;
  /** Fade factor of the environment light (1 outside a cross-fade). */
  private envFadeNow = 1;
  private tintHex = 0xffffff;

  constructor(
    private readonly skyboxes: SkyboxCache,
    private readonly scene: Scene,
    /** Called when a skybox is applied for the first time (background, environment). */
    private readonly onFirstApply: (applied: { background: boolean; environment: boolean }) => void,
  ) {
    const material = new ShaderMaterial({
      uniforms: {
        mapA: { value: null },
        mapB: { value: null },
        mixAB: { value: 0 },
        intensity: { value: BACKGROUND_INTENSITY },
        rotation: { value: 0 },
        saturation: { value: 1 },
        knee: { value: 1 },
        highlight: { value: 1 },
        tint: { value: new Color(1, 1, 1) },
      },
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
    });
    this.dome = new Mesh(new SphereGeometry(DOME_RADIUS, 48, 24), material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.visible = false;
    scene.add(this.dome);
  }

  /** Tint of the panorama (sRGB hex multiplier) – the sector environment's, cross-faded. */
  setTint(hex: number): void {
    if (hex === this.tintHex) return;
    this.tintHex = hex;
    (this.dome.material.uniforms.tint!.value as Color).setHex(hex);
  }

  /** The depth shown now (or the target of the cross-fade). */
  get ring(): RingIndex | null {
    return this.fade?.toRing ?? this.shown?.ring ?? null;
  }

  /** Background brightness (readability): dimmer, less saturated, softer stars. */
  setBackdrop(look: BackdropLook): void {
    const u = this.dome.material.uniforms;
    u.intensity!.value = BACKGROUND_INTENSITY * look.sky;
    u.saturation!.value = look.skySaturation;
    u.knee!.value = look.skyKnee;
    u.highlight!.value = look.skyHighlight;
  }

  private request(ring: RingIndex): void {
    if (this.requested.has(ring)) return;
    this.requested.add(ring);
    void this.skyboxes.get(ring).then((sky) => {
      if (!this.disposed) this.loaded.set(ring, sky);
    });
  }

  /**
   * @param needed the depths whose panoramas should be loaded (the zone's and its neighbours')
   * @param ring the depth of the player's sector (with hysteresis)
   */
  update(needed: readonly RingIndex[], ring: RingIndex, dt: number, rotation: number, cameraPos: Vector3): void {
    this.request(ring);
    for (const r of needed) this.request(r);
    this.dome.position.copy(cameraPos);
    const u = this.dome.material.uniforms;
    u.rotation!.value = rotation;
    this.scene.environmentRotation.y = rotation;

    if (!this.shown) {
      const sky = this.loaded.get(ring);
      if (sky) this.showNow(ring, sky);
      return;
    }

    if (!this.fade && ring !== this.shown.ring) {
      const target = this.loaded.get(ring);
      if (target) this.fade = { from: this.shown.sky, to: target, toRing: ring, t: 0, envSwapped: false };
    }

    if (this.fade) {
      const f = this.fade;
      f.t = Math.min(1, f.t + dt / CROSSFADE_SECONDS);
      if (f.from.background && f.to.background) {
        u.mapA!.value = f.from.background;
        u.mapB!.value = f.to.background;
        u.mixAB!.value = skyMix(f.t);
      } else {
        this.setSingle(f.t < 0.5 ? f.from.background : f.to.background);
      }
      if (!f.envSwapped && f.t >= 0.5) {
        f.envSwapped = true;
        if (f.to.environment) this.scene.environment = f.to.environment;
      }
      this.envFadeNow = envFade(f.t);
      if (f.t >= 1) {
        this.shown = { ring: f.toRing, sky: f.to };
        this.fade = null;
        this.setSingle(f.to.background);
        this.envFadeNow = 1;
      }
    }
    this.scene.environmentIntensity = ENVIRONMENT_INTENSITY * this.envFadeNow * this.environmentScale;
  }

  private setSingle(texture: Texture | null): void {
    const u = this.dome.material.uniforms;
    u.mapA!.value = texture;
    u.mapB!.value = texture;
    u.mixAB!.value = 0;
    this.dome.visible = texture !== null;
  }

  private showNow(ring: RingIndex, sky: LoadedSkybox): void {
    this.shown = { ring, sky };
    this.setSingle(sky.background);
    if (sky.environment) {
      this.scene.environment = sky.environment;
      this.scene.environmentIntensity = ENVIRONMENT_INTENSITY * this.environmentScale;
    }
    this.onFirstApply({ background: sky.background !== null, environment: sky.environment !== null });
  }

  dispose(): void {
    this.disposed = true;
    this.loaded.clear();
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.dome.removeFromParent();
  }
}
