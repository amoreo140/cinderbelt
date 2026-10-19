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
import { dockPoint } from '../../sim/station/dock';
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
  /**
   * The Guild instructor speaks on the radio (comms part B): the step's prose (why it matters, the
   * dampers, the vein, the slow approach) is said there, the panel keeps only the situational notes.
   */
  radio?: boolean;
}

export interface TrainingLine extends GuideLine {
  /** Checklist item already done. */
  done?: boolean;
}

export interface TrainingGuide {
  index: number;
  total: number;
  stepLabel: string;
  title: string;
  why: string;
  lines: TrainingLine[];
  /** One quieter sentence (inertia, the vein, where the parts are). */
  note: string | null;
  progress: { value: number; max: number } | null;
  reward: string | null;
  /** CSS selectors of the UI elements to point at. */
  highlight: string[];
  /** Hangar cells to suggest (shipyard). */
  cells: { x: number; y: number }[];
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

/** Shipyard instructions for an install step. */
function installGuide(state: SimState, step: TrainingStepDef, ctx: TrainingContext, g: TrainingGuide): void {
  if (ctx.tab !== 'shipyard' || !ctx.yard) {
    g.lines.push(t().guide.openShipyard);
    g.highlight.push(byTestId('tab-shipyard'));
    return;
  }
  const yard = ctx.yard;
  const needs = installNeeds(step.id, yard.grid);
  if (needs.length === 0) {
    if (yard.dirty) {
      g.lines.push(t().guide.commit);
      g.highlight.push(byTestId('yard-commit'));
    }
    return;
  }
  const need = needs[0]!;
  const selected = yard.selected ? parsePartKey(yard.selected) : null;
  if (!selected || selected.partId !== need.partId) {
    g.lines.push(t().guide.pick(tx().parts[need.partId]));
    g.highlight.push(byTestId(`palette-${need.partId}`));
    return;
  }
  if (selected.tier !== 1) {
    g.lines.push(t().guide.tierOne);
    return;
  }
  if (need.rots && !need.rots.includes(yard.rot) && need.kind) {
    g.lines.push(t().guide.rotate[need.kind]);
    g.highlight.push(byTestId('yard-ghost'));
    return;
  }
  const cells = placementCells(yard.grid, yard.selected!, yard.rot, need.works).slice(0, need.rots ? 2 : 3);
  g.lines.push(cells.length > 0 ? t().guide.placeOn : t().guide.placeAny);
  g.cells = cells.map((c) => ({ x: c.x, y: c.y }));
}

/** The reward parts wait at another station than the one the ship is at. */
function partsElsewhere(state: SimState): string | null {
  const at = state.career.training.rewardAt;
  const dock = state.player.dock;
  if (dock.mode === 'docked' && dock.stationId === at) return null;
  return t().guide.partsAt(stationLabel(state.seed, at));
}

// ---------------------------------------------------------------------------

/** The step panel right now (null = no training, or hidden in combat). */
export function trainingGuide(state: SimState, ctx: TrainingContext): TrainingGuide | null {
  const training = state.career.training;
  const step = currentTrainingStep(training);
  if (!step || !training.sites || ctx.inCombat) return null;
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
    lines: [],
    note: null,
    progress: step.amount > 1 ? { value, max: step.amount } : null,
    reward: rewardText(step, step.id === 'checklist' ? checklistChart(state) : null),
    highlight: [],
    cells: [],
  };
  const speed = length(player.body.vel);
  // the prose the instructor says on the radio (null keeps the panel compact)
  const prose = (text: string): string | null => (ctx.radio ? null : text);
  const undock = () => {
    g.lines.push(t().guide.undock);
    g.highlight.push(byTestId('undock'));
  };
  switch (step.id) {
    case 'flyBuoy':
      if (docked) undock();
      else {
        g.lines.push(t().guide.fly, t().guide.brake, t().guide.turn);
        g.note = prose(t().guide.inertia);
      }
      break;
    case 'mineIron': {
      if (docked) {
        undock();
        break;
      }
      const sites = training.sites;
      const near = Math.hypot(player.body.pos.x - sites.rockPos.x, player.body.pos.y - sites.rockPos.y) < 40;
      g.lines.push(t().guide.mine);
      if (near && speed > 4) g.lines.push(t().guide.brake);
      g.note = near && speed > 4 ? t().guide.tooFastToMine : prose(t().guide.vein);
      break;
    }
    case 'dockSell':
      if (!docked) {
        g.lines.push(...t().guide.goDock);
        g.note = prose(t().guide.slowForDock);
      } else if (ctx.tab !== 'overview') {
        g.lines.push(t().guide.openOverview);
        g.highlight.push(byTestId('tab-overview'));
      } else {
        g.lines.push(t().guide.sellAll);
        g.highlight.push(byTestId('sell-all'));
      }
      break;
    case 'brakeBuoy':
      if (docked) undock();
      else {
        const b = training.sites.buoyB;
        const close = Math.hypot(player.body.pos.x - b.x, player.body.pos.y - b.y) < BRAKE_REACH * 4;
        g.lines.push(t().guide.brake, t().guide.dampers);
        if (close) g.note = t().guide.stopHere(t().world.speed(formatAmount(speed)));
      }
      break;
    case 'installSide':
    case 'installReverse':
    case 'finishShip':
      if (!docked) {
        g.lines.push(...t().guide.goDock);
        g.note = partsElsewhere(state);
      } else {
        g.note = partsElsewhere(state);
        if (step.id === 'finishShip') {
          const c = finishChecks(ctx.yard?.grid ?? player.grid);
          for (const k of ['reactor', 'radar', 'gyro', 'engines'] as const) g.lines.push({ keys: [], text: t().guide.finishItem[k], done: c[k] });
        }
        installGuide(state, step, ctx, g);
      }
      break;
    case 'craftCargo': {
      if (dockId === null) {
        g.lines.push(...t().guide.goDock);
        break;
      }
      const stored = Object.entries(stationStorage(state, dockId).parts).some(([k, n]) => (n ?? 0) > 0 && parsePartKey(k as PartKey).partId === 'cargo');
      const draftHas = ctx.yard ? cargoCount(ctx.yard.grid) >= 2 : false;
      if (stored || draftHas || ctx.tab === 'shipyard') {
        installGuide(state, step, ctx, g);
        break;
      }
      // craft first
      if (ctx.tab !== 'crafting') {
        g.lines.push(t().guide.openCrafting);
        g.highlight.push(byTestId('tab-crafting'));
      } else if (ctx.craftKey !== 'cargo:1') {
        g.lines.push(t().guide.pickRecipe(`${tx().parts.cargo} T1`));
        g.highlight.push(byTestId('recipe-cargo:1'));
      } else {
        g.lines.push(t().guide.craft);
        g.highlight.push(byTestId('craft'));
      }
      const have = availableResources(state, dockId);
      const recipe = RECIPES['cargo:1'];
      if (recipe.resources.iron! > have.iron + 1e-9 || state.credits < recipe.credits) g.note = t().guide.partsAt(stationLabel(state.seed, training.rewardAt));
      break;
    }
    case 'checklist': {
      const f = training.flags;
      const refuelLine: TrainingLine = { ...t().guide.refuel, done: (f & CHECK_REFUEL) !== 0 };
      const mapLine: TrainingLine = { ...t().guide.map, done: (f & CHECK_MAP) !== 0 };
      const objLine: TrainingLine = { ...t().guide.objectives, done: (f & CHECK_OBJECTIVES) !== 0 };
      g.lines.push(refuelLine, mapLine, objLine);
      if (!refuelLine.done && docked) {
        if (ctx.tab !== 'service') {
          g.lines.splice(0, 1, { ...t().guide.openService, text: `${t().guide.refuel.text} – ${t().guide.openService.text.toLowerCase()}`, done: false });
          g.highlight.push(byTestId('tab-service'));
        } else g.highlight.push(byTestId('refuel-full'));
      }
      if (!mapLine.done && docked && refuelLine.done) {
        g.note = t().guide.mapInFlight;
        g.highlight.push(byTestId('undock'));
      }
      break;
    }
  }
  // nothing more specific to say: one sentence why the step matters (said on the radio when it is on)
  g.note ??= prose(g.why);
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
