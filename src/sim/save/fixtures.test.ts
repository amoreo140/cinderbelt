import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND, type GameAction } from '../commands';
import { cometsNear } from '../sites/comets';
import { sitesNear } from '../sites/placement';
import { maxHp } from '../ship/hp';
import { encodeTemplate } from '../templates/codec';
import { ringIndexAt } from '../world/rings';
import { HOME_STATION_ID, homeStation } from '../world/stations';
import { paintOf } from '../fleet/state';
import { trophiesOf, trophyShelf } from '../home';
import { workshopMounts } from '../ship/workshop';
import { RELAY_CHAIN } from '../../data/guild';
import { convoysInFlight } from '../convoys/schedule';
import { convoyOffer } from '../convoys/trade';
import { hasFeature } from '../discovery/archive';
import { guildRelaySite } from '../guild/relaySites';
import { securityHere } from '../pirates/sectors';
import { receiverPos } from '../sites/relays';
import { loadSave } from './load';
import { legacyConvoys } from './convoys';
import { legacyGuild } from './guild';
import { LATEST_SAVE_VERSION, v17ToV18, v18ToV19, v19ToV20 } from './migrations';
import { legacyNavigation } from './navigation';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { downgradeToV17, downgradeToV18, downgradeToV19, testContext } from './testing';
import type { SaveGame } from './types';

// Test save positions (tests/fixtures/saves, `npm run fixtures`). Every fixture must load through
// the normal path – migrate + validate – and keep running. The files are not regenerated on every
// save version bump, so after a bump the old files double as a migration test of real game states.

const FILES = import.meta.glob('/tests/fixtures/saves/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const fixtures = Object.entries(FILES).map(([path, text]) => ({ name: path.slice(path.lastIndexOf('/') + 1, -'.json'.length), text }));

describe('test save fixtures', () => {
  it('the progression and situation fixtures are all there', () => {
    const names = fixtures.map((f) => f.name);
    for (const name of ['start', 'training-mid', 'after-training', 'hour1', 'hour2', 'dock-approach', 'pirates-near', 'fortress', 'rich-rock', 'damaged', 'wreck-salvage', 'cargo-full', 'hangar', 'derelict', 'derelict-dock', 'graveyard', 'comet', 'gunner', 'shapes', 'shapes-fight', 'home-dev', 'home-built', 'workshop', 'relay-ready', 'relay-hold', 'relay-fight', 'secured', 'convoy-near', 'convoy-linked', 'escort', 'watch-fight', 'map-notes']) {
      expect(names).toContain(name);
    }
  });

  for (const { name, text } of fixtures) {
    it(`${name} loads through migrate + validate and keeps running`, () => {
      const envelope: unknown = JSON.parse(text);
      const result = loadSave(envelope);
      if (!result.ok) throw new Error(`${name}: ${result.error} ${result.details.join('; ')}`);
      expect(result.fromVersion).toBeLessThanOrEqual(LATEST_SAVE_VERSION);
      const sim = restoreSimulation(result.save);
      for (let i = 0; i < 60; i++) sim.step(IDLE_COMMAND);
      // the state after a second of play is still a valid save
      expect(loadSave(toEnvelope(toSave(sim, testContext()))).ok).toBe(true);
    });
  }
});

describe('the 17 → 18, 18 → 19 and 19 → 20 migrations over the fixtures', () => {
  // the older formats are made from the current saves (`downgradeToV…`): every fixture without M4d state
  // (V19), without M4c state (V18) and without shapes (V17) has an older form
  const current = fixtures.map(({ name, text }) => {
    const result = loadSave(JSON.parse(text));
    if (!result.ok) throw new Error(`${name} does not load`);
    return { name, save: result.save };
  });
  const older = (to: (s: SaveGame) => unknown) =>
    current.flatMap(({ name, save }) => {
      try {
        return [{ name, save, old: to(save) as { version: number } }];
      } catch {
        return [];
      }
    });
  // the fixtures are V20 saves; the V19 form of each (without M4d state) is made by `downgradeToV19`
  const v19Files = older(downgradeToV19).map(({ name, save, old }) => ({ name, envelope: toEnvelope(old) as { version: number; data: string }, data: JSON.parse((toEnvelope(old) as { data: string }).data) as Record<string, unknown>, save }));

  // only saves still in the M4d defaults (the early game: no relay, convoy or map note yet) have an older form
  it('the early fixtures have a V19 form', () => {
    expect(v19Files.length).toBeGreaterThanOrEqual(5);
  });

  for (const { name, envelope, data } of v19Files) {
    it(`${name}: 19 → 20 only adds the M4d defaults – the V19 file loads as the same game as its V20 form`, () => {
      const migrated = v19ToV20(data) as SaveGame;
      expect(migrated).toEqual({ ...data, version: 20, guild: legacyGuild(), convoys: legacyConvoys(), navigation: legacyNavigation() });
      const fromFile = loadSave(envelope);
      const direct = loadSave(toEnvelope(migrated));
      if (!fromFile.ok || !direct.ok) throw new Error(`${name} does not load`);
      expect(fromFile.fromVersion).toBe(19);
      expect(fromFile.save).toEqual(direct.save);
      expect(fromFile.warnings).toEqual(direct.warnings);
      expect(downgradeToV19(fromFile.save).version).toBe(19);
    });
  }

  const v18 = older(downgradeToV18);
  const v17 = older(downgradeToV17);

  it('the early fixtures have a V18 and a V17 form', () => {
    expect(v18.length).toBeGreaterThanOrEqual(5);
    expect(v17.length).toBeGreaterThanOrEqual(5);
  });

  for (const { name, save, old } of v18) {
    it(`${name}: 18 → 19 only adds the M4c defaults – the V18 form loads as the same game`, () => {
      expect(v18ToV19(old)).toEqual(downgradeToV19(save));
      const migrated = loadSave(toEnvelope(old));
      const direct = loadSave(toEnvelope(save));
      if (!direct.ok || !migrated.ok) throw new Error(`${name} does not load`);
      expect(migrated.fromVersion).toBe(18);
      expect(migrated.save).toEqual(direct.save);
      expect(migrated.warnings).toEqual(direct.warnings);
    });
  }

  for (const { name, old } of v17) {
    it(`${name}: 17 → 18 changes only the version number`, () => {
      expect(v17ToV18(old)).toEqual({ ...old, version: 18 });
    });
  }
});

describe('genuine V19 saves (frozen before M4d)', () => {
  it('the frozen files still carry the pre-rename format string and load', () => {
    expect(Object.keys(LEGACY).length).toBeGreaterThan(0);
    for (const text of Object.values(LEGACY)) {
      const env = JSON.parse(text) as { format: string };
      expect(env.format).toBe('astra-forge-save');
      expect(loadSave(env).ok).toBe(true);
    }
  });

  // tests/fixtures/saves/legacy/v19: real V19 files written by the game before the M4d state existed; never regenerated
  const LEGACY = import.meta.glob('/tests/fixtures/saves/legacy/v19/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const v19Files = Object.entries(LEGACY).map(([path, text]) => {
    const envelope = JSON.parse(text) as { version: number; data: string };
    return { name: path.slice(path.lastIndexOf('/') + 1, -'.json'.length), envelope, data: JSON.parse(envelope.data) as Record<string, unknown> };
  });

  it('the frozen files are all V19 saves', () => {
    expect(v19Files.length).toBeGreaterThanOrEqual(23);
    expect(v19Files.every((f) => f.envelope.version === 19)).toBe(true);
  });

  for (const { name, envelope, data } of v19Files) {
    it(`${name}: 19 → 20 only adds the M4d defaults – the genuine V19 file loads as the same game as its V20 form`, () => {
      const migrated = v19ToV20(data) as SaveGame;
      expect(migrated).toEqual({ ...data, version: 20, guild: legacyGuild(), convoys: legacyConvoys(), navigation: legacyNavigation() });
      const fromFile = loadSave(envelope);
      const direct = loadSave(toEnvelope(migrated));
      if (!fromFile.ok || !direct.ok) throw new Error(`${name} does not load`);
      expect(fromFile.fromVersion).toBe(19);
      expect(fromFile.save).toEqual(direct.save);
      expect(fromFile.warnings).toEqual(direct.warnings);
      expect(downgradeToV19(fromFile.save).version).toBe(19);
      const sim = restoreSimulation(fromFile.save);
      for (let i = 0; i < 60; i++) sim.step(IDLE_COMMAND);
      expect(loadSave(toEnvelope(toSave(sim, testContext()))).ok).toBe(true);
    });
  }
});

describe('M4b situation fixtures', () => {
  const sim = (name: string) => {
    const text = fixtures.find((f) => f.name === name)?.text;
    if (!text) throw new Error(`no fixture ${name}`);
    const result = loadSave(JSON.parse(text));
    if (!result.ok) throw new Error(`${name}: ${result.error}`);
    return restoreSimulation(result.save);
  };
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  it('derelict: a derelict about 150 u away, one of its relays powered', () => {
    const s = sim('derelict').state;
    const site = sitesNear(s.seed, s.player.body.pos, 200).find((x) => x.kind === 'derelict');
    expect(site && Math.round(dist(site.pos, s.player.body.pos))).toBe(150);
    expect(s.sites.powered.size).toBe(1);
  });

  it('derelict-dock: one F berths; a terminal item taken there stays taken through save and load', () => {
    const game = sim('derelict-dock');
    game.step({ ...IDLE_COMMAND, dock: true });
    const berth = game.state.sites.berth;
    expect(berth).not.toBeNull();
    for (let i = 0; i < 60; i++) game.step(IDLE_COMMAND);
    const take = (g: typeof game, reqId: number) =>
      g.step({ ...IDLE_COMMAND, actions: [{ type: 'derelictTake', site: berth!, item: 0, reqId } as GameAction] }).filter((e) => e.type === 'actionResult');
    expect(take(game, 1)).toEqual([{ type: 'actionResult', reqId: 1, ok: true }]);
    const back = loadSave(toEnvelope(toSave(game, testContext())));
    if (!back.ok) throw new Error('reload failed');
    const again = restoreSimulation(back.save);
    expect(take(again, 2)).toEqual([{ type: 'actionResult', reqId: 2, ok: false, reason: 'itemTaken' }]);
  });

  it('graveyard: the sleeping party lies dormant, Tractor beam+ owned', () => {
    const s = sim('graveyard').state;
    expect(s.discovery.archive.has('tractorPlus')).toBe(true);
    const party = s.combat.enemies.filter((e) => e.id.startsWith('gs:'));
    expect(party.length).toBeGreaterThan(0);
    expect(party.every((e) => e.ai.mode === 'dormant')).toBe(true);
  });

  it('comet: a nucleus in its pass about 250 u away, empty hold, Vein analyser owned', () => {
    const s = sim('comet').state;
    expect(s.discovery.archive.has('veinAnalyzer')).toBe(true);
    const near = cometsNear(s.seed, s.player.body.pos, 400, s.tick);
    expect(near.length).toBeGreaterThan(0);
    expect(near[0]!.t).toBeLessThan(0.1);
    expect(Object.values(s.player.cargo).every((v) => v === 0)).toBe(true);
  });

  it('gunner: a Gunner leads the group about 300 u ahead', () => {
    const s = sim('gunner').state;
    const gunner = s.combat.enemies.find((e) => e.kind === 'gunner');
    expect(gunner).toBeDefined();
    expect(dist(gunner!.body.pos, s.player.body.pos)).toBeGreaterThan(250);
    expect(dist(gunner!.body.pos, s.player.body.pos)).toBeLessThan(350);
  });
});

describe('SL2 E2 shape fixtures', () => {
  const sim = (name: string) => {
    const text = fixtures.find((f) => f.name === name)?.text;
    if (!text) throw new Error(`no fixture ${name}`);
    const result = loadSave(JSON.parse(text));
    if (!result.ok) throw new Error(`${name}: ${result.error}`);
    expect(result.fromVersion).toBeLessThanOrEqual(LATEST_SAVE_VERSION);
    expect(result.warnings).toEqual([]);
    return restoreSimulation(result.save);
  };
  const shapesOf = (s: ReturnType<typeof sim>['state']) => s.player.grid.parts.flatMap((p) => (p.shape ? [p.shape] : []));

  it('shapes: docked at home, a T2 ship with wedges, chamfers, a wing pair and a nose 2×1; a wedge at 50 % HP', () => {
    const s = sim('shapes').state;
    expect(s.player.dock).toMatchObject({ mode: 'docked', stationId: HOME_STATION_ID });
    expect(s.player.grid.parts.find((p) => p.partId === 'cockpit')!.tier).toBe(2);
    const shapes = shapesOf(s);
    for (const shape of ['wedge', 'chamfer', 'wingL', 'wingR', 'nose2x1'] as const) expect(shapes).toContain(shape);
    const damaged = [...s.player.hp].map(([id, hp]) => ({ part: s.player.grid.parts.find((p) => p.id === id)!, hp }));
    expect(damaged).toHaveLength(1);
    expect(damaged[0]!.part.shape).toBe('wedge');
    expect(damaged[0]!.hp).toBe(maxHp(damaged[0]!.part) / 2);
  });

  it('shapes: spare armour in storage and a shaped template (CB2 code)', () => {
    const s = sim('shapes').state;
    expect(s.stations.get(HOME_STATION_ID)!.parts).toMatchObject({ 'armor:1': 4, 'armor:2': 2 });
    expect(s.templates).toHaveLength(1);
    expect(s.templates[0]!.parts.some((p) => p.length === 5)).toBe(true);
    expect(encodeTemplate(s.templates[0]!).startsWith('CB2.')).toBe(true);
  });

  it('shapes-fight: the same ship flying in ring 2, a Jackal pair about 120 u ahead, shield and battery full', () => {
    const fight = sim('shapes-fight').state;
    const docked = sim('shapes').state;
    expect(fight.player.dock.mode).toBe('flying');
    expect(ringIndexAt(Math.hypot(fight.player.body.pos.x, fight.player.body.pos.y))).toBe(2);
    expect(fight.player.grid).toEqual(docked.player.grid);
    const enemies = fight.combat.enemies;
    expect(enemies.map((e) => e.kind)).toEqual(['jackal', 'jackal']);
    const pos = fight.player.body.pos;
    const d = Math.min(...enemies.map((e) => Math.hypot(e.body.pos.x - pos.x, e.body.pos.y - pos.y)));
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(140);
    expect(fight.player.shield).toBe(fight.player.props.shield.capacity);
    expect(fight.player.energy).toBe(fight.player.props.batteryCapacity);
  });
});

describe('M4c home and workshop fixtures', () => {
  const sim = (name: string) => {
    const text = fixtures.find((f) => f.name === name)?.text;
    if (!text) throw new Error(`no fixture ${name}`);
    const result = loadSave(JSON.parse(text));
    if (!result.ok) throw new Error(`${name}: ${result.error}`);
    expect(result.fromVersion).toBeLessThanOrEqual(LATEST_SAVE_VERSION);
    expect(result.warnings).toEqual([]);
    return restoreSimulation(result.save);
  };

  it('home-dev: docked at home, 25,000 cr, nothing built, 2 captains with replicas + 1 fortress, a ship in the home hangar', () => {
    const s = sim('home-dev').state;
    expect(s.player.dock).toMatchObject({ mode: 'docked', stationId: HOME_STATION_ID });
    expect(s.credits).toBe(25_000);
    expect(s.home.modules.size).toBe(0);
    const trophies = trophiesOf(s);
    expect(trophies.map((t) => t.kind)).toEqual(['captain', 'captain', 'fortress']);
    expect(trophies.filter((t) => t.kind === 'captain').every((t) => t.replicas.length > 0)).toBe(true);
    expect(s.fleet.stored.some((x) => x.stationId === HOME_STATION_ID)).toBe(true);
  });

  it('home-built: both modules (their colliders in the World), the active ship racing, the stored one navy, 3 pins', () => {
    const s = sim('home-built').state;
    expect([...s.home.modules].sort()).toEqual(['paintShop', 'trophyHall']);
    expect(s.world.stationCirclesNear(homeStation().pos, 1).length).toBeGreaterThan(sim('home-dev').state.world.stationCirclesNear(homeStation().pos, 1).length);
    expect(paintOf(s.fleet.active)).toBe('racing');
    expect(paintOf(s.fleet.stored.find((x) => x.stationId === HOME_STATION_ID)!.record)).toBe('navy');
    expect(s.home.trophyPins).toHaveLength(3);
    expect(trophyShelf(s).slice(0, 3)).toEqual(s.home.trophyPins);
  });

  it('workshop: flying 200 u from home, the M4c parts, damaged armour + engine by the repair module, the cargo and fuel', () => {
    const game = sim('workshop');
    const s = game.state;
    expect(s.player.dock.mode).toBe('flying');
    const p = s.player;
    expect(Math.hypot(p.body.pos.x - homeStation().pos.x, p.body.pos.y - homeStation().pos.y)).toBeCloseTo(200, 0);
    expect(p.grid.parts.find((x) => x.partId === 'largeReactor')!.tier).toBe(1);
    const mounts = workshopMounts(p.grid);
    expect(mounts.refineries).toHaveLength(1);
    expect(mounts.repairs).toHaveLength(1);
    const damaged = [...p.hp.keys()].map((id) => p.grid.parts.find((x) => x.id === id)!);
    expect(damaged.map((x) => x.partId).sort()).toEqual(['armor', 'engine']);
    expect(damaged.every((x) => mounts.repairs[0]!.neighbours.includes(x.id))).toBe(true);
    expect(p.cargo).toEqual({ iron: 120, copper: 0, ice: 60, titanium: 40 });
    expect(p.fuel / p.props.fuelCapacity).toBeCloseTo(0.4, 6);
    for (const node of ['refinery', 'largeReactor', 'repairModule'] as const) expect(s.discovery.archive.has(node)).toBe(true);
    // 20 s of flight: the refinery turns ice into fuel, the repair module heals with iron
    const before = { fuel: p.fuel, ice: p.cargo.ice, hp: [...p.hp.values()].reduce((a, b) => a + b, 0) };
    for (let i = 0; i < 1200; i++) game.step(IDLE_COMMAND);
    expect(p.fuel).toBeGreaterThan(before.fuel);
    expect(p.cargo.ice).toBeLessThan(before.ice);
    expect(p.cargo.iron).toBeLessThan(120);
    const healed = damaged.reduce((sum, x) => sum + (p.hp.get(x.id) ?? maxHp(x)), 0);
    expect(healed).toBeGreaterThan(before.hp);
  });
});

describe('M4d Guild and trade fixtures', () => {
  const sim = (name: string) => {
    const text = fixtures.find((f) => f.name === name)?.text;
    if (!text) throw new Error(`no fixture ${name}`);
    const result = loadSave(JSON.parse(text));
    if (!result.ok) throw new Error(`${name}: ${result.error}`);
    expect(result.fromVersion).toBe(20);
    expect(result.warnings).toEqual([]);
    return restoreSimulation(result.save);
  };
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const steps = (game: ReturnType<typeof sim>, n: number) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(...game.step(IDLE_COMMAND));
    return out;
  };

  it('relay-ready: Guild level 2, docked at a station with the lane-A relay slip, the repair materials aboard', () => {
    const s = sim('relay-ready').state;
    expect(s.player.dock.mode).toBe('docked');
    expect(s.career.rep.guild.level).toBe(2);
    const board = s.career.boards.get(s.player.dock.mode === 'docked' ? s.player.dock.stationId : '')!;
    const slip = board.offers.find((o) => o.type === 'relay');
    expect(slip?.target).toMatchObject({ kind: 'relay', lane: 'A', relay: 'gr:A' });
    expect(s.player.cargo).toMatchObject({ iron: 80, copper: 50, titanium: 20 });
  });

  it('relay-hold: the relay contract, the mast repaired, by its receiver, 3 s of 5 charged; 2 s of the beam → powered, the hold warning', () => {
    const game = sim('relay-hold');
    const s = game.state;
    expect(s.career.contracts.some((c) => c.target.kind === 'relay')).toBe(true);
    expect(s.guild.relays.get('A')?.stage).toBe('repaired');
    expect(s.sites.charge).toEqual({ id: 'gr:A', progress: 3 });
    const receiver = receiverPos(guildRelaySite(s.seed, 'A')!.relay);
    const events = [];
    for (let i = 0; i < 150 && !s.sites.powered.has('gr:A'); i++) events.push(...game.step({ ...IDLE_COMMAND, aim: receiver, mining: true }));
    expect(s.sites.powered.has('gr:A')).toBe(true);
    events.push(...steps(game, 1));
    expect(events.some((e) => e.type === 'relayHoldStarted')).toBe(true);
    expect(s.guild.hold?.phase).toBe('warning');
  });

  it('relay-fight: the hold fight on, the counterattack in, the Guild reinforcement comes', () => {
    const game = sim('relay-fight');
    const s = game.state;
    expect(s.guild.hold).toMatchObject({ lane: 'A', phase: 'fight', reinforced: false });
    expect(s.combat.enemies.filter((e) => e.id.startsWith('rc:A:')).length).toBeGreaterThan(0);
    steps(game, RELAY_CHAIN.watchArrive * 60);
    expect(s.guild.hold?.reinforced).toBe(true);
    expect(s.guild.watch.some((w) => w.route === 'relay:A')).toBe(true);
  });

  it('secured: a lane secured, its relay sector Guarded, a live Watch sector patrol beside the ship', () => {
    const s = sim('secured').state;
    const secured = [...s.guild.relays].filter(([, r]) => r.stage === 'secured');
    expect(secured.length).toBe(1);
    expect(s.sites.powered.has(`gr:${secured[0]![0]}`)).toBe(true);
    expect(securityHere(s, s.player.body.pos)).toBe('guarded');
    expect(s.guild.watch.some((w) => w.route.startsWith('sector:'))).toBe(true);
  });

  it('convoy-near: flying 250 u beside a pass with a tanker at its speed, 120 Fe (40 refined), 6,000 cr', () => {
    const game = sim('convoy-near');
    const s = game.state;
    const trader = () => convoysInFlight(s.seed, s.tick).map((p) => ({ p, d: dist(p.ships[0]!.pos, s.player.body.pos) })).sort((a, b) => a.d - b.d)[0]!;
    const near = trader();
    expect(near.d).toBeCloseTo(250, -1);
    expect(near.p.ships.some((x) => x.kind === 'tanker')).toBe(true);
    expect(s.player.cargo.iron).toBe(120);
    expect(s.player.refined.iron).toBe(40);
    expect(s.credits).toBe(6000);
    steps(game, 60);
    expect(trader().d).toBeCloseTo(250, -1);
  });

  it('convoy-linked: linked to the trader, the trade open (items, sale, tanker fuel), a purchase works', () => {
    const game = sim('convoy-linked');
    const s = game.state;
    const pass = s.convoys.link!.pass;
    const offer = convoyOffer(s, pass)!;
    expect(offer.items.length).toBe(3);
    expect(offer.fuel).not.toBeNull();
    const ev = game.step({ ...IDLE_COMMAND, actions: [{ type: 'convoySell', resource: 'iron', qty: 10, reqId: 1 }] });
    expect(ev.find((e) => e.type === 'actionResult')).toMatchObject({ ok: true });
    expect(s.convoys.trades.get(pass)?.sold).toBe(10);
    steps(game, 60);
    expect(s.convoys.link?.pass).toBe(pass);
  });

  it('escort: an escort contract accepted (deposit held), the convoy waiting 200 u ahead', () => {
    const s = sim('escort').state;
    const c = s.career.contracts.find((x) => x.target.kind === 'escort')!;
    const e = s.convoys.escorts.get(c.serial)!;
    expect(e.state).toBe('waiting');
    expect(e.deposit).toBeGreaterThan(0);
    if (c.target.kind !== 'escort') throw new Error('no escort');
    expect(dist(s.player.body.pos, c.target.meet)).toBeCloseTo(200, -1);
    expect(c.target.ambushes.length).toBe(2);
  });

  it('watch-fight: a lane patrol pair live, a Hammer + Jackal attacking – the Watch engages', () => {
    const game = sim('watch-fight');
    const s = game.state;
    const lane = s.guild.watch.filter((w) => w.route.startsWith('lane:'));
    expect(lane.length).toBeGreaterThanOrEqual(2);
    expect(s.combat.enemies.map((e) => e.kind).sort()).toEqual(['hammer', 'jackal']);
    expect(dist(lane[0]!.body.pos, s.player.body.pos)).toBeLessThan(330);
    const ev = steps(game, 600);
    expect(ev.some((e) => e.type === 'watchEngaged')).toBe(true);
  });

  it('map-notes: the Archive node bought, 4 notes, a pirate group and a comet in radar range', () => {
    const s = sim('map-notes').state;
    expect(hasFeature(s, 'mapNotes')).toBe(true);
    expect(s.navigation.notes.map((n) => n.icon)).toEqual(['star', 'ore', 'pirate', 'flag']);
    const range = s.player.props.radarRange;
    const pos = s.player.body.pos;
    expect(s.combat.enemies.some((e) => dist(e.body.pos, pos) <= range)).toBe(true);
    expect(cometsNear(s.seed, pos, range, s.tick).length).toBeGreaterThan(0);
  });
});
