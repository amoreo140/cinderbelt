import { describe, expect, it } from 'vitest';
import { BOARD_MAX_OFFERS, BOARD_MIN_OFFERS, SURVEY_BUOYS } from '../../data/contracts';
import { unlocksUpTo, type RepUnlock } from '../../data/factions';
import { spawnSlots } from '../combat/enemies';
import { homeStation } from '../world/stations';
import { generateBoard, generateOffer, huntRisk, typeUnlocked, type BoardContext } from './generate';

const unlocks = (guild: 0 | 1 | 2 | 3, institute: 0 | 1 | 2 | 3 = 0): Set<RepUnlock> =>
  new Set([...unlocksUpTo('guild', guild), ...unlocksUpTo('institute', institute)]);

const ctx = (patch: Partial<BoardContext> = {}): BoardContext => ({
  seed: 1337,
  station: homeStation(),
  epoch: 3,
  tick: 3 * 72_000,
  unlocks: unlocks(0),
  density: 'normal',
  captains: [],
  ...patch,
});

describe('typeUnlocked', () => {
  it('follows the reputation unlocks per ring', () => {
    expect(typeUnlocked(unlocks(0), 'delivery', 1)).toBe(true);
    expect(typeUnlocked(unlocks(0), 'delivery', 2)).toBe(false);
    expect(typeUnlocked(unlocks(0), 'rescue', 1)).toBe(false);
    expect(typeUnlocked(unlocks(1), 'rescue', 1)).toBe(true);
    expect(typeUnlocked(unlocks(2), 'hunt', 2)).toBe(true);
    expect(typeUnlocked(unlocks(3), 'scan', 1)).toBe(false);
    expect(typeUnlocked(unlocks(0, 0), 'survey', 1)).toBe(true);
    expect(typeUnlocked(unlocks(0, 0), 'survey', 2)).toBe(false);
  });
});

describe('generateBoard', () => {
  it('is deterministic for seed, station and epoch', () => {
    expect(generateBoard(ctx())).toEqual(generateBoard(ctx()));
    expect(generateBoard(ctx({ epoch: 4 }))).not.toEqual(generateBoard(ctx()));
    expect(generateBoard(ctx({ seed: 9 }))).not.toEqual(generateBoard(ctx()));
  });

  it('offers 4–6 slips at level 0 with only unlocked types', () => {
    for (let epoch = 1; epoch < 30; epoch++) {
      const board = generateBoard(ctx({ epoch }));
      expect(board.offers.length).toBeGreaterThanOrEqual(BOARD_MIN_OFFERS - 1);
      expect(board.offers.length).toBeLessThanOrEqual(BOARD_MAX_OFFERS);
      expect(board.serial).toBeGreaterThanOrEqual(board.offers.length);
      for (const o of board.offers) {
        expect(['delivery', 'mining', 'survey']).toContain(o.type);
        expect(o.station).toBe('home');
        expect(o.id.startsWith(`home@${epoch}.`)).toBe(true);
        expect(o.ring).toBe(1);
      }
    }
  });

  it('builds sensible targets for every type', () => {
    const seen = new Set<string>();
    for (let epoch = 1; epoch < 80; epoch++) {
      for (const o of generateBoard(ctx({ epoch, unlocks: unlocks(2, 1) })).offers) {
        seen.add(o.type);
        const t = o.target;
        if (t.kind === 'delivery') {
          expect(t.to).not.toBe('home');
          expect(t.amount % 5).toBe(0);
          expect(t.amount).toBeGreaterThan(0);
        } else if (t.kind === 'mining') {
          expect(t.amount).toBeGreaterThan(0);
        } else if (t.kind === 'rescue') {
          expect(t.fuel).toBeGreaterThan(0);
          expect(Math.hypot(t.pos.x, t.pos.y)).toBeGreaterThan(200);
        } else if (t.kind === 'survey') {
          expect(t.points).toHaveLength(SURVEY_BUOYS);
        } else if (t.kind === 'scan') {
          expect(o.faction).toBe('institute');
          expect(t.poi.startsWith(`${t.what}:`)).toBe(true);
        } else if (t.kind === 'hunt') {
          expect(o.ring).toBe(2);
          expect(spawnSlots(1337, t.cx, t.cy, 'normal').map((s) => s.id)).toEqual(t.slots);
          expect(o.risk).toBeGreaterThan(0);
        } else if (t.kind === 'escort') {
          // M4d T6: home lies on the Guild Lanes – an escort along one of them
          expect(t.to - t.from).toBeGreaterThanOrEqual(2000);
          expect(t.ambushes).toHaveLength(o.risk === 0.5 ? 2 : 1);
        }
        if (o.part) expect(o.ring).toBe(1);
      }
    }
    expect(seen).toEqual(new Set(['delivery', 'mining', 'rescue', 'survey', 'hunt', 'scan', 'escort']));
  });

  it('captain hunts appear only with the guild captain license', () => {
    const captains = [{ index: 4, ring: 2 as const }];
    let found = 0;
    for (let epoch = 1; epoch < 60; epoch++) {
      for (const o of generateBoard(ctx({ epoch, unlocks: unlocks(3), captains })).offers) {
        if (o.target.kind === 'captain') {
          found++;
          expect(o.target.captain).toBe(4);
          expect(o.risk).toBe(0.5);
        }
      }
      for (const o of generateBoard(ctx({ epoch, unlocks: unlocks(2), captains })).offers) expect(o.target.kind).not.toBe('captain');
    }
    expect(found).toBeGreaterThan(0);
  });

  it('a single offer is reproducible from its serial (refill after completion)', () => {
    const board = generateBoard(ctx());
    const first = board.offers[0]!;
    const serial = Number(first.id.split('.').pop());
    expect(generateOffer(ctx(), serial)).toEqual(first);
  });
});

describe('revenge', () => {
  it('a captain who destroyed the player is hunted more often', () => {
    const captains = [
      { index: 1, ring: 2 as const },
      { index: 2, ring: 2 as const },
      { index: 3, ring: 2 as const, grudge: true },
      { index: 4, ring: 2 as const },
    ];
    const count = { grudge: 0, other: 0 };
    for (let epoch = 1; epoch < 300; epoch++) {
      for (const o of generateBoard(ctx({ epoch, unlocks: unlocks(3), captains })).offers) {
        if (o.target.kind !== 'captain') continue;
        if (o.target.captain === 3) count.grudge++;
        else count.other++;
      }
    }
    // without revenge it would have 1/4 of the hunts – with revenge more than half
    expect(count.grudge).toBeGreaterThan(count.other);
  });
});

describe('hunt risk (M4b)', () => {
  it('a Gunner-led group is as dangerous as a Hammer-led one', () => {
    expect(huntRisk([{ kind: 'hammer' }, { kind: 'jackal' }])).toBe(0.5);
    expect(huntRisk([{ kind: 'gunner' }, { kind: 'jackal' }])).toBe(0.5);
    expect(huntRisk([{ kind: 'jackal' }, { kind: 'jackal' }])).toBe(0.25);
    // real depth-3 groups whose leader the Gunner roll replaced (a Hammer or a Jackal before)
    let found = 0;
    for (let cx = 20; cx <= 40 && found < 4; cx++) {
      for (let cy = -40; cy <= 40 && found < 4; cy++) {
        const slots = spawnSlots(1337, cx, cy, 'normal');
        if (slots[0]?.kind !== 'gunner') continue;
        found++;
        expect(slots[0].baseKind).toBeDefined();
        expect(huntRisk(slots)).toBe(0.5);
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
