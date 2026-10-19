// Types of the economy model exports for the CI oracle (src/data/econOracle.test.ts).
type Ring = 1 | 2 | 3 | 4;
type Res = 'fe' | 'cu' | 'ice' | 'ti' | 'kr' | 'he' | 'vz' | 'ex';
type PartName = 'cockpit' | 'armor' | 'engine' | 'gyro' | 'laser' | 'cargo' | 'tank' | 'reactor' | 'radar' | 'cannon' | 'shield' | 'shielding';

export declare const MODEL: {
  BASE: Record<Res, number>;
  RING_MULT: Record<Ring, Record<Res, number>>;
  SELL_SPREAD: number;
  MIX: Record<Ring, Partial<Record<Res, number>>>;
  RING: Record<Ring, { travel: number; search: number; hazard: number; opcost: number; explore: number }>;
  OVERHEAD: number;
  HUMAN_EFF: number;
  VEIN: number;
  LASER_RATE: Record<Ring, number>;
  CARGO_PER_HOLD: Record<Ring, number>;
  COCKPIT_CARGO: Record<Ring, number>;
  V: Record<Ring, Record<PartName, number>>;
  HULL_CAP: Record<Ring, number>;
  OWN_MAT: number;
  TRADE_IN: number;
  EXTRA: { contracts: number; loot: Record<Ring, number>; salvage: number };
  /** POIs with Data: Data per visit (a number or by ring) and the density per chunk. */
  POI: Record<'wreck' | 'anomaly' | 'cache' | 'derelict' | 'graveyard' | 'giant' | 'planet', { d: number | Record<Ring, number>; dens: Record<Ring, number>; m4b?: true }>;
  VISITS_PER_EXPLORE_H: Record<Ring, number>;
  INSTITUTE: { share: number; rate: Record<Ring, number> };
  STORY_DATA_PER_H: number;
  /** Archive nodes from the Data fund: level, price, from which ring. */
  POOL: { lvl: 1 | 2 | 3 | 4; cost: number; ring: Ring }[];
  /** Charting sectors by flight (sectors stage 1b): Data per sector, minutes per sector, sectors per ring. */
  CHARTING: { data: Record<Ring, number>; minutes: Record<Ring, number>; sectors: Record<Ring, number> };
  /** Selling charts (sectors stage 2): sellable share of the charted sectors and their average price (cr). */
  CHART_SALE: { share: Record<Ring, number>; price: Record<Ring, number> };
  /** Hangar slots (M4a): price of the slot of the 2nd and the 3rd ship (side goals "Hangar slot 2 / 3"). */
  HANGAR_SLOT: { 2: number; 3: number };
  /** M4b "World Comes Alive": comets (share of the mining time, ore mix, grade), derelict terminal credits per first berth,
   *  sale value of a graveyard / an average POI wreck, ambushes, micrometeor repairs. */
  M4B: {
    comet: { share: Record<Ring, number>; mix: Partial<Record<Res, number>>; grade: number };
    derelictService: { stash: number; fabricator: number; stashSale: Record<Ring, number>; fee: Record<Ring, number> };
    graveyardSale: Record<Ring, number>;
    wreckSale: Record<Ring, number>;
    ambush: { perHour: Record<Ring, number>; fought: number; intact: number; party: Record<Ring, number>; repair: Record<Ring, number>; fightH: number };
    micrometeor: { hpPerHour: Record<Ring, number>; krPerHp: Record<Ring, number> };
  };
  /** M4c "Home and Workshop": the on-board workshop (refinery, repair module), the large reactor, home modules, variants. */
  M4C: {
    refinedBonus: number;
    refinery: Record<1 | 2, { ore: number; ice: number; energy: number }>;
    refineryHull: number;
    repair: Record<1 | 2, { hp: number; energy: number }>;
    repairHull: number;
    repairCreditShare: Record<1 | 2, number>;
    fuelPerTravelSecond: number;
    repairCover: number;
    largeReactor: Record<1 | 2, { energy: number; value: number }>;
    largeReactorHull: number;
    reactor: Record<1 | 2, { energy: number }>;
    value: { refinery: Record<1 | 2, number>; repairModule: Record<1 | 2, number> };
    archiveFees: number;
    home: Record<'paintShop' | 'trophyHall' | 'homeRefinery' | 'observatory' | 'laboratory' | 'droneHub', { credits: number; ti?: number }>;
    variantFeeMult: number;
    variantsSide: number;
  };
  /** M4d "Cech a obchod": convoy trade, escort, Guild relay, contract reference minimums, station services. */
  M4D: {
    convoy: { sellMult: number; buyCap: number; fuelMult: number; fuelCap: number; fragmentPrice: Record<1 | 2 | 3, number>; rareMarkup: number; periodMinutes: number };
    fragmentsSide: number;
    escort: { k: number; risks: number[]; deposit: number; weight: number; ambushShips: number };
    relay: { k: number; risk: number; lanes: number; ring: Ring; seconds: number; repair: Partial<Record<Res, number>> };
    minRef: Record<Ring, number>;
    fuelBase: number;
    serviceMult: Record<Ring, number>;
    partBuy: number;
    partSell: number;
    partRingMult: Record<Ring, number>;
  };
  /** Thresholds of the key nodes (collected Data) by goal id. */
  DATA_THRESHOLDS: Record<string, number>;
};

export interface ShipBuild {
  cockpit: Ring;
  lasers: number;
  laserTier: Ring;
  holds: number;
  holdTier: Ring;
}

export declare function avgPrice(ring: Ring): number;
export declare function trip(b: ShipBuild, ring: Ring): { cargo: number; secs: number };
/** `sites` = 1 with the M4b sources (default: the --sites flag), 0 = the game without them. */
export declare function income(b: ShipBuild, ring: Ring, sites?: number): { mining: number; total: number };
export declare function run(): { workshopAt: number | null; relayPaid: number; log: { t: number; g: { id?: string; label: string }; kind: string; ring?: Ring; b?: ShipBuild; data?: number }[]; earned: number };
export declare function poiAvg(ring: Ring, sites?: number): { perVisit: number; perChunk: number; dens: number };
export declare function dataPerHour(ring: Ring, sites?: number): number;
export declare function chartingPerHour(ring: Ring): number;
export declare function chartCreditsPerHour(ring: Ring): number;
export declare function chartCreditsPerSector(ring: Ring): number;
export declare function ringSupply(ring: Ring): number;
export declare function cometPrice(ring: Ring): number;
export declare function graveyardSalvage(ring: Ring, sites?: number): number;
export declare function derelictCredits(ring: Ring, sites?: number): number;
export declare function ambushNet(ring: Ring, mining: number, sites?: number): number;
export declare function micrometeorRepairs(ring: Ring, sites?: number): number;
/** Refined share of the ore of a trip with `refineries` refineries of `tier` (0..1). */
export declare function refinedShare(b: ShipBuild, ring: Ring, refineries?: number, tier?: 1 | 2): number;
/** Extra credits per hour of the refineries (refined share × ore value × REFINED_BONUS on the mining income). */
export declare function refineryCredits(b: ShipBuild, ring: Ring, refineries?: number, tier?: 1 | 2, workshop?: number): number;
/** Credits per hour a repair module saves (the credit part of the station repairs it covers). */
export declare function repairSavings(ring: Ring, tier?: 1 | 2, workshop?: number): number;
/** Income of a build without / with the workshop (a refinery + a repair module). */
export declare function workshopIncome(b: ShipBuild, ring: Ring, tier?: 1 | 2, workshop?: number): { base: number; refinery: number; repair: number; total: number };
/** Income of the build with two more holds (the refinery's 2 hull points as cargo). */
export declare function cargoIncome(b: ShipBuild, ring: Ring): number;
/** Share of the ring mix's value that is ore (not ice). */
export declare function oreValueShare(ring: Ring): number;
/** M4d: the contract reference income of a build in a ring (its mining income, at least the ring's minimum). */
export declare function refIncome(b: ShipBuild, ring: Ring): number;
/** M4d: one Guild relay contract's reward for the build (credits). */
export declare function relayReward(b: ShipBuild): number;
/** M4d: the relay repair materials at the ring-2 sell price (credits). */
export declare function relayMaterials(): number;
/** M4d: credits lost by selling one full convoy pass of the ring mix at a convoy instead of a station. */
export declare function convoySaleLoss(ring: Ring): number;
/** M4d: the tanker's premium over the station fuel for a full convoy fuel purchase (credits). */
export declare function convoyFuelPremium(ring: Ring): number;
/** M4d: escort reward per estimated hour over the reference income (k × (1 + risk)). */
export declare function escortRate(risk: number): number;
