// Communicator message model. Presentation only: messages are built
// from sim events and state, never saved. A message is a person (or a signal) speaking on the radio.
import type { PortraitFaction, PortraitId, SpeakerRole } from '../../data/speakers';
import type { ToastKind } from '../../ui/GameUi';

/**
 * Channel of a message – its priority and whether the "important only" radio setting lets it through:
 * story / danger > training > station > flavour.
 */
export type CommsChannel = 'story' | 'danger' | 'training' | 'station' | 'flavour';

export const CHANNEL_PRIORITY: Record<CommsChannel, number> = { story: 4, danger: 4, training: 3, station: 2, flavour: 1 };

/** Channels the "important only" setting keeps. */
export const IMPORTANT_CHANNELS: ReadonlySet<CommsChannel> = new Set(['story', 'danger', 'training']);

/** The "Radio" setting: all messages, important ones only, or none (toasts as before). */
export type RadioSetting = 'all' | 'important' | 'off';
export const RADIO_SETTINGS: readonly RadioSetting[] = ['all', 'important', 'off'];

/** A speaker resolved for display (name in the current language). */
export interface Speaker {
  /** Stable id – per-speaker cooldowns (`traffic:<station>`, `cap:<i>`, `pirate:jackal`…). */
  id: string;
  name: string;
  /** Role / faction tag (stencil label). */
  role: string;
  portrait: PortraitId;
  faction: PortraitFaction;
  kind: SpeakerRole;
  /** Voice colour (channel stripe). */
  accent: string;
}

/** The toast a message replaces – shown instead when the radio filters the message out. */
export interface CommsToast {
  text: string;
  kind: ToastKind;
  seconds: number;
}

/** Who speaks and what they say, in one language. */
export interface CommsText {
  speaker: Speaker;
  lines: string[];
  note?: string;
}

/**
 * The message's text built again in the current language: a live language switch re-renders the
 * message on the air, the waiting ones and the log (the received text is resolved, not kept as keys).
 */
export type Retext = () => CommsText;

export interface CommsMessage {
  /** Unique per message (`<key>@<tick>`). */
  id: string;
  /** De-duplication key: a new message with the key of a showing / waiting one replaces it. */
  key: string;
  speaker: Speaker;
  /** What the speaker says (typed out). */
  lines: string[];
  /** A short factual line under the speech (what the old toast said: amounts, reasons). */
  note?: string;
  channel: CommsChannel;
  /** Seconds the message stays after it is typed out. */
  ttl: number;
  /** Interactive answer inside the panel (the toll demand). */
  reply?: 'toll';
  /** The message stays until released (an open toll demand). */
  pinned?: boolean;
  /** The story beat has a journal entry (J) – the panel links to it. */
  journal?: boolean;
  /** Extra priority: an answer to what the player just did (a docking request) goes on the air at once. */
  boost?: number;
  /** A new message with this key is dropped this many seconds after the last one was received. */
  cooldown?: number;
  /** Sim tick when it was sent (the log shows the game time). */
  tick: number;
  /** The text in the current language (a live language switch); absent = kept as received. */
  retext?: Retext;
}

/** A line of the comm log. */
export interface CommsLogEntry {
  id: string;
  tick: number;
  speaker: Speaker;
  lines: string[];
  note?: string;
  channel: CommsChannel;
  journal?: boolean;
  retext?: Retext;
}
