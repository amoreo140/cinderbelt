// Screen-space ambient occlusion (GTAO from three's postprocessing) for the in-flight view. The
// normal/depth pre-pass only sees opaque lit geometry: points, lines, sprites, transparent and
// additive meshes (flames, glows, fog layers, shield bubbles, cloud shells) and anything marked
// `userData.noAO` are hidden, so effects never darken the hull behind them. Optional reduced
// resolution (`scale`) for cheaper presets. The pre-pass reuses this frame's shadow map instead of
// rendering it a second time (audit 2026-10-16, issue #3).
//
// The normal pre-pass draws every mesh with a MeshNormalMaterial of its kind (plain, instanced,
// batched, with or without per-instance colour) instead of three's one override material: with a
// single override, every switch between an instanced and a plain mesh made three resolve the
// program again (parameters object + cache key string per switch, every frame – issue #10).
import {
  Color,
  Mesh,
  MeshNormalMaterial,
  NoBlending,
  type Camera,
  type Material,
  type Object3D,
  type Scene,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

/** Tuned for the game scale (1 unit = 1 ship cell): crevices of the greeble pop, no halos on space. */
export const AO_PARAMS = {
  radius: 0.5,
  distanceExponent: 1.6,
  thickness: 0.8,
  distanceFallOff: 1,
  scale: 1,
  samples: 16,
};
export const AO_DENOISE = { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 10, rings: 2, samples: 16 };
export const AO_INTENSITY = 0.85;

function aoVisibleOne(m: Material): boolean {
  if (m.transparent || !m.depthWrite || m.userData.noAO) return false;
  return 'isMeshStandardMaterial' in m || 'isMeshPhysicalMaterial' in m || 'isMeshLambertMaterial' in m || 'isMeshPhongMaterial' in m;
}

// no array per mesh and frame for the usual single material
function aoVisible(material: Material | Material[]): boolean {
  if (!Array.isArray(material)) return aoVisibleOne(material);
  for (const m of material) if (!aoVisibleOne(m)) return false;
  return true;
}

/** Program-relevant kind of a mesh for the normal pass (bit mask – no string per mesh and frame). */
function kindOf(o: Mesh): number {
  const g = o.geometry;
  let k = g.attributes.normal ? 1 : 0;
  if (g.attributes.uv1) k |= 2;
  const inst = o as Mesh & { isInstancedMesh?: boolean; instanceColor?: unknown; isBatchedMesh?: boolean; _colorsTexture?: unknown };
  if (inst.isInstancedMesh) k |= inst.instanceColor ? 12 : 4;
  if (inst.isBatchedMesh) k |= inst._colorsTexture ? 48 : 16;
  return k;
}

export class AoPass extends GTAOPass {
  /**
   * Objects hidden from the pre-pass, meshes drawn with their kind's normal material and their own
   * materials – kept arrays with counts (setting `length = 0` drops V8's backing store, so the next
   * frame would grow it again: garbage every frame).
   */
  private readonly hiddenNow: (Object3D | null)[] = [];
  private hiddenCount = 0;
  private readonly swapped: (Mesh | null)[] = [];
  private readonly swappedFrom: (Material | Material[] | null)[] = [];
  private swappedCount = 0;
  private readonly normals: MeshNormalMaterial[] = [];
  private readonly clearColor = new Color();
  /** Resolution relative to the composer size. */
  scale = 1;

  constructor(scene: Scene, camera: Camera, width: number, height: number) {
    super(scene, camera, width, height);
    this.updateGtaoMaterial(AO_PARAMS);
    this.updatePdMaterial(AO_DENOISE);
    this.blendIntensity = AO_INTENSITY;
  }

  override setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
  }

  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    // the RenderPass before this one already drew the shadow map for this frame; the normal/depth
    // pre-pass would otherwise draw every caster into it again
    const shadows = renderer.shadowMap;
    const autoUpdate = shadows.autoUpdate;
    shadows.autoUpdate = false;
    // ...and it updated every world matrix of the scene: a second pass over the whole graph (all of it,
    // hidden subtrees too) was ~0.08 ms of a desktop frame, 0.3 ms at the 4× CPU throttle (perf audit
    // 2026-10-17, graveyard)
    const matrices = this.scene.matrixWorldAutoUpdate;
    this.scene.matrixWorldAutoUpdate = false;
    try {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      shadows.autoUpdate = autoUpdate;
      this.scene.matrixWorldAutoUpdate = matrices;
    }
  }

  /**
   * Replaces GTAOPass's own filter (it only hides points and lines) and gives each mesh its kind's normal
   * material. A walk that stops at invisible objects and at the ones it hides (audit 2026-10-17 P8):
   * nothing under them is drawn, so their subtrees – pooled effects, the `noAO` scenery groups, the
   * far-tier graveyard (`ShadowRig` switches `noAO` there, read here live every frame) – are not visited.
   */
  _overrideVisibility(): void {
    this.visit(this.scene);
  }

  private visit(o: Object3D): void {
    if (!o.visible) return;
    const mesh = o instanceof Mesh ? o : null;
    const hide = o.userData.noAO === true || !mesh || !aoVisible(mesh.material);
    if (hide && (mesh || (o as { isPoints?: boolean }).isPoints || (o as { isLine?: boolean }).isLine || (o as { isSprite?: boolean }).isSprite || o.userData.noAO === true)) {
      o.visible = false;
      this.hiddenNow[this.hiddenCount++] = o;
      return;
    }
    if (mesh) {
      this.swapped[this.swappedCount] = mesh;
      this.swappedFrom[this.swappedCount++] = mesh.material;
      mesh.material = this.normalFor(kindOf(mesh));
    }
    const children = o.children;
    for (let i = 0; i < children.length; i++) this.visit(children[i]!);
  }

  private normalFor(kind: number): MeshNormalMaterial {
    let m = this.normals[kind];
    if (!m) {
      m = new MeshNormalMaterial();
      m.blending = NoBlending;
      this.normals[kind] = m;
    }
    return m;
  }

  _restoreVisibility(): void {
    for (let i = 0; i < this.hiddenCount; i++) {
      this.hiddenNow[i]!.visible = true;
      this.hiddenNow[i] = null;
    }
    this.hiddenCount = 0;
    for (let i = 0; i < this.swappedCount; i++) {
      this.swapped[i]!.material = this.swappedFrom[i]!;
      this.swapped[i] = null;
      this.swappedFrom[i] = null;
    }
    this.swappedCount = 0;
  }

  /**
   * GTAOPass draws the normal pass with one override material; the meshes carry their own here
   * (`_renderOverride` is GTAOPass's internal name in three r186 – its typings call it renderOverride).
   */
  _renderOverride(renderer: WebGLRenderer, overrideMaterial: Material, renderTarget: WebGLRenderTarget, clearColor: number, clearAlpha: number): void {
    if (overrideMaterial !== this.normalMaterial) {
      (GTAOPass.prototype as unknown as { _renderOverride: AoPass['_renderOverride'] })._renderOverride.call(this, renderer, overrideMaterial, renderTarget, clearColor, clearAlpha);
      return;
    }
    renderer.getClearColor(this.clearColor);
    const alpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    renderer.setRenderTarget(renderTarget);
    renderer.autoClear = false;
    renderer.setClearColor(clearColor);
    renderer.setClearAlpha(clearAlpha);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
    renderer.setClearColor(this.clearColor);
    renderer.setClearAlpha(alpha);
  }

  override dispose(): void {
    super.dispose();
    for (const m of this.normals) m?.dispose();
  }
}
