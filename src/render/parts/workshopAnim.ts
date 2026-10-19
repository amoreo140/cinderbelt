// Workshop part animations (M4c, home and workshop plan T11): the refinery crusher
// (`Refinery_Crusher`) spins while the refineries work, the large reactor plasma (`Reactor_Plasma`) spins
// always (faster with the workshop's load), the repair arm (`Repair_Arm` → `Repair_Tip`) swings toward the
// part it repairs and welds it – sparks and a hot glow at the tip (art/README §2.3). The weld is the repair
// module's identity in flight: from the flight camera (48 u) the module itself has no clear top-down mark.
//
// T7 contract: ShipView owns one `WorkshopRig` and calls `collect` for every part model it builds,
// `keep` when it bakes the hull (the moving nodes stay out of the merged batches – each one is its own
// mesh on the shared palette material, like a gyro ring), `setActivity` from the game (the player's
// `player.workshop`; null = idle – pirates, the hangar), `animate` every frame and `clear` when it
// rebuilds. The weld sprites of all repair modules of a ship are one sprite batch (≤ 1 draw call, only
// while something is welded) on the shared particle program – no new shader program.
import { Color, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { PartId } from '../../data/parts';
import { normalizeAngle } from '../../sim/math/angle';
import type { WorkshopActivity } from '../../sim/ship/workshop';
import { Particles, type ParticleSpec } from '../fx/Particles';
import { vfxTexture } from '../fx/textures';

/** Crusher spin while refining (rad/s) and the time it takes to spin up or down (s). */
export const CRUSHER_SPIN = 7;
export const CRUSHER_RAMP = 0.5;
/** Plasma torus spin (rad/s) idle and at full workshop load. */
export const PLASMA_IDLE = 4.5;
export const PLASMA_LOADED = 11;
/** How fast the plasma follows the load (1/s). */
const PLASMA_FOLLOW = 2.5;
/** Repair arm swing speed (rad/s) and how close to its target it welds (rad). */
export const ARM_SPEED = 2.6;
export const WELD_ALIGN = 0.25;
/** Sparks per second per welding arm. */
const SPARK_RATE = 46;
/** The weld glow is re-lit this often (s) – the same flicker at any frame rate. */
const GLOW_EVERY = 0.035;
/** Most weld sprites alive per ship. */
const WELD_MAX = 160;

const AXIS_Y = new Vector3(0, 1, 0);

/** Moves `current` toward `target` by at most `rate × dt` (a linear spin-up / spin-down). */
export function approach(current: number, target: number, rate: number, dt: number): number {
  const step = rate * dt;
  if (Math.abs(target - current) <= step) return target;
  return current + Math.sign(target - current) * step;
}

/**
 * How busy the workshop is, 0..1 (the large reactor's plasma spins faster with it): the refineries
 * count half, each welding repair module a quarter.
 */
export function workshopLoad(activity: WorkshopActivity | null): number {
  if (!activity) return 0;
  return Math.min(1, (activity.refining ? 0.5 : 0) + 0.25 * activity.repairing.length);
}

/** Plasma spin (rad/s) for a load 0..1. */
export const plasmaSpeed = (load: number): number => PLASMA_IDLE + (PLASMA_LOADED - PLASMA_IDLE) * Math.min(1, Math.max(0, load));

/**
 * The repair arm's yaw around the module's local +Y that points its rest direction (local +X) at a
 * target – hull frame positions (three.js x/z) of the module and the target, and the module node's
 * `rotation.y`. A local (cos θ, 0, −sin θ) turned by `rotY` points at the world angle θ + rotY.
 */
export function armYaw(moduleX: number, moduleZ: number, rotY: number, targetX: number, targetZ: number): number {
  const dx = targetX - moduleX;
  const dz = targetZ - moduleZ;
  if (dx * dx + dz * dz < 1e-9) return 0;
  return normalizeAngle(Math.atan2(-dz, dx) - rotY);
}

/** Turns `current` toward `target` by at most `speed × dt` along the shorter way. */
export function turnToward(current: number, target: number, speed: number, dt: number): number {
  const d = normalizeAngle(target - current);
  const step = speed * dt;
  return Math.abs(d) <= step ? target : normalizeAngle(current + Math.sign(d) * step);
}

/**
 * Camera shake of a large reactor's blast (partBlast) at `distance` from the player (sim units):
 * a hard jolt on board, fading out at 60 u.
 */
export function blastShake(distance: number): number {
  return Math.max(0, 0.95 * (1 - Math.max(0, distance) / 60));
}

interface SpinRig {
  node: Object3D;
  base: Quaternion;
  angle: number;
  /** Current spin (rad/s). */
  speed: number;
}

interface ArmRig {
  partRef: number;
  /** The module node (its position and rotation.y place it in the hull). */
  part: Object3D;
  arm: Object3D | null;
  base: Quaternion;
  tip: Object3D | null;
  yaw: number;
  /** Spark emission carry-over (sparks owed from the last frames). */
  carry: number;
  /** Time to the next glow flicker (s). */
  glow: number;
  /** The arm's parent → hull frame (static after the bake), found at the first weld. */
  toHull: Matrix4 | null;
}

const WELD_SPARK = new Color(3.4, 1.45, 0.4);
const WELD_CORE = new Color(2.2, 3.0, 3.4);
const WELD_HALO = new Color(0.25, 1.35, 2.6);

export class WorkshopRig {
  /** What the ship's workshop does (null = idle). */
  protected activity: WorkshopActivity | null = null;
  private crushers: SpinRig[] = [];
  private plasmas: SpinRig[] = [];
  private arms: ArmRig[] = [];
  /** Every collected part node by grid part id (repair targets). */
  private parts = new Map<number, Object3D>();
  /** The hull group the part nodes hang in (the weld sprites go there). */
  private hull: Object3D | null = null;
  /** Weld sparks and tip glows of all repair modules (created at the first weld). */
  private weld: Particles | null = null;
  private plasmaSpeed = PLASMA_IDLE;
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly tip = new Vector3();
  private readonly spec: ParticleSpec = { pos: new Vector3(), vel: new Vector3(), life: 0.3, size: 0.5, color: new Color() };

  /** A part model was built: `node` is its clone in the hull, `partRef` the grid part id. */
  collect(node: Object3D, partId: PartId, partRef: number): void {
    this.parts.set(partRef, node);
    if (node.parent) this.hull = node.parent;
    const spin = (name: string, into: SpinRig[]) => {
      const target = node.getObjectByName(name);
      if (target) into.push({ node: target, base: target.quaternion.clone(), angle: 0, speed: 0 });
    };
    if (partId === 'refinery') spin('Refinery_Crusher', this.crushers);
    else if (partId === 'largeReactor') spin('Reactor_Plasma', this.plasmas);
    else if (partId === 'repairModule') {
      const arm = node.getObjectByName('Repair_Arm') ?? null;
      this.arms.push({
        partRef,
        part: node,
        arm,
        base: arm ? arm.quaternion.clone() : new Quaternion(),
        tip: node.getObjectByName('Repair_Tip') ?? null,
        yaw: 0,
        carry: 0,
        glow: 0,
        toHull: null,
      });
    }
  }

  /** Adds the animated nodes that must stay out of the baked hull batches. */
  keep(out: Set<Object3D>): void {
    for (const s of this.crushers) out.add(s.node);
    for (const s of this.plasmas) out.add(s.node);
    for (const a of this.arms) if (a.arm) out.add(a.arm);
  }

  setActivity(activity: WorkshopActivity | null): void {
    this.activity = activity;
  }

  /** Live weld sprites (tests, debugging). */
  get weldCount(): number {
    return this.weld?.count ?? 0;
  }

  animate(dt: number): void {
    const a = this.activity;
    const crush = a?.refining ? CRUSHER_SPIN : 0;
    for (const s of this.crushers) {
      s.speed = approach(s.speed, crush, CRUSHER_SPIN / CRUSHER_RAMP, dt);
      if (s.speed !== 0) this.turn(s, dt);
    }
    if (this.plasmas.length > 0) {
      this.plasmaSpeed += (plasmaSpeed(workshopLoad(a)) - this.plasmaSpeed) * (1 - Math.exp(-dt * PLASMA_FOLLOW));
      for (const s of this.plasmas) {
        s.speed = this.plasmaSpeed;
        this.turn(s, dt);
      }
    }
    for (const arm of this.arms) this.animateArm(arm, a, dt);
    this.weld?.update(dt);
    if (this.weld) this.weld.mesh.visible = this.weld.count > 0;
  }

  private turn(s: SpinRig, dt: number): void {
    s.angle = normalizeAngle(s.angle + s.speed * dt);
    s.node.quaternion.copy(s.base).multiply(this.q.setFromAxisAngle(AXIS_Y, s.angle));
  }

  private animateArm(arm: ArmRig, a: WorkshopActivity | null, dt: number): void {
    let targetRef = -1;
    if (a) {
      for (const r of a.repairing) {
        if (r.module === arm.partRef) {
          targetRef = r.target;
          break;
        }
      }
    }
    const target = targetRef >= 0 ? this.parts.get(targetRef) : undefined;
    const goal = target ? armYaw(arm.part.position.x, arm.part.position.z, arm.part.rotation.y, target.position.x, target.position.z) : 0;
    const yaw = turnToward(arm.yaw, goal, ARM_SPEED, dt);
    if (arm.arm && yaw !== arm.yaw) arm.arm.quaternion.copy(arm.base).multiply(this.q.setFromAxisAngle(AXIS_Y, yaw));
    arm.yaw = yaw;
    if (!target || Math.abs(normalizeAngle(goal - yaw)) > WELD_ALIGN || !arm.arm || !arm.tip) {
      arm.carry = 0;
      arm.glow = 0;
      return;
    }
    this.weldAt(arm, dt);
  }

  /** Sparks and a flickering glow at the arm's tip (hull frame). */
  private weldAt(arm: ArmRig, dt: number): void {
    const hull = this.hull;
    if (!hull || !arm.arm || !arm.tip) return;
    if (!this.weld) {
      this.weld = new Particles({ texture: vfxTexture('glow_soft'), additive: true, max: WELD_MAX, renderOrder: 13 });
      this.weld.mesh.name = 'workshop-weld';
      hull.add(this.weld.mesh);
    }
    if (!arm.toHull) {
      // the chain above the arm is static once baked (a merged module body leaves a plain node)
      const m = new Matrix4();
      for (let o: Object3D | null = arm.arm.parent; o && o !== hull; o = o.parent) {
        o.updateMatrix();
        m.premultiply(o.matrix);
      }
      arm.toHull = m;
    }
    arm.arm.updateMatrix();
    const tip = this.tip.copy(arm.tip.position).applyMatrix4(arm.arm.matrix).applyMatrix4(arm.toHull);
    const s = this.spec;
    s.pos.copy(tip);
    arm.glow -= dt;
    if (arm.glow <= 0) this.weldGlow(arm, dt);
    // sparks: a fan up and out of the weld over the part being repaired
    arm.carry += SPARK_RATE * dt;
    const yawWorld = arm.yaw + arm.part.rotation.y;
    while (arm.carry >= 1) {
      arm.carry -= 1;
      const ang = yawWorld + (Math.random() - 0.5) * 2.8;
      const speed = 2.2 + Math.random() * 4;
      s.vel!.set(Math.cos(ang), 0.6 + Math.random() * 1.2, -Math.sin(ang)).normalize().multiplyScalar(speed);
      s.drag = 2.2;
      s.stretch = true;
      s.aspect = 0.2;
      s.life = 0.22 + Math.random() * 0.3;
      s.size = 0.55 + Math.random() * 0.4;
      s.sizeEnd = 0.2;
      s.color.copy(WELD_SPARK);
      s.alpha = 1;
      s.alphaEnd = 0;
      s.fadePower = 1.5;
      this.weld!.spawn(s);
    }
  }

  /** The hot core and a wide halo at the tip (`spec.pos`), re-lit every 35 ms with a short life – they flicker. */
  private weldGlow(arm: ArmRig, dt: number): void {
    arm.glow = GLOW_EVERY;
    const s = this.spec;
    // an arc welder strobes: mostly lit, now and then a hard flash or a near-dark beat
    const r = Math.random();
    const flick = r < 0.12 ? 1.45 : r < 0.22 ? 0.45 : 0.8 + Math.random() * 0.35;
    s.vel!.set(0, 0, 0);
    s.drag = 0;
    s.stretch = false;
    s.aspect = 1;
    // the particles age by this frame's dt right after the spawn: a slow frame must not kill the glow unseen
    s.life = GLOW_EVERY * 1.6 + dt;
    s.size = 1.0 * flick;
    s.sizeEnd = 0.7 * flick;
    s.color.copy(WELD_CORE);
    s.alpha = 1;
    s.alphaEnd = 0.3;
    s.fadePower = 1;
    this.weld!.spawn(s);
    s.size = 2.7 * flick;
    s.sizeEnd = 2.1 * flick;
    s.color.copy(WELD_HALO);
    s.alpha = 0.7;
    s.alphaEnd = 0.15;
    this.weld!.spawn(s);
  }

  /** The view rebuilt (or was disposed): forget every collected node. */
  clear(): void {
    this.crushers = [];
    this.plasmas = [];
    this.arms = [];
    this.parts = new Map();
    if (this.weld) {
      this.weld.mesh.removeFromParent();
      this.weld.dispose();
      this.weld = null;
    }
    this.hull = null;
  }
}
