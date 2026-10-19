// Wrecks as POIs (5.3.1) and wreck contents (3.2.3): a POI wreck appears when the player comes near (from
// the seed, with a negative id outside the combat numbering) and goes when the player leaves. Before
// dismantling it can be analysed (Data, a ◈ fragment, a pirate log); on loading, the fragment and the
// Smiths' shard are picked up as key items. A looted wreck never refills.
//
// M4b graveyard wrecks (`gy:<cx>,<cy>#<i>`, plan §2.5) are built by the same rules (`seedWreck`,
// `seedContainers`) and remember their dismantling in the same `discovery.cut / opened / scanned` under
// their key. Their fragments: at most `GRAVEYARD.fragmentRolls` rolls per graveyard – the first wrecks
// loaded take them (`GraveyardState.rolls`); each roll is the pure POI roll of the wreck key.
import type { RingIndex } from '../../data/economy';
import { partKey, type PartInventory, type PartKey, type Tier } from '../../data/parts';
import type { FragmentSource } from '../../data/plans';
import { WRECK_INTACT_PARTS, WRECK_SCRAP, type WreckClass } from '../../data/poi';
import { GRAVEYARD } from '../../data/sites';
import { emptyCargo } from '../../data/resources';
import { DESPAWN_RADIUS, SPAWN_RADIUS } from '../combat/combat';
import { ENEMY_TEMPLATES } from '../combat/enemies';
import type { Container, Wreck, WreckLoot } from '../combat/types';
import { WRECK_CONTAINERS } from '../../data/salvage';
import { containerLoot, createContainer, poiContainerId } from '../salvage/containers';
import { intactInventory } from '../salvage/dismantle';
import { components } from '../combat/damage';
import { TAU } from '../math/angle';
import { createRng, type Rng } from '../math/rng';
import { fnv1a32 } from '../math/fnv1a';
import { length, sub, type Vec2 } from '../math/vec2';
import { createGrid } from '../ship/grid';
import { createStarterShip } from '../ship/presets';
import { computeProperties } from '../ship/properties';
import type { ShipGrid } from '../ship/types';
import type { SimEvent, SimState } from '../Simulation';
import { hash3 } from '../world/hash';
import { isSeedWreckKey, parseGraveyardWreckKey } from '../sites/graveyardKeys';
import { graveyardState, touchGraveyard } from '../sites/graveyardState';
import { echoId } from './poi';
import { fireJournal } from './journal';
import { awardFragment, rollFragment, rollPoiFragment } from './plans';
import { poisNear, type WreckPoi } from './poi';
import { logDiscovery } from './state';

const WRECK_SALT = 0x3ec4_77a1;
/** A POI wreck never times out – it goes only when the player leaves. */
export const POI_WRECK_TTL = 1_000_000_000;

/** Negative wreck id from a POI key (takes no number of the combat or the save numbering). */
export const poiWreckId = (key: string): number => -(1 + (fnv1a32(key) & 0x3fffffff));

/** A freighter: lots of cargo, engines, a cockpit. */
function freighter(tier: Tier): ShipGrid {
  return createGrid([
    ['cockpit', 2, 0, 0, tier],
    ['cargo', 1, 0, 0, tier],
    ['cargo', 1, 1, 0, tier],
    ['cargo', 1, -1, 0, tier],
    ['cargo', 0, 1, 0, tier],
    ['cargo', 0, -1, 0, tier],
    ['reactor', 0, 0, 0, tier],
    ['fuelTank', -1, 1, 0, tier],
    ['fuelTank', -1, -1, 0, tier],
    ['engine', -1, 0, 0, tier],
    ['engine', -2, 1, 0, tier],
    ['engine', -2, -1, 0, tier],
    ['armor', 3, 0, 0, tier],
  ]);
}

function templateOf(cls: WreckClass, size: 0 | 1 | 2, tier: Tier): ShipGrid {
  if (cls === 'pirate') return ENEMY_TEMPLATES[size === 0 ? 'jackal' : 'hammer'](tier);
  if (cls === 'freighter') return freighter(tier);
  return createStarterShip();
}

/** The wreck's grid: the class template without some of its parts (a small wreck is just debris). */
export function wreckGrid(poi: Pick<WreckPoi, 'id' | 'cls' | 'size' | 'ring'>): ShipGrid {
  const tier: Tier = poi.ring >= 3 ? 2 : 1;
  const base = templateOf(poi.cls, poi.size, tier);
  const rng = createRng(hash3(WRECK_SALT, fnv1a32(poi.id), 1));
  const keep = [0.45, 0.65, 0.85][poi.size]!;
  // a part is dropped only when the rest stays one piece – a wreck of loose parts would be all joints (I12)
  let parts = [...base.parts];
  base.parts.forEach((p, i) => {
    if (i === 0 || rng() < keep) return;
    const rest = parts.filter((q) => q !== p);
    if (components(rest).length === 1) parts = rest;
  });
  return { parts: parts.map((p) => ({ ...p })), nextId: base.nextId };
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
}

/** Loot of a POI wreck: a few intact parts and scrap by size. */
export function wreckLoot(poi: Pick<WreckPoi, 'id' | 'cls' | 'size' | 'ring'>, grid: ShipGrid): WreckLoot {
  const rng = createRng(hash3(WRECK_SALT, fnv1a32(poi.id), 2));
  const parts: PartInventory = {};
  const candidates = grid.parts.filter((p) => p.partId !== 'cockpit');
  const [lo, hi] = WRECK_INTACT_PARTS;
  const n = Math.min(candidates.length, lo + Math.floor(rng() * (hi - lo + 1)) + (poi.size === 2 ? 1 : 0));
  for (let i = 0; i < n; i++) {
    const p = pick(rng, candidates);
    const key = partKey(p.partId, p.tier, p.variant);
    parts[key] = (parts[key] ?? 0) + 1;
  }
  const cargo = emptyCargo();
  const scrap = WRECK_SCRAP[poi.size] * (0.6 + rng() * 0.8);
  cargo.iron = Math.round(scrap);
  cargo.copper = Math.round(scrap * 0.5 * rng());
  cargo.titanium = poi.ring >= 2 ? Math.round(scrap * 0.35 * rng()) : 0;
  return { cargo, parts };
}

/**
 * Intact (valuable) parts of a larger POI wreck – distinct parts other than the cockpit (M3.6, 5.3.1).
 * The other parts have 30–70 % HP and give only scrap when cut off.
 */
export function hulkIntact(poi: Pick<WreckPoi, 'id' | 'size'>, grid: ShipGrid): number[] {
  const rng = createRng(hash3(WRECK_SALT, fnv1a32(poi.id), 3));
  const pool = grid.parts.filter((p) => p.partId !== 'cockpit').map((p) => p.id);
  const [lo, hi] = WRECK_INTACT_PARTS;
  const n = Math.min(pool.length, lo + Math.floor(rng() * (hi - lo + 1)) + (poi.size === 2 ? 1 : 0));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  return out.sort((a, b) => a - b);
}

/**
 * What a wreck rebuilt from the seed needs: a POI wreck, or a graveyard wreck (key `gy:<cx>,<cy>#<i>`,
 * `ring` = the graveyard's depth).
 */
export type SeedWreckDef = Pick<WreckPoi, 'id' | 'cls' | 'size' | 'ring' | 'pos' | 'angle'>;

/** A larger seed wreck as a dismantlable wreck: without the cut parts, with its intact parts and scrap. */
function hulkFromPoi(state: SimState, poi: SeedWreckDef): Wreck | null {
  const full = wreckGrid(poi);
  const cut = new Set(state.discovery.cut.get(poi.id) ?? []);
  const parts = full.parts.filter((p) => !cut.has(p.id));
  if (parts.length === 0) return null;
  const looted = state.discovery.opened.has(poi.id);
  const grid = { parts, nextId: full.nextId };
  const intact = looted ? [] : hulkIntact(poi, full).filter((id) => !cut.has(id));
  const loot: WreckLoot = looted ? { cargo: emptyCargo(), parts: {} } : { cargo: wreckLoot(poi, full).cargo, parts: {} };
  const w = makeWreck(poiWreckId(poi.id), poi.id, grid, poi.pos, poi.angle, loot, poi.cls === 'pirate' ? 'pirate' : 'default', poi.cls);
  w.dismantle = { intact };
  w.loot.parts = intactInventory(w);
  if (looted) w.contents = { fragment: null, shard: false };
  else if (state.discovery.scanned.has(poi.id)) resolveContents(state, w, false);
  return w;
}

/**
 * Containers by a larger seed wreck (keys `ct:<wreck key>:<i>`), except the opened ones. `count` defaults
 * to the per-size rule (`WRECK_CONTAINERS`); a graveyard caps its total.
 */
export function seedContainers(state: SimState, poi: SeedWreckDef, count: number = WRECK_CONTAINERS[poi.size]): Container[] {
  const out: Container[] = [];
  for (let i = 0; i < count; i++) {
    const key = `ct:${poi.id}:${i}`;
    if (state.discovery.opened.has(key)) continue;
    const rng = createRng(hash3(WRECK_SALT, fnv1a32(key), 4));
    const a = rng() * TAU;
    const d = 3 + poi.size * 1.5 + 5 + rng() * 5;
    const c = createContainer(poiContainerId(key), { x: poi.pos.x + Math.cos(a) * d, y: poi.pos.y + Math.sin(a) * d }, { x: 0, y: 0 }, containerLoot(key, poi.ring), POI_WRECK_TTL, rng() * TAU);
    c.poi = key;
    out.push(c);
  }
  return out;
}

/** The wreck's key for the analysis and the contents (a POI / contract / graveyard wreck has a stable key, a pirate wreck its id). */
export const wreckKey = (w: Pick<Wreck, 'id' | 'poi'>): string => w.poi ?? `wreck#${w.id}`;

function makeWreck(id: number, key: string, grid: ShipGrid, pos: Vec2, angle: number, loot: WreckLoot, livery: Wreck['livery'], cls: WreckClass | undefined): Wreck {
  const props = computeProperties(grid);
  const body = { pos: { ...pos }, vel: { x: 0, y: 0 }, angle, angVel: 0 };
  return { id, grid, props, body, prevBody: body, loot, ttl: POI_WRECK_TTL, livery, poi: key, ...(cls ? { cls } : {}) };
}

/** The wreck of a Retrieve contract (the part on board, no fragment – the reward comes on delivery). */
export function retrieveWreck(serial: number, pos: Vec2, angle: number, part: PartKey, ring: RingIndex): Wreck {
  const key = `rt:${serial}`;
  const grid = wreckGrid({ id: key, cls: 'freighter', size: 1, ring });
  const loot: WreckLoot = { cargo: emptyCargo(), parts: { [part]: 1 } };
  loot.cargo.iron = 6;
  return makeWreck(poiWreckId(key), key, grid, pos, angle, loot, 'default', undefined);
}

/**
 * A seed wreck as it is now: a medium or large one is dismantlable (M3.6, its intact parts are in the
 * grid, not in the wreck's hold); null when every part of it was cut away.
 */
export function seedWreck(state: SimState, poi: SeedWreckDef): Wreck | null {
  if (poi.size >= 1) return hulkFromPoi(state, poi);
  const grid = wreckGrid(poi);
  const looted = state.discovery.opened.has(poi.id);
  const loot = looted ? { cargo: emptyCargo(), parts: {} } : wreckLoot(poi, grid);
  const w = makeWreck(poiWreckId(poi.id), poi.id, grid, poi.pos, poi.angle, loot, poi.cls === 'pirate' ? 'pirate' : 'default', poi.cls);
  if (looted) w.contents = { fragment: null, shard: false };
  // an analysed wreck shows what it holds again (the same pure roll, I10)
  else if (state.discovery.scanned.has(poi.id)) resolveContents(state, w, false);
  return w;
}

/** POI and contract wrecks around the player: they appear within reach and go far away (called periodically). */
export function managePoiWrecks(state: SimState): void {
  const { combat, player } = state;
  const pos = player.body.pos;
  combat.wrecks = combat.wrecks.filter((w) => !w.poi || length(sub(w.body.pos, pos)) <= DESPAWN_RADIUS);
  // an opened POI container (partly loaded, C2) stays until its ttl runs out – it would not respawn
  combat.containers = combat.containers.filter((c) => !c.poi || state.discovery.opened.has(c.poi) || length(sub(c.body.pos, pos)) <= DESPAWN_RADIUS);
  const present = new Set(combat.wrecks.map((w) => w.id));
  const presentContainers = new Set(combat.containers.map((c) => c.id));
  for (const poi of poisNear(state.seed, pos, SPAWN_RADIUS)) {
    if (poi.kind !== 'wreck') continue;
    // containers by a larger wreck (M3.6)
    for (const c of seedContainers(state, poi)) {
      if (presentContainers.has(c.id)) continue;
      combat.containers.push(c);
      presentContainers.add(c.id);
    }
    const id = poiWreckId(poi.id);
    if (present.has(id)) continue;
    const w = seedWreck(state, poi);
    if (!w) continue;
    combat.wrecks.push(w);
    present.add(id);
  }
  for (const c of state.career.contracts) {
    const t = c.target;
    if (t.kind !== 'retrieve' || c.ready) continue;
    const id = poiWreckId(`rt:${c.serial}`);
    if (present.has(id) || length(sub(t.pos, pos)) > SPAWN_RADIUS) continue;
    combat.wrecks.push(retrieveWreck(c.serial, t.pos, t.angle, t.part, c.ring));
    present.add(id);
  }
}

/**
 * The wreck's contents (a fragment by the pity rule, the Smiths' shard from pirates after Echo-1). A wreck
 * POI rolls purely from its id (I10); `first` = this is the POI's first roll (moves the pity counter).
 */
export function resolveContents(state: SimState, w: Wreck, first = true): NonNullable<Wreck['contents']> {
  if (w.contents) return w.contents;
  const d = state.discovery;
  const source: FragmentSource | undefined = w.cls;
  const poiWreck = w.poi?.startsWith('wreck:') === true;
  const graveyard = parseGraveyardWreckKey(w.poi);
  // a graveyard wreck shows the pure roll of its key while the graveyard has rolls left; the roll is
  // taken (and the pity counter moves) only when the wreck is loaded (onWreckSalvaged)
  const fragment = !source
    ? null
    : graveyard
      ? graveyardState(state, graveyard.site).rolls < GRAVEYARD.fragmentRolls
        ? rollPoiFragment(state, source, w.poi!, false)
        : null
      : poiWreck
        ? rollPoiFragment(state, source, w.poi!, first)
        : rollFragment(state, source, wreckKey(w));
  // pirates collect glowing shards – the first pirate wreck after the Echo-1 analysis carries one
  const shardTaken = state.combat.wrecks.some((x) => x !== w && x.contents?.shard);
  const shard = w.cls === 'pirate' && !w.poi && d.scanned.has(echoId(1)) && !d.keyItems.has('shard') && !shardTaken;
  w.contents = { fragment, shard };
  return w.contents;
}

/**
 * A graveyard wreck loaded for the first time: it takes one of the graveyard's fragment rolls while any
 * are left (the pure roll of its key; the pity counter moves as for a POI wreck's first roll).
 */
function salvageGraveyardWreck(state: SimState, w: Wreck, site: string, events: SimEvent[]): void {
  const key = w.poi!;
  w.contents = { fragment: null, shard: false };
  if (state.discovery.opened.has(key)) return;
  state.discovery.opened.add(key);
  const g = touchGraveyard(state, site);
  if (!w.cls || g.rolls >= GRAVEYARD.fragmentRolls) return;
  g.rolls++;
  const fragment = rollPoiFragment(state, w.cls, key, true);
  if (fragment) awardFragment(state, fragment, events);
}

/** The player loaded a wreck's loot: the fragment and the shard are picked up, a seed wreck is looted. */
export function onWreckSalvaged(state: SimState, w: Wreck, events: SimEvent[]): void {
  const graveyard = parseGraveyardWreckKey(w.poi);
  if (graveyard) {
    salvageGraveyardWreck(state, w, graveyard.site, events);
    return;
  }
  // an analysed wreck already rolled (maybe before a despawn): the same contents, no second pity step
  const contents = resolveContents(state, w, !state.discovery.scanned.has(wreckKey(w)));
  if (contents.fragment) awardFragment(state, contents.fragment, events);
  if (contents.shard) {
    state.discovery.keyItems.add('shard');
    events.push({ type: 'keyItemFound', item: 'shard' });
    fireJournal(state, { on: 'shardFound' }, events);
  }
  w.contents = { fragment: null, shard: false };
  if (isSeedWreckKey(w.poi)) state.discovery.opened.add(w.poi);
  if (w.poi?.startsWith('rt:')) {
    const serial = Number(w.poi.slice(3));
    const c = state.career.contracts.find((x) => x.serial === serial);
    if (c && !c.ready) {
      c.ready = true;
      c.progress = 1;
      events.push({ type: 'contractReady', contractId: c.serial });
    }
  }
}

/** The first analysis of a wreck: the contents, a pirate log (pirates). */
export function onWreckAnalyzed(state: SimState, w: Wreck, events: SimEvent[]): void {
  resolveContents(state, w);
  fireJournal(state, w.cls ? { on: 'wreckScanned', cls: w.cls } : { on: 'wreckScanned' }, events);
  const d = state.discovery;
  if ((w.cls === 'pirate' || w.livery === 'pirate') && d.pirateLogs < 3) {
    d.pirateLogs++;
    fireJournal(state, { on: 'pirateLog', n: d.pirateLogs as 1 | 2 | 3 }, events);
  }
  if (w.poi?.startsWith('wreck:')) logDiscovery(state, { tick: state.tick, kind: 'poi', poi: 'wreck' });
}
