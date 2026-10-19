// The Guild instructor on the radio: Guild Training's step hints
// spoken through the comm panel. When a step starts the instructor says what to do and why (the prose
// the step panel no longer shows); a finished step gets praise with its reward in the same message (one
// message per step change); a player who idles on a step for a minute gets a nudge for the situation
// (at most one a minute, a few per step). The instructor never talks over danger: while a danger or
// story message is on the air (or waits), a toll is open or a fight is on, the step message waits and
// the idle clock stands. Pure and deterministic: the sim state and the sim clock in, a message out;
// line variants by a hash of tick + step.
import { TRAINING_STEPS, type TrainingStepId } from '../../data/training';
import { tx } from '../../i18n';
import type { CommsTexts } from '../../i18n/skComms';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { currentTrainingStep, trainingProgress } from '../../sim/training/training';
import { formatCredits } from '../../ui/format';
import { formatParts } from '../shipyardView';
import { trainingTarget } from '../training/trainingView';
import { instructorSpeaker } from './speakers';
import type { CommsMessage } from './types';
import { pickLine } from './variants';

/** Seconds on a step without progress before the first nudge … */
export const NUDGE_AFTER = 60;
/** … and between nudges (the idle clock restarts with each one). */
export const NUDGE_GAP = 60;
/** Nudges per step at most (an idle player is not nagged forever). */
export const NUDGE_LIMIT = 3;
/** Coming this much closer (u) to the step's target counts as progress. */
export const APPROACH_PROGRESS = 15;
/** The key of every instructor message: a new one replaces a waiting or showing one. */
export const INSTRUCTOR_KEY = 'training';

/** Steps flown in space (a nudge while docked says "undock"); the rest happen in a dock. */
const FLIGHT_STEPS: ReadonlySet<TrainingStepId> = new Set(['flyBuoy', 'mineIron', 'brakeBuoy']);

type StepEvent = Extract<SimEvent, { type: 'trainingStep' }>;

export interface InstructorInput {
  state: SimState;
  events: readonly SimEvent[];
  /** Sim clock (s). */
  clock: number;
  /** A danger / story message is on the air or waiting, or a toll is open: the instructor holds. */
  quiet: boolean;
  /** The radio is hidden (the shipyard editor): the idle clock stands. */
  hidden: boolean;
  texts: CommsTexts;
}

export interface InstructorOutput {
  msg: CommsMessage | null;
  /** The step events whose toast the message replaces (praise said in the same step). */
  events: SimEvent[];
}

/** Seconds on screen after typing, by how much there is to read. */
const ttlFor = (lines: readonly string[]): number => Math.min(9, 4 + lines.reduce((n, l) => n + l.length, 0) / 45);

/** A finished step's reward in words: "100 kr a 2× Motor T1 do skladu". */
export function rewardWords(e: StepEvent, t: CommsTexts): string {
  const credits = formatCredits(e.credits);
  const parts = formatParts(e.parts);
  if (parts) return t.instructor.reward.parts(credits, parts);
  if (e.kit) return t.instructor.reward.kit(credits);
  return t.instructor.reward.credits(credits);
}

/** What counts as progress on a step: the counter, the checklist bits, docking / undocking. */
function progressSignature(state: SimState): string {
  const training = state.career.training;
  return `${training.step}|${Math.floor(trainingProgress(state) + 1e-9)}|${training.flags}|${state.player.dock.mode}`;
}

/** Distance to where the step happens (in flight), or Infinity. */
function targetDistance(state: SimState): number {
  const { player } = state;
  const target = player.dock.mode === 'flying' ? trainingTarget(state) : null;
  return target ? Math.hypot(target.x - player.body.pos.x, target.y - player.body.pos.y) : Infinity;
}

interface Pending {
  /** The step just finished (praise), or null (a step started: a new game, a loaded save). */
  praise: StepEvent | null;
  /** The step that starts now, or null (the training ended). */
  step: number | null;
}

export class Instructor {
  /** Step index the instructor last spoke about (-1 = none yet). */
  private step = -1;
  private pending: Pending | null = null;
  /** Sim clock when the player last made progress (or the last nudge). */
  private idleSince = 0;
  private signature = '';
  private best = Infinity;
  private nudges = 0;

  update(input: InstructorInput): InstructorOutput {
    const { state, events, clock, texts: t } = input;
    const training = state.career.training;
    const active = training.status === 'active';
    const stepEvents = events.filter((e): e is StepEvent => e.type === 'trainingStep');
    if (events.some((e) => e.type === 'trainingSkipped')) {
      // skipping is a system result (the toast says what happened); nothing more to teach
      this.pending = null;
      this.step = -1;
    }
    const praise = stepEvents[stepEvents.length - 1] ?? null;
    const startsNow = active && training.step !== this.step;
    if (praise || startsNow) {
      // a held message merges with the newer change: the newest praise and the step that runs now
      this.pending = { praise: praise ?? this.pending?.praise ?? null, step: active ? training.step : null };
      this.step = active ? training.step : -1;
      this.nudges = 0;
      this.signature = progressSignature(state);
      this.best = targetDistance(state);
      this.resetIdle(clock);
    }
    if (this.pending && !input.quiet) {
      const msg = this.stepMessage(state, this.pending, t);
      const said = praise && this.pending.praise === praise ? [praise] : [];
      this.pending = null;
      this.resetIdle(clock);
      return { msg, events: said };
    }
    if (!active) return { msg: null, events: [] };
    return { msg: this.nudge(input), events: [] };
  }

  private resetIdle(clock: number): void {
    this.idleSince = clock;
  }

  /** Praise for the finished step and / or the intro of the one that starts. */
  private stepMessage(state: SimState, p: Pending, t: CommsTexts): CommsMessage {
    const tick = state.tick;
    const { praise } = p;
    const def = p.step !== null ? TRAINING_STEPS[p.step] : undefined;
    const lines = (tt: CommsTexts): string[] => {
      const out: string[] = [];
      if (praise) out.push(pickLine(tt.instructor.praise, tick, `praise:${praise.step}`)(rewardWords(praise, tt)));
      if (def) out.push(pickLine(tt.instructor.intro[def.id], tick, `intro:${def.id}`));
      else if (praise?.done) out.push(pickLine(tt.instructor.done, tick, 'done'));
      return out;
    };
    return this.message(state, lines, def ? `step:${def.id}` : 'done', t);
  }

  /** A nudge when the player has made no progress on the step for a minute. */
  private nudge(input: InstructorInput): CommsMessage | null {
    const { state, clock, texts: t } = input;
    const training = state.career.training;
    const step = currentTrainingStep(training);
    if (!step || !training.sites) return null;
    const { player } = state;
    const sig = progressSignature(state);
    if (sig !== this.signature) {
      this.signature = sig;
      this.best = targetDistance(state);
      this.resetIdle(clock);
    }
    const d = targetDistance(state);
    if (d < this.best - APPROACH_PROGRESS) {
      this.best = d;
      this.resetIdle(clock);
    }
    const fighting = state.combat.enemies.some((e) => e.ai.mode === 'attack');
    // not idle: danger on the air, a fight, the shipyard editor (the player works there)
    if (input.quiet || input.hidden || fighting || player.destroyed) {
      this.resetIdle(clock);
      return null;
    }
    if (this.nudges >= NUDGE_LIMIT || clock - this.idleSince < (this.nudges === 0 ? NUDGE_AFTER : NUDGE_GAP)) return null;
    this.nudges++;
    this.resetIdle(clock);
    const docked = player.dock.mode !== 'flying';
    const flightStep = FLIGHT_STEPS.has(step.id);
    const key = `nudge:${step.id}:${this.nudges}`;
    const variants = (tt: CommsTexts) =>
      step.id === 'checklist' ? tt.instructor.nudge.checklist : flightStep && docked ? tt.instructor.nudgeUndock : !flightStep && !docked ? tt.instructor.nudgeDock : tt.instructor.nudge[step.id];
    const tick = state.tick;
    return this.message(state, (tt) => [pickLine(variants(tt), tick, key)], key, t);
  }

  /** `lines` in a language: now in `t`, again on a live language switch (`retext`). */
  private message(state: SimState, lines: (t: CommsTexts) => string[], what: string, t: CommsTexts): CommsMessage {
    const first = lines(t);
    return {
      id: `${INSTRUCTOR_KEY}:${what}@${state.tick}`,
      key: INSTRUCTOR_KEY,
      speaker: instructorSpeaker(t),
      lines: first,
      channel: 'training',
      ttl: ttlFor(first),
      tick: state.tick,
      retext: () => {
        const tt = tx().comms;
        return { speaker: instructorSpeaker(tt), lines: lines(tt) };
      },
    };
  }

  /** Nudges given on the current step (tests). */
  get nudgesOnStep(): number {
    return this.nudges;
  }
}
