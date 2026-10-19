// Save V20 (M4d "Guild and Trade"): the Guild (relay chain, the hold, live Watch ships), convoys (trades, the
// link, escort convoys) and map notes – the 19 → 20 migration, the round trip, the career's new targets and
// log entry (the Guild relay slip a V19 game could not save), the validation (each bad case rejected) and
// the repairs of what does not match the seed, the tick or the tunable data.
import { describe, expect, it } from 'vitest';
import { CONVOY, ESCORT } from '../../data/convoys';
import { WATCH } from '../../data/guild';
import { IDLE_COMMAND } from '../commands';
import { boardEpoch, currentBoard } from '../contracts/board';
import { escortDepositOf } from '../convoys/escort';
import { convoyPassWindow } from '../convoys/schedule';
import { createGuild } from '../guild/state';
import { guildRelaySite } from '../guild/relaySites';
import { fnv1aHex } from '../math/fnv1a';
import { createNavigation } from '../navigation/state';
import { sectorIdAt } from '../regions/sectors';
import { Simulation } from '../Simulation';
import { createConvoys } from '../convoys/state';
import { escortGame, linkedGame, relayHoldGame, rideEscort, stepHold, watchFightGame } from './guildTesting';
import { loadSave } from './load';
import { v19ToV20 } from './migrations';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { downgradeToV19, testContext } from './testing';
import type { SaveEnvelope, SaveGame } from './types';

const ctx = testContext();
const TICKS = 60;

function envelopeOf(data: unknown): SaveEnvelope {
  const text = JSON.stringify(data);
  return { format: 'cinderbelt-save', version: (data as { version: number }).version, checksum: fnv1aHex(text), data: text };
}

function loaded(data: unknown) {
  const result = loadSave(envelopeOf(data));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  return result;
}

const edited = (save: SaveGame, change: (s: Record<string, any>) => void): SaveGame => {
  const copy = structuredClone(save) as unknown as Record<string, any>;
  change(copy);
  return copy as unknown as SaveGame;
};

const repairedPaths = (warnings: readonly { code: string }[]): string[] =>
  (warnings.find((w) => w.code === 'sitesRepaired') as { paths: string[] } | undefined)?.paths ?? [];
const clampedPaths = (warnings: readonly { code: string }[]): string[] =>
  (warnings.find((w) => w.code === 'capacityClamped') as { paths: string[] } | undefined)?.paths ?? [];

/** The relay hold in its fight (seed 1): the Guild reinforcement live, the counterattack spawned; two map notes. */
function holdFight(): Simulation {
  const { sim } = relayHoldGame();
  const n = (6 + 25 + 4) * TICKS;
  for (let i = 0; i < n; i++) stepHold(sim);
  const g = sim.state.guild;
  if (g.hold?.phase !== 'fight' || !g.watch.length) throw new Error('no hold fight');
  g.lost.set('gw:lane:A:0|1', sim.state.tick - 100);
  sim.state.navigation = {
    notes: [
      { id: 2, pos: { x: 120.5, y: -40 }, icon: 'ore', text: 'Bohatá meď' },
      { id: 5, pos: { x: -3000, y: 2210.25 }, icon: 'pirate', text: 'Piráti – pozor!' },
    ],
    nextNote: 7,
  };
  return sim;
}

/** Linked (seed 3) after a bought item, sold iron and bought fuel. */
function linkTrade(): Simulation {
  const sim = linkedGame();
  sim.state.player.fuel = sim.state.player.props.fuelCapacity / 2;
  for (const action of [{ type: 'convoyBuy', slot: 0 }, { type: 'convoySell', resource: 'iron', qty: 30 }, { type: 'convoyFuel', amount: 5 }] as const) {
    sim.step({ ...IDLE_COMMAND, actions: [{ ...action, reqId: 1 }] });
  }
  return sim;
}

/** An escort under way (seed 11), 300 steps after the departure. */
function escortUnderWay(): { sim: Simulation; serial: number } {
  const { sim, contract } = escortGame();
  for (let i = 0; i < 300; i++) rideEscort(sim, contract.serial);
  return { sim, serial: contract.serial };
}

const roundTrip = (sim: Simulation): Simulation => restoreSimulation(loaded(toSave(sim, ctx)).save);

describe('save V20 – migration 19 → 20', () => {
  it('adds the M4d defaults and nothing else', () => {
    const save = toSave(new Simulation({ seed: 5 }), ctx);
    const old = downgradeToV19(save);
    expect(old.version).toBe(19);
    expect('guild' in old || 'convoys' in old || 'navigation' in old).toBe(false);
    expect(v19ToV20(old)).toEqual(save);
    expect(save.guild).toEqual({ relays: [], hold: null, watch: [], lost: [], lastRadio: -1e9 });
    expect(save.convoys).toEqual({ trades: [], link: null, escorts: [] });
    expect(save.navigation).toEqual({ notes: [], nextNote: 1 });
    const restored = restoreSimulation(loaded(old).save);
    expect(restored.state.guild).toEqual(createGuild());
    expect(restored.state.convoys).toEqual(createConvoys());
    expect(restored.state.navigation).toEqual(createNavigation());
  });

  it('rejects data that is not a version 19 save', () => {
    expect(() => v19ToV20(null)).toThrow();
    expect(() => v19ToV20([1])).toThrow();
  });
});

describe('save V20 – the Guild relay slip and the escort contract (career targets, log)', () => {
  /** Guild level 2, docked at home (seed 77): the home board pins a Guild relay slip. */
  function relaySlipGame(): Simulation {
    const sim = new Simulation({ seed: 77 });
    sim.state.career.rep.guild = { points: 260, level: 2, assignments: {} };
    sim.step(IDLE_COMMAND);
    return sim;
  }

  it('regression (M4d T2): a game at Guild level 2 near a relay site saves a board relay slip that loads', () => {
    const sim = relaySlipGame();
    const board = sim.state.career.boards.get('home')!;
    const slip = board.offers.find((o) => o.type === 'relay');
    expect(slip?.target).toMatchObject({ kind: 'relay', relay: `gr:${slip!.target.kind === 'relay' ? slip!.target.lane : ''}` });
    const result = loaded(toSave(sim, ctx));
    expect(result.warnings).toEqual([]);
    expect(result.save.career.boards.find(([id]) => id === 'home')![1].offers).toEqual(board.offers);
    // the same game written by a V19 build loads through the migration
    expect(loaded(downgradeToV19(toSave(sim, ctx)))).toMatchObject({ ok: true, fromVersion: 19, warnings: [] });
  });

  it('an accepted relay contract and a failed contract in the log survive save and load', () => {
    const sim = relaySlipGame();
    const slip = currentBoard(sim.state, sim.station('home')!).offers.find((o) => o.type === 'relay')!;
    sim.step({ ...IDLE_COMMAND, actions: [{ type: 'acceptContract', offerId: slip.id, reqId: 1 }] });
    const contract = sim.state.career.contracts.find((c) => c.id === slip.id);
    expect(contract?.target.kind).toBe('relay');
    sim.state.career.log.push({ tick: sim.state.tick, kind: 'contractFailed', type: 'escort', station: 'home' });
    const back = roundTrip(sim);
    expect(back.state.career.contracts).toEqual(sim.state.career.contracts);
    expect(back.state.career.log.at(-1)).toEqual({ tick: sim.state.tick, kind: 'contractFailed', type: 'escort', station: 'home' });
    expect(toSave(back, ctx)).toEqual(toSave(sim, ctx));
  });

  it('an accepted escort contract, its convoy and the deposit survive save and load', () => {
    const { sim, serial } = escortUnderWay();
    const e = sim.state.convoys.escorts.get(serial)!;
    expect(e).toMatchObject({ state: 'moving' });
    expect(e.deposit).toBeGreaterThan(0);
    const back = roundTrip(sim);
    expect(back.state.convoys.escorts.get(serial)).toEqual(e);
    expect(back.state.career.contracts).toEqual(sim.state.career.contracts);
  });
});

describe('save V20 – round trip', () => {
  const withoutPrev = (sim: Simulation) => sim.state.guild.watch.map(({ prevBody: _p, ...w }) => w);

  it('the relay hold, the live Watch ships, the lost ids, the radio and the map notes; the save is canonical', () => {
    const sim = holdFight();
    const save = toSave(sim, ctx);
    expect(save.version).toBe(20);
    expect(save.guild.relays).toEqual([['A', { stage: 'powered', sector: guildRelaySite(1, 'A')!.sector, tick: expect.any(Number) }]]);
    expect(save.guild.hold).toMatchObject({ lane: 'A', phase: 'fight', reinforced: true });
    expect(save.sites.powered).toContain('gr:A');
    expect(save.combat.enemies.some((e) => e.id.startsWith('rc:A:'))).toBe(true);
    expect(save.navigation.notes.map((n) => [n.id, n.icon])).toEqual([[2, 'ore'], [5, 'pirate']]);
    const back = roundTrip(sim);
    expect(withoutPrev(back)).toEqual(withoutPrev(sim));
    for (const w of back.state.guild.watch) expect(w.prevBody).toEqual(w.body);
    expect({ ...back.state.guild, watch: [] }).toEqual({ ...sim.state.guild, watch: [] });
    expect(back.state.navigation).toEqual(sim.state.navigation);
    expect(JSON.stringify(toSave(back, ctx))).toBe(JSON.stringify(save));
  });

  it('the first-contact memory of the radio (T10): the Watch radio tick and the convoy flyby keys of the director', () => {
    const sim = new Simulation({ seed: 3, startDocked: false });
    sim.state.guild.lastRadio = 1234;
    sim.state.director.fired.set('ev:convoy:cv:A@1', 900);
    sim.state.director.fired.set('ev:convoy:cv:B@0', 800);
    sim.state.tick = 2000;
    const { save, warnings } = loaded(toSave(sim, ctx));
    expect(warnings).toEqual([]);
    expect(save.guild.lastRadio).toBe(1234);
    expect(save.director.fired).toEqual([['ev:convoy:cv:A@1', 900], ['ev:convoy:cv:B@0', 800]]);
    const back = restoreSimulation(save);
    expect(back.state.guild.lastRadio).toBe(1234);
    expect([...back.state.director.fired.keys()].filter((k) => k.startsWith('ev:convoy:')).sort()).toEqual(['ev:convoy:cv:A@1', 'ev:convoy:cv:B@0']);
    // a radio tick of "never" stays "never"
    expect(loaded(toSave(new Simulation({ seed: 3 }), ctx)).save.guild.lastRadio).toBe(-1e9);
  });

  it('a Watch fight: every field of a live ship but prevBody', () => {
    const sim = watchFightGame();
    for (let i = 0; i < 240; i++) sim.step(IDLE_COMMAND);
    expect(sim.state.guild.watch.some((w) => w.mode === 'engage')).toBe(true);
    const save = toSave(sim, ctx);
    expect(Object.keys(save.guild.watch[0]!).sort()).toEqual(['body', 'cooldowns', 'hull', 'id', 'kind', 'lastHitBy', 'mode', 'modeTick', 'route', 'shield', 'shieldDelay', 'slot', 'target']);
    expect(withoutPrev(roundTrip(sim))).toEqual(withoutPrev(sim));
  });

  it('a link and its trade: the link pins the ship again after the load', () => {
    const sim = linkTrade();
    const back = roundTrip(sim);
    expect(back.state.convoys).toEqual(sim.state.convoys);
    const pass = sim.state.convoys.link!.pass;
    expect(sim.state.convoys.trades.get(pass)).toEqual({ bought: 1, sold: 30, fuel: 5 });
    for (let i = 0; i < 30; i++) {
      sim.step(IDLE_COMMAND);
      back.step(IDLE_COMMAND);
    }
    expect(back.state.convoys.link?.pass).toBe(pass);
    expect(back.state.player.body).toEqual(sim.state.player.body);
  });
});

describe('save V20 – rejects malformed data', () => {
  const hold = toSave(holdFight(), ctx);
  const link = toSave(linkTrade(), ctx);
  const escort = toSave(escortUnderWay().sim, ctx);
  const cases: [string, SaveGame, (s: Record<string, any>) => void][] = [
    ['missing guild', hold, (s) => delete s.guild],
    ['missing convoys', hold, (s) => delete s.convoys],
    ['missing navigation', hold, (s) => delete s.navigation],
    ['an unknown relay lane', hold, (s) => (s.guild.relays[0][0] = 'C')],
    ['a duplicate relay lane', hold, (s) => s.guild.relays.push(s.guild.relays[0])],
    ['an unknown relay stage', hold, (s) => (s.guild.relays[0][1].stage = 'broken')],
    ['a fractional relay tick', hold, (s) => (s.guild.relays[0][1].tick = 1.5)],
    ['an unknown hold phase', hold, (s) => (s.guild.hold.phase = 'over')],
    ['a hold without `reinforced`', hold, (s) => delete s.guild.hold.reinforced],
    ['a Watch id that is not its route and slot', hold, (s) => (s.guild.watch[0].slot += 1)],
    ['a Watch id without the prefix', hold, (s) => (s.guild.watch[0].id = s.guild.watch[0].id.slice(3))],
    ['an unknown Watch route', hold, (s) => ((s.guild.watch[0].route = 'moon:1'), (s.guild.watch[0].id = 'gw:moon:1|0'), (s.guild.watch[0].slot = 0))],
    ['an unknown Watch kind', hold, (s) => (s.guild.watch[0].kind = 'battleship')],
    ['an unknown Watch mode', hold, (s) => (s.guild.watch[0].mode = 'hostile')],
    ['a Watch body that is not a number', hold, (s) => (s.guild.watch[0].body.pos.x = 'far')],
    ['a negative Watch hull', hold, (s) => (s.guild.watch[0].hull = -1)],
    ['a duplicate Watch ship', hold, (s) => s.guild.watch.push(s.guild.watch[0])],
    ['too many Watch ships', hold, (s) => (s.guild.watch = Array.from({ length: 17 }, (_, i) => ({ ...s.guild.watch[0], id: `gw:lane:A:0|${i}`, route: 'lane:A:0', slot: i })))],
    ['a lost id that is not a Watch id', hold, (s) => (s.guild.lost[0][0] = 'rc:A:0')],
    ['a duplicate lost id', hold, (s) => s.guild.lost.push(s.guild.lost[0])],
    ['a fractional radio tick', hold, (s) => (s.guild.lastRadio = 0.5)],
    ['a malformed pass id', link, (s) => (s.convoys.trades[0][0] = 'cv:C@1')],
    ['a duplicate trade', link, (s) => s.convoys.trades.push(s.convoys.trades[0])],
    ['a fractional bought mask', link, (s) => (s.convoys.trades[0][1].bought = 0.5)],
    ['a negative sale', link, (s) => (s.convoys.trades[0][1].sold = -1)],
    ['a malformed link', link, (s) => (s.convoys.link = { pass: 'cv:A@x', since: 0 })],
    ['an unknown escort state', escort, (s) => (s.convoys.escorts[0][1].state = 'lost')],
    ['an escort with three hulls', escort, (s) => s.convoys.escorts[0][1].hulls.push(1, 1)],
    ['an escort without a deposit', escort, (s) => delete s.convoys.escorts[0][1].deposit],
    ['a duplicate escort serial', escort, (s) => s.convoys.escorts.push(s.convoys.escorts[0])],
    ['more than 30 notes', hold, (s) => (s.navigation.notes = Array.from({ length: 31 }, (_, i) => ({ id: i + 1, x: 0, y: 0, icon: 'star', text: 'x' }))) && (s.navigation.nextNote = 40)],
    ['a duplicate note id', hold, (s) => (s.navigation.notes[1].id = s.navigation.notes[0].id)],
    ['a note id at nextNote', hold, (s) => (s.navigation.notes[1].id = s.navigation.nextNote)],
    ['an unknown note icon', hold, (s) => (s.navigation.notes[0].icon = 'skull')],
    ['a note position that is not a number', hold, (s) => (s.navigation.notes[0].x = null)],
    ['an empty note', hold, (s) => (s.navigation.notes[0].text = '')],
    ['a note with a line break', hold, (s) => (s.navigation.notes[0].text = 'a\nb')],
    ['a note with a bidi override', hold, (s) => (s.navigation.notes[0].text = 'a‮b')],
    ['an untrimmed note', hold, (s) => (s.navigation.notes[0].text = ' meď')],
    ['a note over 40 characters', hold, (s) => (s.navigation.notes[0].text = 'ž'.repeat(41))],
    ['a relay target of another mast', hold, (s) => (s.career.contracts.find((c: any) => c.type === 'relay').target.relay = 'gr:B')],
    ['an escort target that ends before it starts', escort, (s) => (s.career.contracts[0].target.to = s.career.contracts[0].target.from)],
    ['an escort ambush outside the stretch', escort, (s) => s.career.contracts[0].target.ambushes.push(s.career.contracts[0].target.to + 1)],
    ['an unknown log kind', hold, (s) => s.career.log.push({ tick: 0, kind: 'contractLost', type: 'escort', station: 'home' })],
  ];
  it.each(cases)('%s', (_name, base, change) => {
    expect(loadSave(envelopeOf(edited(base, change)))).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('a note of exactly 40 characters (code points) and every icon are fine', () => {
    const ok = edited(hold, (s) => {
      s.navigation.notes[0].text = '🚀'.repeat(40);
      s.navigation.notes[1].icon = 'flag';
    });
    expect(loaded(ok).warnings).toEqual([]);
  });
});

describe('save V20 – repairs what does not match the seed, the tick or the data (with a warning)', () => {
  const holdSim = holdFight();
  const hold = toSave(holdSim, ctx);
  const link = toSave(linkTrade(), ctx);
  const esc = escortUnderWay();
  const escort = toSave(esc.sim, ctx);
  const repaired = (base: SaveGame, change: (s: Record<string, any>) => void) => {
    const { save, warnings } = loaded(edited(base, change));
    return { save, paths: repairedPaths(warnings), clamped: clampedPaths(warnings) };
  };

  it('Watch numbers above the ship data are clamped, a cooldown list follows the guns', () => {
    const def = WATCH.ships[hold.guild.watch[0]!.kind];
    const { save, clamped } = repaired(hold, (s) => {
      s.guild.watch[0].hull = def.hull * 3;
      s.guild.watch[0].shield = def.shield + 1;
      s.guild.watch[0].cooldowns = [99];
    });
    const w = save.guild.watch[0]!;
    expect([w.hull, w.shield]).toEqual([def.hull, def.shield]);
    expect(w.cooldowns).toEqual([1 / def.guns[0]!.rate, 0]);
    expect(clamped).toEqual(['guild.watch[0].cooldowns', 'guild.watch[0].cooldowns[0]', 'guild.watch[0].hull', 'guild.watch[0].shield']);
  });

  it('a relay record of a sector that does not exist or is not Contested is dropped (and its hold ends)', () => {
    for (const sector of ['rg:A:999,999', sectorIdAt(1, 0, 0)]) {
      const { save, paths } = repaired(hold, (s) => {
        s.guild.relays[0][1].sector = sector;
        s.sites.powered = s.sites.powered.filter((id: string) => id !== 'gr:A');
      });
      expect(save.guild.relays).toEqual([]);
      expect(save.guild.hold).toBeNull();
      expect(paths).toEqual(['guild.relays[0]', 'guild.hold']);
      // with the mast still lit the lane starts over as powered in the site's sector (the hold goes on)
      const lit = repaired(hold, (s) => (s.guild.relays[0][1].sector = sector));
      expect(lit.save.guild.relays).toEqual([['A', { stage: 'powered', sector: guildRelaySite(1, 'A')!.sector, tick: hold.tick }]]);
      expect(lit.save.guild.hold).toEqual(hold.guild.hold);
      expect(lit.paths).toEqual(['guild.relays[0]', 'guild.relays.A']);
    }
  });

  it('a lit relay of a lane without a site is dropped; a relay slip of such a lane leaves the board', () => {
    let seed = 1;
    while (guildRelaySite(seed, 'B') !== null) seed++;
    const sim = new Simulation({ seed });
    sim.step(IDLE_COMMAND);
    const base = toSave(sim, ctx);
    const { save, paths } = repaired(base, (s) => {
      s.sites.powered = ['gr:B'];
      s.guild.relays = [['B', { stage: 'secured', sector: 'x', tick: 0 }]];
      s.career.boards[0][1].offers.push({ ...structuredClone(hold.career.contracts.find((c) => c.type === 'relay')!), id: 'home@0.relay', target: { kind: 'relay', lane: 'B', relay: 'gr:B', sector: 'x', pos: { x: 0, y: 0 } } });
    });
    expect(save.sites.powered).toEqual([]);
    expect(save.guild.relays).toEqual([]);
    expect(save.career.boards[0]![1].offers.some((o) => o.type === 'relay')).toBe(false);
    expect(paths).toEqual(['sites.powered', 'guild.relays[0]', 'career.boards[0].offers']);
  });

  it('a secured lane lights its mast; a lit mast without a record becomes powered; a hold of a lane not powered ends', () => {
    const secured = repaired(hold, (s) => {
      s.guild.relays[0][1].stage = 'secured';
      s.sites.powered = s.sites.powered.filter((id: string) => id !== 'gr:A');
    });
    expect(secured.save.sites.powered).toContain('gr:A');
    expect(secured.save.guild.hold).toBeNull();
    expect(secured.paths).toEqual(['sites.powered', 'guild.hold']);
    const lit = repaired(hold, (s) => (s.guild.relays = []));
    expect(lit.save.guild.relays).toEqual([['A', { stage: 'powered', sector: guildRelaySite(1, 'A')!.sector, tick: hold.tick }]]);
    expect(lit.save.guild.hold).toEqual(hold.guild.hold);
    expect(lit.paths).toEqual(['guild.relays.A']);
  });

  it('ticks in the future are cut to the save tick', () => {
    const { save, paths } = repaired(hold, (s) => {
      s.guild.lost[0][1] = s.tick + 99;
      s.guild.lastRadio = s.tick + 1;
      s.guild.relays[0][1].tick = s.tick + 5;
      s.guild.watch[0].modeTick = s.tick + 2;
    });
    expect(save.guild.lost[0]![1]).toBe(hold.tick);
    expect(save.guild.lastRadio).toBe(hold.tick);
    expect(save.guild.relays[0]![1].tick).toBe(hold.tick);
    expect(save.guild.watch[0]!.modeTick).toBe(hold.tick);
    expect(paths).toEqual(['guild.relays[0].tick', 'guild.watch[0]', 'guild.lost[0]', 'guild.lastRadio']);
  });

  it('counterattack and escort ambush ids that do not fit are dropped', () => {
    const { save, paths } = repaired(hold, (s) => {
      s.combat.enemies[0].id = 'rc:A:7';
      s.combat.enemies[1].id = 'ea:1:x';
    });
    expect(save.combat.enemies.length).toBe(hold.combat.enemies.length - 2);
    expect(paths).toEqual(['combat.enemies[0]', 'combat.enemies[1]']);
  });

  it('a trade of a pass that is over or not on the schedule is dropped, its mask cut to the slots, the sale clamped', () => {
    const pass = link.convoys.trades[0]![0];
    // over, not departed yet, not a lane of this seed's schedule
    const over = repaired(link, (s) => s.convoys.trades.push(['cv:A@0', { bought: 1, sold: 0, fuel: 0 }], ['cv:B@999999', { bought: 1, sold: 0, fuel: 0 }]));
    expect(convoyPassWindow(link.seed, 'cv:A@0')!.end).toBeLessThanOrEqual(link.tick);
    expect(over.save.convoys.trades.map(([p]) => p)).toEqual([pass]);
    expect(over.paths).toEqual(['convoys.trades[0]', 'convoys.trades[2]']);
    const cut = repaired(link, (s) => ((s.convoys.trades[0][1].bought = 0xff), (s.convoys.trades[0][1].sold = 999)));
    expect(cut.save.convoys.trades[0]![1]).toMatchObject({ bought: (1 << CONVOY.slots) - 1, sold: CONVOY.buyCap });
    expect(cut.paths).toEqual(['convoys.trades[0].bought']);
    expect(cut.clamped).toEqual(['convoys.trades[0][1].sold']);
  });

  it('a link stays only for a pass in flight at the save tick while the ship flies', () => {
    expect(loaded(link).save.convoys.link).toEqual(link.convoys.link);
    for (const change of [
      (s: Record<string, any>) => (s.convoys.link.pass = 'cv:A@0'),
      (s: Record<string, any>) => (s.player.dockedAt = 'home'),
      (s: Record<string, any>) => (s.player.destroyed = true),
      (s: Record<string, any>) => (s.convoys.link.since = s.tick + 1),
    ]) {
      const { save, paths } = repaired(link, change);
      expect(save.convoys.link).toBeNull();
      expect(paths).toContain('convoys.link');
    }
  });

  it('an escort convoy stays only for its active contract; its hulls follow the ships and the data, its numbers the stretch', () => {
    const gone = repaired(escort, (s) => (s.convoys.escorts[0][0] = 999));
    expect(gone.save.convoys.escorts).toEqual([]);
    expect(gone.paths).toEqual(['convoys.escorts[0]']);
    const t = esc.sim.state.career.contracts[0]!.target;
    if (t.kind !== 'escort') throw new Error('no escort');
    const fixed = repaired(escort, (s) => {
      const e = s.convoys.escorts[0][1];
      e.hulls = [ESCORT.traderHull * 2, 5];
      e.progress = t.to + 99_999;
      e.fired = 0xff;
    });
    const e = fixed.save.convoys.escorts[0]![1];
    expect(e.hulls[0]).toBe(ESCORT.traderHull);
    expect(e.hulls.length).toBe(escort.convoys.escorts[0]![1].hulls.length);
    expect(e.progress).toBe(t.to + ESCORT.speed * ESCORT.flyOnSeconds);
    expect(e.fired).toBe((1 << t.ambushes.length) - 1);
    expect(fixed.paths).toEqual(['convoys.escorts[0]']);
  });

  it('an escort deposit is at most 10 % of the contract reward, none once the convoy arrived (G3)', () => {
    const c = esc.sim.state.career.contracts[0]!;
    const deposit = escortDepositOf(c.reward);
    expect(escort.convoys.escorts[0]![1].deposit).toBe(deposit);
    const crafted = repaired(escort, (s) => (s.convoys.escorts[0][1].deposit = 1_000_000));
    expect(crafted.save.convoys.escorts[0]![1].deposit).toBe(deposit);
    expect(crafted.paths).toEqual(['convoys.escorts[0].deposit']);
    // a poor pilot's smaller deposit stays as it is
    const poor = repaired(escort, (s) => (s.convoys.escorts[0][1].deposit = 20));
    expect(poor.save.convoys.escorts[0]![1].deposit).toBe(20);
    expect(poor.paths).toEqual([]);
    // the convoy arrived: the deposit was paid back
    const done = repaired(escort, (s) => {
      s.convoys.escorts[0][1].state = 'done';
      s.convoys.escorts[0][1].deposit = deposit;
    });
    expect(done.save.convoys.escorts[0]![1].deposit).toBe(0);
    expect(done.paths).toEqual(['convoys.escorts[0].deposit']);
    // the crafted deposit is never paid out: a free cancel after the load gives back the contract's deposit
    const sim = restoreSimulation(crafted.save);
    const before = sim.state.credits;
    sim.step({ ...IDLE_COMMAND, actions: [{ type: 'abandonContract', contractId: c.serial, reqId: 1 }] });
    expect(sim.state.credits - before).toBeLessThanOrEqual(deposit);
  });

  it('the repaired saves keep running', () => {
    const { save } = repaired(hold, (s) => (s.guild.relays = []));
    const sim = restoreSimulation(save);
    for (let i = 0; i < 120; i++) sim.step(IDLE_COMMAND);
    expect(sim.state.guild.relays.get('A')?.stage).toBe('powered');
    expect(boardEpoch(sim.state.tick)).toBeGreaterThanOrEqual(0);
  });
});
