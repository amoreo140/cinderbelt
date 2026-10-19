// Pure helpers of the home modules' look (M4c plan T4): where a module sits on the home station
// (the `attach_<slot>` empty, art/README.md §2.7.10) and how the paint shop's gantry slides.
import { HOME_MODULES, HOME_SLOTS, type HomeModuleId, type HomeSlot } from '../../data/home';
import type { LayoutCircle } from '../../data/stations';
import type { Vec2 } from '../../sim/math/vec2';
import { smoothstep } from '../../sim/station/dock';

/** The part of a station a slot needs: its position and dock direction. */
export interface SlotStation {
  pos: Vec2;
  portAngle: number;
}

/** A module mount in the sim frame. */
export interface SlotPose {
  /** Position of the attach empty on the game plane. */
  pos: Vec2;
  /** Height of the empty above the game plane (three.js +y). */
  height: number;
  /** Sim angle of the module's +X (away from the station). */
  yaw: number;
}

/**
 * The `attach_<slot>` empty in the sim frame. The slot table uses the station frame with Blender axes
 * (+x = dock direction, +y = left, z = up), which is the sim frame of an unrotated station; the
 * station turns by `portAngle` (StationView: `rotation.y = portAngle`).
 */
export function slotPose(station: SlotStation, slot: HomeSlot): SlotPose {
  const s = HOME_SLOTS[slot];
  const c = Math.cos(station.portAngle);
  const n = Math.sin(station.portAngle);
  return {
    pos: { x: station.pos.x + s.x * c - s.y * n, y: station.pos.y + s.x * n + s.y * c },
    height: s.z,
    yaw: station.portAngle + (s.yawDeg * Math.PI) / 180,
  };
}

/** A point of the module frame (+x away from the station, +y left) on the game plane. */
export function modulePoint(pose: SlotPose, local: Vec2): Vec2 {
  const c = Math.cos(pose.yaw);
  const n = Math.sin(pose.yaw);
  return { x: pose.pos.x + local.x * c - local.y * n, y: pose.pos.y + local.x * n + local.y * c };
}

/** The module that stands on a slot (every slot has a fixed default module, plan §2.1). */
export function moduleAtSlot(slot: HomeSlot): HomeModuleId | null {
  for (const def of Object.values(HOME_MODULES)) if (def.slot === slot) return def.id;
  return null;
}

/** Module frame collision circles of the slot's default module (home_modules.json `circles`). */
const MODULE_CIRCLES: Record<HomeModuleId, readonly LayoutCircle[]> = (() => {
  const out = {} as Record<HomeModuleId, readonly LayoutCircle[]>;
  for (const def of Object.values(HOME_MODULES)) {
    // circlesAtDefaultSlot back into the module frame (the slot pose of an unrotated station at 0)
    const pose = slotPose({ pos: { x: 0, y: 0 }, portAngle: 0 }, def.slot);
    const c = Math.cos(-pose.yaw);
    const n = Math.sin(-pose.yaw);
    out[def.id] = def.circles.map((k) => {
      const x = k.x - pose.pos.x;
      const y = k.y - pose.pos.y;
      return { x: x * c - y * n, y: x * n + y * c, r: k.r };
    });
  }
  return out;
})();

/** The slot's module footprint on the game plane (its collision circles, sim frame). */
export function slotCircles(station: SlotStation, slot: HomeSlot): LayoutCircle[] {
  const id = moduleAtSlot(slot);
  const pose = slotPose(station, slot);
  const local = id ? MODULE_CIRCLES[id] : [{ x: 2.7, y: 0, r: 2.6 }];
  return local.map((k) => ({ ...modulePoint(pose, k), r: k.r }));
}

/** Paint shop gantry (`Paint_Gantry`): how far it slides along the module's local X. */
export const GANTRY_SWING = 1.2;
/** How long the gantry works after a ship is painted (s). */
export const GANTRY_TIME = 3;
/** Back-and-forth sweeps in one painting. */
const GANTRY_SWEEPS = 2;

/**
 * Gantry offset from its parked position, `since` seconds after `shipPainted`: two eased sweeps of
 * ±GANTRY_SWING over GANTRY_TIME, parked (0) before and after.
 */
export function gantryOffset(since: number): number {
  if (!(since > 0) || since >= GANTRY_TIME) return 0;
  const s = smoothstep(since / GANTRY_TIME);
  return GANTRY_SWING * Math.sin(2 * Math.PI * GANTRY_SWEEPS * s);
}
