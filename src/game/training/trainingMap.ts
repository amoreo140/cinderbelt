// Guild Training step 8 "checklist" on the map (sectors design §6.6): while the step runs, the open map
// explains the sector layer with four callouts – Origin [x] (home, Charted), the Guild Lane (the safe way
// out), the nearest Reported neighbour [?] and the red pirate corner ("do not fly there without a
// cannon"). Pure data from the simulation state; MapView projects the points and draws the callouts.
import { tx } from '../../i18n';
import type { MapNote } from '../discovery/exploreUi';
import { sectorKnowledge, trainingChartSector } from '../../sim/regions/knowledge';
import { sectorIdAt, sectorInfo, sectorLanes } from '../../sim/regions/sectors';
import { regionWorld } from '../../sim/regions/world';
import { currentTrainingStep } from '../../sim/training/training';
import type { Vec2 } from '../../sim/math/vec2';
import type { SimState } from '../../sim/Simulation';
import { homeStation } from '../../sim/world/stations';
import { sectorName } from '../../ui/sectors/sectorText';

/** The lane callout sits on lane A about this far from home (u) – clear of the home station's label. */
export const LANE_NOTE_DISTANCE = 1000;
/** The Origin callout sits this far from home, across the lane (u) – off the station's own label. */
const ORIGIN_NOTE_OFFSET = 220;
/** Reported neighbours farther than this from home are not explained (u). */
const REPORTED_RANGE = 2600;

/** The point of a polyline at `distance` from `from` (straight-line distance), or its last point. */
function pointAlong(points: readonly Vec2[], from: Vec2, distance: number): Vec2 | null {
  for (const p of points) if (Math.hypot(p.x - from.x, p.y - from.y) >= distance) return p;
  return points[points.length - 1] ?? null;
}

/** Smallest angle between two directions (rad, 0..π). */
const angleBetween = (a: number, b: number): number => {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};

/** The map callouts of the checklist step (empty in any other step and outside the training). */
export function trainingMapNotes(state: SimState): MapNote[] {
  const step = currentTrainingStep(state.career.training);
  if (step?.id !== 'checklist') return [];
  const t = tx().sectors;
  const world = regionWorld(state.seed);
  const home = homeStation().pos;
  const dir = (p: Vec2) => Math.atan2(p.y - home.y, p.x - home.x);
  const lane = sectorLanes(state.seed)[0];
  const at = lane ? pointAlong(lane.points, home, LANE_NOTE_DISTANCE) : null;
  const corner = world.corners.depth1 ? sectorInfo(state.seed, world.corners.depth1) : null;
  const out: MapNote[] = [];
  const origin = sectorInfo(state.seed, world.field.origin.id);
  if (origin) {
    // beside the home station, across the lane (off the station's label; still inside Origin)
    const away = at ? dir(at) - Math.PI / 2 : 0;
    const pos = { x: home.x + Math.cos(away) * ORIGIN_NOTE_OFFSET, y: home.y + Math.sin(away) * ORIGIN_NOTE_OFFSET };
    out.push({ id: 'training-origin', pos: sectorIdAt(state.seed, pos.x, pos.y) === origin.id ? pos : { ...home }, title: `${t.glyph.charted} ${sectorName(origin.name)}`, detail: t.trainingMap.originDetail, tone: 'ok' });
  }
  if (lane && at) out.push({ id: 'training-lane', pos: { ...at }, title: t.map.lane(lane.id), detail: t.trainingMap.laneDetail, tone: 'info' });
  // a Reported neighbour in a direction of its own (not the lane's or the corner's), near home; not
  // the lane sector the step's reward charts
  const granted = trainingChartSector(state.seed);
  const taken = [at, corner?.anchor].filter((p): p is Vec2 => !!p).map(dir);
  let reported: { id: string; pos: Vec2; score: number } | null = null;
  for (const r of world.regions) {
    const id = r.seed.id;
    if (id === granted || id === world.corners.depth1 || id === world.corners.depth2 || sectorKnowledge(state, id) !== 'reported') continue;
    const pos = { x: r.seed.x, y: r.seed.y };
    const d = Math.hypot(pos.x - home.x, pos.y - home.y);
    if (d > REPORTED_RANGE) continue;
    const apart = Math.min(Math.PI, ...taken.map((a) => angleBetween(a, dir(pos))));
    const score = apart - d / REPORTED_RANGE;
    if (!reported || score > reported.score) reported = { id, pos, score };
  }
  const info = reported ? sectorInfo(state.seed, reported.id) : null;
  // the note sits on the sector's own label – it repeats the name with the glyph
  if (reported && info) out.push({ id: 'training-reported', pos: reported.pos, title: `${t.glyph.reported} ${sectorName(info.name)}`, detail: `${t.trainingMap.reported}: ${t.trainingMap.reportedDetail}`, tone: 'info' });
  if (corner) out.push({ id: 'training-corner', pos: { ...corner.anchor }, title: `${t.glyph[sectorKnowledge(state, corner.id)]} ${sectorName(corner.name)}`, detail: t.trainingMap.cornerDetail, tone: 'warn' });
  return out;
}
