// The zone's sun in the sky (visual polish): a hot core that blooms, a soft halo, a wide faint haze
// and the six-point star flare, at a fixed spot near the top of the screen (the camera never yaws,
// so a fixed screen spot is a fixed direction in the world). The directional light comes from the
// same azimuth (zoneLook.lightDirection), so shadows fall away from the sun on screen. Depth-tested:
// stations and ships pass in front of it.
import { AdditiveBlending, Color, Group, Sprite, SpriteMaterial, Vector3, type Camera, type Texture } from 'three';
import { vfxTexture } from '../fx/textures';

/** Distance of the sprites from the camera (inside the far plane, beyond everything else). */
const DISTANCE = 3800;

interface Layer {
  sprite: Sprite;
  material: SpriteMaterial;
  /** Size relative to the zone sun size and brightness relative to the sun colour. */
  size: number;
  gain: number;
}

export class SunFlare {
  readonly object = new Group();
  private readonly layers: Layer[] = [];
  private readonly color = new Color();
  /** Unit direction from the camera toward the sun (updated each frame). */
  readonly direction = new Vector3(0, -0.5, -1).normalize();
  private time = 0;
  /** Multiplier of the whole sprite (background brightness setting). */
  brightness = 1;

  constructor() {
    this.object.name = 'sun';
    this.object.userData.noAO = true;
    this.object.userData.noShadow = true;
    const glow = vfxTexture('glow_soft');
    this.layer(glow, 5, 0.045);
    this.layer(glow, 1.5, 0.3);
    this.layer(vfxTexture('flare_star'), 2.2, 1.0);
    this.layer(glow, 0.3, 6);
  }

  private layer(texture: Texture, size: number, gain: number): void {
    const material = new SpriteMaterial({ map: texture, blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    const sprite = new Sprite(material);
    sprite.frustumCulled = false;
    sprite.renderOrder = -900;
    this.object.add(sprite);
    this.layers.push({ sprite, material, size, gain });
  }

  /** `ndc` = screen spot of the sun, `color` / `size` from the zone look (already mixed). */
  /** Low quality: no wide haze (a large additive sprite – fill rate on weak GPUs). */
  setDetail(full: boolean): void {
    this.layers[0]!.sprite.visible = full;
  }

  update(camera: Camera, ndcX: number, ndcY: number, color: number, size: number, dt: number): void {
    this.time += dt;
    this.direction.set(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
    this.object.position.copy(camera.position).addScaledVector(this.direction, DISTANCE);
    this.color.setHex(color);
    // a slow shimmer of the corona
    const breathe = 1 + 0.03 * Math.sin(this.time * 0.9) + 0.02 * Math.sin(this.time * 2.3 + 1);
    const scale = (DISTANCE / 1000) * size;
    for (const l of this.layers) {
      l.sprite.scale.setScalar(scale * l.size * breathe);
      // the wide halo and the star spikes fade faster than the core when the backdrop is dimmed
      const dim = l.size >= 1.5 ? this.brightness * this.brightness : this.brightness;
      l.material.color.copy(this.color).multiplyScalar(l.gain * dim);
    }
    this.layers[2]!.material.rotation = 0.06 * Math.sin(this.time * 0.05);
  }

  dispose(): void {
    for (const l of this.layers) l.material.dispose();
    this.object.removeFromParent();
  }
}
