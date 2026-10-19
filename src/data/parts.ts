import { VARIANTS, VARIANT_IDS, type VariantId, type VariantMods } from './variants';

export type PartId =
  | 'cockpit'
  | 'armor'
  | 'engine'
  | 'gyro'
  | 'miningLaser'
  | 'cargo'
  | 'fuelTank'
  | 'reactor'
  | 'radar'
  | 'cannon'
  | 'shield'
  | 'heavyLaser'
  | 'largeCargo'
  | 'battery'
  | 'tractorBeam'
  | 'largeReactor'
  | 'repairModule'
  | 'refinery';

/** Part tier: 1 = iron, 2 = titanium. */
export type Tier = 1 | 2;

/**
 * Key "type + tier (+ variant)" for the stock, market and recipes, e.g. 'engine:2' or 'engine:2:overdrive'
 * (part variants from blueprints and the Archive, M3.5b). Only keys from ALL_PART_KEYS are valid (isPartKey).
 */
export type PartKey = `${PartId}:${Tier}` | `${PartId}:${Tier}:${VariantId}`;

export const partKey = (partId: PartId, tier: Tier, variant?: VariantId): PartKey =>
  variant ? `${partId}:${tier}:${variant}` : `${partId}:${tier}`;

/** Key of a fitted part (with the variant). */
export const placedKey = (p: { partId: PartId; tier: Tier; variant?: VariantId }): PartKey => partKey(p.partId, p.tier, p.variant);

export function parsePartKey(key: PartKey): { partId: PartId; tier: Tier; variant?: VariantId } {
  const [partId, tier, variant] = key.split(':') as [PartId, string, VariantId | undefined];
  return variant ? { partId, tier: Number(tier) as Tier, variant } : { partId, tier: Number(tier) as Tier };
}

/** Parts in stock: PartKey → count (a missing key = 0). Parts in stock always have full HP. */
export type PartInventory = Partial<Record<PartKey, number>>;

export interface MiningSpec {
  range: number;
  /** Units mined per second. */
  rate: number;
  energyPerSecond: number;
  /** Heavy laser (M2d): a deep titanium vein gives it ×1.8 instead of ×1.2 (spec 2.1.1). */
  heavy?: boolean;
}

/** Cannon (M3a): fires projectiles in a ±90° arc from the part's direction. */
export interface WeaponSpec {
  /** Damage of one projectile. */
  damage: number;
  /** Shots per second. */
  fireRate: number;
  /** Projectile speed relative to the ship (u/s). */
  projectileSpeed: number;
  /** Projectile range (u) – determines the flight time. */
  range: number;
  energyPerShot: number;
}

/** Tractor beam (M3.6, spec 5.3.1): pulls containers, parts and small wrecks, tears loose parts off wrecks. */
export interface TractorSpec {
  /** Beam range (u). */
  range: number;
  /** Acceleration with which the beam pulls an object to the ship (u/s² for one part; a heavier object slower). */
  pull: number;
  /** Most wreck parts the beam can pull (a container = 1 part). */
  maxParts: number;
  /** Energy use (u/s) while the beam holds an object. */
  energyPerSecond: number;
  /** How long it takes to tear a loose part off a wreck (s). */
  ripSeconds: number;
}

/** Shield generator (M3a): the shields of all the ship's generators add up to one. */
export interface ShieldSpec {
  capacity: number;
  /** Recharge (shield points per second). */
  regen: number;
  /** Recharge delay after a hit (s). */
  regenDelay: number;
  /** Energy per recharged shield point. */
  energyPerPoint: number;
}

/** On-board refinery (M4c, plan §2.4): in flight it turns ice into fuel, else raw ore into refined ore. */
export interface RefinerySpec {
  /** Ice turned into fuel per second (at the station ratio `FUEL_PER_ICE`). */
  icePerSecond: number;
  /** Raw ore units refined per second (titanium → copper → iron). */
  orePerSecond: number;
  /** Energy per second while it works. */
  energyPerSecond: number;
}

/** Repair module (M4c, plan §2.4): in flight it repairs one edge neighbour from the ship's cargo. */
export interface RepairSpec {
  hpPerSecond: number;
  /** Energy per second while it works. */
  energyPerSecond: number;
}

export interface PartDef {
  id: PartId;
  /** Size in cells at rotation 0. */
  size: { w: number; h: number };
  mass: number;
  hp: number;
  /** Engine: force along the part's orientation. */
  thrust?: number;
  /** Gyroscope (and the cockpit's built-in gyroscope): torque. */
  torque?: number;
  /**
   * Cockpit: built-in manoeuvring thrusters (RCS) – a weak force in every direction where the ship
   * has no engines. The dampers use it to slowly cancel any drift; Q/E and S use it on a ship with a
   * main engine (control.ts).
   */
  rcsThrust?: number;
  /** Cargo capacity (resource units). */
  cargo?: number;
  /** Kapacita paliva. */
  fuel?: number;
  /** Battery capacity. */
  battery?: number;
  /** Energy production per second. */
  energyGen?: number;
  mining?: MiningSpec;
  weapon?: WeaponSpec;
  shield?: ShieldSpec;
  tractor?: TractorSpec;
  refinery?: RefinerySpec;
  repair?: RepairSpec;
  /**
   * Explosive part (large reactor, M4c): when it drops to 0 HP, every other part 8-adjacent to its
   * footprint takes this much damage straight to HP (sim/combat/partBlast.ts).
   */
  blast?: number;
  radarRange?: number;
  /** Cockpit: hull budget in points (spec 3.4.1). */
  hullBudget?: number;
  /** Cargo bay: share of the cargo spilled when the part is destroyed (large cargo 50 %). */
  cargoSpill?: number;
  /** Engine: fuel use multiplier (overdrive / eco variants; missing = 1). */
  fuelUse?: number;
  /** Scanner pulse charge multiplier (scout cockpit; missing = 1). */
  pulseCooldown?: number;
  /** Part variant (M3.5b), if it is not the base part. */
  variant?: VariantId;
  /** Colour of the placeholder model. */
  color: number;
}

/** Hull budget of the cockpit by grade (spec 3.4.1); T3 and T4 so far only as data. */
export const COCKPIT_HULL_BUDGET = { 1: 28, 2: 48, 3: 80, 4: 140 } as const;

/**
 * Cockpit RCS force by tier: the Guild Training hull (≈ 11.5 mass) gets ≈ 1.2 u/s² – a sideways drift
 * of 2 u/s dies in under 2 s – while one T1 side engine (90) pushes over 6× harder.
 */
export const COCKPIT_RCS_THRUST = { 1: 14, 2: 20 } as const;

const ONE = { w: 1, h: 1 };
const TWO_BY_ONE = { w: 2, h: 1 };
const TWO_BY_TWO = { w: 2, h: 2 };

/**
 * Part parameters by tier (spec M2, 6.2). T1 = values from M1, T2 (titanium) = mass ×0.8,
 * HP ×1.75, main function ×1.5 – written out explicitly, not by a formula, so they can be tuned.
 */
export const PART_DEFS: Record<PartId, Record<Tier, PartDef>> = {
  cockpit: {
    1: {
      id: 'cockpit', size: ONE, mass: 4, hp: 60, torque: 12, rcsThrust: COCKPIT_RCS_THRUST[1],
      cargo: 10, fuel: 20, battery: 20, energyGen: 2, radarRange: 60, hullBudget: COCKPIT_HULL_BUDGET[1], color: 0x4fc3f7,
    },
    2: {
      id: 'cockpit', size: ONE, mass: 3.2, hp: 105, torque: 18, rcsThrust: COCKPIT_RCS_THRUST[2],
      cargo: 15, fuel: 30, battery: 30, energyGen: 3, radarRange: 80, hullBudget: COCKPIT_HULL_BUDGET[2], color: 0x8fdcff,
    },
  },
  armor: {
    1: { id: 'armor', size: ONE, mass: 2, hp: 40, color: 0x8d99ae },
    2: { id: 'armor', size: ONE, mass: 1.6, hp: 70, color: 0xbfcbe0 },
  },
  engine: {
    1: { id: 'engine', size: ONE, mass: 1.5, hp: 25, thrust: 90, color: 0xff9f43 },
    2: { id: 'engine', size: ONE, mass: 1.2, hp: 44, thrust: 135, color: 0xffc58a },
  },
  gyro: {
    1: { id: 'gyro', size: ONE, mass: 2, hp: 30, torque: 45, color: 0xb388ff },
    2: { id: 'gyro', size: ONE, mass: 1.6, hp: 52, torque: 68, color: 0xd2bcff },
  },
  miningLaser: {
    1: {
      id: 'miningLaser', size: ONE, mass: 1.5, hp: 25,
      mining: { range: 14, rate: 2.5, energyPerSecond: 6 }, color: 0xff5b7f,
    },
    2: {
      id: 'miningLaser', size: ONE, mass: 1.2, hp: 44,
      mining: { range: 18, rate: 3.75, energyPerSecond: 8 }, color: 0xff9bb0,
    },
  },
  cargo: {
    1: { id: 'cargo', size: ONE, mass: 1.5, hp: 30, cargo: 60, color: 0x6d8f5a },
    2: { id: 'cargo', size: ONE, mass: 1.2, hp: 52, cargo: 90, color: 0x9dbf8a },
  },
  fuelTank: {
    1: { id: 'fuelTank', size: ONE, mass: 1.5, hp: 20, fuel: 100, color: 0xe8d15a },
    2: { id: 'fuelTank', size: ONE, mass: 1.2, hp: 35, fuel: 150, color: 0xf3e39a },
  },
  reactor: {
    1: { id: 'reactor', size: ONE, mass: 3, hp: 30, energyGen: 8, battery: 40, color: 0x5ae8c8 },
    2: { id: 'reactor', size: ONE, mass: 2.4, hp: 52, energyGen: 12, battery: 60, color: 0x9af3df },
  },
  radar: {
    1: { id: 'radar', size: ONE, mass: 1, hp: 15, radarRange: 180, color: 0x7fb2ff },
    2: { id: 'radar', size: ONE, mass: 0.8, hp: 26, radarRange: 260, color: 0xb5d3ff },
  },
  cannon: {
    1: {
      id: 'cannon', size: ONE, mass: 1.5, hp: 30,
      weapon: { damage: 6, fireRate: 3, projectileSpeed: 75, range: 85, energyPerShot: 2 }, color: 0xff6b3d,
    },
    2: {
      id: 'cannon', size: ONE, mass: 1.2, hp: 52,
      weapon: { damage: 9, fireRate: 3, projectileSpeed: 85, range: 100, energyPerShot: 2.5 }, color: 0xffa27f,
    },
  },
  shield: {
    1: {
      id: 'shield', size: ONE, mass: 2, hp: 30,
      shield: { capacity: 60, regen: 10, regenDelay: 3, energyPerPoint: 0.5 }, color: 0x5ad8ff,
    },
    2: {
      id: 'shield', size: ONE, mass: 1.6, hp: 52,
      shield: { capacity: 90, regen: 15, regenDelay: 2.5, energyPerPoint: 0.5 }, color: 0x9ae6ff,
    },
  },
  // --- M2d (spec 3.3): in the shop at once, since M3.5b the Archive unlocks them ---
  /** Heavy laser 2×1: mining ×2.4 for energy ×1.8 against a mining laser of the same tier, arc ±60°. */
  heavyLaser: {
    1: {
      id: 'heavyLaser', size: TWO_BY_ONE, mass: 3, hp: 50,
      mining: { range: 16, rate: 6, energyPerSecond: 10.8, heavy: true }, color: 0xff3d6a,
    },
    2: {
      id: 'heavyLaser', size: TWO_BY_ONE, mass: 2.4, hp: 88,
      mining: { range: 20, rate: 9, energyPerSecond: 14.4, heavy: true }, color: 0xff8aa5,
    },
  },
  /** Large cargo bay 2×2: 300 cargo (4 small = 240), spills 50 % of the cargo when destroyed. */
  largeCargo: {
    1: { id: 'largeCargo', size: TWO_BY_TWO, mass: 5, hp: 100, cargo: 300, cargoSpill: 0.5, color: 0x5b7f4a },
    2: { id: 'largeCargo', size: TWO_BY_TWO, mass: 4, hp: 175, cargo: 450, cargoSpill: 0.5, color: 0x8daf7a },
  },
  /** Battery: +120 energy, no production. */
  battery: {
    1: { id: 'battery', size: ONE, mass: 1.5, hp: 25, battery: 120, color: 0x3fd0a8 },
    2: { id: 'battery', size: ONE, mass: 1.2, hp: 44, battery: 180, color: 0x8ae8cf },
  },
  // --- M3.6 (spec 3.3, 5.3.1): freely available (Archive "Tractor beam+" comes in M4) ---
  /** Tractor beam: range 25 u, the head aims ±90° (like the cannon). */
  tractorBeam: {
    1: {
      id: 'tractorBeam', size: ONE, mass: 1.5, hp: 25,
      tractor: { range: 25, pull: 10, maxParts: 4, energyPerSecond: 4, ripSeconds: 3 }, color: 0xb57bff,
    },
    2: {
      id: 'tractorBeam', size: ONE, mass: 1.2, hp: 44,
      tractor: { range: 32, pull: 15, maxParts: 6, energyPerSecond: 5, ripSeconds: 2 }, color: 0xd3b0ff,
    },
  },
  // --- M4c (plan 2026-10-20 §2.4, long-term design 3.3): Archive parts ---
  /** Large reactor 2×2: lots of energy and a big battery, but it blows when destroyed. */
  largeReactor: {
    1: { id: 'largeReactor', size: TWO_BY_TWO, mass: 10, hp: 110, energyGen: 45, battery: 120, blast: 40, color: 0x3fc9a8 },
    2: { id: 'largeReactor', size: TWO_BY_TWO, mass: 8, hp: 190, energyGen: 68, battery: 180, blast: 50, color: 0x86e6cf },
  },
  /** Repair module: in flight it repairs one damaged edge neighbour with Fe / Ti from the cargo. */
  repairModule: {
    1: { id: 'repairModule', size: ONE, mass: 1.5, hp: 30, repair: { hpPerSecond: 1, energyPerSecond: 3 }, color: 0x7bd88f },
    2: { id: 'repairModule', size: ONE, mass: 1.2, hp: 52, repair: { hpPerSecond: 1.5, energyPerSecond: 4 }, color: 0xb0ecbb },
  },
  /** On-board refinery 2×1: ice → fuel, else raw ore → refined ore (+15 % sale price). */
  refinery: {
    1: {
      id: 'refinery', size: TWO_BY_ONE, mass: 4, hp: 55,
      refinery: { icePerSecond: 0.5, orePerSecond: 0.6, energyPerSecond: 5 }, color: 0xd9a35a,
    },
    2: {
      id: 'refinery', size: TWO_BY_ONE, mass: 3.2, hp: 96,
      refinery: { icePerSecond: 0.75, orePerSecond: 0.9, energyPerSecond: 6 }, color: 0xeec48e,
    },
  },
};

/**
 * Order of the parts in the palette, crafting and the market. Newer parts are always appended (cannon
 * and shield M3, the M2d parts, tractor beam M3.6, the M4c parts) – hotkeys 1–9 and existing keys stay.
 */
export const PART_IDS: readonly PartId[] = [
  'cockpit', 'armor', 'engine', 'gyro', 'miningLaser', 'cargo', 'fuelTank', 'reactor', 'radar', 'cannon', 'shield',
  'heavyLaser', 'largeCargo', 'battery', 'tractorBeam',
  'largeReactor', 'repairModule', 'refinery',
];

export const TIERS: readonly Tier[] = [1, 2];

/** Keys of the base parts: T1 first, then T2, in PART_IDS order. */
export const BASE_PART_KEYS: readonly PartKey[] = TIERS.flatMap((tier) => PART_IDS.map((id) => partKey(id, tier)));

/** Variant keys (M3.5b): T1 and T2 of every variant, in VARIANT_IDS order. */
export const VARIANT_PART_KEYS: readonly PartKey[] = TIERS.flatMap((tier) => VARIANT_IDS.map((v) => partKey(VARIANTS[v].base, tier, v)));

/** All part keys: base (T1, T2), then variants. */
export const ALL_PART_KEYS: readonly PartKey[] = [...BASE_PART_KEYS, ...VARIANT_PART_KEYS];

const PART_KEY_SET: ReadonlySet<string> = new Set(ALL_PART_KEYS);

/** A valid part key (e.g. from a command or a save)? */
export const isPartKey = (key: unknown): key is PartKey => typeof key === 'string' && PART_KEY_SET.has(key);

/** A valid variant for the given part type? */
export const variantFits = (partId: PartId, variant: unknown): variant is VariantId =>
  typeof variant === 'string' && (VARIANT_IDS as readonly string[]).includes(variant) && VARIANTS[variant as VariantId].base === partId;

const scaled = (x: number | undefined, k: number | undefined): number | undefined => (x === undefined || k === undefined ? x : x * k);

/** A variant's stats = the base part × the variant's multipliers (the footprint never changes). */
function applyVariant(base: PartDef, variant: VariantId, mods: VariantMods): PartDef {
  const def: PartDef = { ...base, variant };
  if (mods.hp !== undefined) def.hp = Math.round(base.hp * mods.hp);
  if (mods.mass !== undefined) def.mass = base.mass * mods.mass;
  if (mods.thrust !== undefined) def.thrust = scaled(base.thrust, mods.thrust)!;
  if (mods.torque !== undefined) def.torque = scaled(base.torque, mods.torque)!;
  if (mods.fuelUse !== undefined) def.fuelUse = mods.fuelUse;
  if (mods.cargo !== undefined) def.cargo = Math.round(scaled(base.cargo, mods.cargo)!);
  if (mods.fuel !== undefined) def.fuel = Math.round(scaled(base.fuel, mods.fuel)!);
  if (mods.energyGen !== undefined) def.energyGen = scaled(base.energyGen, mods.energyGen)!;
  if (mods.battery !== undefined) def.battery = Math.round(scaled(base.battery, mods.battery)!);
  if (mods.radarRange !== undefined) def.radarRange = Math.round(scaled(base.radarRange, mods.radarRange)!);
  if (mods.hullBudget !== undefined && base.hullBudget !== undefined) def.hullBudget = base.hullBudget + mods.hullBudget;
  if (mods.pulseCooldown !== undefined) def.pulseCooldown = mods.pulseCooldown;
  if (base.mining && (mods.miningRate !== undefined || mods.miningEnergy !== undefined)) {
    def.mining = { ...base.mining, rate: base.mining.rate * (mods.miningRate ?? 1), energyPerSecond: base.mining.energyPerSecond * (mods.miningEnergy ?? 1) };
  }
  if (base.weapon && (mods.fireRate !== undefined || mods.damage !== undefined || mods.range !== undefined)) {
    def.weapon = {
      ...base.weapon,
      fireRate: base.weapon.fireRate * (mods.fireRate ?? 1),
      damage: base.weapon.damage * (mods.damage ?? 1),
      range: base.weapon.range * (mods.range ?? 1),
    };
  }
  if (base.shield && (mods.shieldRegen !== undefined || mods.shieldCapacity !== undefined)) {
    def.shield = { ...base.shield, regen: base.shield.regen * (mods.shieldRegen ?? 1), capacity: Math.round(base.shield.capacity * (mods.shieldCapacity ?? 1)) };
  }
  return def;
}

const VARIANT_DEFS = new Map<string, PartDef>();

/** Part parameters by tier and the optional variant (a variant of another part type is ignored). */
export function partDef(partId: PartId, tier: Tier, variant?: VariantId): PartDef {
  const base = PART_DEFS[partId][tier];
  if (!variant || VARIANTS[variant]?.base !== partId) return base;
  const key = `${partId}:${tier}:${variant}`;
  let def = VARIANT_DEFS.get(key);
  if (!def) {
    def = applyVariant(base, variant, VARIANTS[variant].mods);
    VARIANT_DEFS.set(key, def);
  }
  return def;
}

/** Part parameters by key. */
export function partDefOf(key: PartKey): PartDef {
  const { partId, tier, variant } = parsePartKey(key);
  return partDef(partId, tier, variant);
}

/** T1 parts (values from M1) – the same objects as PART_DEFS[id][1]. */
export const PARTS: Record<PartId, PartDef> = Object.fromEntries(
  PART_IDS.map((id) => [id, PART_DEFS[id][1]]),
) as Record<PartId, PartDef>;
