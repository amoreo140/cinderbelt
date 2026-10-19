import { useEffect, useRef, useState } from 'preact/hooks';
import { formatElapsed } from '../../game/save/slotView';
import { tx } from '../../i18n';
import { Button, Lamp, Modal, Panel, Seam } from '../theme';
import type { OverlayData, OverlayHandlers } from './types';

const t = () => tx().app.pause;

/** Pause: a small plate in the centre, a dark backdrop without blur ("Hull language"). */
export function PauseMenu({ data, on }: { data: OverlayData; on: OverlayHandlers }) {
  const ref = useRef<HTMLElement>(null);
  const [confirmScuttle, setConfirmScuttle] = useState(false);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, []);
  const info = data.pause;
  const saving = info?.saving ?? false;
  const settings = info?.settings;
  const nav = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button.af-btn')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    e.preventDefault();
    next?.focus();
  };
  const press = (fn: () => void) => () => {
    on.click();
    fn();
  };
  const lastSave = !saving ? t().unsaved : info?.sinceSave == null ? t().never : t().ago(formatElapsed(info.sinceSave));
  return (
    <div class="ps-backdrop" data-testid="pause-menu">
      <section ref={ref} class="sheet ps-card" role="dialog" aria-modal="true" aria-label={t().title}>
        <header class="sheet-head">
          <h2 class="sheet-title">{t().title}</h2>
        </header>
        <div class="sheet-body" onKeyDown={nav}>
          <Button variant="primary" size="lg" block keyHint="Esc" onClick={press(on.resume)} testId="pause-resume">
            {t().resume}
          </Button>
          <Button block keyHint="F5" onClick={press(on.saveNow)} testId="pause-save" disabled={!saving} reason={t().unsaved}>
            {t().save}
          </Button>
          <div class="ps-career">
            <Button block keyHint="G" onClick={press(() => on.openCareer('objectives'))} testId="pause-objectives">
              {tx().goals.objectives.title}
            </Button>
            <Button block keyHint="I" onClick={press(() => on.openCareer('storages'))} testId="pause-storages">
              {tx().goals.storages.title}
            </Button>
          </div>
          <Button block onClick={press(() => on.open('load'))} testId="pause-load">
            {t().load}
          </Button>
          <Button block onClick={press(() => on.open('settings'))} testId="pause-settings">
            {t().settings}
          </Button>
          <Button block variant="ghost" onClick={press(on.exportCurrent)} testId="pause-export" disabled={!saving} reason={t().unsaved}>
            {t().export}
          </Button>
          <Seam />
          <Button
            block
            variant="danger"
            onClick={press(() => setConfirmScuttle(true))}
            testId="pause-scuttle"
            disabled={!info?.canScuttle}
            reason={t().scuttleOnlyFlying}
          >
            {t().scuttle}
          </Button>
          <Button block onClick={press(on.quit)} testId="pause-quit">
            {saving ? t().quit : t().quitUnsaved}
          </Button>
        </div>
        <Panel material="screen" cut="sm" class="ps-info">
          <div class="ps-info-row" data-testid="pause-last-save">
            <Lamp state={!saving || !data.storage.available ? 'warn' : info?.sinceSave == null ? 'off' : 'ok'} />
            <span class="af-label">{t().lastSave}</span>
            <b>{lastSave}</b>
          </div>
          {settings && (
            <div class="ps-info-row">
              <Lamp state="off" />
              <span class="af-label">{t().game}</span>
              <b>
                {settings.fallenFromHardcore ? tx().saves.fallenFromHardcore : tx().saves.difficulties[settings.deathPenalty]} · {settings.seedText}
              </b>
            </div>
          )}
          {saving && !data.storage.available && (
            <div class="ps-info-row">
              <Lamp state="bad" />
              <span>{tx().app.storage.unavailable}</span>
            </div>
          )}
        </Panel>
        <div style={{ height: '0.6rem' }} />
      </section>
      {confirmScuttle && (
        <Modal
          tone="danger"
          title={t().scuttleTitle}
          confirmLabel={t().scuttleConfirm}
          cancelLabel={tx().app.menu.back}
          cancelKey="Esc"
          onCancel={() => setConfirmScuttle(false)}
          onConfirm={() => {
            on.click();
            setConfirmScuttle(false);
            on.scuttle();
          }}
        >
          {t().scuttleBody(settings ? tx().saves.difficulties[settings.deathPenalty] : '')}
        </Modal>
      )}
    </div>
  );
}
