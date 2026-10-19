// Knowledge of sectors (the sectors design, knowledge section):
// derived from the seed, the saved `explored` chunk set and – since stage 2 – the saved charts
// (`RegionsState`: survey points, bought charts) and the Guild Training step.
//
//   sectorChunkKeys(seed, id)               → the chunks of a sector (chunk centre inside it), cached
//   sectorCoverage(seed, explored, id)      → { explored, total, share } of those chunks, cached per set
//   knowledgeOf(seed, explored, id)         → Charted / Reported / Uncharted from flight coverage only
//   sectorKnowledge(state, id)              → the knowledge of a sector in a game (all the rules below)
//   surveyDone(state, id)                   → every survey point of the sector is marked
//   ownChart(state, id)                     → the player charted the sector (coverage or survey) – the
//                                             chart they may sell (§4.2)
//   trainingChartSector(seed)               → lane A's first sector, charted by the training step 8 (§6.6)
//   newlyCharted(seed, explored, fresh)     → sectors that the chunks `fresh` (just added) pushed over the
//                                             coverage threshold – the trigger of the flat Data (§4.1)
//
// A sector is Charted when it is Charted at the start (Origin; lane A's first sector once the Guild
// Training is past its checklist step), bought, fully surveyed, or when at least
// `REGION_GEN.charting.coverage` (70 %) of its chunks are explored. Otherwise it is Reported when it is
// Reported at the start, a neighbour of a bought sector, or the training sector still withheld; the
// rest is Uncharted. `explored`, the marked points and the bought set only grow, so Charted never goes
// back.
import { stepIndex } from '../../data/training';
import { neighbours } from './adjacency';
import { sectorChunkKeys } from './chunks';
import { REGION_GEN, type Knowledge } from './constants';
import { sectorInfo } from './sectors';
import type { RegionsState } from './state';
import { surveyMask } from './survey';
import { regionWorld } from './world';

export { sectorChunkKeys };

export interface SectorCoverage {
  /** Explored chunks of the sector. */
  explored: number;
  /** All chunks of the sector (chunk centre inside it). */
  total: number;
  /** explored / total (0 for an empty sector). */
  share: number;
}

/** The minimal game state the knowledge reads (SimState fits). */
export interface KnowledgeSource {
  seed: number;
  world: { explored: ReadonlySet<string> };
  /** Survey points and bought charts (stage 2, save V15); absent = none. */
  regions?: Pick<RegionsState, 'points' | 'bought'>;
  /** The Guild Training withholds lane A's first sector until its checklist step pays (§6.6). */
  career?: { training: { status: string; step: number } };
}

/** Explored chunks a sector of `total` chunks needs to be Charted (≥ 70 %, at least one). */
export const chartThreshold = (total: number): number => Math.max(1, Math.ceil(total * REGION_GEN.charting.coverage - 1e-9));

/** Flat Data for charting a sector of this depth (§4.1, halved by §6.4: 2 / 3 / 6; depth 4+ nothing yet). */
export const chartingData = (depth: number): number => REGION_GEN.charting.data[Math.min(4, Math.max(1, depth)) as 1 | 2 | 3 | 4];

// ---------------------------------------------------------------------------
// coverage, counted incrementally per explored set

interface CoverageCount {
  seed: number;
  /** How many keys of the set (in insertion order) are counted. */
  seen: number;
  bySector: Map<string, number>;
}

const counts = new WeakMap<ReadonlySet<string>, CoverageCount>();

/** Explored chunks per sector id (the set only grows in play: counted incrementally; restarts if it shrank). */
function exploredBySector(seed: number, explored: ReadonlySet<string>): ReadonlyMap<string, number> {
  let c = counts.get(explored);
  if (!c || c.seed !== seed || c.seen > explored.size) {
    c = { seed, seen: 0, bySector: new Map() };
    counts.set(explored, c);
  }
  if (c.seen === explored.size) return c.bySector;
  const field = regionWorld(seed).field;
  let i = 0;
  for (const key of explored) {
    if (i++ < c.seen) continue;
    const comma = key.indexOf(',');
    const id = field.regionOfChunk(Number(key.slice(0, comma)), Number(key.slice(comma + 1))).id;
    c.bySector.set(id, (c.bySector.get(id) ?? 0) + 1);
  }
  c.seen = explored.size;
  return c.bySector;
}

/** Flight coverage of a sector: explored chunks of it / all its chunks. */
export function sectorCoverage(seed: number, explored: ReadonlySet<string>, id: string): SectorCoverage {
  const total = sectorChunkKeys(seed, id).length;
  const n = Math.min(total, exploredBySector(seed, explored).get(id) ?? 0);
  return { explored: n, total, share: total > 0 ? n / total : 0 };
}

/** Charted by flight coverage (≥ 70 % of the sector's chunks explored)? */
export const chartedByCoverage = (c: SectorCoverage): boolean => c.total > 0 && c.explored >= chartThreshold(c.total);

/** `chartedByCoverage(sectorCoverage(seed, explored, id))` without the coverage object (asked per sector per frame). */
function coveredEnough(seed: number, explored: ReadonlySet<string>, id: string): boolean {
  const total = sectorChunkKeys(seed, id).length;
  const n = Math.min(total, exploredBySector(seed, explored).get(id) ?? 0);
  return total > 0 && n >= chartThreshold(total);
}

/** Knowledge of a sector from the seed and the explored chunks only (stage 1b rule; no charts, no training). */
export function knowledgeOf(seed: number, explored: ReadonlySet<string>, id: string): Knowledge {
  const start = sectorInfo(seed, id)?.startKnowledge ?? 'uncharted';
  if (start === 'charted') return 'charted';
  return chartedByCoverage(sectorCoverage(seed, explored, id)) ? 'charted' : start;
}

/**
 * Lane A's first sector (the start-Charted sector that is not Origin), or null. From stage 2 the
 * Guild Training charts it with the reward of its checklist step (§6.6); without a running training
 * (done, skipped, an old game) it is Charted from the start as before.
 */
export function trainingChartSector(seed: number): string | null {
  const world = regionWorld(seed);
  for (const [id, k] of world.startKnowledge) if (k === 'charted' && id !== world.field.origin.id) return id;
  return null;
}

const CHECKLIST = stepIndex('checklist');

/** The training still withholds the chart of lane A's first sector (before the checklist reward). */
export function trainingWithholds(state: Pick<KnowledgeSource, 'career'>): boolean {
  const t = state.career?.training;
  return t !== undefined && t.status === 'active' && t.step <= CHECKLIST;
}

/** Every survey point of the sector is marked (a sector without points never is). */
export function surveyDone(state: Pick<KnowledgeSource, 'seed' | 'regions'>, id: string): boolean {
  // no point marked → no need to place the sector's points (the map asks every sector, every frame)
  const marked = state.regions?.points.get(id) ?? 0;
  if (marked === 0) return false;
  const mask = surveyMask(state.seed, id);
  return mask > 0 && (marked & mask) === mask;
}

/** Bought set → the sectors its neighbours make Reported (cached per set and size). */
const reportedCache = new WeakMap<ReadonlySet<string>, { seed: number; size: number; ids: Set<string> }>();

function reportedByBought(seed: number, bought: ReadonlySet<string>): ReadonlySet<string> {
  const hit = reportedCache.get(bought);
  if (hit && hit.seed === seed && hit.size === bought.size) return hit.ids;
  const field = regionWorld(seed).field;
  const ids = new Set<string>();
  for (const id of bought) {
    const s = field.seedById(id);
    if (s) for (const n of neighbours(field, s)) ids.add(n.id);
  }
  reportedCache.set(bought, { seed, size: bought.size, ids });
  return ids;
}

/**
 * The player charted the sector themselves – by flight coverage or by its survey points – and it was
 * not Charted at the start or bought. This is the chart the Guild may buy (§4.2; sectors charted by
 * coverage before stage 2 count too).
 */
export function ownChart(state: KnowledgeSource, id: string): boolean {
  const info = sectorInfo(state.seed, id);
  if (!info || info.startKnowledge === 'charted' || state.regions?.bought.has(id)) return false;
  return surveyDone(state, id) || coveredEnough(state.seed, state.world.explored, id);
}

/** Knowledge of a sector in a game (Charted / Reported / Uncharted) – see the header for the rules. */
export function sectorKnowledge(state: KnowledgeSource, id: string): Knowledge {
  const info = sectorInfo(state.seed, id);
  if (!info) return 'uncharted';
  const withheld = info.startKnowledge === 'charted' && !info.origin && trainingWithholds(state);
  if (info.startKnowledge === 'charted' && !withheld) return 'charted';
  if (state.regions?.bought.has(id) || surveyDone(state, id)) return 'charted';
  if (coveredEnough(state.seed, state.world.explored, id)) return 'charted';
  if (withheld || info.startKnowledge === 'reported') return 'reported';
  const bought = state.regions?.bought;
  if (bought && bought.size > 0 && reportedByBought(state.seed, bought).has(id)) return 'reported';
  return 'uncharted';
}

/**
 * Sectors that the chunks `fresh` – just added to `explored` (already inside it) – pushed over the
 * charting threshold, in id order. Start-Charted sectors never count (they were Charted already).
 * Each sector can be returned only once in a game: before the step it was below the threshold, after
 * it is above, and `explored` never shrinks.
 */
export function newlyCharted(seed: number, explored: ReadonlySet<string>, fresh: readonly string[]): string[] {
  if (fresh.length === 0) return [];
  const field = regionWorld(seed).field;
  const added = new Map<string, number>();
  const unique = new Set(fresh);
  for (const key of unique) {
    if (!explored.has(key)) continue;
    const comma = key.indexOf(',');
    const id = field.regionOfChunk(Number(key.slice(0, comma)), Number(key.slice(comma + 1))).id;
    added.set(id, (added.get(id) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const [id, n] of added) {
    if (sectorInfo(seed, id)?.startKnowledge === 'charted') continue;
    const c = sectorCoverage(seed, explored, id);
    const threshold = chartThreshold(c.total);
    if (c.total > 0 && c.explored >= threshold && c.explored - n < threshold) out.push(id);
  }
  return out.sort();
}
