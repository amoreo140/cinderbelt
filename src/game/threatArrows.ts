// Off-screen pirate arrows (readability pass R2): every hostile within 1.2× its aggro range gets a red
// arrow at the screen edge – bigger and more solid the closer it is, flashing when it fires at me; four
// or more in one direction merge into an arc with the count (the shared ui/edgeArrows.ts lays them out,
// ui/EdgeArrowLayer.tsx draws them).
import { PLAYER_REF } from '../sim/combat/types';
import type { Vec2 } from '../sim/math/vec2';
import type { SimEvent, SimState } from '../sim/Simulation';
import type { EdgeArrowMark } from '../ui/EdgeArrowLayer';
import { flightHudRects, groupEdgeArrows, proximityStyle } from '../ui/edgeArrows';
import { hostilesNear, proximity } from './hostiles';

/** How long an arrow flashes after its pirate fires (s). */
export const FIRE_FLASH = 0.45;
/** Distance of the arrows from the screen edge (px). */
export const THREAT_ARROW_MARGIN = 44;

export class ThreatArrows {
  /** Pirate id → clock of its last shot. */
  private readonly shots = new Map<string, number>();

  /** Shots of the step (pirates only shoot at the player). */
  push(events: readonly SimEvent[], clock: number): void {
    for (const e of events) if (e.type === 'shotFired' && e.owner !== PLAYER_REF) this.shots.set(e.owner, clock);
  }

  clear(): void {
    this.shots.clear();
  }

  /** 0..1 – how bright the flash of this pirate's arrow is now. */
  flash(id: string, clock: number): number {
    const at = this.shots.get(id);
    if (at === undefined) return 0;
    const age = clock - at;
    if (age < 0 || age > FIRE_FLASH) {
      if (age > FIRE_FLASH) this.shots.delete(id);
      return 0;
    }
    return 1 - age / FIRE_FLASH;
  }

  /** The arrows for the HUD; `project` maps a plane point to window px (GameRenderer.projectToScreen). */
  view(
    state: SimState,
    project: (p: Vec2) => { x: number; y: number; behind: boolean },
    rect: { left: number; top: number; width: number; height: number },
    clock: number,
  ): EdgeArrowMark[] {
    const player = state.player;
    if (player.dock.mode !== 'flying' || player.destroyed) return [];
    const view = { width: rect.width, height: rect.height };
    const inputs = hostilesNear(state.combat.enemies, player.body.pos).map((h) => {
      const p = project(h.pos);
      const near = proximity(h.dist, h.aggro);
      return { screen: { x: p.x - rect.left, y: p.y - rect.top, behind: p.behind }, item: { id: h.id, near, flash: this.flash(h.id, clock) }, priority: near };
    });
    return groupEdgeArrows(inputs, view, { margin: THREAT_ARROW_MARGIN, avoid: flightHudRects(view) }).map((g) => {
      // a pack takes the look of its closest member and flashes when any of them fires
      const style = proximityStyle(Math.max(...g.items.map((i) => i.near)));
      const pack = g.span > 0;
      return {
        key: pack ? `pack:${g.items.map((i) => i.id).join(',')}` : g.items[0]!.id,
        x: g.x,
        y: g.y,
        angle: g.angle,
        color: 'var(--af-bad)',
        shape: 'needle',
        scale: style.scale,
        alpha: style.opacity,
        flash: Math.max(...g.items.map((i) => i.flash)),
        count: g.items.length,
        ...(pack ? { arc: g.span } : {}),
        testId: pack ? 'edge-hostile-group' : 'edge-hostile',
      };
    });
  }
}
