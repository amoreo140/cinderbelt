import { BufferGeometry, Color, Float32BufferAttribute, Group, Points, PointsMaterial, Vector3 } from 'three';
import { TAU } from '../sim/math/angle';
import { createRng, type Rng } from '../sim/math/rng';

/** Beyond the planets below the plane (they are drawn in front of the stars), inside the far plane. */
const RADIUS = 4600;
const STAR_COLORS = [0xffffff, 0xcfe0ff, 0xfff1d6, 0xffd2b0, 0xb8c8ff];
/**
 * Two layers: a dense faint one and a few bright "glow" stars – the bright layer is kept sparse and
 * small (readability pass, R4) so the stars never read like rocks or ships when zoomed out.
 */
const FAINT = { count: 3500, size: 1.5, opacity: 0.8 };
const BRIGHT = { count: 180, size: 2.2, opacity: 0.85 };

function makeLayer(rng: Rng, count: number, size: number, opacity: number): Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new Color();
  for (let i = 0; i < count; i++) {
    // uniform over the sphere
    const u = rng() * 2 - 1;
    const theta = rng() * TAU;
    const r = Math.sqrt(1 - u * u);
    positions[i * 3] = r * Math.cos(theta) * RADIUS;
    positions[i * 3 + 1] = u * RADIUS;
    positions[i * 3 + 2] = r * Math.sin(theta) * RADIUS;
    color.setHex(STAR_COLORS[Math.floor(rng() * STAR_COLORS.length)]!).multiplyScalar(0.45 + rng() * 0.55);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial({
    size,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -1;
  return points;
}

/** Distant stars – a sphere that moves with the camera (they look infinitely far away). */
export class Starfield {
  readonly object = new Group();
  private readonly baseOpacity = new Map<PointsMaterial, number>();
  private overSky = 1;
  private backdrop = 1;

  constructor(seed: number) {
    const rng = createRng(seed);
    this.object.add(makeLayer(rng, FAINT.count, FAINT.size, FAINT.opacity));
    this.object.add(makeLayer(rng, BRIGHT.count, BRIGHT.size, BRIGHT.opacity));
  }

  /** Dims the stars over the skybox panorama (it has its own stars). */
  setBrightness(factor: number): void {
    this.overSky = factor;
    this.apply();
  }

  /** Background brightness setting (backdrop look). */
  setBackdrop(factor: number): void {
    this.backdrop = factor;
    this.apply();
  }

  private apply(): void {
    const factor = this.overSky * this.backdrop;
    this.object.traverse((o) => {
      if (!(o instanceof Points) || !(o.material instanceof PointsMaterial)) return;
      const base = this.baseOpacity.get(o.material) ?? o.material.opacity;
      this.baseOpacity.set(o.material, base);
      o.material.opacity = base * factor;
    });
  }

  update(cameraPosition: Vector3): void {
    this.object.position.copy(cameraPosition);
  }

  /** Frees the GPU resources (the renderer is shared between games). */
  dispose(): void {
    for (const o of this.object.children) {
      if (!(o instanceof Points)) continue;
      o.geometry.dispose();
      (o.material as PointsMaterial).dispose();
    }
    this.object.clear();
  }
}
