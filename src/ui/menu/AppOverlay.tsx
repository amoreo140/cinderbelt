import { render } from 'preact';
import { tx } from '../../i18n';
import { Lamp, ToastView, TooltipLayer } from '../theme';
import { AboutScreen } from './AboutScreen';
import { CrashCard } from './CrashCard';
import { DeathCard } from './DeathCard';
import { LoadScreen } from './LoadScreen';
import { MainMenu } from './MainMenu';
import { NewGameScreen } from './NewGameScreen';
import { PauseMenu } from './PauseMenu';
import { SettingsScreen } from './SettingsScreen';
import type { OverlayData, OverlayHandlers, SaveIndicatorState } from './types';
import './menu.css';

function SaveIndicator({ state }: { state: SaveIndicatorState }) {
  if (!state) return null;
  const t = tx().app.saveIndicator;
  const lamp = state.phase === 'saving' ? 'warn' : state.phase === 'saved' ? 'ok' : 'bad';
  return (
    <div
      class={`save-ind is-${state.phase}${state.leaving ? ' is-leaving' : ''}`}
      role="status"
      aria-live="polite"
      data-testid="save-indicator"
      data-phase={state.phase}
    >
      <Lamp state={lamp} />
      <span class="af-label">{t[state.phase]}</span>
    </div>
  );
}

/** App layer above the game: the main menu and its screens, pause, the death card, the indicator. */
export function AppOverlay({ data, on }: { data: OverlayData; on: OverlayHandlers }) {
  const { state } = data;
  let content = null;
  if (state.kind === 'menu') {
    const page = state.page;
    content = (
      <MainMenu data={data} on={on}>
        {page === 'newGame' && <NewGameScreen data={data} on={on} />}
        {page === 'load' && <LoadScreen data={data} on={on} />}
        {page === 'settings' && <SettingsScreen data={data} on={on} />}
        {page === 'about' && <AboutScreen data={data} on={on} />}
      </MainMenu>
    );
  } else if (state.kind === 'game' && state.overlay) {
    const o = state.overlay;
    content =
      o === 'pause' ? (
        <PauseMenu data={data} on={on} />
      ) : o === 'crash' ? (
        data.crash && <CrashCard crash={data.crash} on={on} />
      ) : o === 'death' ? (
        data.death && <DeathCard death={data.death} on={on} template={data.death.template} onTemplate={on.respawnFromTemplate} />
      ) : (
        <div class="ps-backdrop">
          {o === 'load' ? <LoadScreen data={data} on={on} /> : <SettingsScreen data={data} on={on} />}
        </div>
      );
  }
  return (
    <>
      {content}
      <SaveIndicator state={data.indicator} />
      {data.toast && (
        <div class="app-toast">
          <ToastView kind={data.toast.tone} text={data.toast.text} testId="app-toast" />
        </div>
      )}
      {data.busy && (
        <div class="app-busy" role="status" data-testid="app-busy">
          <div class="af-panel af-cut4 af-band app-busy-box" style={{ '--cut': 'var(--af-cut)' }}>
            <Lamp state="info" />
            {data.busy}
          </div>
        </div>
      )}
      {state.kind === 'menu' && <TooltipLayer />}
    </>
  );
}

export function renderAppOverlay(container: HTMLElement, data: OverlayData, handlers: OverlayHandlers): void {
  render(<AppOverlay data={data} on={handlers} />, container);
}
