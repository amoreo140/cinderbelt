// The on-board workshop in flight (M4c T10): two small lamps – RAF (refinery) and OPR (repair module) –
// and the refined ore count, in a small band beside the flight console's cargo gauge. Each item explains
// itself in a tooltip (what the part does, or why it stands). Mounted from GameUi (not inside the HUD);
// the view model comes ready from game/workshopView.ts.
import type { ComponentChildren } from 'preact';
import type { WorkshopLampsData } from '../../game/workshopView';
import { tx } from '../../i18n';
import { formatInt } from '../format';
import { Lamp, Panel, useTip } from '../theme';
import './workshop.css';

type LampTone = 'ok' | 'info' | 'warn' | 'off';

/** Lamp colour: refining fuel cyan, other work green, standing for energy or material amber, nothing to do off. */
function tone(state: string, reason: string | undefined): LampTone {
  if (state === 'fuel') return 'info';
  if (state !== 'idle') return 'ok';
  return reason === 'energy' || reason === 'material' ? 'warn' : 'off';
}

/** One focusable item with an in-game tooltip (above – the band sits at the bottom edge). */
function Item({ tip, testId, cls, children }: { tip: string | null; testId: string; cls: string; children: ComponentChildren }) {
  const handlers = useTip(tip ?? undefined, 'info');
  return (
    <span class={`ws-item ${cls} af-focusable`} tabIndex={0} aria-label={tip ?? undefined} data-testid={testId} {...handlers}>
      {children}
    </span>
  );
}

export function WorkshopLamps({ d }: { d: WorkshopLampsData }) {
  const w = tx().home.workshop;
  return (
    <Panel material="band" translucent cut="sm" class="ws-lamps" as="section" aria-label={w.refineryName}>
      {d.refinery !== null && (
        <Item tip={d.refineryTip} testId="ws-lamp-refinery" cls={`ws-lamp is-${d.refinery}`}>
          <Lamp state={tone(d.refinery, d.refineryReason)} />
          <span class="ws-code">{w.lampRefinery}</span>
        </Item>
      )}
      {d.repair !== null && (
        <Item tip={d.repairTip} testId="ws-lamp-repair" cls={`ws-lamp is-${d.repair}`}>
          <Lamp state={tone(d.repair, d.repairReason)} />
          <span class="ws-code">{w.lampRepair}</span>
        </Item>
      )}
      {d.refined > 0 && (
        <Item tip={d.refinedTip} testId="ws-refined" cls="ws-refined">
          <span class="ws-code">{w.refined}</span>
          <b>{formatInt(d.refined)}</b>
        </Item>
      )}
    </Panel>
  );
}
