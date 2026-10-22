import { useEffect, useRef, useState } from 'preact/hooks';
import type { CrashView } from '../../game/app/crash';
import { formatElapsed } from '../../game/save/slotView';
import { tx } from '../../i18n';
import { Button, Lamp, Panel } from '../theme';
import type { OverlayHandlers } from './types';

const t = () => tx().app.crash;

export const ISSUES_URL = 'https://github.com/amoreo140/cinderbelt/issues';

/** Card after the frame loop threw: what happened to the progress, Back to menu, error details for a bug report. */
export function CrashCard({ crash, on }: { crash: CrashView; on: OverlayHandlers }) {
  const ref = useRef<HTMLElement>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.sheet-foot .af-btn--primary')?.focus({ preventScroll: true });
  }, []);
  const saveText =
    crash.save === 'saving'
      ? t().saving
      : crash.save === 'saved'
        ? t().saved
        : crash.save === 'kept'
          ? t().kept(crash.sinceSave === null ? null : crash.sinceSave < 60_000 ? tx().time.underMinute : formatElapsed(crash.sinceSave))
          : t().unsaved;
  const lamp = crash.save === 'saved' ? 'ok' : crash.save === 'saving' ? 'info' : 'warn';
  const copyReport = () => {
    on.click();
    void on.copyCrashReport().then((ok) => setCopy(ok ? 'copied' : 'failed'));
  };
  return (
    <div class="ps-backdrop cr-backdrop" data-testid="crash-card">
      <section ref={ref} class="sheet cr-card" role="alertdialog" aria-modal="true" aria-labelledby="cr-title">
        <header class="sheet-head">
          <h2 class="sheet-title" id="cr-title">
            {t().title}
          </h2>
        </header>
        <div class="af-hazard" aria-hidden="true" />
        <div class="sheet-body">
          <p class="dc-text">{t().lead}</p>
          <Panel material="screen" cut="sm" class="ps-info">
            <div class="ps-info-row" data-testid="crash-save" data-state={crash.save}>
              <Lamp state={lamp} />
              <span>{saveText}</span>
            </div>
          </Panel>
          <p class="pl-hint cr-hint">
            {t().hint}{' '}
            <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
              github.com/amoreo140/cinderbelt/issues
            </a>
          </p>
        </div>
        <footer class="sheet-foot">
          <Button variant="ghost" onClick={copyReport} testId="crash-copy">
            {copy === 'copied' ? t().copied : copy === 'failed' ? t().copyFailed : t().copy}
          </Button>
          <span class="grow" />
          <Button variant="primary" size="lg" keyHint="Enter" onClick={() => on.leaveCrash()} testId="crash-menu">
            {t().back}
          </Button>
        </footer>
      </section>
    </div>
  );
}
