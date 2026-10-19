// Combat and mining effects (M3a): muzzle flash, hit sparks, explosions (flipbook + shockwave +
// embers + debris in the victim's set), shield hits and a depleted asteroid breaking into
// fragments and dust. Looks only – the simulation knows nothing about effects.
import { Color, Group, Object3D, Quaternion, Vector3 } from 'three';
import { RESOURCES, type ResourceId } from '../../data/resources';
import type { DebrisSet, FxModels } from './fxModels';
import { Particles } from './Particles';
import { vfxTexture } from './textures';

/** Height of the effects above the gameplay plane (ship centres). */
export const FX_HEIGHT = 0.25;

const hdr = (r: number, g: number, b: number): Color => new Color(r, g, b);

export const FX_COLORS = {
  playerBolt: hdr(0.55, 1.9, 2.6),
  pirateBolt: hdr(3.0, 0.75, 0.35),
  /** A Guild Watch shot (M4d): blue-white, apart from the player's cyan. */
  guildBolt: hdr(1.6, 2.2, 3.9),
  spark: hdr(3.2, 1.9, 0.9),
  shield: hdr(0.6, 1.9, 2.8),
  flash: hdr(3.0, 1.9, 1.0),
  ember: hdr(2.2, 1.4, 1.0),
  shock: hdr(2.4, 1.6, 0.9),
  explosion: hdr(1.1, 1.0, 0.95),
  fire: hdr(2.6, 1.7, 1.0),
  blast: hdr(2.2, 1.2, 0.55),
  white: hdr(1, 1, 1),
  /** Gunner salvo (M4b): hotter and redder than a plain pirate shot. */
  salvo: hdr(3.4, 1.2, 0.45),
  /** A sleeper waking (M4b) and a live sentry's eye: alarm red. */
  wake: hdr(3.0, 0.45, 0.25),
  /** A large reactor's blast (M4c): a hot orange shockwave. */
  reactor: hdr(3.4, 1.55, 0.45),
} as const;

interface Piece {
  obj: Object3D;
  vel: Vector3;
  axis: Vector3;
  spin: number;
  age: number;
  life: number;
  scale: number;
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

/** Random unit direction in the gameplay plane (three.js x/z) with a little vertical spread. */
function planarDir(out: Vector3, lift = 0.15): Vector3 {
  const a = Math.random() * Math.PI * 2;
  return out.set(Math.cos(a), rand(-lift, lift), Math.sin(a)).normalize();
}

/** Cap of pieces (model clones) in the scene at once. */
export const MAX_PIECES = 160;

export class Effects {
  readonly object = new Group();
  private readonly glow = new Particles({ texture: vfxTexture('glow_soft'), additive: true, max: 256, renderOrder: 12 });
  private readonly sparks = new Particles({ texture: vfxTexture('spark'), additive: true, max: 512, renderOrder: 13 });
  private readonly embers = new Particles({ texture: vfxTexture('ember'), additive: true, max: 512, renderOrder: 13 });
  private readonly flashes = new Particles({ texture: vfxTexture('muzzle_flash'), additive: true, cols: 4, rows: 1, max: 128, renderOrder: 14 });
  private readonly flares = new Particles({ texture: vfxTexture('flare_star'), additive: true, max: 64, renderOrder: 14 });
  private readonly small = new Particles({ texture: vfxTexture('explosion_small'), additive: false, cols: 8, rows: 8, max: 64, renderOrder: 11 });
  private readonly large = new Particles({ texture: vfxTexture('explosion_large'), additive: false, cols: 8, rows: 8, max: 32, renderOrder: 11 });
  /** The fiery phase of an explosion, additive (first flipbook frames – README: "optionally additive"). */
  private readonly fireSmall = new Particles({ texture: vfxTexture('explosion_small'), additive: true, cols: 8, rows: 8, max: 64, renderOrder: 12 });
  private readonly fireLarge = new Particles({ texture: vfxTexture('explosion_large'), additive: true, cols: 8, rows: 8, max: 32, renderOrder: 12 });
  private readonly shock = new Particles({ texture: vfxTexture('shockwave_ring'), additive: true, max: 32, renderOrder: 12 });
  private readonly dust = new Particles({ texture: vfxTexture('impact_dust'), additive: false, cols: 4, rows: 4, max: 64, renderOrder: 11 });
  private readonly smoke = new Particles({ texture: vfxTexture('smoke_puff'), additive: false, max: 128, renderOrder: 10 });
  private readonly systems: Particles[];
  private readonly pieces: Piece[] = [];
  private readonly tmp = new Vector3();
  private readonly q = new Quaternion();

  constructor(private readonly models: FxModels) {
    this.systems = [
      this.smoke, this.dust, this.small, this.large, this.fireSmall, this.fireLarge,
      this.shock, this.glow, this.embers, this.sparks, this.flashes, this.flares,
    ];
    for (const s of this.systems) this.object.add(s.mesh);
  }

  /** Muzzle flash of a shot: `dir` = direction of the shot (three.js world), `side` = whose colours. */
  muzzleFlash(pos: Vector3, dir: Vector3, side: 'player' | 'pirate' | 'guild'): void {
    const tint = side === 'pirate' ? hdr(2.6, 1.3, 1.0) : side === 'guild' ? hdr(2.0, 2.2, 2.8) : hdr(1.7, 2.0, 2.2);
    this.flashes.spawn({ pos: this.tmp.copy(pos).addScaledVector(dir, 0.35), axis: dir, life: 0.11, size: 1.25, aspect: 0.32, color: tint, alpha: 1, frameStart: 0, frameEnd: 3, fadePower: 3 });
    this.glow.spawn({ pos, life: 0.1, size: 0.8, sizeEnd: 0.4, color: side === 'pirate' ? FX_COLORS.pirateBolt : side === 'guild' ? FX_COLORS.guildBolt : FX_COLORS.playerBolt, alpha: 0.45 });
  }

  /** One puff of a damaged hull's smoke trail (M4d Watch ships below half hull), now and then an ember. */
  damageSmoke(pos: Vector3, vel: Vector3, radius: number): void {
    this.smoke.spawn({ pos, vel: this.tmp.copy(vel).multiplyScalar(0.25).add(planarDir(new Vector3(), 0.2).multiplyScalar(rand(0.3, 1.0))), drag: 0.8, life: rand(1.0, 1.6), size: radius * 0.35, sizeEnd: radius * 1.1, color: hdr(0.3, 0.29, 0.3), alpha: 0.5, rotation: Math.random() * 6.3, spin: rand(-0.8, 0.8) });
    if (Math.random() < 0.3) this.embers.spawn({ pos, vel: planarDir(new Vector3(), 0.4).multiplyScalar(rand(1, 4)).add(vel), drag: 1.2, life: rand(0.3, 0.7), size: rand(0.15, 0.3), color: FX_COLORS.ember, fadePower: 2 });
  }

  /**
   * A Gunner's salvo shot (M4b): heavier than a plain shot – a longer flash, a hot bloom and a puff of
   * propellant smoke drifting off the muzzle, so an artillery salvo reads apart from a Jackal's fire.
   */
  salvoFlash(pos: Vector3, dir: Vector3): void {
    this.flashes.spawn({ pos: this.tmp.copy(pos).addScaledVector(dir, 0.7), axis: dir, life: 0.16, size: 2.6, aspect: 0.36, color: FX_COLORS.salvo, alpha: 1, frameStart: 0, frameEnd: 3, fadePower: 2.5 });
    this.glow.spawn({ pos, life: 0.2, size: 2.2, sizeEnd: 0.8, color: FX_COLORS.salvo, alpha: 0.7 });
    this.smoke.spawn({ pos: this.tmp.copy(pos).addScaledVector(dir, 0.9), vel: dir.clone().multiplyScalar(2.2), drag: 1.2, life: 0.9, size: 0.9, sizeEnd: 2.2, color: hdr(0.5, 0.46, 0.42), alpha: 0.4, rotation: Math.random() * 6.3, spin: rand(-0.6, 0.6) });
  }

  /** A dormant ship powers up (M4b): a red flare, a ring rolling out over its hull and a few sparks. */
  wakeFlare(pos: Vector3, radius: number): void {
    const size = Math.max(3, radius * 2.2);
    this.flares.spawn({ pos, life: 0.45, size: size * 1.3, sizeEnd: size * 0.5, color: FX_COLORS.wake, alpha: 0.9 });
    this.glow.spawn({ pos, life: 0.6, size: size, sizeEnd: size * 0.4, color: FX_COLORS.wake, alpha: 0.7 });
    this.shock.spawn({ pos, life: 0.7, size: radius, sizeEnd: radius * 3.2, color: FX_COLORS.wake, alpha: 0.9, fadePower: 0.8 });
    for (let i = 0; i < 10; i++) {
      this.sparks.spawn({ pos, vel: planarDir(new Vector3(), 0.3).multiplyScalar(rand(5, 12)), drag: 3, life: rand(0.2, 0.45), size: 0.6, aspect: 0.15, stretch: true, color: FX_COLORS.wake });
    }
  }

  /** A shot hitting a hull, a wreck or a rock: sparks back against the shot's direction. */
  impact(pos: Vector3, incoming: Vector3 | null, kind: 'ship' | 'wreck' | 'asteroid' | 'station', resource?: ResourceId): void {
    const back = incoming ? this.tmp.copy(incoming).normalize().negate() : null;
    const count = kind === 'ship' ? 9 : 6;
    for (let i = 0; i < count; i++) {
      const d = planarDir(new Vector3(), 0.35);
      if (back) d.addScaledVector(back, 1.2).normalize();
      this.sparks.spawn({ pos, vel: d.multiplyScalar(rand(7, 20)), drag: 3, life: rand(0.18, 0.38), size: rand(0.5, 0.9), aspect: 0.16, stretch: true, color: FX_COLORS.spark });
    }
    this.glow.spawn({ pos, life: 0.16, size: kind === 'ship' ? 1.6 : 1.1, sizeEnd: 0.5, color: FX_COLORS.flash, alpha: 0.9 });
    if (kind === 'ship') {
      for (let i = 0; i < 3; i++) {
        this.embers.spawn({ pos, vel: planarDir(new Vector3(), 0.3).multiplyScalar(rand(2, 5)), drag: 1.5, life: rand(0.4, 0.8), size: rand(0.18, 0.3), color: FX_COLORS.ember });
      }
    }
    if (kind === 'asteroid' && resource) {
      const c = new Color(RESOURCES[resource].rockColor).lerp(new Color(1, 1, 1), 0.35);
      this.dust.spawn({ pos, life: 0.45, size: 1.4, sizeEnd: 2.0, color: c, alpha: 0.85, frameStart: 0, frameEnd: 15, rotation: Math.random() * 6.3 });
    }
  }

  /**
   * Hull scraping a rock or a station (M3.8): a fan of sparks and a hot flash, more and faster with
   * the impact (`intensity` 0..1), and at real speed a puff of rock dust.
   */
  scrape(pos: Vector3, intensity: number): void {
    const k = Math.min(1, Math.max(0, intensity));
    const count = 3 + Math.round(14 * k);
    for (let i = 0; i < count; i++) {
      this.sparks.spawn({ pos, vel: planarDir(new Vector3(), 0.35).multiplyScalar(rand(5, 10 + 18 * k)), drag: 2.8, life: rand(0.2, 0.35 + 0.3 * k), size: rand(0.45, 0.7 + 0.4 * k), aspect: 0.15, stretch: true, color: FX_COLORS.spark });
    }
    this.glow.spawn({ pos, life: 0.12 + 0.12 * k, size: 1 + 1.6 * k, sizeEnd: 0.4, color: FX_COLORS.flash, alpha: 0.6 + 0.35 * k });
    if (k > 0.3) {
      this.dust.spawn({ pos, life: 0.5 + 0.3 * k, size: 1.2 + 1.5 * k, sizeEnd: 2.4 + 2 * k, color: new Color(0.62, 0.58, 0.55), alpha: 0.7, frameStart: 0, frameEnd: 15, rotation: Math.random() * 6.3 });
      for (let i = 0; i < 2 + Math.round(3 * k); i++) {
        this.embers.spawn({ pos, vel: planarDir(new Vector3(), 0.3).multiplyScalar(rand(2, 6)), drag: 1.5, life: rand(0.4, 0.9), size: rand(0.16, 0.28), color: FX_COLORS.ember });
      }
    }
  }

  /** Shield hit – a blue flash and short sparks along the bubble (ShieldBubbles draws the bubble). */
  shieldImpact(pos: Vector3): void {
    this.glow.spawn({ pos, life: 0.22, size: 2.0, sizeEnd: 1.0, color: FX_COLORS.shield, alpha: 0.9 });
    for (let i = 0; i < 5; i++) {
      this.sparks.spawn({ pos, vel: planarDir(new Vector3(), 0.2).multiplyScalar(rand(4, 9)), drag: 4, life: rand(0.15, 0.3), size: 0.5, aspect: 0.14, stretch: true, color: FX_COLORS.shield });
    }
  }

  /** Small explosion of a destroyed part; debris in the victim's `set`. */
  partExplosion(pos: Vector3, vel: Vector3, set: DebrisSet = 'human'): void {
    const rot = Math.random() * 6.3;
    this.small.spawn({ pos, vel: this.tmp.copy(vel).multiplyScalar(0.6), life: 1.1, size: 3.2, sizeEnd: 3.8, color: FX_COLORS.explosion, alpha: 0.85, alphaEnd: 0.4, frameStart: 0, frameEnd: 63, rotation: rot, fadePower: 3 });
    this.fireSmall.spawn({ pos, vel: this.tmp.copy(vel).multiplyScalar(0.6), life: 0.42, size: 3.2, sizeEnd: 3.6, color: FX_COLORS.fire, alpha: 1, frameStart: 0, frameEnd: 20, rotation: rot, fadePower: 2 });
    this.glow.spawn({ pos, life: 0.25, size: 2.4, sizeEnd: 1.2, color: FX_COLORS.blast, alpha: 0.7 });
    for (let i = 0; i < 10; i++) {
      this.sparks.spawn({ pos, vel: planarDir(new Vector3(), 0.4).multiplyScalar(rand(8, 22)).add(vel), drag: 2.5, life: rand(0.25, 0.5), size: rand(0.6, 1.0), aspect: 0.15, stretch: true, color: FX_COLORS.spark });
    }
    for (let i = 0; i < 6; i++) {
      this.embers.spawn({ pos, vel: planarDir(new Vector3(), 0.4).multiplyScalar(rand(2, 7)).add(vel), drag: 1.2, life: rand(0.6, 1.3), size: rand(0.18, 0.32), color: FX_COLORS.ember, fadePower: 2 });
    }
    this.debris(pos, vel, 1 + Math.floor(Math.random() * 2), 0.8, set);
  }

  /**
   * A large reactor blowing up on a ship (M4c partBlast): bigger than a part explosion and unlike a
   * ship's death – a fast orange shockwave with a second, slower ring over the 8-neighbours it hits,
   * a hot flash, a fireball, sparks, embers and debris. `vel` = the ship's velocity.
   */
  reactorBlast(pos: Vector3, vel: Vector3, set: DebrisSet = 'human'): void {
    const rot = Math.random() * 6.3;
    this.shock.spawn({ pos, vel: this.tmp.copy(vel).multiplyScalar(0.8), life: 0.5, size: 1.2, sizeEnd: 11, color: FX_COLORS.reactor, alpha: 1, fadePower: 0.6 });
    this.shock.spawn({ pos, vel: this.tmp.copy(vel).multiplyScalar(0.8), delay: 0.06, life: 0.75, size: 0.8, sizeEnd: 5.5, color: FX_COLORS.reactor, alpha: 0.8, fadePower: 0.9 });
    this.flares.spawn({ pos, life: 0.22, size: 7, sizeEnd: 3, color: FX_COLORS.reactor, alpha: 0.8 });
    this.glow.spawn({ pos, life: 0.45, size: 5.5, sizeEnd: 2.4, color: FX_COLORS.reactor, alpha: 0.9 });
    this.large.spawn({ pos, vel: this.tmp.copy(vel).multiplyScalar(0.6), life: 1.6, size: 5.4, sizeEnd: 6.6, color: FX_COLORS.explosion, alpha: 0.9, alphaEnd: 0.35, frameStart: 0, frameEnd: 63, rotation: rot, fadePower: 3 });
    this.fireLarge.spawn({ pos, vel: this.tmp.copy(vel).multiplyScalar(0.6), life: 0.55, size: 5.4, sizeEnd: 6.2, color: FX_COLORS.fire, alpha: 1, frameStart: 0, frameEnd: 22, rotation: rot, fadePower: 2 });
    for (let i = 0; i < 22; i++) {
      this.sparks.spawn({ pos, vel: planarDir(new Vector3(), 0.45).multiplyScalar(rand(10, 30)).add(vel), drag: 2.2, life: rand(0.3, 0.7), size: rand(0.8, 1.3), aspect: 0.14, stretch: true, color: FX_COLORS.spark });
    }
    for (let i = 0; i < 14; i++) {
      this.embers.spawn({ pos, vel: planarDir(new Vector3(), 0.45).multiplyScalar(rand(3, 10)).add(vel), drag: 1, life: rand(0.8, 1.8), size: rand(0.2, 0.38), color: FX_COLORS.ember, fadePower: 2 });
    }
    this.debris(pos, vel, 3 + Math.floor(Math.random() * 2), 1, set);
  }

  /** Big explosion of a destroyed ship (ship radius); debris in the victim's `set`. */
  shipExplosion(pos: Vector3, vel: Vector3, radius: number, set: DebrisSet = 'human'): void {
    const size = Math.max(5, radius * 3.4);
    const rot = Math.random() * 6.3;
    this.large.spawn({ pos, vel: this.tmp.copy(vel).multiplyScalar(0.5), life: 2.2, size, sizeEnd: size * 1.25, color: FX_COLORS.explosion, alpha: 0.9, alphaEnd: 0.3, frameStart: 0, frameEnd: 63, rotation: rot, fadePower: 3 });
    this.fireLarge.spawn({ pos, vel: this.tmp.copy(vel).multiplyScalar(0.5), life: 0.75, size, sizeEnd: size * 1.15, color: FX_COLORS.fire, alpha: 1, frameStart: 0, frameEnd: 22, rotation: rot, fadePower: 2 });
    this.large.spawn({ pos: this.tmp.copy(pos).add(planarDir(new Vector3(), 0).multiplyScalar(radius * 0.5)), vel: vel.clone().multiplyScalar(0.4), delay: 0.12, life: 1.8, size: size * 0.7, sizeEnd: size * 0.9, color: FX_COLORS.explosion, alpha: 1, alphaEnd: 0.4, frameStart: 0, frameEnd: 63, rotation: Math.random() * 6.3, fadePower: 4 });
    this.shock.spawn({ pos, life: 0.55, size: radius, sizeEnd: radius * 6, color: FX_COLORS.shock, alpha: 1, fadePower: 0.7 });
    this.glow.spawn({ pos, life: 0.45, size: size * 0.75, sizeEnd: size * 0.35, color: FX_COLORS.blast, alpha: 0.85 });
    this.flares.spawn({ pos, life: 0.25, size: size * 0.9, sizeEnd: size * 0.4, color: FX_COLORS.blast, alpha: 0.5 });
    for (let i = 0; i < 28; i++) {
      this.sparks.spawn({ pos, vel: planarDir(new Vector3(), 0.5).multiplyScalar(rand(10, 34)).add(vel), drag: 2, life: rand(0.35, 0.8), size: rand(0.8, 1.5), aspect: 0.14, stretch: true, color: FX_COLORS.spark });
    }
    for (let i = 0; i < 26; i++) {
      this.embers.spawn({ pos, vel: planarDir(new Vector3(), 0.5).multiplyScalar(rand(3, 12)).add(vel), drag: 0.9, life: rand(1.0, 2.4), size: rand(0.2, 0.42), color: FX_COLORS.ember, fadePower: 2 });
    }
    for (let i = 0; i < 4; i++) {
      this.smoke.spawn({ pos: this.tmp.copy(pos).add(planarDir(new Vector3(), 0).multiplyScalar(rand(0, radius))), vel: planarDir(new Vector3(), 0).multiplyScalar(rand(0.5, 2)).add(vel.clone().multiplyScalar(0.5)), delay: 0.3, life: rand(2.2, 3.2), size: radius * 1.5, sizeEnd: radius * 3, color: hdr(0.35, 0.33, 0.33), alpha: 0.55, rotation: Math.random() * 6.3, spin: rand(-0.4, 0.4) });
    }
    this.debris(pos, vel, 5 + Math.floor(Math.random() * 4), 1.2, set);
  }

  /** A depleted asteroid breaks into fragments and dust (decision 2026-10-16). */
  asteroidBreakup(pos: Vector3, radius: number, resource: ResourceId): void {
    // the dust texture is light and sparse – on the dark backdrop it needs to be bigger and brighter
    const c = new Color(RESOURCES[resource].rockColor).lerp(new Color(1, 1, 1), 0.35).multiplyScalar(1.1);
    this.dust.spawn({ pos, life: 0.75, size: radius * 5.5, sizeEnd: radius * 7, color: c, alpha: 1, frameStart: 0, frameEnd: 15, rotation: Math.random() * 6.3, fadePower: 2 });
    this.dust.spawn({ pos, life: 0.9, delay: 0.1, size: radius * 4, sizeEnd: radius * 6, color: c, alpha: 0.9, frameStart: 0, frameEnd: 15, rotation: Math.random() * 6.3, fadePower: 2 });
    this.glow.spawn({ pos, life: 0.25, size: radius * 2, sizeEnd: radius, color: new Color(RESOURCES[resource].color).multiplyScalar(1.2), alpha: 0.3 });
    const count = 5 + Math.floor(radius * 2);
    for (let i = 0; i < count; i++) {
      const template = this.models.fragmentTemplate(resource, Math.random());
      const obj = template.clone();
      const dir = planarDir(new Vector3(), 0.25);
      obj.position.copy(pos).addScaledVector(dir, radius * 0.4);
      const scale = rand(0.6, 1.1) * Math.min(1.6, 0.6 + radius * 0.35);
      obj.scale.setScalar(scale);
      obj.rotation.set(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3);
      this.object.add(obj);
      this.addPiece({ obj, vel: dir.multiplyScalar(rand(1.5, 5)), axis: planarDir(new Vector3(), 1), spin: rand(-3, 3), age: 0, life: rand(2.2, 3.4), scale });
    }
    for (let i = 0; i < 8; i++) {
      this.sparks.spawn({ pos, vel: planarDir(new Vector3(), 0.3).multiplyScalar(rand(4, 10)), drag: 3, life: rand(0.2, 0.4), size: 0.5, aspect: 0.16, stretch: true, color: new Color(RESOURCES[resource].color).multiplyScalar(2.2) });
    }
  }

  /**
   * Sparks from where the beam mines the active stretch of a vein (spec 2.1.1) – resource colour,
   * short and fast, so it is clear the beam is "on".
   */
  veinSparks(pos: Vector3, resource: ResourceId): void {
    const color = new Color(RESOURCES[resource].color).lerp(new Color(1, 0.85, 0.55), 0.4).multiplyScalar(2.6);
    for (let i = 0; i < 3; i++) {
      const d = planarDir(new Vector3(), 0.2);
      d.y = rand(0.5, 1.3);
      this.sparks.spawn({ pos, vel: d.normalize().multiplyScalar(rand(4, 9)), drag: 4, life: rand(0.14, 0.3), size: rand(0.32, 0.55), aspect: 0.16, stretch: true, color });
    }
    this.glow.spawn({ pos, life: 0.12, size: 0.9, sizeEnd: 0.4, color, alpha: 0.6 });
  }

  /** Ice cracking (spec 2.1.1): an impact_dust cloud, ice fragments and sparks. */
  iceCrack(pos: Vector3, radius: number): void {
    const c = new Color(RESOURCES.ice.rockColor).lerp(new Color(1, 1, 1), 0.5).multiplyScalar(1.15);
    this.dust.spawn({ pos, life: 0.8, size: radius * 4.5, sizeEnd: radius * 7.5, color: c, alpha: 1, frameStart: 0, frameEnd: 15, rotation: Math.random() * 6.3, fadePower: 2 });
    this.dust.spawn({ pos, life: 1.0, delay: 0.08, size: radius * 3, sizeEnd: radius * 6, color: c, alpha: 0.85, frameStart: 0, frameEnd: 15, rotation: Math.random() * 6.3, fadePower: 2 });
    this.shock.spawn({ pos, life: 0.4, size: radius, sizeEnd: radius * 4, color: new Color(RESOURCES.ice.color).multiplyScalar(1.4), alpha: 0.8, fadePower: 0.8 });
    const count = 6 + Math.floor(radius * 3);
    for (let i = 0; i < count; i++) {
      const template = this.models.fragmentTemplate('ice', Math.random());
      const obj = template.clone();
      const dir = planarDir(new Vector3(), 0.3);
      obj.position.copy(pos).addScaledVector(dir, radius * 0.5);
      const scale = rand(0.35, 0.7) * Math.min(1.4, 0.5 + radius * 0.4);
      obj.scale.setScalar(scale);
      obj.rotation.set(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3);
      this.object.add(obj);
      this.addPiece({ obj, vel: dir.multiplyScalar(rand(2, 6)), axis: planarDir(new Vector3(), 1), spin: rand(-4, 4), age: 0, life: rand(1.6, 2.6), scale });
    }
    for (let i = 0; i < 12; i++) {
      this.sparks.spawn({ pos, vel: planarDir(new Vector3(), 0.3).multiplyScalar(rand(5, 12)), drag: 3, life: rand(0.2, 0.45), size: 0.55, aspect: 0.16, stretch: true, color: new Color(RESOURCES.ice.color).multiplyScalar(2.4) });
    }
  }

  /** Debris (debris_*.glb of the set) with physics for the effect only. */
  private debris(pos: Vector3, vel: Vector3, count: number, scale: number, set: DebrisSet): void {
    for (let i = 0; i < count; i++) {
      const obj = this.models.debrisTemplate(Math.random(), set).clone();
      const dir = planarDir(new Vector3(), 0.3);
      obj.position.copy(pos);
      const s = rand(0.7, 1.2) * scale;
      obj.scale.setScalar(s);
      obj.rotation.set(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3);
      this.object.add(obj);
      this.addPiece({ obj, vel: dir.multiplyScalar(rand(3, 9)).add(vel), axis: planarDir(new Vector3(), 1), spin: rand(-5, 5), age: 0, life: rand(2.5, 4), scale: s });
    }
  }

  /** A piece with physics; above the cap the oldest goes (many explosions at once do not flood the scene). */
  private addPiece(piece: Piece): void {
    if (this.pieces.length >= MAX_PIECES) {
      const oldest = this.pieces.shift()!;
      this.object.remove(oldest.obj);
    }
    this.pieces.push(piece);
  }

  update(dt: number): void {
    for (const s of this.systems) s.update(dt);
    let n = 0;
    for (const p of this.pieces) {
      p.age += dt;
      if (p.age >= p.life) {
        this.object.remove(p.obj);
        continue;
      }
      p.vel.multiplyScalar(Math.max(0, 1 - 0.35 * dt));
      p.obj.position.addScaledVector(p.vel, dt);
      p.obj.quaternion.multiply(this.q.setFromAxisAngle(p.axis, p.spin * dt));
      const left = p.life - p.age;
      p.obj.scale.setScalar(p.scale * Math.min(1, left / 0.8));
      this.pieces[n++] = p;
    }
    this.pieces.length = n;
  }

  /** Number of live effects (tests, debugging). */
  get active(): number {
    return this.systems.reduce((s, x) => s + x.count, 0) + this.pieces.length;
  }

  dispose(): void {
    for (const s of this.systems) s.dispose();
    for (const p of this.pieces) this.object.remove(p.obj);
    this.pieces.length = 0;
  }
}
