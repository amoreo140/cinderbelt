import type { Vec2 } from '../sim/math/vec2';
import type { ShipProperties, ThrustGroup } from '../sim/ship/properties';

/** What part of the engine group's thrust is currently used (0..1). */
export function groupThrottle(group: ThrustGroup, localForce: Vec2, props: ShipProperties): number {
  const max = props.thrust[group];
  if (max <= 0) return 0;
  let used = 0;
  switch (group) {
    case 'forward': used = Math.max(0, localForce.x); break;
    case 'backward': used = Math.max(0, -localForce.x); break;
    case 'left': used = Math.max(0, localForce.y); break;
    case 'right': used = Math.max(0, -localForce.y); break;
  }
  return Math.min(1, used / max);
}
