// Sun shadows (visual polish): one directional shadow map whose orthographic frustum is fitted every
// frame to what the camera sees of the gameplay plane (the view is top-down at a fixed pitch, so a
// single tight frustum covers it at every zoom – no cascades needed), snapped to whole texels so the
// edges do not shimmer while flying. Shadow flags are set on lit opaque meshes of the scene by a
// cheap periodic sweep, so every layer (stations, ships, asteroids, the fortress, wrecks, traffic)
// casts and receives without knowing about it; `userData.noShadow` opts out (planets, far layers).
//
// Far tier (perf audit 2026-10-17, P2.1): with the camera pulled far out (view distance past
// `FAR_TIER_IN`, back in below `FAR_TIER_OUT`) the subtrees marked `userData.farLite = true` (graveyard
// wrecks and their static batches, dormant sleepers, small casters: scatter rocks, rubble chips, mines,
// salvage) stop casting shadows and leave the AO pre-pass (`userData.noAO`, read by post/AoPass.ts) – at
// that zoom their contact shadows and crevices are a few pixels, while their triangles were most of a
// graveyard's frame in three passes. `farLite = 'ao'` (the asteroids) only leaves the AO pre-pass: a big
// rock's shadow still reads far out. They keep receiving shadows (a uniform, no new program variant).
// `setFarLite` flips a root at runtime.
import { BatchedMesh, InstancedMesh, Mesh, MeshDepthMaterial, PCFShadowMap, Vector3, type Camera, type DirectionalLight, type Material, type Object3D, type WebGLRenderer } from 'three';

/** Extra room around the visible footprint (world units) – casters just off-screen still cast in. */
const MARGIN = 10;
/** Casters reach this high above / below the plane (giant asteroids, station masts). */
const CASTER_HEIGHT = 14;
const MAX_EXTENT = 360;
/** Distance of the shadow camera from the fitted centre along the light. */
const LIGHT_DISTANCE = 220;
/** Re-tag the scene every this many frames. */
const SWEEP_FRAMES = 8;
/** View distance (camera to the plane along its axis) past which the far tier starts... */
export const FAR_TIER_IN = 105;
/** ...and below which it ends again (hysteresis: a zoom resting near one value never flaps). */
export const FAR_TIER_OUT = 95;

/** The far tier after a frame at view distance `distance`, given the tier of the frame before. */
export function farTier(far: boolean, distance: number): boolean {
  return far ? distance >= FAR_TIER_OUT : distance > FAR_TIER_IN;
}

const viewAxis = new Vector3();

/** View distance of the camera: along its axis down to the gameplay plane (Infinity = it does not look down). */
export function viewDistanceOf(camera: Camera): number {
  camera.getWorldDirection(viewAxis);
  return viewAxis.y < -1e-3 ? -camera.position.y / viewAxis.y : Infinity;
}

/** `userData.farLite`: true = no shadow casting and no AO in the far tier, 'ao' = no AO only, false = neither. */
export type FarLite = boolean | 'ao';

/**
 * Marks `root`'s subtree far-lite (`on`) or not – a dormant sleeper that wakes is a ship again. Its meshes
 * are tagged anew at the next sweep; leaving the tier gives the AO pass back at once.
 */
export function setFarLite(root: Object3D, on: FarLite): void {
  if (root.userData.farLite === on) return;
  root.userData.farLite = on;
  if (!on && root.userData.noAOBase !== undefined) root.userData.noAO = root.userData.noAOBase;
  root.traverse(untag);
}

function untag(o: Object3D): void {
  if (o.userData.shadowTagged !== undefined) o.userData.shadowTagged = null;
}

function hasFarLite(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.userData.farLite === true) return true;
  return false;
}

const NDC_CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

function litOpaqueOne(m: Material): boolean {
  if (m.transparent || !m.depthWrite || m.userData.noShadow) return false;
  return 'isMeshStandardMaterial' in m || 'isMeshLambertMaterial' in m || 'isMeshPhongMaterial' in m;
}

function litOpaque(material: Material | Material[]): boolean {
  if (!Array.isArray(material)) return litOpaqueOne(material);
  for (const m of material) if (!litOpaqueOne(m)) return false;
  return true;
}

/** Depth materials of plain casters, one per source material (a stable program each). */
const depthBySource = new WeakMap<Material, MeshDepthMaterial>();

/**
 * The material a caster draws into the shadow map with. three's default is one MeshDepthMaterial for
 * every caster, so each switch between an instanced, a batched and a plain mesh (or a different side
 * or map) re-resolved its program – a parameters object and a key string per switch, every frame
 * (audit 2026-10-16, issue #10). Instanced and batched meshes get their own (their per-instance colour
 * can appear later), plain ones share one per source material. Undefined = three's own handling
 * (alpha-tested, displaced or clipped materials get per-material clones there anyway).
 */
function depthMaterialFor(o: Mesh): MeshDepthMaterial | undefined {
  const m = o.material;
  if (Array.isArray(m)) return undefined;
  if ((m.alphaTest > 0 && ('map' in m || 'alphaMap' in m)) || m.alphaToCoverage || (m.clippingPlanes?.length ?? 0) > 0 || 'displacementMap' in m && (m as { displacementMap: unknown }).displacementMap) return undefined;
  if (o instanceof InstancedMesh || o instanceof BatchedMesh) return new MeshDepthMaterial();
  let d = depthBySource.get(m);
  if (!d) {
    d = new MeshDepthMaterial();
    depthBySource.set(m, d);
  }
  return d;
}

export class ShadowRig {
  private size = 0;
  private frame = 0;
  private readonly ray = new Vector3();
  private readonly hit = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly center = new Vector3();
  private readonly points: Vector3[] = Array.from({ length: 8 }, () => new Vector3());
  /** Bumped when the far tier flips: every mesh is tagged anew. */
  private generation = 0;
  /** Visible extent of the last fit (tests, tuning). */
  extent = 0;
  /** The far tier is on (see the header). */
  far = false;

  constructor(
    renderer: WebGLRenderer,
    private readonly light: DirectionalLight,
  ) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    light.castShadow = false;
  }

  get enabled(): boolean {
    return this.size > 0;
  }

  /** `mapSize` 0 = no shadows. */
  setQuality(mapSize: number, radius: number): void {
    if (mapSize !== this.size) {
      this.size = mapSize;
      const shadow = this.light.shadow;
      shadow.map?.dispose();
      shadow.map = null;
      if (mapSize > 0) shadow.mapSize.set(mapSize, mapSize);
      this.light.castShadow = mapSize > 0;
      // the light count of the shader changes – materials recompile through the lights state version
    }
    this.light.shadow.radius = radius;
    this.light.shadow.blurSamples = 8;
  }

  /** Fits the shadow frustum to the camera view. `lightDir` = unit direction toward the sun. */
  update(camera: Camera, lightDir: Vector3, root: Object3D): void {
    if (this.size <= 0) return;
    const sweep = this.frame++ % SWEEP_FRAMES === 0;
    // view distance: along the camera's axis down to the plane (the rig looks at its target on it)
    const far = farTier(this.far, viewDistanceOf(camera));
    if (far !== this.far) {
      this.far = far;
      this.generation++;
      this.tag(root);
    } else if (sweep) this.tag(root);

    // footprint of the view on the plane (corner rays), lifted / lowered by the caster height
    const origin = camera.position;
    let n = 0;
    for (const [x, y] of NDC_CORNERS) {
      this.ray.set(x, y, 0.5).unproject(camera).sub(origin).normalize();
      // rays that miss the plane (should not happen at the game pitch) clamp to a far point
      const t = this.ray.y < -1e-3 ? Math.min(-origin.y / this.ray.y, 900) : 900;
      this.hit.copy(origin).addScaledVector(this.ray, t);
      this.points[n++]!.copy(this.hit).setY(CASTER_HEIGHT);
      this.points[n++]!.copy(this.hit).setY(-CASTER_HEIGHT);
    }

    // light basis: right / up perpendicular to the light direction
    this.right.set(0, 1, 0).cross(lightDir).normalize();
    this.up.copy(lightDir).cross(this.right).normalize();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of this.points) {
      const a = p.dot(this.right);
      const b = p.dot(this.up);
      minX = Math.min(minX, a);
      maxX = Math.max(maxX, a);
      minY = Math.min(minY, b);
      maxY = Math.max(maxY, b);
    }
    // square frustum, size quantized to 8 units (no shimmer while zooming)
    let extent = Math.max(maxX - minX, maxY - minY) + MARGIN * 2;
    extent = Math.min(MAX_EXTENT, Math.ceil(extent / 8) * 8);
    this.extent = extent;
    const texel = extent / this.size;
    const cx = Math.round((minX + maxX) / 2 / texel) * texel;
    const cy = Math.round((minY + maxY) / 2 / texel) * texel;
    // centre on the plane: right·cx + up·cy, then along the light to y = 0
    this.center.copy(this.right).multiplyScalar(cx).addScaledVector(this.up, cy);
    const along = this.center.y / lightDir.y;
    this.center.addScaledVector(lightDir, -along);

    const shadow = this.light.shadow;
    const cam = shadow.camera;
    cam.left = -extent / 2;
    cam.right = extent / 2;
    cam.top = extent / 2;
    cam.bottom = -extent / 2;
    cam.near = 1;
    cam.far = LIGHT_DISTANCE * 2;
    cam.updateProjectionMatrix();
    this.light.target.position.copy(this.center);
    this.light.position.copy(this.center).addScaledVector(lightDir, LIGHT_DISTANCE);
    this.light.target.updateMatrixWorld();
    // acne on the flat-shaded hulls vs. peter-panning: depth bias in texels of the current fit
    shadow.bias = -0.0006;
    shadow.normalBias = texel * 1.4;
  }

  /** Tags `root` now (the shader warm-up: its samples must cast in the warm-up frame). */
  tagNow(root: Object3D): void {
    if (this.size > 0) this.tag(root);
  }

  /**
   * Lit opaque meshes cast and receive; additive / transparent effects and opted-out objects do not; in the
   * far tier far-lite subtrees only receive (and are hidden from the AO pass).
   */
  private tag(root: Object3D): void {
    root.traverse(this.tagOne);
  }

  /** The sweep's callback, made once (not a closure per sweep). */
  private readonly tagOne = (o: Object3D): void => {
    const lite = o.userData.farLite;
    if (lite !== undefined) {
      // a far-lite root's own noAO (scatter is never in the AO pass) stays
      const base = (o.userData.noAOBase ??= o.userData.noAO === true) as boolean;
      o.userData.noAO = base || (this.far && lite !== false);
    }
    if (!(o instanceof Mesh)) return;
    if (o.userData.shadowTagged === o.material && o.userData.shadowGeneration === this.generation) return;
    o.userData.shadowTagged = o.material;
    o.userData.shadowGeneration = this.generation;
    const on = o.userData.noShadow !== true && !hasNoShadowAncestor(o) && litOpaque(o.material);
    o.castShadow = on && !(this.far && hasFarLite(o));
    o.receiveShadow = on;
    if (on && !o.userData.ownDepth) {
      o.customDepthMaterial = depthMaterialFor(o);
      // an instanced or batched mesh keeps its own one across material swaps
      if (o instanceof InstancedMesh || o instanceof BatchedMesh) o.userData.ownDepth = true;
    }
  };
}

function hasNoShadowAncestor(o: Object3D): boolean {
  for (let p = o.parent; p; p = p.parent) if (p.userData.noShadow === true) return true;
  return false;
}
