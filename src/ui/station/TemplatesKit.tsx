// UI kit (ui-kit.html) section of M4a T6: the Templates modal and the death card's
// "Rebuild from a template" in every state, over mock view models (the game layer fills the real ones).
import { useState } from 'preact/hooks';
import type { Silhouette, SilhouetteCell } from '../../game/combatView';
import type { DeathTemplateView, TemplateHandlers, TemplateSource } from '../../game/fleet/types';
import type { PartId } from '../../data/parts';
import { getLocale, setLocale, tx, type Locale } from '../../i18n';
import type { TemplateDecodeError } from '../../sim/templates/types';
import { DeathCard } from '../menu/DeathCard';
import type { DeathInfo, OverlayHandlers } from '../menu/types';
import { Button, Lamp, Panel, Segmented } from '../theme';
import { Templates, type TemplateRowView, type TemplatesModalView } from './Templates';
import '../menu/menu.css';
import './templatesKit.css';

/** Silhouette from a sketch (bow up): `k` cockpit, `o` T1 part, `O` T2 part, `.` empty. */
function sketch(rows: string[]): Silhouette {
  const cells: SilhouetteCell[] = [];
  const cols = Math.max(...rows.map((r) => r.length));
  const parts: Record<string, { partId: PartId; tier: 1 | 2 }> = {
    k: { partId: 'cockpit', tier: 1 },
    K: { partId: 'cockpit', tier: 2 },
    o: { partId: 'armor', tier: 1 },
    O: { partId: 'armor', tier: 2 },
    e: { partId: 'engine', tier: 1 },
    c: { partId: 'cargo', tier: 1 },
  };
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      const p = parts[ch];
      if (p)
        cells.push({
          x: rows.length - 1 - r,
          y: cols - 1 - c,
          part: cells.length + 1,
          fraction: 1,
          ...p,
        });
    }),
  );
  return {
    cells,
    minX: 0,
    maxX: rows.length - 1,
    minY: 0,
    maxY: cols - 1,
    damaged: 0,
  };
}

const MINER = sketch(['.oKo.', 'ccOcc', 'ccocc', 'e.e.e']);
const FIGHTER = sketch(['..o..', '.oko.', 'OoOoO', 'e.e.e']);
const SCOUT = sketch(['.k.', 'ooo', 'cec']);
const HAULER = sketch(['.oko.', 'ccccc', 'ccccc', 'ccccc', 'ee.ee']);

function items(): TemplateRowView[] {
  return [
    {
      index: 0,
      name: 'Miner II',
      parts: 31,
      hullPoints: 46,
      cockpitTier: 2,
      locked: 0,
      silhouette: MINER,
    },
    {
      index: 1,
      name: 'Fortress fighter',
      parts: 24,
      hullPoints: 40,
      cockpitTier: 1,
      locked: 2,
      silhouette: FIGHTER,
    },
    {
      index: 2,
      name: 'Scout',
      parts: 9,
      hullPoints: 14,
      cockpitTier: 1,
      locked: 0,
      silhouette: SCOUT,
      applyReason: tx().actionErrors.serviceUnavailable,
    },
  ];
}

const CODE = 'CB2.eyJ2IjoxLCJuIjoixaRhxb5pYXIgSUkiLCJwIjpbWyJjb2NrcGl0OjIiLDAsMCwwXSxbImNhcmdvOjEiLC0xLDEsMF0sWyJjYXJnbzoxIiwxLDEsMF1dfQ.9c1e';

const noop = () => {};
const handlers = (patch: Partial<TemplateHandlers> = {}): TemplateHandlers => ({
  open: noop,
  close: noop,
  save: noop,
  apply: noop,
  rename: noop,
  delete: noop,
  exportCode: () => CODE,
  importCode: () => 'checksum',
  ...patch,
});

function view(patch: Partial<TemplatesModalView> = {}): TemplatesModalView {
  return { cap: 5, items: items(), ...patch };
}

/** A live modal with stateful mock handlers (keyboard and focus testing). */
function LiveTemplates({ close }: { close: () => void }) {
  const [list, setList] = useState<TemplateRowView[]>(items);
  const reindex = (l: TemplateRowView[]) => l.map((it, index) => ({ ...it, index }));
  const on = handlers({
    close,
    apply: close,
    save: (name: string, source: TemplateSource) =>
      setList((l) =>
        reindex([
          ...l,
          {
            index: 0,
            name,
            parts: source === 'draft' ? 18 : 12,
            hullPoints: 30,
            cockpitTier: 1,
            locked: 0,
            silhouette: SCOUT,
          },
        ]),
      ),
    rename: (index, name) => setList((l) => l.map((it) => (it.index === index ? { ...it, name } : it))),
    delete: (index) => setList((l) => reindex(l.filter((it) => it.index !== index))),
    importCode: (code): TemplateDecodeError | null => {
      if (!code.startsWith('CB2.')) return 'prefix';
      if (code !== CODE) return 'checksum';
      setList((l) =>
        reindex([
          ...l,
          {
            index: 0,
            name: 'Miner II',
            parts: 3,
            hullPoints: 6,
            cockpitTier: 2,
            locked: 0,
            silhouette: MINER,
          },
        ]),
      );
      return null;
    },
  });
  return <Templates view={view({ items: list })} on={on} draft />;
}

const ERRORS: TemplateDecodeError[] = [
  'tooLong',
  'prefix',
  'checksum',
  'format',
  'version',
  'name',
  'unknownPart',
  'noCockpit',
  'manyCockpits',
  'overlap',
  'outOfBounds',
  'invalidDesign',
];

function deathInfo(): DeathInfo {
  return {
    view: {
      penalty: 'hard',
      respawnStationId: 'home',
      evacuationStationId: null,
      loses: {
        cargo: true,
        cargoAmount: 42,
        salvageParts: 0,
        installedParts: true,
        partHpFraction: 1,
        fuelFraction: 0.5,
      },
      scuttle: null,
      fallsToHard: false,
      kills: 7,
      deaths: 2,
    },
    respawnName: 'Vega Anchor',
    evacuationName: null,
  };
}

function DeathDemo({ template }: { template: DeathTemplateView }) {
  const on = new Proxy({}, { get: () => noop }) as OverlayHandlers;
  return (
    <div class="kit-tp-death">
      <DeathCard death={deathInfo()} on={on} template={template} onTemplate={noop} />
    </div>
  );
}

export function KitTemplates() {
  const [, setLang] = useState<Locale>(getLocale());
  const [live, setLive] = useState(false);
  const switchLang = (l: Locale) => {
    setLocale(l);
    setLang(l);
  };
  const t = tx().fleet.templates;
  return (
    <>
      <Panel key={getLocale()} material="band" cut="lg" as="section" class="kit-section kit-tp" testId="kit-templates">
        <h2 class="kit-h2">Ship templates (M4a)</h2>
        <p class="kit-note">
          The Templates modal: a list with a silhouette, hull, cockpit and locked parts (Lamp warn); save the ship or a draft, Build, rename, delete
          (confirmation), a share code and an import with an error by code. The death card: “Rebuild from a template”.
        </p>
        <div class="kit-tp-bar">
          <Segmented
            label="Language"
            options={[
              { value: 'sk' as Locale, label: 'SK' },
              { value: 'en' as Locale, label: 'EN' },
            ]}
            value={getLocale()}
            onChange={switchLang}
          />
          <Button onClick={() => setLive(true)} testId="kit-templates-live">
            {'Open the real modal'}
          </Button>
        </div>

        <h3 class="kit-tp-h3">{'List · code copied · shipyard draft'}</h3>
        <div data-testid="kit-templates-list">
          <Templates
            inline
            view={view()}
            on={handlers()}
            draft
            initial={{
              exporting: 0,
              copy: 'copied',
              name: 'Miner III',
              source: 'draft',
            }}
          />
        </div>

        <h3 class="kit-tp-h3">{'Slots full · rename · import error'}</h3>
        <div data-testid="kit-templates-full">
          <Templates
            inline
            view={view({
              items: [
                ...items(),
                {
                  index: 3,
                  name: 'Salvager',
                  parts: 20,
                  hullPoints: 34,
                  cockpitTier: 1,
                  locked: 0,
                  silhouette: HAULER,
                },
                {
                  index: 4,
                  name: 'Hauler',
                  parts: 22,
                  hullPoints: 38,
                  cockpitTier: 2,
                  locked: 1,
                  silhouette: HAULER,
                },
              ],
              saveReason: tx().actionErrors.templateCap,
            })}
            on={handlers()}
            initial={{
              renaming: 1,
              renameText: 'Fortress fighter 2',
              importText: 'CB2.eyJ2IjoxLCJuIjoiVGHFvmlhciJ9.0000',
              importResult: 'checksum',
            }}
          />
        </div>

        <h3 class="kit-tp-h3">{'Empty · import OK · delete confirmation'}</h3>
        <div class="kit-tp-pair">
          <div data-testid="kit-templates-empty">
            <Templates inline view={view({ items: [] })} on={handlers()} initial={{ importResult: 'ok' }} />
          </div>
          <div data-testid="kit-templates-delete">
            <Templates inline view={view({ items: items().slice(0, 1) })} on={handlers()} initial={{ deleting: 0 }} />
          </div>
        </div>

        <h3 class="kit-tp-h3">{'Locked by the Archive · manual copy'}</h3>
        <div class="kit-tp-pair">
          <div data-testid="kit-templates-locked">
            <Templates
              inline
              view={view({
                cap: 0,
                items: [],
                lockReason: tx().discovery.archive.lockedPart(tx().discovery.archive.nodes.templates),
              })}
              on={handlers()}
            />
          </div>
          <div data-testid="kit-templates-manual">
            <Templates
              inline
              view={view({
                items: items()
                  .slice(1, 2)
                  .map((i) => ({ ...i, index: 0 })),
              })}
              on={handlers()}
              initial={{ exporting: 0, copy: 'manual' }}
            />
          </div>
        </div>

        <h3 class="kit-tp-h3">{'Import errors (every code)'}</h3>
        <ul class="kit-tp-errors af-on-plate" data-testid="kit-templates-errors">
          {ERRORS.map((e) => (
            <li key={e}>
              <Lamp state="bad" />
              <code>{e}</code>
              <span>{t.errors[e]}</span>
            </li>
          ))}
        </ul>

        <h3 class="kit-tp-h3">
          {'Death card: rebuild from a template (enabled / disabled)'}
        </h3>
        <div class="kit-tp-pair" data-testid="kit-templates-death">
          <DeathDemo template={{}} />
          <DeathDemo
            template={{
              reason: tx().actionErrors.serviceUnavailable,
            }}
          />
        </div>
      </Panel>
      {/* outside the section: its clip-path and filter would cut a fixed overlay */}
      {live && (
        <div class="kit-tp-live">
          <LiveTemplates close={() => setLive(false)} />
        </div>
      )}
    </>
  );
}
