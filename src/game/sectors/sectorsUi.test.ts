import { describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import { sectorIdAt, sectorInfo } from '../../sim/regions/sectors';
import { regionWorld } from '../../sim/regions/world';
import { Simulation } from '../../sim/Simulation';
import type { Security } from '../../sim/regions/constants';
import type { CommsMessage } from '../comms/types';
import { SectorsUi } from './sectorsUi';
import { radarBorderGrid, radarBorders } from '../../ui/sectors/radarBorders';

const SEED = 1337;

function setup(radio?: (messages: CommsMessage[]) => boolean) {
  setLocale('sk');
  const sim = new Simulation({ seed: SEED, startDocked: false });
  const sounds: [Security, boolean][] = [];
  const ui = new SectorsUi({ sound: (s, n) => sounds.push([s, n]), radio });
  const move = (x: number, y: number) => {
    const body = { pos: { x, y }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
    sim.state.tick += 6;
    ui.update(sim.state);
  };
  return { sim, ui, sounds, move };
}

/** A straight path from home to a depth-1 sector nobody explored, in 80 u hops. */
function pathToFresh(explored: ReadonlySet<string>): { id: string; points: { x: number; y: number }[] } {
  const world = regionWorld(SEED);
  const visited = new Set([...explored].map((k) => world.field.regionOfChunk(...(k.split(',').map(Number) as [number, number])).id));
  const target = world.regions
    .filter((r) => r.seed.depth === 1 && !r.seed.origin && !visited.has(r.seed.id))
    .sort((a, b) => Math.hypot(a.seed.x, a.seed.y) - Math.hypot(b.seed.x, b.seed.y))[0]!;
  const n = Math.ceil(Math.hypot(target.seed.x, target.seed.y) / 80);
  return { id: target.seed.id, points: Array.from({ length: n }, (_, k) => ({ x: (target.seed.x * (k + 1)) / n, y: (target.seed.y * (k + 1)) / n })) };
}

describe('sectors in the flight HUD', () => {
  it('starts silently in the home sector with its badge', () => {
    const { ui, sounds, move, sim } = setup();
    move(10, 10);
    expect(ui.currentId).toBe(sectorIdAt(SEED, 0, 0));
    expect(ui.noticeData(sim.state)).toBeNull();
    expect(sounds).toEqual([]);
    const badge = ui.badge(sim.state)!;
    expect(badge.name).toBe('Počiatok');
    expect(badge.securityWord).toBe('Strážený');
    expect(badge.glyph).toBe('[x]');
    expect(badge.threat).toBe('hrozba: žiadni piráti');
  });

  it('a first visit gives the full notice with the radio, then it fades after 2.5 s', () => {
    const { ui, sounds, move, sim } = setup();
    move(0, 0);
    const path = pathToFresh(sim.state.world.explored);
    let seen: string[] = [];
    for (const p of path.points) {
      move(p.x, p.y);
      const n = ui.noticeData(sim.state);
      if (n && !seen.includes(n.name)) seen = [...seen, n.name];
    }
    expect(ui.currentId).toBe(path.id);
    const info = sectorInfo(SEED, path.id)!;
    expect(seen.length).toBeGreaterThan(0);
    expect(sounds.some(([, notice]) => notice)).toBe(true);
    expect(ui.badge(sim.state)!.id).toBe(info.id);
    sim.state.tick += 60 * 3;
    expect(ui.noticeData(sim.state)).toBeNull();
  });

  it('a tow or a respawn (a long jump) changes the sector silently', () => {
    const { ui, sounds, move, sim } = setup();
    move(0, 0);
    const path = pathToFresh(sim.state.world.explored);
    const far = path.points[path.points.length - 1]!;
    move(far.x, far.y);
    expect(ui.currentId).toBe(path.id);
    expect(ui.noticeData(sim.state)).toBeNull();
    expect(sounds).toEqual([]);
  });

  it('gives the radar the borders near the ship', () => {
    const { ui, move, sim } = setup();
    move(0, 0);
    const path = pathToFresh(sim.state.world.explored);
    for (const p of path.points) move(p.x, p.y);
    const radar = ui.radar(sim.state, 600)!;
    expect(radar.groups.length).toBeGreaterThan(0);
    expect(radar.groups.some((g) => g.adjacent && g.lines.length > 0)).toBe(true);
  });
});

describe('the radar arc on its lattice (O12)', () => {
  it('equals the borders sampled afresh at the snapped origin, keeps its groups while nothing changes', () => {
    const { ui, move, sim } = setup();
    move(0, 0);
    const path = pathToFresh(sim.state.world.explored);
    for (const p of path.points) move(p.x, p.y);
    const range = 600;
    const first = ui.radar(sim.state, range)!;
    // no refresh due: the same groups, the offset follows the ship
    move(sim.state.player.body.pos.x + 3, sim.state.player.body.pos.y);
    const shifted = ui.radar(sim.state, range)!;
    expect(shifted.groups).toBe(first.groups);
    // after the refresh interval: the borders as a cold sampling of the same lattice window gives them
    for (let i = 0; i < 6; i++) move(sim.state.player.body.pos.x + 40, sim.state.player.body.pos.y + 25);
    const radar = ui.radar(sim.state, range)!;
    const pos = sim.state.player.body.pos;
    const span = range * 1.15;
    const { step } = radarBorderGrid(span);
    const origin = { x: Math.round(pos.x / step) * step, y: Math.round(pos.y / step) * step };
    expect(radar.offset.x).toBeCloseTo(origin.x - pos.x, 9);
    expect(radar.offset.y).toBeCloseTo(origin.y - pos.y, 9);
    const field = regionWorld(SEED).field;
    const cold = radarBorders((x, y) => field.regionAt(x, y).id, origin, span, ui.currentId!);
    expect(radar.groups.map((g) => [g.adjacent, g.lines])).toEqual(cold.groups.map((g) => [g.adjacent, g.lines]));
    // unchanged ship pose and sector: the same groups again
    expect(ui.radar(sim.state, range)!.groups).toBe(radar.groups);
  });

  it('the badge is the same object until the language changes', () => {
    const { ui, move, sim } = setup();
    move(10, 10);
    const a = ui.badge(sim.state);
    move(12, 10);
    expect(ui.badge(sim.state)).toBe(a);
    setLocale('en');
    const b = ui.badge(sim.state)!;
    expect(b).not.toBe(a);
    expect(b.securityWord).toBe('Guarded');
    setLocale('sk');
  });
});

describe('sector entry radio and knowledge (stage 1b)', () => {
  it('the first entry into a sector with something to say goes on the radio instead of the tone', () => {
    const said: CommsMessage[][] = [];
    const { ui, sounds, move, sim } = setup((m) => (said.push(m), true));
    move(0, 0);
    const path = pathToFresh(sim.state.world.explored);
    for (const p of path.points) move(p.x, p.y);
    const security = ui.badge(sim.state)!.security;
    if (security === 'quiet') {
      // a Quiet sector has no radio line: the notice keeps its tone
      expect(sounds.some(([, notice]) => notice)).toBe(true);
    } else {
      expect(said.length).toBeGreaterThan(0);
      expect(said.flat().every((m) => m.key.startsWith('sector:'))).toBe(true);
      expect(said.flat()[0]!.lines[0]).toContain(ui.badge(sim.state)!.name);
    }
  });

  it('a radio that takes nothing (filtered or off) leaves the tone', () => {
    const { ui, sounds, move, sim } = setup(() => false);
    move(0, 0);
    const path = pathToFresh(sim.state.world.explored);
    for (const p of path.points) move(p.x, p.y);
    expect(ui.currentId).toBe(path.id);
    expect(sounds.some(([, notice]) => notice)).toBe(true);
  });

  it('knowledge and coverage come from the explored chunks; the map version changes when a sector is charted', () => {
    const { ui, move, sim } = setup();
    move(0, 0);
    const world = regionWorld(SEED);
    const explored = sim.state.world.explored;
    const visited = new Set([...explored].map((k) => world.field.regionOfChunk(...(k.split(',').map(Number) as [number, number])).id));
    const id = world.regions.find((r) => r.seed.depth === 1 && !visited.has(r.seed.id) && world.startKnowledge.get(r.seed.id) !== 'charted')!.seed.id;
    const before = ui.map(sim.state).version;
    expect(ui.coverage(sim.state, id)).toBe(0);
    expect(ui.knowledge(sim.state, id)).not.toBe('charted');
    // explore every chunk of the sector (as if flown through)
    for (let cx = -60; cx <= 60; cx++) for (let cy = -60; cy <= 60; cy++) if (world.field.regionOfChunk(cx, cy).id === id) explored.add(`${cx},${cy}`);
    expect(ui.coverage(sim.state, id)).toBe(1);
    expect(ui.knowledge(sim.state, id)).toBe('charted');
    expect(ui.map(sim.state).version).not.toBe(before);
    expect(ui.map(sim.state).coverage!(id)).toBe(1);
  });
});
