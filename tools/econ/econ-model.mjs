// Cinderbelt – economy model and "progression agent" (design v3).
// Run:  node econ-model.mjs                 → the whole game (markdown)
//       node econ-model.mjs --scope=mllg     → only the M5a release (P1–P3, no planets and no P4)
//       node econ-model.mjs --json           → raw data (graph for the Test 1 report)
//       node econ-model.mjs --data=0.7 --yield=2 --skill=1.35 --content=0.5   → sensitivity
//       node econ-model.mjs --sites=0        → the game without the M4b sources (derelict stations, graveyards, comets, events)
//       node econ-model.mjs --workshop=0     → the game without the M4c on-board workshop (refinery, repair module)
//       node econ-model.mjs --guild=0        → the game without M4d (Guild relay, fragments from convoys)
// Single source of the numbers for the long-term design (chapters 3.2.2, 3.5, 4 and 5.7.4).
// T1/T2 values and prices of Fe/Cu/Ice/Ti = src/data/economy.ts (M2). (The v2 version was econ-model-v2.mjs.)
//
// Model: the player alternates mining, contracts, exploration (Data) and fixed content (bosses, workshops).
// Buys the main goals in order, spends the surplus on side goals and the Data from the fund on Archive nodes.
// Checks: pace, refits, megaproject, MATERIAL AVAILABILITY, DATA SUPPLY by ring,
// LONGEST GAP between unlocks.

import { pathToFileURL } from 'node:url';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const SCOPE = arg('scope', 'full');            // 'full' | 'mllg'
const DATA_X = +arg('data', 1), YIELD_X = +arg('yield', 1), CONTENT_X = +arg('content', 1);
const MS_ORDER = ['M2', 'M3', 'M3.5', 'M4', 'M5a', 'M5b', 'M6a', 'M6b', 'M7'];
const SCOPE_MS = SCOPE === 'mllg' ? 'M5a' : 'M7';
const inScope = (ms) => MS_ORDER.indexOf(ms) <= MS_ORDER.indexOf(SCOPE_MS);

// ---------- Resources and prices ----------
const BASE = { fe: 4, cu: 5, ice: 3, ti: 10, kr: 30, he: 25, vz: 35, ex: 60 };
const RING_MULT = {
  1: { fe: 1.0, cu: 1.0, ice: 1.0, ti: 1.0, kr: 1.2, he: 1.2, vz: 1.2, ex: 1.3 },
  2: { fe: 0.9, cu: 1.1, ice: 0.85, ti: 1.0, kr: 1.1, he: 1.1, vz: 1.1, ex: 1.2 },
  3: { fe: 1.1, cu: 1.2, ice: 1.0, ti: 0.95, kr: 1.0, he: 1.0, vz: 1.0, ex: 1.1 },
  4: { fe: 1.2, cu: 1.3, ice: 1.1, ti: 1.0, kr: 1.0, he: 1.0, vz: 1.0, ex: 1.0 },
};
const sell = (r, ring) => BASE[r] * RING_MULT[ring][r] * 0.8;
// Composition of the mined cargo. P3 has rare asteroids with VZ (3 %) so the lenses are available already in M5a.
// P2 = what players actually haul, not the ring mix: even after the price cut titanium is worth 2–4×
// other rock, so players (and the balance bot, tools/bot) mine mostly titanium (bot-report.md, 8.2).
const MIX = {
  1: { fe: 0.5, cu: 0.3, ice: 0.2 },
  2: { ti: 0.8, ice: 0.05, fe: 0.05, cu: 0.1 },
  3: { kr: 0.2, ti: 0.3, ice: 0.2, fe: 0.12, cu: 0.15, vz: 0.03 },
  4: { ex: 0.15, kr: 0.2, ti: 0.25, fe: 0.18, cu: 0.2, vz: 0.02 },
};
const avgPrice = (ring) => Object.entries(MIX[ring]).reduce((s, [r, f]) => s + f * sell(r, ring), 0);
// Sources of the rare resources: the ring + milestone from which they exist.
const SOURCES = {
  kr: [{ ring: 3, ms: 'M5a', what: 'crystal asteroids in P3, P3 stations (purchase)' }],
  vz: [{ ring: 3, ms: 'M5a', what: 'rare asteroids in P3 (3% of the mix), P3 stations (purchase)' }, { ring: 3, ms: 'M5b', what: 'rocky and volcanic planets' }],
  he: [{ ring: 3, ms: 'M5a', what: 'P3 comets' }, { ring: 3, ms: 'M5b', what: 'gas giants' }],
  ex: [{ ring: 4, ms: 'M6a', what: 'P4 asteroids and dead planets' }],
};
const STATION_BUY = { kr: 3, vz: 3 }; // can be bought from ring 3 (static price ×1.25)

// ---------- Trip ----------
// P1 as measured by the balance bot (bot-report.md, 4): rich clusters 75–300 u from home, ~25 s of travel,
// the laser almost always on rock.
const RING = {
  1: { travel: 25, search: 0.9, hazard: 1.0, opcost: 0.04, explore: 0.10 },
  2: { travel: 60, search: 0.45, hazard: 1.15, opcost: 0.08, explore: 0.30 },
  3: { travel: 80, search: 0.40, hazard: 1.25, opcost: 0.10, explore: 0.35 },
  4: { travel: 100, search: 0.35, hazard: 1.35, opcost: 0.12, explore: 0.40 },
};
const OVERHEAD = 40, HUMAN_EFF = 0.75, VEIN = +arg('skill', 1.15);
const LASER_RATE = { 1: 2.5, 2: 3.75, 3: 5.25, 4: 7.25 };
const CARGO_PER_HOLD = { 1: 60, 2: 90, 3: 126, 4: 174 };
const COCKPIT_CARGO = { 1: 10, 2: 15, 3: 21, 4: 29 };
const EXTRA = { contracts: 0.3, loot: { 1: 0, 2: 0.06, 3: 0.06, 4: 0.06 }, salvage: 0.05 };

// ---------- M4b "World Comes Alive" (src/data/sites.ts, events.ts, pirates.ts) ----------
// New sources: derelict stations (80 D + a terminal service), ship graveyards (40 D + salvage), comets (ice/Ti on
// the move), ambushes (loot) – and a sink: micrometeor repairs. `--sites=0` switches every M4b source off (the
// game before M4b); the checks in E compare P2 with and without them (overview M4b: Data/h P2 ≤ +10 %,
// income P2 ≤ +8 %).
const SITES_X = +arg('sites', 1);
const M4B = {
  // Comets: share of the mining time spent on comet passes (catching a nucleus is an occasional detour),
  // the ore mix and the grade (rock × 1.5 ore, a rich nucleus) – src/data/sites.ts COMET.
  comet: { share: { 1: 0, 2: 0.05, 3: 0.05, 4: 0.05 }, mix: { ice: 0.6, ti: 0.4 }, grade: 1.5 },
  // Derelict terminal service per first berth (kr): stash 0.45 × 2–3 parts at their sale value (measured over
  // seeds 1–5: depth 2 ≈ 1 105 kr, depth 3 ≈ 2 486 kr), fabricator 0.25 × the craft fee it saves (mean T1
  // 1 300 kr, T2 2 950 kr); the plan service (0.30) pays fragments, not credits.
  derelictService: { stash: 0.45, fabricator: 0.25, stashSale: { 1: 0, 2: 1105, 3: 2486, 4: 2486 }, fee: { 1: 0, 2: 1300, 3: 2950, 4: 2950 } },
  // Graveyard salvage: the players strip graveyards like POI wrecks (EXTRA.salvage) – scaled by the graveyard
  // stock next to the POI wreck stock per chunk. Sale value of everything in a graveyard (intact parts, scrap,
  // containers; measured over seeds 1–5) and of an average POI wreck (seeds 1–3).
  graveyardSale: { 1: 0, 2: 14970, 3: 28380, 4: 28290 },
  wreckSale: { 1: 1450, 2: 1290, 3: 2040, 4: 2070 },
  // Ambushes (src/data/events.ts AMBUSH): per hour of play in the ring (the bot meets ~0.2/h on its mining
  // runs, a player who explores Contested sectors more), the share the player fights (else flees), the part loot
  // that survives the fight, the loot of the party (2.5 / 3 / 3.5 ships: ENEMY_TEMPLATES × LOOT_PART_CHANCE ×
  // sale value + cargo; the Hammer and the Gunner ×2 cargo), the repair bill and the time of a fight.
  ambush: {
    perHour: { 1: 0, 2: 0.5, 3: 0.6, 4: 0.7 }, fought: 0.5, intact: 0.5,
    party: { 1: 0, 2: 1917 + 1.46 * 962, 3: 0.31 * 2651 + 0.69 * 1917 + 2 * 962, 4: 0.31 * 4816 + 0.69 * 4138 + 2.46 * 2085 },
    repair: { 1: 0, 2: 300, 3: 450, 4: 900 }, fightH: 1.5 / 60,
  },
  // Micrometeor showers (src/data/events.ts MICROMETEORS): HP lost per hour of play after shields (the bot
  // takes ~10 HP per P2 hour with a shield; ~30 for a ship without one) × repair kr per HP (repairCost: T1 ≈ 7,
  // T2 ≈ 9.4; T3/T4 are not in the game – their parts cost 4× / 16× but also have more HP, assumed ×2 / ×4 per HP).
  micrometeor: { hpPerHour: { 1: 7, 2: 30, 3: 45, 4: 55 }, krPerHp: { 1: 7, 2: 7, 3: 9.4 * 2, 4: 9.4 * 4 } },
};
const cometPrice = (ring) => Object.entries(M4B.comet.mix).reduce((s, [r, f]) => s + f * sell(r, ring), 0);

function trip(b, ring, grade = 1) {
  const R = RING[ring];
  const rate = b.lasers * LASER_RATE[b.laserTier] * VEIN * R.search * YIELD_X * grade;
  const cargo = COCKPIT_CARGO[b.cockpit] + b.holds * CARGO_PER_HOLD[b.holdTier];
  return { cargo, secs: (R.travel + cargo / rate + OVERHEAD) * R.hazard };
}
const unitsPerHour = (b, ring, grade = 1) => { const t = trip(b, ring, grade); return (t.cargo * 3600) / t.secs * HUMAN_EFF; };
/** Comet share of the mining time (0 without the M4b sources). */
const cometShare = (ring, sx = SITES_X) => sx * M4B.comet.share[ring];
const miningPerHour = (b, ring, sx = SITES_X) => {
  const rock = unitsPerHour(b, ring) * avgPrice(ring);
  const comet = unitsPerHour(b, ring, M4B.comet.grade) * cometPrice(ring);
  const c = cometShare(ring, sx);
  return ((1 - c) * rock + c * comet) * (1 - RING[ring].opcost);
};
/** Graveyard salvage as a share of mining (like EXTRA.salvage, scaled by the graveyard / POI wreck stock). */
const graveyardSalvage = (ring, sx = SITES_X) =>
  sx * EXTRA.salvage * (POI.graveyard.dens[ring] * M4B.graveyardSale[ring]) / (POI.wreck.dens[ring] * M4B.wreckSale[ring]);
/** Credits of one derelict terminal service (the plan service pays fragments, not credits). */
const derelictService = (ring) => { const d = M4B.derelictService; return d.stash * d.stashSale[ring] + d.fabricator * d.fee[ring]; };
/** Derelict first berths per hour (a share of the POI visits of the exploration time) × the service credits. */
const derelictCredits = (ring, sx = SITES_X) => sx * RING[ring].explore * VISITS_PER_EXPLORE_H[ring] * (POI.derelict.dens[ring] / poiAvg(ring, sx).dens) * derelictService(ring);
/** Net ambush loot per hour: fought parties × (surviving loot − repairs) − the mining time of the fights. */
const ambushNet = (ring, mining, sx = SITES_X) => {
  const a = M4B.ambush, fights = sx * a.perHour[ring] * a.fought;
  return fights * (a.party[ring] * a.intact - a.repair[ring]) - fights * a.fightH * mining;
};
const micrometeorRepairs = (ring, sx = SITES_X) => sx * M4B.micrometeor.hpPerHour[ring] * M4B.micrometeor.krPerHp[ring];
/** M4b credits per hour on top of the mining-share income (derelict services + ambush loot − micrometeor repairs). */
const sitesCredits = (ring, mining, sx = SITES_X) => derelictCredits(ring, sx) + ambushNet(ring, mining, sx) - micrometeorRepairs(ring, sx);
const income = (b, ring, sx = SITES_X) => {
  const m = miningPerHour(b, ring, sx);
  const shares = 1 + EXTRA.contracts + EXTRA.loot[ring] + EXTRA.salvage + graveyardSalvage(ring, sx);
  return { mining: m, total: m * shares * (1 - RING[ring].explore) + sitesCredits(ring, m, sx) };
};

// ---------- M4c "Home and Workshop" (src/data/parts.ts, workshop.ts, home.ts) ----------
// The on-board workshop: a refinery (2 b) refines the ore in the hold while flying (+15 % sale price of the
// refined units, never stacked with the sector demand bonus), but first tops the tank up from the ice in the
// hold (the same 2 fuel per ice as the station – no gain over refuelling with ice at the dock, only time of the
// refinery); a repair module (1 b) repairs its edge neighbours from the Fe / Ti in the hold with no credits
// (the station repair is ~84 % credits); a large reactor (2×2, 3 b) gives ~1.9× the energy per hull point of a
// reactor and blows when destroyed. `--workshop=0` = the game without the workshop (the refiner check compares).
const WORKSHOP_X = +arg('workshop', 1);
const M4C = {
  /** REFINED_BONUS (src/data/workshop.ts). */
  refinedBonus: 0.15,
  /** Refinery per tier (parts.ts): ore and ice u/s, energy/s; hull points by its 2×1 size. */
  refinery: { 1: { ore: 0.6, ice: 0.5, energy: 5 }, 2: { ore: 0.9, ice: 0.75, energy: 6 } },
  refineryHull: 2,
  /** Repair module per tier: HP/s, energy/s; 1 b. */
  repair: { 1: { hp: 1, energy: 3 }, 2: { hp: 1.5, energy: 4 } },
  repairHull: 1,
  /**
   * Share of the station repair bill that is credits (REPAIR_CREDIT_FACTOR × fee) next to the material
   * (REPAIR_MATERIAL_FACTOR × recipe Fe / Ti at the buy price), over the T1 / T2 recipes – what a repair
   * module saves on the damage it covers (the oracle recomputes it from the recipes).
   */
  repairCreditShare: { 1: 0.835, 2: 0.854 },
  /** Fuel burned per second of the model's trip travel (bot: ring 1 18 fuel / 25 s, ring 2 64 fuel / 60 s). */
  fuelPerTravelSecond: 1,
  /** Share of the ship's damage on the edge neighbours of one repair module (a bow cluster: lasers, armour). */
  repairCover: 0.5,
  /** Energy per second of the large reactor and of the reactor (parts.ts); hull points 3 / 1. */
  largeReactor: { 1: { energy: 45, value: 5700 }, 2: { energy: 68, value: 12540 } },
  largeReactorHull: 3,
  reactor: { 1: { energy: 8 }, 2: { energy: 12 } },
  /** Value (recipe at base prices + fee) of the refinery and the repair module, T1 / T2 (economy.ts). */
  value: { refinery: { 1: 3520, 2: 7700 }, repairModule: { 1: 1770, 2: 3890 } },
  /** Credits of the Archive nodes Onboard refinery (1 000) + Repair module (1 200) (src/data/archive.ts). */
  archiveFees: 2200,
  /** Home modules (src/data/home.ts, DH §7.4): credits and resources; M4c builds the first two. */
  home: {
    paintShop: { credits: 8000 }, trophyHall: { credits: 5000 }, homeRefinery: { credits: 30000, ti: 200 },
    observatory: { credits: 25000 }, laboratory: { credits: 35000 }, droneHub: { credits: 40000 },
  },
  /** Plan variants (src/data/variants.ts, M4c 9 → 14): fee multiplier and the side goal "3 variants" at T2. */
  variantFeeMult: 1.3,
  variantsSide: 15000,
};
/** Share of the ring mix's value that is ore (ice is never refined). */
const oreValueShare = (ring) => 1 - ((MIX[ring].ice ?? 0) * sell('ice', ring)) / avgPrice(ring);
/**
 * Refined share of the ore in a trip: the refineries work from the first unit mined until docking (the mining
 * time + the way back), capped by the ore in the hold, after topping the tank up from the ice in the hold (the
 * fuel burned per trip ∝ the travel time: the bot burns ~0.7 / ~1.1 fuel per second of the model's ring-1 / ring-2
 * travel, bot-report.md section 4).
 */
function refinedShare(b, ring, refineries = 1, tier = 1) {
  if (!refineries) return 0;
  const R = RING[ring], spec = M4C.refinery[tier];
  const rate = b.lasers * LASER_RATE[b.laserTier] * VEIN * R.search * YIELD_X;
  const t = trip(b, ring);
  const ice = t.cargo * (MIX[ring].ice ?? 0), ore = t.cargo - ice;
  const fuelPerTrip = M4C.fuelPerTravelSecond * R.travel;
  const iceSecs = Math.min(ice, fuelPerTrip / 2) / (spec.ice * refineries);
  const secs = Math.max(0, t.cargo / rate + R.travel / 2 - iceSecs);
  return Math.min(1, (refineries * spec.ore * secs) / ore);
}
/** Extra credits per hour of a refinery: the refined share of the ore value × REFINED_BONUS, on the mining income. */
const refineryCredits = (b, ring, refineries = 1, tier = 1, wx = WORKSHOP_X) =>
  wx * miningPerHour(b, ring) * oreValueShare(ring) * refinedShare(b, ring, refineries, tier) * M4C.refinedBonus * (1 - RING[ring].explore);
/** Credits per hour a repair module saves: the credit part of the station repairs of the damage it covers. */
const repairSavings = (ring, tier = 1, wx = WORKSHOP_X) => {
  const a = M4B.ambush, fights = SITES_X * a.perHour[ring] * a.fought;
  return wx * (micrometeorRepairs(ring) + fights * a.repair[ring]) * M4C.repairCover * M4C.repairCreditShare[tier];
};
/** Income of a build with the workshop (refinery + repair module) next to the same build without it. */
const workshopIncome = (b, ring, tier = 1, wx = WORKSHOP_X) => {
  const base = income(b, ring).total;
  return { base, refinery: refineryCredits(b, ring, 1, tier, wx), repair: repairSavings(ring, tier, wx), total: base + refineryCredits(b, ring, 1, tier, wx) + repairSavings(ring, tier, wx) };
};
/** Workshop credits per hour on top of `income` (a T1 refinery + a T1 repair module), 0 before it is bought. */
const workshopExtra = (b, ring, owned, wx = WORKSHOP_X) => (owned ? refineryCredits(b, ring, 1, 1, wx) + repairSavings(ring, 1, wx) : 0);
/** The same 2 hull points as cargo: two more holds of the build's tier. */
const cargoIncome = (b, ring) => income({ ...b, holds: b.holds + M4C.refineryHull }, ring).total;

// ---------- M4d "Guild and Trade" (src/data/convoys.ts, guild.ts, contracts.ts) ----------
// Free Traders convoys fly the Guild Lanes (rings 1–3) every 25 game min per lane; a linked player buys 3 rare items
// per pass (a plan fragment 1 200 / 2 000 / 3 000 kr, a variant part, a T2 part in ring 1 – parts at 1.2 × the market
// price), sells cargo at 0.9 × the station sale (≤ 200 u per pass, refined bonus yes, demand bonus never) and buys
// tanker fuel at 1.5 ×. The model counts them as follows (`--guild=0` = the game without M4d):
// 1. the convoy purchases are a SINK – the side goal "3 plan fragments at convoys" at the ring-2 price;
// 2. the cargo sale is a convenience at −10 %: a player who sells part of a hold at a passing convoy saves a trip home
//    but loses 10 % of what he sells – no new income (0 in the model; section H shows the price of the convenience);
// 3. the escort contract is a share of the contract income (EXTRA.contracts): it replaces other slips on lane
//    boards (weight 2) and pays the contract formula (k 1.0, risk 0.25 / 0.5) – no new income; its 10 % deposit is
//    paid back on arrival; the duration estimate is the meeting point at 25 u/s + the stretch at 10 u/s + 1.5 × 75 s
//    per ambush (a P2 pilot, seeds 1–10: the convoy stood still a median 77 s per ambush, estimate ÷ real ≈ 1.08);
// 4. the Guild relay contract (one per lane, two lanes, never rolled – pinned from Guild level 2) is a one-off step
//    of the main path after `fillT1`: repair (60 Fe + 40 Cu + 10 Ti from the hold), power, hold against a Rust party
//    – the contract formula (k 1.2, risk 0.5) on the ring-2 reference income for the duration estimate (overhead
//    90 s + the round trip at 25 u/s + 30 + 6 + 3 × 75 s; seeds 1–20 from the nearest station: 360–500 s, median ≈ 400 s);
// 5. a secured sector (the relay sector of a lane, Contested → Guarded) lowers the exposure of a cautious player
//    (balance bot `--persona=cautious --secured=A,B`); the model has no exposure term – no income change.
const GUILD_X = +arg('guild', 1);
const M4D = {
  convoy: { sellMult: 0.9, buyCap: 200, fuelMult: 1.5, fuelCap: 60, fragmentPrice: { 1: 1200, 2: 2000, 3: 3000 }, rareMarkup: 1.2, periodMinutes: 25 },
  /** Side goal: this many plan fragments bought at convoys (ring-2 price). */
  fragmentsSide: 3,
  /** ambushShips: pirates per ambush in the duration estimate (`escortSeconds`, × the 75 s hunt time per ship). */
  escort: { k: 1.0, risks: [0.25, 0.5], deposit: 0.1, weight: 2, ambushShips: 1.5 },
  relay: { k: 1.2, risk: 0.5, lanes: 2, ring: 2, seconds: 400, repair: { fe: 60, cu: 40, ti: 10 } },
  /** MIN_REFERENCE_INCOME (src/data/contracts.ts): the contract reference income never goes below it. */
  minRef: { 1: 12000, 2: 22000, 3: 85000, 4: 180000 },
  /** Station services (src/data/economy.ts): fuel 2.0 kr × RING_SERVICE_MULT, parts bought at 1.5 × value × RING_PART_MULT, sold at 0.4 ×. */
  fuelBase: 2.0,
  serviceMult: { 1: 1.0, 2: 1.1, 3: 1.25, 4: 1.4 },
  partBuy: 1.5, partSell: 0.4,
  partRingMult: { 1: 1.0, 2: 1.1, 3: 1.2, 4: 1.3 },
};
/** The contract reference income of a build in a ring (its mining income, at least the ring's minimum). */
const refIncome = (b, ring) => Math.max(M4D.minRef[ring], income(b, ring).mining);
/** One Guild relay contract's reward for the build (credits): the contract formula on the reference income. */
const relayReward = (b) => Math.round((M4D.relay.seconds / 3600) * refIncome(b, M4D.relay.ring) * M4D.relay.k * (1 + M4D.relay.risk));
/** The relay repair materials at the ring-2 sell price (what the player gives up from his hold). */
const relayMaterials = () => Object.entries(M4D.relay.repair).reduce((s, [r, q]) => s + q * sell(r, M4D.relay.ring), 0);
/** Credits lost by selling one full convoy pass (buyCap units of the ring mix) at a convoy instead of a station. */
const convoySaleLoss = (ring) => M4D.convoy.buyCap * avgPrice(Math.min(3, ring)) * (1 - M4D.convoy.sellMult);
/** The tanker's premium over the station fuel for a full convoy fuel purchase (fuelCap units). */
const convoyFuelPremium = (ring) => M4D.convoy.fuelCap * M4D.fuelBase * M4D.serviceMult[Math.min(3, ring)] * (M4D.convoy.fuelMult - 1);
/** Escort reward per estimated hour over the reference income (k × (1 + risk)). */
const escortRate = (risk) => M4D.escort.k * (1 + risk);

// ---------- Data by activity (SF-1 from the v2 critique) ----------
// POIs with Data: density per chunk (ch. 5.3) and Data per visit (ch. 3.2.2).
const POI = {
  wreck: { d: 15, dens: { 1: 0.03, 2: 0.06, 3: 0.07, 4: 0.08 } },
  anomaly: { d: { 1: 25, 2: 35, 3: 45, 4: 60 }, dens: { 1: 0.01, 2: 0.03, 3: 0.05, 4: 0.06 } },
  cache: { d: 20, dens: { 1: 0.01, 2: 0.02, 3: 0.02, 4: 0.02 } },
  // M4b (`m4b: true` – off with --sites=0): a derelict pays 80 D at the first berth (src/data/sites.ts
  // SITES.derelict), a graveyard 35 D for its first analysed wreck (SITES.graveyard; T15 retune from 40 D,
  // see E: P2 Data/h +10.3 % → +9.8 %); 0 in Guarded sectors, the
  // graveyard ×3 in the wreckField biome – measured over seeds 1–5 the real densities are 0.0051 / 0.0108 / 0.0162
  // (derelict) and 0.0028 / 0.0048 / 0.012 (graveyard) per chunk at depth 2 / 3 / 4, i.e. the base values.
  derelict: { d: 80, dens: { 1: 0, 2: 0.005, 3: 0.01, 4: 0.015 }, m4b: true },
  graveyard: { d: 35, dens: { 1: 0, 2: 0.003, 3: 0.005, 4: 0.01 }, m4b: true },
  giant: { d: 10, dens: { 1: 0, 2: 0.02, 3: 0.03, 4: 0.02 } },
  planet: { d: 40, dens: { 1: 0.008, 2: 0.008, 3: 0.006, 4: 0.002 } },
};
const VISITS_PER_EXPLORE_H = { 1: 24, 2: 24, 3: 20, 4: 16 }; // flight, scan, cutting
const INSTITUTE = { share: 0.08, rate: { 1: 150, 2: 250, 3: 400, 4: 500 } }; // repeatable contracts = the floor
const STORY_DATA_PER_H = 150; // Echoes, workshops, bosses (fixed content)
const poiAvg = (ring, sx = SITES_X) => {
  let n = 0, s = 0;
  for (const p of Object.values(POI)) { const de = p.dens[ring] * (p.m4b ? sx : 1), d = typeof p.d === 'object' ? p.d[ring] : p.d; n += de; s += de * d; }
  return { perVisit: s / n, perChunk: s, dens: n };
};
const dataPerHour = (ring, sx = SITES_X) => DATA_X * (RING[ring].explore * VISITS_PER_EXPLORE_H[ring] * poiAvg(ring, sx).perVisit + INSTITUTE.share * INSTITUTE.rate[ring]);
// Charting sectors by flight coverage (sectors design §4.1, §6.4; stage 1b, REGION_GEN.charting in
// src/sim/regions/constants.ts): during the exploration share one sector is charted every `minutes`
// (the design's tempo: 1.5 / 3 / 5 min), paying fixed Data, until the ring's finite stock of sectors
// runs out (sector counts from stage 0: depth 1 ~11 minus the 2 start-Charted, depth 2 ~25, depth 3 ~37).
// The design's 3 / 6 / 12 D gave Data/h P2 +19 % (expected ≤ +6 %) and the shielding gate −10 %, so by
// its rule the Data are halved: 2 / 3 / 6 D (P2 +10 %, capped at 75 D; gate −5 %).
// `--chart=0` switches it off, `--chartData=a,b,c` / `--chartMin=a,b,c` try other values.
const CHART_X = +arg('chart', 1);
const perRing = (text, d) => (text ? Object.fromEntries(text.split(',').map((v, i) => [i + 1, +v]).concat([[4, d[4]]])) : d);
const CHARTING = {
  data: perRing(arg('chartData', ''), { 1: 2, 2: 3, 3: 6, 4: 0 }),
  minutes: perRing(arg('chartMin', ''), { 1: 1.5, 2: 3, 3: 5, 4: 6 }),
  sectors: { 1: 9, 2: 25, 3: 37, 4: 0 },
};
/** Charting Data per hour while sectors are left (tempo, not stock). */
const chartingPerHour = (ring) => CHART_X * RING[ring].explore * (60 / CHARTING.minutes[ring]) * CHARTING.data[ring];
// Selling charts (sectors design §4.2, stage 2; src/data/charts.ts, src/sim/charts/charts.ts): a charted
// sector the Guild buys (not Guarded, no Guild Lane through it) sells once for 0.0125 h of the ring's
// minimum reference income × security (Pirate ×1.5) × size. Measured over seeds 1–20 (finite sectors):
// share of the charted sectors that sell and their average price – depth 1: 3.5 of the 9 non-start
// sectors at ~170 cr, depth 2: 18.5 of 25 at ~320 cr (stock ~5.9 k), depth 3: 35.6 of 37 at ~1 200 cr
// (stock ~43 k). Credits come with the charting tempo above (one sector per `CHARTING.minutes`), until
// the ring's sectors run out. Buying Guild charts is optional spending and not modelled.
// The design's 0.025 h (`--chartSell=2`) gave P2 income +2.8 k/h (+15 % while sectors last) and the first
// milestones −6 … −11 % (weapons 36 → 32 min); halved by the rule of §6.4: P2 +1.4 k/h (+7 %), −3 … −6 %.
// `--chartSell=0` switches it off, `--chartSell=2` is the design's price.
const CHART_SELL_X = +arg('chartSell', 1);
const CHART_SALE = {
  share: { 1: 0.39, 2: 0.74, 3: 0.96, 4: 0 },
  price: { 1: 170, 2: 320, 3: 1200, 4: 0 },
};
/** Chart sale credits per charted sector (average over sellable and Guild sectors). */
const chartCreditsPerSector = (ring) => CHART_SELL_X * CHART_SALE.share[ring] * CHART_SALE.price[ring];
/** Chart sale credits per hour while sectors are left. */
const chartCreditsPerHour = (ring) => CHART_X * RING[ring].explore * (60 / CHARTING.minutes[ring]) * chartCreditsPerSector(ring);
// Final supply of Data from the POIs in a ring (without contracts): number of chunks × Data/chunk + one-off types.
const RING_R = { 1: [0, 1500], 2: [1500, 4000], 3: [4000, 8000], 4: [8000, 12000] };
const chunks = (r) => Math.round((Math.PI * (RING_R[r][1] ** 2 - RING_R[r][0] ** 2)) / (200 * 200));
const ONE_TIME = { 1: 120 + 100, 2: 200, 3: 300, 4: 300 }; // asteroid types, Echoes
const ringSupply = (r) => Math.round(chunks(r) * poiAvg(r).perChunk + ONE_TIME[r]);

// ---------- Part values (credit equivalent) ----------
// T3/T4 are not in the game yet: the multipliers keep T3/T4 values where they were before the T2 fees rose (×1.25).
const T3X = 4.1, T4X = 16;
// Value = recipe resources at base prices + fee (economy.ts; fees ×1.25 per bot-report.md 8.3 A).
// Shielding (not in the game yet) grows like the average of the other parts (T1 ×1.17, T2 ×1.12).
const V = {
  1: { cockpit: 2930, armor: 260, engine: 975, gyro: 980, laser: 1380, cargo: 1070, tank: 775, reactor: 1580, radar: 865, cannon: 1200, shield: 1675, shielding: 700 },
  2: { cockpit: 6440, armor: 540, engine: 2240, gyro: 2217, laser: 3062, cargo: 2290, tank: 1752, reactor: 3580, radar: 1920, cannon: 2615, shield: 3677, shielding: 1680 },
};
V[3] = Object.fromEntries(Object.entries(V[2]).map(([k, v]) => [k, Math.round(v * T3X)]));
V[4] = Object.fromEntries(Object.entries(V[2]).map(([k, v]) => [k, Math.round(v * T4X)]));
const OWN_MAT = 0.92, TRADE_IN = 0.4;
const cost = (tier, parts) => Math.round(OWN_MAT * Object.entries(parts).reduce((s, [p, n]) => s + V[tier][p] * n, 0));
const upgrade = (f, t, parts) => cost(t, parts) - Math.round(TRADE_IN * cost(f, parts));
const HULL_CAP = { 1: 28, 2: 48, 3: 80, 4: 140 };
// Rare resources in the T3/T4 recipes (including intermediates, ch. 3.3.1 and 4.2), per piece.
const MATS = {
  3: { cockpit: { kr: 102, vz: 6 }, laser: { kr: 40, vz: 4 }, reactor: { kr: 40, vz: 2 }, engine: { kr: 27 }, cargo: { kr: 25 }, gyro: { kr: 25 }, tank: { kr: 22 } },
  4: { cockpit: { ex: 300, kr: 60 }, laser: { ex: 140, vz: 6 }, reactor: { ex: 140, he: 30 }, engine: { ex: 120 }, gyro: { ex: 110 }, cargo: { ex: 100 }, armor: { ex: 30 }, tank: { ex: 90, he: 20 }, radar: { ex: 90, vz: 4 }, cannon: { ex: 120, vz: 6 }, shield: { ex: 130 } },
};
const mats = (tier, parts) => { const o = {}; for (const [p, n] of Object.entries(parts)) for (const [r, q] of Object.entries(MATS[tier][p] ?? {})) o[r] = (o[r] ?? 0) + q * n; return o; };

// ---------- Main goals ----------
const G = (o) => ({ ms: 'M2', ...o });
const T3A = { laser: 6, reactor: 4 }, T3B = { cargo: 12, engine: 8, gyro: 3, tank: 2 };
const T4A1 = { laser: 8, reactor: 5 }, T4A2 = { engine: 8, gyro: 3 }, T4A = { laser: 8, reactor: 5, engine: 8, gyro: 3 }, T4B = { cargo: 24, engine: 4, gyro: 1, tank: 3, radar: 2, armor: 20, cannon: 6, shield: 3 };
const goalsAll = [
  G({ id: 'cargo1', label: 'Cargo hold T1 (1st upgrade)', cost: cost(1, { cargo: 1 }), set: { holds: 3 } }),
  G({ id: 'laser2', label: '2nd laser + reactor T1', cost: cost(1, { laser: 1, reactor: 1 }) - 300, set: { lasers: 2 } }),
  G({ id: 'tank', label: 'Extra tank, first flights to P2 (titanium)', cost: cost(1, { tank: 1 }), ring: 2 }),
  G({ id: 'weapons', ms: 'M3', label: 'Cannon ×2 + shield + reactor T1 (M3)', cost: cost(1, { cannon: 2, shield: 1, reactor: 1 }) }),
  G({ id: 'firstT2', label: 'First T2 part (laser T2)', cost: upgrade(1, 2, { laser: 1 }), set: { laserTier: 2 } }),
  G({ id: 'echo01', ms: 'M3.5', label: 'Echo-0 and 1, “First Day”, pirate journals', fixedH: 1.0 }),
  G({ id: 'fillT1', label: 'T1 ship filled up (28 pts): 3 lasers, 5 holds', cost: cost(1, { laser: 1, reactor: 1, cargo: 2 }), set: { lasers: 3, holds: 5 } }),
  // M4d: the two Guild relay contracts (one-off, pinned from Guild level 2) – content time with the contract reward
  ...(GUILD_X ? [G({ id: 'relay', ms: 'M4', label: 'Guild relay ×2 (repair, power, defence) → 2 Guarded sectors', fixedH: Math.round((M4D.relay.lanes * M4D.relay.seconds) / 36) / 100, rewardFn: (b) => M4D.relay.lanes * relayReward(b) - Math.round(M4D.relay.lanes * relayMaterials()) })] : []),
  G({ id: 'cockpit2', label: 'Cockpit T2 → hull 48 pts', cost: upgrade(1, 2, { cockpit: 1 }), set: { cockpit: 2 } }),
  G({ id: 'refitT2a', label: 'T2: lasers ×4, reactors ×3', cost: upgrade(1, 2, { laser: 3, reactor: 3 }), set: { lasers: 4 } }),
  G({ id: 'refitT2b', label: 'T2: cargo ×8, engines ×6, gyros ×2, tanks ×2, radar', cost: upgrade(1, 2, { cargo: 8, engine: 6, gyro: 2, tank: 2, radar: 1 }), set: { holds: 8, holdTier: 2 } }),
  G({ id: 'refitT2c', label: 'T2: armour ×8, cannons ×3, shields ×2', cost: upgrade(1, 2, { armor: 8, cannon: 3, shield: 2 }) }),
  G({ id: 'fortress', ms: 'M3.5', label: 'Rust Fortress (boss 1) → Resonator', fixedH: 1.0, reward: 20000 }),
  G({ id: 'p3gate', ms: 'M5a', label: 'Archive: shielding ×6 → P3', cost: cost(2, { shielding: 6 }), data: 900, ring: 3 }),
  G({ id: 'cockpit3', ms: 'M5a', label: 'Archive: T3 metallurgy + cockpit T3 → hull 80 pts', cost: upgrade(2, 3, { cockpit: 1 }), data: 1350, set: { cockpit: 3 }, mats: mats(3, { cockpit: 1 }) }),
  G({ id: 'refitT3a', ms: 'M5a', label: 'T3: lasers ×6, reactors ×4', cost: upgrade(2, 3, T3A), set: { lasers: 6, laserTier: 3 }, mats: mats(3, T3A) }),
  G({ id: 'echo3', ms: 'M5a', label: 'Echo-3 through the radiation shadows, the “Chant” chain', fixedH: 1.5 }),
  G({ id: 'refitT3b', ms: 'M5a', label: 'T3: cargo ×12, engines ×8, gyros ×3, tanks ×2', cost: upgrade(2, 3, T3B), set: { holds: 12, holdTier: 3 }, mats: mats(3, T3B) }),
  G({ id: 'wardens', ms: 'M5a', label: 'Wardens patrol: the cold-engine rule', fixedH: 0.75 }),
  G({ id: 'kolos', ms: 'M5a', label: 'Resonant Colossus (boss 2) → Compass', fixedH: 1.25, reward: 60000, data: 2000 }),
  G({ id: 'mllgEnd', ms: 'M5a', onlyScope: 'mllg', label: '[MLLG] Temporary ending: “The Compass points beyond the nebulae”', fixedH: 0.25 }),
  G({ id: 'base12', ms: 'M5b', label: '1st–2nd planetary base', cost: 2 * 60000, data: 2300, bases: 2 }),
  G({ id: 'cruise', ms: 'M5b', label: 'Archive: cruise drive + drone hangar (P3 logistics)', cost: 9000 + cost(3, { cargo: 1 }), data: 2600 }),
  G({ id: 'base34', ms: 'M5b', label: '3rd–4th base + cargo drones', cost: 2 * 90000, bases: 4 }),
  G({ id: 'deepscan', ms: 'M5b', label: 'Deep scans of P3 planets, Echo-4 (crystal planet)', fixedH: 1.0 }),
  G({ id: 'p4gate', ms: 'M6a', label: 'Depth scanner + forward base → P4', cost: 130000, data: 3700, ring: 4, stockpile: true }),
  G({ id: 'compass', ms: 'M6a', label: 'Finding the workshops with the Compass in the signal darkness', fixedH: 2.0 }),
  G({ id: 'cockpit4', ms: 'M6a', label: 'Archive: T4 metallurgy + cockpit T4 → hull 140 pts', cost: upgrade(3, 4, { cockpit: 1 }), data: 4700, set: { cockpit: 4 }, mats: mats(4, { cockpit: 1 }) }),
  G({ id: 'ws1', ms: 'M6a', label: 'Workshop 1 (Smelt) → fragment 1', fixedH: 2.0 }),
  G({ id: 'refitT4a', ms: 'M6a', label: 'T4 core I: lasers ×8, reactors ×5', cost: upgrade(3, 4, T4A1), set: { lasers: 8, laserTier: 4 }, mats: mats(4, T4A1) }),
  G({ id: 'ws2', ms: 'M6a', label: 'Workshop 2 (Shadow) → fragment 2', fixedH: 2.0 }),
  G({ id: 'refitT4a2', ms: 'M6a', label: 'T4 core II: engines ×8, gyros ×3', cost: upgrade(3, 4, T4A2), mats: mats(4, T4A2) }),
  G({ id: 'ws3', ms: 'M6a', label: 'Workshop 3 (Balance) → fragment 3', fixedH: 2.0 }),
  G({ id: 'ws4', ms: 'M6b', label: 'Workshop 4 (Swarm) → fragment 4', fixedH: 2.0 }),
  G({ id: 'ws5', ms: 'M6b', label: 'Workshop 5 (Pull) → fragment 5', fixedH: 2.0 }),
  G({ id: 'ws6', ms: 'M6b', label: 'Workshop 6 (Echo) → fragment 6', fixedH: 2.0 }),
  G({ id: 'mp1', ms: 'M6b', label: 'Megaproject phase 1 – Skeleton', baseUnits: 22000, cost: 60000 }),
  G({ id: 'mp2', ms: 'M6b', label: 'Megaproject phase 2 – Conductors', baseUnits: 26000 }),
  G({ id: 'mp3', ms: 'M6b', label: 'Megaproject phase 3 – Fuel', baseUnits: 26000 }),
  G({ id: 'ws7', ms: 'M6b', label: 'Workshop 7 (Heart, the High Forge-smith) → fragment 7', fixedH: 2.0 }),
  G({ id: 'mp4', ms: 'M6b', label: 'Megaproject phase 4 – Heart', baseUnits: 10000 }),
  G({ id: 'finale', ms: 'M6b', label: 'Finale in the Forge (leap, Mirror, choice) → credits', fixedH: 2.0 }),
  G({ id: 'refitT4b', ms: 'M7', label: '[post-game] T4 ship: the rest of the kit at T4', cost: upgrade(3, 4, T4B), set: { holds: 24, holdTier: 4 }, mats: mats(4, T4B) }),
];
const goals = goalsAll.filter((g) => inScope(g.ms) && (!g.onlyScope || g.onlyScope === SCOPE));

// Hangar slots (M4a, src/data/economy.ts HANGAR.slotPrices): the slot of the 2nd ship is the first one
// bought, the 3rd ship's the second (the oracle checks both).
const HANGAR_SLOT = { 2: 5000, 3: 15000 };

const side = [
  { ring: 2, ms: 'M4', label: `Hangar slot 2 (${HANGAR_SLOT[2]} cr) + T2 fighter (≈ 30 pts)`, cost: HANGAR_SLOT[2] + cost(2, { cockpit: 1, cannon: 6, shield: 2, engine: 8, gyro: 3, reactor: 3, armor: 8 }) },
  { ring: 2, ms: 'M4', label: 'Paint shop + trophy hall (home)', cost: M4C.home.paintShop.credits + M4C.home.trophyHall.credits },
  { ring: 2, ms: 'M4', label: 'Part variants (3×)', cost: M4C.variantsSide },
  // M4d convoys: three plan fragments bought from passing convoys (ring-2 price) – a sink, the purchases of a pass
  ...(GUILD_X ? [{ ring: 2, ms: 'M4', label: `Convoys: ${M4D.fragmentsSide} plan fragments (${M4D.convoy.fragmentPrice[2]} cr in P2)`, cost: M4D.fragmentsSide * M4D.convoy.fragmentPrice[2] }] : []),
  // M4c on-board workshop: a T1 refinery and repair module (recipe value × OWN_MAT) + the two Archive node fees
  // (their Data come from the fund like any small unlock); from then on `workshopExtra` adds to the income
  ...(WORKSHOP_X ? [{ ring: 2, ms: 'M4', label: 'Onboard workshop: refinery + repair module T1 (+ Archive nodes)', workshop: true,
    cost: Math.round(OWN_MAT * (M4C.value.refinery[1] + M4C.value.repairModule[1])) + M4C.archiveFees }] : []),
  { ring: 3, ms: 'M5a', label: 'Home: refinery (+ 200 Ti)', cost: M4C.home.homeRefinery.credits + Math.round(M4C.home.homeRefinery.ti * sell('ti', 3)) },
  { ring: 3, ms: 'M5a', label: 'T3 combat: large shield + rocket launcher', cost: cost(3, { shield: 1, cannon: 1 }) },
  { ring: 3, ms: 'M5b', label: 'Home: observatory, laboratory', cost: M4C.home.observatory.credits + M4C.home.laboratory.credits },
  { ring: 3, ms: 'M5a', label: `Hangar slot 3 (${HANGAR_SLOT[3]} cr) + T3 explorer (≈ 40 pts)`, cost: HANGAR_SLOT[3] + cost(3, { cockpit: 1, radar: 2, tank: 5, shielding: 8, engine: 8, gyro: 3, reactor: 2, armor: 6 }) },
  { ring: 3, ms: 'M5b', label: 'Home: drone hub', cost: M4C.home.droneHub.credits },
  { ring: 3, ms: 'M5b', label: 'Bases L2 (×4)', cost: 4 * 25000 },
  { ring: 4, ms: 'M6b', label: 'Home: Forge module', cost: 250000 },
  { ring: 4, ms: 'M6a', label: 'Forward bases 2 and 3', cost: 120000 },
  { ring: 4, ms: 'M6b', label: 'Bases L3 (×4)', cost: 4 * 80000 },
].filter((s) => inScope(s.ms));

// Archive nodes bought from the Data fund (small unlocks): level, price, from which ring.
const POOL = [];
for (let i = 0; i < 9; i++) POOL.push({ lvl: 1, cost: 20 + i * 5, ring: 1 });
for (let i = 0; i < 9; i++) POOL.push({ lvl: 2, cost: 100 + i * 25, ring: 2 });
for (let i = 0; i < 8; i++) POOL.push({ lvl: 3, cost: 350 + i * 40, ring: 3 });
for (let i = 0; i < 8; i++) POOL.push({ lvl: 4, cost: 550 + i * 50, ring: 4 });

const BASE_UNITS_PER_S = 0.6, BASE_UNIT_VALUE = 11;
const BASE_MIX = { ti: 0.3, fe: 0.2, cu: 0.15, he: 0.15, vz: 0.15, ex: 0.05 };
const MEGA_BUY = 17; // kr/u, when the player buys the megaproject resources at stations (ch. 5.7.4)

function run() {
  const b = { cockpit: 1, lasers: 1, laserTier: 1, holds: 2, holdTier: 1 };
  let t = 0, credits = 250, ring = 1, data = 0, dataFund = 0, bases = 0, stock = 0, stockpile = false;
  let earned = 0, spentMain = 0, spentSide = 0, finEarned = 0, finMain = 0, finSide = 0, megaBought = 0;
  const mined = {}, used = {}, bought = {}; const matIssues = [];
  const src = { mining: 0, contracts: 0, loot: 0, salvage: 0, bases: 0, rewards: 0, charts: 0, sites: 0, ambush: 0, workshop: 0 };
  let workshop = false, workshopAt = null, relayPaid = 0;
  const incomeNow = () => income(b, ring).total + workshopExtra(b, ring, workshop);
  let micrometeorCost = 0;
  const log = [], sideLog = [], poolLog = [], hourly = [], dataByRing = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const dt = 1 / 60; let gi = 0, si = 0, pi = 0, nextHour = 1, contentLeft = null;
  const chartLeft = { ...CHARTING.sectors }; let chartData = 0; const chartByRing = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let chartCredits = 0; const chartCreditsByRing = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const addBase = (h) => { if (!bases) return; const u = bases * BASE_UNITS_PER_S * 3600 * h; for (const [r, f] of Object.entries(BASE_MIX)) mined[r] = (mined[r] ?? 0) + u * f * (r === 'ex' && ring < 4 ? 0 : 1);
    if (stockpile) stock += u; else { credits += u * BASE_UNIT_VALUE; earned += u * BASE_UNIT_VALUE; if (!finEarned) src.bases += u * BASE_UNIT_VALUE; } };
  const checkMats = (g) => {
    for (const [r, need] of Object.entries(g.mats ?? {})) {
      const srcOk = SOURCES[r].some((s) => ring >= s.ring && inScope(s.ms));
      if (!srcOk) { matIssues.push(`${g.label}: ${r} has no source in scope ${SCOPE}`); continue; }
      const have = (mined[r] ?? 0) - (used[r] ?? 0);
      if (have < need) {
        if (STATION_BUY[r] && ring >= STATION_BUY[r]) { const q = need - Math.max(0, have); bought[r] = (bought[r] ?? 0) + q; credits -= q * BASE[r] * RING_MULT[ring][r] * 1.25; used[r] = (used[r] ?? 0) + Math.max(0, have); }
        else matIssues.push(`${g.label}: short of ${Math.round(need - have)} ${r} (mined ${Math.round(have)})`);
      } else used[r] = (used[r] ?? 0) + need;
    }
  };
  while (gi < goals.length && t < 160) {
    const g = goals[gi];
    if (g.fixedH && data >= (g.data ?? 0)) {
      // content runs by the minute: no mining income, Data at the story rate, bases keep running, purchases from the fund are possible
      if (contentLeft === null) contentLeft = g.fixedH * CONTENT_X;
      if (contentLeft <= 1e-9) {
        const reward = g.rewardFn ? g.rewardFn(b, ring) : (g.reward ?? 0);
        if (g.rewardFn) relayPaid += reward;
        contentLeft = null; credits += reward; earned += reward; if (!finEarned) src.rewards += reward;
        log.push({ t, g, inc: incomeNow(), b: { ...b }, ring, data, credits, kind: 'main' });
        if (g.id === 'finale' || g.id === 'mllgEnd') { finEarned = earned; finMain = spentMain; finSide = spentSide; }
        gi++; continue;
      }
      const p0 = POOL[pi];
      if (p0 && ring >= p0.ring && dataFund >= p0.cost) { dataFund -= p0.cost; poolLog.push({ t, p: p0 }); log.push({ t, g: { label: `Archive L${p0.lvl}` }, kind: 'pool' }); pi++; continue; }
      t += dt; contentLeft -= dt;
      const d = STORY_DATA_PER_H * dt * DATA_X; data += d; dataFund += d; dataByRing[ring] += d; addBase(dt);
      if (t >= nextHour) { hourly.push({ h: nextHour, inc: incomeNow(), ring, data: Math.round(data) }); nextHour += 1; }
      continue;
    }
    if (!g.fixedH && credits >= (g.cost ?? 0) && data >= (g.data ?? 0)) {
      let ok = true;
      if (g.baseUnits && stock < g.baseUnits) { const short = g.baseUnits - stock; if (credits - (g.cost ?? 0) >= short * MEGA_BUY * 3) { credits -= short * MEGA_BUY; megaBought += short; stock += short; } else ok = false; }
      if (ok) {
        credits -= g.cost ?? 0; spentMain += g.cost ?? 0; if (g.baseUnits) stock -= g.baseUnits;
        checkMats(g);
        Object.assign(b, g.set ?? {}); if (g.ring) ring = g.ring; if (g.bases) bases = g.bases; if (g.stockpile) stockpile = true;
        log.push({ t, g, inc: incomeNow(), b: { ...b }, ring, data, credits, kind: 'main' }); gi++; continue;
      }
    }
    const s = side[si];
    if (s && ring >= s.ring && credits - s.cost >= (g.cost ?? 0)) { credits -= s.cost; spentSide += s.cost; sideLog.push({ t, s }); if (s.workshop) { workshop = true; workshopAt = t; } log.push({ t, g: { label: s.label }, kind: 'side' }); si++; continue; }
    const p = POOL[pi];
    if (p && ring >= p.ring && dataFund >= p.cost) { dataFund -= p.cost; poolLog.push({ t, p }); log.push({ t, g: { label: `Archive L${p.lvl}` }, kind: 'pool' }); pi++; continue; }
    t += dt;
    const I = income(b, ring), f = (1 - RING[ring].explore) * dt, W = workshopExtra(b, ring, workshop);
    credits += (I.total + W) * dt; earned += (I.total + W) * dt;
    if (!finEarned) src.workshop += W * dt;
    if (!finEarned) { src.mining += I.mining * f; src.contracts += I.mining * EXTRA.contracts * f; src.loot += I.mining * EXTRA.loot[ring] * f; src.salvage += I.mining * EXTRA.salvage * f;
      src.sites += I.mining * graveyardSalvage(ring) * f + derelictCredits(ring) * dt; src.ambush += Math.max(0, ambushNet(ring, I.mining)) * dt; micrometeorCost += micrometeorRepairs(ring) * dt; }
    const c = cometShare(ring), u = unitsPerHour(b, ring) * f * (1 - c), uc = unitsPerHour(b, ring, M4B.comet.grade) * f * c;
    for (const [r, fr] of Object.entries(MIX[ring])) mined[r] = (mined[r] ?? 0) + u * fr;
    for (const [r, fr] of Object.entries(M4B.comet.mix)) mined[r] = (mined[r] ?? 0) + uc * fr;
    const d = dataPerHour(ring) * dt; data += d; dataFund += d; dataByRing[ring] += d;
    if (chartLeft[ring] > 0 && CHARTING.data[ring] > 0) {
      const n = Math.min(chartLeft[ring], (chartingPerHour(ring) / CHARTING.data[ring]) * dt);
      chartLeft[ring] -= n; const cd = n * CHARTING.data[ring];
      data += cd; dataFund += cd; dataByRing[ring] += cd; chartData += cd; chartByRing[ring] += cd;
      const cc = n * chartCreditsPerSector(ring);
      credits += cc; earned += cc; chartCredits += cc; chartCreditsByRing[ring] += cc; if (!finEarned) src.charts += cc;
    }
    addBase(dt);
    if (t >= nextHour) { hourly.push({ h: nextHour, inc: I.total + W, ring, data: Math.round(data) }); nextHour += 1; }
  }
  return { workshopAt, relayPaid, log, sideLog, poolLog, hourly, earned, spentMain, spentSide, finEarned, finMain, finSide, src, micrometeorCost, matIssues, megaBought, dataByRing, chartData, chartByRing, chartCredits, chartCreditsByRing, mined, used, bought };
}

// ---------- Export for the CI oracle (src/data/econOracle.test.ts) ----------
// Constants that must match the game (src/data/economy.ts, parts.ts, incomeModel.ts). The model can
// be imported without running the output – the output runs only for `node econ-model.mjs`.
export const MODEL = {
  BASE, RING_MULT, SELL_SPREAD: 0.8, MIX, RING, OVERHEAD, HUMAN_EFF, VEIN, LASER_RATE, CARGO_PER_HOLD, COCKPIT_CARGO,
  V, HULL_CAP, OWN_MAT, TRADE_IN, EXTRA,
  // Data (M3.5b): POIs (density and Data per visit), visits per exploration hour, the Institute, the Archive fund
  POI, VISITS_PER_EXPLORE_H, INSTITUTE, STORY_DATA_PER_H, POOL,
  // charting sectors by flight (sectors stage 1b): fixed Data per sector, tempo and stock per ring
  CHARTING,
  // selling charts (sectors stage 2): sellable share of the charted sectors and their average price
  CHART_SALE,
  // hangar slots (M4a): price of the slot of the 2nd and the 3rd ship (side goals "Hangar slot 2 / 3")
  HANGAR_SLOT,
  // M4b ("World Comes Alive"): comets, derelict services, graveyard / POI wreck sale values, ambushes, micrometeor repairs
  M4B,
  // M4c ("Home and Workshop"): refinery, repair module, large reactor, home modules, variants side goal
  M4C,
  // M4d ("Guild and Trade"): convoy trade, escort, Guild relay, contract reference minimums, station services
  M4D,
  /** Thresholds of the key Archive nodes (collected Data) by main-path goal. */
  DATA_THRESHOLDS: Object.fromEntries(goalsAll.filter((g) => g.data).map((g) => [g.id, g.data])),
};
export { refinedShare, refineryCredits, repairSavings, workshopIncome, cargoIncome, oreValueShare };
export { refIncome, relayReward, relayMaterials, convoySaleLoss, convoyFuelPremium, escortRate };
export { run, income, avgPrice, trip, poiAvg, dataPerHour, chartingPerHour, chartCreditsPerHour, chartCreditsPerSector, ringSupply, cometPrice, graveyardSalvage, derelictCredits, ambushNet, micrometeorRepairs };

// ---------- Output ----------
function main() {
const fmtT = (h) => (h < 1 ? `${Math.round(h * 60)} min` : `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0').replace('60', '59')}`);
const k = (x) => (x >= 1e6 ? `${(x / 1e6).toFixed(2)} M` : x >= 1000 ? `${Math.round(x / 1000)} k` : `${Math.round(x)}`);
const R = run();
if (process.argv.includes('--json')) { console.log(JSON.stringify(R, null, 1)); process.exit(0); }
const main = R.log.filter((e) => e.kind === 'main');
const at = (id) => main.find((e) => e.g.id === id)?.t ?? NaN;
const endId = SCOPE === 'mllg' ? 'mllgEnd' : 'finale';

console.log(`> Scope: **${SCOPE === 'mllg' ? 'MLLG – M5a release (P1–P3)' : 'the whole game'}**. Sensitivity: Data ×${DATA_X}, yield ×${YIELD_X}, veins ${VEIN}, content ×${CONTENT_X}.\n`);
console.log('#### A. Average sale price of the mix and Data by activity\n');
console.log('| | P1 | P2 | P3 | P4 |\n|---|---|---|---|---|');
console.log(`| Mix sale price (cr/u) | ${[1, 2, 3, 4].map((r) => avgPrice(r).toFixed(2)).join(' | ')} |`);
console.log(`| Data per POI visit (average) | ${[1, 2, 3, 4].map((r) => poiAvg(r).perVisit.toFixed(1)).join(' | ')} |`);
console.log(`| Data/h (exploration × visits + Institute) | ${[1, 2, 3, 4].map((r) => Math.round(dataPerHour(r))).join(' | ')} |`);
console.log(`| Data/h from charting sectors (while sectors last; stock) | ${[1, 2, 3, 4].map((r) => `${Math.round(chartingPerHour(r))} (${CHARTING.sectors[r] * CHARTING.data[r]})`).join(' | ')} |`);
console.log(`| Credits/h from selling charts (while sectors last; stock) | ${[1, 2, 3, 4].map((r) => `${k(chartCreditsPerHour(r))} (${k(CHARTING.sectors[r] * chartCreditsPerSector(r))})`).join(' | ')} |`);
console.log(`| Final stock of POI Data in the ring | ${[1, 2, 3, 4].map((r) => ringSupply(r).toLocaleString('en-US')).join(' | ')} |`);
console.log('\n#### B. Pace table (main path)\n');
console.log('| Time (h:mm) | Main goal reached | Cost | Ring | Cockpit / hull | Data (collected) | Income after the goal (cr/h) |');
console.log('|---|---|---|---|---|---|---|');
for (const e of main) {
  const c = e.g.baseUnits ? `${e.g.baseUnits.toLocaleString('en-US')} u from bases${e.g.cost ? ' + ' + k(e.g.cost) : ''}` : e.g.fixedH ? `${String(e.g.fixedH)} h of content` : k(e.g.cost);
  console.log(`| ${fmtT(e.t)} | ${e.g.label} | ${c} | P${e.ring} | T${e.b.cockpit} / ${HULL_CAP[e.b.cockpit]} pts | ${Math.round(e.data).toLocaleString('en-US')} | ${k(e.inc)} |`);
}
console.log('\n#### C. Side goals and Archive nodes (small unlocks)\n');
console.log('| Time | Side goal | Cost |\n|---|---|---|');
for (const e of R.sideLog) console.log(`| ${fmtT(e.t)} | ${e.s.label} | ${k(e.s.cost)} |`);
const byLvl = {}; for (const e of R.poolLog) (byLvl[e.p.lvl] ??= []).push(e.t);
console.log(`\nArchive nodes from the fund: ${Object.entries(byLvl).map(([l, ts]) => `L${l}: ${ts.length}× (${fmtT(ts[0])}–${fmtT(ts[ts.length - 1])})`).join(' · ')}.`);
// gaps
const endT = at(endId);
const allTimes = R.log.filter((e) => e.t <= endT + 1e-9).map((e) => e.t).sort((a, b) => a - b);
let gapAll = 0, gapAllAt = 0; for (let i = 1; i < allTimes.length; i++) if (allTimes[i] - allTimes[i - 1] > gapAll) { gapAll = allTimes[i] - allTimes[i - 1]; gapAllAt = allTimes[i - 1]; }
const mainTimes = main.filter((e) => e.t <= endT + 1e-9).map((e) => e.t);
let gapMain = 0, gapMainAt = 0; for (let i = 1; i < mainTimes.length; i++) if (mainTimes[i] - mainTimes[i - 1] > gapMain) { gapMain = mainTimes[i] - mainTimes[i - 1]; gapMainAt = mainTimes[i - 1]; }
const mainRatio = R.finMain / R.finEarned, sideRatio = R.finSide / R.finEarned;
const refitH = (a, ids, bId) => { const c = ids.reduce((s, id) => s + (goals.find((g) => g.id === id)?.cost ?? 0), 0); const i0 = main.findIndex((e) => e.g.id === a), i1 = main.find((e) => e.g.id === bId); return c / ((main[i0 - 1].inc + i1.inc) / 2); };
const megaUnits = goals.filter((g) => g.baseUnits).reduce((s, g) => s + g.baseUnits, 0);
console.log('\n#### D. Summary\n');
{ const tot = Object.values(R.src).reduce((a, b) => a + b, 0); console.log(`- Inflows to the end (${k(tot)}): ` + Object.entries(R.src).filter(([, v]) => v > 0).map(([n, v]) => `${({ mining: 'mining', contracts: 'contracts', loot: 'loot', salvage: 'salvage', bases: 'bases', rewards: 'boss rewards', charts: 'charts', sites: 'derelict stations and graveyards', ambush: 'ambushes', workshop: 'onboard workshop' })[n]} ${(v / tot * 100).toFixed(0)}%`).join(' · ')); }
console.log(`- To the end: main path ${(mainRatio * 100).toFixed(0)}% of the credits earned, optional goals ${(sideRatio * 100).toFixed(0)}%.`);
if (megaUnits) console.log(`- Megaproject: ${megaUnits.toLocaleString('en-US')} u = ${(megaUnits / (4 * BASE_UNITS_PER_S * 3600)).toFixed(1)} h of output of 4 bases; bought extra at stations: ${Math.round(R.megaBought).toLocaleString('en-US')} u.`);
console.log(`- Rare resources mined / used by the main path / bought: ${['kr', 'vz', 'he', 'ex'].map((r) => `${r.toUpperCase()} ${k(R.mined[r] ?? 0)} / ${k(R.used[r] ?? 0)} / ${k(R.bought[r] ?? 0)}`).join(' · ')}.`);
console.log(`- Chart sales: ${[1, 2, 3, 4].map((r) => `P${r} ${k(R.chartCreditsByRing[r])}`).join(' · ')} (total ${k(R.chartCredits)} cr).`);
console.log(`- Of which charting sectors: ${[1, 2, 3, 4].map((r) => `P${r} ${Math.round(R.chartByRing[r]).toLocaleString('en-US')}`).join(' · ')} (total ${Math.round(R.chartData).toLocaleString('en-US')}).`);
console.log(`- Data collected by ring: ${[1, 2, 3, 4].map((r) => `P${r} ${Math.round(R.dataByRing[r]).toLocaleString('en-US')}`).join(' · ')}.`);
console.log(`- Income by hour: ${R.hourly.filter((x) => [1, 3, 5, 8, 10, 13, 15, 20, 25, 30, 35, 40, 45].includes(x.h)).map((x) => `h${x.h}: ${k(x.inc)} (P${x.ring})`).join(' · ')}`);
// M4b "World Comes Alive": the same model without the M4b sources (--sites=0) next to it
const p2Builds = main.filter((e) => e.ring === 2 && e.b && !e.g.fixedH);
const p2Inc = p2Builds.map((e) => ({ id: e.g.id, off: income(e.b, 2, 0), on: income(e.b, 2, 1) }));
const p2IncMax = Math.max(...p2Inc.map((x) => x.on.total / x.off.total - 1));
const dataAll = (r, sx) => dataPerHour(r, sx) + chartingPerHour(r);
const p2DataUp = dataPerHour(2, 1) / dataPerHour(2, 0) - 1;
if (SITES_X) {
  console.log('\n#### F. M4b “World Comes Alive” – new sources and sinks (compared with the game without them, `--sites=0`)\n');
  console.log('| | P1 | P2 | P3 | P4 |\n|---|---|---|---|---|');
  console.log(`| Data/h (POI + Institute) without M4b → with M4b | ${[1, 2, 3, 4].map((r) => `${Math.round(dataPerHour(r, 0))} → ${Math.round(dataPerHour(r, 1))} (${((dataPerHour(r, 1) / dataPerHour(r, 0) - 1) * 100).toFixed(1)}%)`).join(' | ')} |`);
  console.log(`| Data/h including charting sectors | ${[1, 2, 3, 4].map((r) => `${Math.round(dataAll(r, 0))} → ${Math.round(dataAll(r, 1))} (${((dataAll(r, 1) / dataAll(r, 0) - 1) * 100).toFixed(1)}%)`).join(' | ')} |`);
  const refB = { cockpit: 1, lasers: 2, laserTier: 1, holds: 3, holdTier: 1 };
  console.log(`| Comets: share of mining, cr/u of comet vs. mix (grade ×${M4B.comet.grade}) | ${[1, 2, 3, 4].map((r) => `${Math.round(cometShare(r, 1) * 100)}%, ${cometPrice(r).toFixed(2)} vs ${avgPrice(r).toFixed(2)}`).join(' | ')} |`);
  console.log(`| Salvage from graveyards (share of mining; POI wrecks ${Math.round(EXTRA.salvage * 100)}%) | ${[1, 2, 3, 4].map((r) => `${(graveyardSalvage(r, 1) * 100).toFixed(1)}%`).join(' | ')} |`);
  console.log(`| Derelict station terminal services (cr/h) | ${[1, 2, 3, 4].map((r) => k(derelictCredits(r, 1))).join(' | ')} |`);
  console.log(`| Ambushes: net loot (cr/h, ship with 2 T1 lasers) | ${[1, 2, 3, 4].map((r) => k(ambushNet(r, income(refB, r, 1).mining, 1))).join(' | ')} |`);
  console.log(`| Micrometeors: repairs (cr/h) | ${[1, 2, 3, 4].map((r) => `−${k(micrometeorRepairs(r, 1))}`).join(' | ')} |`);
  console.log('\nP2 income after the main-path goals (cr/h, total): ' + p2Inc.map((x) => `${x.id} ${k(x.off.total)} → ${k(x.on.total)} (${((x.on.total / x.off.total - 1) * 100).toFixed(1)}%)`).join(' · ') + '.');
  console.log(`\nSink for micrometeor repairs to the end: ${k(R.micrometeorCost)} cr.`);
}
// M4c "Home and Workshop": the on-board workshop on the P2 / P3 builds of the main path, the large reactor, home modules
const p23Builds = main.filter((e) => (e.ring === 2 || e.ring === 3) && e.b && !e.g.fixedH);
const wsRows = p23Builds.map((e) => {
  const w = workshopIncome(e.b, e.ring, 1, 1);
  return { id: e.g.id, ring: e.ring, share: refinedShare(e.b, e.ring), refinery: w.refinery / w.base, repair: w.repair / w.base, total: w.total / w.base - 1, cargo: cargoIncome(e.b, e.ring) / w.base - 1 };
});
const wsMax = Math.max(...wsRows.filter((x) => x.ring === 2).map((x) => x.total));
const wsDominant = wsRows.filter((x) => x.refinery > x.cargo);
if (WORKSHOP_X) {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log('\n#### G. M4c “Home and Workshop” – onboard workshop, large reactor, home modules\n');
  console.log(`Refinery T1 (${M4C.refinery[1].ore} ore/s, tops up the fuel from the ice in the hold first) sells the refined share of the ore for +${M4C.refinedBonus * 100}% (never together with demand); repair module T1 saves the credit part of the station repair (${pct(M4C.repairCreditShare[1])}) on ${pct(M4C.repairCover)} of the damage (micrometeors and ambushes). Last column: the same ${M4C.refineryHull} pts as cargo space (+${M4C.refineryHull} cargo modules of the build's tier).\n`);
  console.log('| Goal (build) | Ring | Refined share of the ore | Refinery | Repair module | Workshop total | +2 cargo (the same 2 pts) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const x of wsRows) console.log(`| ${x.id} | P${x.ring} | ${pct(x.share)} | +${pct(x.refinery)} | +${pct(x.repair)} | +${pct(x.total)} | +${pct(x.cargo)} |`);
  console.log(`\nWorkshop bought at ${R.workshopAt === null ? '–' : fmtT(R.workshopAt)} (side goal), to the end: ${k(R.src.workshop)} cr.`);
  const lr = (t) => M4C.largeReactor[t].energy / M4C.largeReactorHull, re = (t) => M4C.reactor[t].energy;
  console.log(`\nLarge reactor: energy per hull point T1 ${lr(1).toFixed(1)} vs reactor ${re(1)} (${(lr(1) / re(1)).toFixed(2)}×), T2 ${lr(2).toFixed(1)} vs ${re(2)} (${(lr(2) / re(2)).toFixed(2)}×); price per 1 energy/s T1 ${Math.round(M4C.largeReactor[1].value / M4C.largeReactor[1].energy)} cr vs reactor ${Math.round(V[1].reactor / re(1))} cr – the explosion (40 / 50 dmg to neighbours) is the price of the density.`);
  console.log(`\nHome modules (M4c buys the first two): paint shop ${k(M4C.home.paintShop.credits)} + trophy hall ${k(M4C.home.trophyHall.credits)} = ${k(M4C.home.paintShop.credits + M4C.home.trophyHall.credits)} cr (side goal “Paint shop + trophy hall”); refinery ${k(M4C.home.homeRefinery.credits)} cr + ${M4C.home.homeRefinery.ti} Ti (M5a), observatory + laboratory ${k(M4C.home.observatory.credits + M4C.home.laboratory.credits)}, drone hub ${k(M4C.home.droneHub.credits)} (M5b). Part variants (3×) ${k(M4C.variantsSide)} cr.`);
}
// M4d "Guild and Trade": convoy trade, escort, Guild relay (one-off), secured sectors
const relayE = main.find((e) => e.g.id === 'relay');
const relayB = relayE?.b ?? { cockpit: 1, lasers: 3, laserTier: 2, holds: 5, holdTier: 1 };
const relayInc = relayE ? relayE.inc : income(relayB, 2).total;
const partLoss = M4D.convoy.rareMarkup * M4D.partBuy - M4D.partSell; // × part value per convoy part resold at a station
if (GUILD_X) {
  const kr = (x) => k(x);
  const dec = (x) => String(x);
  console.log('\n#### H. M4d “Guild and Trade” – convoys, escort, Guild relay\n');
  console.log(`Convoy (every ${M4D.convoy.periodMinutes} min per lane, P1–P3): buys cargo at ${dec(M4D.convoy.sellMult)} × the station (≤ ${M4D.convoy.buyCap} u per pass, refined bonus yes, demand never), tanker fuel at ${dec(M4D.convoy.fuelMult)} × (≤ ${M4D.convoy.fuelCap} u), 3 rare items (fragment ${M4D.convoy.fragmentPrice[1]} / ${M4D.convoy.fragmentPrice[2]} / ${M4D.convoy.fragmentPrice[3]} cr, parts at ${dec(M4D.convoy.rareMarkup)} × market). In the model: the cargo sale = a convenience at −10% (no income), the purchases = a sink (side goal “Convoys: ${M4D.fragmentsSide} fragments”), the escort = a share of the contracts (no new income), the relay = a one-off step of the main path.\n`);
  console.log('| | P1 | P2 | P3 |\n|---|---|---|---|');
  console.log(`| Sale of ${M4D.convoy.buyCap} u of mix: station → convoy (cr) | ${[1, 2, 3].map((r) => `${kr(M4D.convoy.buyCap * avgPrice(r))} → ${kr(M4D.convoy.buyCap * avgPrice(r) * M4D.convoy.sellMult)} (−${kr(convoySaleLoss(r))})`).join(' | ')} |`);
  console.log(`| Fuel ${M4D.convoy.fuelCap} u: station → tanker (cr) | ${[1, 2, 3].map((r) => `${kr(M4D.convoy.fuelCap * M4D.fuelBase * M4D.serviceMult[r])} → ${kr(M4D.convoy.fuelCap * M4D.fuelBase * M4D.serviceMult[r] * M4D.convoy.fuelMult)} (+${kr(convoyFuelPremium(r))})`).join(' | ')} |`);
  console.log(`| Plan fragment: price / minutes of the relay build's income (${kr(relayInc)} cr/h) | ${[1, 2, 3].map((r) => `${M4D.convoy.fragmentPrice[r]} cr / ${((M4D.convoy.fragmentPrice[r] / relayInc) * 60).toFixed(1)} min`).join(' | ')} |`);
  console.log(`| Convoy part resold at a station (× part value) | ${[1, 2, 3].map((r) => `${(M4D.convoy.rareMarkup * M4D.partBuy * M4D.partRingMult[r]).toFixed(2)} → ${dec(M4D.partSell)} (loss ${(M4D.convoy.rareMarkup * M4D.partBuy * M4D.partRingMult[r] - M4D.partSell).toFixed(2)})`).join(' | ')} |`);
  console.log(`\nEscort: reward ${escortRate(0.25).toFixed(2)} / ${escortRate(0.5).toFixed(2)} × the reference income per estimated hour (risk 0.25 / 0.5; a deposit of ${M4D.escort.deposit * 100}% of the reward, returned on arrival), weight ${M4D.escort.weight} on station boards by the lanes – it replaces other slips, the contract share (${Math.round(EXTRA.contracts * 100)}% of mining) does not change.`);
  console.log(`\nGuild relay (built at \`relay\`, P2): ${M4D.relay.lanes} contracts × ${M4D.relay.seconds} s of estimate → ${kr(relayReward(relayB))} cr per lane (k ${dec(M4D.relay.k)}, risk ${dec(M4D.relay.risk)}, reference income ${kr(refIncome(relayB, 2))} cr/h), materials ${Object.entries(M4D.relay.repair).map(([r, q]) => `${q} ${r.toUpperCase()}`).join(' + ')} ≈ ${Math.round(relayMaterials())} cr; total ${kr(R.relayPaid)} cr net for ${((M4D.relay.lanes * M4D.relay.seconds) / 60).toFixed(1)} min of content = ${(R.relayPaid / relayInc).toFixed(2)} h of the build's income. A secured sector (Contested → Guarded, 1 per lane) lowers the exposure of a cautious player (bot \`--secured=A,B\`), it does not change the model's income.`);
}
const checks = [];
const add = (n, v, lo, hi, u) => checks.push([n, v, lo, hi, u]);
if (GUILD_X) {
  add('M4d: Guild relay (2 contracts, one-off) – net reward in hours of the build income', R.relayPaid / relayInc, 0.1, 0.6, 'h');
  add('M4d: convoy sale / station sale (no demand)', M4D.convoy.sellMult, 0, 0.9, '×');
  add('M4d: convoy part → resold at a station (× value, loss)', partLoss, 1, 9, '×');
}
if (WORKSHOP_X) {
  add('M4c: workshop (refinery + repair module) – extra P2 income (at most after the P2 goals)', wsMax * 100, 0, 12, '%');
  add('M4c: P2/P3 builds where the refinery beats +2 pts of cargo space', wsDominant.length, 0, 0, 'pcs');
  add('M4c: large reactor – energy per hull point vs the reactor (T1)', M4C.largeReactor[1].energy / M4C.largeReactorHull / M4C.reactor[1].energy, 1.2, 2.5, '×');
}
if (SITES_X) {
  add('M4b: P2 Data/h (POI + Institute) vs the game without M4b', p2DataUp * 100, -100, 10, '%');
  add('M4b: P2 income vs the game without M4b (at most after the P2 goals)', p2IncMax * 100, -100, 8, '%');
}
add('Cargo hold T1 (M2 §6.4: 4–6 min)', at('cargo1') * 60, 4, 6, 'min');
add('2nd laser + reactor (M2 8–12 min → revision 12–16 min)', at('laser2') * 60, 12, 16, 'min');
add('First flights to P2 (M2: 15–25 min)', at('tank') * 60, 15, 25, 'min');
add('First T2 part (M2: 30–45 min)', at('firstT2') * 60, 30, 45, 'min');
add('Refit T1→T2 (hours of income)', refitH('cockpit2', ['cockpit2', 'refitT2a', 'refitT2b'], 'refitT2b'), 1, 1.5, 'h');
add('Refit T2→T3 (hours of income)', refitH('cockpit3', ['cockpit3', 'refitT3a', 'refitT3b'], 'refitT3b'), 3, 4, 'h');
if (SCOPE === 'full') {
  add('Refit T3→T4 core (hours of income)', refitH('cockpit4', ['cockpit4', 'refitT4a', 'refitT4a2'], 'refitT4a'), 5, 6, 'h');
  add('Megaproject = hours of output of 4 bases', megaUnits / (4 * BASE_UNITS_PER_S * 3600), 8, 12, 'h');
  add('Credits', endT, 45, 55, 'h');
  add('Rest of the T4 ship after the credits', at('refitT4b') - endT, 3, 99, 'h');
  add('Main path / earned until the credits', mainRatio * 100, 55, 80, '%');
} else add('MLLG: end of the main path', endT, 14, 18, 'h');
add(`Longest gap between main goals (from ${fmtT(gapMainAt)})`, gapMain, 0, 4, 'h');
add(`Longest gap between any unlocks (from ${fmtT(gapAllAt)})`, gapAll, 0, 2, 'h');
add('Goals without material / without a source', R.matIssues.length, 0, 0, 'pcs');
for (const r of [2, 3, 4]) { const need = Math.max(...goals.filter((g) => g.ring === r + 1 || (g.data && (main.find((e) => e.g.id === g.id)?.ring === r))).map((g) => g.data ?? 0), 0);
  const cum = [1, 2, 3, 4].filter((x) => x <= r).reduce((s, x) => s + ringSupply(x), 0); if (need) add(`POI Data stock in P1–P${r} ≥ 2× the highest threshold in P${r} (${need})`, cum / need, 2, 999, '×'); }
console.log('\n#### E. Goal checks\n');
console.log('| Check | Model | Target | OK |\n|---|---|---|---|');
for (const [n, v, lo, hi, u] of checks) console.log(`| ${n} | ${v.toFixed(1)} ${u} | ${lo}–${hi} ${u} | ${v >= lo && v <= hi ? 'yes' : '**no**'} |`);
if (R.matIssues.length) console.log('\nMaterial issues:\n' + R.matIssues.map((x) => `- ${x}`).join('\n'));
}

// output only when run directly (an import from a test does not run it)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
