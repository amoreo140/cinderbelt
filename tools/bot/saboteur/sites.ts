// Saboteur probes for the M4b world sites and events (task T15). Each probe plays the real
// simulation (flight inputs, Tab, F, the beam, site actions and a few crafted actions a modified client
// could send) around one site and must gain nothing that the site does not offer once: a derelict's Data,
// log and terminal items once (also from a save copy, after leaving and berthing again, after a death);
// a graveyard's Data and fragment rolls once and its wrecks never refilled (also after they despawn and
// respawn, and after a save → load); a comet's nucleus and tail shards once per pass (also after a save
// → load and after leaving and returning in the same pass); a relay's charge never grows over a save;
// live mines blow once; the `debugEvent` ambush / shower trigger only exists in dev builds.
//
// Setup steps a player would fly for minutes (reaching the site, jumping to a comet pass) teleport the
// ship or set the clock, like the save fixtures; from then on only commands and actions run.
import { partValue } from '../../../src/data/economy';
import type { PartInventory, PartKey } from '../../../src/data/parts';
import { RESOURCE_IDS } from '../../../src/data/resources';
import { COMET, DERELICT, GRAVEYARD, MINE, RELAY } from '../../../src/data/sites';
import { IDLE_COMMAND, type PlayerCommand } from '../../../src/sim/commands';
import { flyingAt, teleport } from '../../../src/sim/discovery/testing';
import { ANALYZE_TICKS } from '../../../src/sim/discovery/scanner';
import type { Vec2 } from '../../../src/sim/math/vec2';
import type { SimEvent, Simulation } from '../../../src/sim/Simulation';
import { derelictDockTarget } from '../../../src/sim/sites/berth';
import { cometAt, cometDefs, cometPassWindow, cometShards } from '../../../src/sim/sites/comets';
import { derelictState } from '../../../src/sim/sites/derelict';
import { atClamp, findDerelict } from '../../../src/sim/sites/derelictTesting';
import { graveyardLayout } from '../../../src/sim/sites/graveyard';
import { graveyardState } from '../../../src/sim/sites/graveyardState';
import { sitesInChunk } from '../../../src/sim/sites/placement';
import { receiverPos } from '../../../src/sim/sites/relays';
import { fabricateBlocker, fabricatorKeys, terminalOffer } from '../../../src/sim/sites/terminal';
import type { DerelictSite, GraveyardSite } from '../../../src/sim/sites/types';
import { dockPose } from '../../../src/sim/station/dock';
import { createGrid } from '../../../src/sim/ship/grid';
import { cloneSim, Driver, TPS } from './harness';
import type { LoopResult } from './scenarios';
import { netWorth } from './value';

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const norm = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
};
const countParts = (inv: PartInventory): number => (Object.values(inv) as number[]).reduce((s, n) => s + (n ?? 0), 0);
const cargoUnits = (d: Driver): number => RESOURCE_IDS.reduce((s, r) => s + d.state.player.cargo[r], 0);

function result(id: string, seed: number, d: Driver, broken: string[], detail: string, metrics: Record<string, number>, gain = 0): LoopResult {
  return {
    id,
    seed,
    penalty: d.state.settings.deathPenalty,
    seconds: d.state.tick / TPS,
    gain,
    perHour: 0,
    baselinePerHour: null,
    help: {},
    exploit: broken.length > 0,
    tick: broken.length ? d.state.tick : null,
    detail: broken.length ? `BROKEN: ${broken.join('; ')} – ${detail}` : detail,
    metrics,
  };
}

/** Collects Data gains and site events while a driver plays (also over copies). */
class Tap {
  data = 0;
  atlas = 0;
  readonly bySource: Record<string, number> = {};
  readonly events: SimEvent[] = [];
  attach(d: Driver): Driver {
    d.onEvent = (e) => {
      // the Atlas pays once per completed collection (graveyard wrecks count for the wreck classes) – not a site payment
      if (e.type === 'dataGained' && e.source !== 'atlas') this.data += e.amount;
      if (e.type === 'dataGained' && e.source === 'atlas') this.atlas += e.amount;
      if (e.type === 'dataGained') this.bySource[e.source] = (this.bySource[e.source] ?? 0) + e.amount;
      if (e.type.startsWith('derelict') || e.type === 'mineExploded' || e.type === 'mineArmed' || e.type === 'relayPowered' || e.type === 'fragmentFound') this.events.push(e);
    };
    return d;
  }
  count(type: SimEvent['type']): number {
    return this.events.filter((e) => e.type === type).length;
  }
}

// ------------------------------------------------------------------------------------------------
// S1 – derelict terminal: Data, log and every item once – take twice, from a save copy, after leaving
// and berthing again, after a death; the fabricator twice; crafted takes (unknown site / item, not berthed)

/** F at the clamp pose (all relays powered) – berths when the rules hold; true when berthed. */
function berth(d: Driver, site: DerelictSite): boolean {
  const pose = dockPose(derelictDockTarget(site), d.state.player.props.boundingRadius);
  d.state.player.body = { ...pose };
  d.state.player.prevBody = { ...pose };
  d.step({ ...IDLE_COMMAND, dock: true, aim: { ...pose.pos } });
  d.idle(1.2);
  return d.state.sites.berth === site.id;
}

function terminalProbe(seed: number, service: DerelictSite['service'], tap: Tap): { broken: string[]; notes: string[]; metrics: Record<string, number>; d: Driver } {
  const broken: string[] = [];
  const notes: string[] = [];
  const site = findDerelict(seed, (x) => x.service === service);
  const sim = atClamp(seed, site);
  for (const r of site.relays) sim.state.sites.powered.add(r.id);
  const d = tap.attach(new Driver(sim));
  // the fabricator needs materials in the cargo (an hour of mining, given here)
  if (service === 'fabricator') for (const r of RESOURCE_IDS) d.state.player.cargo[r] = 60;
  const data0 = tap.data;
  if (!berth(d, site)) broken.push(`${service}: berth failed`);
  const firstData = tap.data - data0;
  const offer = terminalOffer(d.state, site.id)!;
  const take = (drv: Driver, item: number): { ok: boolean; reason?: string } => {
    let key: PartKey | undefined;
    if (offer.items[item]?.what.kind === 'fabricate') key = fabricatorKeys(drv.state).filter((k) => fabricateBlocker(drv.state, k) === null).sort((a, b) => partValue(b) - partValue(a))[0];
    return drv.attempt({ type: 'derelictTake', site: site.id, item, ...(key ? { key } : {}) });
  };
  let taken = 0;
  for (const it of offer.items) if (take(d, it.index).ok) taken++;
  // again, right away
  let again = 0;
  for (const it of offer.items) if (take(d, it.index).ok) again++;
  if (again) broken.push(`${service}: ${again} item(s) taken twice`);
  // a save copy taken before the leave: everything is still taken there
  const copy = tap.attach(new Driver(cloneSim(d.sim)));
  let fromCopy = 0;
  for (const it of offer.items) if (take(copy, it.index).ok) fromCopy++;
  if (fromCopy) broken.push(`${service}: ${fromCopy} item(s) taken again from a save copy`);
  // leave, berth again (also in the copy): no Data, no items
  const dataBefore = tap.data;
  d.attempt({ type: 'berthLeave' });
  d.idle(1);
  if (!berth(d, site)) notes.push(`${service}: second berth refused`);
  copy.attempt({ type: 'berthLeave' });
  copy.idle(1);
  berth(copy, site);
  let rebirth = 0;
  for (const drv of [d, copy]) for (const it of offer.items) if (take(drv, it.index).ok) rebirth++;
  if (rebirth) broken.push(`${service}: ${rebirth} item(s) after berthing again`);
  if (tap.data > dataBefore) broken.push(`${service}: ${tap.data - dataBefore} D for berthing again`);
  // crafted actions: an unknown derelict, an unknown item, not berthed
  const crafted = [
    d.attempt({ type: 'derelictTake', site: 'dl:9999,9999', item: 0 }),
    d.attempt({ type: 'derelictTake', site: site.id, item: 31 }),
    d.attempt({ type: 'derelictTake', site: site.id, item: -1 }),
  ];
  d.attempt({ type: 'berthLeave' });
  d.idle(1);
  crafted.push(d.attempt({ type: 'derelictTake', site: site.id, item: 0 }));
  const craftedOk = crafted.filter((r) => r.ok).length;
  if (craftedOk) broken.push(`${service}: ${craftedOk} crafted take(s) accepted`);
  // a death after taking (the parts on board may be lost): nothing comes back to take
  copy.attempt({ type: 'berthLeave' });
  copy.idle(1);
  copy.scuttle();
  copy.idle(1);
  const after = tap.attach(new Driver(cloneSim(copy.sim)));
  if (after.state.player.dock.mode === 'docked') after.undock();
  for (const r of site.relays) after.state.sites.powered.add(r.id);
  teleport(after.sim, site.pos);
  berth(after, site);
  let afterDeath = 0;
  for (const it of offer.items) if (take(after, it.index).ok) afterDeath++;
  if (afterDeath) broken.push(`${service}: ${afterDeath} item(s) after a death`);
  if (firstData !== DERELICT.data) broken.push(`${service}: first berth paid ${firstData} D (expected ${DERELICT.data})`);
  notes.push(`${service} ${site.id}: first berth ${firstData} D, ${taken}/${offer.items.length} items taken, again ${again}, copy ${fromCopy}, re-berth ${rebirth}, crafted ${craftedOk}/4, after death ${afterDeath}; Data in total ${tap.data} D`);
  return { broken, notes, metrics: { [`${service}Items`]: offer.items.length, [`${service}Taken`]: taken, [`${service}Data`]: tap.data }, d };
}

export function siteTerminal(seed: number): LoopResult {
  const broken: string[] = [];
  const notes: string[] = [];
  const metrics: Record<string, number> = {};
  let last: Driver | null = null;
  for (const service of ['stash', 'plan', 'fabricator'] as const) {
    const tap = new Tap();
    const r = terminalProbe(seed, service, tap);
    broken.push(...r.broken);
    notes.push(...r.notes);
    Object.assign(metrics, r.metrics);
    // Data over the original, the copy and the copy after the death: one first berth each line → ≤ 3 × 80
    // is NOT allowed – the copy and the original share one first berth, so exactly 80 in all
    if (tap.data !== DERELICT.data) broken.push(`${service}: ${tap.data} D over all copies (expected ${DERELICT.data} once)`);
    last = r.d;
  }
  return result('siteTerminal', seed, last!, broken, notes.join('; '), metrics);
}

// ------------------------------------------------------------------------------------------------
// S2 – graveyard farm: the Data of the first analysed wreck once, ≤ 2 fragment rolls, looted wrecks never
// refilled – over despawn / respawn (fly away and back) and a save → load; graveyard loot sold once

/** The nearest graveyard of the seed without a sleeping party (mines allowed) – null when none in reach. */
function findGraveyard(seed: number, filter: (g: GraveyardSite) => boolean): GraveyardSite | null {
  const all: GraveyardSite[] = [];
  for (let cx = -30; cx <= 30; cx++) for (let cy = -30; cy <= 30; cy++) for (const s of sitesInChunk(seed, cx, cy)) if (s.kind === 'graveyard' && filter(s)) all.push(s);
  all.sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y));
  return all[0] ?? null;
}

/** A stand point 30 u outside wreck `i` of the graveyard, away from its mines. */
function wreckStand(seed: number, site: GraveyardSite, i: number): Vec2 {
  const layout = graveyardLayout(seed, site);
  const w = layout.wrecks[i]!;
  const out = norm({ x: w.pos.x - site.pos.x, y: w.pos.y - site.pos.y });
  for (const turn of [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1, Math.PI]) {
    const dir = { x: out.x * Math.cos(turn) - out.y * Math.sin(turn), y: out.x * Math.sin(turn) + out.y * Math.cos(turn) };
    const p = { x: w.pos.x + dir.x * (w.radius + 30), y: w.pos.y + dir.y * (w.radius + 30) };
    if (site.mines.every((m) => dist(m, p) > MINE.armRange + 12) && layout.wrecks.every((o) => o === w || dist(o.pos, p) > o.radius + 8)) return p;
  }
  return { x: w.pos.x + out.x * (w.radius + 30), y: w.pos.y + out.y * (w.radius + 30) };
}

/** Holds Tab on the graveyard wreck `key` from the stand point; returns the Data the analysis paid (−1 = no wreck). */
function analyseWreck(d: Driver, tap: Tap, key: string): number {
  d.idle(0.5);
  const w = d.state.combat.wrecks.find((x) => x.poi === key);
  if (!w) return -1;
  d.idleUntil(() => d.state.discovery.scanner.cooldown === 0 && d.state.player.energy >= 40, 20);
  const before = tap.data;
  for (let i = 0; i < ANALYZE_TICKS + 20; i++) {
    const cur = d.state.combat.wrecks.find((x) => x.poi === key);
    d.step({ ...IDLE_COMMAND, scan: true, aim: { ...(cur ?? w).body.pos } });
  }
  d.step();
  return tap.data - before;
}

/** Sum of the loot still in the graveyard's spawned wrecks (parts and cargo units). */
function lootLeft(d: Driver, site: GraveyardSite): { parts: number; cargo: number; looted: number } {
  let parts = 0;
  let cargo = 0;
  let looted = 0;
  for (const w of d.state.combat.wrecks) {
    if (!w.poi?.startsWith(`${site.id}#`)) continue;
    parts += countParts(w.loot.parts);
    const c = RESOURCE_IDS.reduce((s, r) => s + w.loot.cargo[r], 0);
    cargo += c;
    if (d.state.discovery.opened.has(w.poi)) looted++;
  }
  return { parts, cargo, looted };
}

/** Loot units (parts + cargo) still in each spawned wreck of the graveyard, by wreck key. */
function lootByWreck(d: Driver, site: GraveyardSite): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of d.state.combat.wrecks) {
    if (!w.poi?.startsWith(`${site.id}#`)) continue;
    out.set(w.poi, countParts(w.loot.parts) + RESOURCE_IDS.reduce((s, r) => s + w.loot.cargo[r], 0));
  }
  return out;
}

/** Loot that came back between two snapshots of the same wrecks (a refill), and how many wrecks were compared. */
function refilled(before: Map<string, number>, after: Map<string, number>): { units: number; compared: number } {
  let units = 0;
  let compared = 0;
  for (const [key, b] of before) {
    const a = after.get(key);
    if (a === undefined) continue;
    compared++;
    units += Math.max(0, a - b);
  }
  return { units, compared };
}

/** Loads the loot of graveyard wreck `key` (flies next to it, F) until it is empty or the hold is full. */
function loot(d: Driver, key: string): number {
  const p = d.state.player;
  const w = d.state.combat.wrecks.find((x) => x.poi === key);
  if (!w) return 0;
  const before = countParts(p.salvage) + cargoUnits(d);
  const side = norm({ x: p.body.pos.x - w.body.pos.x, y: p.body.pos.y - w.body.pos.y });
  const r = w.props.boundingRadius + p.props.boundingRadius + 2;
  teleport(d.sim, { x: w.body.pos.x + side.x * r, y: w.body.pos.y + side.y * r }, Math.atan2(-side.y, -side.x));
  for (let i = 0; i < 6; i++) {
    d.step({ ...IDLE_COMMAND, dock: true, aim: { ...p.body.pos } });
    d.step();
  }
  return countParts(d.state.player.salvage) + cargoUnits(d) - before;
}

export function graveyardFarm(seed: number): LoopResult {
  const broken: string[] = [];
  const notes: string[] = [];
  const site = findGraveyard(seed, (g) => g.sleepers.length === 0);
  const tap = new Tap();
  if (!site) {
    const d = new Driver(flyingAt(seed, { x: 0, y: 2000 }));
    return result('graveyardFarm', seed, d, [], 'no graveyard without sleepers within 30 chunks', {});
  }
  const layout = graveyardLayout(seed, site);
  const keys = layout.wrecks.map((w) => w.id);
  const d = tap.attach(new Driver(flyingAt(seed, wreckStand(seed, site, 0))));
  d.idle(1);
  // first analysis pays, the second wreck nothing
  const first = analyseWreck(d, tap, keys[0]!);
  teleport(d.sim, wreckStand(seed, site, 1));
  const second = analyseWreck(d, tap, keys[1]!);
  // loot four wrecks: the first two roll for a fragment, the rest not (≤ GRAVEYARD.fragmentRolls)
  const stock = lootLeft(d, site);
  let gained = 0;
  for (const key of keys.slice(0, 4)) {
    d.state.player.salvage = {};
    for (const r of RESOURCE_IDS) d.state.player.cargo[r] = 0;
    gained += loot(d, key);
  }
  const rolls1 = graveyardState(d.state, site.id).rolls;
  // fly away (the wrecks despawn) and come back (they respawn): no Data, no loot back in any wreck
  const left1 = lootByWreck(d, site);
  teleport(d.sim, { x: site.pos.x + 3000, y: site.pos.y });
  d.idle(2);
  const despawned = d.state.combat.wrecks.filter((w) => w.poi?.startsWith(`${site.id}#`)).length;
  teleport(d.sim, wreckStand(seed, site, 0));
  d.idle(1);
  const back = lootLeft(d, site);
  const respawn = refilled(left1, lootByWreck(d, site));
  const again = analyseWreck(d, tap, keys[0]!) + Math.max(0, analyseWreck(d, tap, keys[2] ?? keys[0]!));
  // loot the same four wrecks again (whatever the first pass left), then save → load
  for (const key of keys.slice(0, 4)) {
    d.state.player.salvage = {};
    for (const r of RESOURCE_IDS) d.state.player.cargo[r] = 0;
    gained += loot(d, key);
  }
  const left2 = lootByWreck(d, site);
  const copy = tap.attach(new Driver(cloneSim(d.sim)));
  copy.idle(1);
  const reload = refilled(left2, lootByWreck(copy, site));
  const fromCopy = Math.max(0, analyseWreck(copy, tap, keys[3] ?? keys[0]!));
  // more wrecks looted in the copy: the fragment rolls stay capped
  for (const key of keys.slice(4, 8)) {
    copy.state.player.salvage = {};
    for (const r of RESOURCE_IDS) copy.state.player.cargo[r] = 0;
    gained += loot(copy, key);
  }
  const rolls2 = graveyardState(copy.state, site.id).rolls;
  const scanData = tap.bySource.scan ?? 0;
  if (first !== GRAVEYARD.data) broken.push(`first analysis paid ${first} D (expected ${GRAVEYARD.data})`);
  if (second > 0 || again > 0 || fromCopy > 0) broken.push(`more graveyard Data: second ${second}, after respawn ${again}, from a copy ${fromCopy}`);
  if (respawn.units > 0 || reload.units > 0) broken.push(`loot came back: ${respawn.units} u in ${respawn.compared} respawned wrecks, ${reload.units} u in ${reload.compared} wrecks of a save copy`);
  if (respawn.compared === 0 || reload.compared === 0) broken.push('no wreck compared (the probe did not run)');
  if (rolls1 > GRAVEYARD.fragmentRolls || rolls2 > GRAVEYARD.fragmentRolls) broken.push(`fragment rolls ${rolls1} / ${rolls2} > ${GRAVEYARD.fragmentRolls}`);
  if (scanData > GRAVEYARD.data) broken.push(`graveyard analysis Data in total ${scanData} D`);
  const other = Object.entries(tap.bySource).filter(([src]) => src !== 'scan').map(([src, v]) => `${src} ${v} D`).join(', ');
  notes.push(
    `${site.id} (${keys.length} wrecks, ${site.mines.length} mines): analyses ${first} / ${second} D, after despawn (${despawned} left far away) and return ${again} D, from a save copy ${fromCopy} D; ` +
      `looted ${gained} u from 8 wrecks (stock in reach ${stock.parts} parts + ${Math.round(stock.cargo)} u); loot back after respawn ${respawn.units} u (${respawn.compared} wrecks compared, ${back.looted} remembered as emptied), after a save → load ${reload.units} u (${reload.compared} wrecks); ` +
      `fragment rolls ${rolls1} → ${rolls2} after 8 wrecks; other Data ${other || 'none'} (fragments / Atlas, once each)`,
  );
  return result('graveyardFarm', seed, copy, broken, notes.join('; '), { first, second, again, fromCopy, gained, refill: respawn.units, copyRefill: reload.units, compared: respawn.compared + reload.compared, rolls: rolls2, data: scanData });
}

// ------------------------------------------------------------------------------------------------
// S3 – comet budget: the nucleus and the tail shards once per pass – also from a save copy made in the
// middle and after leaving and returning in the same pass. A perfect pilot: the ship is placed beside the
// nucleus every step with its velocity; the hold is emptied every second (as if the ore were jettisoned).

/** Mines the nucleus (and then each tail shard) for `seconds`; returns the ore that went into the hold. */
function mineComet(d: Driver, id: string, seconds: number, shards: boolean): { core: number; tail: number } {
  const out = { core: 0, tail: 0 };
  const end = d.state.tick + Math.round(seconds * TPS);
  const p = d.state.player;
  const front = Math.max(1, ...p.props.lasers.map((l) => l.offset.x));
  let shard = 0;
  while (d.state.tick < end) {
    const pose = cometAt(d.state.seed, id, d.state.tick + 1);
    if (!pose) break;
    let target: Vec2 = pose.pos;
    let gap = COMET.nucleusRadius + p.props.boundingRadius + 1.5;
    if (shards) {
      const list = cometShards(pose);
      if (shard >= list.length) break;
      target = list[shard]!.pos;
      gap = list[shard]!.radius + front + 1;
    }
    // beside the target, across the comet's motion
    const side = norm({ x: -pose.vel.y, y: pose.vel.x });
    const pos = { x: target.x + side.x * gap - pose.vel.x / TPS, y: target.y + side.y * gap - pose.vel.y / TPS };
    const angle = Math.atan2(-side.y, -side.x);
    d.state.player.body = { pos, vel: { ...pose.vel }, angle, angVel: 0 };
    d.state.player.energy = d.state.player.props.batteryCapacity;
    d.state.player.heat = new Map();
    // rocks the comet sweeps past knock into the ship – the perfect pilot is repaired every step
    d.state.player.hp = new Map();
    d.state.player.prevBody = { ...d.state.player.body };
    // only the comet ore counts (a beam may also touch a rock the comet sweeps past)
    const iceTi = (): number => d.state.player.cargo.ice + d.state.player.cargo.titanium;
    const before = iceTi();
    const coreBefore = d.state.sites.comets.get(id)?.core ?? 0;
    d.step({ ...IDLE_COMMAND, mining: true, aim: { ...target } });
    const st = d.state.sites.comets.get(id);
    const got = shards ? iceTi() - before : Math.max(0, ((st?.core ?? 0) - (st && st.pass === pose.pass ? coreBefore : 0)) * COMET.grade);
    if (shards) out.tail += got;
    else out.core += got;
    if (d.state.tick % TPS === 0) for (const r of RESOURCE_IDS) d.state.player.cargo[r] = 0;
    // a shard is done when it is in the pass bitmask
    if (shards && ((d.state.sites.comets.get(id)?.tail ?? 0) & (1 << shard)) !== 0) shard++;
  }
  return out;
}

/** Four T1 lasers forward (the budget, not the laser time, must be the limit of the probe). */
const COMET_MINER = (): ReturnType<typeof createGrid> =>
  createGrid([
    ['cockpit', 0, 0],
    ['miningLaser', 1, 0],
    ['miningLaser', 1, 1],
    ['miningLaser', 1, -1],
    ['miningLaser', 2, 0],
    ['cargo', 0, 1],
    ['cargo', 0, -1],
    ['reactor', -1, 0],
  ]);

export function cometBudget(seed: number): LoopResult {
  const broken: string[] = [];
  const def = cometDefs(seed)[0]!;
  const win = cometPassWindow(seed, def.id, 60 * 60 * TPS)!;
  const sim = flyingAt(seed, { x: 0, y: 0 }, COMET_MINER());
  // setup: the clock jumps to the start of a pass (a player would wait for it)
  sim.state.tick = win.start + 5 * TPS;
  const d = new Driver(sim);
  const passSeconds = (win.end - win.start) / TPS;
  const part1 = mineComet(d, def.id, Math.min(25, passSeconds * 0.2), false);
  const copy = new Driver(cloneSim(d.sim));
  const restCore = mineComet(d, def.id, passSeconds * 0.5, false);
  const copyCore = mineComet(copy, def.id, passSeconds * 0.5, false);
  // leave and come back in the same pass
  teleport(d.sim, { x: 0, y: 0 });
  d.idle(5);
  const returnCore = mineComet(d, def.id, 20, false);
  const tail = mineComet(d, def.id, Math.max(0, (win.end - d.state.tick) / TPS - 5), true);
  const copy2 = new Driver(cloneSim(d.sim));
  const tail2 = mineComet(copy2, def.id, 10, true);
  const maxCore = COMET.budget * COMET.grade;
  const maxTail = COMET.tail.shards * COMET.tail.units;
  const coreOriginal = part1.core + restCore.core + returnCore.core;
  const coreCopy = part1.core + copyCore.core;
  if (coreOriginal > maxCore + 1) broken.push(`nucleus gave ${coreOriginal.toFixed(0)} ore in one pass (budget ${maxCore})`);
  if (coreCopy > maxCore + 1) broken.push(`nucleus gave ${coreCopy.toFixed(0)} ore over a save copy (budget ${maxCore})`);
  if (tail.tail > maxTail + 1 || tail2.tail > 0.5) broken.push(`tail gave ${tail.tail.toFixed(0)} + ${tail2.tail.toFixed(0)} from a copy (budget ${maxTail})`);
  const detail =
    `${def.id} pass ${win.pass} (${passSeconds.toFixed(0)} s): nucleus ${part1.core.toFixed(0)} + ${restCore.core.toFixed(0)} ore (budget ${COMET.budget} rock × ${COMET.grade} = ${maxCore}), ` +
    `from a save copy made after the first ${part1.core.toFixed(0)}: +${copyCore.core.toFixed(0)}, after leaving and returning +${returnCore.core.toFixed(0)}; ` +
    `tail ${tail.tail.toFixed(0)} ice (budget ${maxTail}), again from a save copy ${tail2.tail.toFixed(0)}; a perfect 4-laser miner beside the nucleus every step (reactor topped up, lasers cooled, hull repaired, the hold emptied every second)`;
  return result('cometBudget', seed, d, broken, detail, { core: coreOriginal, coreCopy, tail: tail.tail, tailCopy: tail2.tail, budget: maxCore });
}

// ------------------------------------------------------------------------------------------------
// S4 – relay charge over a save: a half-charged relay is not more charged after a save → load, a powered
// relay stays powered, and a lit relay pays nothing

function holdOnRelay(d: Driver, relayIndex: number, site: DerelictSite, seconds: number): void {
  const relay = site.relays[relayIndex]!;
  const lens = receiverPos(relay);
  const p = d.state.player;
  const front = Math.max(1, ...p.props.lasers.map((l) => l.offset.x));
  const out = norm({ x: relay.pos.x - site.pos.x, y: relay.pos.y - site.pos.y });
  const pos = { x: relay.pos.x + out.x * (1.5 + front + 3), y: relay.pos.y + out.y * (1.5 + front + 3) };
  teleport(d.sim, pos, Math.atan2(lens.y - pos.y, lens.x - pos.x));
  for (let i = 0; i < Math.round(seconds * TPS); i++) d.step({ ...IDLE_COMMAND, mining: true, aim: { ...lens } } as PlayerCommand);
}

export function relayCharge(seed: number): LoopResult {
  const broken: string[] = [];
  const site = findDerelict(seed, (x) => x.defence === 'none');
  const tap = new Tap();
  const d = tap.attach(new Driver(flyingAt(seed, site.pos)));
  holdOnRelay(d, 0, site, RELAY.powerSeconds * 0.5);
  const half = d.state.sites.charge?.progress ?? 0;
  const copy = new Driver(cloneSim(d.sim));
  const copyHalf = copy.state.sites.charge?.progress ?? 0;
  if (copyHalf > half + 1e-6) broken.push(`charge ${half.toFixed(2)} s became ${copyHalf.toFixed(2)} s after a save → load`);
  holdOnRelay(copy, 0, site, RELAY.powerSeconds);
  const powered = copy.state.sites.powered.has(site.relays[0]!.id);
  const copy2 = new Driver(cloneSim(copy.sim));
  if (powered && !copy2.state.sites.powered.has(site.relays[0]!.id)) broken.push('a powered relay was lost over a save');
  const worth0 = netWorth(copy2.state).total;
  holdOnRelay(copy2, 0, site, RELAY.powerSeconds * 2);
  const gain = netWorth(copy2.state).total - worth0;
  if (gain > 1 || tap.data > 0) broken.push(`a lit relay paid ${gain.toFixed(0)} kr / ${tap.data} D`);
  const detail = `${site.id}: relay ${site.relays[0]!.id} at ${half.toFixed(2)} s of ${RELAY.powerSeconds} s, after save → load ${copyHalf.toFixed(2)} s; powered ${powered ? 'yes' : 'no'}, kept over a save ${copy2.state.sites.powered.has(site.relays[0]!.id) ? 'yes' : 'no'}`;
  return result('relayCharge', seed, copy2, broken, detail, { half, copyHalf, powered: powered ? 1 : 0 }, gain);
}

// ------------------------------------------------------------------------------------------------
// S5 – mine farm: every mine of a graveyard blows once (arm it by flying in, back off); after a save →
// load and after leaving and returning no mine is back; blowing mines pays nothing

export function mineFarm(seed: number): LoopResult {
  const broken: string[] = [];
  const site = findGraveyard(seed, (g) => g.sleepers.length === 0 && g.mines.length > 0);
  const tap = new Tap();
  if (!site) return result('mineFarm', seed, new Driver(flyingAt(seed, { x: 0, y: 2000 })), [], 'no graveyard with mines and without sleepers within 30 chunks', {});
  const d = tap.attach(new Driver(flyingAt(seed, { x: site.pos.x + 400, y: site.pos.y })));
  const worth0 = netWorth(d.state).total;
  const visit = (drv: Driver): void => {
    for (const m of site.mines) {
      // into the arming range, then straight back out of the blast before the fuse runs out
      const out = norm({ x: m.x - site.pos.x, y: m.y - site.pos.y });
      const r = drv.state.player.props.boundingRadius;
      teleport(drv.sim, { x: m.x + out.x * (r + MINE.armRange - 2), y: m.y + out.y * (r + MINE.armRange - 2) });
      drv.step();
      teleport(drv.sim, { x: m.x + out.x * (r + MINE.blastRadius + 30), y: m.y + out.y * (r + MINE.blastRadius + 30) });
      drv.idle(MINE.fuseSeconds + 1);
    }
  };
  visit(d);
  const blown1 = tap.count('mineExploded');
  const copy = tap.attach(new Driver(cloneSim(d.sim)));
  visit(copy);
  teleport(copy.sim, { x: site.pos.x + 3000, y: site.pos.y });
  copy.idle(2);
  visit(copy);
  const blown2 = tap.count('mineExploded') - blown1;
  const gain = netWorth(copy.state).total - worth0;
  if (blown1 > site.mines.length || blown2 > 0) broken.push(`mines blew ${blown1} + ${blown2} times (${site.mines.length} mines)`);
  if (gain > 1 || tap.data > 0) broken.push(`blowing mines paid ${gain.toFixed(0)} kr / ${tap.data} D`);
  const left = graveyardState(copy.state, site.id).mines;
  const detail = `${site.id}: ${site.mines.length} mines, ${blown1} blew on the first pass, ${blown2} again after a save → load and leaving / returning (gone bitmask ${left.toString(2)}); net worth ${gain.toFixed(0)} kr (repairs not paid)`;
  return result('mineFarm', seed, copy, broken, detail, { mines: site.mines.length, blown1, blown2 }, gain);
}

// ------------------------------------------------------------------------------------------------
// S6 – event triggers: `debugEvent` (force a shower or an ambush – farming ambush loot) is a dev hook;
// this process runs the sources like `vite dev`, so the probe forces one and reports the gate. The
// production gate itself is checked by tools/bot/saboteur.test.ts (DEV stubbed to false → refused).

export function eventTriggers(seed: number): LoopResult {
  const d = new Driver(flyingAt(seed, { x: 0, y: 2200 }));
  const dev = !!import.meta.env.DEV;
  const r = d.attempt({ type: 'debugEvent', kind: 'micrometeors' });
  d.idle(1);
  const again = d.attempt({ type: 'debugEvent', kind: 'micrometeors' });
  const detail = `import.meta.env.DEV = ${dev} in the bot process: debugEvent ${r.ok ? 'accepted' : `refused (${r.reason})`}, the same bucket again ${again.ok ? 'accepted' : `refused (${again.reason})`}; production builds refuse it (saboteur.test.ts)`;
  // a finding only when the gate is open outside dev
  return result('eventTriggers', seed, d, !dev && r.ok ? ['debugEvent accepted outside a dev build'] : [], detail, { dev: dev ? 1 : 0, accepted: r.ok ? 1 : 0 });
}

/** Every M4b site probe of one seed. */
export function siteProbes(seed: number): LoopResult[] {
  return [siteTerminal(seed), graveyardFarm(seed), cometBudget(seed), relayCharge(seed), mineFarm(seed), eventTriggers(seed)];
}
