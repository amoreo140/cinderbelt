// Survey points in the UI (sectors design §4.1, stage 2): "fly to the point → scanner pulse → discover
// what lies near it". Which points the player sees and how: a callout in flight when close ("Survey
// point · Tab"), a glyph on the radar within its range, the points of the current and the known sectors
// on the map (done / not done), the dots of the HUD badge. Pure functions of the simulation state – the
// points themselves come from the frozen generator (sim/regions/survey.ts), the marks from
// `regions.points`. A Charted sector shows no points: they have nothing more to give.
import { REGION_GEN } from '../../sim/regions/constants';
import { sectorKnowledge } from '../../sim/regions/knowledge';
import { sectorIdAt, sectorInfo } from '../../sim/regions/sectors';
import { surveyPoints, surveyPointsNear, type SurveyPoint } from '../../sim/regions/survey';
import { regionWorld } from '../../sim/regions/world';
import type { Vec2 } from '../../sim/math/vec2';
import type { SimState } from '../../sim/Simulation';

/** The pulse marks a point within this distance of the ship (u). */
export const SURVEY_RANGE = REGION_GEN.survey.range;
/** A survey point gets a callout in flight within this distance (u) – a little beyond the pulse. */
export const SURVEY_CALLOUT_RANGE = 320;

export interface SurveyMark {
  /** `survey:<sector>:<index>` – stable key for callouts and the renderer. */
  id: string;
  sector: string;
  index: number;
  pos: Vec2;
  /** The scanner marked this point already. */
  done: boolean;
  /** Marked points of its sector / all of them. */
  marked: number;
  total: number;
}

const popcount = (mask: number): number => {
  let n = 0;
  for (let m = mask; m; m >>>= 1) n += m & 1;
  return n;
};

/** Marked points of a sector (bit mask of `regions.points`, limited to its points). */
export function surveyMarks(state: Pick<SimState, 'seed' | 'regions'>, id: string): { mask: number; done: number; total: number } {
  const total = surveyPoints(state.seed, id).length;
  const mask = (state.regions.points.get(id) ?? 0) & ((1 << total) - 1);
  return { mask, done: popcount(mask), total };
}

function markOf(p: SurveyPoint, mask: number, done: number, total: number): SurveyMark {
  return { id: `survey:${p.sector}:${p.index}`, sector: p.sector, index: p.index, pos: p.pos, done: (mask & (1 << p.index)) !== 0, marked: done, total };
}

/** The points of one sector with their marks (none when the sector is Charted). */
export function sectorSurveyMarks(state: SimState, id: string): SurveyMark[] {
  if (sectorKnowledge(state, id) === 'charted') return [];
  const { mask, done, total } = surveyMarks(state, id);
  return surveyPoints(state.seed, id).map((p) => markOf(p, mask, done, total));
}

/**
 * The survey points near a point, kept for the last two queries (the radar's range and the callouts'):
 * `surveyPointsNear` samples nine sector lookups each time, and a ship that holds still asks the same.
 */
const nearMemo: { seed: number; x: number; y: number; radius: number; points: readonly SurveyPoint[] }[] = [];

function pointsNear(seed: number, pos: Vec2, radius: number): readonly SurveyPoint[] {
  for (const m of nearMemo) if (m.seed === seed && m.x === pos.x && m.y === pos.y && m.radius === radius) return m.points;
  const points = surveyPointsNear(seed, pos, radius);
  nearMemo.unshift({ seed, x: pos.x, y: pos.y, radius, points });
  if (nearMemo.length > 2) nearMemo.length = 2;
  return points;
}

/** Survey points within `radius` of `pos` in sectors that are not Charted yet (nearest first). */
export function surveyMarksNear(state: SimState, pos: Vec2, radius: number): SurveyMark[] {
  const charted = new Map<string, boolean>();
  const out: (SurveyMark & { dist: number })[] = [];
  for (const p of pointsNear(state.seed, pos, radius)) {
    let c = charted.get(p.sector);
    if (c === undefined) {
      c = sectorKnowledge(state, p.sector) === 'charted';
      charted.set(p.sector, c);
    }
    if (c) continue;
    const { mask, done, total } = surveyMarks(state, p.sector);
    out.push({ ...markOf(p, mask, done, total), dist: Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y) });
  }
  out.sort((a, b) => a.dist - b.dist || (a.id < b.id ? -1 : 1));
  return out.map(({ dist: _d, ...m }) => m);
}

/**
 * Sectors whose survey points the map always shows: not Charted, and the player is working on them –
 * the ship's own sector, one with a marked point, the target of a `chart` contract. Any other sector
 * the player knows shows its points while its card is open (`sectorSurveyMarks`, the map's hover), so
 * the map does not fill with reticles (§3.3: an unknown sector reveals nothing).
 */
export function mapSurveySectors(state: SimState, current: string | null): string[] {
  const targets = new Set(state.career.contracts.flatMap((c) => (c.target.kind === 'chart' ? [c.target.sector] : [])));
  const out: string[] = [];
  for (const r of regionWorld(state.seed).regions) {
    const id = r.seed.id;
    if (surveyPoints(state.seed, id).length === 0) continue;
    if (id !== current && !targets.has(id) && (state.regions.points.get(id) ?? 0) === 0) continue;
    if (sectorKnowledge(state, id) !== 'charted') out.push(id);
  }
  return out;
}

/** Survey points for the map: every point of `mapSurveySectors`. */
export function mapSurveyMarks(state: SimState, current: string | null = sectorIdAt(state.seed, state.player.body.pos.x, state.player.body.pos.y)): SurveyMark[] {
  return mapSurveySectors(state, current).flatMap((id) => sectorSurveyMarks(state, id));
}

/** A key that changes whenever the map's survey points may change (marks, charts, contracts, flown chunks). */
export function surveyKey(state: SimState, current: string | null): string {
  let marks = 0;
  for (const [id, m] of state.regions.points) marks += m * (id.length + 1);
  const chart = state.career.contracts.flatMap((c) => (c.target.kind === 'chart' ? [c.target.sector] : [])).join(',');
  return `${state.seed}|${current}|${state.regions.points.size}:${marks}|${state.regions.bought.size}|${state.world.explored.size}|${chart}|${state.career.training.status}:${state.career.training.step}`;
}

/** The dots of the HUD badge: one per survey point of the sector, filled when marked (null = none to show). */
export function badgeDots(state: SimState, id: string): { done: number; total: number } | null {
  const info = sectorInfo(state.seed, id);
  if (!info || sectorKnowledge(state, id) === 'charted') return null;
  const { done, total } = surveyMarks(state, id);
  return total > 0 ? { done, total } : null;
}
