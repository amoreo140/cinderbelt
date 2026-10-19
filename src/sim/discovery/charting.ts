// Charting sectors (sectors design §4.1): a sector the player charts pays its small flat Data once.
//  - Flight coverage (stage 1b): the chunks explored in this step push the sector over 70 % coverage.
//    Derived from `explored` – it only grows, so the threshold is crossed once per sector.
//  - Survey points (stage 2): a scanner pulse within 150 u of a point marks it (saved bit mask,
//    `regions.points`); the last point charts the sector.
// Both paths share one rule: a sector pays only when it was not Charted before the step (start-Charted,
// bought, surveyed or covered) – charting it the other way later adds nothing.
import {
  chartingData,
  newlyCharted,
  REGION_GEN,
  sectorInfo,
  sectorKnowledge,
  surveyDone,
  surveyMask,
  surveyPoints,
  surveyPointsNear,
} from '../regions';
import type { Vec2 } from '../math/vec2';
import type { SimEvent, SimState } from '../Simulation';
import { gainData } from './state';

function charted(state: SimState, id: string, via: 'coverage' | 'survey', events: SimEvent[]): void {
  const depth = sectorInfo(state.seed, id)?.depth ?? 1;
  const data = chartingData(depth);
  events.push({ type: 'sectorCharted', id, depth, data, via });
  gainData(state, data, 'chart', events);
}

/**
 * Reads the chunks the latest world update explored (`world.newlyExplored`) without consuming them –
 * the pirate step clears the list later in the same step. Run it before `stepPirates`.
 */
export function stepCharting(state: SimState, events: SimEvent[]): void {
  const fresh = state.world.newlyExplored;
  if (fresh.length === 0) return;
  for (const id of newlyCharted(state.seed, state.world.explored, fresh)) {
    // already Charted another way (survey points, a bought chart): nothing new
    if (state.regions.bought.has(id) || surveyDone(state, id)) continue;
    charted(state, id, 'coverage', events);
  }
}

/**
 * A scanner pulse at `at` marks the survey points within range of sectors that are not Charted yet;
 * the last point of a sector charts it (Data once). Returns the number of points marked.
 */
export function surveyPulse(state: SimState, at: Vec2, events: SimEvent[]): number {
  let marked = 0;
  const points = state.regions.points;
  for (const p of surveyPointsNear(state.seed, at, REGION_GEN.survey.range)) {
    const mask = points.get(p.sector) ?? 0;
    const bit = 1 << p.index;
    if (mask & bit) continue;
    if (sectorKnowledge(state, p.sector) === 'charted') continue;
    const next = mask | bit;
    points.set(p.sector, next);
    marked++;
    const full = surveyMask(state.seed, p.sector);
    let done = 0;
    for (let m = next & full; m; m >>>= 1) done += m & 1;
    events.push({ type: 'surveyPointMarked', sector: p.sector, index: p.index, pos: { ...p.pos }, done, total: surveyPoints(state.seed, p.sector).length });
    // not Charted before this point (checked above), so the last point charts it now
    if ((next & full) === full) charted(state, p.sector, 'survey', events);
  }
  return marked;
}
