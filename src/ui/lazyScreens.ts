// The game's lazily loaded screens (lazy.ts) and when they are fetched: the docked screens once the hub
// is up (StationHub), the map once the flight HUD is (Hud) – both in an idle moment, so the first
// opening finds the screen loaded.
import { lazyComponent, lazyModule, whenIdle } from './lazy';

const yard = lazyModule(() => import('./station/Shipyard'));
const hangar = lazyModule(() => import('./station/Hangar'));
const templates = lazyModule(() => import('./station/Templates'));
const development = lazyModule(() => import('./station/Development'));
const board = lazyModule(() => import('./board/Board'));
const map = lazyModule(() => import('./discovery/MapView'));

export const Shipyard = lazyComponent(yard, (m) => m.Shipyard);
export const ShipyardActions = lazyComponent(yard, (m) => m.ShipyardActions);
export const ShipyardPromptView = lazyComponent(yard, (m) => m.ShipyardPromptView);
export const ShipHeader = lazyComponent(yard, (m) => m.ShipHeader);
export const HangarModal = lazyComponent(hangar, (m) => m.HangarModal);
export const Templates = lazyComponent(templates, (m) => m.Templates);
export const Development = lazyComponent(development, (m) => m.Development);
export const Board = lazyComponent(board, (m) => m.Board);
export const MapView = lazyComponent(map, (m) => m.MapView);

const quietly = (p: Promise<unknown>): void => {
  p.catch((e: unknown) => console.warn('Screen prefetch failed (loaded when opened)', e));
};

/** The docked screens (shipyard, hangar, templates, Development, Board): the hub is up. */
export function prefetchHubScreens(): void {
  whenIdle(() => {
    for (const m of [yard, hangar, templates, development, board]) quietly(m.load());
  }, 1000);
}

/** The map: the flight HUD is up (M opens it any time). */
export function prefetchMap(): void {
  whenIdle(() => quietly(map.load()), 2000);
}
