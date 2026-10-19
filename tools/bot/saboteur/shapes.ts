// Saboteur probes for shaped armour (SL2 E2, task B1).
// A shape is a way of laying one armour item, so every probe checks that laying, re-laying, damaging,
// repairing, losing, exporting or mirroring a shape never creates value: reshape fees are paid, damage is
// never rescaled into a free repair, a damaged shaped plate costs what the full plate costs per missing HP,
// a player's own plate comes back as one item, crafted AF2 codes / templates / commits are refused, and a
// mirrored stroke pays for exactly the parts in the draft. Setup steps (a rich player, the Archive node,
// a test ship of another tier for the quote survey) are written directly, like the fleet probes; every
// gain is measured after the setup, through real actions.
import { INSTALL_FEE, partSellPrice, repairCost, scrapResources } from '../../../src/data/economy';
import { partDefOf, type PartInventory, type PartKey, type Tier } from '../../../src/data/parts';
import { RESOURCE_IDS, type Cargo } from '../../../src/data/resources';
import { SHAPE_IDS, SHAPES, type ShapeId } from '../../../src/data/shapes';
import { pieceLoot } from '../../../src/sim/salvage/dismantle';
import { gridToWorld } from '../../../src/sim/combat/geometry';
import { partScrap } from '../../../src/sim/combat/wrecks';
import type { DeathPenalty } from '../../../src/sim/settings';
import { partCenter } from '../../../src/sim/ship/grid';
import { currentHp, fullMaxHp, maxHp } from '../../../src/sim/ship/hp';
import type { PlacedPart, Rotation } from '../../../src/sim/ship/types';
import { draftBaseHash } from '../../../src/sim/shipyard/commit';
import { createDraft } from '../../../src/sim/shipyard/draft';
import { applyEditorOp, mirrorPlacement, type EditorOp } from '../../../src/sim/shipyard/editor';
import { repairQuote } from '../../../src/sim/station/repair';
import { stationStorage } from '../../../src/sim/station/storage';
import { base64UrlEncode, decodeTemplate, encodeTemplate, templateChecksum, TEMPLATE_CODE_PREFIX, TEMPLATE_CODE_PREFIX_V2 } from '../../../src/sim/templates/codec';
import { gridTemplateParts, normalizeParts } from '../../../src/sim/templates/normalize';
import type { TemplatePart } from '../../../src/sim/templates/types';
import { TEMPLATE_CODE_MAX } from '../../../src/data/fleet';
import { HOME_STATION_ID, type StationDef } from '../../../src/sim/world/stations';
import { planFromOps } from '../shipPlan';
import { applyTemplate, ownedParts, partsDiff } from './fleet';
import { cloneSim, Driver, keyOf, newGame, TPS } from './harness';
import { salvageNearestWreck, type LoopResult } from './scenarios';
import { homeSellPrice } from '../pilot';
import { netWorth } from './value';

/** Tolerance of the net-worth comparisons (credits are integers, resources may be fractional). */
const EPS = 1;
const ARMOR: PartKey = 'armor:1';
/** Free cells beside the starter hull: (1,2) touches the fuel tank and the port engine, (1,3) only (1,2). */
const PLATE = { x: 1, y: 2 } as const;
const TIP = { x: 1, y: 3 } as const;
const SHAPES_AND_FULL: readonly (ShapeId | null)[] = [null, ...SHAPE_IDS];
const shapeName = (s: ShapeId | null | undefined): string => s ?? 'full';

/** A new game docked at home with `credits` more credits (setup: an hour of mining skipped). */
function richGame(seed: number, penalty: DeathPenalty, credits: number): Driver {
  const d = new Driver(newGame(seed, penalty));
  d.state.credits += credits;
  return d;
}

const result = (
  id: string,
  seed: number,
  d: Driver,
  gain: number,
  broken: string[],
  detail: string,
  metrics: Record<string, number>,
): LoopResult => ({
  id,
  seed,
  penalty: 'mild',
  seconds: d.state.tick / TPS,
  gain,
  perHour: 0,
  baselinePerHour: null,
  help: {},
  exploit: broken.length > 0 || gain > EPS,
  tick: broken.length ? d.state.tick : null,
  detail: broken.length ? `BROKEN: ${broken.join('; ')} – ${detail}` : detail,
  metrics,
});

const partAt = (d: Driver, x: number, y: number): PlacedPart | undefined => d.state.player.grid.parts.find((p) => p.x === x && p.y === y);

/** Places one part like the shipyard (from storage, else bought / crafted); the new part or null. */
function place(d: Driver, key: PartKey, x: number, y: number, rot: Rotation = 0, shape?: ShapeId): PlacedPart | null {
  const op: EditorOp = { op: 'place', key, x, y, rot, ...(shape ? { shape } : {}) };
  const next = d.state.player.grid.nextId;
  if (!d.commit([op])) return null;
  const p = partAt(d, x, y);
  return p && p.id >= next && keyOf(p) === key && p.shape === shape ? p : null;
}

/** Repair material in the home storage (setup: bought with real actions). */
function buyIron(d: Driver, qty = 60): void {
  d.act({ type: 'buyResource', resource: 'iron', qty });
}

/** A crafted commit (a modified client): the ops as given, against the current base hash. */
function craftedCommit(d: Driver, ops: EditorOp[]): { ok: boolean; reason?: string } {
  const st = d.docked()!;
  const base = createDraft(st.id, d.state.player.grid, d.state.player.hp, stationStorage(d.state, st.id).parts);
  return d.attempt({ type: 'shipyardCommit', baseHash: draftBaseHash(base), ops, acquire: {} });
}

/** What the state a crafted action must not change looks like. */
const snapshot = (d: Driver): string =>
  JSON.stringify([d.state.credits, d.state.player.grid, [...d.state.player.hp], stationStorage(d.state, HOME_STATION_ID), d.state.templates]);

/** Resources the player owns (cargo + home storage), by kind. */
const resourcesOf = (d: Driver): Cargo => {
  const s = stationStorage(d.state, HOME_STATION_ID).resources;
  const out = { ...s };
  for (const r of RESOURCE_IDS) out[r] += d.state.player.cargo[r];
  return out;
};
const resourceDiff = (a: Cargo, b: Cargo): Partial<Cargo> => {
  const out: Partial<Cargo> = {};
  for (const r of RESOURCE_IDS) if (Math.abs(b[r] - a[r]) > 1e-9) out[r] = b[r] - a[r];
  return out;
};
const sameResources = (a: Partial<Cargo>, b: Partial<Cargo>): boolean => RESOURCE_IDS.every((r) => Math.abs((a[r] ?? 0) - (b[r] ?? 0)) < 1e-9);
const scrapValue = (scrap: Partial<Cargo>): number => RESOURCE_IDS.reduce((s, r) => s + (scrap[r] ?? 0) * homeSellPrice(r), 0);

// ------------------------------------------------------------------------------------------------
// SH1 – reshape back and forth: every shape of one plate in turn (and back to full), twice; each
// re-laying is one installation, the plate stays one item at full HP. A damaged plate: a crafted
// reshape that changes the max HP is refused (`reshapeDamaged`); wing L ↔ wing R ↔ full (same max HP)
// carries the damage over unchanged – never healed.

export function shapeReshape(seed: number): LoopResult {
  const d = richGame(seed, 'mild', 20_000);
  const broken: string[] = [];
  const plate = place(d, ARMOR, PLATE.x, PLATE.y);
  if (!plate) return result('shapeReshape', seed, d, 0, ['setup: plate not placed'], 'setup failed', {});
  const id = plate.id;
  const w0 = netWorth(d.state).total;
  const parts0 = ownedParts(d.state);
  let reshapes = 0;
  let skipped = 0;
  let fees = 0;
  const reshape = (shape: ShapeId | null): boolean => {
    const c = d.state.credits;
    if (!d.commit([{ op: 'reshape', id, shape }])) return false;
    const paid = c - d.state.credits;
    fees += paid;
    if (paid !== INSTALL_FEE) broken.push(`reshape to ${shapeName(shape)} cost ${paid} kr, not ${INSTALL_FEE}`);
    const p = d.state.player.grid.parts.find((x) => x.id === id);
    if (!p || (p.shape ?? null) !== shape) broken.push(`reshape to ${shapeName(shape)} not applied`);
    else if (currentHp(d.state.player.hp, p) !== maxHp(p)) broken.push(`${shapeName(shape)} not at full HP after a reshape`);
    return true;
  };
  for (let lap = 0; lap < 2; lap++) {
    for (const s of [...SHAPE_IDS, null]) {
      if (reshape(s)) reshapes++;
      else skipped++;
    }
  }
  // a reshape to the shape it already has is no change: nothing to pay
  const same = planFromOps(d.state, d.docked()!, [{ op: 'reshape', id, shape: null }]);
  if (same.report.cost.credits !== 0 || same.report.cost.installCount !== 0) broken.push('a reshape to the same shape is charged');
  const diff = partsDiff(parts0, ownedParts(d.state));
  if (Object.keys(diff).length) broken.push(`parts changed ${JSON.stringify(diff)}`);
  const cleanGain = netWorth(d.state).total - w0 + fees;

  // damaged: 50 % HP
  d.act({ type: 'debugDamage', partId: id, hp: maxHp(plate) / 2 });
  const w1 = netWorth(d.state).total;
  const fees1 = fees;
  const damage0 = maxHp(plate) - currentHp(d.state.player.hp, plate);
  let refused = 0;
  for (const s of SHAPE_IDS) {
    if (s === 'wingL' || s === 'wingR') continue;
    const plan = planFromOps(d.state, d.docked()!, [{ op: 'reshape', id, shape: s }]);
    const flagged = plan.report.errors.some((e) => e.code === 'reshapeDamaged');
    const before = snapshot(d);
    const r = craftedCommit(d, [{ op: 'reshape', id, shape: s }]);
    if (!flagged) broken.push(`damaged full → ${s} not flagged reshapeDamaged`);
    if (r.ok) broken.push(`a crafted reshape of a damaged plate to ${s} committed`);
    else if (snapshot(d) !== before) broken.push(`a refused reshape to ${s} changed the state`);
    else refused++;
  }
  // same max HP: allowed, the damage stays
  let carried = 0;
  for (const s of ['wingL', 'wingR', null] as const) {
    const c = d.state.credits;
    if (!d.commit([{ op: 'reshape', id, shape: s }])) {
      broken.push(`damaged plate → ${shapeName(s)} (same max HP) refused`);
      continue;
    }
    fees += c - d.state.credits;
    const p = d.state.player.grid.parts.find((x) => x.id === id)!;
    const damage = maxHp(p) - currentHp(d.state.player.hp, p);
    if (Math.abs(damage - damage0) > 1e-9) broken.push(`damage ${damage0} → ${damage} HP after → ${shapeName(s)}`);
    else carried++;
  }
  // a damaged wing to a shape with another max HP is refused as well
  d.commit([{ op: 'reshape', id, shape: 'wingL' }]);
  fees += INSTALL_FEE;
  const wingRefused = !craftedCommit(d, [{ op: 'reshape', id, shape: 'nose2x1' }]).ok;
  if (!wingRefused) broken.push('a damaged wing reshaped to a nose 2×1');
  const gain = netWorth(d.state).total - w1 + (fees - fees1);
  return result(
    'shapeReshape',
    seed,
    d,
    Math.max(gain, cleanGain),
    broken,
    `${reshapes} reshapes over every shape twice (${skipped} that do not fit skipped), each ${INSTALL_FEE} kr, the plate one item at full HP; a damaged plate: ${refused}/7 crafted reshapes that change the max HP refused, ${carried}/3 wing L ↔ wing R ↔ full kept the ${damage0} HP of damage; a damaged wing → nose 2×1 ${wingRefused ? 'refused' : 'COMMITTED'}; net worth beyond the fees ${Math.round(gain)} kr`,
    { reshapes, skipped, fees, refused, carried, gain: Math.round(gain) },
  );
}

// ------------------------------------------------------------------------------------------------
// SH2 – damaged-plate arbitrage survey (quotes, every tier × ring × shape × damage): the station repair
// of a damaged plate vs Tab to another shape (remove + place: the repair is priced, the new shape starts
// at full HP) and Tab back (one more installation). The Tab route must never be cheaper than the station
// repair, and the repair of a shaped plate must cost what the full plate costs for the same missing HP
// (parity, up to the integer rounding of the repair price and of the shaped max HP).

export interface ShapeRepairRow {
  tier: Tier;
  shape: ShapeId | null;
  /** Largest (shaped − full) repair difference for the same missing HP, in credits / material units. */
  maxCredits: number;
  minCredits: number;
  maxMaterial: number;
  minMaterial: number;
}

export function shapeRepairSurvey(seed: number): { result: LoopResult; rows: ShapeRepairRow[] } {
  const d = richGame(seed, 'mild', 50_000);
  const broken: string[] = [];
  const home = d.docked()!;
  const rows: ShapeRepairRow[] = [];
  let quotes = 0;
  let tabRoutes = 0;
  let cheapestMargin = Infinity;
  const base = d.state.player.grid;
  for (const tier of [1, 2] as const) {
    const key = `armor:${tier}` as PartKey;
    const full = partDefOf(key).hp;
    for (const shape of SHAPES_AND_FULL) {
      // setup: the test plate laid straight into the hull (a T3 plate cannot be bought at home)
      const placed = applyEditorOp(base, { op: 'place', key, x: PLATE.x, y: PLATE.y, rot: 0, ...(shape ? { shape } : {}) });
      if (!placed.ok) {
        broken.push(`setup: ${key} ${shapeName(shape)} does not fit`);
        continue;
      }
      const sim = cloneSim(d.sim);
      sim.state.player.grid = placed.grid;
      // setup: repair material in storage, so the shipyard prices a repair (not the scrap of a broke player)
      const store = stationStorage(sim.state, HOME_STATION_ID).resources;
      for (const r of RESOURCE_IDS) store[r] += 1000;
      const p = placed.grid.parts.find((x) => x.x === PLATE.x && x.y === PLATE.y)!;
      const max = maxHp(p);
      const row: ShapeRepairRow = { tier, shape, maxCredits: -Infinity, minCredits: Infinity, maxMaterial: -Infinity, minMaterial: Infinity };
      for (const q of [0.1, 0.5, 0.9]) {
        const hp = Math.max(1, Math.round(max * q));
        sim.state.player.hp = new Map([[p.id, hp]]);
        const missing = max - hp;
        for (const ring of [1, 2, 3, 4] as const) {
          const st: StationDef = { ...home, ring };
          const station = repairQuote(sim.state, st, [p.id], false);
          const line = station.lines[0];
          if (!line) {
            broken.push(`no repair quote for ${key} ${shapeName(shape)}`);
            continue;
          }
          quotes++;
          // parity with the full plate missing the same HP (only while the full plate could miss that much)
          if (missing < full) {
            const ref = repairCost(key, full - missing, full, ring);
            row.maxCredits = Math.max(row.maxCredits, line.credits - ref.credits);
            row.minCredits = Math.min(row.minCredits, line.credits - ref.credits);
            row.maxMaterial = Math.max(row.maxMaterial, line.amount - ref.amount);
            row.minMaterial = Math.min(row.minMaterial, line.amount - ref.amount);
          }
          // Tab to every other shape: remove + place (the editor's stroke for a damaged plate) – then
          // back to the original shape at full HP (one more installation)
          for (const other of SHAPES_AND_FULL) {
            if (other === shape) continue;
            const ops: EditorOp[] = [{ op: 'remove', id: p.id }, { op: 'place', key, x: p.x, y: p.y, rot: p.rot, ...(other ? { shape: other } : {}) }];
            const plan = planFromOps(sim.state, st, ops);
            if (plan.ops.length < 2) continue; // the other footprint does not fit here
            tabRoutes++;
            const cost = plan.report.cost;
            const repaired = cost.repairs.find((r) => r.id === p.id);
            if (!repaired) broken.push(`Tab ${key} ${shapeName(shape)} → ${shapeName(other)}: no repair priced`);
            else if (repaired.credits !== line.credits || repaired.amount !== line.amount) broken.push(`Tab ${key} ${shapeName(shape)} → ${shapeName(other)} ring ${ring}: repair ${repaired.credits} kr + ${repaired.amount} u vs station ${line.credits} kr + ${line.amount} u`);
            if (Object.keys(cost.buy).length || Object.keys(cost.craft).length) broken.push(`Tab ${key} ${shapeName(shape)} → ${shapeName(other)}: a new plate bought / crafted`);
            const tab = cost.credits + INSTALL_FEE; // and back
            cheapestMargin = Math.min(cheapestMargin, tab - line.credits);
            if (tab < line.credits || (repaired && repaired.amount < line.amount)) broken.push(`Tab route cheaper than the station repair (${key} ${shapeName(shape)} → ${shapeName(other)}, ring ${ring})`);
          }
        }
      }
      rows.push(row);
    }
  }
  const worstCredits = Math.max(...rows.map((r) => Math.max(Math.abs(r.maxCredits), Math.abs(r.minCredits))));
  const worstMaterial = Math.max(...rows.map((r) => Math.max(Math.abs(r.maxMaterial), Math.abs(r.minMaterial))));
  // parity holds up to one rounding step of the price (ceil) and of the shaped max HP
  if (worstCredits > 2 || worstMaterial > 1) broken.push(`repair parity off by ${worstCredits} kr / ${worstMaterial} u`);
  return {
    result: result(
      'shapeRepairSurvey',
      seed,
      d,
      cheapestMargin === Infinity ? 0 : -cheapestMargin,
      broken,
      `${quotes} station repair quotes (T1–T2 × full + 9 shapes × 10/50/90 % HP × rings 1–4) and ${tabRoutes} Tab routes (remove + place in another shape, then back): the Tab route always pays the same repair plus ≥ 2 installations (cheapest margin ${cheapestMargin} kr over the station repair); a shaped plate's repair vs the full plate missing the same HP differs by at most ${worstCredits} kr / ${worstMaterial} u (rounding)`,
      { quotes, tabRoutes, cheapestMargin, worstCredits, worstMaterial },
    ),
    rows,
  };
}

// ------------------------------------------------------------------------------------------------
// SH3 – removing a damaged wedge: the repair it is charged equals the full plate's with the same missing
// HP (and the station repair of the wedge); when the repair is unaffordable it scraps like that full
// plate; the plate goes to storage as one plain item.

function removalBranch(
  seed: number,
  shape: ShapeId | undefined,
  missing: number,
  poor: boolean,
): { paid: number; resources: Partial<Cargo>; parts: Partial<Record<PartKey, number>>; end: number; ok: boolean } {
  const d = richGame(seed, 'mild', 20_000);
  const p = place(d, ARMOR, PLATE.x, PLATE.y, 0, shape);
  if (!p) return { paid: 0, resources: {}, parts: {}, end: 0, ok: false };
  if (!poor) buyIron(d);
  d.act({ type: 'debugDamage', partId: p.id, hp: maxHp(p) - missing });
  if (poor) {
    // a broke player: the storage sold, the credits burnt – the repair is unaffordable, the plate scraps
    d.sellCargo();
    d.burnCredits();
  }
  const c0 = d.state.credits;
  const r0 = resourcesOf(d);
  const parts0 = ownedParts(d.state);
  const ok = d.commit([{ op: 'remove', id: p.id }]);
  return { paid: c0 - d.state.credits, resources: resourceDiff(r0, resourcesOf(d)), parts: partsDiff(parts0, ownedParts(d.state)), end: netWorth(d.state).total, ok };
}

export function shapeRemoveDamaged(seed: number): LoopResult {
  const broken: string[] = [];
  const wedgeMax = Math.round(partDefOf(ARMOR).hp * SHAPES.wedge.area);
  const missing = wedgeMax / 2;
  const wedge = removalBranch(seed, 'wedge', missing, false);
  const full = removalBranch(seed, undefined, missing, false);
  if (!wedge.ok || !full.ok) broken.push(`removal refused (wedge ${wedge.ok}, full ${full.ok})`);
  if (wedge.paid !== full.paid) broken.push(`repair on removal: wedge ${wedge.paid} kr vs full plate ${full.paid} kr`);
  if (!sameResources(wedge.resources, full.resources)) broken.push(`repair material: wedge ${JSON.stringify(wedge.resources)} vs full ${JSON.stringify(full.resources)}`);
  if (wedge.parts[ARMOR] !== 0 && wedge.parts[ARMOR] !== undefined) broken.push(`the wedge changed the armour count by ${wedge.parts[ARMOR]}`);
  // the station repair of the same wedge, then the removal (free): the same total
  const d = richGame(seed, 'mild', 20_000);
  const p = place(d, ARMOR, PLATE.x, PLATE.y, 0, 'wedge')!;
  buyIron(d);
  d.act({ type: 'debugDamage', partId: p.id, hp: maxHp(p) - missing });
  const c0 = d.state.credits;
  const repaired = d.act({ type: 'repair', partIds: [p.id], autoBuy: false });
  d.commit([{ op: 'remove', id: p.id }]);
  const stationPaid = c0 - d.state.credits;
  if (!repaired) broken.push('station repair refused');
  else if (stationPaid !== wedge.paid) broken.push(`station repair + removal ${stationPaid} kr vs removal with repair ${wedge.paid} kr`);
  // broke: scrapped – the same scrap as the full plate missing the same HP
  const wedgePoor = removalBranch(seed, 'wedge', missing, true);
  const fullPoor = removalBranch(seed, undefined, missing, true);
  if (!wedgePoor.ok || !fullPoor.ok) broken.push(`broke removal refused (wedge ${wedgePoor.ok}, full ${fullPoor.ok})`);
  if (!sameResources(wedgePoor.resources, fullPoor.resources)) broken.push(`scrap: wedge ${JSON.stringify(wedgePoor.resources)} vs full plate ${JSON.stringify(fullPoor.resources)}`);
  const expectedScrap = scrapResources(ARMOR, partDefOf(ARMOR).hp - missing, partDefOf(ARMOR).hp);
  if (!sameResources(wedgePoor.resources, expectedScrap)) broken.push(`wedge scrap ${JSON.stringify(wedgePoor.resources)}, expected ${JSON.stringify(expectedScrap)}`);
  // the wedge's removal leaves the player no richer than the full plate's (same missing HP, same start)
  const gain = Math.max(wedge.end - full.end, wedgePoor.end - fullPoor.end);
  return result(
    'shapeRemoveDamaged',
    seed,
    d,
    gain,
    broken,
    `a wedge missing ${missing} of ${wedgeMax} HP removed: repair ${wedge.paid} kr + ${JSON.stringify(wedge.resources)} = the full plate missing ${missing} of ${partDefOf(ARMOR).hp} HP (${full.paid} kr) = station repair + removal (${stationPaid} kr), one plain plate to storage; broke: scrapped to ${JSON.stringify(wedgePoor.resources)} = the full plate's scrap; net worth wedge − full ${Math.round(gain)} kr`,
    { missing, wedgePaid: wedge.paid, fullPaid: full.paid, stationPaid, gain: Math.round(gain) },
  );
}

// ------------------------------------------------------------------------------------------------
// SH4 – loot of the player's own wedges: a wedge hanging on a plate; the plate is shot off (setup: one
// pirate shot exactly at the plate's HP), the wedge drifts away in a wreck and is loaded back. One item
// went in, one comes out (intact); a damaged wedge comes back as the full plate's scrap for the same
// missing HP. Plus the cut rule (laser cutting of the player's own wreck pieces), compared by value.

function shootPlate(d: Driver, plate: PlacedPart): void {
  const p = d.state.player;
  const at = gridToWorld(p.body, p.props.centerOfMass, partCenter(plate));
  const ahead = gridToWorld(p.body, p.props.centerOfMass, { x: plate.x + 3, y: plate.y });
  const dir = { x: at.x - ahead.x, y: at.y - ahead.y };
  const len = Math.hypot(dir.x, dir.y);
  const speed = 300;
  d.state.combat.projectiles.push({
    id: 990_001,
    owner: 'pr:saboteur:0',
    pos: ahead,
    vel: { x: (dir.x / len) * speed + p.body.vel.x, y: (dir.y / len) * speed + p.body.vel.y },
    ttl: 6,
    damage: maxHp(plate),
    tier: 1,
    origin: ahead,
  });
  d.idle(0.5);
}

interface LootRun {
  ok: boolean;
  note: string;
  wreckParts: PartInventory;
  wreckScrap: Partial<Cargo>;
  loaded: boolean;
  armorDiff: number;
  worthDiff: number;
}

function lootRun(seed: number, wedgeHp: number | null): LootRun {
  const d = richGame(seed, 'mild', 20_000);
  const fail = (note: string): LootRun => ({ ok: false, note, wreckParts: {}, wreckScrap: {}, loaded: false, armorDiff: 0, worthDiff: 0 });
  const plate = place(d, ARMOR, PLATE.x, PLATE.y);
  const wedge = plate && place(d, ARMOR, TIP.x, TIP.y, 0, 'wedge');
  if (!plate || !wedge) return fail('setup: plate / wedge not placed');
  if (wedgeHp !== null) d.act({ type: 'debugDamage', partId: wedge.id, hp: wedgeHp });
  const home = d.docked()!;
  d.undock();
  d.flyTo({ x: home.pos.x + 160, y: home.pos.y + 60 }, { seconds: 40 });
  d.idleUntil(() => Math.hypot(d.state.player.body.vel.x, d.state.player.body.vel.y) < 0.5, 10);
  const parts0 = ownedParts(d.state);
  const w0 = netWorth(d.state).total;
  const wrecks0 = new Set(d.state.combat.wrecks.map((w) => w.id));
  shootPlate(d, plate);
  const grid = d.state.player.grid.parts;
  if (grid.some((p) => p.id === plate.id)) return fail('the shot did not destroy the plate');
  if (grid.some((p) => p.id === wedge.id)) return fail('the wedge stayed on the hull');
  const wreck = d.state.combat.wrecks.find((w) => !wrecks0.has(w.id) && w.grid.parts.some((p) => p.shape === 'wedge'));
  if (!wreck) return fail('no wreck with the wedge');
  const wreckParts = { ...wreck.loot.parts };
  const wreckScrap: Partial<Cargo> = {};
  for (const r of RESOURCE_IDS) if (wreck.loot.cargo[r] > 0) wreckScrap[r] = wreck.loot.cargo[r];
  const loaded = salvageNearestWreck(d);
  const diff = partsDiff(parts0, ownedParts(d.state));
  // the destroyed plate is gone (−1); the wedge comes back as one plate (intact) or as scrap (damaged)
  return { ok: true, note: '', wreckParts, wreckScrap, loaded, armorDiff: diff[ARMOR] ?? 0, worthDiff: netWorth(d.state).total - w0 };
}

export function shapeLoot(seed: number): LoopResult {
  const broken: string[] = [];
  const d = new Driver(newGame(seed, 'mild'));
  const intact = lootRun(seed, null);
  const wedgeMax = Math.round(partDefOf(ARMOR).hp * SHAPES.wedge.area);
  const damagedHp = wedgeMax / 2;
  const damaged = lootRun(seed, damagedHp);
  if (!intact.ok) broken.push(`intact: ${intact.note}`);
  if (!damaged.ok) broken.push(`damaged: ${damaged.note}`);
  if (intact.ok) {
    if (JSON.stringify(intact.wreckParts) !== JSON.stringify({ [ARMOR]: 1 })) broken.push(`intact wedge loot ${JSON.stringify(intact.wreckParts)}`);
    if (!intact.loaded) broken.push('intact wedge not loaded');
    // mounted plate + wedge (2) → the wedge as one item in the hold: −1 (the destroyed plate)
    if (intact.armorDiff !== -1) broken.push(`armour count ${intact.armorDiff} after loading the wedge (expected −1: the destroyed plate)`);
  }
  const fullHp = partDefOf(ARMOR).hp;
  const expectScrap = scrapResources(ARMOR, fullHp - (wedgeMax - damagedHp), fullHp);
  if (damaged.ok) {
    if (Object.keys(damaged.wreckParts).length) broken.push(`a damaged wedge dropped as a part ${JSON.stringify(damaged.wreckParts)}`);
    if (!sameResources(damaged.wreckScrap, expectScrap)) broken.push(`damaged wedge scrap ${JSON.stringify(damaged.wreckScrap)}, expected the full plate's ${JSON.stringify(expectScrap)}`);
    if (damaged.armorDiff !== -2) broken.push(`armour count ${damaged.armorDiff} after a damaged wedge (expected −2)`);
  }
  // the cut rule: a player's piece cut by the laser (not intact) – value of the scrap vs the plate item
  let cutWorst = -Infinity;
  const cutNotes: string[] = [];
  for (const s of SHAPES_AND_FULL) {
    const part: PlacedPart = { id: 1, partId: 'armor', tier: 1, x: 0, y: 0, rot: 0, ...(s ? { shape: s } : {}) };
    const cut = scrapValue(pieceLoot([part], new Set(), 'player').cargo);
    const whole = pieceLoot([part], new Set([1]), 'player');
    if (JSON.stringify(whole.parts) !== JSON.stringify({ [ARMOR]: 1 })) broken.push(`an intact ${shapeName(s)} piece drops ${JSON.stringify(whole.parts)}`);
    cutWorst = Math.max(cutWorst, cut - partSellPrice(ARMOR));
    if (s === null || s === 'wedge' || s === 'nose2x1') cutNotes.push(`${shapeName(s)} ${Math.round(cut)} kr`);
    // a player's damaged shaped plate in a wreck scraps like the full plate missing the same HP
    if (s) {
      const p = part as PlacedPart & { shape: ShapeId };
      const hp = maxHp(p) / 2;
      const got = partScrap(p, hp, 'player');
      const ref = scrapResources(ARMOR, Math.max(0, fullMaxHp(p) - (maxHp(p) - hp)), fullMaxHp(p));
      if (!sameResources(got, ref)) broken.push(`${s} scrap ${JSON.stringify(got)} vs ${JSON.stringify(ref)}`);
    }
  }
  if (cutWorst > 0) broken.push(`cutting a plate is worth more than the plate (${cutWorst} kr)`);
  // gains: the intact wedge beyond the destroyed plate's loss; the damaged wedge's scrap beyond the full
  // plate's for the same missing HP; a cut plate's scrap beyond the plate item
  const gain = Math.max(intact.ok ? intact.worthDiff + partSellPrice(ARMOR) : 0, damaged.ok ? scrapValue(damaged.wreckScrap) - scrapValue(expectScrap) : 0, cutWorst);
  return result(
    'shapeLoot',
    seed,
    d,
    gain,
    broken,
    `a wedge shot off with its plate: intact → wreck loot ${JSON.stringify(intact.wreckParts)}, loaded ${intact.loaded}, armour count ${intact.armorDiff} (only the destroyed plate lost); damaged ${damagedHp}/${wedgeMax} HP → scrap ${JSON.stringify(damaged.wreckScrap)} = the full plate's scrap for the same missing HP; laser-cut pieces (not intact) scrap to ${cutNotes.join(', ')} – below the plate item (${partSellPrice(ARMOR)} kr)`,
    { intactArmor: intact.armorDiff, damagedArmor: damaged.armorDiff, loaded: intact.loaded ? 1 : 0, cutWorst: Math.round(cutWorst) },
  );
}

// ------------------------------------------------------------------------------------------------
// SH5 – crafted shapes: AF2 codes (shape on a cannon, unknown shape code, a `t` key, huge / negative /
// fractional indexes and cells, wrong versions), crafted template saves and crafted shipyard commits
// (shapes on parts that cannot have them, unknown shapes, reshaping the cockpit or a missing part).

function signedV2(payload: unknown): string {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${TEMPLATE_CODE_PREFIX_V2}${body}.${templateChecksum(body)}`;
}
function signedV1(payload: unknown): string {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${TEMPLATE_CODE_PREFIX}${body}.${templateChecksum(body)}`;
}

/** Template data for the Archive node and a template slot (setup). */
function withTemplates(d: Driver, broken: string[]): void {
  d.state.discovery.dataFund += 100;
  d.state.discovery.dataTotal += 100;
  if (!d.attempt({ type: 'archiveBuy', node: 'templates' }).ok) broken.push('Archive node "templates" refused');
}

export function shapeCrafted(seed: number): LoopResult {
  const d = richGame(seed, 'mild', 20_000);
  const broken: string[] = [];
  withTemplates(d, broken);
  const starter = normalizeParts(gridTemplateParts(d.state.player.grid))!;
  const keys = [...new Set(starter.map((p) => p[0]))];
  const ix = (k: PartKey): number => keys.indexOf(k);
  const p = starter.map((t) => [ix(t[0]), t[1], t[2], t[3]] as unknown[]);
  const withK = (extra: PartKey[]): PartKey[] => [...keys, ...extra.filter((k) => !keys.includes(k))];
  const k2 = withK(['cannon:1', ARMOR]);
  const at = (k: PartKey): number => k2.indexOf(k);
  const codes: [string, string, string][] = [
    ['shape on a cannon', signedV2({ v: 2, n: 'X', k: k2, p: [...p, [at('cannon:1'), PLATE.x, PLATE.y, 0, 'w']] }), 'shapeNotAllowed'],
    ['shape on the cockpit', signedV2({ v: 2, n: 'X', k: keys, p: p.map((t) => (keys[t[0] as number] === 'cockpit:1' ? [...t, 'n'] : t)) }), 'shapeNotAllowed'],
    ['unknown shape code', signedV2({ v: 2, n: 'X', k: k2, p: [...p, [at(ARMOR), PLATE.x, PLATE.y, 0, 'zz']] }), 'unknownShape'],
    ['shape code a number', signedV2({ v: 2, n: 'X', k: k2, p: [...p, [at(ARMOR), PLATE.x, PLATE.y, 0, 7]] }), 'format'],
    ['a superstructure `t` key', signedV2({ v: 2, n: 'X', k: k2, p: [...p, [at(ARMOR), PLATE.x, PLATE.y, 0, 'w']], t: [[0, 0, 0, 0]] }), 'version'],
    ['huge key index', signedV2({ v: 2, n: 'X', k: k2, p: [...p, [1_000_000_000, PLATE.x, PLATE.y, 0, 'w']] }), 'format'],
    ['negative key index', signedV2({ v: 2, n: 'X', k: k2, p: [...p, [-1, PLATE.x, PLATE.y, 0, 'w']] }), 'format'],
    ['fractional key index', signedV2({ v: 2, n: 'X', k: k2, p: [...p, [0.5, PLATE.x, PLATE.y, 0, 'w']] }), 'format'],
    ['huge cell', signedV2({ v: 2, n: 'X', k: k2, p: [...p, [at(ARMOR), 1_000_000_000, PLATE.y, 0, 'w']] }), 'outOfBounds'],
    ['unsafe-integer cell', signedV2({ v: 2, n: 'X', k: k2, p: [...p, [at(ARMOR), 2 ** 60, PLATE.y, 0, 'w']] }), 'format'],
    ['rotation 4', signedV2({ v: 2, n: 'X', k: k2, p: [...p, [at(ARMOR), PLATE.x, PLATE.y, 4, 'w']] }), 'format'],
    ['six-element part', signedV2({ v: 2, n: 'X', k: k2, p: [...p, [at(ARMOR), PLATE.x, PLATE.y, 0, 'w', 'w']] }), 'format'],
    ['duplicate dictionary key', signedV2({ v: 2, n: 'X', k: [...k2, ARMOR], p: [...p, [at(ARMOR), PLATE.x, PLATE.y, 0, 'w']] }), 'format'],
    ['unknown dictionary key', signedV2({ v: 2, n: 'X', k: [...k2, 'armor:9'], p: [...p, [at(ARMOR), PLATE.x, PLATE.y, 0, 'w']] }), 'unknownPart'],
    ['version 1 in an AF2 code', signedV2({ v: 1, n: 'X', k: k2, p: [...p, [at(ARMOR), PLATE.x, PLATE.y, 0, 'w']] }), 'version'],
    ['shape in an AF1 code', signedV1({ v: 1, n: 'X', p: [...starter, [ARMOR, PLATE.x, PLATE.y, 0, 'wedge']] }), 'format'],
    ['nose 2×1 over the hull', signedV2({ v: 2, n: 'X', k: k2, p: [...p, [at(ARMOR), 0, 1, 0, 'n2']] }), 'overlap'],
    ['too long', signedV2({ v: 2, n: 'X'.repeat(TEMPLATE_CODE_MAX), k: k2, p }), 'tooLong'],
  ];
  let checks = 0;
  for (const [label, code, expected] of codes) {
    checks++;
    const r = decodeTemplate(code);
    if (r.ok) broken.push(`code with ${label} decoded`);
    else if (r.error !== expected) broken.push(`code with ${label}: ${r.error} instead of ${expected}`);
  }
  // positive control: the same plate as a real wedge decodes
  const good = decodeTemplate(signedV2({ v: 2, n: 'Klin', k: k2, p: [...p, [at(ARMOR), PLATE.x, PLATE.y, 0, 'w']] }));
  if (!good.ok || !good.template.parts.some((t) => t[4] === 'wedge')) broken.push('a valid AF2 code refused');

  // crafted template saves
  const badSaves: [string, unknown][] = [
    ['shape on a cannon', [...starter, ['cannon:1', PLATE.x, PLATE.y, 0, 'wedge']]],
    ['unknown shape', [...starter, [ARMOR, PLATE.x, PLATE.y, 0, 'blob']]],
    ['shape code instead of id', [...starter, [ARMOR, PLATE.x, PLATE.y, 0, 'w']]],
    ['six-element part', [...starter, [ARMOR, PLATE.x, PLATE.y, 0, 'wedge', 1]]],
    ['nose 2×1 over the hull', [...starter, [ARMOR, 0, 1, 0, 'nose2x1']]],
  ];
  for (const [label, parts] of badSaves) {
    checks++;
    const before = snapshot(d);
    const r = d.attempt({ type: 'templateSave', name: label, parts: parts as TemplatePart[] });
    if (r.ok || r.reason !== 'invalidTemplate') broken.push(`templateSave with ${label}: ${r.ok ? 'accepted' : r.reason}`);
    if (snapshot(d) !== before) broken.push(`templateSave with ${label} changed the state`);
  }
  // crafted shipyard commits
  const cockpit = d.state.player.grid.parts.find((x) => x.partId === 'cockpit')!;
  const radar = d.state.player.grid.parts.find((x) => x.partId === 'radar')!;
  const badOps: [string, EditorOp[]][] = [
    ['a cannon laid as a wedge', [{ op: 'place', key: 'cannon:1', x: PLATE.x, y: PLATE.y, rot: 0, shape: 'wedge' }]],
    ['an unknown shape', [{ op: 'place', key: ARMOR, x: PLATE.x, y: PLATE.y, rot: 0, shape: 'blob' as ShapeId }]],
    ['the cockpit reshaped', [{ op: 'reshape', id: cockpit.id, shape: 'nose' }]],
    ['the radar reshaped', [{ op: 'reshape', id: radar.id, shape: 'wedge' }]],
    ['a missing part reshaped', [{ op: 'reshape', id: 9999, shape: 'wedge' }]],
    ['an unknown shape on a reshape', [{ op: 'reshape', id: radar.id, shape: 'blob' as ShapeId }]],
  ];
  for (const [label, ops] of badOps) {
    checks++;
    const before = snapshot(d);
    const r = craftedCommit(d, ops);
    if (r.ok) broken.push(`a commit with ${label} accepted`);
    if (snapshot(d) !== before) broken.push(`a refused commit with ${label} changed the state`);
  }
  return result(
    'shapeCrafted',
    seed,
    d,
    0,
    broken,
    `${checks} crafted AF2 codes (shape on a cannon / the cockpit, unknown or numeric shape code, \`t\` key, huge / negative / fractional index, huge cell, rotation 4, 6-tuples, duplicate / unknown keys, wrong version, a shape in AF1, overlap, too long), template saves and shipyard commits refused with the expected error, state unchanged; a valid AF2 wedge decodes`,
    { checks },
  );
}

// ------------------------------------------------------------------------------------------------
// SH6 – a template with shapes through save → load: the saved template, its AF2 code and the ship it
// builds are identical before and after; applying it pays the quote (every plate bought, crafted or
// taken from storage, every installation paid) on the original and on the copy alike.

export function shapeTemplates(seed: number): LoopResult {
  const d = richGame(seed, 'mild', 30_000);
  const broken: string[] = [];
  withTemplates(d, broken);
  const built = place(d, ARMOR, PLATE.x, PLATE.y, 0, 'chamfer') && place(d, ARMOR, TIP.x, TIP.y, 1, 'wedge') && place(d, ARMOR, 3, 0, 0, 'nose');
  if (!built) return result('shapeTemplates', seed, d, 0, ['setup: shaped plates not placed'], 'setup failed', {});
  const parts = normalizeParts(gridTemplateParts(d.state.player.grid))!;
  if (!d.attempt({ type: 'templateSave', name: 'Klin', parts }).ok) broken.push('templateSave with shapes refused');
  const saved = d.state.templates.at(-1)!;
  const code = encodeTemplate(saved);
  if (!code.startsWith(TEMPLATE_CODE_PREFIX_V2)) broken.push(`a shaped template exports as ${code.slice(0, 4)}`);
  const copy = new Driver(cloneSim(d.sim));
  const savedCopy = copy.state.templates.at(-1);
  if (JSON.stringify(savedCopy) !== JSON.stringify(saved)) broken.push('save → load changed the template');
  if (savedCopy && encodeTemplate(savedCopy) !== code) broken.push('save → load changed the AF2 code');
  const decoded = decodeTemplate(code);
  if (!decoded.ok || JSON.stringify(decoded.template.parts) !== JSON.stringify(saved.parts)) broken.push('the AF2 code does not decode to the saved parts');
  // strip both ships, sell the parts, build the template on each: the same price, the same ship
  const runs = [d, copy].map((drv) => {
    drv.stripToMinimum();
    drv.sellStorageParts();
    return applyTemplate(drv, saved, true);
  });
  for (const r of runs) broken.push(...r.broken);
  const [a, b] = runs as [ReturnType<typeof applyTemplate>, ReturnType<typeof applyTemplate>];
  if (!a.committed || !b.committed) broken.push(`template build refused (original ${a.committed}, copy ${b.committed})`);
  if (a.paid !== b.paid) broken.push(`template build paid ${a.paid} kr, from the save copy ${b.paid} kr`);
  const shipA = JSON.stringify(normalizeParts(gridTemplateParts(d.state.player.grid)));
  const shipB = JSON.stringify(normalizeParts(gridTemplateParts(copy.state.player.grid)));
  if (shipA !== shipB) broken.push('the save copy built another ship');
  if (shipA !== JSON.stringify(saved.parts)) broken.push('the built ship differs from the template');
  const shaped = d.state.player.grid.parts.filter((x) => x.shape).length;
  return result(
    'shapeTemplates',
    seed,
    d,
    Math.max(a.gain, b.gain),
    broken,
    `a template with ${shaped} shaped plates (chamfer, wedge, nose) saved, exported as AF2, identical after save → load (template, code, decode); built on a stripped hull for ${a.paid} kr = the quote, from the save copy for ${b.paid} kr, the same ship`,
    { shaped, paid: a.paid, paidCopy: b.paid },
  );
}

// ------------------------------------------------------------------------------------------------
// SH7 – mirror mode with too few plates: a wing L with its mirrored wing R in one stroke while the storage
// holds one plate – the second is bought or crafted and paid, the quote is what is paid; when the mirror
// copy does not fit, only the original is in the draft and only it is paid.

export function shapeMirror(seed: number): LoopResult {
  const d = richGame(seed, 'mild', 20_000);
  const broken: string[] = [];
  const st = d.docked()!;
  const stock = stationStorage(d.state, st.id).parts[ARMOR] ?? 0;
  if (stock > 1) d.act({ type: 'sellPart', key: ARMOR, count: stock - 1 });
  const axis2 = 0;
  const original: EditorOp = { op: 'place', key: ARMOR, x: PLATE.x, y: PLATE.y, rot: 0, shape: 'wingL' };
  const m = mirrorPlacement(ARMOR, PLATE.x, PLATE.y, 0, axis2, 'wingL');
  if (m.shape !== 'wingR') broken.push(`the mirror of wing L is ${m.shape ?? 'full'}`);
  const mirrored: EditorOp = { op: 'place', key: ARMOR, ...m };
  // 1. both fit: one plate from storage, one acquired
  const x = new Driver(cloneSim(d.sim));
  const plan = planFromOps(x.state, st, [original, mirrored]);
  const cost = plan.report.cost;
  const acquired = (cost.buy[ARMOR] ?? 0) + (cost.craft[ARMOR] ?? 0);
  if ((cost.fromStorage[ARMOR] ?? 0) !== 1 || acquired !== 1 || cost.installCount !== 2) {
    broken.push(`mirrored pair quote: storage ${cost.fromStorage[ARMOR] ?? 0}, acquired ${acquired}, installs ${cost.installCount}`);
  }
  const parts0 = ownedParts(x.state);
  const w0 = netWorth(x.state).total;
  const c0 = x.state.credits;
  const ok = plan.report.canCommit && x.act({ type: 'shipyardCommit', baseHash: plan.baseHash, ops: plan.ops, acquire: {} });
  const paid = c0 - x.state.credits;
  if (!ok) broken.push(`mirrored pair refused (${plan.report.errors.map((e) => e.code).join(', ')})`);
  else {
    if (paid !== cost.credits) broken.push(`mirrored pair paid ${paid} kr, quoted ${cost.credits} kr`);
    const diff = partsDiff(parts0, ownedParts(x.state));
    if ((diff[ARMOR] ?? 0) !== acquired) broken.push(`armour +${diff[ARMOR] ?? 0}, paid for ${acquired}`);
    const wings = x.state.player.grid.parts.filter((p) => p.shape === 'wingL' || p.shape === 'wingR').length;
    if (wings !== 2) broken.push(`${wings} wings mounted`);
  }
  const gainPair = netWorth(x.state).total - w0;
  // 2. the copy's cells are taken (a cannon there first): the stroke keeps only the original
  const y = new Driver(cloneSim(d.sim));
  const blocker = place(y, 'cannon:1', m.x + 1, m.y);
  const plan2 = planFromOps(y.state, st, [original, mirrored]);
  const cost2 = plan2.report.cost;
  if (!blocker) broken.push('setup: blocker not placed');
  else if (plan2.ops.length !== 1 || cost2.installCount !== 1 || (cost2.buy[ARMOR] ?? 0) + (cost2.craft[ARMOR] ?? 0) !== 0) {
    broken.push(`blocked copy: ${plan2.ops.length} ops in the draft, ${cost2.installCount} installs, acquired ${(cost2.buy[ARMOR] ?? 0) + (cost2.craft[ARMOR] ?? 0)}`);
  }
  const c1 = y.state.credits;
  const ok2 = plan2.report.canCommit && y.act({ type: 'shipyardCommit', baseHash: plan2.baseHash, ops: plan2.ops, acquire: {} });
  const paid2 = c1 - y.state.credits;
  if (!ok2) broken.push('the single wing refused');
  else if (paid2 !== cost2.credits || paid2 !== INSTALL_FEE) broken.push(`the single wing paid ${paid2} kr (quote ${cost2.credits} kr)`);
  return result(
    'shapeMirror',
    seed,
    x,
    gainPair,
    broken,
    `wing L + mirrored wing R with 1 plate in storage: quote storage 1 + acquired ${acquired}, ${cost.installCount} installs = ${cost.credits} kr, paid ${paid} kr, armour +${acquired}; with the copy blocked only the original is in the draft (${plan2.ops.length} op, paid ${paid2} kr)`,
    { paid, quoted: cost.credits, acquired, paidBlocked: paid2 },
  );
}

/** Every shape probe for one seed (the saboteur suite and the quick test). */
export function shapeProbes(seed: number): LoopResult[] {
  return [shapeReshape(seed), shapeRepairSurvey(seed).result, shapeRemoveDamaged(seed), shapeLoot(seed), shapeCrafted(seed), shapeTemplates(seed), shapeMirror(seed)];
}
