// Slot views for the New game, Load game and Continue screens (M2, 4.1–4.3; slots 15.7).
// Pure functions: split by difficulty, the default slot for a new game and formatting of the metadata.
import { tx } from '../../i18n';
import type { SlotMeta } from '../../sim/save/meta';
import { TICKS_PER_SECOND } from '../../sim/save/meta';
import type { SlotRef } from '../../sim/save/types';
import { DEATH_PENALTIES, type DeathPenalty } from '../../sim/settings';
import { SLOTS_PER_DIFFICULTY } from '../storage/slots';
import type { SlotOverview, SlotState } from './saveService';

/** A cell in the slot list: occupied (state) or empty (null). */
export interface SlotCell {
  slot: SlotRef;
  state: SlotState | null;
}

/**
 * Slots by difficulty – always 4 cells (empty ones too), followed by the moved games of
 * "fallen heroes" with index ≥ 4 (Hard can have more than 4, 15.7).
 */
export function slotColumns(overview: readonly SlotOverview[]): Record<DeathPenalty, SlotCell[]> {
  const out = {} as Record<DeathPenalty, SlotCell[]>;
  for (const difficulty of DEATH_PENALTIES) {
    const taken = new Map(overview.filter((o) => o.slot.difficulty === difficulty).map((o) => [o.slot.index, o.state]));
    const extra = [...taken.keys()].filter((i) => i >= SLOTS_PER_DIFFICULTY).sort((a, b) => a - b);
    const indices = [...Array.from({ length: SLOTS_PER_DIFFICULTY }, (_, i) => i), ...extra];
    out[difficulty] = indices.map((index) => ({ slot: { difficulty, index }, state: taken.get(index) ?? null }));
  }
  return out;
}

/** Slots a new game of the given difficulty can go into (0–3 only). */
export function newGameSlots(overview: readonly SlotOverview[], difficulty: DeathPenalty): SlotCell[] {
  return slotColumns(overview)[difficulty].slice(0, SLOTS_PER_DIFFICULTY);
}

/** A new game cannot go into a slot holding a game from a newer version (it must be deleted first). */
export const slotWritable = (cell: SlotCell): boolean => cell.state?.kind !== 'tooNew';

const savedAtOf = (cell: SlotCell): string => (cell.state && cell.state.meta ? cell.state.meta.savedAt : '');

/**
 * Default slot for a new game: the first empty one; if all are occupied, the writable one saved
 * longest ago (the player confirms the overwrite). null = none can be used.
 */
export function defaultNewGameSlot(cells: readonly SlotCell[]): SlotRef | null {
  const empty = cells.find((c) => c.state === null);
  if (empty) return empty.slot;
  const writable = cells.filter(slotWritable);
  if (writable.length === 0) return null;
  return writable.reduce((a, b) => (savedAtOf(b) < savedAtOf(a) ? b : a)).slot;
}

/** The most recently saved loadable game ("Continue"). Corrupted slots are skipped. */
export function continueTarget(overview: readonly SlotOverview[]): SlotMeta | null {
  let best: SlotMeta | null = null;
  for (const o of overview) {
    if (o.state.kind !== 'ok') continue;
    if (!best || o.state.meta.savedAt > best.savedAt) best = o.state.meta;
  }
  return best;
}

// ───────────── formatting ─────────────

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Play time: `42 min`, `1:42 h` (under a minute `< 1 min`). */
export function formatPlayTime(ticks: number): string {
  const minutes = Math.floor(Math.max(0, ticks) / TICKS_PER_SECOND / 60);
  if (minutes < 1) return tx().time.underMinute;
  if (minutes < 60) return tx().time.minutes(minutes);
  return tx().time.playTime(Math.floor(minutes / 60), pad2(minutes % 60));
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Save time in local time: `today 14:32` (today), `yesterday 22:10` (yesterday), `12. 10. 2026 14:32`. */
export function formatSavedAt(iso: string, now: Date, words: { today: string; yesterday: string }): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = `${d.getHours()}:${pad2(d.getMinutes())}`;
  if (sameDay(d, now)) return `${words.today} ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `${words.yesterday} ${time}`;
  return `${tx().time.date(d.getDate(), d.getMonth() + 1, d.getFullYear())} ${time}`;
}

/** Time since the last save: `0:42`, `12:05`, `1 h 05 min`. */
export function formatElapsed(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
  return tx().time.hoursMinutes(Math.floor(s / 3600), pad2(Math.floor((s % 3600) / 60)));
}
