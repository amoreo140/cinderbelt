// Stale marks on the map (M4d "Stale marks", S6): session memory of where the player last saw
// a pirate group (radar contacts, grouped by spawn group) or a comet nucleus. While something is seen it
// is live (the map draws the real thing, no mark); once it drops out of sight a mark stays at its last
// seen position and fades 1 → `STALE.minAlpha` over `STALE.fadeSeconds`, then it is removed. Seeing it
// again makes it live (the mark goes). Game-layer state, not saved – cleared on load. The game layer (T9)
// feeds `update` each frame with what the radar shows (`pirateSightings`, plus the comet nuclei in sight).
import { STALE } from '../../data/navigation';
import type { Vec2 } from '../../sim/math/vec2';
import type { StaleMark } from './types';

const TICKS_PER_SECOND = 60;

/** Something the player sees this frame. `key` identifies it across frames (a pirate group, a comet). */
export interface Sighting {
  key: string;
  kind: StaleMark['kind'];
  pos: Vec2;
}

interface Entry {
  kind: StaleMark['kind'];
  pos: Vec2;
  /** Tick it was last seen. */
  tick: number;
  live: boolean;
}

/** Alpha of a mark `ageSeconds` old: 1 → `STALE.minAlpha` linearly over `STALE.fadeSeconds`. */
export function staleAlpha(ageSeconds: number): number {
  const t = Math.min(1, Math.max(0, ageSeconds / STALE.fadeSeconds));
  return 1 - (1 - STALE.minAlpha) * t;
}

export class LastSeen {
  private readonly entries = new Map<string, Entry>();

  /** What is seen at `tick` (sim ticks): those are live, the rest age; marks older than the fade are removed. */
  update(seen: readonly Sighting[], tick: number): void {
    const now = new Set<string>();
    for (const s of seen) {
      now.add(s.key);
      this.entries.set(s.key, { kind: s.kind, pos: { x: s.pos.x, y: s.pos.y }, tick, live: true });
    }
    const limit = STALE.fadeSeconds * TICKS_PER_SECOND;
    for (const [key, e] of this.entries) {
      if (now.has(key)) continue;
      e.live = false;
      if (tick - e.tick > limit) this.entries.delete(key);
    }
  }

  /** The faded marks at `tick` (things out of sight, not older than the fade). */
  marks(tick: number): StaleMark[] {
    const out: StaleMark[] = [];
    for (const e of this.entries.values()) {
      if (e.live) continue;
      const ageSeconds = Math.max(0, (tick - e.tick) / TICKS_PER_SECOND);
      if (ageSeconds > STALE.fadeSeconds) continue;
      out.push({ pos: { x: e.pos.x, y: e.pos.y }, kind: e.kind, ageSeconds, alpha: staleAlpha(ageSeconds) });
    }
    return out;
  }

  /** Forget everything (a load or a new game – session memory). */
  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * The spawn group of an enemy id: the id without its trailing ship index (`pr:3,-2:1` → `pr:3,-2`,
 * `hp:12:0` → `hp:12`); an id without an index (`zb:4,1`, fortress reinforcements) is its own group.
 */
export function pirateGroup(id: string): string {
  const i = id.lastIndexOf(':');
  return i > 0 && /^\d+$/.test(id.slice(i + 1)) && id.indexOf(':') < i ? id.slice(0, i) : id;
}

/**
 * The pirate groups the radar shows: enemies within `range` of `from`, one sighting per spawn group at
 * the group's centre (`key` = `pirates:<group>`).
 */
export function pirateSightings(enemies: readonly { id: string; pos: Vec2 }[], from: Vec2, range: number): Sighting[] {
  const groups = new Map<string, { x: number; y: number; n: number }>();
  const r2 = range * range;
  for (const e of enemies) {
    const dx = e.pos.x - from.x;
    const dy = e.pos.y - from.y;
    if (dx * dx + dy * dy > r2) continue;
    const key = pirateGroup(e.id);
    const g = groups.get(key) ?? { x: 0, y: 0, n: 0 };
    g.x += e.pos.x;
    g.y += e.pos.y;
    g.n++;
    groups.set(key, g);
  }
  return [...groups].map(([key, g]) => ({ key: `pirates:${key}`, kind: 'pirates', pos: { x: g.x / g.n, y: g.y / g.n } }));
}
