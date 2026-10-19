// Storage overview (8.6, I key): what is stored at which station, search and a ring filter,
// the courier (Guild level 2), shipments in transit and the player's ships (M4a).
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { filterStorageRows, type StorageRow, type StoragesData } from '../../game/board/storagesView';
import type { StorageShipRow } from '../../game/fleet/types';
import { ALL_PART_KEYS, parsePartKey, type PartInventory, type PartKey } from '../../data/parts';
import { RESOURCE_IDS, type Cargo, type ResourceId } from '../../data/resources';
import { getLocale, tx } from '../../i18n';
import type { GameActionInput } from '../../sim/commands';
import { formatCredits, formatInt } from '../format';
import { Button, KeyHint, Lamp, Panel, PartChip, ResourceChip, RingBadge, Segmented } from '../theme';
import './overlays.css';

const t = () => tx().goals.storages;

export interface StoragesHandlers {
  action(action: GameActionInput): void;
  /** Courier fee and time (null = not possible). */
  quote(from: string, to: string, resources: Partial<Cargo>, parts: PartInventory): { fee: number; time: string } | null;
  close(): void;
  click(): void;
}

/** The storages data with the ship rows (M4a T4 fills `ships`; without them no ship section). */
export type StoragesViewData = StoragesData & { ships?: readonly StorageShipRow[] };

type ItemKey = ResourceId | PartKey;

const fold = (s: string): string => s.toLocaleLowerCase(getLocale()).normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Ships by the search (name, station, class) and the ring of the station they stand at. */
export function filterShipRows(ships: readonly StorageShipRow[], query: string, ring: number | null, ringOf: ReadonlyMap<string, number>): StorageShipRow[] {
  const q = fold(query.trim());
  return ships.filter(
    (s) =>
      (ring === null || (s.stationId !== null && ringOf.get(s.stationId) === ring)) &&
      (!q || [s.name, s.stationName ?? '', s.tierLabel].some((text) => fold(text).includes(q))),
  );
}

/** Ship rows: the active ship first, then the stored ones – name, class, hull points, where it stands. */
export function StorageShips({ ships }: { ships: readonly StorageShipRow[] }) {
  if (ships.length === 0) return null;
  return (
    <section class="co-ships" data-testid="storages-ships">
      <span class="af-label">{t().ships}</span>
      <ul class="co-ship-list">
        {ships.map((s) => (
          <li key={s.id} class="co-ship" data-testid={`storage-ship-${s.id}`}>
            <Lamp state={s.active ? 'ok' : 'info'} label={s.active ? t().shipActive : t().shipStored} />
            <strong class="co-ship-name">{s.name}</strong>
            <span class="co-dim">
              {s.tierLabel} · {t().shipHull(s.hullPoints)}
            </span>
            <span class="grow" />
            {s.active && <span class="af-label co-active">{t().shipActive}</span>}
            <span class="co-ship-where">{s.stationName ?? t().shipInFlight}</span>
            {s.here && <span class="af-label co-here">{t().here}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Items({ row, selected, toggle }: { row: StorageRow; selected?: ReadonlySet<ItemKey>; toggle?: (k: ItemKey) => void }) {
  const res = RESOURCE_IDS.filter((r) => (row.resources[r] ?? 0) > 0);
  const parts = ALL_PART_KEYS.filter((k) => (row.parts[k] ?? 0) > 0);
  const wrap = (k: ItemKey, child: ComponentChildren) =>
    toggle ? (
      <button key={k} type="button" class="co-item-toggle af-focusable" aria-pressed={selected?.has(k) ?? false} onClick={() => toggle(k)}>
        {child}
      </button>
    ) : (
      <span key={k}>{child}</span>
    );
  return (
    <div class="af-res-list co-items">
      {res.map((r) => wrap(r, <ResourceChip id={r} amount={row.resources[r]} name tag />))}
      {parts.map((k) => {
        const { partId, tier } = parsePartKey(k);
        return wrap(k, <PartChip partId={partId} tier={tier} count={row.parts[k]} />);
      })}
    </div>
  );
}

function CourierForm({ row, d, on, done }: { row: StorageRow; d: StoragesData; on: StoragesHandlers; done: () => void }) {
  const targets = d.destinations.filter((x) => x.id !== row.stationId).slice(0, 5);
  const [to, setTo] = useState<string | null>(targets[0]?.id ?? null);
  const all: ItemKey[] = [...RESOURCE_IDS.filter((r) => (row.resources[r] ?? 0) > 0), ...ALL_PART_KEYS.filter((k) => (row.parts[k] ?? 0) > 0)];
  const [selected, setSelected] = useState<Set<ItemKey>>(() => new Set(all));
  const resources: Partial<Cargo> = {};
  const parts: PartInventory = {};
  for (const k of selected) {
    if ((RESOURCE_IDS as readonly string[]).includes(k)) resources[k as ResourceId] = row.resources[k as ResourceId];
    else parts[k as PartKey] = row.parts[k as PartKey];
  }
  const quote = to && selected.size > 0 ? on.quote(row.stationId, to, resources, parts) : null;
  const toggle = (k: ItemKey) => {
    on.click();
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelected(next);
  };
  const reason = targets.length === 0 ? t().noTarget : selected.size === 0 ? t().nothingSelected : undefined;
  return (
    <Panel material="screen" cut="sm" class="co-courier" testId="courier-form">
      <div class="co-courier-row">
        <span class="af-label">{t().items}</span>
        <Items row={row} selected={selected} toggle={toggle} />
      </div>
      {targets.length > 0 && (
        <div class="co-courier-row">
          <span class="af-label">{t().to}</span>
          <Segmented
            label={t().to}
            options={targets.map((x) => ({ value: x.id, label: x.name }))}
            value={to ?? ''}
            onChange={(v) => {
              on.click();
              setTo(v);
            }}
          />
        </div>
      )}
      <div class="co-courier-row co-courier-foot">
        {quote && (
          <span class="co-quote">
            <span class="af-label">{t().fee}</span> <b>{formatCredits(quote.fee)}</b>
            <span class="af-label">{t().time}</span> <b>{quote.time}</b>
          </span>
        )}
        <span class="grow" />
        <Button size="sm" variant="ghost" onClick={() => (on.click(), done())}>
          {t().cancel}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!quote || reason !== undefined}
          {...(reason ? { reason } : {})}
          testId="courier-send"
          onClick={() => {
            if (!to) return;
            on.click();
            on.action({ type: 'courierSend', from: row.stationId, to, resources, parts });
            done();
          }}
        >
          {t().confirm}
        </Button>
      </div>
    </Panel>
  );
}

export function StoragesView({ d, on }: { d: StoragesViewData; on: StoragesHandlers }) {
  const [query, setQuery] = useState('');
  const [ring, setRing] = useState<number | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const rows = filterStorageRows(d.rows, { query, ring });
  const rings = [...new Set(d.rows.map((r) => r.ring))].sort();
  const ringOf = new Map<string, number>([...d.destinations.map((x) => [x.id, x.ring] as const), ...d.rows.map((r) => [r.stationId, r.ring] as const)]);
  const ships = filterShipRows(d.ships ?? [], query, ring, ringOf);
  return (
    <div class="co-backdrop co-backdrop--light" data-testid="storages">
      <div class="co-sheet co-storages" role="dialog" aria-label={t().title}>
        <header class="co-head">
          <h2 class="co-title">{t().title}</h2>
          <KeyHint keys="I" dark>
            {t().close.replace(/^I – /, '')}
          </KeyHint>
        </header>
        <div class="co-body af-on-plate">
          <div class="co-toolbar">
            <input
              class="co-search af-focusable"
              type="search"
              value={query}
              placeholder={t().search}
              aria-label={t().search}
              data-testid="storages-search"
              onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            />
            <Segmented
              label={t().allRings}
              options={[{ value: 0, label: t().allRings }, ...rings.map((r) => ({ value: r, label: <RingBadge ring={r} compact /> }))]}
              value={ring ?? 0}
              onChange={(v) => {
                on.click();
                setRing(v === 0 ? null : v);
              }}
            />
          </div>
          <StorageShips ships={ships} />
          {d.rows.length === 0 ? (
            <p class="co-dim">{t().empty}</p>
          ) : rows.length === 0 ? (
            <p class="co-dim">{t().noMatch}</p>
          ) : (
            <ul class="co-storage-list">
              {rows.map((row) => (
                <li key={row.stationId} class="co-storage" data-testid={`storage-${row.stationId}`}>
                  <div class="co-storage-head">
                    <RingBadge ring={row.ring} compact />
                    <strong>{row.name}</strong>
                    {row.here ? <span class="af-label co-here">{t().here}</span> : <span class="co-dim">{formatInt(row.distance)} {tx().units.unit}</span>}
                    <span class="grow" />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!d.courier}
                      reason={t().courierLocked}
                      testId={`courier-${row.stationId}`}
                      onClick={() => {
                        on.click();
                        setSending(sending === row.stationId ? null : row.stationId);
                      }}
                    >
                      {t().send}
                    </Button>
                  </div>
                  <Items row={row} />
                  {sending === row.stationId && d.courier && <CourierForm row={d.rows.find((r) => r.stationId === row.stationId)!} d={d} on={on} done={() => setSending(null)} />}
                </li>
              ))}
            </ul>
          )}
          {d.shipments.length > 0 && (
            <section class="co-transit">
              <span class="af-label">{t().inTransit}</span>
              {d.shipments.map((s) => (
                <div key={s.id} class="co-transit-row" data-testid="shipment">
                  <Lamp state="info" />
                  <span>
                    {s.from} → <b>{s.to}</b>
                  </span>
                  <span class="co-dim">{t().eta(s.eta)}</span>
                </div>
              ))}
            </section>
          )}
          {!d.courier && <p class="co-dim co-locked">{t().courierLocked}</p>}
        </div>
      </div>
    </div>
  );
}
