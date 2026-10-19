// The Guild Watch patrols (sectors design §0, §3.1 "Guild Watch"; art batch C1/C2). Since M4d the route
// math lives in the simulation (src/sim/guild/watchRoutes.ts – near the player scheduled ships become
// live sim ships at exactly these poses); the render re-exports it unchanged.
export {
  CUTTER_SPEED,
  FRIGATE_SPEED,
  LANE_SIDE,
  laneLoop,
  lanePatrols,
  PATROL_CELL,
  routeBox,
  routeShips,
  sectorPatrol,
  type PatrolMember,
  type PatrolRoute,
  type RoutePose as WatchShip,
} from '../../sim/guild/watchRoutes';
export type { WatchKind } from '../../data/guild';
