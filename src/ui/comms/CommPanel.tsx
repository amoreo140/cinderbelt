// The communicator line (the radio module): ONE compact line at the top centre – a small portrait,
// the speaker's name as a kicker in the voice colour, the sentence (shown at once, it stays long enough
// to read: the rule lives in queue.ts), "+N" when more are waiting and a thin bar under it with the
// remaining display time. A hostile voice gets hazard stripes. The toll demand answers inside the line
// (Y / X as before); in the dock a click closes the message. After it ends it lives in the log (L).
import { useState } from 'preact/hooks';
import type { CommsHandlers, CommsLogItem, CommsPanelData, CommsUiData } from '../../game/comms/commsUi';
import type { Speaker } from '../../game/comms/types';
import { FACTIONS, emblemPath, type FactionId } from '../../data/factions';
import { portraitPath } from '../../data/speakers';
import { tx } from '../../i18n';
import { Button, Key, KeyHint, Panel } from '../theme';
import './comms.css';

const t = () => tx().comms;
const BASE = import.meta.env.BASE_URL;

/** Emblem shown when a portrait file is missing (faction emblem, the Rust for clan-less pirates). */
function fallbackEmblem(s: Speaker): string | null {
  if (s.faction === 'pirate') return emblemPath('rust');
  if (s.faction === 'unknown') return null;
  return s.faction in FACTIONS ? emblemPath(s.faction as FactionId) : null;
}

/** A speaker's portrait in a recessed screen; the faction emblem if the file does not load. */
export function Portrait({ speaker, size = 'md' }: { speaker: Speaker; size?: 'md' | 'sm' }) {
  const [failed, setFailed] = useState<string | null>(null);
  const broken = failed === speaker.portrait;
  const emblem = broken ? fallbackEmblem(speaker) : null;
  return (
    <span class={`cm-portrait cm-portrait--${size}${speaker.kind === 'echo' ? ' is-echo' : ''}`} style={{ '--cm-accent': speaker.accent }} aria-hidden="true">
      {!broken ? (
        <img
          src={`${BASE}${portraitPath(speaker.portrait)}`}
          srcset={`${BASE}${portraitPath(speaker.portrait)} 1x, ${BASE}${portraitPath(speaker.portrait, true)} 2x`}
          alt=""
          draggable={false}
          onError={() => setFailed(speaker.portrait)}
        />
      ) : emblem ? (
        <img class="cm-emblem" src={`${BASE}${emblem}`} alt="" draggable={false} />
      ) : (
        <span class="cm-glyph">?</span>
      )}
    </span>
  );
}

/** The lines of the message, each its own paragraph. */
function Lines({ lines, echo }: { lines: string[]; echo: boolean }) {
  return (
    <div class={`cm-lines${echo ? ' is-echo' : ''}`}>
      {lines.map((line, i) => (
        <p key={i} class="cm-sentence">
          {line}
        </p>
      ))}
    </div>
  );
}

function TollReply({ d, on }: { d: NonNullable<CommsPanelData['toll']>; on: CommsHandlers }) {
  const segs = 20;
  const lit = Math.ceil(d.fraction * segs);
  const answer = (a: 'pay' | 'refuse') => (e: MouseEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement | null)?.blur?.();
    on.toll(a);
  };
  return (
    <div class="cm-toll" data-testid="toll" role="group" aria-label={tx().pirates.toll.title} onClick={(e) => e.stopPropagation()}>
      <div class="cm-toll-head">
        <span class="af-label">{tx().pirates.toll.title}</span>
        <strong class="cm-toll-amount">{d.amount}</strong>
      </div>
      <div class="cm-toll-timer" aria-hidden="true">
        {Array.from({ length: segs }, (_, i) => (
          <i key={i} class={i < lit ? 'is-on' : ''} />
        ))}
        <b>{d.seconds} s</b>
      </div>
      <div class="cm-toll-actions">
        <Button size="sm" variant="primary" keyHint="Y" disabled={!d.canPay} reason={tx().pirates.toll.noMoney} onClick={answer('pay')} testId="toll-pay">
          {tx().pirates.toll.pay}
        </Button>
        <Button size="sm" variant="secondary" keyHint="X" onClick={answer('refuse')} testId="toll-refuse">
          {tx().pirates.toll.refuse}
        </Button>
        <span class="cm-toll-escape">{tx().pirates.toll.escape(d.escape)}</span>
      </div>
    </div>
  );
}

export function CommPanel({ d, on }: { d: CommsPanelData; on: CommsHandlers }) {
  // hostile voices get hazard stripes; a distress call is urgent but not hostile
  const hostile = d.channel === 'danger' && (d.speaker.kind === 'pirate' || d.speaker.kind === 'captain');
  const echo = d.speaker.kind === 'echo';
  const onClick = () => {
    if (!d.toll) on.dismiss();
  };
  return (
    <Panel
      material="band"
      translucent
      cut="md"
      trim="left"
      as="section"
      class={`cm-line${d.docked ? ' is-docked' : ''}${hostile ? ' is-danger' : ''}${d.toll ? ' has-reply' : ''}`}
      style={{ '--trim': d.speaker.accent, '--cm-accent': d.speaker.accent }}
      testId="comm-panel"
      aria-label={`${t().panel.radio}: ${d.speaker.name}`}
    >
      <div class="cm-body" onClick={onClick} title={d.toll || !d.docked ? undefined : t().panel.skip} data-channel={d.channel} data-speaker={d.speaker.id}>
        <Portrait speaker={d.speaker} />
        <div class="cm-main">
          <header class="cm-head">
            <span class="af-label cm-role">
              <span data-testid="comm-speaker">{d.speaker.name}</span>
            </span>
            {d.queued > 0 && (
              <span class="cm-queued" data-testid="comm-queued">
                {t().panel.queued(d.queued)}
              </span>
            )}
          </header>
          <div role="status" aria-live="polite" data-testid="comm-text">
            <Lines lines={d.lines} echo={echo} />
            {d.note && <p class="cm-note">{d.note}</p>}
          </div>
          {d.journal && (
            <div class="cm-journal">
              <KeyHint keys="J" dark>
                {t().panel.journal}
              </KeyHint>
            </div>
          )}
        </div>
      </div>
      {d.toll && <TollReply d={d.toll} on={on} />}
      {d.seconds !== null && <i key={d.id} class="cm-timebar" data-testid="comm-timebar" style={{ animationDuration: `${d.seconds}s` }} aria-hidden="true" />}
    </Panel>
  );
}

/** The radio: the panel with the message on the air and the log (L) when open. */
export function Comms({ d, on }: { d: CommsUiData; on: CommsHandlers }) {
  return (
    <>
      {d.panel && !d.log && <CommPanel key={d.panel.id} d={d.panel} on={on} />}
      {d.log && <CommLog items={d.log} docked={d.docked} on={on} />}
    </>
  );
}

/** The comm log (L): the recent transcript, newest first. */
export function CommLog({ items, docked, on }: { items: CommsLogItem[]; docked: boolean; on: CommsHandlers }) {
  return (
    <Panel material="band" cut="md" trim="top" as="aside" class={`cm-log${docked ? ' is-docked' : ''}`} testId="comm-log" aria-label={`${t().log.title} – ${t().log.subtitle}`}>
      <header class="cm-log-head">
        <span class="cm-log-title">{t().log.title}</span>
        <span class="af-label cm-log-sub">{t().log.subtitle}</span>
        <button type="button" class="cm-log-close af-focusable" onClick={on.closeLog} aria-label={t().log.close}>
          <Key dark>L</Key>
        </button>
      </header>
      <Panel material="screen" cut="sm" class="cm-log-screen">
        {items.length === 0 ? (
          <p class="cm-log-empty">{t().log.empty}</p>
        ) : (
          <ol class="cm-log-list">
            {items.map((e) => (
              <li key={e.id} class={`cm-log-item${e.channel === 'danger' ? ' is-danger' : ''}`} style={{ '--cm-accent': e.speaker.accent }} data-testid="comm-log-item">
                <Portrait speaker={e.speaker} size="sm" />
                <div class="cm-log-text">
                  <div class="cm-log-meta">
                    <strong>{e.speaker.name}</strong>
                    <span class="af-label">{e.speaker.role}</span>
                    <time>{e.time}</time>
                  </div>
                  {e.lines.map((l, i) => (
                    <p key={i} class={e.speaker.kind === 'echo' ? 'is-echo' : ''}>
                      {l}
                    </p>
                  ))}
                  {e.note && <p class="cm-log-note">{e.note}</p>}
                  {e.journal && <p class="cm-log-note cm-log-journal">{t().panel.journal} · J</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </Panel>
  );
}
