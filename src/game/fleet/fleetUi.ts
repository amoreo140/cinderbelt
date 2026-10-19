// Fleet UI state and handlers (M4a, T4): which fleet modal is open (Hangar,
// Templates), the handlers that turn the modals' buttons into GameActions, the view models the hub and
// the game UI draw, and the dev hooks e2e tests read (`window.__cinder.fleet`).
import { tx } from '../../i18n';
import type { GameActionInput } from '../../sim/commands';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { decodeTemplate, encodeTemplate } from '../../sim/templates/codec';
import type { StationDef } from '../../sim/world/stations';
import type { ToastKind } from '../../ui/GameUi';
import type { ShipyardEditor } from '../shipyardEditor';
import { dockedStation, hangarView, shipHeaderView, storageShipRows } from './hangarView';
import { ViewMemo } from '../viewMemo';
import { savableParts, templatesView } from './templatesView';
import type { HangarHandlers, HangarView, ShipHeaderView, StorageShipRow, TemplateHandlers, TemplatesView } from './types';

export interface FleetUiHost {
  state(): SimState;
  /** Queues an action for the next simulation step; returns its reqId. */
  send(action: GameActionInput): number;
  render(): void;
  click(): void;
  notify(text: string, kind: ToastKind, seconds: number): void;
  /** The shipyard editor of the docked station, if the Shipyard tab has been opened here. */
  editor(): ShipyardEditor | null;
  /** Switches the hub to the Shipyard tab and returns its editor (null: not docked at a shipyard). */
  openShipyard(): ShipyardEditor | null;
}

/** The Templates modal as the game UI draws it. */
export interface TemplatesModalData {
  view: TemplatesView;
  /** The shipyard holds a valid draft that differs from the ship – offered as the source of "Save". */
  draft: boolean;
}

/** What the dev hooks expose for e2e tests (state reads and the same handlers the UI uses). */
export interface FleetDevHooks {
  hangar(): HangarView;
  templates(): TemplatesView;
  header(): ShipHeaderView;
  storages(): StorageShipRow[];
  modals(): { hangar: boolean; templates: boolean };
  hangarHandlers: HangarHandlers;
  templateHandlers: TemplateHandlers;
}

export class FleetUi {
  hangarOpen = false;
  /** The hub's hangar view (see hubExtras). */
  private readonly hangarMemo = new ViewMemo<HangarView>();
  templatesOpen = false;

  constructor(private readonly host: FleetUiHost) {}

  /** A fleet modal is open: the game's own hotkeys wait. */
  get modalOpen(): boolean {
    return this.hangarOpen || this.templatesOpen;
  }

  closeModals(): void {
    this.hangarOpen = false;
    this.templatesOpen = false;
  }

  private docked(): StationDef | null {
    return dockedStation(this.host.state());
  }

  readonly hangar: HangarHandlers = {
    open: () => {
      if (!this.docked()) return;
      this.templatesOpen = false;
      this.hangarOpen = true;
      this.host.render();
    },
    close: () => {
      this.hangarOpen = false;
      this.host.render();
    },
    switch: (shipId) => void this.host.send({ type: 'hangarSwitch', shipId }),
    newShip: (cockpit, acquire) => void this.host.send(acquire ? { type: 'hangarNewShip', cockpit, acquire } : { type: 'hangarNewShip', cockpit }),
    buySlot: () => void this.host.send({ type: 'hangarBuySlot' }),
    rename: (shipId, name) => void this.host.send({ type: 'hangarRename', shipId, name }),
    dismantle: (shipId) => void this.host.send({ type: 'hangarDismantle', shipId }),
  };

  readonly templates: TemplateHandlers = {
    open: () => {
      if (!this.docked()) return;
      this.hangarOpen = false;
      this.templatesOpen = true;
      this.host.render();
    },
    close: () => {
      this.templatesOpen = false;
      this.host.render();
    },
    save: (name, source) => {
      const state = this.host.state();
      const grid = source === 'draft' ? this.host.editor()?.draft.grid : state.player.grid;
      const parts = grid ? savableParts(grid) : null;
      if (!parts) {
        this.host.notify(tx().actionErrors.invalidTemplate, 'error', 3);
        this.host.render();
        return;
      }
      this.host.send({ type: 'templateSave', name, parts });
    },
    apply: (index) => {
      const template = this.host.state().templates[index];
      if (!template) return;
      const editor = this.host.openShipyard();
      if (!editor || editor.prompt || editor.pendingCommit !== null) return;
      const plan = editor.applyTemplate(template);
      this.templatesOpen = false;
      if (plan.unplaced > 0) this.host.notify(tx().flight.restore.unplaced(plan.unplaced), 'error', 5);
      this.host.render();
    },
    rename: (index, name) => void this.host.send({ type: 'templateRename', index, name }),
    delete: (index) => void this.host.send({ type: 'templateDelete', index }),
    exportCode: (index) => {
      const template = this.host.state().templates[index];
      return template ? encodeTemplate(template) : '';
    },
    importCode: (code) => {
      const result = decodeTemplate(code.trim());
      if (!result.ok) return result.error;
      this.host.send({ type: 'templateSave', name: result.template.name, parts: result.template.parts });
      return null;
    },
  };

  /**
   * The hub's fleet data: the hangar view model (the overview row and the modal) and whether the modal
   * is open. The overview row needs only the slots and the ships, so the cockpit offers and dismantle
   * quotes are computed only for the open modal.
   */
  /** The hub's hangar data: the same view while `key` (Game.hubViewKey) and the modal state stay the same. */
  hubExtras(state: SimState, station: StationDef, overview: boolean, key: readonly unknown[]): { hangar: HangarView | null; hangarOpen: boolean } {
    if (!station.services.shipyard || (!this.hangarOpen && !overview)) return { hangar: null, hangarOpen: false };
    const open = this.hangarOpen;
    return { hangar: this.hangarMemo.get([...key, open], () => hangarView(state, station, open)), hangarOpen: open };
  }

  /** The Shipyard tab header. */
  header(state: SimState, station: StationDef): ShipHeaderView {
    return shipHeaderView(state, station);
  }

  /** The Templates modal (null when closed). */
  templatesData(state: SimState): TemplatesModalData | null {
    if (!this.templatesOpen) return null;
    const editor = this.host.editor();
    const draft = !!editor && editor.dirty && savableParts(editor.draft.grid) !== null;
    return { view: templatesView(state), draft };
  }

  /** Docking, undocking and destruction close the fleet modals. */
  onEvent(event: SimEvent): void {
    if (event.type === 'docked' || event.type === 'undocked' || event.type === 'playerDestroyed') this.closeModals();
  }

  devHooks(): FleetDevHooks {
    const state = () => this.host.state();
    return {
      hangar: () => hangarView(state()),
      templates: () => templatesView(state()),
      header: () => shipHeaderView(state()),
      storages: () => storageShipRows(state()),
      modals: () => ({ hangar: this.hangarOpen, templates: this.templatesOpen }),
      hangarHandlers: this.hangar,
      templateHandlers: this.templates,
    };
  }
}
