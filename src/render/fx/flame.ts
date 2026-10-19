// Engine flame (M3a): a strip facing the camera around the exhaust axis, colour from flame_gradient.png
// (top = nozzle, hot), the edges and tail are broken up by a scrolling flame_noise.png. Additive
// blending, HDR brightness → bloom. The length is driven by the mesh's scale.y, the brightness by `setFlameIntensity`.
import { AdditiveBlending, Color, DoubleSide, Mesh, PlaneGeometry, ShaderMaterial, type BufferGeometry } from 'three';
import { vfxTexture } from './textures';

const VERTEX = /* glsl */ `
uniform float uWidth;
varying vec2 vUv;
void main() {
  // strip from the nozzle (y = 0) to the end (y = 1) along the local +Y axis, turned to the camera
  vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 along = mat3(modelMatrix) * vec3(0.0, 1.0, 0.0);
  vec3 axis = normalize(along);
  vec3 toCam = normalize(cameraPosition - base);
  vec3 side = cross(axis, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  // at the nozzle the strip is narrower, it widens and narrows towards the end
  float taper = mix(0.75, 1.0, smoothstep(0.0, 0.25, position.y));
  vec3 world = base + along * position.y + side * position.x * uWidth * taper;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  vUv = vec2(position.x + 0.5, position.y);
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uGradient;
uniform sampler2D uNoise;
uniform float uTime;
uniform float uIntensity;
uniform vec3 uTint;
varying vec2 vUv;
void main() {
  float along = vUv.y;
  vec2 n = texture2D(uNoise, vec2(vUv.x * 0.7 + 0.13, along * 0.9 - uTime * 2.6)).rg;
  float wobble = (n.r - 0.5) * 0.35 * smoothstep(0.05, 0.6, along);
  vec2 guv = vec2(clamp(vUv.x + wobble, 0.0, 1.0), 1.0 - along);
  vec4 g = texture2D(uGradient, guv);
  float erosion = smoothstep(0.15 + 0.5 * along, 0.85, n.g + 0.35 * (1.0 - along));
  float a = g.a * mix(1.0, erosion, smoothstep(0.1, 0.7, along)) * uIntensity;
  vec3 rgb = g.rgb * uTint * (1.3 + 1.2 * (1.0 - along));
  gl_FragColor = vec4(rgb * a, 1.0);
}`;

/** Strip geometry: width 1 (x ∈ ±½), length 1 (y ∈ 0…1), a few rows for the narrowing. */
export function createFlameGeometry(): BufferGeometry {
  return new PlaneGeometry(1, 1, 1, 6).translate(0, 0.5, 0);
}

export function createFlameMaterial(width = 0.62, tint = new Color(1, 0.86, 0.7)): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uGradient: { value: vfxTexture('flame_gradient') },
      uNoise: { value: vfxTexture('flame_noise') },
      uTime: { value: Math.random() * 10 },
      uIntensity: { value: 1 },
      uWidth: { value: width },
      uTint: { value: tint },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    forceSinglePass: true,
    blending: AdditiveBlending,
  });
}

/** Flame brightness of the given mesh (shared material – set just before it is drawn). */
export function setFlameIntensity(mesh: Mesh, intensity: number): void {
  mesh.userData.flameIntensity = intensity;
  if (!mesh.userData.flameHooked) {
    mesh.userData.flameHooked = true;
    mesh.onBeforeRender = (_r, _s, _c, _g, material) => {
      const m = material as ShaderMaterial;
      m.uniforms.uIntensity!.value = mesh.userData.flameIntensity as number;
      m.uniformsNeedUpdate = true;
    };
  }
}

export function advanceFlame(material: ShaderMaterial, dt: number): void {
  material.uniforms.uTime!.value += dt;
}
