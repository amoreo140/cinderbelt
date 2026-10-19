// Objectives panel (9.1): an always visible next step on three scales – now (Guild Training step,
// contract), today (a ship part), this week (career, the next ring). Derived from the game state;
// every objective has a "Why" (one sentence) and a "Where" (a point in the world, if any).
import { RECIPES } from '../../data/economy';
import { parsePartKey, type PartId } from '../../data/parts';
import { RESOURCE_IDS, type ResourceId } from '../../data/resources';
import { SHIP_GOALS, type ShipGoal } from '../../data/shipGoals';
import { REP_FACTION_IDS } from '../../data/factions';
import { getLocale, tx, type Locale } from '../../i18n';
import { trainingActive } from '../../sim/training/training';
import { trainingObjective } from '../training/trainingView';
import { assignmentProgress, assignmentTarget, nextLevelDef } from '../../sim/factions/reputation';
import { length, type Vec2 } from '../../sim/math/vec2';
import type { SimState } from '../../sim/Simulation';
import { availableResources, stationStorage } from '../../sim/station/storage';
import { CHUNK_SIZE } from '../../sim/world/chunks';
import { regionWorld, sectorInfoOfChunk } from '../../sim/regions';
import { ringIndexAt } from '../../sim/world/rings';
import { nearestDiscoveredStation, stationById } from '../../sim/world/stations';
import { formatCredits } from '../../ui/format';
import { echoSites } from '../../sim/discovery/poi';
import { hasFeature } from '../../sim/discovery/archive';
import { contractNext, contractTarget, contractWhy, nextSurveyPoint } from '../board/slipView';
import { TapeMemo } from '../viewMemo';
import { firstChartTarget } from '../../sim/charts/charts';
import { sectorInfo } from '../../sim/regions/sectors';
import { sectorName } from '../../ui/sectors/sectorText';
import { amountText, assignmentText, partLabel, resourceName, stationLabel } from '../board/names';

export type ObjectiveScale = 'now' | 'today' | 'week';
export type ObjectiveTrack = 'training' | 'contract' | 'ship' | 'career' | 'main' | 'story';

export interface Objective {
  id: string;
  scale: ObjectiveScale;
  track: ObjectiveTrack;
  title: string;
  why: string;
  /** Where to fly (null = anywhere / at the station). */
  target: Vec2 | null;
  progress: { value: number; max: number } | null;
  /** Extra note (where the resources already are). */
  note?: string;
  /** Contract (for cancelling from the panel). */
  contract?: number;
}

/** How many "pieces" of a part the ship has (higher tiers and large variants count). */
function shipCount(state: SimState, goal: ShipGoal): number {
  const { partId, tier } = parsePartKey(goal.key);
  const weight: Partial<Record<PartId, [PartId, number][]>> = {
    cargo: [['cargo', 1], ['largeCargo', 4]],
    miningLaser: [['miningLaser', 1], ['heavyLaser', 2]],
    reactor: [['reactor', 1], ['largeReactor', 4]],
  };
  const kinds = weight[partId] ?? [[partId, 1]];
  let n = 0;
  for (const p of state.player.grid.parts) {
    const w = kinds.find(([id]) => id === p.partId);
    if (w && p.tier >= tier) n += w[1];
  }
  return n;
}

/** The station where the player crafts (the docked one, otherwise the respawn point). */
function workshopId(state: SimState): string {
  const dock = state.player.dock;
  return dock.mode === 'docked' ? dock.stationId : state.respawn.stationId;
}

/** The first ship goal not met yet and the ship's count of it, by grid (a refit replaces the grid). */
const goalMemo = new WeakMap<object, { length: number; goal: ShipGoal | null; count: number }>();

function shipGoal(state: SimState): { goal: ShipGoal | null; count: number } {
  const grid = state.player.grid;
  const hit = goalMemo.get(grid);
  if (hit && hit.length === grid.parts.length) return hit;
  let count = 0;
  const goal =
    SHIP_GOALS.find((g) => {
      count = shipCount(state, g);
      return count < g.count;
    }) ?? null;
  const out = { length: grid.parts.length, goal, count };
  goalMemo.set(grid, out);
  return out;
}

const shipMemo = new TapeMemo<Objective | null>();

/**
 * The next ship part (the "today" objective). Kept while what it reads stays: the language, the grid,
 * the workshop, credits, the cargo and every station storage (the notes say where missing resources are).
 */
function shipObjective(state: SimState): Objective | null {
  const { goal, count } = shipGoal(state);
  if (!goal) return null;
  return shipMemo.get(
    (push) => {
      push(state);
      push(getLocale());
      push(goal);
      push(count);
      push(workshopId(state));
      push(state.credits);
      const cargo = state.player.cargo;
      for (const r of RESOURCE_IDS) push(cargo[r]);
      for (const [id, st] of state.stations) {
        push(id);
        for (const r of RESOURCE_IDS) push(st.resources[r]);
        push(st.parts[goal.key] ?? 0);
      }
    },
    () => buildShipObjective(state, goal, count),
  );
}

function buildShipObjective(state: SimState, goal: ShipGoal, count: number): Objective {
  const at = workshopId(state);
  const have = availableResources(state, at);
  const recipe = RECIPES[goal.key];
  const missing: string[] = [];
  const short: ResourceId[] = [];
  for (const r of RESOURCE_IDS) {
    const need = (recipe.resources[r] ?? 0) - have[r];
    if (need > 1e-9) {
      missing.push(`${amountText(Math.ceil(need))} ${resourceName(r)}`);
      short.push(r);
    }
  }
  // the part is already in storage – it only needs to be fitted
  const inStorage = (stationStorage(state, at).parts[goal.key] ?? 0) > 0;
  const credits = recipe.credits - state.credits;
  if (credits > 0 && !inStorage) missing.push(formatCredits(credits));
  // where the missing resources already are (other storages)
  const notes: string[] = [];
  for (const r of short) {
    let best: { id: string; amount: number } | null = null;
    for (const [id, s] of state.stations) if (id !== at && s.resources[r] > 0.5 && (!best || s.resources[r] > best.amount)) best = { id, amount: s.resources[r] };
    if (best) notes.push(`${resourceName(r)} ${amountText(best.amount)} @ ${stationLabel(state.seed, best.id)}`);
  }
  const title = `${partLabel(goal.key)}: ${inStorage ? tx().goals.objectives.shipReady : missing.length > 0 ? tx().goals.objectives.shipMissing(missing.join(', ')) : tx().goals.objectives.shipReady}`;
  return {
    id: `ship:${goal.key}`,
    scale: 'today',
    track: 'ship',
    title,
    why: tx().goals.objectives.shipWhy[goal.key] ?? tx().goals.objectives.mineAndSellWhy,
    target: null,
    progress: { value: count, max: goal.count },
    ...(notes.length > 0 ? { note: notes.join(' · ') } : {}),
  };
}

const careerMemo = new TapeMemo<Objective[]>();

/** The reputation objectives, kept while the language and each faction's level, points and assignments stay. */
function careerObjectives(state: SimState): Objective[] {
  return careerMemo.get(
    (push) => {
      push(getLocale());
      for (const f of REP_FACTION_IDS) {
        const rep = state.career.rep[f];
        push(rep.level);
        push(rep.points);
        for (const a of nextLevelDef(rep, f)?.assignment ?? []) push(assignmentProgress(rep, a));
      }
    },
    () => buildCareerObjectives(state),
  );
}

function buildCareerObjectives(state: SimState): Objective[] {
  const out: Objective[] = [];
  for (const f of REP_FACTION_IDS) {
    const rep = state.career.rep[f];
    const next = nextLevelDef(rep, f);
    if (!next) continue;
    const name = tx().goals.factionShort[f];
    const unlock = next.unlocks.map((u) => tx().goals.unlocks[u]).join(', ');
    let title: string;
    let progress: Objective['progress'] = { value: rep.points, max: next.points };
    if (rep.points < next.points || !next.assignment) {
      title = tx().goals.objectives.careerPoints(name, next.level, Math.max(0, next.points - rep.points));
    } else {
      const parts = next.assignment.map((a) => `${assignmentText(a)} (${amountText(assignmentProgress(rep, a))}/${assignmentTarget(a)})`);
      title = tx().goals.objectives.career(name, next.level, parts.join(` ${tx().goals.board.or.toUpperCase()} `));
      progress = null;
    }
    out.push({ id: `career:${f}`, scale: 'week', track: 'career', title, why: tx().goals.objectives.careerWhy(unlock), target: null, progress });
  }
  return out;
}

/**
 * Highest ring with an explored chunk, cached per explored set: the set only grows (insertion
 * order), so only chunks added since the last look are parsed – not the whole set every frame.
 */
const highestRingCache = new WeakMap<ReadonlySet<string>, { seen: number; ring: number }>();

export function highestRingVisited(explored: ReadonlySet<string>): number {
  let entry = highestRingCache.get(explored);
  if (entry && entry.seen > explored.size) entry = undefined; // the set shrank (cannot happen in play) – start over
  const out = entry ?? { seen: 0, ring: -1 };
  if (out.seen === explored.size) return out.ring;
  let i = 0;
  for (const key of explored) {
    if (i++ < out.seen) continue;
    const [cx, cy] = key.split(',').map(Number) as [number, number];
    out.ring = Math.max(out.ring, ringIndexAt(length({ x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE })));
  }
  out.seen = explored.size;
  highestRingCache.set(explored, out);
  return out.ring;
}

const highestDepthCache = new WeakMap<ReadonlySet<string>, { seed: number; seen: number; depth: number }>();

/** The deepest sector depth of any explored chunk (its centre's sector; −1 when nothing is explored). */
export function highestDepthVisited(seed: number, explored: ReadonlySet<string>): number {
  let entry = highestDepthCache.get(explored);
  if (entry && (entry.seed !== seed || entry.seen > explored.size)) entry = undefined;
  const out = entry ?? { seed, seen: 0, depth: -1 };
  if (out.seen === explored.size) return out.depth;
  let i = 0;
  for (const key of explored) {
    if (i++ < out.seen) continue;
    const [cx, cy] = key.split(',').map(Number) as [number, number];
    out.depth = Math.max(out.depth, sectorInfoOfChunk(seed, cx, cy).depth);
  }
  out.seen = explored.size;
  highestDepthCache.set(explored, out);
  return out.depth;
}

/** Has the player already been in a sector of depth ≥ `depth` (an explored chunk)? */
function visitedDepth(state: SimState, depth: number): boolean {
  return highestDepthVisited(state.seed, state.world.explored) >= depth;
}

/**
 * Where "fly deeper" points: the nearest sector of the depth (its seed point), Pirate sectors last –
 * the map and the edge arrow show the way into a real sector, not onto a circle (sectors §6.2).
 */
function nearestSectorOfDepth(state: SimState, depth: number): Vec2 | null {
  const pos = state.player.body.pos;
  let best: Vec2 | null = null;
  let bestScore = Infinity;
  for (const r of regionsOfDepth(state.seed, depth)) {
    const d = Math.hypot(r.x - pos.x, r.y - pos.y) * r.weight;
    if (d < bestScore) {
      bestScore = d;
      best = { x: r.x, y: r.y };
    }
  }
  return best;
}

/** Sector seed points of one depth with their distance weight (Pirate sectors last), per seed. */
const depthSeeds = new Map<string, readonly { x: number; y: number; weight: number }[]>();

function regionsOfDepth(seed: number, depth: number): readonly { x: number; y: number; weight: number }[] {
  const key = `${seed}:${depth}`;
  let list = depthSeeds.get(key);
  if (!list) {
    list = regionWorld(seed)
      .regions.filter((r) => r.seed.depth === depth)
      .map((r) => ({ x: r.seed.x, y: r.seed.y, weight: r.security === 'pirate' ? 3 : 1 }));
    if (depthSeeds.size > 16) depthSeeds.clear();
    depthSeeds.set(key, list);
  }
  return list;
}

/**
 * Story (5.7.2): the next step towards the Echoes – locate, analyse, decoder, shard. The journal only
 * reveals what the player has seen; the objective never shows the exact spot of an unlocated Echo,
 * only the direction "outwards".
 */
export function storyObjective(state: SimState): Objective | null {
  const d = state.discovery;
  const sites = echoSites(state.seed);
  const o = tx().discovery.story;
  const make = (id: string, title: string, why: string, target: Vec2 | null, progress: Objective['progress'] = null): Objective => ({
    id: `story:${id}`,
    scale: 'today',
    track: 'story',
    title,
    why,
    target,
    progress,
  });
  // outward direction from Echo-0 (the entry "heading outwards, to the Outer Belts")
  const outward = (r: number): Vec2 => {
    const e0 = sites[0]!.pos;
    const k = r / Math.max(1, Math.hypot(e0.x, e0.y));
    return { x: e0.x * k, y: e0.y * k };
  };
  if (!d.scanned.has('echo:0')) {
    if (d.known.has('echo:0')) return make('echo0', o.analyse(0), o.analyseWhy, sites[0]!.pos);
    return make('echo0fix', o.locate0, o.locate0Why, null, { value: d.fixes.get('echo:0')?.pulses.length ?? 0, max: 3 });
  }
  if (!hasFeature(state, 'echoDecoder')) return make('decoder', o.decoder, o.decoderWhy, null);
  if (!d.scanned.has('echo:1')) {
    if (d.known.has('echo:1')) return make('echo1', o.analyse(1), o.analyseWhy, sites[1]!.pos);
    return make('echo1fix', o.listen(1), o.listen1Why, outward(2000), d.fixes.has('echo:1') ? { value: d.fixes.get('echo:1')!.pulses.length, max: 3 } : null);
  }
  if (!d.keyItems.has('shard')) return make('shard', o.shard, o.shardWhy, null);
  if (!d.scanned.has('echo:2')) {
    if (d.known.has('echo:2')) return make('echo2', o.analyse(2), o.analyseWhy, sites[2]!.pos);
    return make('echo2fix', o.listen(2), o.listen2Why, outward(2900), d.fixes.has('echo:2') ? { value: d.fixes.get('echo:2')!.pulses.length, max: 3 } : null);
  }
  return null;
}

function mainObjective(state: SimState): Objective {
  // ids stay `main:ring2/3` (UI test ids); the goal is the next sector depth
  if (!visitedDepth(state, 2)) {
    return { id: 'main:ring2', scale: 'week', track: 'main', title: tx().goals.objectives.ring2, why: tx().goals.objectives.ring2Why, target: nearestSectorOfDepth(state, 2), progress: null };
  }
  return { id: 'main:ring3', scale: 'week', track: 'main', title: tx().goals.objectives.ring3, why: tx().goals.objectives.ring3Why, target: visitedDepth(state, 3) ? null : nearestSectorOfDepth(state, 3), progress: null };
}

const memo = new WeakMap<SimState, { tick: number; locale: Locale; objectives: Objective[] }>();

/**
 * computeObjectives memoized per simulation tick: the HUD band, the edge arrow and the map ask
 * several times a frame, and the state only changes in a step (station actions apply in the next
 * step too); a language switch recomputes the texts. Read-only result – callers must not mutate it.
 */
export function objectivesAt(state: SimState): readonly Objective[] {
  const hit = memo.get(state);
  const locale = getLocale();
  if (hit && hit.tick === state.tick && hit.locale === locale) return hit.objectives;
  const objectives = computeObjectives(state);
  memo.set(state, { tick: state.tick, locale, objectives });
  return objectives;
}

/** All objectives (order: now → today → this week). */
export function computeObjectives(state: SimState): Objective[] {
  const out: Objective[] = [];
  const training = trainingObjective(state);
  if (training) out.push({ ...training, scale: 'now', track: 'training' });
  for (const c of state.career.contracts) {
    const { next, progress } = contractNext(state, c);
    let target = contractTarget(state, c);
    // a completed contract is handed in at the nearest station
    if (c.ready) target = nearestDiscoveredStation(state.seed, state.world.discovered, state.player.body.pos).pos;
    out.push({ id: `contract:${c.serial}`, scale: 'now', track: 'contract', title: next, why: contractWhy(state, c), target, progress, contract: c.serial });
  }
  // the training is the only "now" (one onboarding, nothing that competes with it)
  if (out.length === 0 && !training) {
    const docked = state.player.dock.mode === 'docked';
    out.push({
      id: docked ? 'hint:board' : 'hint:mine',
      scale: 'now',
      track: 'contract',
      title: docked ? tx().goals.objectives.takeContract : tx().goals.objectives.mineAndSell,
      why: docked ? tx().goals.objectives.takeContractWhy : tx().goals.objectives.mineAndSellWhy,
      target: null,
      progress: null,
    });
    // "First chart" after the training (sectors §6.6): the nearest sector to chart and sell, in flight
    const first = docked ? null : firstChartTarget(state);
    if (first) {
      const info = sectorInfo(state.seed, first.id);
      out.push({
        id: 'hint:firstChart',
        scale: 'now',
        track: 'contract',
        title: tx().sectors.charts.firstObjective(info ? sectorName(info.name) : first.id),
        why: tx().goals.why.chartFirst,
        target: nextSurveyPoint(state, first.id) ?? first.anchor,
        progress: null,
      });
    }
  }
  // the story and the next part wait until the training is over (it builds the ship step by step)
  const story = trainingActive(state) ? null : storyObjective(state);
  if (story) out.push(story);
  const ship = trainingActive(state) ? null : shipObjective(state);
  if (ship) out.push(ship);
  out.push(...careerObjectives(state));
  out.push(mainObjective(state));
  return out;
}

