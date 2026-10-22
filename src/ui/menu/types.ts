// Data and handlers of the app overlay (menu, pause, settings) – filled by src/game/app/App.ts.
import type { DeathTemplateView } from '../../game/fleet/types';
import type { AppState, MenuPage } from '../../game/app/appState';
import type { SlotOverview } from '../../game/save/saveService';
import type { UserSettings } from '../../game/settings/userSettings';
import type { GraphicsQuality } from '../../render/quality';
import type { SlotMeta } from '../../sim/save/meta';
import type { SlotRef } from '../../sim/save/types';
import type { DeathView, Silhouette } from '../../game/combatView';
import type { PartInventory } from '../../data/parts';
import type { Cargo } from '../../data/resources';
import type { DifficultyChoice, GameSettings } from '../../sim/settings';
import type { CrashView } from '../../game/app/crash';
import type { ToastTone } from '../theme';

export interface StorageStatus {
  /** IndexedDB works (otherwise saves live only in the tab's memory). */
  available: boolean;
  /** Result of navigator.storage.persist(): null = not asked yet. */
  persistent: boolean | null;
  bannerDismissed: boolean;
}

export type SaveIndicatorState = { phase: 'saving' | 'saved' | 'failed'; leaving: boolean } | null;

export interface PauseInfo {
  /** The game has a slot (the ?play quick start is not saved). */
  saving: boolean;
  /** ms since the last save (null = not saved yet). */
  sinceSave: number | null;
  settings: GameSettings;
  slot: SlotRef | null;
  /** The ship flies and is not destroyed – it can be abandoned (stranded without engines, C2). */
  canScuttle: boolean;
}

export interface DeathInfo {
  view: DeathView;
  /** Black box: the silhouette with the lost parts and the order they fell in (null = none). */
  blackBox?: { silhouette: Silhouette; order: number[]; total: number } | null;
  /** Resources and wreck parts that are lost (empty when the penalty keeps the cargo). */
  lostCargo?: Partial<Cargo>;
  lostSalvage?: PartInventory;
  respawnName: string;
  /** Free evacuation to a station with a shipyard (null = not needed). */
  evacuationName: string | null;
  /** "Restore from template" (M4a): null / absent hides the action. */
  template?: DeathTemplateView;
}

export interface OverlayData {
  state: AppState;
  version: string;
  /** Slot overview (null = still loading). */
  slots: SlotOverview[] | null;
  continueMeta: SlotMeta | null;
  storage: StorageStatus;
  settings: UserSettings;
  /** Graphics level in effect (what auto picked); null = no game running. */
  graphicsLevel?: GraphicsQuality | null;
  /** A game is being loaded / created. */
  busy: string | null;
  /** An error on the menu home screen (e.g. Continue failed). */
  menuError: string | null;
  toast: { text: string; tone: ToastTone } | null;
  indicator: SaveIndicatorState;
  pause: PauseInfo | null;
  death: DeathInfo | null;
  /** The frame loop crashed: what the card says (null = no crash). */
  crash: CrashView | null;
  /** Slot of the running game (Load from the pause menu marks it). */
  currentSlot: SlotRef | null;
  /** Preselected slot of the New game screen (from Load → "New game here"). */
  newGameSlot: SlotRef | null;
  /** Default of "Skip training" on the New Game screen (M3.7, remembered in the browser). */
  skipTraining: boolean;
}

export interface NewGameRequest {
  slot: SlotRef;
  seedText: string;
  choice: DifficultyChoice;
  /** Start with the full starter ship instead of the Guild Training (M3.7). */
  skipTraining: boolean;
}

export interface OverlayHandlers {
  open(page: MenuPage): void;
  back(): void;
  continueGame(): void;
  newGame(request: NewGameRequest): void;
  /** New game with a preselected slot (Load → "New game here"). */
  newGameInto(slot: SlotRef): void;
  loadSlot(slot: SlotRef, which: 'current' | 'backup'): void;
  deleteSlot(slot: SlotRef): void;
  exportSlot(slot: SlotRef): void;
  importFile(file: File): void;
  resume(): void;
  saveNow(): void;
  exportCurrent(): void;
  quit(): void;
  /** Abandon ship (destroys the cockpit → the death sequence with the difficulty's penalty). */
  scuttle(): void;
  /** Continue and open the Objectives / Storages panel (M3.5a). */
  openCareer(panel: 'objectives' | 'storages'): void;
  /** Apply the penalty and continue; evacuate = accept the free evacuation to a shipyard. */
  respawn(evacuate: boolean): void;
  /** Respawn and open the shipyard with the Templates modal (M4a, the death card's template action). */
  respawnFromTemplate?(): void;
  /** Crash card: leave to the menu without saving. */
  leaveCrash(): void;
  /** Crash card: copy the error details; resolves false when the clipboard refused. */
  copyCrashReport(): Promise<boolean>;
  setSettings(patch: Partial<UserSettings>): void;
  resetSettings(): void;
  dismissBanner(): void;
  randomSeed(): string;
  click(): void;
  hover(): void;
}
