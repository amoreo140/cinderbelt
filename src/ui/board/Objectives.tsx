// Objectives (9.1): the band in the flight HUD (ObjectiveBand, 2 rows) and the full panel (G key).
import { tx } from '../../i18n';
import { formatInt } from '../format';
import { sameObjectiveRow } from '../hudMemo';
import { pure } from '../pure';
import { Button, Heading, Key, KeyHint, Lamp, Panel } from '../theme';
import './objectives.css';

export type ObjectiveScaleId = 'now' | 'today' | 'week';

export interface ObjectiveItem {
  id: string;
  scale: ObjectiveScaleId;
  trackName: string;
  title: string;
  why: string;
  /** Distance to the target (u) and the arrow direction on screen (radians, 0 = right, counter-clockwise). */
  distance: number | null;
  angle: number | null;
  progress: { value: number; max: number } | null;
  note?: string;
  /** Contract (can be abandoned from the panel). */
  contract?: number;
  /** The Guild Training step (M3.7). */
  training?: boolean;
}

/** Bearing arrow to the target (rotated as on the map: up = north). */
export function Bearing({ angle }: { angle: number | null }) {
  if (angle === null) return null;
  return <span class="ob-bearing" style={{ transform: `rotate(${-angle}rad)` }} aria-hidden="true" />;
}

const progressText = (p: { value: number; max: number }): string => `${Math.floor(p.value + 1e-9)}/${p.max}`;

/** One row of the band; memoised – it redraws only when it shows something else (hudMemo.ts). */
const BandRow = pure(function ObjectiveBandRow({ o, main }: { o: ObjectiveItem; main: boolean }) {
  return (
    <div class={`ob-line${main ? ' is-main' : ''}`}>
      <Lamp state={o.training ? 'warn' : o.scale === 'now' ? 'info' : 'off'} />
      <span class="af-label ob-track">{o.trackName}</span>
      <span class="ob-title">{o.title}</span>
      {o.progress && <span class="ob-progress">{progressText(o.progress)}</span>}
      {o.distance !== null && (
        <span class="ob-where">
          <Bearing angle={o.angle} />
          {tx().goals.objectives.distance(formatInt(o.distance))}
        </span>
      )}
      {main && <Key dark>G</Key>}
    </div>
  );
}, (a: { o: ObjectiveItem; main: boolean }, b: { o: ObjectiveItem; main: boolean }) => a.main === b.main && sameObjectiveRow(a.o, b.o));

/** Objectives band under the navigation band (2 rows: the main objective now + contract / ship). */
export function ObjectiveBand({ items }: { items: ObjectiveItem[] }) {
  if (items.length === 0) return null;
  return (
    <Panel material="band" translucent cut="md" class="ob-band" as="section" aria-label={tx().goals.objectives.title} testId="objective-band">
      {items.slice(0, 2).map((o, i) => (
        <BandRow key={o.id} o={o} main={i === 0} />
      ))}
    </Panel>
  );
}

export interface ObjectivesPanelHandlers {
  close(): void;
  skipTraining(): void;
  abandon(contract: number): void;
  click(): void;
}

/** The full Objectives panel (G): three scales, each objective with "Why" and "Where". */
export function ObjectivesPanel({ items, on }: { items: ObjectiveItem[]; on: ObjectivesPanelHandlers }) {
  const scales: ObjectiveScaleId[] = ['now', 'today', 'week'];
  const press = (fn: () => void) => () => {
    on.click();
    fn();
  };
  return (
    <div class="ob-panel-wrap" role="dialog" aria-label={tx().goals.objectives.title} data-testid="objectives-panel">
      <Panel material="plate" cut="lg" trim="top" bolts class="ob-panel">
        <div class="ob-panel-head">
          <h2 class="ob-panel-title">{tx().goals.objectives.title}</h2>
          <KeyHint keys="G">{tx().goals.objectives.close.replace(/^G – /, '')}</KeyHint>
        </div>
        <div class="ob-columns">
          {scales.map((scale) => {
            const list = items.filter((o) => o.scale === scale);
            return (
              <section key={scale} class="ob-column">
                <Heading>{tx().goals.objectives.scales[scale]}</Heading>
                {list.length === 0 && <p class="ob-empty">{tx().goals.objectives.none}</p>}
                {list.map((o) => (
                  <article key={o.id} class={`ob-item${o.training ? ' is-training' : ''}`} data-testid={`objective-${o.id}`}>
                    <span class="af-label ob-item-track">{o.trackName}</span>
                    <strong class="ob-item-title">{o.title}</strong>
                    {o.progress && (
                      <span class="af-slip-bar ob-item-bar" role="meter" aria-valuemin={0} aria-valuemax={o.progress.max} aria-valuenow={o.progress.value}>
                        <i style={{ width: `${Math.min(1, o.progress.value / Math.max(1, o.progress.max)) * 100}%` }} />
                      </span>
                    )}
                    <p class="ob-item-why">
                      <span class="af-label">{tx().goals.objectives.why}</span> {o.why}
                    </p>
                    {o.note && <p class="ob-item-note">{o.note}</p>}
                    {o.distance !== null && (
                      <Panel material="screen" cut="sm" class="ob-item-where">
                        <span class="af-label">{tx().goals.objectives.where}</span>
                        <Bearing angle={o.angle} />
                        <b>{tx().goals.objectives.distance(formatInt(o.distance))}</b>
                      </Panel>
                    )}
                    {o.training && (
                      <div class="ob-item-actions">
                        <Button size="sm" variant="ghost" onClick={on.skipTraining} testId="objectives-training-skip">
                          {tx().goals.objectives.skipTraining}
                        </Button>
                      </div>
                    )}
                    {o.contract !== undefined && (
                      <div class="ob-item-actions">
                        <Button size="sm" variant="ghost" onClick={press(() => on.abandon(o.contract!))} testId={`objective-abandon-${o.contract}`}>
                          {tx().goals.slip.abandon}
                        </Button>
                      </div>
                    )}
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
