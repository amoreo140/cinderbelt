// Career in the game layer (M3.5a): Objectives (strip + G panel), Storage (I), the "Where I left off"
// card, the Board in the hub, F prompts at a contract target and career event toasts (Guild Training
// too, M3.7). Game.ts only calls these methods – all career UI logic lives here.
import { MAX_REP_LEVEL } from '../../data/factions';
import { getLocale, tx } from '../../i18n';
import { careerInteraction } from '../../sim/career/career';
import type { GameActionInput } from '../../sim/commands';
import { stationDemand, stationFuelPrice } from '../../sim/sector/market';
import { radarRangeOf } from '../../sim/discovery/scanner';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { nearestDiscoveredStation, type StationDef } from '../../sim/world/stations';
import { formatCredits, formatInt } from '../../ui/format';
import type { DockPrompt } from '../../ui/stationHud';
import type { ToastKind } from '../../ui/GameUi';
import type { ObjectiveItem } from '../../ui/board/Objectives';
import { boardData, type BoardData, type BoardViewMode } from '../board/boardView';
import { ViewMemo } from '../viewMemo';
import { captainName, partLabel, stationLabel } from '../board/names';
import { relayMaterials, relayMissing } from '../board/slipView';
import { resumeData, type ResumeData } from '../board/resumeView';
import { courierOffer, storagesData, type StoragesData } from '../board/storagesView';
import { objectivesAt, type Objective } from '../objectives/objectives';
import { trainingToast } from '../training/trainingUi';
import type { Vec2 } from '../../sim/math/vec2';

export type CareerPanel = 'objectives' | 'storages' | null;

/** Objective label for the map: without the counter in brackets, at most ~38 characters. */
export function shortTitle(title: string): string {
  const t = title.replace(/\s*\([^)]*\)\s*$/, '');
  return t.length > 38 ? `${t.slice(0, 37).trimEnd()}…` : t;
}

export interface CareerUiData {
  /** Objectives strip in flight (null in the dock). */
  band: ObjectiveItem[] | null;
  panel: { kind: 'objectives'; items: ObjectiveItem[] } | { kind: 'storages'; data: StoragesData } | null;
  resume: { data: ResumeData; name: string; from: Vec2 } | null;
}

export interface CareerHandlers {
  closePanel(): void;
  /** Ask to skip the Guild Training (a confirmation follows). */
  skipTraining(): void;
  abandon(contract: number): void;
  action(action: GameActionInput): void;
  quote(from: string, to: string, resources: Parameters<typeof courierOffer>[3], parts: Parameters<typeof courierOffer>[4]): { fee: number; time: string } | null;
  resumeContinue(): void;
  click(): void;
}

export interface CareerToast {
  text: string;
  kind: ToastKind;
  seconds: number;
}

export interface CareerUiHost {
  state(): SimState;
  send(action: GameActionInput): void;
  render(): void;
  click(): void;
  /** The player asked to skip the Guild Training (the training layer confirms it). */
  requestSkipTraining?(): void;
}

export class CareerUi {
  panel: CareerPanel = null;
  /** The "Where I left off" card is open (the simulation is paused). */
  resumeOpen: boolean;
  /** Game title on the resume card. */
  private readonly gameName: string;
  readonly handlers: CareerHandlers;
  /** The hub's Board view model (see hubExtras). */
  private readonly board = new ViewMemo<BoardData>();

  constructor(
    private readonly host: CareerUiHost,
    options: { resume?: boolean; name?: string } = {},
  ) {
    this.resumeOpen = options.resume ?? false;
    this.gameName = options.name ?? '';
    this.handlers = {
      closePanel: () => this.setPanel(null),
      skipTraining: () => this.host.requestSkipTraining?.(),
      abandon: (contract) => this.host.send({ type: 'abandonContract', contractId: contract }),
      action: (action) => this.host.send(action),
      quote: (from, to, resources, parts) => courierOffer(this.host.state(), from, to, resources, parts),
      resumeContinue: () => {
        this.resumeOpen = false;
        this.host.render();
      },
      click: () => this.host.click(),
    };
  }

  setPanel(panel: CareerPanel): void {
    this.panel = panel;
    this.host.render();
  }

  /** A key for the career layer; returns true if it was consumed. */
  onKey(code: string, letter: (l: string) => string): boolean {
    if (this.resumeOpen) {
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'Escape' || code === 'Space') this.handlers.resumeContinue();
      return true;
    }
    if (code === letter('g')) {
      this.setPanel(this.panel === 'objectives' ? null : 'objectives');
      return true;
    }
    if (code === letter('i')) {
      this.setPanel(this.panel === 'storages' ? null : 'storages');
      return true;
    }
    if (code === 'Escape' && this.panel) {
      this.setPanel(null);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // objectives

  private toItem(state: SimState, o: Objective): ObjectiveItem {
    const pos = state.player.body.pos;
    const target = o.target;
    const docked = state.player.dock.mode !== 'flying';
    return {
      id: o.id,
      scale: o.scale,
      trackName: tx().goals.objectives.tracks[o.track],
      title: o.title,
      why: o.why,
      distance: target && !docked ? Math.hypot(target.x - pos.x, target.y - pos.y) : null,
      angle: target && !docked ? Math.atan2(target.y - pos.y, target.x - pos.x) : null,
      progress: o.progress,
      ...(o.note ? { note: o.note } : {}),
      ...(o.contract !== undefined ? { contract: o.contract } : {}),
      ...(o.track === 'training' ? { training: true } : {}),
    };
  }

  objectiveItems(state: SimState): ObjectiveItem[] {
    return objectivesAt(state).map((o) => this.toItem(state, o));
  }

  /**
   * Strip: the main objective now + a second line (contract or ship). The same array for the same step,
   * language and ship pose (the UI redraw asks twice: the flight band and the career data).
   */
  band(state: SimState): ObjectiveItem[] {
    const pos = state.player.body.pos;
    return this.bandMemo.get([state, state.tick, getLocale(), state.player.dock.mode, pos.x, pos.y], () => this.makeBand(state));
  }

  private readonly bandMemo = new ViewMemo<ObjectiveItem[]>();

  private makeBand(state: SimState): ObjectiveItem[] {
    const items = this.objectiveItems(state);
    const now = items.filter((o) => o.scale === 'now');
    const first = now[0];
    if (!first) return items.slice(0, 1);
    const second = now.find((o) => o !== first && o.trackName !== first.trackName) ?? now[1] ?? items.find((o) => o.scale === 'today');
    return second ? [first, second] : [first];
  }

  /** Target of the screen-edge arrow (the first objective with a position). */
  arrowTarget(state: SimState): { pos: Vec2; label: string } | null {
    const o = objectivesAt(state).find((x) => x.target !== null && x.scale === 'now') ?? null;
    if (!o?.target) return null;
    // target = the nearest station (hand-in) – the orange arrow already points there
    const near = nearestDiscoveredStation(state.seed, state.world.discovered, state.player.body.pos);
    if (Math.hypot(near.pos.x - o.target.x, near.pos.y - o.target.y) < 1) return null;
    const pos = state.player.body.pos;
    return { pos: o.target, label: `${tx().goals.objectives.tracks[o.track]} ${formatInt(Math.hypot(o.target.x - pos.x, o.target.y - pos.y))} ${tx().units.unit}` };
  }

  /** Map (M): contract and training objectives with a position. */
  withMapTargets<T extends { open: boolean }>(state: SimState, map: T): T & { targets?: { pos: Vec2; label: string }[] } {
    if (!map.open) return map;
    // also targets at not yet discovered stations (Delivery) – with a short label; the map adds the distance
    const targets = objectivesAt(state)
      .filter((o) => o.target !== null)
      .map((o) => ({ pos: o.target!, label: `${tx().goals.objectives.tracks[o.track]}: ${shortTitle(o.title)}` }));
    // a new object only on change (the map redraws by reference)
    const key = JSON.stringify(targets);
    if (key !== this.mapKey) {
      this.mapKey = key;
      this.mapTargets = targets;
    }
    return { ...map, targets: this.mapTargets };
  }

  private mapKey = '';
  private mapTargets: { pos: Vec2; label: string }[] = [];

  /** F prompt at a survey point or a stranded ship. */
  prompt(state: SimState): DockPrompt | null {
    const it = careerInteraction(state);
    if (!it) return null;
    if (it.kind === 'buoy') {
      const c = state.career.contracts.find((x) => x.serial === it.contract);
      const total = c?.target.kind === 'survey' ? c.target.points.length : 3;
      return { kind: 'ok', text: tx().goals.prompts.buoy(it.index + 1, total) };
    }
    // the Guild relay repair (M4d): the materials from the cargo, or what the cargo still lacks (warn)
    if (it.kind === 'relayRepair') {
      const missing = relayMissing(state.player.cargo);
      const p = tx().guild.relay.prompt;
      return Object.keys(missing).length === 0 ? { kind: 'ok', text: p.repair(relayMaterials()) } : { kind: 'warn', text: p.missing(relayMaterials(missing)) };
    }
    return { kind: it.fuel <= state.player.fuel ? 'ok' : 'warn', text: tx().goals.prompts.rescue(it.fuel) };
  }

  /** Radar range with the sector state applied (Eclipse). */
  radarRange(state: SimState): number {
    // sector state (Eclipse) and the ion storm (M3.5b)
    return radarRangeOf(state);
  }

  // ---------------------------------------------------------------------------
  // hub

  /**
   * The hub's career data. The Board (with its cartography) is the same object while `key` (Game.hubViewKey:
   * state, station, actions and events, the game second, credits, language) stays the same.
   */
  hubExtras(state: SimState, station: StationDef, tab: string, key: readonly unknown[]): { board: BoardData | null; fuelPrice: number; demand: ReturnType<typeof stationDemand>; shipPos: Vec2 } {
    return {
      board: tab === 'board' || tab === 'overview' ? this.board.get(key, () => boardData(state, station)) : null,
      fuelPrice: stationFuelPrice(state, station),
      demand: stationDemand(state, station),
      shipPos: state.player.body.pos,
    };
  }

  // ---------------------------------------------------------------------------

  uiData(state: SimState, _clock: number, flying: boolean): CareerUiData {
    let panel: CareerUiData['panel'] = null;
    if (this.panel === 'objectives') panel = { kind: 'objectives', items: this.objectiveItems(state) };
    else if (this.panel === 'storages') panel = { kind: 'storages', data: storagesData(state) };
    return {
      band: flying ? this.band(state) : null,
      panel,
      resume: this.resumeOpen ? { data: resumeData(state), name: this.gameName, from: state.player.body.pos } : null,
    };
  }

  /** Toast for a career event (null = none). */
  toast(state: SimState, e: SimEvent): CareerToast | null {
    const t = tx().goals.toasts;
    const typeOf = (id: number) => {
      const c = state.career.contracts.find((x) => x.serial === id);
      return c ? tx().goals.contractTypes[c.type] : '';
    };
    switch (e.type) {
      case 'contractAccepted':
        return { text: t.accepted(typeOf(e.contractId)), kind: 'ok', seconds: 3 };
      case 'contractReady':
        return { text: t.ready(typeOf(e.contractId)), kind: 'ok', seconds: 5 };
      case 'contractCompleted':
        return { text: e.part ? `${t.completed(formatCredits(e.reward))} + ${partLabel(e.part)}` : t.completed(formatCredits(e.reward)), kind: 'ok', seconds: 4 };
      case 'contractAbandoned':
        return { text: t.abandoned, kind: 'info', seconds: 3 };
      case 'buoyDeployed': {
        const c = state.career.contracts.find((x) => x.serial === e.contractId);
        const total = c?.target.kind === 'survey' ? c.target.points.length : 3;
        return { text: t.buoy(e.index + 1, total), kind: 'ok', seconds: 3 };
      }
      case 'rescueFueled':
        return { text: t.rescue(e.fuel), kind: 'ok', seconds: 3 };
      case 'interactFailed': {
        const c = state.career.contracts.find((x) => x.serial === e.contractId);
        return { text: t.notEnoughFuel(c?.target.kind === 'rescue' ? c.target.fuel : 0), kind: 'error', seconds: 3 };
      }
      case 'repLevelUp':
        return { text: t.levelUp(tx().goals.factionShort[e.faction], e.level, tx().goals.repLevels[Math.min(e.level, MAX_REP_LEVEL)]), kind: 'ok', seconds: 5 };
      case 'captainPromoted':
        return {
          text: e.trophies.length > 0 ? tx().goals.captains.promotedReplica(captainName(state.seed, e.captain), e.trophies.map(partLabel).join(', ')) : tx().goals.captains.promoted(captainName(state.seed, e.captain), e.level),
          kind: 'info',
          seconds: 6,
        };
      case 'captainDefeated':
        return { text: t.captainDefeated(captainName(state.seed, e.captain)), kind: 'ok', seconds: 5 };
      case 'courierDelivered':
        return { text: t.courierDelivered(stationLabel(state.seed, e.to)), kind: 'ok', seconds: 4 };
      case 'trainingStep':
      case 'trainingSkipped':
        return trainingToast(state, e);
      default:
        return null;
    }
  }
}

export type { BoardViewMode };
