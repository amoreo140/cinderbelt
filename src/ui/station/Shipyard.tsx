// Shipyard – ship editor (M2, 4.6; "Hull language" design system (Jazyk trupu), ch. 8). A hangar console around the 3D platform:
// the part palette on the left, open space in the middle (the 3D scene is under the UI), live properties
// and the cost of changes on the right, the checks below the platform. ShipyardEditor holds the logic;
// this only draws.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PartKey, Tier } from '../../data/parts';
import type { ShapeId } from '../../data/shapes';
import type { CostBreakdown, DesignMessage, HullView, PaletteEntry, ReshapePreview, ShapeStripView, ShipyardView, StatRow } from '../../game/shipyardView';
import type { ShipHeaderView } from '../../game/fleet/types';
import type { ShipId } from '../../sim/fleet/types';
import { formatParts, nextShape, partName, shapeStrip } from '../../game/shipyardView';
import { hotkeyLabel } from '../../game/paletteHotkeys';
import type { PartInfoView } from '../../game/partInfo';
import { tx } from '../../i18n';
import { assetUrl } from '../../render/assets/url';
import type { AcquireMode } from '../../sim/shipyard/draft';
import type { Rotation } from '../../sim/ship/types';
import { formatAmount, formatCredits, formatInt, formatNumber } from '../format';
import type { RestoreInfo, ShipyardPrompt } from '../../game/shipyardEditor';
import { Button, Heading, Key, KeyHint, Lamp, Modal, Panel, Segmented, Term, useTip } from '../theme';
import { ShapeIcon } from '../theme/ShapeIcon';
import { splitKeyLabel } from '../keyLabel';
import { ShipName } from './Hangar';
import { PartAbout, ShipEffect } from './PartInfo';
// after the theme – screen rules win over the component base
import './shipyard.css';
import './shapes.css';

export interface ShipyardUiData {
  view: ShipyardView;
  tier: Tier;
  selected: PartKey | null;
  rot: Rotation;
  layers: boolean;
  /** Label next to the ghost (window px): why the part cannot be placed. */
  ghostLabel: { text: string; x: number; y: number } | null;
  /** Highlighted check message (code). */
  focusCode: string | null;
  committing: boolean;
  /** The part under the cursor can be grabbed ("hand" cursor). */
  grab: boolean;
  /** Parts in the group selection (Shipyard 2.0). */
  selection?: number;
  /** Restore to design (M3.8): what the ship lost against its blueprint. */
  restore?: RestoreInfo;
  /** The selected part explained: what it does and what it changes on the draft. */
  info?: PartInfoView | null;
  /** Hangar camera: the bow's screen direction (degrees clockwise from up) for the bow marker. */
  bow?: number;
  /** The hangar camera looks straight down: the view button offers the way back. */
  topDown?: boolean;
  /** The active ship's name and log for the header (M4a; the hub head shows it on the Shipyard tab). */
  header?: ShipHeaderView;
  /** Mirror mode (SL2 E1, M): on, and the axis on the seam above the cockpit row (`half`). */
  mirror?: { on: boolean; half: boolean };
  /** Label next to the mirror ghost (window px): why the copy will not be placed. */
  mirrorLabel?: { text: string; x: number; y: number } | null;
  /**
   * SL2 E2: the armour shape in hand (null / missing = full). Owned by the editor (U1 –
   * `ShipyardEditor.shape`); the strip under the palette and the ghost card show it.
   */
  shape?: ShapeId | null;
  /**
   * SL2 E2: the ghost tooltip of armour in hand or of a reshape ("½ pt · 20 HP · +18° cutout for the cannon
   * (3,1)") – `shapeTip(draft.grid, ghost).text` from shipyardView (U1 passes it; cached per ghost).
   */
  shapeTip?: string | null;
  /** SL2 E2: an empty hand over a placed armour plate – the shape Tab reshapes it to and its facts. */
  reshape?: ReshapePreview | null;
  /** The shipyard key help (K); missing = the screen keeps its own open/closed state. */
  help?: boolean;
}

export interface ShipyardHandlers {
  select(key: PartKey | null): void;
  setTier(tier: Tier): void;
  toggleLayers(): void;
  rotate(dir: 1 | -1): void;
  undo(): void;
  redo(): void;
  restore(): void;
  /** Restore to design (M3.8). */
  restoreDesign?(): void;
  cancel(): void;
  commit(): void;
  resetView(): void;
  /** Hangar camera: straight down, bow up (Home). */
  topView?(): void;
  /** Mirror mode (M) and its axis (through the cockpit row or on the seam above it). */
  toggleMirror?(): void;
  /**
   * SL2 E2: put `shape` in hand (null = full) – the shape strip's click and arrow keys. TODO(U1): the
   * editor implements it (`yard.selectShape(shape)`, the same state Tab / Shift+Tab cycles); until then
   * the strip only shows the shape in hand.
   */
  selectShape?(shape: ShapeId | null): void;
  /** The shipyard key help (K); missing = the screen toggles its own help card. */
  toggleHelp?(): void;
  toggleMirrorAxis?(): void;
  focus(message: DesignMessage): void;
  setAcquire(key: PartKey, mode: AcquireMode): void;
  pointer(kind: 'down' | 'move' | 'up' | 'leave', e: PointerEvent): void;
  /** Double click in the hangar: select the whole connected piece. */
  doubleClick?(e: MouseEvent): void;
  wheel(e: WheelEvent): void;
  click(): void;
  promptConfirm(): void;
  promptCancel(): void;
}

const t = () => tx().shipyard.ui;

// ---------------------------------------------------------------------------
// number formatting with Δ

const num = (v: number, digits = 1): string =>
  Math.abs(v - Math.round(v)) < 1e-9 ? formatInt(v) : digits === 2 ? formatNumber(v, 2) : formatAmount(v);

/** "+1.5" / "−0.4" (always signed, typographic minus). */
function signed(v: number, digits = 1): string {
  const s = num(Math.abs(v), digits);
  return v > 0 ? `+${s}` : `−${s}`;
}

function Delta({ row, secondary = false, digits = 1 }: { row: StatRow; secondary?: boolean; digits?: number }) {
  const d = secondary && row.secondary ? row.secondary.delta : row.delta;
  if (Math.abs(d) < 1e-6) return <span class="yd-delta is-same" aria-hidden="true" />;
  return <span class={`yd-delta is-${row.trend}`}>{signed(d, digits)}</span>;
}

// ---------------------------------------------------------------------------
// palette

/** Part key: 1–9, second row Shift + 1–9 (⇧1 …). */
function PaletteKey({ n }: { n: number }) {
  const key = hotkeyLabel(n);
  return (
    <span class="yd-pal-key">
      {key && <Key>{key.shift ? `⇧${key.digit}` : key.digit}</Key>}
      {key?.shift && <span class="af-sr-only">Shift+{key.digit}</span>}
    </span>
  );
}

function PaletteRow({ entry, selected, on }: { entry: PaletteEntry; selected: boolean; on: ShipyardHandlers }) {
  // hover / focus: what the part does, then where the next piece comes from
  const tip = useTip(entry.tooltip ? [entry.about, entry.tooltip].join('\n') : entry.about, 'info');
  const tag = entry.source === 'storage' ? null : t().sourceTag[entry.source];
  // the selected part (also via Shift + 1–9) is scrolled into view in the list
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  return (
    <button
      ref={ref}
      type="button"
      class={`yd-pal-row af-focusable af-tier-${entry.tier}${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      data-testid={entry.variant ? `palette-${entry.partId}-${entry.variant}` : `palette-${entry.partId}`}
      onClick={() => {
        on.click();
        on.select(entry.key);
      }}
      {...tip}
    >
      {selected && <span class="af-trim" aria-hidden="true" />}
      <PaletteKey n={entry.hotkey} />
      <span class="af-tier-frame yd-pal-icon">
        <img src={assetUrl(entry.icon)} alt="" />
      </span>
      <span class="yd-pal-name">{entry.name}</span>
      <span class="yd-pal-tags">
        {entry.unique && (
          <span class="yd-unique" title={t().uniqueTag}>
            <span class="af-sr-only">{t().uniqueTag}</span>
          </span>
        )}
        {tag && <span class={`af-label yd-tag yd-tag--${entry.source}`}>{tag}</span>}
      </span>
      <span class={`yd-pal-count${entry.available <= 0 ? ' is-out' : ''}`}>{entry.available}</span>
    </button>
  );
}

/** First what the part is for (weapon, shield, cargo…), then mass and HP – at most 4 rows. */
const compareRows = (rows: PaletteEntry['compare']): PaletteEntry['compare'] =>
  [...rows.filter((c) => c.id !== 'mass' && c.id !== 'hp'), ...rows.filter((c) => c.id === 'mass' || c.id === 'hp')].slice(0, 4);

/** The description in one line (the full text in its tooltip) – the shape strip needs the room. */
function OneLineAbout({ info }: { info: PartInfoView }) {
  const text = info.variant ? `${info.description.what}
${info.variant}` : info.description.what;
  const tip = useTip(text, 'info');
  return (
    <p class="pi-what yd-pal-what af-focusable" data-testid="part-about" tabIndex={0} {...tip}>
      {info.description.what}
    </p>
  );
}

/** The advice under the effect display, at most two lines on a short screen (the full text in its tooltip). */
function PaletteAdvice({ advice }: { advice: NonNullable<PartInfoView['advice']> }) {
  const tip = useTip(advice.text, 'info');
  return (
    <p class={`yd-pal-advice af-focusable is-${advice.tone}`} data-testid="part-advice" tabIndex={0} {...tip}>
      <Lamp state={advice.tone} />
      <span>{advice.text}</span>
    </p>
  );
}

/**
 * The selected part explained. `shaped` (armour – the shape strip is shown): the description collapses
 * to one line and the advice leaves the display, so the parts list keeps its rows at 1280 × 720.
 */
function PaletteDetail({ entry, info, shaped = false }: { entry: PaletteEntry | undefined; info: PartInfoView | null | undefined; shaped?: boolean }) {
  if (!entry) return <p class="yd-pal-hint">{t().selectHint}</p>;
  return (
    <div class={`yd-pal-detail${shaped ? ' is-shaped' : ''}`} data-testid="yard-part-detail">
      {info &&
        (shaped ? (
          <div class="yd-pal-info">
            <OneLineAbout info={info} />
            <ShipEffect info={{ ...info, advice: null }} compact />
            {info.advice && <PaletteAdvice advice={info.advice} />}
          </div>
        ) : (
          <div class="yd-pal-info">
            <PartAbout info={info} compact />
            <ShipEffect info={info} compact />
          </div>
        ))}
      <div class="yd-pal-detail-head">
        <span class="af-label">{t().compare}</span>
        <span class="yd-pal-source">{entry.source === 'storage' ? t().inStock : entry.tooltip}</span>
      </div>
      <table>
        <tbody>
          {compareRows(entry.compare).map((c) => (
            <tr key={c.id}>
              <th scope="row">
                <Term tip={c.tip}>{c.label}</Term>
              </th>
              <td class={entry.tier === 1 ? 'is-current' : ''}>{num(c.t1)}</td>
              <td class={entry.tier === 2 ? 'is-current' : ''}>{num(c.t2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// shape strip (SL2 E2): armour in hand → full + 9 shapes under the palette list

const STRIP_KEYS: Record<string, 1 | -1 | 'first' | 'last'> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
  Home: 'first',
  End: 'last',
};

function ShapeTile({
  item,
  index,
  strip,
  rot,
  focusRef,
  onPick,
  onKey,
}: {
  item: ShapeStripView['items'][number];
  index: number;
  strip: ShapeStripView;
  rot: Rotation;
  focusRef: (el: HTMLButtonElement | null) => void;
  onPick: () => void;
  onKey: (e: KeyboardEvent) => void;
}) {
  const tip = useTip(`${item.name}\n${item.facts}`, 'info');
  return (
    <button
      ref={focusRef}
      type="button"
      role="radio"
      aria-checked={item.active}
      tabIndex={item.active ? 0 : -1}
      class={`yd-shape af-focusable${item.active ? ' is-active' : ''}`}
      data-testid={`yard-shape-${item.shape ?? 'full'}`}
      data-index={index}
      onClick={onPick}
      onKeyDown={onKey}
      {...tip}
    >
      <ShapeIcon shape={item.shape} rot={rot} tier={strip.tier} cell={11} />
      <span class="af-sr-only">
        {item.name}, {item.facts}
      </span>
    </button>
  );
}

/**
 * "TVAR" strip: full + the 9 shapes as miniatures in the hand's rotation, the active one = the shape in
 * hand. Click or ← / → (a radio group) puts a shape in hand; Tab / Shift+Tab cycle it from the hangar.
 */
export function ShapeStrip({ strip, rot, on }: { strip: ShapeStripView; rot: Rotation; on: Pick<ShipyardHandlers, 'selectShape' | 'click'> }) {
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const active = strip.items[strip.activeIndex]!;
  const pick = (shape: ShapeId | null) => {
    on.click();
    on.selectShape?.(shape);
  };
  const onKey = (e: KeyboardEvent) => {
    const move = STRIP_KEYS[e.key];
    if (move === undefined) return;
    // the hangar camera pans with the arrows – a key meant for the strip stays in the strip
    e.preventDefault();
    e.stopPropagation();
    const n = strip.items.length;
    const i = move === 'first' ? 0 : move === 'last' ? n - 1 : (((strip.activeIndex + move) % n) + n) % n;
    const shape = move === 'first' || move === 'last' ? strip.items[i]!.shape : nextShape(active.shape, move);
    pick(shape);
    tiles.current[i]?.focus();
  };
  return (
    <div class={`yd-shapes af-tier-${strip.tier}`} data-testid="yard-shapes" data-active={active.shape ?? 'full'}>
      <div class="yd-shapes-head">
        <Term tip={strip.hint} class="af-label yd-shapes-label">
          {strip.label}
        </Term>
        <span class="yd-shapes-name" data-testid="yard-shape-active">
          <b>{active.name}</b> · {active.facts}
        </span>
        <Key>{strip.keys}</Key>
      </div>
      <div class="yd-shapes-grid" role="radiogroup" aria-label={strip.label}>
        {strip.items.map((item, i) => (
          <ShapeTile
            key={item.shape ?? 'full'}
            item={item}
            index={i}
            strip={strip}
            rot={rot}
            focusRef={(el) => {
              tiles.current[i] = el;
            }}
            onPick={() => pick(item.shape)}
            onKey={onKey}
          />
        ))}
      </div>
    </div>
  );
}

function Palette({ d, on }: { d: ShipyardUiData; on: ShipyardHandlers }) {
  const selected = d.view.palette.find((e) => e.key === d.selected);
  const strip = shapeStrip(d.selected, d.shape ?? null);
  return (
    <Panel material="plate" cut="md" trim="top" tier={d.tier} class="yd-palette" as="aside" aria-label={t().palette}>
      <div class="yd-panel-head">
        <Heading>{t().palette}</Heading>
        <span class="yd-tier-toggle">
          <Key>T</Key>
          <Segmented
            label={t().tier}
            options={([1, 2] as const).map((tier) => ({ value: tier, label: `T${tier}` }))}
            value={d.tier}
            onChange={(tier) => {
              on.click();
              on.setTier(tier);
            }}
          />
        </span>
      </div>
      <div class="yd-pal-list" role="group" aria-label={t().palette}>
        {d.view.palette.map((e) => (
          <PaletteRow key={e.key} entry={e} selected={e.key === d.selected} on={on} />
        ))}
      </div>
      {strip && <ShapeStrip strip={strip} rot={d.rot} on={on} />}
      <PaletteDetail entry={selected} info={d.info} shaped={strip !== null} />
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// properties

function StatLine({ row, unit, digits }: { row: StatRow; unit?: string; digits?: number }) {
  return (
    <div class={`yd-stat${row.alert ? ' is-alert' : ''}`} data-testid={`stat-${row.id}`}>
      <Term tip={row.tip} class="yd-stat-label">
        {row.label}
      </Term>
      <span class="yd-stat-value">
        {num(row.value, digits)}
        {unit && <small> {unit}</small>}
      </span>
      <Delta row={row} digits={digits} />
    </div>
  );
}

/** "Turn 180°: 3.5 s" – lower is better; a ship without torque "cannot turn". */
function TurnLine({ row }: { row: StatRow }) {
  const texts = tx().shipyardV2.turn180;
  return (
    <div class="yd-stat" data-testid={`stat-${row.id}`}>
      <Term tip={row.tip} class="yd-stat-label">
        {row.label}
      </Term>
      <span class="yd-stat-value">
        {row.none ? (
          texts.none
        ) : (
          <>
            {num(row.value)}
            <small> {texts.unit}</small>
          </>
        )}
      </span>
      <Delta row={row} />
    </div>
  );
}

function ThrustCell({ row, dir }: { row: StatRow; dir: 'up' | 'down' | 'left' | 'right' }) {
  const accel = row.secondary?.value ?? 0;
  const none = row.value <= 0;
  const title = `${row.label}: ${tx().shipyard.stats.thrust.toLowerCase()} ${num(row.value)}, ${num(accel)} ${t().accelUnit}`;
  return (
    <div class={`yd-thrust yd-thrust--${dir}${none ? ' is-none' : ''}`} data-testid={`stat-${row.id}`} title={title}>
      <span class="yd-thrust-arrow" aria-hidden="true" />
      <span class="af-sr-only">{title}</span>
      <span class="yd-thrust-accel" aria-hidden="true">
        {num(accel)}
        <small> {t().accelUnit}</small>
      </span>
      <Delta row={row} secondary />
    </div>
  );
}

/**
 * Hull budget: "HULL 31½ / 48 pts · cockpit T2" + segments (one point = one segment; a shaped part's ½
 * point lights half a segment).
 */
export function HullBudget({ hull }: { hull: HullView }) {
  const tip = useTip(t().hullHint, 'info', 'below');
  const segments = hull.budget === null ? 0 : Math.ceil(Math.max(hull.budget, hull.used) - 1e-9);
  return (
    <div class={`yd-hull${hull.over ? ' is-over' : ''}`} data-testid="yard-hull" {...tip}>
      <div class="yd-hull-line">
        <span class="af-label yd-hull-label">{hull.label}</span>
        <span class="yd-hull-points" data-testid="yard-hull-points">
          {hull.points}
        </span>
        <span class="yd-hull-cockpit">· {hull.cockpit}</span>
        {hull.over && <Lamp state="bad" label={hull.points} />}
      </div>
      {segments > 0 && (
        <div class="yd-hull-track" style={{ gridTemplateColumns: `repeat(${segments}, minmax(0, 1fr))` }} aria-hidden="true">
          {Array.from({ length: segments }, (_, i) => (
            <span
              key={i}
              class={`yd-hull-seg${i + 1 <= hull.used + 1e-9 ? ' is-on' : i < hull.used ? ' is-half' : ''}${hull.budget !== null && i >= hull.budget ? ' is-over' : ''}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stats({ rows, hull }: { rows: StatRow[]; hull: HullView }) {
  const r = Object.fromEntries(rows.map((row) => [row.id, row])) as Record<StatRow['id'], StatRow>;
  const balance = r.energyBalance;
  return (
    <Panel material="screen" cut="md" class="yd-stats" testId="yard-stats">
      <Heading aside="Δ">{t().stats}</Heading>
      <HullBudget hull={hull} />
      <StatLine row={r.mass} unit={t().massUnit} />
      <StatLine row={r.parts} />
      <StatLine row={r.hp} unit="HP" />
      <div class="yd-subhead af-label">{t().thrust}</div>
      <div class="yd-thrust-cross">
        <ThrustCell row={r.thrustForward} dir="up" />
        <ThrustCell row={r.thrustLeft} dir="left" />
        <span class="yd-thrust-hub" aria-hidden="true" />
        <ThrustCell row={r.thrustRight} dir="right" />
        <ThrustCell row={r.thrustBackward} dir="down" />
      </div>
      <div class="yd-stat" data-testid="stat-turning">
        <Term tip={r.turning.tip} class="yd-stat-label">
          {r.turning.label}
        </Term>
        <span class="yd-stat-value">
          {num(r.turning.secondary?.value ?? 0, 2)}
          <small> {t().turnUnit}</small>
        </span>
        <Delta row={r.turning} secondary digits={2} />
      </div>
      <TurnLine row={r.turn180} />
      <div class="yd-subhead af-label">{t().capacity}</div>
      <div class="yd-cap-grid">
        <StatLine row={r.cargo} unit={tx().units.unit} />
        <StatLine row={r.fuel} unit={tx().units.unit} />
        <StatLine row={r.battery} />
        <StatLine row={r.radar} unit={tx().units.unit} />
      </div>
      {(r.cannonArc.value > 0 || r.cannonArc.delta !== 0) && <StatLine row={r.cannonArc} unit="°" />}
      <div class="yd-subhead af-label">{t().energy}</div>
      <div class={`yd-energy${balance.alert ? ' is-alert' : ''}`} data-testid="stat-energyBalance">
        <Lamp state={balance.alert ? 'bad' : 'ok'} />
        <span class="yd-energy-eq">
          <span class="is-gen">+{num(r.energyGen.value)}</span> <span class="is-use">−{num(r.energyUse.value)}</span> ={' '}
          <b>{signed(balance.value)}</b>
          <small>{t().perSecond}</small>
        </span>
        <Delta row={balance} />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// cost of changes

function AcquireChoice({ view, on }: { view: ShipyardView; on: ShipyardHandlers }) {
  const entries = (Object.entries(view.report.cost.acquired) as [PartKey, string][]).filter(([, mode]) => mode === 'craft' || mode === 'buy');
  if (entries.length === 0) return null;
  return (
    <div class="yd-acquire">
      <span class="af-label">{t().missingParts}</span>
      {entries.map(([key, mode]) => (
        <div class="yd-acquire-row" key={key}>
          <span>{partName(key)}</span>
          <Segmented
            label={partName(key)}
            options={[
              { value: 'craft' as const, label: tx().shipyard.cost.craft },
              { value: 'buy' as const, label: tx().shipyard.cost.buy },
            ]}
            value={mode as AcquireMode}
            onChange={(m) => {
              on.click();
              on.setAcquire(key, m);
            }}
          />
        </div>
      ))}
    </div>
  );
}

function Cost({ cost, view, on }: { cost: CostBreakdown; view: ShipyardView; on: ShipyardHandlers }) {
  const lines = cost.lines.filter((l) => l.id !== 'repairs' || l.credits > 0);
  return (
    <Panel material="plate" cut="md" trim="top" class="yd-cost" testId="yard-cost">
      <Heading>{t().cost}</Heading>
      {/* a long list (a template applied on an empty storage) scrolls here - the total stays in view */}
      <div class="yd-cost-body">
        <dl class="yd-cost-lines">
          {lines.map((l) => (
            <div key={l.id} class={`yd-cost-line${l.text === tx().shipyard.cost.none ? ' is-empty' : ''}`}>
              <dt>{l.label}</dt>
              <dd>
                {l.text}
                {l.credits > 0 && l.id !== 'install' && l.id !== 'repairs' && <span class="yd-cost-credits">{formatCredits(l.credits)}</span>}
              </dd>
            </div>
          ))}
        </dl>
        <AcquireChoice view={view} on={on} />
      </div>
      <div class={`yd-cost-total${cost.affordable ? '' : ' is-short'}`}>
        <span class="af-label">{tx().shipyard.cost.total}</span>
        <span class="yd-cost-sum" data-testid="yard-total">
          {cost.totalText}
        </span>
        <span class="yd-cost-left">
          {cost.affordable ? t().remaining(formatCredits(cost.remaining)) : t().short(formatCredits(-cost.remaining))}
        </span>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// checks

function Check({ d, on }: { d: ShipyardUiData; on: ShipyardHandlers }) {
  const { messages, dirty } = d.view;
  const codes = new Set(messages.map((m) => m.code));
  const basics: [string, boolean][] = [
    [t().checksOk.connected, !codes.has('disconnected')],
    [t().checksOk.cockpit, !codes.has('noCockpit') && !codes.has('multipleCockpits')],
    [t().checksOk.forward, !codes.has('noForwardEngine')],
  ];
  return (
    <Panel material="screen" cut="md" class="yd-check" testId="yard-check" as="section" aria-label={t().check}>
      <div class="yd-check-head">
        <span class="af-label">{t().check}</span>
        {basics.map(([label, ok]) => (
          <span key={label} class={`yd-basic${ok ? '' : ' is-bad'}`}>
            <Lamp state={ok ? 'ok' : 'bad'} />
            {label}
          </span>
        ))}
      </div>
      <ul class="yd-msgs">
        {messages.length === 0 && (
          <li class="yd-msg is-ok">
            <Lamp state={dirty ? 'ok' : 'off'} />
            <span>{dirty ? t().allGood : t().unchanged}</span>
          </li>
        )}
        {messages.map((m) => {
          const clickable = m.partIds.length > 0;
          const body = (
            <>
              <Lamp state={m.severity === 'error' ? 'bad' : 'warn'} />
              <span>{m.text}</span>
            </>
          );
          return (
            <li key={`${m.code}:${m.partIds.join(',')}`} class={`yd-msg is-${m.severity}${d.focusCode === m.code ? ' is-focus' : ''}`} data-code={m.code}>
              {clickable ? (
                <button
                  type="button"
                  class="yd-msg-btn af-focusable"
                  aria-pressed={d.focusCode === m.code}
                  title={t().focusHint}
                  onClick={() => {
                    on.click();
                    on.focus(m);
                  }}
                >
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// hangar area (overlays over the 3D scene)

function Hint({ keys, children }: { keys: ComponentChildren; children: ComponentChildren }) {
  return (
    <span class="yd-hint">
      {keys}
      <span>{children}</span>
    </span>
  );
}

/** "The ship lost parts against its design" over the hangar with the
 *  one-click restore (M3.8). */
export function RestoreBand({ info, on }: { info: RestoreInfo; on: ShipyardHandlers }) {
  const parts = [
    info.missingCount > 0 ? tx().flight.status.missing(info.missingCount) : null,
    info.damaged > 0 ? (info.missingCount > 0 ? tx().flight.status.damagedShort(info.damaged) : tx().combat.damaged(info.damaged)) : null,
  ].filter(Boolean);
  const list = formatParts(info.missing);
  return (
    <div
      class={`yd-restore${info.applied ? ' is-applied' : ''}`}
      data-testid="yard-restore-band"
      data-applied={String(info.applied)}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Lamp state={info.applied ? 'ok' : 'bad'} />
      <span class="yd-restore-text">
        <b>{info.applied ? tx().flight.restore.applied : tx().flight.restore.banner(parts.join(' · '))}</b>
        {!info.applied && list && <small>{list}</small>}
      </span>
      {!info.applied && on.restoreDesign && (
        <Button size="sm" variant="secondary" onClick={on.restoreDesign} hint={tx().flight.restore.hint} testId="yard-restore-design">
          {tx().flight.restore.button}
        </Button>
      )}
    </div>
  );
}

/** Guild loan parts on the draft: a badge over the hangar with the explanation; the button highlights them. */
function LoanBand({ message, on }: { message: DesignMessage; on: ShipyardHandlers }) {
  return (
    <div class="yd-loan" data-testid="yard-loan-band" title={message.text} onPointerDown={(e) => e.stopPropagation()}>
      <Lamp state="warn" />
      <span class="yd-restore-text">
        <b>{t().loanBand}</b>
        <small>{t().loanBandHint}</small>
      </span>
      <Button size="sm" variant="ghost" onClick={() => on.focus(message)} testId="yard-loan-show">
        {t().loanShow}
      </Button>
    </div>
  );
}

/** "Zrkadlo" (M) and, while it is on, the small "os ±½" axis toggle (SL2 E1 mirror mode). */
function MirrorTools({ mirror, on }: { mirror: ShipyardUiData['mirror']; on: ShipyardHandlers }) {
  const m = tx().shipyardV2.mirror;
  return (
    <>
      <Button size="sm" variant="ghost" keyHint="M" onClick={on.toggleMirror} class={`yd-mirror${mirror?.on ? ' is-on' : ''}`} hint={m.buttonHint} testId="yard-mirror">
        {m.button}
      </Button>
      {mirror?.on && (
        <Button
          size="sm"
          variant="ghost"
          onClick={on.toggleMirrorAxis}
          class={`yd-mirror${mirror.half ? ' is-on' : ''}`}
          hint={`${m.axisHint} (${mirror.half ? m.axisSeam : m.axisCell})`}
          testId="yard-mirror-axis"
        >
          {m.axis}
        </Button>
      )}
    </>
  );
}

/** The shipyard key help (K): the keys the footer hints do not cover. */
export function YardHelp() {
  const help = tx().shipyardV2.help;
  return (
    <Panel material="screen" cut="sm" class="yd-help" testId="yard-help-card" as="section" aria-label={help.title}>
      <span class="af-label yd-help-title">{help.title}</span>
      <ul>
        {help.lines.map((line) => {
          const parsed = splitKeyLabel(line);
          return (
            <li key={line}>
              {parsed ? (
                <>
                  <span class="yd-help-keys">
                    {parsed.keys.map((k) => (
                      <Key key={k} dark>
                        {k}
                      </Key>
                    ))}
                  </span>
                  <span>{parsed.text}</span>
                </>
              ) : (
                <span>{line}</span>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** "Armour T1 · Wedge · 90°" with the shape miniature, the R / Tab keys and the shape tooltip line. */
export function GhostCard({ entry, rot, shape, tip }: { entry: PaletteEntry; rot: Rotation; shape: ShapeId | null; tip?: string | null }) {
  const shapes = tx().shipyardV2.shapes;
  const shaped = shapeStrip(entry.key, shape) !== null;
  const name = shaped ? `${entry.name} T${entry.tier} · ${shapes.names[shape ?? 'full']}` : `${entry.name} T${entry.tier}`;
  return (
    <div class={`yd-ghost-card af-tier-${entry.tier}${shaped ? ' is-shaped' : ''}`} data-testid="yard-ghost" data-shape={shaped ? (shape ?? 'full') : undefined}>
      {shaped ? (
        <span class="yd-ghost-shape">
          <ShapeIcon shape={shape} rot={rot} tier={entry.tier} cell={13} />
        </span>
      ) : (
        <span class="af-tier-frame yd-pal-icon">
          <img src={assetUrl(entry.icon)} alt="" />
        </span>
      )}
      <span class="yd-ghost-text">
        <span>{t().ghost(name, rot * 90)}</span>
        {shaped && tip && (
          <small class="yd-ghost-tip" data-testid="yard-shape-tip">
            {tip}
          </small>
        )}
      </span>
      <KeyHint keys="R" dark>
        {tx().shipyard.ui.hints.rotate}
      </KeyHint>
      {shaped && <KeyHint keys={shapes.keys} dark />}
    </div>
  );
}

/** An empty hand over a placed armour plate: the shape Tab lays it in next (the ghost card's look). */
export function ReshapeCard({ preview }: { preview: ReshapePreview }) {
  const shapes = tx().shipyardV2.shapes;
  return (
    <div class={`yd-ghost-card af-tier-${preview.tier} is-shaped`} data-testid="yard-reshape" data-shape={preview.to ?? 'full'}>
      <span class="yd-ghost-shape">
        <ShapeIcon shape={preview.to} rot={preview.rot} tier={preview.tier} cell={13} />
      </span>
      <span class="yd-ghost-text">
        <span>{preview.name}</span>
        <small class="yd-ghost-tip" data-testid="yard-reshape-tip">
          {preview.tip}
        </small>
      </span>
      <KeyHint keys={shapes.keys} dark>
        {shapes.hint}
      </KeyHint>
    </div>
  );
}

/**
 * Publishes where the hangar's top row (the tools, the restore band, the ghost / reshape card) ends as
 * `--yard-top-bottom` on the UI root, so the docked toast (a sibling layer of the hub, hub.css) goes below
 * it instead of over the band. The row grows and wraps with its content, so its size is observed.
 */
function useTopRowBottom(ref: { current: HTMLDivElement | null }): void {
  useEffect(() => {
    const row = ref.current;
    const root = row?.closest('.hub')?.parentElement;
    if (!row || !root || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--yard-top-bottom', `${Math.round(row.getBoundingClientRect().bottom - root.getBoundingClientRect().top)}px`);
    });
    observer.observe(row);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--yard-top-bottom');
    };
  }, []);
}

function Viewport({ d, on, help, toggleHelp }: { d: ShipyardUiData; on: ShipyardHandlers; help: boolean; toggleHelp: () => void }) {
  const top = useRef<HTMLDivElement>(null);
  useTopRowBottom(top);
  const selected = d.view.palette.find((e) => e.key === d.selected);
  const loan = d.view.messages.find((m) => m.code === 'loanParts');
  const cursor = d.selected ? 'is-placing' : d.grab ? 'is-grab' : '';
  return (
    <div
      class={`yd-view ${cursor}`}
      data-testid="yard-view"
      aria-label={t().view}
      role="application"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        on.pointer('down', e);
      }}
      onPointerMove={(e) => on.pointer('move', e)}
      onPointerUp={(e) => on.pointer('up', e)}
      onPointerCancel={(e) => on.pointer('up', e)}
      onPointerLeave={(e) => on.pointer('leave', e)}
      onDblClick={(e) => on.doubleClick?.(e)}
      // Shift + click would extend the page's text selection – dragging that starts a native drag that
      // cancels the pointer (and with it a group move)
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      onWheel={(e) => {
        e.preventDefault();
        on.wheel(e);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* the top row: tools on the left, the restore band and the ghost card on the right – when they do not
          fit beside each other the right column wraps under the tools instead of covering them */}
      <div class="yd-view-top" ref={top}>
        <div class="yd-view-tools" onPointerDown={(e) => e.stopPropagation()}>
          {on.toggleMirror && <MirrorTools mirror={d.mirror} on={on} />}
          <Button size="sm" variant="ghost" keyHint="V" onClick={on.toggleLayers} class={d.layers ? 'is-on' : ''} hint={tx().shipyardV2.turn180.leverArm}>
            {t().layers}
          </Button>
          <Button size="sm" variant="ghost" keyHint="C" onClick={on.resetView} hint={tx().shipyardV2.camera.controls}>
            {t().center}
          </Button>
          {on.topView && (
            <Button size="sm" variant="ghost" keyHint="Home" onClick={on.topView} hint={tx().shipyardV2.camera.controls} testId="yard-top-view">
              {d.topDown ? tx().shipyardV2.camera.angledView : tx().shipyardV2.camera.topView}
            </Button>
          )}
        </div>
        {/* centred over a wide hangar; in a narrow one it follows the tools instead of hiding under them */}
        <div class="yd-bow" aria-hidden="true">
          {d.bow !== undefined && Math.abs(d.bow) >= 0.5 ? (
            // the hangar camera orbits: the marker points where the bow is on the screen
            <svg class="yd-bow-arrow" viewBox="0 0 10 12" width="11" height="13" style={{ transform: `rotate(${d.bow.toFixed(1)}deg)` }}>
              {/* a dart, not a triangle: a near-equilateral triangle looks the same turned by 120° */}
              <path d="M5 0 9.5 12 5 9 0.5 12Z" fill="currentColor" />
            </svg>
          ) : (
            <span class="yd-bow-arrow">▲</span>
          )}
          <span class="af-label">{t().bow}</span>
        </div>
        {(d.restore?.available || selected || d.reshape) && (
          <div class="yd-view-right">
            {d.restore?.available && <RestoreBand info={d.restore} on={on} />}
            {selected && <GhostCard entry={selected} rot={d.rot} shape={d.shape ?? null} tip={d.shapeTip} />}
            {!selected && d.reshape && <ReshapeCard preview={d.reshape} />}
          </div>
        )}
      </div>
      {/* the key help (K) at the bottom left of the hangar – above the Guild loan badge when there is one */}
      <div class={`yd-help-dock${loan ? ' is-raised' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
        {help && <YardHelp />}
        <Button size="sm" variant="ghost" keyHint="K" onClick={toggleHelp} class={`yd-help-btn${help ? ' is-on' : ''}`} hint={tx().shipyardV2.help.title} testId="yard-help">
          <span class="af-sr-only">{tx().shipyardV2.help.title}</span>
        </Button>
      </div>
      {loan && <LoanBand message={loan} on={on} />}
      {d.ghostLabel && (
        <div class="yd-ghost-label" style={{ left: `${d.ghostLabel.x}px`, top: `${d.ghostLabel.y}px` }} data-testid="ghost-reason">
          {d.ghostLabel.text}
        </div>
      )}
      {d.mirrorLabel && (
        <div class="yd-ghost-label" style={{ left: `${d.mirrorLabel.x}px`, top: `${d.mirrorLabel.y}px` }} data-testid="mirror-ghost-reason">
          {d.mirrorLabel.text}
        </div>
      )}
      {(d.selection ?? 0) > 0 && (
        <div class="yd-sel" data-testid="yard-selection" aria-live="polite">
          <b>{tx().shipyardV2.selection.count(d.selection!)}</b>
          <small>
            {tx().shipyardV2.selection.hint} · {tx().shipyardV2.mirror.selectionKeys} = {tx().shipyardV2.mirror.selectionHint}
          </small>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Shipyard({ d, on }: { d: ShipyardUiData; on: ShipyardHandlers }) {
  // the key help (K): the editor's state when it has one, else the screen's own
  const [ownHelp, setOwnHelp] = useState(false);
  const help = d.help ?? ownHelp;
  const toggleHelp = () => {
    on.click();
    if (on.toggleHelp) on.toggleHelp();
    else setOwnHelp((v) => !v);
  };
  return (
    <main class="yd" data-testid="shipyard">
      <div class="yd-left">
        <Palette d={d} on={on} />
      </div>
      <div class="yd-center">
        <Viewport d={d} on={on} help={help} toggleHelp={toggleHelp} />
        <div class="yd-bottom">
          <Check d={d} on={on} />
        </div>
      </div>
      <div class="yd-side">
        <Stats rows={d.view.stats} hull={d.view.hull} />
        <Cost cost={d.view.cost} view={d.view} on={on} />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// ship header (M4a): name (click to rename) + log line, Hangar / Templates

export interface ShipHeaderHandlers {
  /** `hangarRename` of the active ship; null = back to the generated name. */
  rename(shipId: ShipId, name: string | null): void;
  openHangar(): void;
  openTemplates(): void;
  click?(): void;
}

/** The active ship in the Shipyard tab's head: its name, its log line and the two fleet modals. */
export function ShipHeader({ h, on }: { h: ShipHeaderView; on: ShipHeaderHandlers }) {
  return (
    <div class="yd-ship" data-testid="yard-ship">
      <div class="yd-ship-id">
        <ShipName name={h.name} generated={h.generated} size="header" onRename={(name) => on.rename(h.id, name)} click={on.click} testId="yard-ship-name" />
        <span class="yd-ship-log" title={tx().fleet.log.title} data-testid="yard-ship-log">
          {h.logLine}
        </span>
      </div>
      <span class="yd-ship-buttons">
        <Button
          size="sm"
          variant="secondary"
          disabled={h.hangarReason !== undefined}
          reason={h.hangarReason}
          testId="yard-open-hangar"
          onClick={() => {
            on.click?.();
            on.openHangar();
          }}
        >
          {tx().fleet.hangar.title}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={h.templatesReason !== undefined}
          reason={h.templatesReason}
          testId="yard-open-templates"
          onClick={() => {
            on.click?.();
            on.openTemplates();
          }}
        >
          {tx().fleet.templates.title}
        </Button>
      </span>
    </div>
  );
}

/** Editor actions in the hub footer. */
export function ShipyardActions({ d, on }: { d: ShipyardUiData; on: ShipyardHandlers }) {
  const { view } = d;
  const firstError = view.messages.find((m) => m.severity === 'error');
  const reason = !view.dirty ? t().noChanges : firstError?.text;
  return (
    <>
      <span class="yd-history">
        <Button variant="ghost" size="sm" keyHint="Ctrl+Z" disabled={!view.canUndo} reason={t().undo} onClick={on.undo} testId="yard-undo">
          {t().undo}
        </Button>
        <Button variant="ghost" size="sm" keyHint="Ctrl+Y" disabled={!view.canRedo} reason={t().redo} onClick={on.redo} testId="yard-redo">
          {t().redo}
        </Button>
        <Button variant="ghost" size="sm" disabled={!view.dirty} reason={t().noChanges} onClick={on.restore} testId="yard-restore">
          {t().restore}
        </Button>
      </span>
      <span class="yd-hints" aria-hidden="true">
        <Hint keys={<span class="yd-mouse">{t().mouse.left}</span>}>{t().hints.place}</Hint>
        <Hint keys={<span class="yd-mouse">{tx().shipyardV2.hints.boxKeys}</span>}>{tx().shipyardV2.hints.box}</Hint>
        <Hint keys={<span class="yd-mouse">{t().mouse.right}</span>}>{t().hints.remove}</Hint>
        <Hint keys={<Key dark>R</Key>}>{t().hints.rotate}</Hint>
        <Hint keys={<span class="yd-mouse">{t().mouse.alt}</span>}>{t().hints.eyedrop}</Hint>
        <Hint keys={<><span class="yd-mouse">{tx().shipyardV2.camera.dragKeys}</span><Key dark>Q</Key><Key dark>E</Key></>}>{tx().shipyardV2.camera.orbit}</Hint>
        <Hint keys={<Key dark>M</Key>}>{tx().shipyardV2.mirror.hint}</Hint>
        <Hint keys={<Key dark>{tx().shipyardV2.shapes.keys}</Key>}>{tx().shipyardV2.shapes.hint}</Hint>
      </span>
      <Button variant="ghost" keyHint="Esc" onClick={on.cancel} testId="yard-cancel">
        {t().cancel}
      </Button>
      <Button
        variant="primary"
        keyHint="Enter"
        disabled={!view.canCommit || !view.dirty || d.committing}
        reason={d.committing ? t().committing : reason}
        onClick={on.commit}
        testId="yard-commit"
        aside={view.dirty ? formatCredits(view.cost.total) : undefined}
      >
        {t().commit}
      </Button>
    </>
  );
}

/** Editor dialogs: discard changes, undock without confirming, draft over a changed ship. */
export function ShipyardPromptView({ prompt, on, loose = 0 }: { prompt: ShipyardPrompt; on: ShipyardHandlers; loose?: number }) {
  const q = t().prompt;
  if (prompt === 'stale') {
    return (
      <Modal title={q.staleTitle} confirmLabel={q.staleConfirm} cancelLabel={q.staleDiscard} confirmKey="Enter" onConfirm={on.promptConfirm} onCancel={on.promptCancel}>
        {q.staleBody}
      </Modal>
    );
  }
  const undock = prompt === 'undock';
  return (
    <Modal
      tone="danger"
      title={undock ? q.undockTitle : q.cancelTitle}
      confirmLabel={undock ? q.undockConfirm : q.cancelConfirm}
      cancelLabel={q.back}
      cancelKey="Esc"
      onConfirm={on.promptConfirm}
      onCancel={on.promptCancel}
    >
      {undock ? q.undockBody : q.cancelBody}
      {loose > 0 && (
        <p class="yd-prompt-loose" data-testid="yard-prompt-loose">
          {tx().shipyardV2.looseNote(loose)}
        </p>
      )}
    </Modal>
  );
}
