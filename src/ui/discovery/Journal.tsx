// The journal (J, long-term design 5.6 and 10.8): tabs Knowledge (graph), Atlas, Log and Manual.
// A dark frame with a light plate like the other in-flight overlays; the graph in a recessed display.
import { tx } from '../../i18n';
import { formatPercent } from '../format';
import type { ExploreHandlers } from '../../game/discovery/exploreUi';
import { JOURNAL_TABS, type JournalData, type JournalTab } from '../../game/discovery/journalView';
import { KeyHint, KnowledgeGraph, Lamp, Panel, Readout, TabRail, type TabDef } from '../theme';
import './journal.css';

const j = () => tx().discovery.journalUi;

function Knowledge({ d, on }: { d: JournalData; on: ExploreHandlers }) {
  if (d.nodes.length === 0) return <p class="jr-empty">{j().empty}</p>;
  const e = d.selected;
  return (
    <div class="jr-knowledge">
      <div class="jr-graph-col">
        <KnowledgeGraph
          nodes={d.nodes.map((n) => ({ ...n, kindLabel: j().kinds[n.kind] }))}
          edges={d.edges}
          selected={e?.id ?? null}
          onSelect={(id) => {
            on.click();
            on.selectEntry(id);
          }}
          label={j().tabs.knowledge}
          moreLabel={j().legendMore}
          unknownLabel={j().legendUnknown}
        />
        <div class="jr-legend">
          <span>
            <Lamp state="info" /> {j().legendMore}
          </span>
          <span>
            <span class="af-label jr-q">?</span> {j().legendUnknown}
          </span>
          <span>
            <span class="jr-arrow" aria-hidden="true" /> {j().legendLead}
          </span>
          <span class="jr-chapters">
            {d.chapters.map((c) => (
              <span key={c.chapter} class="jr-chapter">
                {c.name} <strong>{c.done}/{c.total}</strong>
              </span>
            ))}
          </span>
        </div>
      </div>
      {e && (
        <Panel material="plate" cut="md" trim="left" class="jr-entry" as="section" aria-label={e.title} testId="journal-entry">
          <span class="af-label jr-entry-kind">{j().kinds[e.kind]}</span>
          <h3 class="jr-entry-title">{e.title}</h3>
          <span class="jr-entry-when">{e.when}</span>
          <p class="jr-entry-text">{e.text}</p>
          <h4 class="jr-entry-sub">{j().leads}</h4>
          <ul class="jr-leads">
            {e.leads.map((l) => (
              <li key={l.id}>
                {l.known ? (
                  <button
                    type="button"
                    class="jr-lead af-focusable"
                    onClick={() => {
                      on.click();
                      on.selectEntry(l.id);
                    }}
                  >
                    {l.title}
                  </button>
                ) : (
                  <span class="jr-lead is-unknown">?</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Atlas({ d }: { d: JournalData }) {
  return (
    <div class="jr-atlas" data-testid="journal-atlas">
      {d.atlas.map((c) => (
        <section key={c.id} class={`jr-coll${c.done ? ' is-done' : ''}`} aria-label={c.name}>
          <div class="jr-coll-head">
            <h3>{c.name}</h3>
            <span class="jr-coll-pct">{formatPercent(Math.round((c.found / c.total) * 100))}</span>
            <span class="jr-coll-count">
              {c.found}/{c.total}
            </span>
            {c.reward > 0 && <span class={`af-label jr-coll-reward${c.done ? ' is-done' : ''}`}>{c.done ? tx().discovery.atlas.done : tx().discovery.atlas.reward(c.reward)}</span>}
          </div>
          <div class="jr-coll-bar" role="meter" aria-valuemin={0} aria-valuemax={c.total} aria-valuenow={c.found}>
            {c.items.map((i) => (
              <span key={i.id} class={i.found ? 'is-found' : ''} />
            ))}
          </div>
          <ul class="jr-coll-items">
            {c.items.length <= 9 &&
              c.items.map((i) => (
                <li key={i.id} class={i.found ? 'is-found' : ''}>
                  {i.label}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Log({ d }: { d: JournalData }) {
  if (d.log.length === 0) return <p class="jr-empty">{j().noLog}</p>;
  return (
    <ol class="jr-log">
      {d.log.map((l, i) => (
        <li key={i}>
          <span class="jr-log-when">{l.when}</span>
          <span>{l.text}</span>
        </li>
      ))}
    </ol>
  );
}

function Manual({ d }: { d: JournalData }) {
  return (
    <div class="jr-manual">
      <div class="jr-manual-text">
        {d.manual.map((m) => (
          <section key={m.title}>
            <h3>{m.title}</h3>
            <p>{m.text}</p>
          </section>
        ))}
      </div>
      <aside class="jr-manual-side">
        <Panel material="screen" cut="sm" class="jr-data">
          <Readout label={tx().discovery.archive.fund} value={Math.floor(d.data.fund)} unit={tx().discovery.dataUnit} />
          <Readout label={tx().discovery.archive.total} value={Math.floor(d.data.total)} unit={tx().discovery.dataUnit} />
        </Panel>
        <h3>{j().plans}</h3>
        {d.plans.length === 0 ? (
          <p class="jr-dim">{j().none}</p>
        ) : (
          <ul class="jr-plans">
            {d.plans.map((p) => (
              <li key={p.name}>
                <Lamp state={p.done ? 'ok' : 'off'} /> {p.name} <strong>{p.fragments}/3</strong>
              </li>
            ))}
          </ul>
        )}
        <h3>{j().keyItems}</h3>
        <p class={d.keyItems.length ? '' : 'jr-dim'}>{d.keyItems.length ? d.keyItems.join(', ') : j().none}</p>
        <h3>{j().training}</h3>
        <ul class="jr-hints">
          {d.trainingSteps.map((h) => (
            <li key={h.title}>
              <strong>{h.title}</strong>
              {h.keys ? <KeyHint keys={h.keys}>{h.text}</KeyHint> : <span>{h.text}</span>}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

export function Journal({ d, on }: { d: JournalData; on: ExploreHandlers }) {
  const tabs: TabDef<JournalTab>[] = JOURNAL_TABS.map((t, i) => ({ id: t, label: j().tabs[t], keyHint: String(i + 1) }));
  return (
    <div class="co-backdrop co-backdrop--light" data-testid="journal">
      <div class="co-sheet jr-sheet" role="dialog" aria-label={j().title}>
        <div class="co-head jr-head">
          <h2 class="co-title">{j().title}</h2>
          <KeyHint keys="J" dark>
            {j().close.replace(/^J – /, '')}
          </KeyHint>
        </div>
        <TabRail
          tabs={tabs}
          active={d.tab}
          label={j().title}
          testIdPrefix="journal-tab-"
          onSelect={(t) => {
            on.click();
            on.setJournalTab(t);
          }}
        />
        <div class="co-body jr-body">
          {d.tab === 'knowledge' && <Knowledge d={d} on={on} />}
          {d.tab === 'atlas' && <Atlas d={d} />}
          {d.tab === 'log' && <Log d={d} />}
          {d.tab === 'manual' && <Manual d={d} />}
        </div>
      </div>
    </div>
  );
}
