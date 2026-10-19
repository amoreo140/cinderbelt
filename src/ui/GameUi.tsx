import { h, render, type ComponentType } from 'preact';
import { useMemo } from 'preact/hooks';
import { Hud, type HudData } from './Hud';
import { StationHub, type StationHubData, type StationHubHandlers } from './station/StationHub';
import { ToastView, TooltipLayer } from './theme';
import type { CareerUiData } from '../game/career/careerUi';
import { ObjectivesPanel } from './board/Objectives';
import { ResumeCard } from './board/ResumeCard';
import { StoragesView } from './board/StoragesView';
import { Journal } from './discovery/Journal';
import type { JournalData } from '../game/discovery/journalView';
import type { TrainingHandlers, TrainingUiData } from '../game/training/trainingUi';
import { TrainingLayer } from './training/TrainingLayer';
import type { CommsHandlers, CommsUiData } from '../game/comms/commsUi';
import { Comms } from './comms/CommPanel';
import type { DerelictTerminalData, EventChipData, TerminalHandlers } from '../game/sites/types';
import { EventChip, updateEventDials } from './sites/EventChip';
import { DerelictTerminal } from './sites/DerelictTerminal';
import type { TemplatesModalData } from '../game/fleet/fleetUi';
import type { TemplateHandlers } from '../game/fleet/types';
import { Templates } from './lazyScreens';
import type { WorkshopLampsData } from '../game/workshopView';
import { WorkshopLamps } from './workshop/WorkshopLamps';
import type { ConvoyTradeData, ConvoyTradeHandlers } from '../game/convoys/types';
import type { GuildStatusData } from '../game/guild/types';
import { ConvoyTrade } from './convoys/ConvoyTrade';
import { GuildStatus } from './guild/GuildStatus';
import { pure, sameDeep } from './pure';
import { sameEventChips } from './hudMemo';
import type { CareerHandlers } from '../game/career/careerUi';

export type ToastKind = 'info' | 'ok' | 'error';

export interface Toast {
  text: string;
  kind: ToastKind;
}

export interface GameUiData {
  /** Flight HUD (null when docked). */
  hud: HudData | null;
  /** Station hub (docked only). */
  hub: StationHubData | null;
  toast: Toast | null;
  /** Career (M3.5a): the Objectives / Storages panel, the return card. */
  career?: CareerUiData | null;
  /** Guild Training (M3.7): step panel, highlight, hangar cells, skip confirmation. */
  training?: TrainingUiData | null;
  /** Discovery (M3.5b): the journal (J). */
  explore?: { journal: JournalData | null } | null;
  /** Communicator: the radio message on the air and the log (L). */
  comms?: CommsUiData | null;
  /** Space events (M4b): the HUD event chips (flight only). */
  events?: EventChipData | null;
  /** The derelict terminal (M4b): open exactly while berthed at a derelict. */
  terminal?: DerelictTerminalData | null;
  /** The Templates modal (M4a), over the station hub. */
  templates?: TemplatesModalData | null;
  /** The on-board workshop's lamps and refined count (M4c; flight only, null = nothing to show). */
  workshop?: WorkshopLampsData | null;
  /** The Guild chips in flight (M4d): escort, relay stage; null = nothing to show. */
  guild?: GuildStatusData | null;
  /** The convoy trade window (M4d): open exactly while linked to a convoy trader. */
  convoyTrade?: ConvoyTradeData | null;
}

/** Handlers of the whole game UI: the hub's plus the training layer's and the radio's. */
export type GameUiHandlers = StationHubHandlers & { sites?: TerminalHandlers } & { training?: TrainingHandlers; comms?: CommsHandlers; templatesModal?: TemplateHandlers; convoys?: ConvoyTradeHandlers };

/**
 * A memoised part with state hooks of its own: the wrapper compares the props (pure.ts), the part
 * itself stays an ordinary component (its own state updates re-render only it).
 */
function memoPart<P extends object>(part: ComponentType<P>, same: (a: P, b: P) => boolean = sameDeep) {
  return pure((props: P) => h(part, props), same);
}

// The flight-time panels around the HUD redraw only when their content changed (audit 2026-10-17 P7):
// the game rebuilds their view models 10× per second.
/** The event chips: their countdowns in whole seconds; the dials turn by themselves (EventChip.tsx). */
const EventChipPart = pure(EventChip, sameEventChips);
const WorkshopLampsPart = pure(WorkshopLamps, sameDeep);
const GuildStatusPart = pure(GuildStatus, sameDeep);
const CommsPart = pure(Comms, sameDeep);
const ObjectivesPanelPart = pure(ObjectivesPanel, sameDeep);
const StoragesViewPart = memoPart(StoragesView);
/** The tooltip layer has no props: it redraws from its own state only. */
const TooltipLayerPart = memoPart(TooltipLayer);

/** The career panels' handlers, one object per handler set (not a new one per redraw). */
function useCareerPanelHandlers(ch: CareerHandlers | undefined) {
  return useMemo(
    () =>
      ch
        ? {
            objectives: { close: ch.closePanel, skipTraining: ch.skipTraining, abandon: ch.abandon, click: ch.click },
            storages: { action: ch.action, quote: ch.quote, close: ch.closePanel, click: ch.click },
          }
        : null,
    [ch],
  );
}

export function GameUi({ data, handlers }: { data: GameUiData; handlers: GameUiHandlers }) {
  const career = data.career;
  const ch = handlers.career;
  const panelOn = useCareerPanelHandlers(ch);
  // the chips' direction dials turn without a redraw of their plates
  if (data.hud && data.events) updateEventDials(data.events);
  return (
    <>
      {data.hud && <Hud {...data.hud} />}
      {data.hub && <StationHub {...data.hub} on={handlers} />}
      {data.hub && data.templates && handlers.templatesModal && (
        <Templates view={data.templates.view} on={handlers.templatesModal} draft={data.templates.draft} click={handlers.click} />
      )}
      {data.training && handlers.training && !career?.panel && !career?.resume && <TrainingLayer d={data.training} on={handlers.training} />}
      {career?.panel?.kind === 'objectives' && panelOn && <ObjectivesPanelPart items={career.panel.items} on={panelOn.objectives} />}
      {career?.panel?.kind === 'storages' && panelOn && <StoragesViewPart d={career.panel.data} on={panelOn.storages} />}
      {career?.resume && ch && (
        <ResumeCard d={career.resume.data} name={career.resume.name} from={career.resume.from} onContinue={ch.resumeContinue} />
      )}
      {data.hud && data.events && data.events.length > 0 && <EventChipPart chips={data.events} />}
      {data.hud && data.workshop && <WorkshopLampsPart d={data.workshop} />}
      {data.terminal && handlers.sites && <DerelictTerminal d={data.terminal} on={handlers.sites} />}
      {data.hud && data.guild && <GuildStatusPart d={data.guild} />}
      {data.convoyTrade && handlers.convoys && <ConvoyTrade d={data.convoyTrade} on={handlers.convoys} />}
      {data.comms && handlers.comms && <CommsPart d={data.comms} on={handlers.comms} />}
      {data.explore?.journal && handlers.explore && <Journal d={data.explore.journal} on={handlers.explore} />}
      {data.toast && (
        <div class={`ui-toast${data.hub ? ' ui-toast--docked' : ''}`}>
          <ToastView kind={data.toast.kind} text={data.toast.text} testId="toast" />
        </div>
      )}
      <TooltipLayerPart />
    </>
  );
}

export function renderGameUi(container: HTMLElement, data: GameUiData, handlers: GameUiHandlers): void {
  render(<GameUi data={data} handlers={handlers} />, container);
}

/** Removes the game UI (back to the menu) – Preact unmounts the components and their listeners. */
export function clearGameUi(container: HTMLElement): void {
  render(null, container);
}
