import { useEffect, useRef } from 'preact/hooks';
import { parsePartKey, type PartKey } from '../../data/parts';
import { RESOURCE_IDS } from '../../data/resources';
import { tx } from '../../i18n';
import { formatAmount, formatCredits } from '../format';
import { Button, Lamp, Panel, PartChip, ResourceChip, ShipSilhouette } from '../theme';
import type { DeathTemplateView } from '../../game/fleet/types';
import type { DeathInfo, OverlayHandlers } from './types';

const t = () => tx().app.death;

/** Black-box playback of the part losses (ms) and the delay after the card opens. */
const REPLAY_MS = 3000;
const REPLAY_DELAY_MS = 350;

interface LossLine {
  text: string;
  /** Labels of the resources or parts the row loses. */
  chips?: 'cargo' | 'salvage';
}

/** What the penalty takes – rows from DeathView (combatView.ts). */
function lossLines(death: DeathInfo): LossLine[] {
  const { loses, fallsToHard, scuttle } = death.view;
  const lines: LossLine[] = [];
  if (fallsToHard) lines.push({ text: t().fallen });
  if (scuttle) {
    lines.push({ text: scuttle.free ? t().scuttleFeeFree : t().scuttleFee(formatCredits(scuttle.fee)) }, { text: t().scuttleAsIs });
    if (scuttle.cargoInWreck >= 0.05) lines.push({ text: t().scuttleCargo(formatAmount(scuttle.cargoInWreck)) });
  }
  if (loses.installedParts) lines.push({ text: t().lostParts });
  if (loses.cargo && loses.cargoAmount > 0) lines.push({ text: t().lostCargo(formatAmount(loses.cargoAmount)), chips: 'cargo' });
  if (loses.salvageParts > 0) lines.push({ text: t().lostSalvage(loses.salvageParts), chips: 'salvage' });
  if (loses.partHpFraction < 1) lines.push({ text: t().damaged(Math.round(loses.partHpFraction * 100)) });
  if (loses.fuelFraction < 1) lines.push({ text: t().fuel(Math.round(loses.fuelFraction * 100)) });
  if (lines.length === 0) lines.push({ text: t().nothingLost });
  else lines.push({ text: t().kept });
  return lines;
}

function LossChips({ death, kind }: { death: DeathInfo; kind: 'cargo' | 'salvage' }) {
  if (kind === 'cargo') {
    const cargo = death.lostCargo ?? {};
    const ids = RESOURCE_IDS.filter((r) => (cargo[r] ?? 0) >= 0.05);
    if (ids.length === 0) return null;
    return (
      <span class="dc-chips">
        {ids.map((r) => (
          <ResourceChip key={r} id={r} amount={cargo[r]} tag />
        ))}
      </span>
    );
  }
  const parts = (Object.entries(death.lostSalvage ?? {}) as [PartKey, number][]).filter(([, n]) => n > 0);
  if (parts.length === 0) return null;
  return (
    <span class="dc-chips">
      {parts.map(([key, n]) => {
        const { partId, tier } = parsePartKey(key);
        return <PartChip key={key} partId={partId} tier={tier} count={n} />;
      })}
    </span>
  );
}

/** Black box: the ship silhouette in which the lost parts collapse in the order they fell. */
function BlackBox({ box }: { box: NonNullable<DeathInfo['blackBox']> }) {
  const lost = box.order.length;
  return (
    <figure class="dc-box" data-testid="death-blackbox">
      <Panel material="screen" cut="sm" class="dc-box-screen">
        <span class="af-label dc-box-label">{t().blackBox}</span>
        <span class="dc-box-bow" aria-hidden="true" />
        <ShipSilhouette
          silhouette={box.silhouette}
          width={184}
          height={150}
          maxCell={24}
          gap={2}
          replay={{ order: box.order, duration: REPLAY_MS, delay: REPLAY_DELAY_MS }}
          label={t().partsLost(lost, box.total)}
        />
      </Panel>
      <figcaption class="dc-box-caption">
        <Lamp state={lost > 0 ? 'bad' : 'off'} />
        {t().partsLost(lost, box.total)}
      </figcaption>
    </figure>
  );
}

/**
 * Card after the ship is destroyed: black box, penalty by difficulty, respawn station, optional evacuation.
 * `template` (M4a): "Restore from template" – null / absent hides it; `onTemplate` continues and opens the
 * shipyard with the Templates modal.
 */
export function DeathCard({ death, on, template, onTemplate }: { death: DeathInfo; on: OverlayHandlers; template?: DeathTemplateView; onTemplate?: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.sheet-foot .af-btn--primary')?.focus({ preventScroll: true });
  }, []);
  const { view } = death;
  const box = death.blackBox && death.blackBox.silhouette.cells.length > 0 ? death.blackBox : null;
  return (
    <div class="ps-backdrop" data-testid="death-card">
      <section ref={ref} class={`sheet dc-card${box ? ' dc-card--box' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="dc-title">
        <header class="sheet-head">
          <h2 class="sheet-title" id="dc-title">
            {t().title}
          </h2>
        </header>
        <div class="af-hazard" aria-hidden="true" />
        <div class="sheet-body">
          <div class="dc-grid">
            {box && <BlackBox box={box} />}
            <div class="dc-main">
              <span class="pl-label">{t().lead(tx().saves.difficulties[view.penalty])}</span>
              <ul class="dc-list">
                {lossLines(death).map((line) => (
                  <li key={line.text}>
                    {line.text}
                    {line.chips && <LossChips death={death} kind={line.chips} />}
                  </li>
                ))}
              </ul>
              <p class="dc-text">{t().respawn(death.respawnName)}</p>
              {death.evacuationName && <p class="pl-hint">{t().evacuateHint}</p>}
            </div>
          </div>
          <Panel material="screen" cut="sm" class="ps-info dc-stats">
            <div class="ps-info-row">
              <Lamp state="off" />
              <span class="af-label">{t().kills}</span>
              <b>{view.kills}</b>
            </div>
            <div class="ps-info-row">
              <Lamp state="bad" />
              <span class="af-label">{t().deaths}</span>
              <b>{view.deaths + 1}</b>
            </div>
          </Panel>
        </div>
        <footer class="sheet-foot">
          {template && onTemplate && (
            <Button
              variant="secondary"
              disabled={template.reason !== undefined}
              reason={template.reason}
              hint={tx().fleet.death.restoreHint}
              onClick={onTemplate}
              testId="death-template"
            >
              {tx().fleet.death.restore}
            </Button>
          )}
          <span class="grow" />
          {death.evacuationName ? (
            <>
              <Button variant="ghost" onClick={() => on.respawn(false)} testId="death-stay">
                {t().stay(death.respawnName)}
              </Button>
              <Button variant="primary" size="lg" keyHint="Enter" onClick={() => on.respawn(true)} testId="death-continue">
                {t().evacuate(death.evacuationName)}
              </Button>
            </>
          ) : (
            <Button variant="primary" size="lg" keyHint="Enter" onClick={() => on.respawn(true)} testId="death-continue">
              {t().continue}
            </Button>
          )}
        </footer>
      </section>
    </div>
  );
}
