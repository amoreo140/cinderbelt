import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { resourcePrice, type PriceList } from '../../data/economy';
import { parsePartKey, type PartInventory, type PartKey, type Tier } from '../../data/parts';
import type { CraftRow, PartMarketRow, RepairView } from '../../game/stationView';
import { RESOURCE_IDS, cargoUsed, type Cargo, type ResourceId } from '../../data/resources';
import type { BoardData, BoardViewMode } from '../../game/board/boardView';
import type { CareerHandlers } from '../../game/career/careerUi';
import { getLocale, tx } from '../../i18n';
import { DEMAND_BONUS } from '../../data/sector';
import { SectorStrip } from '../board/SectorStrip';
import type { GameActionInput } from '../../sim/commands';
import type { ShipGrid } from '../../sim/ship/types';
import { refinedBonusAt } from '../../sim/ship/workshop';
import { HOME_STATION_ID, type StationDef } from '../../sim/world/stations';
import { formatAmount, formatCredits, formatInt, formatNumber, formatPercent, formatPrice } from '../format';
import { splitKeyList } from '../keyLabel';
import {
  Credits,
  Gauge,
  Heading,
  KeyHint,
  Lamp,
  Panel,
  PartChip,
  ResourceChip,
  RingBadge,
  Seam,
  Segmented,
  ShipSilhouette,
  TabRail,
  Term,
  type TabDef,
} from '../theme';
import type { DesignGap } from '../../game/designGap';
import { formatParts } from '../../game/shipyardView';
import { Act } from './Act';
import { Archive } from './Archive';
import type { ArchiveData } from '../../game/discovery/archiveView';
import type { ExploreHandlers } from '../../game/discovery/exploreUi';
import { Crafting } from './Crafting';
import type { DevelopmentData, DevelopmentHandlers } from '../../game/home/types';
import { PartsMarket } from './PartsMarket';
import { Repairs } from './Repairs';
import type { ShipyardHandlers, ShipyardUiData } from './Shipyard';
import type { HangarHandlers, HangarView, TemplateHandlers } from '../../game/fleet/types';
import { Board, Development, HangarModal, prefetchHubScreens, ShipHeader, Shipyard, ShipyardActions, ShipyardPromptView } from '../lazyScreens';
import { bindHangar, hubHangarLine, storedHere } from './hangarFormat';
import type { ShipyardPrompt } from '../../game/shipyardEditor';
import {
  buyQuantity,
  refinedLost,
  refuelQuote,
  sellAllValue,
  sellQuantity,
  sellQuote,
  transferQuantity,
  type QtyMode,
} from './trade';
// after the theme – screen rules win over the component base
import './hub.css';
// the refined-ore row of the market (M4c workshop)
import '../workshop/workshop.css';

export type StationTab = 'overview' | 'market' | 'crafting' | 'shipyard' | 'service' | 'board' | 'archive' | 'development';
/** Hub tabs in key order (1–8); Development (M4c) is last and exists only at the home station. */
export const STATION_TABS: readonly StationTab[] = ['overview', 'market', 'crafting', 'shipyard', 'service', 'board', 'archive', 'development'];

/** Hub UI state that is not in the simulation (tab, toggles, selection). */
export interface StationUiState {
  tab: StationTab;
  qty: QtyMode;
  sellFrom: 'ship' | 'storage';
  /** Welcome text on the overview – until the first undocking. */
  welcome: boolean;
  /** Market: resources or parts. */
  marketKind: 'resources' | 'parts';
  partTier: Tier;
  craftTier: Tier;
  craftKey: PartKey | null;
  craftCount: number;
  repairAutoBuy: boolean;
  /** Board: contracts / factions / wanted (M3.5a). */
  boardView: BoardViewMode;
}

export interface StationHubData {
  station: StationDef;
  name: string;
  /** Depth of the station's sector (sectors 1b) – the header shows it instead of the ring. */
  depth?: number;
  credits: number;
  cargo: Cargo;
  cargoMax: number;
  /** Refined ore in the cargo (M4c refinery; missing = none): sells first with its bonus. */
  refined?: Cargo;
  /** The player's ship (part explanations show what a part would change on it). */
  shipGrid?: ShipGrid;
  fuel: number;
  fuelMax: number;
  energy: number;
  energyMax: number;
  storage: { resources: Cargo; parts: PartInventory };
  prices: PriceList;
  emergency: boolean;
  ui: StationUiState;
  partsMarket: PartMarketRow[];
  crafting: CraftRow[];
  repair: RepairView;
  /** Whether a single part can be repaired (by id). */
  repairRowOk: Record<number, boolean>;
  /** Shipyard editor (only on the Shipyard tab). */
  shipyard: ShipyardUiData | null;
  /** Open editor dialog (also outside the tab – e.g. undocking with an unconfirmed draft). */
  yardPrompt: ShipyardPrompt | null;
  /** Loose parts of the draft (Shipyard 2.0) – the leave dialog says they cannot be confirmed. */
  yardLoose?: number;
  /** The ship draft has unconfirmed changes (marker on the tab). */
  yardDirty: boolean;
  /** Contract board (M3.5a; null outside the Board and Overview tabs). */
  board?: BoardData | null;
  /** Fuel price at the station, including the sector state. */
  fuelPrice?: number;
  /** Station demand from the sector state (buy price +45 % up to the cap). */
  demand?: { resource: ResourceId; left: number } | null;
  /** Ship position (distances on the slips). */
  shipPos?: { x: number; y: number };
  /** Archive (M3.5b; only on the Archive tab). */
  archive?: ArchiveData | null;
  /** The ship lost parts against its blueprint (M3.8; overview only). */
  designGap?: DesignGap | null;
  /** Engines blowing into another part of the ship (I15; overview only, 0 = none). */
  coveredNozzles?: number;
  /** Hangar view model (M4a): the overview's hangar row and the Hangar modal; null = no hangar here. */
  hangar?: HangarView | null;
  /** The Hangar modal is open (over any tab). */
  hangarOpen?: boolean;
  /** Further fleet overlays drawn beside the hub (the Templates modal, M4a T6). */
  overlays?: ComponentChildren;
  /** Development tab of the home station (M4c; null elsewhere and on the other tabs). */
  development?: DevelopmentData | null;
}

export interface StationHubHandlers {
  action(action: GameActionInput): void;
  setTab(tab: StationTab): void;
  setQty(qty: QtyMode): void;
  setSellFrom(from: 'ship' | 'storage'): void;
  /** Change of the other hub toggles (parts market, crafting, repairs). */
  setUi(patch: Partial<StationUiState>): void;
  undock(): void;
  shipyard: ShipyardHandlers;
  /** Board view (M3.5a). */
  setBoardView?(view: BoardViewMode): void;
  /** In-game career panels (Objectives, Storages, return card – M3.5a). */
  career?: CareerHandlers;
  /** Discovery (M3.5b): Archive, journal, map layers. */
  explore?: ExploreHandlers;
  /** Click sound. */
  click(): void;
  /** Open the shipyard with the draft restored to the blueprint (M3.8). */
  restoreDesign?(): void;
  /** Hangar modal and ship renaming (M4a). */
  hangar?: HangarHandlers;
  /** Templates modal (M4a T6): the Shipyard header opens it. */
  templates?: Pick<TemplateHandlers, 'open'>;
  /** Development tab of the home station (M4c). */
  development?: DevelopmentHandlers;
}

type Props = StationHubData & { on: StationHubHandlers };

/** The tab exists at this station (Development only at home – elsewhere it is not even listed). */
export const tabListed = (tab: StationTab, station: StationDef): boolean => tab !== 'development' || station.id === HOME_STATION_ID;

function tabEnabled(tab: StationTab, station: StationDef): boolean {
  if (!tabListed(tab, station)) return false;
  if (tab === 'market') return station.services.market;
  if (tab === 'crafting') return station.services.crafting;
  if (tab === 'shipyard') return station.services.shipyard;
  if (tab === 'service') return station.services.refuel || station.services.repair;
  // board: every station has a Board
  return true;
}

/** List of resources as chips with icons. */
function CargoChips({ cargo }: { cargo: Cargo }) {
  const ids = RESOURCE_IDS.filter((id) => cargo[id] >= 0.05);
  if (ids.length === 0) return null;
  return (
    <>
      {ids.map((id) => (
        <ResourceChip key={id} id={id} amount={cargo[id]} name tag />
      ))}
    </>
  );
}

function PartChips({ parts }: { parts: PartInventory }) {
  const items = (Object.entries(parts) as [PartKey, number | undefined][]).filter(([, n]) => (n ?? 0) > 0);
  if (items.length === 0) return null;
  return (
    <>
      {items.map(([key, n]) => {
        const { partId, tier } = parsePartKey(key);
        return <PartChip key={key} partId={partId} tier={tier} count={n ?? 0} />;
      })}
    </>
  );
}

function ListRow({ label, children, empty }: { label: string; children: ComponentChildren; empty: boolean }) {
  return (
    <div class="hub-list-row">
      <span class="hub-list-label">{label}</span>
      <div class="af-res-list">{empty ? <span class="hub-dim">{tx().station.empty}</span> : children}</div>
    </div>
  );
}

function Overview(p: Props) {
  const { on } = p;
  const used = cargoUsed(p.cargo);
  const sellValue = sellAllValue(p.cargo, p.prices.resources, p.refined, p.demand);
  const ice = p.storage.resources.ice + p.cargo.ice;
  const fuel = refuelQuote({ fuel: p.fuel, capacity: p.fuelMax, ice, credits: p.credits, ring: p.station.ring, ...(p.fuelPrice !== undefined ? { unitPrice: p.fuelPrice } : {}) });
  const sellAll = () => {
    for (const id of RESOURCE_IDS) {
      if (p.cargo[id] > 1e-9) on.action({ type: 'sellResource', resource: id, qty: 'all', from: 'ship' });
    }
  };
  const unloadAll = () => {
    for (const id of RESOURCE_IDS) {
      if (p.cargo[id] > 1e-9) on.action({ type: 'transfer', resource: id, qty: 'all', to: 'storage' });
    }
  };
  const services = (Object.keys(p.station.services) as (keyof StationDef['services'])[]).filter((k) => p.station.services[k]);
  const emptyCargo = used < 1e-9;
  // unloading everything turns the refined ore (M4c) into ordinary ore in storage
  const refinedAboard = p.refined ? RESOURCE_IDS.reduce((sum, id) => sum + p.refined![id], 0) : 0;
  const storageResources = RESOURCE_IDS.some((id) => p.storage.resources[id] >= 0.05);
  const storageParts = Object.values(p.storage.parts).some((n) => (n ?? 0) > 0);
  return (
    <div class="hub-overview">
      {p.ui.welcome && (
        <Panel material="screen" cut="sm" class="hub-welcome">
          <Lamp state="info" />
          <p>{tx().station.welcome}</p>
        </Panel>
      )}
      <div class="hub-columns">
        <section>
          <Heading>{tx().station.ship}</Heading>
          <Panel material="screen" cut="md" class="hub-gauges">
            <Gauge kind="fuel" label={tx().hud.fuel} value={p.fuel} max={p.fuelMax} />
            <Gauge kind="energy" label={tx().hud.energy} value={p.energy} max={p.energyMax} />
            <Gauge kind="cargo" label={tx().hud.cargo} value={used} max={p.cargoMax} decimals={1} invert />
          </Panel>
          {p.designGap && <DesignGapCard gap={p.designGap} on={on} />}
          {(p.coveredNozzles ?? 0) > 0 && <CoveredNozzlesCard engines={p.coveredNozzles!} on={on} shipyard={p.station.services.shipyard} />}
        </section>
        <section class="hub-quick">
          <Heading>{tx().station.quickActions}</Heading>
          <Act
            on={on}
            block
            variant={emptyCargo ? 'secondary' : 'primary'}
            testId="sell-all"
            disabled={!p.station.services.market || emptyCargo}
            reason={!p.station.services.market ? tx().market.unavailable : tx().market.nothingToSell}
            onClick={sellAll}
            aside={`+${formatCredits(sellValue)}`}
          >
            {tx().station.sellAll}
          </Act>
          <Act
            on={on}
            block
            disabled={emptyCargo}
            reason={tx().market.nothingToMove}
            {...(refinedAboard >= 0.05 ? { hint: tx().home.workshop.transferWarning(formatNumber(refinedAboard, 1, true)), class: 'ws-transfer-warn' } : {})}
            onClick={unloadAll}
          >
            {tx().station.unloadAll}
          </Act>
          <Act
            on={on}
            block
            disabled={fuel.missing < 1e-9 || ice < 1e-9}
            reason={fuel.missing < 1e-9 ? tx().service.tankFull : tx().service.noIce}
            onClick={() => on.action({ type: 'refuel', source: 'ice', amount: 'full' })}
            aside={`${formatAmount(fuel.iceUsed)} → ${formatAmount(fuel.iceFuel)}`}
          >
            {tx().station.refuelIce}
          </Act>
          <Act
            on={on}
            block
            disabled={fuel.missing < 1e-9 || !fuel.affordableFull}
            reason={fuel.missing < 1e-9 ? tx().service.tankFull : tx().service.notEnoughCredits}
            onClick={() => on.action({ type: 'refuel', source: 'credits', amount: 'full' })}
            aside={formatCredits(fuel.fullCost)}
          >
            {tx().station.refuelCredits}
          </Act>
        </section>
      </div>
      {p.board && (
        <>
          <Seam />
          <OverviewCareer {...p} />
        </>
      )}
      <Seam />
      <div class="hub-lists">
        <ListRow label={tx().station.cargoList} empty={emptyCargo}>
          <CargoChips cargo={p.cargo} />
        </ListRow>
        <ListRow label={tx().station.storageList} empty={!storageResources && !storageParts}>
          <CargoChips cargo={p.storage.resources} />
          <PartChips parts={p.storage.parts} />
        </ListRow>
        {p.hangar && p.station.services.shipyard && <HangarRow v={p.hangar} on={on} />}
        <ListRow label={tx().station.services} empty={services.length === 0}>
          {services.map((k) => (
            <span key={k} class="hub-service-tag">
              {tx().station.serviceNames[k]}
            </span>
          ))}
        </ListRow>
      </div>
    </div>
  );
}

/** The overview's hangar row (M4a): "2 ships stand here · 1 free slot" and the way into the Hangar. */
function HangarRow({ v, on }: { v: HangarView; on: StationHubHandlers }) {
  const line = hubHangarLine(v);
  if (line === null) return null;
  const t = tx().fleet.hangar.overview;
  return (
    <div class="hub-list-row" data-testid="hub-hangar">
      <span class="hub-list-label">{t.label}</span>
      <div class="hub-hangar-line">
        <span>{line}</span>
        <Act on={on} size="sm" variant="ghost" disabled={!on.hangar} onClick={() => on.hangar?.open()} testId="hub-open-hangar">
          {storedHere(v) > 0 ? t.open : tx().fleet.hangar.title}
        </Act>
      </div>
    </div>
  );
}

/** The ship lost parts against its blueprint (M3.8): the gaps, the list and the way to the shipyard. */
export function DesignGapCard({ gap, on }: { gap: DesignGap; on: StationHubHandlers }) {
  const status = [tx().flight.status.missing(gap.missingCount), gap.damaged > 0 ? tx().flight.status.damagedShort(gap.damaged) : null].filter(Boolean).join(' · ');
  return (
    <Panel material="screen" cut="md" class="hub-gap" testId="design-gap">
      <ShipSilhouette silhouette={gap.silhouette} width={64} height={60} maxCell={10} gap={1} label={`${tx().flight.restore.cardTitle}: ${status}`} />
      <div class="hub-gap-text">
        <span class="hub-gap-title">
          <Lamp state="bad" />
          {tx().flight.restore.cardTitle}
        </span>
        <span class="hub-gap-list">{tx().flight.restore.cardMissing(formatParts(gap.missing))}</span>
        <Act
          on={on}
          size="sm"
          variant="secondary"
          disabled={!gap.shipyard || !on.restoreDesign}
          reason={tx().flight.restore.cardNoYard}
          onClick={() => on.restoreDesign?.()}
          testId="design-gap-restore"
        >
          {tx().flight.restore.cardAction}
        </Act>
      </div>
    </Panel>
  );
}

/** Engines blowing into the ship's own parts (I15): what burns and the way to the shipyard. */
export function CoveredNozzlesCard({ engines, on, shipyard }: { engines: number; on: StationHubHandlers; shipyard: boolean }) {
  const t = tx().station.coveredNozzles;
  return (
    <Panel material="screen" cut="md" class="hub-gap hub-gap-warn" testId="covered-nozzles">
      <div class="hub-gap-text">
        <span class="hub-gap-title">
          <Lamp state="warn" />
          {t.title}
        </span>
        <span class="hub-gap-list">{t.text(engines)}</span>
        <Act on={on} size="sm" variant="secondary" disabled={!shipyard} reason={t.noYard} onClick={() => on.setTab('shipyard')} testId="covered-nozzles-yard">
          {t.action}
        </Act>
      </div>
    </Panel>
  );
}

/** Overview: sector state and active contracts (link to the Board). */
function OverviewCareer(p: Props) {
  const board = p.board!;
  const ready = board.active.filter((a) => a.state === 'ready').length;
  return (
    <section class="hub-career">
      <SectorStrip sector={board.sector} testId="overview-sector" />
      <div class="hub-list-row hub-career-row">
        <span class="hub-list-label">{tx().goals.board.active}</span>
        <div class="hub-career-line">
          {board.active.length === 0 ? (
            <span class="hub-dim">{tx().goals.board.noActive}</span>
          ) : (
            <span>
              {board.active.map((a) => a.typeName).join(' · ')}
              {ready > 0 && <strong class="hub-career-ready"> · {tx().goals.slip.ready} {ready}</strong>}
            </span>
          )}
          <Act on={p.on} size="sm" variant="ghost" keyHint="6" testId="open-board" onClick={() => p.on.setTab('board')}>
            {tx().goals.board.tab}
          </Act>
        </div>
      </div>
    </section>
  );
}

const QTY_MODES: readonly QtyMode[] = [1, 10, 100, 'max'];

function Market(p: Props) {
  const { on } = p;
  const free = p.cargoMax - cargoUsed(p.cargo);
  const parts = p.ui.marketKind === 'parts' && p.station.services.partsMarket;
  return (
    <div class="hub-market">
      <div class="hub-toolbar">
        <Segmented
          label={tx().market.kind}
          options={[
            { value: 'resources' as const, label: tx().market.resourcesTab },
            ...(p.station.services.partsMarket ? [{ value: 'parts' as const, label: tx().market.partsTab }] : []),
          ]}
          value={parts ? 'parts' : 'resources'}
          onChange={(kind) => {
            on.click();
            on.setUi({ marketKind: kind });
          }}
        />
        <span class="hub-spacer" />
        <span class="hub-toolbar-label">{tx().market.quantity}</span>
        <Segmented
          label={tx().market.quantity}
          options={QTY_MODES.map((q) => ({ value: q, label: q === 'max' ? tx().market.max : String(q) }))}
          value={p.ui.qty}
          onChange={(q) => {
            on.click();
            on.setQty(q);
          }}
        />
      </div>
      {parts ? (
        <>
          <div class="hub-toolbar">
            <span class="hub-toolbar-label">{tx().market.tier}</span>
            <Segmented
              label={tx().market.tier}
              options={([1, 2] as const).map((t) => ({ value: t, label: tx().tiers[t] }))}
              value={p.ui.partTier}
              onChange={(t) => {
                on.click();
                on.setUi({ partTier: t });
              }}
            />
          </div>
          <PartsMarket rows={p.partsMarket} ring={p.station.ring} qty={p.ui.qty} tier={p.ui.partTier} ship={p.shipGrid} on={on} />
        </>
      ) : (
        <>
      <div class="hub-toolbar">
        <span class="hub-toolbar-label">{tx().market.sellFrom}</span>
        <Segmented
          label={tx().market.sellFrom}
          options={[
            { value: 'ship' as const, label: tx().market.fromShip },
            { value: 'storage' as const, label: tx().market.fromStorage },
          ]}
          value={p.ui.sellFrom}
          onChange={(f) => {
            on.click();
            on.setSellFrom(f);
          }}
        />
      </div>
      <table class="hub-table">
        <thead>
          <tr>
            <th scope="col">{tx().market.resource}</th>
            <th scope="col" class="num">
              {tx().market.ship}
            </th>
            <th scope="col" class="num">
              {tx().market.storage}
            </th>
            <th scope="col" class="num">
              {tx().market.sellPrice}
            </th>
            <th scope="col" class="num">
              {tx().market.buyPrice}
            </th>
            <th scope="col">
              <span class="af-sr-only">{tx().market.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {RESOURCE_IDS.map((id) => {
            const demand = p.demand ?? null;
            const price = resourcePrice(id, p.station.ring, p.station.priceJitter[id]);
            const source = p.ui.sellFrom === 'ship' ? p.cargo[id] : p.storage.resources[id];
            const sell = sellQuantity(p.ui.qty, source);
            const buy = buyQuantity(p.ui.qty, p.credits, price.buy);
            const toStorage = sellQuantity(p.ui.qty, p.cargo[id]);
            const toShip = transferQuantity(p.ui.qty, p.storage.resources[id], free);
            // refined ore (M4c): sold first from the ship with its bonus; in storage it becomes ordinary ore
            const refined = p.refined?.[id] ?? 0;
            const fine = Math.floor(refined + 1e-9);
            const fromShip = p.ui.sellFrom === 'ship';
            const lost = refinedLost(p.cargo[id], refined, toStorage);
            const ws = tx().home.workshop;
            const quote =
              fromShip && fine >= 1 && sell !== null
                ? sellQuote({ resource: id, qty: sell === 'all' ? p.cargo[id] : sell, refined, demandLeft: demand?.resource === id ? demand.left : 0, unitSell: price.sell })
                : null;
            return (
              <tr key={id} data-testid={`market-${id}`}>
                <th scope="row">
                  <ResourceChip id={id} name />
                  {demand?.resource === id && (
                    <span class="af-label hub-demand" title={tx().goals.sector.effects.demand}>
                      {tx().goals.sector.names.demand} {formatPercent(Math.round(DEMAND_BONUS * 100), 0, true)} · {formatInt(Math.floor(demand.left))} {tx().units.unit}
                    </span>
                  )}
                  {fromShip && fine >= 1 && (
                    <span class="af-label ws-refined-tag" data-testid={`market-refined-${id}`}>
                      <Term tip={ws.marketRefinedTip(formatPercent(Math.round(refinedBonusAt(id, price.sell) * 100)))}>
                        {ws.marketRefined(formatInt(fine), formatPercent(Math.round(refinedBonusAt(id, price.sell) * 100), 0, true))}
                      </Term>
                    </span>
                  )}
                </th>
                <td class={`num${p.cargo[id] < 0.05 ? ' is-zero' : ''}`}>{formatAmount(p.cargo[id])}</td>
                <td class={`num${p.storage.resources[id] < 0.05 ? ' is-zero' : ''}`}>{formatAmount(p.storage.resources[id])}</td>
                <td class="num hub-price-sell">{demand?.resource === id && demand.left > 0 ? formatPrice(price.sell * (1 + DEMAND_BONUS)) : formatPrice(price.sell)}</td>
                <td class="num hub-price-buy">{formatPrice(price.buy)}</td>
                <td class="hub-actions">
                  <span class="hub-action-pair">
                    <Act
                      on={on}
                      size="sm"
                      testId={`sell-${id}`}
                      disabled={sell === null}
                      reason={tx().market.nothingToSell}
                      {...(quote !== null ? { hint: ws.sellHint(formatCredits(quote)) } : {})}
                      onClick={() => sell !== null && on.action({ type: 'sellResource', resource: id, qty: sell, from: p.ui.sellFrom })}
                    >
                      {tx().market.sell}
                    </Act>
                    <Act
                      on={on}
                      size="sm"
                      disabled={buy.qty === null}
                      reason={tx().market.notEnoughCredits}
                      onClick={() => buy.qty !== null && on.action({ type: 'buyResource', resource: id, qty: buy.qty })}
                    >
                      {tx().market.buy}
                    </Act>
                  </span>
                  <span class="hub-action-pair">
                    <Act
                      on={on}
                      size="sm"
                      variant="ghost"
                      disabled={toStorage === null}
                      reason={tx().market.nothingToMove}
                      {...(lost >= 0.05 ? { hint: ws.transferWarning(formatNumber(lost, 1, true)), class: 'ws-transfer-warn', testId: `transfer-warn-${id}` } : {})}
                      onClick={() => toStorage !== null && on.action({ type: 'transfer', resource: id, qty: toStorage, to: 'storage' })}
                    >
                      {tx().market.toStorage}
                    </Act>
                    <Act
                      on={on}
                      size="sm"
                      variant="ghost"
                      disabled={toShip === null}
                      reason={free <= 1e-9 ? tx().market.cargoFull : tx().market.nothingToMove}
                      onClick={() => toShip !== null && on.action({ type: 'transfer', resource: id, qty: toShip, to: 'ship' })}
                    >
                      {tx().market.toShip}
                    </Act>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="hub-note">{tx().market.boughtToStorage}</p>
        </>
      )}
    </div>
  );
}

function Service(p: Props) {
  const { on } = p;
  const ice = p.storage.resources.ice + p.cargo.ice;
  const q = refuelQuote({ fuel: p.fuel, capacity: p.fuelMax, ice, credits: p.credits, ring: p.station.ring, ...(p.fuelPrice !== undefined ? { unitPrice: p.fuelPrice } : {}) });
  const full = q.missing < 1e-9;
  const ten = Math.min(10, q.missing);
  return (
    <div class="hub-service">
      <Repairs
        view={p.repair}
        rowOk={p.repairRowOk}
        autoBuy={p.ui.repairAutoBuy}
        available={p.station.services.repair}
        on={{ ...on, setAutoBuy: (v) => on.setUi({ repairAutoBuy: v }) }}
      />
      <Seam />
      <section>
        <Heading>{tx().service.refuel}</Heading>
        <Panel material="screen" cut="md" class="hub-gauges">
          <Gauge kind="fuel" label={tx().hud.fuel} value={p.fuel} max={p.fuelMax} segments={30} />
        </Panel>
        <div class="hub-service-row">
          <div class="hub-service-text">
            <strong>{tx().service.fromIce}</strong>
            <span class="hub-dim">{tx().service.iceRate}</span>
          </div>
          <Act
            on={on}
            testId="refuel-ice"
            disabled={full || ice < 1e-9}
            reason={full ? tx().service.tankFull : tx().service.noIce}
            onClick={() => on.action({ type: 'refuel', source: 'ice', amount: 'full' })}
            aside={formatAmount(q.iceUsed)}
          >
            {tx().station.refuelIce}
          </Act>
        </div>
        <div class="hub-service-row">
          <div class="hub-service-text">
            <strong>{tx().service.forCredits}</strong>
            <span class="hub-dim">{tx().service.perUnit(formatPrice(q.unitPrice))}</span>
          </div>
          <span class="hub-row-buttons">
            <Act
              on={on}
              testId="refuel-full"
              disabled={full || !q.affordableFull}
              reason={full ? tx().service.tankFull : tx().service.notEnoughCredits}
              onClick={() => on.action({ type: 'refuel', source: 'credits', amount: 'full' })}
              aside={formatCredits(q.fullCost)}
            >
              {tx().service.full}
            </Act>
            <Act
              on={on}
              disabled={full || q.tenCost > p.credits}
              reason={full ? tx().service.tankFull : tx().service.notEnoughCredits}
              onClick={() => on.action({ type: 'refuel', source: 'credits', amount: ten })}
              aside={formatCredits(q.tenCost)}
            >
              {tx().service.plusTen}
            </Act>
          </span>
        </div>
        {p.emergency && (
          <div class="hub-service-row">
            <Act on={on} variant="primary" testId="refuel-emergency" onClick={() => on.action({ type: 'refuel', source: 'emergency', amount: 'full' })}>
              {tx().service.emergency}
            </Act>
          </div>
        )}
        <p class="hub-note">{tx().service.energy}</p>
      </section>
    </div>
  );
}

/**
 * Publishes where the hub's head with the tab rail ends as `--hub-head-bottom` on the UI root, so the
 * toast (a sibling layer) goes below it where the hub spans the whole width (the shipyard, hub.css).
 */
function useHeadBottom(ref: { current: HTMLDivElement | null }): void {
  useEffect(() => {
    const hub = ref.current;
    const root = hub?.parentElement;
    const tabs = hub?.querySelector('.hub-frame > .af-tabs') ?? hub?.querySelector('.hub-head');
    if (!hub || !root || !tabs || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--hub-head-bottom', `${Math.round(tabs.getBoundingClientRect().bottom - root.getBoundingClientRect().top)}px`);
    });
    observer.observe(tabs);
    const head = hub.querySelector('.hub-head');
    if (head) observer.observe(head);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--hub-head-bottom');
    };
  }, []);
}

/**
 * Whether the tab rail needs the short labels (`station.tabsShort`): the full ones are tried first and
 * swapped when they overflow the rail – eight tabs at home in English, a narrow window, a large UI
 * scale. A new tab set, language, hub width or loaded font tries the full labels again.
 */
function useShortTabs(ref: { current: HTMLDivElement | null }, key: string): boolean {
  // a resize or a loaded font: measure the full labels again
  const [epoch, setEpoch] = useState(0);
  const fit = `${key}#${epoch}`;
  // the fit the short labels were chosen for; any other fit renders the full labels first
  const [shortFor, setShortFor] = useState<string | null>(null);
  const short = shortFor === fit;
  // measured only when the fit changed (not on every hub render)
  useLayoutEffect(() => {
    const rail = ref.current?.querySelector<HTMLElement>('.hub-frame > .af-tabs');
    if (!short && rail && rail.scrollWidth > rail.clientWidth + 1) setShortFor(fit);
  }, [fit, short]);
  useEffect(() => {
    const hub = ref.current;
    if (!hub) return;
    let width = hub.clientWidth;
    let live = true;
    const again = () => {
      if (live) setEpoch((n) => n + 1);
    };
    void document.fonts?.ready.then(again);
    if (typeof ResizeObserver !== 'function') return () => void (live = false);
    const observer = new ResizeObserver(() => {
      if (hub.clientWidth === width) return;
      width = hub.clientWidth;
      again();
    });
    observer.observe(hub);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, []);
  return short;
}

export function StationHub(p: Props) {
  const { on, station } = p;
  const ref = useRef<HTMLDivElement>(null);
  useHeadBottom(ref);
  // docked: the shipyard, hangar, templates, Development and Board chunks in an idle moment (lazy.ts)
  useEffect(prefetchHubScreens, []);
  const depth = Math.min(4, Math.max(1, p.depth ?? station.ring));
  const yard = p.ui.tab === 'shipyard' ? p.shipyard : null;
  const listed = STATION_TABS.filter((tab) => tabListed(tab, station));
  const short = useShortTabs(ref, `${getLocale()}:${listed.length}`);
  const labels = short ? tx().station.tabsShort : tx().station.tabs;
  const tabs: TabDef<StationTab>[] = STATION_TABS.flatMap((tab, i) => {
    if (!tabListed(tab, station)) return [];
    const enabled = tabEnabled(tab, station);
    const label = labels[i];
    return {
      id: tab,
      label: tab === 'shipyard' && p.yardDirty ? <span class="hub-tab-dirty">{label}</span> : label,
      // in the editor the keys 1–9 pick parts from the palette
      keyHint: yard ? undefined : String(i + 1),
      disabled: !enabled,
      reason: enabled ? undefined : tx().station.tabUnavailable,
    };
  });
  return (
    <>
    <div ref={ref} class={`hub${yard ? ' hub--yard' : ''}${short ? ' hub--short-tabs' : ''}`} data-testid="station-hub" data-ring={station.ring}>
      <div class="hub-frame">
        <header class="hub-head">
          <div class="hub-ident">
            <div class="hub-kind">
              <RingBadge ring={depth} compact />
              <span>
                {tx().stationKinds[station.kind]} · {tx().station.ring(depth, tx().rings[depth - 1]!)}
              </span>
            </div>
            <h1 class="hub-name">{p.name}</h1>
          </div>
          {yard?.header && on.hangar && (
            <ShipHeader
              h={yard.header}
              on={{
                rename: (id, name) => on.hangar?.rename(id, name),
                openHangar: () => on.hangar?.open(),
                openTemplates: () => on.templates?.open(),
                click: on.click,
              }}
            />
          )}
          <Credits value={p.credits} testId="hub-credits" />
        </header>
        <TabRail
          tabs={tabs}
          active={p.ui.tab}
          label={p.name}
          testIdPrefix="tab-"
          onSelect={(tab) => {
            on.click();
            on.setTab(tab);
          }}
        />
        {yard ? (
          <Shipyard d={yard} on={on.shipyard} />
        ) : (
          <main class="hub-body af-on-plate">
            <div class="hub-page" key={p.ui.tab}>
              {p.ui.tab === 'overview' && <Overview {...p} />}
              {p.ui.tab === 'market' && <Market {...p} />}
              {p.ui.tab === 'crafting' && (
                <Crafting
                  rows={p.crafting}
                  tier={p.ui.craftTier}
                  selected={p.ui.craftKey}
                  count={p.ui.craftCount}
                  available={station.services.crafting}
                  ship={p.shipGrid}
                  on={{ ...on, setCraft: (patch) => on.setUi(patch), openShipyard: () => on.setTab('shipyard') }}
                />
              )}
              {p.ui.tab === 'service' && <Service {...p} />}
              {p.ui.tab === 'archive' && p.archive && on.explore && <Archive d={p.archive} on={on.explore} />}
              {p.ui.tab === 'development' && tabListed('development', station) && <Development d={p.development ?? null} on={on.development} click={on.click} />}
              {p.ui.tab === 'board' && p.board && (
                <Board
                  d={p.board}
                  view={p.ui.boardView}
                  from={p.shipPos ?? p.station.pos}
                  on={{ click: on.click, action: on.action, setBoardView: (v) => (on.setBoardView ? on.setBoardView(v) : on.setUi({ boardView: v })) }}
                />
              )}
            </div>
          </main>
        )}
        <footer class="hub-foot">
          {yard ? (
            <ShipyardActions d={yard} on={on.shipyard} />
          ) : (
            <span class="hub-keys">
              {splitKeyList(tx().station.keys(listed.length)).map((k) => (
                <KeyHint key={k.text} keys={k.keys} dark>
                  {k.text}
                </KeyHint>
              ))}
            </span>
          )}
          <Act on={on} variant={yard ? 'secondary' : 'primary'} size={yard ? 'md' : 'lg'} keyHint="F" testId="undock" onClick={on.undock}>
            {tx().station.undock}
          </Act>
        </footer>
      </div>
    </div>
    {/* outside the hub – a filter on the hub would confine the fixed overlay to its area */}
    {p.yardPrompt && <ShipyardPromptView prompt={p.yardPrompt} on={on.shipyard} loose={p.yardLoose ?? 0} />}
    {p.hangarOpen && p.hangar && on.hangar && <HangarModal v={p.hangar} stationName={p.name} on={bindHangar(on.hangar, () => on.click())} />}
    {p.overlays}
    </>
  );
}

export { tabEnabled };
