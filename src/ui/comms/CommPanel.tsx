// The communicator panel (the radio module): who is talking – the portrait in a recessed
// screen, the name and role tag, a channel stripe in the speaker's colour (hazard stripes for danger) –
// and what they say, typed out quickly (a click finishes it, the next click closes the message). The
// toll demand answers inside the panel (Y / X as before). "+N" = more messages waiting.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CommsHandlers, CommsLogItem, CommsPanelData, CommsUiData } from '../../game/comms/commsUi';
import { TYPE_DELAY, TYPE_RATE } from '../../game/comms/queue';
import type { Speaker } from '../../game/comms/types';
import { FACTIONS, emblemPath, type FactionId } from '../../data/factions';
import { portraitPath } from '../../data/speakers';
import { tx } from '../../i18n';
import { Button, Key, KeyHint, Lamp, Panel } from '../theme';
import './comms.css';

const t = () => tx().comms;
const BASE = import.meta.env.BASE_URL;

const reducedMotion = (): boolean =>
  document.documentElement.hasAttribute('data-reduced-motion') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

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

/** Characters typed out of `total` since the message appeared (all at once with reduced motion). */
function useTyping(id: string, total: number): [number, () => void] {
  const [typed, setTyped] = useState(() => (reducedMotion() ? total : 0));
  const start = useRef(0);
  const done = useRef(false);
  /** The message whose text was fully shown: re-rendered in another language it stays typed out. */
  const full = useRef<string | null>(null);
  useEffect(() => {
    start.current = performance.now();
    done.current = reducedMotion() || full.current === id;
    setTyped(done.current ? total : 0);
    if (done.current) return;
    let frame = 0;
    const step = () => {
      const s = (performance.now() - start.current) / 1000 - TYPE_DELAY;
      const n = Math.max(0, Math.min(total, Math.floor(s * TYPE_RATE)));
      setTyped(n);
      if (n >= total) full.current = id;
      if (n < total && !done.current) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [id, total]);
  const finish = () => {
    done.current = true;
    full.current = id;
    setTyped(total);
  };
  return [done.current ? total : typed, finish];
}

/** The lines cut to the typed length (the rest keeps its space, so the panel does not grow while typing). */
function TypedLines({ lines, typed, echo }: { lines: string[]; typed: number; echo: boolean }) {
  let left = typed;
  return (
    <div class={`cm-lines${echo ? ' is-echo' : ''}`}>
      {lines.map((line, i) => {
        const shown = line.slice(0, Math.max(0, left));
        left -= line.length;
        const typing = shown.length < line.length && shown.length > 0;
        return (
          <p key={i} class="cm-line">
            <span>{shown}</span>
            {typing && <span class="cm-caret" aria-hidden="true" />}
            <span class="cm-rest" aria-hidden="true">
              {line.slice(shown.length)}
            </span>
          </p>
        );
      })}
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
  const total = d.lines.reduce((n, l) => n + l.length, 0);
  const [typed, finish] = useTyping(d.id, total);
  const typing = typed < total;
  // hostile voices get hazard stripes; a distress call is urgent but not hostile
  const hostile = d.channel === 'danger' && (d.speaker.kind === 'pirate' || d.speaker.kind === 'captain');
  const urgent = d.channel === 'danger' && !hostile;
  const echo = d.speaker.kind === 'echo';
  const onClick = () => {
    if (typing) finish();
    else if (!d.toll) on.dismiss();
  };
  return (
    <Panel
      material="band"
      translucent
      cut="md"
      trim="left"
      as="section"
      class={`cm-panel${d.docked ? ' is-docked' : ''}${hostile ? ' is-danger' : ''}${d.toll ? ' has-reply' : ''}`}
      style={{ '--trim': d.speaker.accent, '--cm-accent': d.speaker.accent }}
      testId="comm-panel"
      aria-label={`${t().panel.radio}: ${d.speaker.name}`}
    >
      <div class="cm-body" onClick={onClick} title={d.toll || !d.docked ? undefined : t().panel.skip} data-channel={d.channel} data-speaker={d.speaker.id}>
        <Portrait speaker={d.speaker} />
        <div class="cm-main">
          <header class="cm-head">
            <span class="af-label cm-role">{d.speaker.role}</span>
            <span class="cm-radio">
              <Lamp state={typing ? 'info' : hostile ? 'bad' : urgent ? 'warn' : 'ok'} />
              <span class="af-label">{t().panel.radio}</span>
              {d.queued > 0 && (
                <span class="cm-queued" data-testid="comm-queued">
                  {t().panel.queued(d.queued)}
                </span>
              )}
            </span>
          </header>
          <h3 class="cm-name" data-testid="comm-speaker">
            {d.speaker.name}
          </h3>
          <div role="status" aria-live="polite" data-testid="comm-text">
            <TypedLines lines={d.lines} typed={typed} echo={echo} />
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
