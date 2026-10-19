// Entering a sector in flight (sectors design §5.2) – presentation memory of the game layer, not the
// simulation (nothing here is saved):
//  - the current sector follows the ship with a hysteresis: a border counts once the ship is
//    `SECTOR_HYSTERESIS` units past it, so wiggling along a border never flickers;
//  - a full entry notice (2.5 s, security colour band + radio) only on the first visit of a sector
//    or when its security changed since the last visit (a destroyed fortress); otherwise only the
//    HUD badge changes and a short tone plays, at most once per `TONE_INTERVAL` seconds.
import type { Vec2 } from '../../sim/math/vec2';
import type { Security } from '../../sim/regions/constants';

/** How far past a sector border the current sector switches (u, §5.2). */
export const SECTOR_HYSTERESIS = 30;
/** How long the full entry notice stays (s). */
export const NOTICE_SECONDS = 2.5;
/** Minimum spacing of the short entry tones (s). */
export const TONE_INTERVAL = 20;
/** A jump longer than this between two updates (a tow, a respawn, a load) switches silently (u). */
export const TELEPORT_DISTANCE = 500;

const SAMPLES = 8;

/**
 * The sector the ship counts as being in: stays `currentId` until the ship is at least `margin` past
 * its border – neither the point nor any sample of the circle of that radius around it is in it.
 */
export function followSector(regionAt: (x: number, y: number) => string, currentId: string | null, p: Vec2, margin = SECTOR_HYSTERESIS): string {
  const here = regionAt(p.x, p.y);
  if (currentId === null || here === currentId) return here;
  for (let k = 0; k < SAMPLES; k++) {
    const a = (k / SAMPLES) * Math.PI * 2;
    if (regionAt(p.x + Math.cos(a) * margin, p.y + Math.sin(a) * margin) === currentId) return currentId;
  }
  return here;
}

/** What an entry does: the full notice, a short tone only, or nothing but the HUD badge. */
export type EntryReaction = 'notice' | 'tone' | 'none';

/** Which sectors the player has been in (with their security then) and when the last tone played. */
export class EntryMemory {
  private readonly visited = new Map<string, Security>();
  private lastSound = -Infinity;

  /** Sectors already visited before this session (derived from the explored chunks) – no notice there. */
  prime(visited: Iterable<[string, Security]>): void {
    for (const [id, security] of visited) if (!this.visited.has(id)) this.visited.set(id, security);
  }

  /** Records a silent arrival (load, tow) without a notice or a tone. */
  arrive(id: string, security: Security): void {
    this.visited.set(id, security);
  }

  hasVisited(id: string): boolean {
    return this.visited.has(id);
  }

  /** The ship entered sector `id` at game time `now` (s). */
  enter(id: string, security: Security, now: number): EntryReaction {
    const before = this.visited.get(id);
    this.visited.set(id, security);
    if (before === undefined || before !== security) {
      this.lastSound = now;
      return 'notice';
    }
    if (now - this.lastSound >= TONE_INTERVAL) {
      this.lastSound = now;
      return 'tone';
    }
    return 'none';
  }
}
