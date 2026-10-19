// Home station UI state and handlers (M4c T2): the Development tab's selection, the paint
// shop's selected ship and previewed paint, the dock camera focus ("Show"), the handlers that turn the
// tab's buttons into GameActions, the toasts of the home events and the dev hooks
// (`window.__cinder.home`). Game owns one and forwards to it; nothing here is saved.
import type { HomeModuleId } from '../../data/home';
import type { PaintId } from '../../data/paints';
import { tx } from '../../i18n';
import type { GameActionInput } from '../../sim/commands';
import { shipDisplayName } from '../../sim/fleet/names';
import type { ShipId } from '../../sim/fleet/types';
import { trophiesOf } from '../../sim/home';
import { dockedAtHome } from '../../sim/home/modules';
import type { SimEvent, SimState } from '../../sim/Simulation';
import type { ToastKind } from '../../ui/GameUi';
import { captainName, fortressLabel } from '../board/names';
import { createDevelopmentMemo, type HomeUiState } from './developmentView';
import { paintShopShip, paintShopShips } from './paintShopView';
import type { DevelopmentData, DevelopmentHandlers, HomeDevHooks } from './types';

export interface HomeUiHost {
  state(): SimState;
  /** Queues an action for the next simulation step; returns its reqId. */
  send(action: GameActionInput): number;
  render(): void;
  /** Points the dock camera at a home module (`GameRenderer.setHomeFocus`), null = the dock view. */
  focus(module: HomeModuleId | null): void;
  /** A toast; the text builder runs again after a language switch. */
  notify(text: () => string, kind: ToastKind, seconds: number): void;
}

/** A toast of a home event. */
export interface HomeToast {
  text: string;
  kind: ToastKind;
  seconds: number;
}

/** Title of a trophy id for a toast (captain name / fortress name). */
function trophyTitle(state: SimState, id: string): string {
  const item = trophiesOf(state).find((t) => t.id === id);
  if (item?.kind === 'captain' && item.captain !== null) return captainName(state.seed, item.captain);
  return fortressLabel(id);
}

/** Name of a ship record by id (active or stored), or null. */
function shipName(state: SimState, id: ShipId): string | null {
  const { active, stored } = state.fleet;
  const record = active.id === id ? active : stored.find((s) => s.record.id === id)?.record;
  return record ? shipDisplayName(record, tx().fleet.names) : null;
}

export class HomeUi {
  private readonly ui: HomeUiState = { selected: 'paintShop', selectedShip: null, preview: null };
  /** The module the dock camera frames, or null. */
  private focused: HomeModuleId | null = null;
  private readonly memo = createDevelopmentMemo();

  constructor(private readonly host: HomeUiHost) {}

  /** The Development tab's view model (null away from home). Stable while nothing changed. */
  data(state: SimState): DevelopmentData | null {
    return dockedAtHome(state) ? this.memo(state, this.ui) : null;
  }

  /** The module the dock camera frames ("Show"), or null. */
  get focus(): HomeModuleId | null {
    return this.focused;
  }

  /**
   * The paint previewed on a ship (UI state for the 3D preview; never in the simulation), or null.
   * Only a paint that differs from the ship's own counts, and only while the paint shop is the selected module.
   */
  paintPreview(state: SimState): { shipId: ShipId; paint: PaintId } | null {
    if (this.ui.preview === null || this.ui.selected !== 'paintShop' || !state.home.modules.has('paintShop')) return null;
    const ship = paintShopShip(paintShopShips(state), this.ui.selectedShip);
    return ship && ship.paint !== this.ui.preview ? { shipId: ship.shipId, paint: this.ui.preview } : null;
  }

  /** The player left the Development tab or the station: the camera returns to the dock, the preview ends. */
  leave(): void {
    this.ui.preview = null;
    this.setFocus(null);
  }

  private setFocus(module: HomeModuleId | null): void {
    if (this.focused === module) return;
    this.focused = module;
    this.host.focus(module);
  }

  readonly handlers: DevelopmentHandlers = {
    select: (module) => {
      this.ui.selected = module;
      // leaving the paint shop ends its preview
      if (module !== 'paintShop') this.ui.preview = null;
      // another module ends the camera framing; done here (an event handler), never from a UI effect:
      // re-rendering the game UI inside Preact's effect flush is a re-entrant render
      if (this.focused !== null && this.focused !== module) this.setFocus(null);
      this.host.render();
    },
    build: (module) => void this.host.send({ type: 'homeBuild', module }),
    selectShip: (id) => {
      if (this.ui.selectedShip === id) return;
      this.ui.selectedShip = id;
      this.ui.preview = null;
      this.host.render();
    },
    preview: (paint) => {
      this.ui.preview = paint;
      this.host.render();
    },
    paint: () => {
      const state = this.host.state();
      const paint = this.ui.preview;
      const ship = paintShopShip(paintShopShips(state), this.ui.selectedShip);
      if (!ship || paint === null || ship.paint === paint) return;
      this.host.send({ type: 'paintShip', shipId: ship.shipId, paint });
    },
    pin: (id, on) => void this.host.send({ type: 'trophyPin', id, pinned: on }),
    focus: (module) => {
      if (module !== null && !dockedAtHome(this.host.state())) return;
      this.setFocus(module);
      this.host.render();
    },
  };

  /** The toast of a home event (also the radio's factual note), or null. */
  toast(state: SimState, e: SimEvent): HomeToast | null {
    switch (e.type) {
      case 'homeModuleBuilt':
        return { text: tx().home.toasts.built(tx().home.modules[e.module].name), kind: 'ok', seconds: 3 };
      case 'shipPainted': {
        const name = shipName(state, e.shipId);
        return name ? { text: tx().home.toasts.painted(name, tx().home.paints[e.paint]), kind: 'ok', seconds: 3 } : null;
      }
      case 'trophyPinned': {
        const title = trophyTitle(state, e.id);
        return { text: e.pinned ? tx().home.toasts.pinned(title) : tx().home.toasts.unpinned(title), kind: 'info', seconds: 3 };
      }
      default:
        return null;
    }
  }

  /** A simulation event: the toast (unless the radio said it) and the UI state it ends. */
  onEvent(e: SimEvent, spoken: boolean): void {
    if (e.type === 'shipPainted') this.ui.preview = null;
    if (e.type !== 'homeModuleBuilt' && e.type !== 'shipPainted' && e.type !== 'trophyPinned') return;
    if (spoken) return;
    const state = this.host.state();
    const first = this.toast(state, e);
    if (first) this.host.notify(() => this.toast(state, e)?.text ?? first.text, first.kind, first.seconds);
  }

  /** `window.__cinder.home` (dev builds). */
  devHooks(): HomeDevHooks {
    return {
      build: (module) => void this.host.send({ type: 'homeBuild', module }),
      credits: (n) => {
        this.host.state().credits = n;
        this.host.render();
      },
      data: () => this.data(this.host.state()),
      focus: () => this.focused,
      handlers: this.handlers,
    };
  }
}
