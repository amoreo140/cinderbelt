// The post-processing chain of the game view: scene → GTAO (High) → bloom (blur chain only) → the final
// pass: bloom add + OutputPass (ACES, sRGB) + colour grade + vignette in one shader, FXAA inside it on
// Low (FinalPass, optimisation research R7). Bloom keeps its tuning; AO, the grade, the MSAA samples,
// FXAA and the bloom resolution follow the graphics quality (audit 2026-10-16, issue #6: the post chain's
// fill cost dominates on integrated GPUs). The hangar renders through the same chain with AO off and a
// neutral grade.
import { Color, HalfFloatType, ShaderMaterial, UniformsUtils, Vector2, WebGLRenderTarget, type Camera, type IUniform, type Scene, type Texture, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Grade } from '../env/zoneLook';
import type { QualityPreset } from '../quality';
import { AO_INTENSITY, AoPass } from './AoPass';
import { FinalPass, NEUTRAL_GRADE } from './FinalPass';
import type { GpuTimer } from '../gpuTimer';

/** Bloom: only emissive parts glow (lenses, engines, veins), not the white hull. */
export const BLOOM = { strength: 0.25, radius: 0.12, threshold: 0.95 };

/** Seconds AO takes to fade out when it is held off (the docked hub) and back in after. */
export const AO_HOLD_FADE = 0.4;

/**
 * The scene render with its own multisampled target (when `setSamples` > 0): resolved once, then
 * copied into the composer's single-sampled read buffer, so the later passes (AO blend, bloom blend)
 * write single-sampled targets – on a multisampled composer target each of them pays another MSAA
 * resolve. The copy is a full-screen HDR pass of its own, so this only pays with AO (two later
 * writers); see `PostStack.setQuality`.
 */
class MsaaRenderPass extends RenderPass {
  private readonly msaaTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 0 });
  private readonly copyMaterial = new ShaderMaterial({
    uniforms: UniformsUtils.clone(CopyShader.uniforms),
    vertexShader: CopyShader.vertexShader,
    fragmentShader: CopyShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  private readonly copyQuad = new FullScreenQuad(this.copyMaterial);

  /** MSAA samples (0 = draw straight into the composer's buffer). */
  setSamples(samples: number): void {
    if (this.msaaTarget.samples === samples) return;
    // the GPU buffers are rebuilt with the new sample count on the next use
    this.msaaTarget.samples = samples;
    this.msaaTarget.dispose();
  }

  override setSize(width: number, height: number): void {
    this.msaaTarget.setSize(width, height);
  }

  /** Allocates the multisampled target ahead of a frame (PostStack.prepare). */
  prepare(renderer: WebGLRenderer): void {
    if (this.msaaTarget.samples > 0) renderer.initRenderTarget(this.msaaTarget);
  }

  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    if (this.msaaTarget.samples === 0) {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      return;
    }
    super.render(renderer, writeBuffer, this.msaaTarget, deltaTime, maskActive);
    this.copyMaterial.uniforms.tDiffuse!.value = this.msaaTarget.texture;
    renderer.setRenderTarget(readBuffer);
    this.copyQuad.render(renderer);
  }

  override dispose(): void {
    this.msaaTarget.dispose();
    this.copyMaterial.dispose();
    this.copyQuad.dispose();
  }
}

/** Blur directions of the bloom's separable blur. */
const BLUR_X = new Vector2(1, 0);
const BLUR_Y = new Vector2(0, 1);

/**
 * UnrealBloomPass at a fraction of the composer size (its blur chain is pure fill cost) that stops at
 * the composited bloom: the additive blend over the scene target is part of the final pass (FinalPass).
 */
class ScaledBloomPass extends UnrealBloomPass {
  /** Resolution relative to the composer size. */
  scale = 1;
  private readonly quad = new FullScreenQuad();
  private readonly oldClearColor = new Color();

  /** The composited bloom (linear HDR, at the bloom's first mip size). */
  get texture(): Texture {
    return this.renderTargetsHorizontal[0]!.texture;
  }

  /** The render targets this pass draws into (allocated ahead of a frame, see PostStack.prepare). */
  targets(): WebGLRenderTarget[] {
    return [this.renderTargetBright, ...this.renderTargetsHorizontal, ...this.renderTargetsVertical];
  }

  override setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
  }

  /** UnrealBloomPass.render (three r186) up to the composite of the mips, without the blend. */
  override render(renderer: WebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, _deltaTime: number, maskActive: boolean): void {
    renderer.getClearColor(this.oldClearColor);
    const oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    if (maskActive) renderer.state.buffers.stencil.setTest(false);
    const quad = this.quad;
    // 1. the bright areas
    const high = this.highPassUniforms as Record<string, IUniform>;
    high.tDiffuse!.value = readBuffer.texture;
    high.luminosityThreshold!.value = this.threshold;
    quad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    quad.render(renderer);
    // 2. every mip blurred, each from the one before
    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const blur = this.separableBlurMaterials[i]!;
      quad.material = blur;
      blur.uniforms.colorTexture!.value = input.texture;
      blur.uniforms.direction!.value = BLUR_X;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]!);
      renderer.clear();
      quad.render(renderer);
      blur.uniforms.colorTexture!.value = this.renderTargetsHorizontal[i]!.texture;
      blur.uniforms.direction!.value = BLUR_Y;
      renderer.setRenderTarget(this.renderTargetsVertical[i]!);
      renderer.clear();
      quad.render(renderer);
      input = this.renderTargetsVertical[i]!;
    }
    // 3. the mips composited (FinalPass adds the result to the scene)
    const composite = this.compositeMaterial;
    quad.material = composite;
    composite.uniforms.bloomStrength!.value = this.strength;
    composite.uniforms.bloomRadius!.value = this.radius;
    composite.uniforms.bloomTintColors!.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]!);
    renderer.clear();
    quad.render(renderer);
    if (maskActive) renderer.state.buffers.stencil.setTest(true);
    renderer.setClearColor(this.oldClearColor, oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }

  override dispose(): void {
    super.dispose();
    this.quad.dispose();
  }
}

export class PostStack {
  readonly composer: EffectComposer;
  private readonly renderPass: MsaaRenderPass;
  private readonly bloom: ScaledBloomPass;
  /** Bloom add + output (tone mapping, sRGB) + grade, and FXAA when MSAA is off (the last pass). */
  private readonly final = new FinalPass();
  /** GPU time of the space view's frames (dynamic resolution); null = not measured. */
  private gpuTimer: GpuTimer | null = null;
  private ao: AoPass | null = null;
  private aoWanted = false;
  /** AO held off by `holdAo` and its current strength (0–1, fades by AO_HOLD_FADE). */
  private aoHeld = false;
  private aoLevel = 1;
  private aoScale = 1;
  private gradeWanted = true;
  private width = 1;
  private height = 1;
  /** Device pixels per CSS pixel of the canvas, and the share of them the scene and post targets render. */
  private pixelRatio = 1;
  private renderScale = 1;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {
    // HDR target; the MSAA samples follow the quality (setQuality), the canvas has no antialias of its
    // own (the composer never draws the scene into it)
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new MsaaRenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new ScaledBloomPass(new Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.composer.addPass(this.bloom);
    this.final.bloom = this.bloom.texture;
    this.composer.addPass(this.final);
  }

  setQuality(preset: QualityPreset): void {
    this.aoWanted = preset.ao;
    this.aoScale = preset.aoScale;
    this.gradeWanted = preset.grading;
    if (this.ao) {
      this.ao.enabled = this.aoWanted;
      this.ao.scale = this.aoScale;
      this.ao.setSize(this.width * this.targetRatio, this.height * this.targetRatio);
    }
    // MSAA in the scene pass's own target with AO (iGPU High: 16.8 → 12.9 ms of GPU per frame);
    // without AO nothing else writes the scene target (the bloom is added in the final pass), so there
    // the composer target stays multisampled and resolves once
    const ownTarget = preset.msaa > 0 && preset.ao;
    this.renderPass.setSamples(ownTarget ? preset.msaa : 0);
    const composerSamples = ownTarget ? 0 : preset.msaa;
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (t.samples === composerSamples) continue;
      // the GPU buffers are rebuilt with the new sample count on the next use
      t.samples = composerSamples;
      t.dispose();
    }
    this.final.fxaa = preset.fxaa;
    if (this.bloom.scale !== preset.bloomScale) {
      this.bloom.scale = preset.bloomScale;
      this.bloom.setSize(this.width * this.targetRatio, this.height * this.targetRatio);
    }
  }

  setGrade(grade: Grade): void {
    this.final.setGrade(this.gradeWanted ? grade : NEUTRAL_GRADE);
  }

  /**
   * Dynamic resolution: the scene and the post targets render at `scale` of the canvas resolution and the
   * final pass draws the canvas at its full size (a bilinear upscale; the grade and the dither stay at
   * native pixels). The canvas itself is not resized for it: a WebGL drawing-buffer resize waits for the
   * GPU (~120 ms on an iGPU at 4K).
   */
  setRenderScale(scale: number): void {
    if (this.renderScale === scale) return;
    this.renderScale = scale;
    this.setSize(this.width, this.height, this.pixelRatio);
  }

  /** Target pixels per CSS pixel: the canvas's pixel ratio times the render scale. */
  private get targetRatio(): number {
    return this.pixelRatio * this.renderScale;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    this.composer.setPixelRatio(this.targetRatio);
    this.composer.setSize(width, height);
  }

  private ensureAo(): AoPass {
    if (!this.ao) {
      this.ao = new AoPass(this.scene, this.camera, 1, 1);
      this.ao.scale = this.aoScale;
      this.composer.insertPass(this.ao, 1);
      this.ao.setSize(this.width * this.targetRatio, this.height * this.targetRatio);
    }
    return this.ao;
  }

  /**
   * AO held off: while docked the hub covers the right part of the screen and the camera stands still,
   * so the AO pre-pass (the scene drawn a second time) and its blur were a fifth of the docked frame (perf
   * audit 2026-10-17, P3). It fades out and back in (no pop); the warm-up never holds it.
   */
  holdAo(held: boolean): void {
    this.aoHeld = held;
  }

  /** Space view: AO per quality (unless held off), zone grade (set by setGrade). */
  render(dt: number): void {
    this.renderPass.scene = this.scene;
    this.renderPass.camera = this.camera;
    const level = this.aoHeld ? 0 : 1;
    if (this.aoLevel !== level) this.aoLevel = level > this.aoLevel ? Math.min(level, this.aoLevel + dt / AO_HOLD_FADE) : Math.max(level, this.aoLevel - dt / AO_HOLD_FADE);
    if (this.aoWanted) {
      const ao = this.ensureAo();
      ao.enabled = this.aoLevel > 0;
      ao.blendIntensity = AO_INTENSITY * this.aoLevel;
    } else if (this.ao) this.ao.enabled = false;
    this.gpuTimer?.begin();
    this.composer.render(dt);
    this.gpuTimer?.end();
  }

  /**
   * Measures the GPU time of the space view's frames (dynamic resolution, GameRenderer): the scene,
   * its shadow map and the post chain. Null stops measuring (the timer stays the caller's).
   */
  setGpuTimer(timer: GpuTimer | null): void {
    this.gpuTimer = timer;
  }

  /**
   * Allocates the render targets of the current size and quality now (after a resize between two
   * frames) instead of inside the next frame. Targets three would only create on first use.
   */
  prepare(): void {
    const targets = [this.composer.readBuffer, ...this.bloom.targets(), ...this.final.targets()];
    // AO's pass swaps the composer's buffers: both are drawn into every frame
    if (this.aoActive && this.ao?.enabled) targets.push(this.composer.writeBuffer);
    for (const t of targets) this.renderer.initRenderTarget(t);
    this.renderPass.prepare(this.renderer);
  }

  /** Another scene through the same chain (the hangar): no AO, neutral grade. */
  renderOther(scene: Scene, camera: Camera, dt: number): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    if (this.ao) this.ao.enabled = false;
    this.final.setGrade(NEUTRAL_GRADE);
    this.composer.render(dt);
  }

  /** AO is part of the chain at this quality (it may be held off right now, see holdAo). */
  get aoActive(): boolean {
    return this.aoWanted && this.ao !== null;
  }

  dispose(): void {
    // composer.dispose() frees only its own targets, not the added passes (their materials would
    // otherwise stay in the shader cache of the shared renderer)
    for (const pass of this.composer.passes) pass.dispose();
    // UnrealBloomPass.dispose() (three r186) forgets the luminance filter – it would hold the composer target
    this.bloom.materialHighPassFilter.dispose();
    this.composer.dispose();
  }
}
