// The scanner pulse in the world (readability pass R6): a wave on the play plane from the pulse origin
// to the radar range, and short rings on the finds it reveals (gold = rich ore, amber dashed = signal,
// ember = Echo, cyan = cache). The timing comes from the game (`ScanView`, scanFeedback.ts) – this only
// draws it. Line widths follow the camera distance, so the wave reads the same zoomed in and out.
import { AdditiveBlending, Color, Group, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import { findColor, type ScanFindKind, type ScanView } from '../../game/discovery/scanFeedback';
import { simToWorld } from '../coords';
import type { GraphicsQuality } from '../quality';

const VERTEX = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// A ring of radius uRadius on a quad of half-size uExtent: a sharp front, an optional glow trailing
// inwards (uTrail = its falloff length) and optional dashes (uDash = count around).
const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uRadius;
uniform float uWidth;
uniform float uTrail;
uniform float uTrailAlpha;
uniform float uExtent;
uniform float uDash;
varying vec2 vPos;
void main() {
  float d = length(vPos) * uExtent;
  float x = d - uRadius;
  float front = 1.0 - smoothstep(0.0, uWidth, abs(x));
  float trail = (uTrail > 0.0 && x < 0.0) ? uTrailAlpha * exp(x / uTrail) : 0.0;
  float a = max(front, trail);
  if (uDash > 0.0) {
    float ang = atan(vPos.y, vPos.x) / 6.2831853 + 0.5;
    a *= mix(0.12, 1.0, step(0.45, fract(ang * uDash)));
  }
  a *= uAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const WAVE_COLOR = '#62d9f4';
/** Height above the play plane (u) – over the dust, under the ships. */
const LIFT = 0.08;
/** Line width per unit of camera distance (≈ 6–8 px at 720p, any zoom) and its floor (u). */
const WIDTH_PER_DISTANCE = 0.011;
const MIN_WIDTH = 0.18;

interface RingMesh {
  mesh: Mesh;
  material: ShaderMaterial;
}

export class ScanPulseView {
  readonly object = new Group();
  private readonly geometry = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  private readonly wave: RingMesh;
  /** A fainter second front just behind the first (medium and high quality). */
  private readonly echo: RingMesh;
  private readonly rings: RingMesh[] = [];
  private view: ScanView | null = null;
  private quality: GraphicsQuality = 'medium';
  private time = 0;
  private readonly color = new Color();

  constructor() {
    this.object.name = 'scan-pulse';
    this.wave = this.makeRing();
    this.echo = this.makeRing();
    this.wave.mesh.renderOrder = 2;
    this.echo.mesh.renderOrder = 2;
  }

  private makeRing(): RingMesh {
    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uColor: { value: new Color() },
        uAlpha: { value: 0 },
        uRadius: { value: 1 },
        uWidth: { value: 0.2 },
        uTrail: { value: 0 },
        uTrailAlpha: { value: 0 },
        uExtent: { value: 1 },
        uDash: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const mesh = new Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 3;
    this.object.add(mesh);
    return { mesh, material };
  }

  setQuality(level: GraphicsQuality): void {
    this.quality = level;
  }

  /** The game's pulse state for this frame (null = nothing). */
  setView(view: ScanView | null): void {
    this.view = view;
  }

  private draw(r: RingMesh, o: { radius: number; width: number; trail: number; trailAlpha: number; alpha: number; dash: number; color: string }): void {
    const u = r.material.uniforms;
    const extent = o.radius + o.width * 3;
    r.mesh.scale.setScalar(extent);
    u.uExtent!.value = extent;
    u.uRadius!.value = o.radius;
    u.uWidth!.value = o.width;
    u.uTrail!.value = o.trail;
    u.uTrailAlpha!.value = o.trailAlpha;
    u.uAlpha!.value = o.alpha;
    u.uDash!.value = o.dash;
    (u.uColor!.value as Color).copy(this.color.set(o.color));
    r.mesh.visible = o.alpha > 0.003 && o.radius > 0.02;
  }

  update(frameDt: number, cameraDistance: number, reducedMotion: boolean): void {
    this.time += frameDt;
    const v = this.view;
    const width = Math.max(MIN_WIDTH, WIDTH_PER_DISTANCE * cameraDistance);
    const glow = this.quality !== 'low';

    if (v?.wave) {
      const w = v.wave;
      simToWorld(w.pos, LIFT, this.wave.mesh.position);
      this.draw(this.wave, {
        radius: w.radius,
        width,
        // the glow behind the front grows with the wave (a band, not a hairline, when zoomed out)
        trail: Math.max(1.5, w.radius * 0.22),
        trailAlpha: glow ? 0.34 : 0.22,
        alpha: w.alpha,
        dash: 0,
        color: WAVE_COLOR,
      });
      if (glow && !reducedMotion) {
        simToWorld(w.pos, LIFT, this.echo.mesh.position);
        this.draw(this.echo, { radius: w.radius * 0.82, width: width * 0.7, trail: 0, trailAlpha: 0, alpha: w.alpha * 0.4, dash: 0, color: WAVE_COLOR });
      } else this.echo.mesh.visible = false;
    } else {
      this.wave.mesh.visible = false;
      this.echo.mesh.visible = false;
    }

    const finds = v?.finds ?? [];
    while (this.rings.length < finds.length) this.rings.push(this.makeRing());
    const breathe = reducedMotion || !glow ? 1 : 0.85 + 0.15 * Math.sin(this.time * 5);
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i]!;
      const f = finds[i];
      if (!f) {
        r.mesh.visible = false;
        continue;
      }
      simToWorld(f.pos, LIFT, r.mesh.position);
      this.draw(r, { ...findRing(f.kind, f.radius, width, cameraDistance, glow), alpha: f.alpha * breathe, color: findColor(f.kind) });
      // the arrival pop: the ring starts bigger and settles on the find
      if (f.pop !== 1) {
        const u = r.material.uniforms;
        const radius = (u.uRadius!.value as number) * f.pop;
        const extent = radius + (u.uWidth!.value as number) * 3;
        u.uRadius!.value = radius;
        u.uExtent!.value = extent;
        r.mesh.scale.setScalar(extent);
      }
    }
  }

  stats(): { wave: boolean; finds: number } {
    return { wave: this.wave.mesh.visible, finds: this.rings.filter((r) => r.mesh.visible).length };
  }

  dispose(): void {
    this.geometry.dispose();
    this.wave.material.dispose();
    this.echo.material.dispose();
    for (const r of this.rings) r.material.dispose();
    this.rings.length = 0;
  }
}

/** Ring size and style of a find: around a rock a little outside it, a signal at its uncertainty. */
function findRing(kind: ScanFindKind, radius: number, width: number, cameraDistance: number, glow: boolean): { radius: number; width: number; trail: number; trailAlpha: number; dash: number } {
  // never smaller than ~12 px on screen, so a small rock's ring still reads zoomed out
  const minRadius = cameraDistance * 0.018;
  switch (kind) {
    case 'rich': {
      const r = Math.max(minRadius, radius * 1.3 + 0.8);
      return { radius: r, width: width * 1.3, trail: glow ? r * 0.22 : 0, trailAlpha: 0.16, dash: 0 };
    }
    case 'signal': {
      const r = Math.max(minRadius, radius);
      return { radius: r, width: width * 1.2, trail: glow ? r * 0.2 : 0, trailAlpha: 0.08, dash: Math.min(48, Math.max(12, Math.round(r / 2.5))) };
    }
    default: {
      const r = Math.max(minRadius, radius);
      return { radius: r, width: width * 1.5, trail: glow ? r * 0.3 : 0, trailAlpha: 0.18, dash: 0 };
    }
  }
}
