// M4d data: the convoy ship circles are a copy of the art export, the tanker keeps clear of the trader,
// and the Guild relay mast has the derelict relay's frame (relays.ts charges it unchanged).
import { describe, expect, it } from 'vitest';
import { CONVOY, CONVOY_SHAPES, ESCORT } from './convoys';
import { GUILD_RELAY_LAYOUT, RELAY_CHAIN, WATCH } from './guild';
import { NOTE_ICONS, NOTES } from './navigation';
import { RELAY_LAYOUT } from './sites';
import { CONTRACT_DEFS, PLAYABLE_CONTRACT_TYPES } from './contracts';
import { ACTIVE_SECTOR_MODIFIERS, SECTOR_MODIFIERS } from './sector';
import { EVENT_DEFS } from './events';
import { archiveNode } from './archive';
import { REP_LEVELS } from './factions';

describe('convoy data', () => {
  it('matches the collision circles exported by the artist (public/assets/models/npc/npc_ships.json)', () => {
    const sources = import.meta.glob('../../public/assets/models/npc/npc_ships.json', { eager: true, import: 'default' });
    const art = Object.values(sources)[0] as { collision: Record<string, { circles: { x: number; y: number; r: number }[]; tradePort?: { x: number; y: number } }> } | undefined;
    if (!art) return; // a package without the assets
    for (const kind of ['trader', 'tanker'] as const) {
      expect(CONVOY_SHAPES[kind].circles).toEqual(art.collision[kind]!.circles);
    }
    expect(CONVOY_SHAPES.trader.tradePort).toEqual(art.collision.trader!.tradePort);
  });

  it('flies the tanker clear of the trader (≥ 14.3 u needed, 16 u used)', () => {
    const rear = Math.min(...CONVOY_SHAPES.trader.circles.map((c) => c.x - c.r));
    const front = Math.max(...CONVOY_SHAPES.tanker.circles.map((c) => c.x + c.r));
    expect(front - rear).toBeLessThan(CONVOY.tankerGap);
    expect(CONVOY.tankerGap).toBe(16);
  });

  it('puts the trade port on the port (left) side of the trader, outside its hull circles', () => {
    const port = CONVOY_SHAPES.trader.tradePort!;
    expect(port.y).toBeGreaterThan(0);
    expect(CONVOY_SHAPES.trader.radius).toBeGreaterThan(Math.hypot(port.x, port.y));
    expect(CONVOY_SHAPES.cutter.radius).toBe(WATCH.ships.cutter.radius);
  });

  it('keeps the escort numbers consistent', () => {
    expect(ESCORT.segment[0]).toBeLessThan(ESCORT.segment[1]);
    expect(ESCORT.ambushSpacing).toBeLessThan(ESCORT.segment[0]);
    expect(ESCORT.deposit).toBeGreaterThan(0);
  });
});

describe('Guild and navigation data', () => {
  it('the Guild relay mast has the derelict relay frame (circles, receiver)', () => {
    expect(GUILD_RELAY_LAYOUT.circles).toEqual(RELAY_LAYOUT.circles);
    expect(GUILD_RELAY_LAYOUT.powerTarget).toEqual(RELAY_LAYOUT.powerTarget);
  });

  it('every Watch gun reaches farther than its ship orbits a target', () => {
    for (const def of Object.values(WATCH.ships)) for (const g of def.guns) expect(g.range).toBeGreaterThan(def.orbit);
    expect(RELAY_CHAIN.rearmRadius).toBeLessThan(RELAY_CHAIN.holdRadius);
  });

  it('has five note icons and the note limits', () => {
    expect(NOTE_ICONS).toHaveLength(5);
    expect(NOTES).toMatchObject({ max: 30, textMax: 40 });
  });
});

describe('M4d data hooks', () => {
  it('escort is playable and rolled, the Guild relay only pinned', () => {
    expect(PLAYABLE_CONTRACT_TYPES).toContain('escort');
    expect(CONTRACT_DEFS.escort.weight).toBeGreaterThan(0);
    expect(CONTRACT_DEFS.relay.weight).toBe(0);
    expect(CONTRACT_DEFS.relay.unlock[2]).toBe('guildRelay');
    expect(REP_LEVELS.guild[2].unlocks).toContain('guildRelay');
  });

  it('the convoy local condition is derived (never rolled) and the convoy flyby a derived event', () => {
    expect(SECTOR_MODIFIERS.convoy.derived).toBe(true);
    expect(SECTOR_MODIFIERS.convoy.since).toBeUndefined();
    expect(ACTIVE_SECTOR_MODIFIERS).not.toContain('convoy');
    expect(EVENT_DEFS.convoyFlyby.mode).toBe('derived');
  });

  it('the map notes Archive node is buyable now', () => {
    expect(archiveNode('mapNotes').since).toBeUndefined();
    expect(archiveNode('mapNotes').unlock).toEqual({ kind: 'feature', feature: 'mapNotes' });
  });
});
