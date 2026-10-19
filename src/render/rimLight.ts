// Rim light on gameplay objects (readability pass, R4): a subtle Fresnel edge highlight on ships,
// asteroids, stations, wrecks and the other things on the gameplay plane, so their silhouettes read
// against the darker backdrop – stronger when the camera is zoomed out, where objects are only a few
// pixels. Patched into the objects' MeshStandardMaterials (onBeforeCompile, chained with any patch
// they already have); all patched materials share one strength / colour uniform, so the hangar (same
// part materials) simply turns it to zero.
//
// The patch changes the shader program, so it must be in place before a material is first drawn –
// otherwise the material compiles twice, once without the rim and again with it (audit 2026-10-16,
// issue #1). Objects added anywhere under a watched root are patched at once (`childadded`), a clone
// of a rim material keeps the rim (`cloneWithRim`), and a periodic scan catches material swaps.
import { Color, MeshStandardMaterial, type Material, type Object3D, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';

/** Rim strength (HDR emissive) at the closest and the farthest camera distance. */
export const RIM_NEAR = { distance: 28, strength: 0.16 };
export const RIM_FAR = { distance: 140, strength: 0.55 };
/** Fresnel exponent: higher = thinner rim. */
const RIM_POWER = 2.4;
/** How much of the rim takes the surface colour (0 = pure light colour). */
const RIM_ALBEDO = 0.45;
/** Seconds between scans for swapped materials (new objects are patched when they are added). */
const SCAN_INTERVAL = 0.4;

/** Rim strength for a camera distance (smoothstep between RIM_NEAR and RIM_FAR, flat outside). */
export function rimStrength(distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - RIM_NEAR.distance) / (RIM_FAR.distance - RIM_NEAR.distance)));
  const s = t * t * (3 - 2 * t);
  return RIM_NEAR.strength + (RIM_FAR.strength - RIM_NEAR.strength) * s;
}

/**
 * One strength / colour for every patched material of the page: the shared model templates outlive
 * a game, so a patch must never point at the uniforms of a renderer that is gone.
 */
const strength = { value: 0 };
const color = { value: new Color(1, 1, 1) };
const patched = new WeakSet<Material>();

/** The material carries the rim patch. */
export const hasRim = (material: Material): boolean => patched.has(material);

/**
 * Adds the rim to a MeshStandardMaterial (once; `userData.noRim` opts out). Returns whether it was
 * patched now.
 */
export function patchRim(material: Material): boolean {
  if (patched.has(material) || !(material instanceof MeshStandardMaterial) || material.userData.noRim) return false;
  patched.add(material);
  // a marker for other modules (shipBatch merges materials patched by the rim only); a clone copies
  // it, so the patch itself is tracked by `patched`, not by this flag
  material.userData.cinderRim = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (this: Material, shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) {
    prev.call(this, shader, renderer);
    shader.uniforms.uRimStrength = strength;
    shader.uniforms.uRimColor = color;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRimStrength;\nuniform vec3 uRimColor;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
{
  float rimF = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), ${RIM_POWER.toFixed(2)});
  totalEmissiveRadiance += uRimColor * mix(vec3(1.0), diffuseColor.rgb, ${RIM_ALBEDO.toFixed(2)}) * (rimF * uRimStrength);
}`,
      );
  };
  material.customProgramCacheKey = function (this: Material) {
    return `${prevKey.call(this)}|rim1`;
  };
  material.needsUpdate = true;
  return true;
}

/**
 * `material.clone()` with the rim kept: three's clone drops `onBeforeCompile`, so a clone of a rim
 * material would first compile without the rim (and the scan would patch it a frame later).
 */
export function cloneWithRim<T extends Material>(material: T): T {
  const copy = material.clone() as T;
  if (patched.has(material)) patchRim(copy);
  return copy;
}

function patchObject(o: Object3D): void {
  const m = (o as Object3D & { material?: Material | Material[] }).material;
  if (!m) return;
  if (Array.isArray(m)) for (const x of m) patchRim(x);
  else patchRim(m);
}

export class RimLight {
  private readonly roots: Object3D[] = [];
  /** Objects whose `childadded` this rim listens to (every node under a watched root). */
  private readonly listening = new WeakSet<Object3D>();
  private scanIn = 0;
  private readonly onChildAdded = (e: { child: Object3D | null }): void => {
    if (e.child) this.adopt(e.child);
  };

  /** Objects whose meshes get the rim – patched now and whenever something is added under them. */
  watch(...roots: Object3D[]): void {
    this.roots.push(...roots);
    for (const root of roots) this.adopt(root);
    this.scanIn = SCAN_INTERVAL;
  }

  /** Patches a subtree (the shader warm-up's samples) without watching it. */
  patchTree(root: Object3D): void {
    root.traverse(patchObject);
  }

  private adopt(root: Object3D): void {
    root.traverse((o) => {
      patchObject(o);
      if (this.listening.has(o)) return;
      this.listening.add(o);
      o.addEventListener('childadded', this.onChildAdded);
    });
  }

  /**
   * Once per space frame: `distance` = camera distance, `tint` = the zone's fill light colour (the
   * rim leans toward it, mostly white).
   */
  update(dt: number, distance: number, tint: Color): void {
    strength.value = rimStrength(distance);
    color.value.setRGB(1, 1, 1).lerp(tint, 0.35);
    this.scanIn -= dt;
    if (this.scanIn > 0) return;
    this.scanIn = SCAN_INTERVAL;
    this.scan();
  }

  /** Patches every material under the watched roots now (material swaps; the warm-up). */
  scan(): void {
    for (const root of this.roots) root.traverse(patchObject);
  }

  /** No rim (the hangar renders the same part materials). */
  off(): void {
    strength.value = 0;
  }

  /** Materials patched so far (tests). */
  has(material: Material): boolean {
    return patched.has(material);
  }
}
