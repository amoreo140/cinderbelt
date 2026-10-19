// The hangar bay's assembly arms (art batch D, art/README.md §2.7.25): each carriage slides along
// its rail (local X) from one work stop to the next, then the welding head turns a little over the
// platform and welds in short bursts. Pure – a function of the time, unit tested.

/** Rail range of the carriages along the bay's local X (stations_batch_d.json `railX`). */
export const BAY_RAIL_X: readonly [number, number] = [-8, 8];
/** Seconds of travel between two stops and of work at a stop. */
const TRAVEL = 3.6;
const WORK = 6.4;
/** Work stops per arm (x on the rail); the arms never move in step. */
const STOPS: readonly (readonly number[])[] = [
  [-5, 1.5, 6, -1.5, 3.5],
  [4.5, -3.5, 0.5, -6.5, 6.5],
];
const PHASE = [0, 4.7];
/** Welding bursts within the work time (seconds from the stop). */
const BURSTS: readonly (readonly [number, number])[] = [
  [0.9, 2.5],
  [3.3, 4.1],
  [4.7, 5.8],
];
/** Largest turn of the welding head about its local +Y (rad). */
const HEAD_TURN = 0.32;

export interface BayArmPose {
  /** Carriage position on the rail (local X). */
  x: number;
  /** Turn of the welding head about local +Y (rad, 0 = the model's pose). */
  headYaw: number;
  /** The torch is welding (sparks at `Arm_<i>_Tip`). */
  welding: boolean;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const clampRail = (x: number): number => Math.min(BAY_RAIL_X[1], Math.max(BAY_RAIL_X[0], x));

/** Pose of arm `arm` (0 or 1) at `time` seconds. */
export function bayArmPose(time: number, arm: number): BayArmPose {
  const stops = STOPS[arm % STOPS.length]!;
  const t = Math.max(0, time) + PHASE[arm % PHASE.length]!;
  const cycle = TRAVEL + WORK;
  const k = Math.floor(t / cycle);
  const local = t - k * cycle;
  const from = stops[k % stops.length]!;
  const to = stops[(k + 1) % stops.length]!;
  if (local < TRAVEL) return { x: clampRail(from + (to - from) * smooth(local / TRAVEL)), headYaw: 0, welding: false };
  const w = local - TRAVEL;
  // the head eases into the turn and back to rest before the next travel
  const ease = Math.min(1, w / 0.8, (WORK - w) / 0.8);
  const headYaw = HEAD_TURN * ease * Math.sin(w * 0.85 + arm * 1.9);
  const welding = BURSTS.some(([a, b]) => w >= a && w < b);
  return { x: clampRail(to), headYaw, welding };
}
