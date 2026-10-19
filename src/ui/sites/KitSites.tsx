// UI kit (ui-kit.html): M4b "The world comes alive" (plan T9) – the HUD event chips in every state, the two-chip
// stack, and the derelict terminal for each service, the hold full and a used one. The terminals are
// interactive (take / fabricate mark the rows); a language switch re-renders the section in SK or EN.
import { useState } from 'preact/hooks';
import type { PartKey } from '../../data/parts';
import type { DerelictTerminalData, TerminalHandlers } from '../../game/sites/types';
import { getLocale, setLocale, type Locale } from '../../i18n/locale';
import { Panel, Segmented } from '../theme';
import { DerelictTerminal } from './DerelictTerminal';
import { EventChip } from './EventChip';
import { kitChips, kitChipStack, kitTerminals } from './sitesKitFixtures';

/** One interactive terminal: taking an item or fabricating marks it in a local copy. */
function KitTerminal({ d: initial }: { d: DerelictTerminalData }) {
  const [d, setD] = useState(initial);
  const on: TerminalHandlers = {
    take: (index) => setD((s) => ({ ...s, items: s.items.map((i) => (i.index === index ? { ...i, taken: true } : i)) })),
    fabricate: (_key: PartKey) => setD((s) => ({ ...s, fabricator: null, items: s.items.map((i) => ({ ...i, taken: true })) })),
    leave: () => setD(initial),
  };
  return <DerelictTerminal d={d} on={on} inline />;
}

export function KitSites() {
  const [lang, setLang] = useState<Locale>(getLocale());
  const switchLang = (l: Locale) => {
    setLocale(l);
    setLang(l);
  };
  return (
    <Panel material="band" cut="lg" as="section" class="kit-section" testId="kit-sites">
      <h2 class="kit-h2">The world comes alive - events and terminal (M4b)</h2>
      <p class="kit-note">
        Event chip under the top-left HUD column: a lamp in the tone (blinks during the warning), the kind glyph, the name, a countdown in tabular figures and a
        direction dial (0° = bow). At most two at a time - the storm keeps its place.
      </p>
      <div style={{ marginBottom: '0.8rem' }}>
        <Segmented
          label="Language"
          options={[
            { value: 'sk', label: 'SK' },
            { value: 'en', label: 'EN' },
          ]}
          value={lang}
          onChange={switchLang}
        />
      </div>
      <div key={lang} style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fill, minmax(19rem, 1fr))' }} data-testid="kit-event-chips">
        {kitChips().map((row) => (
          <div key={row.label} style={{ display: 'grid', gap: '0.25rem', alignContent: 'start' }}>
            <span class="af-label" style={{ color: 'var(--af-text-dim)' }}>
              {row.label}
            </span>
            <EventChip chips={row.chips} inline />
          </div>
        ))}
        <div style={{ display: 'grid', gap: '0.25rem', alignContent: 'start' }}>
          <span class="af-label" style={{ color: 'var(--af-text-dim)' }}>
            Three events → two (ambush + storm)
          </span>
          <EventChip chips={kitChipStack()} inline />
        </div>
      </div>
      <p class="kit-note">
        Abandoned station terminal: a log on a recessed display, Data, a one-off service (stash / plan / fabricator). Esc and F both unlink the ship as “Undock”.
        Clicking “Take” / “Fabricate” marks the row here.
      </p>
      <div key={`t-${lang}`} style={{ display: 'flex', flexWrap: 'wrap', gap: '1.2rem', alignItems: 'flex-start' }} data-testid="kit-terminals">
        {kitTerminals().map((t) => (
          <div key={t.d.id} style={{ display: 'grid', gap: '0.35rem', flex: '1 1 30rem', maxWidth: '44rem' }} data-testid={`kit-terminal-${t.d.id}`}>
            <span class="af-label" style={{ color: 'var(--af-text-dim)' }}>
              {t.label}
            </span>
            <KitTerminal d={t.d} />
          </div>
        ))}
      </div>
    </Panel>
  );
}
