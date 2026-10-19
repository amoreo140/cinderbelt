import { describe, expect, it } from 'vitest';
import { AGGRO_RANGE } from '../sim/combat/ai';
import { createEnemy } from '../sim/combat/enemies';
import type { AiMode, Enemy, EnemyKind } from '../sim/combat/types';
import { Simulation } from '../sim/Simulation';
import { combatFocus, combatFrame, hostilesNear, isHostile, proximity } from './hostiles';
import { FIRE_FLASH, ThreatArrows } from './threatArrows';

const pirate = (id: string, pos: { x: number; y: number }, kind: EnemyKind = 'jackal', mode: AiMode = 'patrol'): Enemy => {
  const e = createEnemy({ id, kind, tier: 1, pos, angle: 0, home: pos, orbit: 1 });
  e.ai.mode = mode;
  return e;
};

describe('isHostile', () => {
  it('patrolling, hailing and attacking pirates are hostile', () => {
    for (const mode of ['patrol', 'attack', 'hail'] as const) expect(isHostile(pirate('a', { x: 0, y: 0 }, 'jackal', mode))).toBe(true);
  });

  it("a Gunner breaking away (evade) is still in the fight", () => {
    expect(isHostile(pirate('g', { x: 0, y: 0 }, 'gunner', 'evade'))).toBe(true);
    expect(hostilesNear([pirate('g', { x: 60, y: 0 }, 'gunner', 'evade')], { x: 0, y: 0 })[0]!.attacking).toBe(true);
  });

  it('scavengers, paid-off, fleeing and retreating pirates are not', () => {
    expect(isHostile(pirate('a', { x: 0, y: 0 }, 'scavenger'))).toBe(false);
    const calm = pirate('b', { x: 0, y: 0 });
    calm.calm = true;
    expect(isHostile(calm)).toBe(false);
    expect(isHostile(pirate('c', { x: 0, y: 0 }, 'jackal', 'flee'))).toBe(false);
    expect(isHostile(pirate('d', { x: 0, y: 0 }, 'hammer', 'retreat'))).toBe(false);
  });
});

describe('hostilesNear / combatFocus', () => {
  const aggro = AGGRO_RANGE.jackal;

  it('keeps hostiles within 1.2× aggro, nearest first', () => {
    const list = hostilesNear(
      [pirate('far', { x: aggro * 1.3, y: 0 }), pirate('edge', { x: 0, y: aggro * 1.1 }), pirate('near', { x: -30, y: 0 }), pirate('scav', { x: 5, y: 0 }, 'scavenger')],
      { x: 0, y: 0 },
    );
    expect(list.map((h) => h.id)).toEqual(['near', 'edge']);
    expect(list[0]!.dist).toBeCloseTo(30);
  });

  it('the camera frames the nearest one inside its aggro range, or an attacker beyond it', () => {
    const outside = hostilesNear([pirate('edge', { x: 0, y: aggro * 1.1 })], { x: 0, y: 0 });
    expect(combatFocus(outside)).toBeNull();
    const coming = hostilesNear([pirate('edge', { x: 0, y: aggro * 1.1 }, 'jackal', 'attack')], { x: 0, y: 0 });
    expect(combatFocus(coming)?.id).toBe('edge');
    const two = hostilesNear([pirate('a', { x: 90, y: 0 }), pirate('b', { x: 50, y: 0 })], { x: 0, y: 0 });
    expect(combatFocus(two)?.id).toBe('b');
  });

  it('the camera frames a single Gunner at its standoff and a sentry on guard', () => {
    const gunner = hostilesNear([pirate('g', { x: 90, y: 0 }, 'gunner', 'attack')], { x: 0, y: 0 });
    expect(combatFrame(gunner).map((h) => h.id)).toEqual(['g']);
    const sentry = hostilesNear([pirate('s', { x: 0, y: -120 }, 'sentry', 'attack')], { x: 0, y: 0 });
    expect(combatFrame(sentry).map((h) => h.id)).toEqual(['s']);
  });

  it('besides the nearest attacker the camera frames every Gunner and sentry shooting from range', () => {
    const list = hostilesNear(
      [
        pirate('jackal', { x: 30, y: 0 }, 'jackal', 'attack'),
        pirate('gunner', { x: -90, y: 0 }, 'gunner', 'attack'),
        pirate('evading', { x: 0, y: 150 }, 'gunner', 'evade'),
        pirate('sentry', { x: 0, y: -120 }, 'sentry', 'attack'),
        // patrolling ones and a second Jackal are not framed: only the nearest melee attacker is
        pirate('idle', { x: 0, y: 100 }, 'gunner', 'patrol'),
        pirate('jackal2', { x: 60, y: 0 }, 'jackal', 'attack'),
      ],
      { x: 0, y: 0 },
    );
    expect(combatFrame(list).map((h) => h.id)).toEqual(['jackal', 'gunner', 'sentry', 'evading']);
    expect(combatFrame([])).toEqual([]);
  });

  it('proximity runs from 0 at the arrow reach to 1 at the ship', () => {
    expect(proximity(0, 140)).toBe(1);
    expect(proximity(168, 140)).toBeCloseTo(0);
    expect(proximity(500, 140)).toBe(0);
    expect(proximity(84, 140)).toBeCloseTo(0.5);
  });
});

describe('ThreatArrows', () => {
  it('flashes the arrow of a pirate that just fired, and only for a moment', () => {
    const arrows = new ThreatArrows();
    arrows.push([{ type: 'shotFired', owner: 'pr:1', pos: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, tier: 1 }, { type: 'shotFired', owner: 'player', pos: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, tier: 1 }], 10);
    expect(arrows.flash('pr:1', 10)).toBe(1);
    expect(arrows.flash('pr:1', 10 + FIRE_FLASH / 2)).toBeCloseTo(0.5);
    expect(arrows.flash('pr:1', 10 + FIRE_FLASH + 0.1)).toBe(0);
    expect(arrows.flash('player', 10)).toBe(0);
  });

  it('builds arrows for off-screen hostiles in free flight only', () => {
    const sim = new Simulation({ seed: 7 });
    const state = sim.state;
    state.player.dock = { mode: 'flying' };
    state.player.body = { ...state.player.body, pos: { x: 0, y: 0 } };
    state.combat.enemies = [pirate('a', { x: 100, y: 0 }), pirate('b', { x: -10, y: 0 })];
    // a fake projection: 10 px per unit around the window centre
    const rect = { left: 0, top: 0, width: 1280, height: 720 };
    const project = (p: { x: number; y: number }) => ({ x: 640 + p.x * 10, y: 360 - p.y * 10, behind: false });
    const view = new ThreatArrows().view(state, project, rect, 0);
    expect(view).toHaveLength(1);
    expect(view[0]!.key).toBe('a');
    expect(view[0]!.shape).toBe('needle');
    expect(view[0]!.arc).toBeUndefined();
    state.player.dock = { mode: 'docked', stationId: 'home' } as unknown as typeof state.player.dock;
    expect(new ThreatArrows().view(state, project, rect, 0)).toEqual([]);
  });
});
