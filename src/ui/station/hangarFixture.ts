// Kit fixtures of the Hangar modal and the Shipyard header (M4a T5): hand-made view models in the
// shapes of src/game/fleet/types.ts, so the UI can be built and screenshotted before the game layer
// (T4) builds the real ones from `SimState`. Reasons reuse the game's texts (`actionErrors`, market),
// so both languages read right in the UI kit.
import type { CockpitOption, HangarView, ShipCardView, ShipHeaderView } from '../../game/fleet/types';
import { silhouette } from '../../game/combatView';
import type { PartId, Tier } from '../../data/parts';
import { tx } from '../../i18n';
import type { ShipLog } from '../../sim/fleet/types';
import { createGrid } from '../../sim/ship/grid';
import { createStarterShip } from '../../sim/ship/presets';
import type { HpMap, Rotation, ShipGrid } from '../../sim/ship/types';
import type { SimState } from '../../sim/Simulation';
import type { StationDef } from '../../sim/world/stations';
import { formatStationName } from '../stationName';
import { formatCredits } from '../format';
import { shipLogLine } from './hangarFormat';

type Row = [PartId, number, number, Rotation?, Tier?];

/** A T2 fighter: cockpit, cannons, shield, armour, engines. */
const FIGHTER: Row[] = [
  ['cockpit', 0, 0, 0, 2],
  ['cannon', 1, 0, 0, 2],
  ['cannon', 1, 1, 0, 1],
  ['cannon', 1, -1, 0, 1],
  ['armor', 0, 1, 0, 2],
  ['armor', 0, -1, 0, 2],
  ['shield', -1, 0, 0, 1],
  ['reactor', -1, 1, 0, 1],
  ['fuelTank', -1, -1, 0, 1],
  ['engine', -2, 0, 0, 2],
  ['engine', -2, 1, 0, 1],
  ['engine', -2, -1, 0, 1],
  ['gyro', 0, 2, 0, 1],
  ['armor', 0, -2, 0, 1],
];

/** A long T1 hauler: a cargo spine. */
const HAULER: Row[] = [
  ['cockpit', 2, 0],
  ['miningLaser', 3, 0],
  ['cargo', 1, 0],
  ['cargo', 0, 0],
  ['cargo', -1, 0],
  ['cargo', 1, 1],
  ['cargo', 0, 1],
  ['cargo', 1, -1],
  ['cargo', 0, -1],
  ['fuelTank', -1, 1],
  ['reactor', -1, -1],
  ['gyro', 2, 1],
  ['radar', 2, -1],
  ['engine', -2, 0, 0],
  ['engine', -2, 1, 0],
  ['engine', -2, -1, 0],
];

function card(id: number, grid: ShipGrid, hp: HpMap, rest: Omit<ShipCardView, 'id' | 'grid' | 'hp' | 'silhouette'>): ShipCardView {
  return { id, grid, hp, silhouette: silhouette({ player: { grid, hp } } as unknown as Pick<SimState, 'player'>), ...rest };
}

const log = (distance: number, kills: number, mined: number, deaths: number): ShipLog => ({ distance, kills, mined, deaths, built: 0 });

/** Another shipyard station's name ("Lyra-12" style) in the current language. */
const otherStation = (): string => formatStationName({ kind: 'station', name: { prefix: 2, star: 5, number: 12 } } as unknown as StationDef);

/** The kit states of the Hangar modal. */
export type HangarKitState = 'fleet' | 'first' | 'loan' | 'blocked';

function activeShip(state: HangarKitState): ShipCardView {
  const grid = createStarterShip();
  const hp: HpMap = new Map([
    [3, 9],
    [10, 14],
  ]);
  return card(1, grid, hp, {
    name: tx().fleet.names[0]!,
    generated: true,
    active: true,
    stationId: 'home',
    stationName: tx().stationNames.home,
    here: true,
    tierLabel: tx().shipyard.ui.hullCockpit(1),
    hull: { used: 14, budget: 28 },
    hpPct: 0.86,
    cargo: { used: state === 'first' ? 0 : 42.5, cap: 120 },
    fuelPct: 0.64,
    log: state === 'first' ? log(820, 0, 140, 0) : log(12840, 3, 920, 1),
    paint: 'factory',
    ...(state === 'loan' ? { loanNote: 'dissolved' as const } : {}),
  });
}

function fighter(state: HangarKitState): ShipCardView {
  const grid = createGrid(FIGHTER);
  const hp: HpMap = state === 'fleet' ? new Map([[6, 12]]) : new Map();
  const blocked = state === 'blocked' ? tx().actionErrors.trainingActive : undefined;
  return card(2, grid, hp, {
    name: 'Rozbíjač',
    generated: false,
    active: false,
    stationId: 'home',
    stationName: tx().stationNames.home,
    here: true,
    tierLabel: tx().shipyard.ui.hullCockpit(2),
    hull: { used: 14, budget: 48 },
    hpPct: state === 'fleet' ? 0.93 : 1,
    cargo: { used: 0, cap: 0 },
    fuelPct: 0.9,
    log: log(4310, 7, 0, 0),
    paint: 'racing',
    ...(blocked ? { switchReason: blocked } : {}),
    dismantle: { fee: state === 'fleet' ? 120 : 0, scrap: 0, ...(blocked ? { reason: blocked } : {}) },
  });
}

function hauler(): ShipCardView {
  const grid = createGrid(HAULER);
  const hp: HpMap = new Map([
    [5, 6],
    [14, 0.5],
  ]);
  const away = tx().actionErrors.shipNotHere;
  return card(3, grid, hp, {
    name: tx().fleet.names[17]!,
    generated: true,
    active: false,
    stationId: 'kit-lyra',
    stationName: otherStation(),
    here: false,
    tierLabel: tx().shipyard.ui.hullCockpit(1),
    hull: { used: 16, budget: 28 },
    hpPct: 0.71,
    cargo: { used: 318, cap: 420 },
    fuelPct: 0.12,
    log: log(30215, 0, 5480, 2),
    paint: 'navy',
    switchReason: away,
    dismantle: { fee: 0, scrap: 1, reason: away },
  });
}

function cockpits(state: HangarKitState): CockpitOption[] {
  const credits = tx().market.notEnoughCredits;
  if (state === 'first') {
    return [
      { key: 'cockpit:1', source: 'storage', price: 0 },
      { key: 'cockpit:1', source: 'buy', price: 1200, acquire: 'buy' },
      { key: 'cockpit:2', source: 'craft', price: 640, acquire: 'craft', reason: tx().actionErrors.noSlot },
    ];
  }
  return [
    { key: 'cockpit:1', source: 'buy', price: 1200, acquire: 'buy' },
    { key: 'cockpit:2', source: 'buy', price: 5600, acquire: 'buy', ...(state === 'loan' ? { reason: credits } : {}) },
    { key: 'cockpit:2', source: 'craft', price: 640, acquire: 'craft' },
  ];
}

/** A hangar view model for the kit (built at render time, so texts follow the language). */
export function kitHangarView(state: HangarKitState): HangarView {
  const ships = state === 'first' ? [activeShip(state)] : state === 'loan' ? [activeShip(state), hauler()] : [activeShip(state), fighter(state), hauler()];
  const view: HangarView = {
    stationId: 'home',
    slots:
      state === 'first'
        ? { here: 0, usedHere: 0, total: 0, cap: 2, nextPrice: 5000 }
        : state === 'loan'
          ? { here: 1, usedHere: 0, total: 2, cap: 4, nextPrice: 15000, buyReason: `${tx().market.notEnoughCredits}: ${formatCredits(15000)}` }
          : { here: 2, usedHere: 1, total: 2, cap: 2, nextPrice: null, buyReason: tx().actionErrors.slotCap },
    ships,
    newShip: { cockpits: cockpits(state) },
  };
  if (state === 'first') view.newShip.reason = tx().actionErrors.noSlot;
  if (state === 'blocked') {
    view.reason = tx().actionErrors.trainingActive;
    view.slots.buyReason = tx().actionErrors.trainingActive;
    view.newShip.reason = tx().actionErrors.trainingActive;
  }
  return view;
}

/** The Shipyard header for the kit: the active ship of `kitHangarView`. */
export function kitShipHeader(custom = false): ShipHeaderView {
  const ship = activeShip('fleet');
  return {
    id: ship.id,
    name: custom ? 'Stará Brázda' : ship.name,
    generated: !custom,
    log: ship.log,
    logLine: shipLogLine(ship.log),
  };
}
