import { describe, expect, it } from 'vitest';
import { skMining } from '../../i18n/skMining';
import { createBody } from '../../sim/physics/body';
import { chunkOfAsteroid, oreGrade } from '../../sim/mining/grade';
import { Simulation, type SimEvent } from '../../sim/Simulation';
import type { ChunkGenerator } from '../../sim/world/generate';
import { gradeTitle, MiningUi, POP_SECONDS } from './miningUi';

/** Rocks with ids of a real chunk – their grades come from the seed. */
const rocks = (n: number): ChunkGenerator => (_s, cx, cy) => ({
  cx,
  cy,
  asteroids: cx === 0 && cy === 0 ? Array.from({ length: n }, (_, i) => ({ id: `0,0:${i}`, pos: { x: 10 + (i % 10) * 9, y: 6 + Math.floor(i / 10) * 9 }, baseRadius: 1.5, resource: 'copper' as const, initialAmount: 60, variant: 0.3 })) : [],
});

function flying(n = 60): Simulation {
  return new Simulation({ seed: 21, generator: rocks(n), startDocked: false });
}

describe('MiningUi', () => {
  it('pops the ore of a collected nugget at the cargo gauge for a moment', () => {
    const ui = new MiningUi();
    const e: SimEvent = { type: 'nuggetCollected', id: 1, pos: { x: 0, y: 0 }, resource: 'iron', amount: 12.5, cargoFull: false };
    ui.onEvents([e], 10);
    expect(ui.activePops(10.5)).toEqual([{ seq: 1, text: '+12,5 Fe' }]);
    expect(ui.activePops(10 + POP_SECONDS + 0.01)).toEqual([]);
  });

  it('toasts: rich ore found wins over the pulse toast, a plain assay does not', () => {
    const s = flying();
    const ui = new MiningUi();
    const rich = ui.toast(s.state, [{ type: 'oreAssayed', rocks: 9, rich: 2, best: 1.45 }]);
    expect(rich).toMatchObject({ kind: 'ok', urgent: true, text: skMining.assay.rich(2, '145 %') });
    expect(rich!.text).toBe('Skener: 2 bohaté kamene v okolí (najlepší 145 %)');
    expect(ui.toast(s.state, [{ type: 'oreAssayed', rocks: 9, rich: 0, best: 1.1 }])).toMatchObject({ urgent: false, kind: 'info' });
    expect(ui.toast(s.state, [{ type: 'oreAssayed', rocks: 0, rich: 0, best: 0 }])).toBeNull();
  });

  it('tells about the first few nuggets only', () => {
    const s = flying();
    const ui = new MiningUi();
    const spawned: SimEvent = { type: 'nuggetSpawned', id: 1, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, resource: 'copper', amount: 9, grade: 1.2 };
    const shown = Array.from({ length: 5 }, () => ui.toast(s.state, [spawned])).filter((x) => x !== null);
    expect(shown).toHaveLength(3);
    expect(shown[0]!.text).toContain('120 %');
  });

  it('labels the rock under the beam with its grade, or "?" before the scanner assayed it', () => {
    const s = flying();
    const ui = new MiningUi();
    const rock = s.state.world.asteroids()[0]!;
    s.state.player.beams = [{ laser: 0, from: { x: 0, y: 0 }, to: rock.pos, asteroidId: rock.id, resource: 'copper', bonus: 1, vein: null, grade: oreGrade(21, rock) }];
    const before = ui.callouts(s.state).find((c) => c.id === `ore:${rock.id}`)!;
    expect(before).toMatchObject({ detail: skMining.grade.unknown, keys: 'Tab' });
    s.state.mining.assayed.add(chunkOfAsteroid(rock));
    const after = ui.callouts(s.state).find((c) => c.id === `ore:${rock.id}`)!;
    expect(after.detail).toBe(skMining.grade.value(`${Math.round(oreGrade(21, rock) * 100)} %`));
    expect(after.keys).toBeNull();
  });

  it('marks assayed rich rocks (callout and radar), never unassayed ones', () => {
    const s = flying();
    const ui = new MiningUi();
    const all = s.state.world.asteroids();
    const rich = all.filter((a) => oreGrade(21, a) >= 1.25);
    expect(rich.length).toBeGreaterThan(0);
    expect(all.some((a) => ui.radarRich(s.state, a))).toBe(false);
    expect(ui.callouts(s.state)).toEqual([]);
    s.state.mining.assayed.add('0,0');
    expect(all.filter((a) => ui.radarRich(s.state, a)).map((a) => a.id)).toEqual(rich.map((a) => a.id));
    const callouts = ui.callouts(s.state);
    expect(callouts.length).toBeGreaterThan(0);
    expect(callouts.every((c) => c.tone === 'ok' && c.title.startsWith('Bohatá ruda'))).toBe(true);
  });

  it('a nugget nearby gets a callout that warns before it is gone', () => {
    const s = flying(0);
    const ui = new MiningUi();
    const body = createBody({ x: 6, y: 2 });
    s.state.mining.nuggets.push({ id: 4, resource: 'iron', amount: 12.5, grade: 1, source: 'x', body, prevBody: body, ttl: 30 * 60 });
    const [c] = ui.callouts(s.state);
    expect(c).toMatchObject({ id: 'nugget:4', title: 'Bohatý úlomok · 12,5 Fe', tone: 'ok' });
    s.state.mining.nuggets[0]!.ttl = 4 * 60;
    expect(ui.callouts(s.state)[0]).toMatchObject({ tone: 'warn', detail: skMining.nugget.fading(4) });
  });

  it('names the grade class of a rock', () => {
    expect(gradeTitle({ resource: 'iron' }, 1.45)).toBe('Bohatá ruda · Železo');
    expect(gradeTitle({ resource: 'iron' }, 0.7)).toBe('Chudobná ruda · Železo');
    expect(gradeTitle({ resource: 'iron' }, 1)).toBe('Ruda · Železo');
    expect(gradeTitle({ resource: 'iron' }, null)).toBe('Ruda · Železo');
  });
});
