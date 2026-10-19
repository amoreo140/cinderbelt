// The tail of the post chain in ONE full-screen pass (optimisation research R7): the bloom add, three's
// OutputPass (tone mapping, sRGB) and the per-zone colour grade + vignette (visual polish). The bloom used
// to be blended additively into the HDR scene target first – a full-screen pass of its own and, on
// Medium, another resolve of the 2x MSAA target; now the final pass samples the composited bloom and
// adds it before the tone mapping (the same order: bloom on linear HDR colour).
// The grade works on display-referred colour: contrast around mid grey, lift (tinted shadows) and gain
// (tinted highlights), saturation, a soft elliptical vignette and a 1/255 dither against banding in the
// dark nebula gradients.
// With FXAA (Low) the graded image goes to an RGBA8 target (FXAA used to read a HalfFloat target,
// ~1.8 ms on an iGPU) and FXAA draws it to the screen.
import { DataTexture, ShaderMaterial, UniformsUtils, Vector3, WebGLRenderTarget, type Texture, type WebGLRenderer } from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { Grade } from '../env/zoneLook';

const FINAL_PARS = /* glsl */ `
uniform sampler2D tBloom;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform float uAspect;
uniform float uSeed;
float gradeHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453);
}
`;

/** The bloom add: what UnrealBloomPass's additive blend (ONE, ONE) did to the HDR target. */
const BLOOM_ADD = /* glsl */ `
  gl_FragColor += texture2D(tBloom, vUv);
`;

const GRADE_MAIN = /* glsl */ `
  {
    vec3 c = clamp(gl_FragColor.rgb, 0.0, 1.0);
    c = (c - 0.5) * uContrast + 0.5;
    c = c * uGain + uLift * (1.0 - c);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSaturation);
    vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
    c *= 1.0 - uVignette * smoothstep(0.42, 1.15, length(d) * 1.25);
    c += (gradeHash(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor.rgb = clamp(c, 0.0, 1.0);
  }
`;

/** Neutral grade (hangar, or grading off). */
export const NEUTRAL_GRADE: Grade = { lift: [0, 0, 0], gain: [1, 1, 1], saturation: 1, contrast: 1, vignette: 0 };

/** A black 1x1 bloom until the chain hands over its bloom texture. */
const NO_BLOOM = new DataTexture(new Uint8Array(4), 1, 1);
NO_BLOOM.needsUpdate = true;

/** OutputPass whose shader also adds the bloom and grades; the last pass of the chain (FXAA inside). */
export class FinalPass extends OutputPass {
  /** Edge smoothing on the graded image (Low: no MSAA). */
  private fxaaOn = false;
  /** The graded image for FXAA: 8 bits per channel are all FXAA and the screen need. */
  private readonly ldr = new WebGLRenderTarget(1, 1, { depthBuffer: false });
  private readonly fxaaMaterial = new ShaderMaterial({
    name: 'FinalFXAA',
    uniforms: UniformsUtils.clone(FXAAShader.uniforms),
    vertexShader: FXAAShader.vertexShader,
    // sharper and cheaper than three's defaults: half the sub-pixel blending (full blending smears
    // the printed part icons) and the 'high quality' contrast threshold (more flat pixels skipped)
    fragmentShader: FXAAShader.fragmentShader.replace('_SubpixelBlending = 1.0', '_SubpixelBlending = 0.5').replace('_ContrastThreshold = 0.0312', '_ContrastThreshold = 0.0625'),
    depthTest: false,
    depthWrite: false,
  });
  private readonly fxaaQuad = new FullScreenQuad(this.fxaaMaterial);

  constructor() {
    super();
    this.material.name = 'FinalPass';
    Object.assign(this.uniforms, {
      tBloom: { value: NO_BLOOM },
      uLift: { value: new Vector3() },
      uGain: { value: new Vector3(1, 1, 1) },
      uSaturation: { value: 1 },
      uContrast: { value: 1 },
      uVignette: { value: 0 },
      uAspect: { value: 1 },
      uSeed: { value: 0 },
    });
    const fs = this.material.fragmentShader;
    // declarations after the varying, the bloom right after the HDR sample (before the tone mapping),
    // the grade at the very end of main()
    this.material.fragmentShader = fs
      .replace('varying vec2 vUv;', `varying vec2 vUv;\n${FINAL_PARS}`)
      .replace('gl_FragColor = texture2D( tDiffuse, vUv );', `gl_FragColor = texture2D( tDiffuse, vUv );\n${BLOOM_ADD}`)
      .replace(/\}\s*$/, `${GRADE_MAIN}}`);
    this.material.needsUpdate = true;
  }

  /** The composited bloom (linear HDR) added to the scene. */
  set bloom(texture: Texture | null) {
    this.uniforms.tBloom!.value = texture ?? NO_BLOOM;
  }

  get fxaa(): boolean {
    return this.fxaaOn;
  }

  set fxaa(on: boolean) {
    if (this.fxaaOn === on) return;
    this.fxaaOn = on;
    // the RGBA8 target is rebuilt on its next use
    if (!on) this.ldr.dispose();
  }

  setGrade(g: Grade): void {
    const u = this.uniforms;
    (u.uLift!.value as Vector3).set(g.lift[0], g.lift[1], g.lift[2]);
    (u.uGain!.value as Vector3).set(g.gain[0], g.gain[1], g.gain[2]);
    u.uSaturation!.value = g.saturation;
    u.uContrast!.value = g.contrast;
    u.uVignette!.value = g.vignette;
  }

  override setSize(width: number, height: number): void {
    this.uniforms.uAspect!.value = height > 0 ? width / height : 1;
    this.ldr.setSize(width, height);
    (this.fxaaMaterial.uniforms.resolution!.value as { set(x: number, y: number): void }).set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }

  /** The render targets this pass draws into (allocated ahead of a frame, see PostStack.prepare). */
  targets(): WebGLRenderTarget[] {
    return this.fxaaOn ? [this.ldr] : [];
  }

  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    // the dither pattern changes every frame (no fixed screen-door pattern)
    this.uniforms.uSeed!.value = ((this.uniforms.uSeed!.value as number) + 0.618) % 7;
    if (!this.fxaaOn) {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      return;
    }
    // bloom + output + grade into the RGBA8 target, FXAA from there to the screen (or the next buffer)
    const toScreen = this.renderToScreen;
    this.renderToScreen = false;
    super.render(renderer, this.ldr, readBuffer, deltaTime, maskActive);
    this.renderToScreen = toScreen;
    this.fxaaMaterial.uniforms.tDiffuse!.value = this.ldr.texture;
    renderer.setRenderTarget(toScreen ? null : writeBuffer);
    this.fxaaQuad.render(renderer);
  }

  override dispose(): void {
    super.dispose();
    this.ldr.dispose();
    this.fxaaMaterial.dispose();
    this.fxaaQuad.dispose();
  }
}
