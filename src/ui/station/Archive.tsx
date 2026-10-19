// Archive tab in the hub (long-term design 3.2.4, 10.6): a tree of 40 nodes – 5 branches × 4 tiers,
// Data in the fund and collected, node detail with unlocking, blueprints from fragments and key items.
import { Fragment } from 'preact';
import type { ArchiveData, ArchiveNodeView } from '../../game/discovery/archiveView';
import type { ExploreHandlers } from '../../game/discovery/exploreUi';
import { tx } from '../../i18n';
import { formatCredits, formatInt } from '../format';
import { Button, Heading, Lamp, Panel, Readout } from '../theme';
import './archive.css';

const a = () => tx().discovery.archive;

const cost = (n: ArchiveNodeView): string =>
  n.threshold !== null ? a().threshold(formatInt(n.threshold)) : a().cost(formatInt(n.data));

const LAMP = { owned: 'ok', ready: 'info', locked: 'off', future: 'off', hidden: 'off' } as const;

function NodeCard({ n, selected, on }: { n: ArchiveNodeView; selected: boolean; on: ExploreHandlers }) {
  return (
    <button
      type="button"
      class={`ar-node ar-node--${n.state}${n.key ? ' is-key' : ''}${selected ? ' is-selected' : ''} af-focusable`}
      aria-pressed={selected}
      data-testid={`archive-node-${n.id}`}
      onClick={() => {
        on.click();
        on.selectNode(n.id);
      }}
    >
      <span class="ar-node-name">{n.name}</span>
      <span class="ar-node-cost">
        <Lamp state={LAMP[n.state]} />
        {n.state === 'future' ? <span class="af-label">{n.since ?? n.effect}</span> : n.state === 'owned' ? a().owned : cost(n)}
      </span>
    </button>
  );
}

export function Archive({ d, on }: { d: ArchiveData; on: ExploreHandlers }) {
  const sel = d.selected;
  return (
    <div class="ar" data-testid="archive">
      <div class="ar-top">
        <Panel material="screen" cut="sm" class="ar-data">
          <Readout label={a().fund} value={Math.floor(d.dataFund)} unit={tx().discovery.dataUnit} />
          <Readout label={a().total} value={Math.floor(d.dataTotal)} unit={tx().discovery.dataUnit} />
        </Panel>
        <p class="ar-hint">{a().fundHint}</p>
      </div>
      <div class="ar-tree" role="group" aria-label={a().tab}>
        <span class="ar-corner" aria-hidden="true" />
        {d.branches.map((b) => (
          <div key={b.id} class="ar-branch-head">
            <span>{b.name}</span>
            {b.licensed && <span class="af-label ar-license">{tx().discovery.archiveUi.license}</span>}
          </div>
        ))}
        {[1, 2, 3, 4].map((level) => (
          <Fragment key={level}>
            <span class="ar-level af-label">{tx().discovery.archiveUi.levelShort(level)}</span>
            {d.branches.map((b) => (
              <div key={`${b.id}${level}`} class={`ar-cell${b.licensed ? ' is-licensed' : ''}`}>
                {b.nodes
                  .filter((n) => n.level === level)
                  .map((n) => (
                    <NodeCard key={n.id} n={n} selected={sel?.id === n.id} on={on} />
                  ))}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
      {sel && (
        <Panel material="plate" cut="md" trim="left" class="ar-detail" testId="archive-detail">
          <div class="ar-detail-main">
            <span class="af-label ar-detail-kind">{sel.key ? a().key : a().level(sel.level)}</span>
            <h3 class="ar-detail-name">{sel.name}</h3>
            <p class="ar-detail-effect">{sel.effect}</p>
            {sel.reason && sel.state !== 'owned' && <p class="ar-detail-reason">{sel.reason}</p>}
          </div>
          <div class="ar-detail-act">
            {sel.state === 'owned' ? (
              <span class="ar-owned">
                <Lamp state="ok" /> {a().owned}
              </span>
            ) : (
              <Button
                variant="primary"
                testId="archive-unlock"
                disabled={sel.state !== 'ready'}
                reason={sel.reason ?? undefined}
                aside={`${cost(sel)}${sel.credits > 0 ? ` · ${formatCredits(sel.credits)}` : ''}`}
                onClick={() => on.buyNode(sel.id)}
              >
                {a().unlock}
              </Button>
            )}
          </div>
        </Panel>
      )}
      <div class="ar-bottom">
        <section>
          <Heading level={4}>{a().plans}</Heading>
          <ul class="ar-plans">
            {d.plans.map((p) => (
              <li key={p.name} class={p.done ? 'is-done' : p.fragments > 0 ? 'is-started' : ''}>
                <span class="ar-plan-pips" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <i key={i} class={i < p.fragments ? 'is-on' : ''} />
                  ))}
                </span>
                <span>{p.name}</span>
                <span class="ar-plan-count">{p.done ? a().planDone : a().fragments(p.fragments, 3)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <Heading level={4}>{a().keyItems}</Heading>
          <p class="ar-keys">{d.keyItems.length > 0 ? d.keyItems.join(', ') : tx().discovery.journalUi.none}</p>
        </section>
      </div>
    </div>
  );
}
