// The communicator in the game layer: turns each simulation step into
// radio messages (mapper + zone watcher, the Guild instructor of the training and the scripted first
// contacts – part B), filters them by the "Radio" setting, runs the queue on
// the sim clock (it stops with the pause), answers the toll from the panel, keeps the log (L) and tells
// Game which events no longer need a toast. Game.ts only calls these methods.
import type { SimEvent, SimState } from '../../sim/Simulation';
import { getLocale, tx } from '../../i18n';
import { type CommsTexts } from '../../i18n/skComms';
import { formatCredits } from '../../ui/format';
import type { TollHud } from '../pirates/piratesUi';
import { FirstContacts } from './firstContact';
import { Instructor } from './instructor';
import { commsFromEvents, groupSpeaker, membersOf, type CommsContext } from './mapper';
import { CommsQueue, messageDuration } from './queue';
import { IMPORTANT_CHANNELS, type CommsChannel, type CommsLogEntry, type CommsMessage, type CommsText, type RadioSetting, type Speaker } from './types';
import { pickLine } from './variants';
import { CommsWatch } from './watch';

const TICKS = 60;

/** Which messages the setting lets on the radio. */
export function radioAllows(setting: RadioSetting, channel: CommsChannel): boolean {
  if (setting === 'off') return false;
  return setting === 'all' || IMPORTANT_CHANNELS.has(channel);
}

/** Game time of a tick for the log: "12:04", "1:02:03". */
export function clockLabel(tick: number): string {
  const s = Math.floor(tick / TICKS);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The sound of a message opening: plain radio, a harsher danger burst, or the Echo's glitch. */
export type CommsSound = 'radio' | 'danger' | 'echo';

export function commsSound(msg: Pick<CommsMessage, 'channel' | 'speaker'>): CommsSound {
  if (msg.speaker.kind === 'echo') return 'echo';
  return msg.channel === 'danger' ? 'danger' : 'radio';
}

export interface CommsPanelData {
  id: string;
  speaker: Speaker;
  lines: string[];
  note: string | null;
  channel: CommsChannel;
  journal: boolean;
  /** Messages waiting behind this one. */
  queued: number;
  /** The open toll demand (interactive), when this is the toll message. */
  toll: TollHud | null;
  /** Display time of the message in seconds (the time bar); null = stays until handled. */
  seconds: number | null;
  /** In the dock the panel sits low on the left (no flight console). */
  docked: boolean;
}

export interface CommsLogItem extends CommsLogEntry {
  time: string;
}

export interface CommsUiData {
  panel: CommsPanelData | null;
  /** The comm log (L), newest first; null = closed. */
  log: CommsLogItem[] | null;
  /** Docked: the radio sits low on the left (no flight console under it). */
  docked: boolean;
}

export interface CommsHandlers {
  /** Click on the panel after the text is typed out: close the message. */
  dismiss(): void;
  /** Toll buttons in the panel (the same as Y / X). */
  toll(answer: 'pay' | 'refuse'): void;
  closeLog(): void;
  click(): void;
}

export interface CommsUiHost {
  state(): SimState;
  render(): void;
  click(): void;
  /** A message opened: static bleep (and a subtle music duck for danger and story). */
  sound(kind: CommsSound, duck: boolean): void;
}

export interface CommsStepContext extends Omit<CommsContext, 'texts'> {
  texts?: CommsTexts;
}

const now = (state: SimState): number => state.tick / TICKS;

export class CommsUi {
  readonly queue = new CommsQueue();
  private readonly watch = new CommsWatch();
  private readonly instructor = new Instructor();
  private readonly firstContacts = new FirstContacts();
  readonly handlers: CommsHandlers;
  private setting: RadioSetting;
  private tollAnswer: 'pay' | 'refuse' | null = null;
  /** Sim clock when the panel was hidden (shipyard editor), or null. */
  private hiddenAt: number | null = null;
  logOpen = false;
  /** The language the radio's texts are in (a live switch re-renders them). */
  private locale = getLocale();

  constructor(
    private readonly host: CommsUiHost,
    setting: RadioSetting = 'all',
    /** Fixed texts (tests); null = the current language, read on every step. */
    private readonly texts: CommsTexts | null = null,
  ) {
    this.setting = setting;
    this.handlers = {
      dismiss: () => {
        const started = this.queue.dismiss(now(this.host.state()));
        if (started) this.announce(started);
        this.host.click();
        this.host.render();
      },
      toll: (answer) => {
        this.tollAnswer = answer;
        this.host.click();
      },
      closeLog: () => {
        this.logOpen = false;
        this.host.render();
      },
      click: () => this.host.click(),
    };
  }

  get radio(): RadioSetting {
    return this.setting;
  }

  setRadio(setting: RadioSetting): void {
    if (setting === this.setting) return;
    this.setting = setting;
    if (setting === 'off') this.queue.clear();
  }

  allows(channel: CommsChannel): boolean {
    return radioAllows(this.setting, channel);
  }

  /** The toll is answered in the comm panel (the flight HUD hides its own toll band). */
  get showsToll(): boolean {
    return this.allows('danger');
  }

  /** Y / X pressed in the panel since the last step. */
  takeTollAnswer(): 'pay' | 'refuse' | null {
    const a = this.tollAnswer;
    this.tollAnswer = null;
    return a;
  }

  /**
   * One simulation step: new messages from the events and the ship's position, the toll message kept
   * in step with the sim, the queue advanced. Returns the events whose toasts the radio replaced.
   */
  onStep(state: SimState, events: readonly SimEvent[], ctx: CommsStepContext): Set<SimEvent> {
    const spoken = new Set<SimEvent>();
    const t = ctx.texts ?? this.texts ?? tx().comms;
    const clock = now(state);
    if (this.setting === 'off') return spoken;
    const before = this.queue.showing?.msg.id ?? null;
    const push = (msg: CommsMessage): boolean => {
      if (!this.allows(msg.channel)) return false;
      this.queue.push(msg, clock);
      return true;
    };
    const sources = commsFromEvents(state, events, { ...ctx, texts: t });
    const followUps = this.firstContacts.update(state, events, sources, t);
    for (const src of sources) {
      if (!push(src.msg)) continue;
      for (const e of src.events) spoken.add(e);
      // the group demanding a toll talks only through the toll
      if (src.msg.reply === 'toll') this.queue.remove(`alert:${src.msg.key.slice('toll:'.length)}`);
    }
    for (const msg of followUps) push(msg);
    for (const msg of this.watch.update(state, t)) push(msg);
    this.syncToll(state, clock, t);
    // the Guild instructor (training): never over danger, a toll or a story beat
    const loud = (c: CommsChannel): boolean => c === 'danger' || c === 'story';
    const quiet = !!state.pirates.toll || (this.queue.showing !== null && loud(this.queue.showing.msg.channel)) || this.queue.queued.some((m) => loud(m.channel));
    const said = this.instructor.update({ state, events, clock, quiet, hidden: this.hiddenAt !== null, texts: t });
    if (said.msg && push(said.msg)) for (const e of said.events) spoken.add(e);
    if (this.hiddenAt === null) this.queue.update(clock);
    const after = this.queue.showing?.msg;
    if (after && after.id !== before && this.hiddenAt === null) this.announce(after);
    return spoken;
  }

  /**
   * Messages from outside the sim step (the sector entry radio, sectors §3.1), on the same clock and
   * filter. Returns true when the radio took at least one of them.
   */
  say(state: SimState, messages: readonly CommsMessage[]): boolean {
    if (this.setting === 'off') return false;
    const clock = now(state);
    const before = this.queue.showing?.msg.id ?? null;
    let took = false;
    for (const msg of messages) {
      if (!this.allows(msg.channel)) continue;
      if (this.queue.push(msg, clock) !== 'dropped') took = true;
    }
    const after = this.queue.showing?.msg;
    if (after && after.id !== before && this.hiddenAt === null) this.announce(after);
    return took;
  }

  /** The toll message follows the sim: it appears for a staged demand and goes when the demand is gone. */
  private syncToll(state: SimState, clock: number, t: CommsTexts): void {
    const toll = state.pirates.toll;
    const cur = this.queue.showing?.msg;
    if (cur?.reply === 'toll' && cur.pinned && (!toll || cur.key !== `toll:${toll.group}`)) this.queue.release(cur.key, clock);
    if (!toll || !this.allows('danger') || this.queue.has(`toll:${toll.group}`)) return;
    // a pirate group or an ambush party (M4b)
    const members = membersOf(state, toll.group);
    const key = `toll:${toll.group}`;
    const { tick } = state;
    const amount = toll.amount;
    const text = (tt: CommsTexts): CommsText => ({ speaker: groupSpeaker(state, members, tt), lines: [pickLine(tt.lines.pirate.tollDemand, tick, key)(formatCredits(amount))] });
    const msg: CommsMessage = {
      id: `${key}@${tick}`,
      key,
      ...text(t),
      channel: 'danger',
      ttl: 0,
      reply: 'toll',
      pinned: true,
      tick,
      retext: () => text(tx().comms),
    };
    this.queue.remove(`alert:${toll.group}`);
    this.queue.push(msg, clock);
  }

  private announce(msg: CommsMessage): void {
    this.host.sound(commsSound(msg), msg.channel === 'danger' || msg.channel === 'story');
  }

  /**
   * The panel is hidden (the shipyard editor takes the screen): the radio holds its messages and their
   * remaining time until it is visible again.
   */
  setVisible(visible: boolean, state: SimState): void {
    const clock = now(state);
    if (!visible) {
      this.hiddenAt ??= clock;
      return;
    }
    if (this.hiddenAt !== null) {
      this.queue.shift(clock - this.hiddenAt);
      this.hiddenAt = null;
    }
  }

  /** L toggles the log; Esc closes it. Returns true when the key was used. */
  onKey(code: string, letter: (l: string) => string): boolean {
    // the shipyard editor has the whole screen (the radio waits)
    if (this.hiddenAt !== null) return false;
    if (code === letter('l')) {
      this.logOpen = !this.logOpen;
      this.host.render();
      return true;
    }
    if (code === 'Escape' && this.logOpen) {
      this.logOpen = false;
      this.host.render();
      return true;
    }
    return false;
  }

  /** Panel and log data; `toll` is asked only while the toll message is on the air. */
  uiData(toll: () => TollHud | null, docked: boolean): CommsUiData {
    // a live language switch: the message on the air, the waiting ones and the log follow it
    if (this.texts === null && getLocale() !== this.locale) {
      this.locale = getLocale();
      this.queue.relocalize();
    }
    const showing = this.hiddenAt === null && this.setting !== 'off' ? this.queue.showing : null;
    let panel: CommsPanelData | null = null;
    if (showing) {
      const m = showing.msg;
      panel = {
        id: m.id,
        speaker: m.speaker,
        lines: m.lines,
        note: m.note ?? null,
        channel: m.channel,
        journal: !!m.journal,
        queued: this.queue.waitingCount,
        toll: m.reply === 'toll' ? toll() : null,
        seconds: Number.isFinite(messageDuration(m)) ? messageDuration(m) : null,
        docked,
      };
    }
    const log = this.logOpen && this.hiddenAt === null ? [...this.queue.transcript].reverse().map((e) => ({ ...e, time: clockLabel(e.tick) })) : null;
    return { panel, log, docked };
  }
}
