// A planet far below the gameplay plane (visual polish): the textured sphere (albedo, normal and
// emissive maps from planets.json, lit by its own light direction so it shows a terminator), an
// inner atmosphere rim, a cloud shell, an outer halo brighter on the lit side and, for the gas
// giant, the ring system with the planet's shadow across it. `opacity` fades the whole planet in
// and out across zone changes. Not a shadow caster, invisible to AO.
import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { PlanetSpec } from './zoneLook';
import { planetTexture, ringTemplate, type PlanetDef } from './planetAssets';

const COMMON_VERTEX = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const BODY_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
#ifdef USE_NMAP
uniform sampler2D uNormalMap;
uniform float uNormalScale;
#endif
#ifdef USE_EMAP
uniform sampler2D uEmissiveMap;
uniform float uEmissive;
#endif
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uAtmColor;
uniform float uAtmDensity;
uniform float uOpacity;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec2 vUv;
void main() {
  vec3 N0 = normalize(vNormalW);
  vec3 N = N0;
#ifdef USE_NMAP
  vec3 q0 = dFdx(vPosW);
  vec3 q1 = dFdy(vPosW);
  vec2 st0 = dFdx(vUv);
  vec2 st1 = dFdy(vUv);
  vec3 q1perp = cross(q1, N0);
  vec3 q0perp = cross(N0, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  vec3 mapN = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
  mapN.xy *= uNormalScale;
  N = normalize(T * (mapN.x * s) + B * (mapN.y * s) + N0 * mapN.z);
#endif
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 albedo = texture2D(uMap, vUv).rgb;
  float ndl = dot(N, uLightDir);
  float ndl0 = dot(N0, uLightDir);
  float diff = clamp((ndl + 0.04) / 1.04, 0.0, 1.0) * smoothstep(-0.12, 0.08, ndl0);
  vec3 col = albedo * (uLightColor * diff + uAmbient);
  // warm scattering along the terminator
  float term = smoothstep(-0.18, 0.0, ndl0) * (1.0 - smoothstep(0.0, 0.3, ndl0));
  col += albedo * uAtmColor * term * 0.35 * uAtmDensity;
#ifdef USE_EMAP
  vec3 e = texture2D(uEmissiveMap, vUv).rgb;
  col += e * uEmissive * (1.0 - 0.75 * smoothstep(-0.1, 0.4, ndl0));
#endif
  float fres = pow(1.0 - clamp(dot(N0, V), 0.0, 1.0), 2.4);
  col += uAtmColor * fres * uAtmDensity * (0.06 + 0.9 * smoothstep(-0.25, 0.6, ndl0));
  gl_FragColor = vec4(col, uOpacity);
}`;

const CLOUD_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uScroll;
uniform float uCloudOpacity;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform float uOpacity;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec2 vUv;
void main() {
  vec3 N = normalize(vNormalW);
  vec4 c = texture2D(uMap, vec2(vUv.x + uScroll, vUv.y));
  float ndl = dot(N, uLightDir);
  float diff = clamp((ndl + 0.1) / 1.1, 0.0, 1.0);
  vec3 col = c.rgb * (uLightColor * diff + uAmbient);
  gl_FragColor = vec4(col, c.a * uCloudOpacity * uOpacity * smoothstep(-0.35, 0.1, ndl + 0.2));
}`;

const HALO_FRAGMENT = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uAtmColor;
uniform float uAtmDensity;
uniform float uLimb;
uniform float uPower;
uniform float uOpacity;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec2 vUv;
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  // back faces of the shell: 0 at its outer edge, 1 at the planet limb
  float k = clamp(-dot(N, V) / uLimb, 0.0, 1.0);
  float glow = pow(k, uPower);
  float lit = 0.07 + smoothstep(-0.3, 0.55, dot(N, uLightDir));
  gl_FragColor = vec4(uAtmColor * glow * uAtmDensity * lit * 1.4 * uOpacity, 1.0);
}`;

const RING_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uPlanetCenter;
uniform float uPlanetRadius;
uniform float uOpacity;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  // the planet's shadow: does the ray toward the light hit the sphere?
  vec3 o = vPosW - uPlanetCenter;
  float b = dot(o, uLightDir);
  float cc = dot(o, o) - uPlanetRadius * uPlanetRadius;
  float h = b * b - cc;
  float shadow = (b < 0.0 && h > 0.0) ? 1.0 - smoothstep(0.0, uPlanetRadius * uPlanetRadius * 0.05, h) * 0.85 : 1.0;
  float ndl = abs(dot(normalize(vNormalW), uLightDir));
  vec3 col = c.rgb * (uLightColor * (0.35 + 0.65 * ndl) * shadow + uAmbient);
  gl_FragColor = vec4(col, c.a * uOpacity);
}`;

export interface PlanetLight {
  dir: Vector3;
  color: Color;
  ambient: Color;
}

/** One planet of a zone look. `ready` = the textures may still be loading (three refreshes them). */
export class PlanetView {
  readonly group = new Group();
  private readonly tilt = new Group();
  private readonly spinner = new Group();
  private readonly materials: ShaderMaterial[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly cloudScroll: { value: number } = { value: 0 };
  private readonly planetCenter = new Vector3();
  private ringMaterial: ShaderMaterial | null = null;
  private disposed = false;
  opacity = 0;

  constructor(
    readonly spec: PlanetSpec,
    private readonly def: PlanetDef,
    light: PlanetLight,
    segments: number,
    detail: boolean,
    textureSize: number,
    /** false = the shader warm-up's sample: the same programs, no texture loads. */
    textures = true,
  ) {
    this.group.name = `planet:${spec.kind}`;
    this.group.userData.noAO = true;
    this.group.add(this.tilt);
    this.tilt.add(this.spinner);
    this.tilt.rotation.set(spec.tilt.x, 0, spec.tilt.z);
    const r = spec.radius;
    const atm = def.atmosphere;
    const atmColor = new Color(atm.color);
    const shared = {
      uLightDir: { value: light.dir },
      uLightColor: { value: light.color },
      uAmbient: { value: light.ambient },
      uAtmColor: { value: atmColor },
      uAtmDensity: { value: atm.density },
      uOpacity: { value: 0 },
    };

    const defines: Record<string, string> = {};
    const tex = (file: string, data: boolean, maxWidth?: number) => (textures ? planetTexture(file, data, maxWidth) : null);
    const uniforms: Record<string, { value: unknown }> = { ...shared, uMap: { value: tex(def.albedo, false, textureSize) } };
    if (detail && def.normal) {
      defines.USE_NMAP = '';
      uniforms.uNormalMap = { value: tex(def.normal, true) };
      uniforms.uNormalScale = { value: def.normalScale ?? 0.8 };
    }
    if (def.emissive) {
      defines.USE_EMAP = '';
      uniforms.uEmissiveMap = { value: tex(def.emissive, false, textureSize) };
      uniforms.uEmissive = { value: def.emissiveIntensity * 0.9 };
    }
    const body = new Mesh(
      this.geometry(new SphereGeometry(r, segments, Math.round(segments / 2))),
      this.material(new ShaderMaterial({ defines, uniforms, vertexShader: COMMON_VERTEX, fragmentShader: BODY_FRAGMENT, transparent: true, depthWrite: true })),
    );
    this.spinner.add(body);

    if (detail && def.clouds) {
      const clouds = new Mesh(
        this.geometry(new SphereGeometry(r * def.clouds.shellScale, segments, Math.round(segments / 2))),
        this.material(
          new ShaderMaterial({
            uniforms: { ...shared, uMap: { value: tex(def.clouds.texture, false, textureSize) }, uScroll: this.cloudScroll, uCloudOpacity: { value: def.clouds.opacity } },
            vertexShader: COMMON_VERTEX,
            fragmentShader: CLOUD_FRAGMENT,
            transparent: true,
            depthWrite: false,
          }),
        ),
      );
      this.spinner.add(clouds);
    }

    const haloScale = Math.max(1.06, atm.shellScale * 1.05);
    const halo = new Mesh(
      this.geometry(new SphereGeometry(r * haloScale, Math.max(32, segments / 2), Math.max(16, segments / 4))),
      this.material(
        new ShaderMaterial({
          uniforms: { ...shared, uLimb: { value: Math.sqrt(1 - 1 / (haloScale * haloScale)) }, uPower: { value: atm.power } },
          vertexShader: COMMON_VERTEX,
          fragmentShader: HALO_FRAGMENT,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          side: BackSide,
        }),
      ),
    );
    this.tilt.add(halo);

    if (spec.rings && def.ringSystem) void this.addRings(def.ringSystem.model, shared);
  }

  private async addRings(path: string, shared: Record<string, { value: unknown }>): Promise<void> {
    const template = await ringTemplate(path);
    if (!template || this.disposed) return;
    const material = this.material(
      new ShaderMaterial({
        uniforms: {
          ...shared,
          uMap: { value: template.map },
          uPlanetCenter: { value: this.planetCenter },
          uPlanetRadius: { value: this.spec.radius },
        },
        vertexShader: COMMON_VERTEX,
        fragmentShader: RING_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        forceSinglePass: true,
      }),
    );
    this.ringMaterial = material;
    const mesh = new Mesh(template.geometry, material);
    mesh.scale.setScalar(this.spec.radius);
    mesh.renderOrder = 1;
    this.tilt.add(mesh);
  }

  private geometry<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private material(m: ShaderMaterial): ShaderMaterial {
    m.userData.noAO = true;
    this.materials.push(m);
    return m;
  }

  update(dt: number, time: number): void {
    this.spinner.rotation.y += this.spec.spin * dt;
    if (this.def.clouds) this.cloudScroll.value = (time * this.def.clouds.speed) / 60;
    for (const m of this.materials) m.uniforms.uOpacity!.value = this.opacity;
    this.group.visible = this.opacity > 0.002;
    if (this.ringMaterial) this.group.getWorldPosition(this.planetCenter);
  }

  dispose(): void {
    this.disposed = true;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials as Material[]) m.dispose();
    this.group.removeFromParent();
  }
}
