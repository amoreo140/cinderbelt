// View models of the home station's Development tab (M4c): module rows, the Forge Index,
// the paint shop and the trophy hall. T2 builds them from `SimState` (developmentView.ts,
// paintShopView.ts, trophyHallView.ts); the UI (T3) only reads them.
import type { HomeModuleId } from '../../data/home';
import type { Cargo } from '../../data/resources';
import type { PaintId } from '../../data/paints';
import type { ShipId } from '../../sim/fleet/types';
import type { TrophyId } from '../../sim/home/types';

export interface ModuleRow {
  id: HomeModuleId;
  name: string;
  effect: string;
  credits: number;
  resources?: Partial<Cargo>;
  state: 'owned' | 'buyable' | 'future';
  /** Why the module cannot be built now (missing credits, …); none when it can. */
  reason?: string;
  /** Milestone tag of a future module ("M5a"). */
  since?: string;
  /** Icon path (`homeModuleIconPath`). */
  icon: string;
}

export interface PaintShopShip {
  shipId: ShipId;
  name: string;
  /** The active ship docked at home, or a ship stored in the home hangar. */
  where: 'docked' | 'hangar';
  paint: PaintId;
}

export interface PaintShopData {
  ships: PaintShopShip[];
  selectedShip: ShipId | null;
  /** Paint previewed on the selected ship (UI state only – never in the simulation), or null. */
  preview: PaintId | null;
}

export interface TrophyCard {
  id: TrophyId;
  title: string;
  subtitle: string;
  /** Part names of the replicas the captain carried. */
  replicas: string[];
  pinned: boolean;
}

export interface TrophyHallData {
  /** The six pedestals (TROPHY_PEDESTALS), null = empty. */
  shelf: (TrophyCard | null)[];
  all: TrophyCard[];
}

export interface DevelopmentData {
  forgeIndex: number;
  forgeMax: number;
  modules: ModuleRow[];
  selected: HomeModuleId;
  /** Null until the paint shop is built. */
  paintShop: PaintShopData | null;
  /** Null until the trophy hall is built. */
  trophyHall: TrophyHallData | null;
  /**
   * The trophies won so far while the hall is not built (shown greyed with "Build the Trophy hall");
   * empty once the hall stands (then `trophyHall.all` lists them) or when there are none.
   */
  trophiesWithoutHall?: TrophyCard[];
}

export interface DevelopmentHandlers {
  select(module: HomeModuleId): void;
  build(module: HomeModuleId): void;
  selectShip(id: ShipId): void;
  preview(paint: PaintId | null): void;
  paint(): void;
  pin(id: TrophyId, on: boolean): void;
  /** Fly the dock camera to a module ("Show"), null = back to the dock view. */
  focus(module: HomeModuleId | null): void;
}

/** `window.__cinder.home` (dev builds; T2 fills the helpers). */
export interface HomeDevHooks {
  /** Builds a module through the normal command (dock at home first). */
  build?(module: HomeModuleId): void;
  /** Sets the credits (dev only). */
  credits?(n: number): void;
  /** The Development tab's view model as the hub would get it now (null away from home). */
  data?(): DevelopmentData | null;
  /** The module the dock camera frames ("Show"), or null. */
  focus?(): HomeModuleId | null;
  /** The same handlers the Development tab uses. */
  handlers?: DevelopmentHandlers;
}
