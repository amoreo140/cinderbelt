// Guild Training in the game layer (M3.7): the step panel, the UI highlight and the hangar cell
// suggestions, the world labels, the skip confirmation and the "seen" reports (map, objectives) the
// checklist step needs. Game.ts only calls these methods.
import { CHECK_MAP, CHECK_OBJECTIVES } from '../../data/training';
import { tx } from '../../i18n';
import type { GameActionInput } from '../../sim/commands';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { currentTrainingStep } from '../../sim/training/training';
import type { ToastKind } from '../../ui/GameUi';
import { formatCredits } from '../../ui/format';
import { stationLabel } from '../board/names';
import { formatParts } from '../shipyardView';
import { trainingCallouts, trainingGuide, type TrainingCallout, type TrainingContext, type TrainingGuide } from './trainingView';

const t = () => tx().training;

/** How long the "ship is ready" card stays after the last step (s). */
const DONE_CARD_SECONDS = 14;

export interface TrainingUiHost {
  state(): SimState;
  send(action: GameActionInput): void;
  render(): void;
  click(): void;
}

/**
 * A suggested hangar cell on the screen (px in the UI root): the centre, a size, and optionally the
 * projected half-cell axes `a` (screen-right side) and `b` (screen-down side) of a tilted / orbited view.
 */
export interface TrainingCellBox {
  x: number;
  y: number;
  size: number;
  ax?: number;
  ay?: number;
  bx?: number;
  by?: number;
}

export interface TrainingUiData {
  guide: TrainingGuide | null;
  /** Suggested hangar cells on the screen: centre and cell size (px in the UI root). */
  cells: TrainingCellBox[];
  confirmSkip: boolean;
  collapsed: boolean;
  /** The training just ended: the "ship is ready" card. */
  done: boolean;
  docked: boolean;
  /** The shipyard is open (the panel moves out of the editor's way). */
  yard: boolean;
}

export interface TrainingHandlers {
  skip(): void;
  confirmSkip(): void;
  cancelSkip(): void;
  toggle(): void;
  closeDone(): void;
}

export class TrainingUi {
  private confirmOpen = false;
  private collapsed = false;
  private doneUntil = -Infinity;
  /** Step index and checklist bit already reported (no repeated actions while the sim catches up). */
  private sent = { step: -1, bits: 0 };
  readonly handlers: TrainingHandlers;

  constructor(private readonly host: TrainingUiHost) {
    this.handlers = {
      skip: () => this.askSkip(),
      confirmSkip: () => {
        this.host.click();
        this.confirmOpen = false;
        this.host.send({ type: 'trainingSkip' });
        this.host.render();
      },
      cancelSkip: () => {
        this.host.click();
        this.confirmOpen = false;
        this.host.render();
      },
      toggle: () => {
        this.host.click();
        this.collapsed = !this.collapsed;
        this.host.render();
      },
      closeDone: () => {
        this.doneUntil = -Infinity;
        this.host.render();
      },
    };
  }

  /** Opens the skip confirmation (the objectives panel and the step panel ask through here). */
  askSkip(): void {
    if (this.host.state().career.training.status !== 'active') return;
    this.host.click();
    this.confirmOpen = true;
    this.host.render();
  }

  get confirming(): boolean {
    return this.confirmOpen;
  }

  /** Esc closes the confirmation; returns true when it took the key. */
  onKey(code: string): boolean {
    if (!this.confirmOpen) return false;
    if (code === 'Escape') this.handlers.cancelSkip();
    return true;
  }

  /** Reports what the player looked at during the checklist step (once per item). */
  update(state: SimState, ctx: { mapOpen: boolean; objectivesOpen: boolean }): void {
    const training = state.career.training;
    const step = currentTrainingStep(training);
    if (step?.id !== 'checklist') return;
    if (this.sent.step !== training.step) this.sent = { step: training.step, bits: 0 };
    const report = (bit: number, open: boolean, what: 'map' | 'objectives') => {
      if (!open || training.flags & bit || this.sent.bits & bit) return;
      this.sent.bits |= bit;
      this.host.send({ type: 'trainingSeen', what });
    };
    report(CHECK_MAP, ctx.mapOpen, 'map');
    report(CHECK_OBJECTIVES, ctx.objectivesOpen, 'objectives');
  }

  onEvents(events: readonly SimEvent[], clock: number): void {
    for (const e of events) {
      if (e.type === 'trainingStep' && e.done) this.doneUntil = clock + DONE_CARD_SECONDS;
      if (e.type === 'trainingSkipped') this.confirmOpen = false;
    }
  }

  callouts(state: SimState): TrainingCallout[] {
    return trainingCallouts(state);
  }

  uiData(state: SimState, ctx: TrainingContext, clock: number, cellToScreen: ((x: number, y: number) => TrainingCellBox) | null): TrainingUiData | null {
    const guide = trainingGuide(state, ctx);
    const done = !guide && clock < this.doneUntil && !ctx.inCombat;
    if (!guide && !done && !this.confirmOpen) return null;
    return {
      guide,
      cells: guide && cellToScreen ? guide.cells.map((c) => cellToScreen(c.x, c.y)) : [],
      confirmSkip: this.confirmOpen,
      collapsed: this.collapsed,
      done,
      docked: state.player.dock.mode !== 'flying',
      yard: ctx.tab === 'shipyard',
    };
  }
}

/** Toast of a training event. */
export function trainingToast(state: SimState, e: SimEvent): { text: string; kind: ToastKind; seconds: number } | null {
  if (e.type === 'trainingStep') {
    if (e.done) return { text: t().toast.done, kind: 'ok', seconds: 6 };
    const parts = formatParts(e.parts);
    const credits = formatCredits(e.credits);
    return { text: parts ? t().toast.step(credits, parts) : t().toast.stepCredits(credits), kind: 'ok', seconds: parts ? 5 : 3 };
  }
  if (e.type === 'trainingSkipped') {
    return { text: e.assembled ? t().toast.skippedFitted : t().toast.skippedStored(stationLabel(state.seed, e.stationId)), kind: 'info', seconds: 6 };
  }
  return null;
}
