// Part explanations (crafting, market, shipyard): the plain-language description and the
// "On your ship" display – before → after on the player's ship with the one-line advice.
// Texts and numbers come ready from game/partInfo.ts; this only draws them.
import type { PartInfoView } from '../../game/partInfo';
import { tx } from '../../i18n';
import { Lamp, Panel, Term } from '../theme';
// after the theme – screen rules win over the component base
import './partInfo.css';

const t = () => tx().partInfo.effect;

/** What the part does, when you need it and its catch (compact = only what it does). */
export function PartAbout({ info, compact = false }: { info: Pick<PartInfoView, 'description' | 'variant' | 'variantVs'>; compact?: boolean }) {
  const d = info.description;
  return (
    <div class={`pi-about${compact ? ' is-compact' : ''}`} data-testid="part-about">
      <p class="pi-what">{d.what}</p>
      {info.variant && <p class="pi-variant">{info.variant}</p>}
      {info.variantVs && (
        // a variant against the standard part: "Mass −50 % · HP −40 %", green better / red worse
        <p class="pi-vs" data-testid="part-variant-vs">
          <span class="pi-vs-lead">{t().variantVs}</span>
          {info.variantVs.map((r) => (
            <span key={r.id} class={`pi-vs-item is-${r.trend}`} data-stat={r.id}>
              <Term tip={r.tip}>{r.label}</Term> <b>{r.delta}</b>
              <span class="af-sr-only"> ({r.trend === 'better' ? t().better : t().worse})</span>
            </span>
          ))}
        </p>
      )}
      {!compact && (
        <p class="pi-more">
          {d.when} {d.tradeoff}
        </p>
      )}
    </div>
  );
}

const LAMP = { ok: 'ok', warn: 'warn', info: 'info' } as const;
/** Rows of the compact display (the part's headline effects). */
const COMPACT_ROWS = 2;

/**
 * "On your ship": main rows (what the part is for) bright, side rows (the price in mass and hull
 * points) quieter; Δ green when better, red when worse – always with a sign and a unit.
 * compact = the shipyard palette: the first two main rows (the hull budget is in the properties panel).
 */
export function ShipEffect({ info, compact = false }: { info: PartInfoView; compact?: boolean }) {
  // the palette is narrow and the hull budget sits right beside it in the properties panel
  // (the hull row stays when it matters: a new cockpit's budget, a part that does not fit)
  const rows = compact ? info.rows.filter((r) => r.role === 'main' && (r.id !== 'hull' || r.trend !== 'same')).slice(0, COMPACT_ROWS) : info.rows;
  return (
    <Panel material="screen" cut="sm" class={`pi-effect${compact ? ' is-compact' : ''}`} testId="part-effect">
      <div class="pi-effect-head">
        <span class="af-label">{info.title}</span>
        <Term tip={t().estimateHint} class="pi-estimate">
          {t().estimate}
        </Term>
      </div>
      <table class="pi-rows">
        <tbody>
          {rows.map((r, i) => {
            return (
            <tr
              key={r.id}
              class={`pi-row is-${r.role} is-${r.trend}${r.role === 'side' && rows[i - 1]?.role === 'main' ? ' is-first-side' : ''}`}
              data-metric={r.id}
            >
              <th scope="row">
                <Term tip={r.tip}>{r.label}</Term>
              </th>
              <td class="pi-before">{r.before}</td>
              <td class="pi-arrow" aria-hidden="true">
                →
              </td>
              <td class="pi-after">{r.after}</td>
              <td class="pi-delta">
                {r.delta}
                {r.trend !== 'same' && <span class="af-sr-only"> ({r.trend === 'better' ? t().better : t().worse})</span>}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      {info.advice && (
        <p class={`pi-advice is-${info.advice.tone}`} data-testid="part-advice">
          <Lamp state={LAMP[info.advice.tone]} />
          <span>{info.advice.text}</span>
        </p>
      )}
      {info.notes.length > 0 && <p class="pi-notes">{info.notes.join(' ')}</p>}
    </Panel>
  );
}
