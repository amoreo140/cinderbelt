// HUD event chips (M4b T7 view model, drawn by src/ui/sites/EventChip.tsx): every event the
// director lists now (`activeEvents`) as a chip, most severe first – danger before warn before info,
// within a tone the director's own order (ambush, micrometeors, ion storm, comet flyby, distress). The
// timer counts to the start during the warning lead, then to the end; an open-ended event (an ambush
// while its party lives) has none. The arrow is relative to the ship's bow, clockwise.
import { EVENT_DEFS, type EventTone } from '../../data/events';
import { tx } from '../../i18n';
import type { ActiveEvent } from '../../sim/events/types';
import type { Vec2 } from '../../sim/math/vec2';
import { cometName } from './cometMapView';
import type { EventChipItem } from './types';

/** Sim steps per second. */
const TICKS_PER_SECOND = 60;

const TONE_RANK: Readonly<Record<EventTone, number>> = { danger: 0, warn: 1, info: 2 };

/** The ship the chips are relative to. */
export interface ChipShip {
  pos: Vec2;
  /** Heading (rad, world – counter-clockwise, y up). */
  angle: number;
}

/** Degrees into [0, 360). */
const norm = (deg: number): number => ((deg % 360) + 360) % 360;

/** A world bearing (rad) relative to the bow, clockwise in degrees (0 = ahead, 90 = right). */
export function relativeDeg(bearing: number, shipAngle: number): number {
  // the world turns counter-clockwise (y up on screen), the chip's dial clockwise
  return norm((-(bearing - shipAngle) * 180) / Math.PI);
}

/** The world bearing the chip points to, or null (an ion storm is all around the ship). */
function bearingOf(ev: ActiveEvent, ship: ChipShip): number | null {
  if (ev.kind === 'ionStorm') return null;
  // micrometeors: the direction the stream comes FROM
  if (ev.kind === 'micrometeors') return ev.dir ?? null;
  if (ev.pos) {
    const dx = ev.pos.x - ship.pos.x;
    const dy = ev.pos.y - ship.pos.y;
    if (dx * dx + dy * dy > 1e-6) return Math.atan2(dy, dx);
  }
  return ev.dir ?? null;
}

/** "cm:3" of a comet flyby key `ev:comet:cm:3@<pass>`; null for other keys. */
export function flybyCometId(key: string): string | null {
  if (!key.startsWith('ev:comet:')) return null;
  const at = key.lastIndexOf('@');
  return key.slice('ev:comet:'.length, at < 0 ? undefined : at);
}

/** A comet's display name by its id `cm:<n>` ("Comet K-<n+1>", the map's `cometName`). */
export function cometTitle(id: string): string {
  const n = Number(id.slice(id.indexOf(':') + 1));
  return cometName(Number.isFinite(n) ? n : 0);
}

function titleOf(ev: ActiveEvent): string {
  if (ev.kind === 'cometFlyby') {
    const id = flybyCometId(ev.key);
    if (id) return cometTitle(id);
  }
  return tx().world.events.names[ev.kind];
}

/** One chip of an event at `tick`. */
export function eventChip(ev: ActiveEvent, tick: number, ship: ChipShip): EventChipItem {
  const pending = tick < ev.start;
  const secondsLeft = pending ? (ev.start - tick) / TICKS_PER_SECOND : ev.open ? null : Math.max(0, (ev.end - tick) / TICKS_PER_SECOND);
  const bearing = bearingOf(ev, ship);
  return {
    key: ev.key,
    kind: ev.kind,
    title: titleOf(ev),
    secondsLeft,
    dirDeg: bearing === null ? null : relativeDeg(bearing, ship.angle),
    tone: EVENT_DEFS[ev.kind].tone,
    pending,
  };
}

/** The chips of the listed events, most severe first (the UI shows the first two, a storm keeps its place). */
export function eventChips(events: readonly ActiveEvent[], tick: number, ship: ChipShip): EventChipItem[] {
  return events
    .map((ev, i) => ({ chip: eventChip(ev, tick, ship), i }))
    .sort((a, b) => TONE_RANK[a.chip.tone] - TONE_RANK[b.chip.tone] || a.i - b.i)
    .map((c) => c.chip);
}
