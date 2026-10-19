// The "Where I left off" card (9.2) – on loading a game: the last activity, active
// contracts, the next objective and the latest log entries. One "Continue" button (Enter, Esc).
import { useEffect, useRef } from 'preact/hooks';
import type { ResumeData } from '../../game/board/resumeView';
import { tx } from '../../i18n';
import { Button, Heading, Lamp, Panel, RingBadge } from '../theme';
import { Slip } from './Slip';
import './overlays.css';

const t = () => tx().goals.resume;

export function ResumeCard({ d, name, from, onContinue }: { d: ResumeData; name: string; from: { x: number; y: number }; onContinue: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[data-testid="resume-continue"]')?.focus({ preventScroll: true });
  }, []);
  return (
    <div class="co-backdrop" data-testid="resume-card">
      <div ref={ref} class="co-sheet co-resume" role="dialog" aria-modal="true" aria-label={t().title} data-ring={d.ring}>
        <header class="co-head">
          <div>
            <span class="af-label co-kicker">{name}</span>
            <h2 class="co-title">{t().title}</h2>
          </div>
          <span class="co-played">{t().played(d.played)}</span>
        </header>
        <div class="co-body af-on-plate">
          <Panel material="screen" cut="md" class="co-activity">
            <span class="af-label co-screen-label">
              <RingBadge ring={d.ring} compact /> {t().lastActivity}
            </span>
            {d.activity.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </Panel>
          <div class="co-columns">
            <section>
              <Heading>{t().contracts}</Heading>
              {d.contracts.length === 0 ? (
                <p class="co-dim">{t().noContracts}</p>
              ) : (
                <div class="co-slips">
                  {d.contracts.map((s) => (
                    <Slip key={s.key} d={s} from={from} compact />
                  ))}
                </div>
              )}
            </section>
            <section>
              <Heading>{t().next}</Heading>
              {d.next ? (
                <div class="co-next">
                  <strong>{d.next.title}</strong>
                  <p class="co-dim">{d.next.why}</p>
                </div>
              ) : (
                <p class="co-dim">{tx().goals.objectives.none}</p>
              )}
              <Heading>{t().journal}</Heading>
              {d.journal.length === 0 ? (
                <p class="co-dim">{t().noJournal}</p>
              ) : (
                <ul class="co-journal">
                  {d.journal.map((j) => (
                    <li key={j.text + j.ago}>
                      <Lamp state="off" />
                      <span>{j.text}</span>
                      <span class="co-ago">{j.ago}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
        <footer class="co-foot">
          <span class="grow" />
          <Button variant="primary" size="lg" keyHint="Enter" onClick={onContinue} testId="resume-continue">
            {t().continue}
          </Button>
        </footer>
      </div>
    </div>
  );
}
