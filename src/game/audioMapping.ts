// Simulation state to the audio module's inputs (pure functions).
import type { LaserInput, ThrustInput } from '../audio';
import { RESOURCE_IDS, type Cargo, type ResourceId } from '../data/resources';
import type { Vec2 } from '../sim/math/vec2';
import type { MiningBeam } from '../sim/mining/mining';
import type { ShipProperties } from '../sim/ship/properties';

const ratio = (used: number, max: number): number => (max > 0 ? Math.min(1, Math.max(0, used / max)) : 0);

/** How loud the cockpit's weak manoeuvring thrusters (RCS) hiss at full push, against a side engine. */
const RCS_SIDE_LEVEL = 0.4;

/** A side group's load 0..1: its engines, or the softer RCS hiss where the flank has none. */
function sideLoad(force: number, engines: number, rcs: number): number {
  if (engines > 0) return ratio(force, engines);
  return ratio(force, rcs) * RCS_SIDE_LEVEL;
}

/** Load of the engine groups 0..1; side is signed (+ = thrusters on the right flank push to the left). */
export function thrustInput(localForce: Vec2, props: ShipProperties): Required<ThrustInput> {
  const side = localForce.y > 0 ? sideLoad(localForce.y, props.thrust.left, props.rcsThrust) : -sideLoad(-localForce.y, props.thrust.right, props.rcsThrust);
  return {
    main: ratio(localForce.x, props.thrust.forward),
    reverse: ratio(-localForce.x, props.thrust.backward),
    side: side === 0 ? 0 : side,
  };
}

/**
 * The mining laser sound. `heat` = the hottest laser's heat 0..1 (Mining 2.0): the beam on the vein
 * bonus segment bites harder, and harder still as the laser nears overheating.
 */
export function laserInput(beams: readonly MiningBeam[], heat = 0): Required<LaserInput> {
  const hit = beams.find((b) => b.asteroidId !== null);
  const bonus = beams.some((b) => b.bonus > 1);
  const intensity = (bonus ? 1.3 : 1) + (heat > 0.7 ? (heat - 0.7) * 0.8 : 0);
  return { active: beams.length > 0, hitting: hit !== undefined, resource: hit?.resource ?? null, intensity: hit ? intensity : 1 };
}

/** Impact speed (u/s) at which the sound is loudest. */
const FULL_IMPACT_SPEED = 15;

export const impactIntensity = (speed: number): number => Math.min(1, Math.max(0, speed / FULL_IMPACT_SPEED));

/** Ore pickup: one sound per whole mined unit (the audio module still limits the rate). */
export class CollectTracker {
  private last: Cargo | null = null;
  private readonly progress: Record<ResourceId, number> = { iron: 0, copper: 0, ice: 0, titanium: 0 };

  /** `mining` = the gain comes from mining (not from a transfer in the dock). */
  update(cargo: Cargo, mining: boolean): ResourceId[] {
    const out: ResourceId[] = [];
    for (const id of RESOURCE_IDS) {
      const delta = this.last ? cargo[id] - this.last[id] : 0;
      if (mining && delta > 0) {
        const before = Math.floor(this.progress[id]);
        this.progress[id] += delta;
        if (Math.floor(this.progress[id]) > before) out.push(id);
      }
    }
    this.last = { ...cargo };
    return out;
  }
}
