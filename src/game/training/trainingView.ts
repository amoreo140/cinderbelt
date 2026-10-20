// Guild Training in the game layer (M3.7): what the step panel says right now, which UI element and
// which hangar cells to highlight, the world labels and the objective – pure functions of the
// simulation state and the UI situation (tab, shipyard draft). TrainingUi turns them into UI data.
import { RECIPES } from '../../data/economy';
import { parsePartKey, type PartId, type PartInventory, type PartKey } from '../../data/parts';
import { BRAKE_REACH, CHECK_MAP, CHECK_OBJECTIVES, CHECK_REFUEL, TRAINING_STEPS, TRAINING_STEP_COUNT, type TrainingStepDef } from '../../data/training';
import { tx } from '../../i18n';
import { type GuideLine } from '../../i18n/skTraining';
import { length, type Vec2 } from '../../sim/math/vec2';
import type { SimState } from '../../sim/Simulation';
import { computeProperties, type ShipProperties } from '../../sim/ship/properties';
import type { Rotation, ShipGrid } from '../../sim/ship/types';
import { DOCK_APPROACH_RANGE, dockPoint } from '../../sim/station/dock';
import { availableResources, stationStorage } from '../../sim/station/storage';
import { currentTrainingStep, finishChecks, placementCells, reverseEngines, trainingProgress } from '../../sim/training/training';
import { HOME_STATION_ID, homeStation, stationById } from '../../sim/world/stations';
import { formatAmount, formatCredits, formatInt } from '../../ui/format';
import type { StationTab } from '../../ui/station/StationHub';
import { stationLabel } from '../board/names';
import { formatParts } from '../shipyardView';
import { trainingChartSector } from '../../sim/regions/knowledge';
import { sectorInfo } from '../../sim/regions/sectors';
import { sectorName } from '../../ui/sectors/sectorText';

const t = () => tx().training;

/** The UI situation the guidance depends on (not in the simulation). */
export interface TrainingContext {
  /** Hub tab when docked (null in flight). */
  tab: StationTab | null;
  /** Recipe selected in the Crafting tab. */
  craftKey: PartKey | null;
  /** The shipyard editor (its draft) when the Shipyard tab is open. */
  yard: { selected: PartKey | null; rot: Rotation; grid: ShipGrid; dirty: boolean } | null;
  mapOpen: boolean;
  inCombat: boolean;
  /** Live distance (u) and screen bearing (rad) to the step's target; filled by the Game (null until then). */
  target?: { distance: number; bearing: number } | null;
}

export type PhaseState = 'done' | 'current' | 'todo';
export interface TrainingPhase {
  text: string;
  keys: string[];
  state: PhaseState;
}

export interface TrainingGuide {
  index: number;
  total: number;
  stepLabel: string;
  title: string;
  /** Why the step matters – ALWAYS present (no longer dropped when the radio is on). */
  why: string;
  /** The step's fixed phases in order; exactly one is 'current' unless all are done. */
  phases: TrainingPhase[];
  /** One situational hint (too fast to mine, slow down for the clamp, parts are at X, inertia) or null. */
  hint: string | null;
  /** Combat: the panel stays but is dimmed and collapsed. */
  dimmed: boolean;
  /** Live distance (u) and screen bearing (rad) to the step's target, copied from the context. */
  target: { distance: number; bearing: number } | null;
  /** The step just finished: the panel shows it all done for a moment ("Done"). Set by TrainingUi. */
  completed?: boolean;
  progress: { value: number; max: number } | null;
  reward: string | null;
  /** CSS selectors of the UI elements to point at. */
  highlight: string[];
  /** Hangar cells to suggest (shipyard). */
  cells: { x: number; y: number }[];
}

/** A phase before its state is known: `done` comes from the simulation / UI checks. */
interface RawPhase {
  line: GuideLine;
  done: boolean;
}

/** Done phases are done, the first remaining one is current, the rest are to do. */
function finishPhases(raw: readonly RawPhase[]): TrainingPhase[] {
  let currentSet = false;
  return raw.map((r) => {
    let state: PhaseState = 'done';
    if (!r.done) {
      state = currentSet ? 'todo' : 'current';
      currentSet = true;
    }
    return { text: r.line.text, keys: r.line.keys as string[], state };
  });
}

const byTestId = (id: string): string => `[data-testid="${id}"]`;

/** The checklist's reward also charts lane A's first sector (sectors §6.6, stage 2): its name, or null. */
function checklistChart(state: SimState): string | null {
  const id = trainingChartSector(state.seed);
  const info = id ? sectorInfo(state.seed, id) : null;
  return info ? tx().sectors.trainingMap.reward(sectorName(info.name)) : null;
}

/** What a step pays, in words (`extra`: more than the step's table says, e.g. the checklist's chart). */
export function rewardText(step: TrainingStepDef, extra: string | null = null): string {
  const parts: string[] = [];
  if (Object.keys(step.reward.parts).length > 0) parts.push(formatParts(step.reward.parts));
  if (step.reward.kit) parts.push(t().kit);
  if (extra) parts.push(extra);
  parts.push(formatCredits(step.reward.credits));
  return t().reward(parts.join(' · '));
}

// ---------------------------------------------------------------------------
// install tasks (shipyard)

type RotKind = 'side' | 'reverse' | 'forward' | null;

interface InstallNeed {
  partId: PartId;
  /** Rotations that work (null = any). */
  rots: readonly Rotation[] | null;
  kind: RotKind;
  works: (props: ShipProperties) => boolean;
}

const count = (grid: ShipGrid, id: PartId): number => grid.parts.filter((p) => p.partId === id).length;
const cargoCount = (grid: ShipGrid): number => grid.parts.filter((p) => p.partId === 'cargo' || p.partId === 'largeCargo').length;

/** What is still missing on the draft for the current install step (first = do it next). */
export function installNeeds(stepId: TrainingStepDef['id'], grid: ShipGrid): InstallNeed[] {
  const props = computeProperties(grid);
  switch (stepId) {
    case 'installSide': {
      const out: InstallNeed[] = [];
      if (props.thrust.left <= 0) out.push({ partId: 'engine', rots: [1], kind: 'side', works: (p) => p.thrust.left > 0 });
      if (props.thrust.right <= 0) out.push({ partId: 'engine', rots: [3], kind: 'side', works: (p) => p.thrust.right > 0 });
      return out;
    }
    case 'installReverse':
      return reverseEngines(grid) >= 2 ? [] : [{ partId: 'engine', rots: [2], kind: 'reverse', works: (p) => p.thrust.backward > props.thrust.backward }];
    case 'craftCargo':
      return cargoCount(grid) >= 2 ? [] : [{ partId: 'cargo', rots: null, kind: null, works: () => true }];
    case 'finishShip': {
      const c = finishChecks(grid);
      const out: InstallNeed[] = [];
      for (const id of ['reactor', 'radar', 'gyro'] as const) if (!c[id]) out.push({ partId: id, rots: null, kind: null, works: () => true });
      if (!c.engines) out.push({ partId: 'engine', rots: [0], kind: 'forward', works: (p) => p.thrust.forward > props.thrust.forward });
      return out;
    }
    default:
      return [];
  }
}

type InstallStage = 'shipyard' | 'pick' | 'place' | 'confirm' | 'done';
const STAGE_ORDER: Record<InstallStage, number> = { shipyard: 0, pick: 1, place: 2, confirm: 3, done: 4 };

/**
 * Shipyard instructions for an install task: the stage the player is at and the instruction for it
 * (null when there is nothing to say); fills the highlights and the suggested cells.
 */
function installGuide(step: TrainingStepDef, ctx: TrainingContext, g: TrainingGuide): { stage: InstallStage; line: GuideLine | null } {
  if (ctx.tab !== 'shipyard' || !ctx.yard) {
    g.highlight.push(byTestId('tab-shipyard'));
    return { stage: 'shipyard', line: t().guide.openShipyard };
  }
  const yard = ctx.yard;
  const needs = installNeeds(step.id, yard.grid);
  if (needs.length === 0) {
    if (yard.dirty) {
      g.highlight.push(byTestId('yard-commit'));
      return { stage: 'confirm', line: t().guide.commit };
    }
    return { stage: 'done', line: null };
  }
  const need = needs[0]!;
  const selected = yard.selected ? parsePartKey(yard.selected) : null;
  if (!selected || selected.partId !== need.partId) {
    g.highlight.push(byTestId(`palette-${need.partId}`));
    return { stage: 'pick', line: t().guide.pick(tx().parts[need.partId]) };
  }
  if (selected.tier !== 1) return { stage: 'pick', line: t().guide.tierOne };
  if (need.rots && !need.rots.includes(yard.rot) && need.kind) {
    g.highlight.push(byTestId('yard-ghost'));
    return { stage: 'place', line: t().guide.rotate[need.kind] };
  }
  const cells = placementCells(yard.grid, yard.selected!, yard.rot, need.works).slice(0, need.rots ? 2 : 3);
  g.cells = cells.map((c) => ({ x: c.x, y: c.y }));
  return { stage: 'place', line: cells.length > 0 ? t().guide.placeOn : t().guide.placeAny };
}

/** The reward parts wait at another station than the one the ship is at. */
function partsElsewhere(state: SimState): string | null {
  const at = state.career.training.rewardAt;
  const dock = state.player.dock;
  if (dock.mode === 'docked' && dock.stationId === at) return null;
  return t().guide.partsAt(stationLabel(state.seed, at));
}

// ---------------------------------------------------------------------------

/** The step panel right now (null = no training). In combat it stays, dimmed. */
export function trainingGuide(state: SimState, ctx: TrainingContext): TrainingGuide | null {
  const training = state.career.training;
  const step = currentTrainingStep(training);
  if (!step || !training.sites) return null;
  const { player } = state;
  const dockId = player.dock.mode === 'docked' ? player.dock.stationId : null;
  const docked = dockId !== null;
  const value = trainingProgress(state);
  const g: TrainingGuide = {
    index: training.step,
    total: TRAINING_STEP_COUNT,
    stepLabel: t().stepOf(training.step + 1, TRAINING_STEP_COUNT),
    title: t().steps[step.id].title,
    why: t().steps[step.id].why,
    phases: [],
    hint: null,
    dimmed: ctx.inCombat,
    target: ctx.target ?? null,
    progress: step.amount > 1 ? { value, max: step.amount } : null,
    reward: rewardText(step, step.id === 'checklist' ? checklistChart(state) : null),
    highlight: [],
    cells: [],
  };
  const speed = length(player.body.vel);
  const raw: RawPhase[] = [];
  const undock = () => {
    raw.push({ line: t().guide.undock, done: !docked });
    if (docked) g.highlight.push(byTestId('undock'));
  };
  /**
   * The shipyard phases of an install task: open the shipyard, pick + place (`merged`: one phase;
   * `finish`: one per missing item of the last step), confirm. Needs the ship to be docked.
   */
  const install = (mode: 'plain' | 'merged' | 'finish'): void => {
    const sy = docked ? installGuide(step, ctx, g) : { stage: 'shipyard' as InstallStage, line: null };
    const at = docked ? STAGE_ORDER[sy.stage] : 0;
    const grid = ctx.yard?.grid ?? player.grid;
    const part = installNeeds(step.id, grid)[0]?.partId ?? 'engine';
    const now = (stage: InstallStage, fallback: GuideLine): GuideLine => (sy.stage === stage && sy.line ? sy.line : fallback);
    raw.push({ line: t().guide.openShipyard, done: docked && at > 0 });
    if (mode === 'finish') {
      const c = finishChecks(grid);
      let first = true;
      for (const k of ['reactor', 'radar', 'gyro', 'engines'] as const) {
        const text = t().guide.finishItem[k];
        // the first missing item carries the keys of the current instruction (R, T …)
        const keys = first && !c[k] && (sy.stage === 'pick' || sy.stage === 'place') && sy.line ? sy.line.keys : [];
        if (!c[k]) first = false;
        raw.push({ line: { keys, text }, done: c[k] });
      }
      if ((sy.stage === 'pick' || sy.stage === 'place') && sy.line) g.hint = sy.line.text;
    } else if (mode === 'merged') {
      raw.push({ line: at === 1 || at === 2 ? sy.line! : t().guide.placeAny, done: at > 2 });
    } else {
      raw.push({ line: now('pick', t().guide.pick(tx().parts[part])), done: at > 1 });
      raw.push({ line: now('place', t().guide.placeOn), done: at > 2 });
    }
    raw.push({ line: t().guide.commit, done: at > 3 });
  };
  switch (step.id) {
    case 'flyBuoy':
      undock();
      raw.push({ line: t().phases.flyBuoy, done: false });
      if (!docked) g.hint = t().guide.inertia;
      break;
    case 'mineIron': {
      const sites = training.sites;
      const near = !docked && Math.hypot(player.body.pos.x - sites.rockPos.x, player.body.pos.y - sites.rockPos.y) < 40;
      undock();
      raw.push({ line: t().phases.flyRock, done: near });
      raw.push({ line: t().guide.mine, done: false });
      if (!docked) g.hint = near && speed > 4 ? t().guide.tooFastToMine : t().guide.vein;
      break;
    }
    case 'dockSell':
      const home = homeStation();
      const nearClamp = !docked && Math.hypot(player.body.pos.x - dockPoint(home, player.props.boundingRadius).x, player.body.pos.y - dockPoint(home, player.props.boundingRadius).y) <= DOCK_APPROACH_RANGE;
      raw.push({ line: t().guide.goDock[0]!, done: docked || nearClamp });
      raw.push({ line: t().guide.goDock[1]!, done: docked });
      raw.push({ line: t().guide.openOverview, done: docked && ctx.tab === 'overview' });
      raw.push({ line: t().guide.sellAll, done: false });
      if (!docked) g.hint = t().guide.slowForDock;
      else if (ctx.tab !== 'overview') g.highlight.push(byTestId('tab-overview'));
      else g.highlight.push(byTestId('sell-all'));
      break;
    case 'brakeBuoy': {
      const b = training.sites.buoyB;
      const close = !docked && Math.hypot(player.body.pos.x - b.x, player.body.pos.y - b.y) < BRAKE_REACH * 4;
      undock();
      raw.push({ line: t().phases.flyBuoyB, done: close });
      raw.push({ line: t().phases.stop, done: false });
      if (close) g.hint = t().guide.stopHere(t().world.speed(formatAmount(speed)));
      break;
    }
    case 'installSide':
    case 'installReverse':
    case 'finishShip':
      raw.push({ line: t().phases.dock, done: docked });
      install(step.id === 'finishShip' ? 'finish' : 'plain');
      g.hint = partsElsewhere(state) ?? g.hint;
      break;
    case 'craftCargo': {
      raw.push({ line: t().phases.dock, done: docked });
      const recipeName = `${tx().parts.cargo} T1`;
      const stored = Object.entries(stationStorage(state, dockId ?? training.rewardAt).parts).some(([k, n]) => (n ?? 0) > 0 && parsePartKey(k as PartKey).partId === 'cargo');
      const draftHas = ctx.yard ? cargoCount(ctx.yard.grid) >= 2 : false;
      // crafted already (or past it: the shipyard is open) → the install phases
      const crafted = stored || draftHas || (docked && ctx.tab === 'shipyard');
      const tabOk = docked && ctx.tab === 'crafting';
      const recipeOk = tabOk && ctx.craftKey === 'cargo:1';
      raw.push({ line: t().guide.openCrafting, done: crafted || tabOk });
      raw.push({ line: t().guide.pickRecipe(recipeName), done: crafted || recipeOk });
      raw.push({ line: t().guide.craft, done: crafted });
      if (crafted) install('merged');
      else {
        raw.push({ line: t().guide.openShipyard, done: false }, { line: t().guide.placeAny, done: false }, { line: t().guide.commit, done: false });
        if (docked) {
          g.highlight.push(byTestId(!tabOk ? 'tab-crafting' : !recipeOk ? 'recipe-cargo:1' : 'craft'));
          const have = availableResources(state, dockId!);
          const recipe = RECIPES['cargo:1'];
          if (recipe.resources.iron! > have.iron + 1e-9 || state.credits < recipe.credits) g.hint = t().guide.partsAt(stationLabel(state.seed, training.rewardAt));
        }
      }
      break;
    }
    case 'checklist': {
      const f = training.flags;
      const refuelDone = (f & CHECK_REFUEL) !== 0;
      const mapDone = (f & CHECK_MAP) !== 0;
      let refuel: GuideLine = t().guide.refuel;
      if (!refuelDone && docked) {
        if (ctx.tab !== 'service') {
          refuel = { keys: t().guide.openService.keys, text: `${t().guide.refuel.text} – ${t().guide.openService.text.toLowerCase()}` };
          g.highlight.push(byTestId('tab-service'));
        } else g.highlight.push(byTestId('refuel-full'));
      }
      raw.push({ line: refuel, done: refuelDone });
      raw.push({ line: t().guide.map, done: mapDone });
      raw.push({ line: t().guide.objectives, done: (f & CHECK_OBJECTIVES) !== 0 });
      if (!mapDone && docked && refuelDone) {
        g.hint = t().guide.mapInFlight;
        g.highlight.push(byTestId('undock'));
      }
      break;
    }
  }
  g.phases = finishPhases(raw);
  return g;
}

// ---------------------------------------------------------------------------
// world and objectives

/** Where the step happens (the objective arrow and the map), or null. */
export function trainingTarget(state: SimState): Vec2 | null {
  const training = state.career.training;
  const step = currentTrainingStep(training);
  if (!step || !training.sites) return null;
  const docked = state.player.dock.mode === 'docked';
  switch (step.id) {
    case 'flyBuoy':
      return training.sites.buoyA;
    case 'mineIron':
      return training.sites.rockPos;
    case 'brakeBuoy':
      return training.sites.buoyB;
    case 'dockSell':
      return docked ? null : homeStation().pos;
    default:
      return docked ? null : (stationById(state.seed, training.rewardAt) ?? stationById(state.seed, HOME_STATION_ID))!.pos;
  }
}

/** The name of the current step's target in the world ("Guild buoy"), null where the step has none (a station). */
export function trainingTargetName(state: SimState): string | null {
  const step = currentTrainingStep(state.career.training);
  return (step && t().goalNames[step.id]) || null;
}

export interface TrainingCallout {
  id: string;
  world: Vec2;
  title: string;
  detail: string | null;
  keys: string | null;
  action: string | null;
  tone: 'info' | 'warn' | 'ok';
}

/** The labels in the world: the buoy or the training rock (flight only). */
export function trainingCallouts(state: SimState): TrainingCallout[] {
  const training = state.career.training;
  const step = currentTrainingStep(training);
  const { player } = state;
  if (!step || !training.sites || player.dock.mode !== 'flying' || player.destroyed) return [];
  const pos = player.body.pos;
  const dist = (p: Vec2) => t().world.distance(formatInt(Math.hypot(p.x - pos.x, p.y - pos.y)));
  switch (step.id) {
    case 'flyBuoy':
      return [{ id: 'training:buoyA', world: training.sites.buoyA, title: t().world.buoyA, detail: dist(training.sites.buoyA), keys: null, action: null, tone: 'ok' }];
    case 'mineIron': {
      const rock = state.world.findAsteroid(training.sites.rock);
      const world = rock ? rock.pos : training.sites.rockPos;
      return [{ id: 'training:rock', world, title: t().world.rock, detail: `${t().world.rockDetail} · ${dist(world)}`, keys: t().guide.mine.keys[0] ?? null, action: t().world.mineAction, tone: 'warn' }];
    }
    case 'brakeBuoy':
      return [
        {
          id: 'training:buoyB',
          world: training.sites.buoyB,
          title: t().world.buoyB,
          detail: `${dist(training.sites.buoyB)} · ${t().world.speed(formatAmount(length(player.body.vel)))}`,
          keys: null,
          action: null,
          tone: 'ok',
        },
      ];
    case 'dockSell':
    case 'installSide':
    case 'installReverse':
    case 'craftCargo':
    case 'finishShip': {
      // the step continues docked: point at the dock clamp of the station (home for the sale) – the
      // docking point the clamp marker rings, where the ship's centre must come (station/dock.ts)
      const at = stationById(state.seed, step.id === 'dockSell' ? HOME_STATION_ID : training.rewardAt) ?? homeStation();
      const clamp = dockPoint(at, player.props.boundingRadius);
      return [{ id: 'training:dock', world: clamp, title: t().world.dock, detail: dist(clamp), keys: 'F', action: t().world.dockAction, tone: 'info' }];
    }
    default:
      return [];
  }
}

/** The training objective for the objectives band and panel (null = no training). */
export function trainingObjective(state: SimState): { id: string; title: string; why: string; target: Vec2 | null; progress: { value: number; max: number } | null } | null {
  const step = currentTrainingStep(state.career.training);
  if (!step) return null;
  return {
    id: `training:${step.id}`,
    title: t().steps[step.id].title,
    why: t().steps[step.id].why,
    target: trainingTarget(state),
    progress: step.amount > 1 ? { value: trainingProgress(state), max: step.amount } : null,
  };
}

/** Step titles for the journal's manual. */
export const trainingManual = (): { title: string; keys: string; text: string }[] =>
  TRAINING_STEPS.map((s, i) => ({ title: `${i + 1}. ${t().steps[s.id].title}`, keys: '', text: t().steps[s.id].why }));

/** The parts of a reward still lying in its station's storage (for the toast). */
export const rewardInStorage = (state: SimState, parts: PartInventory): boolean =>
  Object.entries(parts).every(([k, n]) => (stationStorage(state, state.career.training.rewardAt).parts[k as PartKey] ?? 0) >= (n ?? 0));
