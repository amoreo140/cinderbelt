// The communicator queue: one message on the radio at a time, the rest
// wait by priority (story / danger > training > station > flavour). A message with the key of a showing
// or waiting one replaces it (a new dock rejection updates the old), a key can carry a cooldown (a
// captain's taunt once a minute), chatty flavour has a per-speaker cooldown, a more important message
// cuts a less important one, and the last messages stay in the transcript for the log. Pure: the game
// clock (seconds) is passed in.
import { CHANNEL_PRIORITY, type CommsChannel, type CommsLogEntry, type CommsMessage } from './types';

/** Most messages waiting behind the showing one. */
export const MAX_WAITING = 6;
/** Messages kept for the comm log. */
export const LOG_SIZE = 30;
/** Per-speaker cooldown by channel (s): flavour does not repeat the same voice too often. */
export const SPEAKER_COOLDOWN: Record<CommsChannel, number> = { story: 0, danger: 0, training: 0, station: 0, flavour: 25 };
/** A message cut this soon after it appeared comes back later (s); a read one does not. */
export const CUT_GRACE = 0.5;
/** A waiting message older than this (s) is stale and skipped – the moment has passed. */
export const MAX_WAIT: Record<CommsChannel, number> = { story: 40, danger: 20, training: 40, station: 15, flavour: 8 };

/** Number of characters typed out (lines and the note). */
export const messageChars = (m: Pick<CommsMessage, 'lines'>): number => m.lines.reduce((n, l) => n + l.length, 0);

/** Shortest reading time of any message (s). */
export const READ_MIN = 5;
/** Longest reading time the rule adds for a long text (s). */
export const READ_MAX = 12;
/** Extra reading time per character (the rule: 5 s + chars / 30). */
export const READ_CHARS_PER_SECOND = 30;

/**
 * How long a message stays on the radio (s) – the ONE place of the display-time rule:
 * max(sourceTtl, min(12, 5 + chars / 30)). `ttl: 0` (and a pinned message) stays until it is handled.
 * The text is shown at once (no typewriter): reading time matters more than the effect.
 */
export const messageDuration = (m: Pick<CommsMessage, 'lines' | 'ttl' | 'pinned'>): number =>
  m.pinned || m.ttl === 0 ? Infinity : Math.max(m.ttl, Math.min(READ_MAX, READ_MIN + messageChars(m) / READ_CHARS_PER_SECOND));

export const messagePriority = (m: Pick<CommsMessage, 'channel' | 'reply' | 'boost'>): number => CHANNEL_PRIORITY[m.channel] + (m.reply ? 10 : 0) + (m.boost ?? 0);

/** A message (or log line) with its text built again in the current language. */
function retexted<T extends CommsLogEntry>(m: T): T {
  if (!m.retext) return m;
  const t = m.retext();
  const out: T = { ...m, speaker: t.speaker, lines: t.lines };
  if (t.note !== undefined) out.note = t.note;
  return out;
}

export interface Showing {
  msg: CommsMessage;
  /** Game clock when it appeared (s). */
  shownAt: number;
}

interface Waiting {
  msg: CommsMessage;
  /** Game clock when it was received (s). */
  at: number;
  seq: number;
}

export type PushResult = 'shown' | 'queued' | 'replaced' | 'dropped';

export class CommsQueue {
  private current: Showing | null = null;
  private waiting: Waiting[] = [];
  private log: CommsLogEntry[] = [];
  private readonly lastKey = new Map<string, number>();
  private readonly lastSpeaker = new Map<string, number>();
  private seq = 0;

  /** The message on the radio now. */
  get showing(): Showing | null {
    return this.current;
  }

  /** How many messages wait behind it. */
  get waitingCount(): number {
    return this.waiting.length;
  }

  /** Waiting messages in the order they will show (for tests and the "+N" tag). */
  get queued(): readonly CommsMessage[] {
    return this.waiting.map((w) => w.msg);
  }

  /** The last LOG_SIZE received messages, oldest first. */
  get transcript(): readonly CommsLogEntry[] {
    return this.log;
  }

  /** Receive a message. Returns what happened to it. */
  push(msg: CommsMessage, now: number): PushResult {
    const last = this.lastKey.get(msg.key);
    if (msg.cooldown !== undefined && last !== undefined && now - last < msg.cooldown) return 'dropped';
    const speakerGap = SPEAKER_COOLDOWN[msg.channel];
    const spoke = this.lastSpeaker.get(msg.speaker.id);
    if (speakerGap > 0 && spoke !== undefined && now - spoke < speakerGap) return 'dropped';
    this.lastKey.set(msg.key, now);
    this.lastSpeaker.set(msg.speaker.id, now);
    this.record(msg);

    const cur = this.current;
    if (cur && cur.msg.key === msg.key) {
      // the same thing said again (a new dock rejection): replace it in place and start over
      this.current = { msg: { ...msg, pinned: msg.pinned ?? cur.msg.pinned }, shownAt: now };
      return 'replaced';
    }
    const same = this.waiting.find((w) => w.msg.key === msg.key);
    if (same) {
      same.msg = msg;
      same.at = now;
      return 'replaced';
    }
    if (!cur) {
      this.current = { msg, shownAt: now };
      return 'shown';
    }
    const p = messagePriority(msg);
    const q = messagePriority(cur.msg);
    // more important cuts the current message; so does an answer to what the player just did (boost) over
    // one as important – the newest answer is on the air. One still being typed comes back after it.
    if ((p > q || (msg.boost !== undefined && p >= q)) && !cur.msg.pinned) {
      if (now < cur.shownAt + CUT_GRACE) this.enqueue(cur.msg, now, -1);
      this.current = { msg, shownAt: now };
      return 'shown';
    }
    this.enqueue(msg, now);
    return this.waiting.some((w) => w.msg === msg) ? 'queued' : 'dropped';
  }

  /** Into the waiting line by priority (`first` = ahead of its equals: a cut message). */
  private enqueue(msg: CommsMessage, now: number, first = 0): void {
    this.waiting.push({ msg, at: now, seq: first < 0 ? -1 - this.seq++ : this.seq++ });
    this.waiting.sort((a, b) => messagePriority(b.msg) - messagePriority(a.msg) || a.seq - b.seq);
    if (this.waiting.length > MAX_WAITING) this.waiting.length = MAX_WAITING;
  }

  /**
   * Advance the radio to `now`: the showing message ends after its time (unless pinned), the next
   * waiting one that is still fresh takes its place. Returns the message that started now, or null.
   */
  update(now: number): CommsMessage | null {
    const cur = this.current;
    if (cur && now >= cur.shownAt + messageDuration(cur.msg)) this.current = null;
    // stale messages leave the line (the moment has passed) – "+N" counts only what will still play
    this.waiting = this.waiting.filter((w) => now - w.at <= MAX_WAIT[w.msg.channel]);
    if (this.current) return null;
    const next = this.waiting.shift();
    if (!next) return null;
    this.current = { msg: next.msg, shownAt: now };
    return next.msg;
  }

  /** The player closed the message (click). A pinned one stays. */
  dismiss(now: number): CommsMessage | null {
    if (this.current && !this.current.msg.pinned) this.current = null;
    return this.update(now);
  }

  /** Ends a pinned message (the toll was answered) and drops waiting ones with the key. */
  release(key: string, now: number): CommsMessage | null {
    if (this.current?.msg.key === key) this.current = null;
    this.remove(key);
    return this.update(now);
  }

  /** Drops waiting messages with the key (a toll demand makes the group's taunt pointless). */
  remove(key: string): void {
    this.waiting = this.waiting.filter((w) => w.msg.key !== key);
  }

  /** Is a message with the key showing or waiting? */
  has(key: string): boolean {
    return this.current?.msg.key === key || this.waiting.some((w) => w.msg.key === key);
  }

  /**
   * The radio was hidden for `dt` seconds (the shipyard editor covers the screen): the showing and the
   * waiting messages keep their remaining time.
   */
  shift(dt: number): void {
    if (dt <= 0) return;
    if (this.current) this.current = { ...this.current, shownAt: this.current.shownAt + dt };
    for (const w of this.waiting) w.at += dt;
  }

  /**
   * The language changed: the message on the air, the waiting ones and the log say the same in the
   * new language (messages without `retext` stay as received).
   */
  relocalize(): void {
    if (this.current) this.current = { ...this.current, msg: retexted(this.current.msg) };
    for (const w of this.waiting) w.msg = retexted(w.msg);
    this.log = this.log.map(retexted);
  }

  /** Clears the radio (switched off); the log stays. */
  clear(): void {
    this.current = null;
    this.waiting = [];
  }

  private record(msg: CommsMessage): void {
    const entry: CommsLogEntry = { id: msg.id, tick: msg.tick, speaker: msg.speaker, lines: msg.lines, channel: msg.channel };
    if (msg.note) entry.note = msg.note;
    if (msg.journal) entry.journal = true;
    if (msg.retext) entry.retext = msg.retext;
    // a replaced message (same key) updates its log line instead of adding one
    const last = this.log[this.log.length - 1];
    if (last && last.id === msg.id) this.log[this.log.length - 1] = entry;
    else this.log.push(entry);
    if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE);
  }
}
