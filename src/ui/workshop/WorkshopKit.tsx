// UI kit (ui-kit.html): the on-board workshop (M4c T10) – the flight lamps RAF / OPR in every state with
// their tooltips, the part explanations of the three new parts and a new variant, the design check warning
// "explosive part next to the cockpit" and the market's refined-ore row in the real hub. Kit fixtures only;
// the language switch re-renders the section in SK or EN.
import { useMemo, useState } from 'preact/hooks';
import { priceList } from '../../data/economy';
import type { PartKey } from '../../data/parts';
import { emptyCargo } from '../../data/resources';
import { WORKSHOP_MIN_BATTERY, REFINED_BONUS } from '../../data/workshop';
import { partInfo } from '../../game/partInfo';
import { designMessages, partStats } from '../../game/shipyardView';
import { craftingRows, partsMarketRows, repairView } from '../../game/stationView';
import type { WorkshopLampsData } from '../../game/workshopView';
import { getLocale, setLocale, tx, type Locale } from '../../i18n';
import { assetUrl } from '../../render/assets/url';
import { Simulation } from '../../sim/Simulation';
import { createGrid } from '../../sim/ship/grid';
import { createStarterShip } from '../../sim/ship/presets';
import { evaluateDesign } from '../../sim/shipyard/design';
import { stationStorage } from '../../sim/station/storage';
import { stationById } from '../../sim/world/stations';
import { formatPercent } from '../format';
import { PartAbout, ShipEffect } from '../station/PartInfo';
import { PartStatsLine } from '../station/partStats';
import type { ShipyardHandlers } from '../station/Shipyard';
import { StationHub, type StationHubHandlers, type StationUiState } from '../station/StationHub';
import { formatStationName } from '../stationName';
import { Lamp, Panel, Segmented } from '../theme';
import { WorkshopLamps } from './WorkshopLamps';

const pct = (v: number): string => formatPercent(Math.round(v * 100));

/** The lamp fixtures: name (kit-only, English) and the view model in the current language. */
function lampFixtures(): [string, WorkshopLampsData][] {
  const w = tx().home.workshop;
  const bonus = pct(REFINED_BONUS);
  const min = pct(WORKSHOP_MIN_BATTERY);
  const refinedTip = w.refinedTip('Fe 42 · Ti 12', bonus);
  const repairing = w.repairing(`${tx().parts.armor} T1 (45 %)`);
  return [
    ['refinery: ice → fuel, repair running', { refinery: 'fuel', repair: 'working', refineryTip: w.refiningFuel('62 %'), repairTip: repairing, refined: 0, refinedTip: null }],
    ['refinery cleaning ore, 54 refined', { refinery: 'ore', repair: null, refineryTip: w.refiningOre(bonus), repairTip: null, refined: 54, refinedTip }],
    ['low energy', { refinery: 'idle', refineryReason: 'energy', repair: 'idle', repairReason: 'energy', refineryTip: w.idle.refineryEnergy(min), repairTip: w.idle.repairEnergy(min), refined: 54, refinedTip }],
    ['material missing', { refinery: 'idle', refineryReason: 'material', repair: 'idle', repairReason: 'material', refineryTip: w.idle.refineryMaterial, repairTip: w.idle.repairMaterial(tx().resources.iron.toLocaleLowerCase()), refined: 0, refinedTip: null }],
    ['nothing to do', { refinery: 'idle', refineryReason: 'nothing', repair: 'idle', repairReason: 'nothing', refineryTip: w.idle.refineryNothing, repairTip: w.idle.repairNothing, refined: 120, refinedTip }],
  ];
}

const PART_KEYS: readonly PartKey[] = ['largeReactor:1', 'repairModule:1', 'refinery:2', 'armor:1:light'];

export function KitWorkshop() {
  const [lang, setLang] = useState<Locale>(getLocale());
  const ship = createStarterShip();
  // a large reactor right behind the cockpit's corner: the design check warning
  const yard = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['largeReactor', 1, 0]]);
  const warning = designMessages(
    evaluateDesign({ base: { grid: yard, hp: new Map(), inventory: {} }, grid: yard, acquire: {} }, {
      ring: 1, services: { crafting: true, partsMarket: true }, credits: 0, storage: emptyCargo(), cargo: emptyCargo(), fuel: 0,
    }),
  ).find((m) => m.code === 'explosiveNearCockpit');
  return (
    <>
      <Panel material="band" cut="lg" as="section" class="kit-section" testId="kit-workshop" key={lang}>
        <h2 class="kit-h2">On-board workshop (M4c)</h2>
        <p class="kit-note">
          The RAF (refinery) and OPR (repair module) lamps to the right of the flight console: green is working, azure tops up fuel from ice, amber is stopped for
          energy or material, dark has nothing to do. The tooltip says what it does or why it is stopped. REFINED = whole refined units in the cargo. On the market: a tag under the resource, a hint at Sell and an amber band at → Storage when the transfer takes refined ore.
        </p>
        <div class="kit-row">
          <span class="kit-row-label af-label">Language</span>
          <div class="kit-row-body">
            <Segmented
              label="Language"
              options={[
                { value: 'sk' as const, label: 'SK' },
                { value: 'en' as const, label: 'EN' },
              ]}
              value={lang}
              onChange={(l) => {
                setLocale(l);
                setLang(l);
              }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          {lampFixtures().map(([label, d]) => (
            <div key={label} style={{ display: 'grid', gap: '0.3rem' }}>
              <span class="af-label">{label}</span>
              <div style={{ position: 'relative', width: '9.5rem', height: '5.2rem', '--cm-right': '0px', '--af-edge': '0px' }}>
                <WorkshopLamps d={d} />
              </div>
              <small class="kit-note" style={{ maxWidth: '14rem' }}>
                {d.refineryTip ?? ''} {d.repairTip ?? ''}
              </small>
            </div>
          ))}
        </div>
        <h3 class="kit-h2" style={{ marginTop: '1rem' }}>
          New parts and a variant
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          {PART_KEYS.map((key) => {
            const info = partInfo(ship, key);
            return (
              <Panel key={key} material="plate" cut="md" class="kit-stack af-on-plate" style={{ maxWidth: '25rem', padding: '0.9rem 1rem' }}>
                <span class="af-label">{key}</span>
                <PartStatsLine stats={partStats(key)} />
                <PartAbout info={info} />
                <ShipEffect info={info} />
              </Panel>
            );
          })}
        </div>
        <h3 class="kit-h2" style={{ marginTop: '1rem' }}>
          Design check
        </h3>
        {warning && (
          <p class="kit-note" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }} data-testid="kit-workshop-warning">
            <Lamp state="warn" />
            <span>{warning.text}</span>
          </p>
        )}
      </Panel>
      <MarketDemo key={`market:${lang}`} />
    </>
  );
}

const noop = () => {};
const NOOP_YARD: ShipyardHandlers = {
  select: noop, setTier: noop, toggleLayers: noop, rotate: noop, undo: noop, redo: noop, restore: noop, cancel: noop, commit: noop,
  resetView: noop, focus: noop, setAcquire: noop, pointer: noop, wheel: noop, click: noop, promptConfirm: noop, promptCancel: noop,
};

/** The real hub's market with 120 iron on the ship, 84 of it refined (sell row tag, sell hint, transfer warning). */
function MarketDemo() {
  const station = stationById(1337, 'home')!;
  const sim = useMemo(() => new Simulation({ seed: 1337 }), []);
  const [qty, setQty] = useState<StationUiState['qty']>(100);
  const ui: StationUiState = {
    tab: 'market', boardView: 'contracts', qty, sellFrom: 'ship', welcome: false, marketKind: 'resources',
    partTier: 1, craftTier: 1, craftKey: null, craftCount: 1, repairAutoBuy: true,
  };
  const hub: StationHubHandlers = { action: noop, setTab: noop, setQty, setSellFrom: noop, setUi: noop, undock: noop, click: noop, shipyard: NOOP_YARD };
  const storage = stationStorage(sim.state, station.id);
  const p = sim.state.player;
  const cargo = { ...emptyCargo(), iron: 120, copper: 18, titanium: 6 };
  const refined = { ...emptyCargo(), iron: 84, titanium: 6 };
  return (
    <div class="kit-screen kit-screen--dock" style={{ backgroundImage: `url(${assetUrl('assets/ui/menu_bg_1080.jpg')})` }} data-testid="kit-workshop-market">
      <StationHub
        station={station}
        name={formatStationName(station)}
        credits={12_400}
        cargo={cargo}
        cargoMax={p.props.cargoCapacity}
        refined={refined}
        shipGrid={p.grid}
        fuel={p.fuel}
        fuelMax={p.props.fuelCapacity}
        energy={p.energy}
        energyMax={p.props.batteryCapacity}
        storage={{ resources: { ...storage.resources }, parts: { ...storage.parts } }}
        prices={priceList(station)}
        emergency={false}
        ui={ui}
        partsMarket={partsMarketRows(station, storage.parts, 12_400, 1)}
        crafting={craftingRows(sim.state, station, 1)}
        repair={repairView(sim.state, station, true)}
        repairRowOk={{}}
        shipyard={null}
        yardPrompt={null}
        yardDirty={false}
        on={hub}
      />
    </div>
  );
}
