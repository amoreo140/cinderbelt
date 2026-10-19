// The sector card on the map (sectors design §5.1, stage 1b): a dark band with the security colour and
// pattern on its left edge (the same swatch as the entry notice), the sector's name, security and
// threat, depth, environment, knowledge with the flown share, known stations and landmarks, and the
// risk of the straight route home as chips. The data comes from sectorCardData.ts; MapView places it.
import { tx } from '../../i18n';
import { Panel } from '../theme';
import type { SectorCardData } from './sectorCardData';
import './sectors.css';

/** One dot per survey point, filled when marked (●●○○, the HUD badge too). */
export function SurveyDots({ done, total }: { done: number; total: number }) {
  return (
    <span class="sc-dots" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} class={i < done ? 'is-on' : ''} />
      ))}
    </span>
  );
}

export function SectorCard({
  d,
  pinned,
  right = false,
  static: still = false,
  onRoute,
}: {
  d: SectorCardData;
  pinned: boolean;
  right?: boolean;
  static?: boolean;
  /** M4d: "Trasa sem" on a pinned card plans the map route to the sector. */
  onRoute?: () => void;
}) {
  const c = tx().sectors.card;
  const route = d.route;
  return (
    <div
      class={`sc-card${still ? ' is-static' : ''}${right ? ' is-right' : ''}`}
      data-security={d.security ?? 'unknown'}
      data-knowledge={d.knowledge}
      data-testid={still ? undefined : 'sector-card'}
      role="group"
      aria-label={`${tx().sectors.hud.badge}: ${d.name}`}
    >
      <Panel material="band" cut="md" class="sc-card-panel">
        <span class="sc-card-swatch" aria-hidden="true" />
        <div class="sc-card-head">
          <span class="sc-card-name">{d.name}</span>
          {d.here && <span class="sc-card-here">{c.here}</span>}
        </div>
        {d.security && (
          <div class="sc-card-sec">
            <span class="sc-sec">{d.securityWord}</span>
            <span class="sc-card-threat">· {d.threat}</span>
          </div>
        )}
        <ul class="sc-card-facts">
          <li>{d.depth}</li>
          {d.environment && <li>{d.environment}</li>}
          <li class="sc-card-mapping">{d.mapping}</li>
          {d.survey && (
            <li class="sc-card-survey" data-testid={still ? undefined : 'sector-card-survey'}>
              {d.survey.line} <SurveyDots done={d.survey.done} total={d.survey.total} />
            </li>
          )}
          {d.chart && (
            <li class="sc-card-chart" data-testid={still ? undefined : 'sector-card-chart'}>
              {d.chart}
            </li>
          )}
          {d.stations.length > 0 && (
            <li>
              <span class="sc-card-key">{c.stations}:</span> {d.stations.join(', ')}
            </li>
          )}
          {d.landmarks.length > 0 && (
            <li>
              <span class="sc-card-key">{c.landmarks}:</span> {d.landmarks.join(', ')}
            </li>
          )}
        </ul>
        <div class="sc-card-route" data-testid={still ? undefined : 'sector-card-route'}>
          {'home' in route ? (
            <span class="sc-card-route-line">{route.home}</span>
          ) : (
            <>
              <span class="sc-card-route-line">{route.line}</span>
              <span class="sc-card-risks">
                {route.risks.map((r) => (
                  <span key={r.risk} class="sc-card-risk" data-security={r.risk}>
                    {r.text}
                  </span>
                ))}
                {route.clear && <span class="sc-card-clear">{route.clear}</span>}
              </span>
            </>
          )}
        </div>
        {onRoute && (
          <button type="button" class="sc-card-route-btn af-focusable" data-testid={still ? undefined : 'sector-card-route-here'} onClick={onRoute}>
            {tx().guild.route.here}
          </button>
        )}
        {!still && <div class="sc-card-hint">{pinned ? c.unpin : c.pin}</div>}
      </Panel>
    </div>
  );
}
