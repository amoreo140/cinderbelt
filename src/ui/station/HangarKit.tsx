// UI kit (ui-kit.html): the M4a Hangar modal in its states, the Shipyard header and the hub overview
// row, drawn from the kit fixtures (hangarFixture.ts) until the game layer builds the real view
// models. The language switch here re-renders this section in SK or EN.
import { useMemo, useState } from 'preact/hooks';
import { priceList } from '../../data/economy';
import { ShipyardEditor } from '../../game/shipyardEditor';
import { craftingRows, partsMarketRows, repairView } from '../../game/stationView';
import { getLocale, setLocale, tx, type Locale } from '../../i18n';
import { assetUrl } from '../../render/assets/url';
import { Simulation } from '../../sim/Simulation';
import { shipyardContext } from '../../sim/shipyard/design';
import { stationStorage } from '../../sim/station/storage';
import { stationById } from '../../sim/world/stations';
import { formatStationName } from '../stationName';
import { Panel, Segmented } from '../theme';
import { HangarModal, type HangarOn } from './Hangar';
import { kitHangarView, kitShipHeader, type HangarKitState } from './hangarFixture';
import { hubHangarLine } from './hangarFormat';
import { ShipHeader, type ShipyardHandlers } from './Shipyard';
import { StationHub, type StationHubHandlers, type StationTab, type StationUiState } from './StationHub';

const STATES: readonly HangarKitState[] = ['fleet', 'first', 'loan', 'blocked'];
// kit-only labels of the fixture states (the style guide is a developer page, not the game)
const STATE_LABELS: Record<HangarKitState, string> = {
  fleet: '2 ships + a free + a locked slot',
  first: 'first slot',
  loan: 'Guild ship, low credits',
  blocked: 'training',
};

export function KitHangar() {
  const [lang, setLang] = useState<Locale>(getLocale());
  const [state, setState] = useState<HangarKitState>('fleet');
  const [last, setLast] = useState('–');
  const on: HangarOn = {
    open: () => setLast('open()'),
    close: () => setLast('close()'),
    switch: (id) => setLast(`switch(${id})`),
    newShip: (key, acquire) => setLast(`newShip(${key}, ${acquire ?? 'storage'})`),
    buySlot: () => setLast('buySlot()'),
    rename: (id, name) => setLast(`rename(${id}, ${name === null ? 'null' : JSON.stringify(name)})`),
    dismantle: (id) => setLast(`dismantle(${id})`),
  };
  const view = kitHangarView(state);
  const header = { rename: on.rename, openHangar: on.open, openTemplates: () => setLast('templates.open()') };
  return (
    <>
      <Panel material="band" cut="lg" as="section" class="kit-section" testId="kit-hangar">
        <h2 class="kit-h2">Hangar and fleet (M4a)</h2>
        <p class="kit-note">
          Ships as plates in rows: a silhouette in a display, the name (click = rename), the class and hull points, the log; gauges for condition / cargo / fuel; Switch and
          Dismantle with a reason. A free slot = a dashed outline, the next slot with a price or locked with hatching. Data: the kit fixture (hangarFixture.ts).
        </p>
        <div class="kit-row">
          <span class="kit-row-label af-label">Language · state</span>
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
            <Segmented label="State" options={STATES.map((s) => ({ value: s, label: STATE_LABELS[s] }))} value={state} onChange={setState} />
            <code data-testid="kit-hangar-last">{last}</code>
          </div>
        </div>
        <div class="kit-row">
          <span class="kit-row-label af-label">Shipyard header</span>
          <div class="kit-row-body" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <Panel material="band" cut="sm" style={{ display: 'flex', padding: '0.45rem 0.8rem' }} testId="kit-ship-header">
              <ShipHeader h={kitShipHeader()} on={header} />
            </Panel>
            <Panel material="band" cut="sm" style={{ display: 'flex', padding: '0.45rem 0.8rem' }}>
              <ShipHeader h={{ ...kitShipHeader(true), templatesReason: tx().actionErrors.templateCap }} on={header} />
            </Panel>
          </div>
        </div>
        <div class="kit-row kit-row--plate af-on-plate">
          <span class="kit-row-label af-label">Hub overview</span>
          <div class="kit-row-body">
            <div class="hub-list-row" style={{ flex: 1 }}>
              <span class="hub-list-label">{tx().fleet.hangar.overview.label}</span>
              <div class="hub-hangar-line">
                <span>{hubHangarLine(kitHangarView('fleet'))}</span>
              </div>
            </div>
          </div>
        </div>
      </Panel>
      <div class="kit-screen kit-screen--dock" style={{ backgroundImage: `url(${assetUrl('assets/ui/menu_bg_1080.jpg')})` }} data-testid="kit-hangar-screen">
        <div class="co-backdrop">
          <HangarModal key={`${state}:${lang}`} inline v={view} stationName={tx().stationNames.home} on={on} />
        </div>
      </div>
      <HangarHubDemo state={state} on={on} lang={lang} />
    </>
  );
}

const noop = () => {};
const NOOP_YARD: ShipyardHandlers = {
  select: noop,
  setTier: noop,
  toggleLayers: noop,
  rotate: noop,
  undo: noop,
  redo: noop,
  restore: noop,
  cancel: noop,
  commit: noop,
  resetView: noop,
  focus: noop,
  setAcquire: noop,
  pointer: noop,
  wheel: noop,
  click: noop,
  promptConfirm: noop,
  promptCancel: noop,
};

/** The real station hub with the fleet parts: the overview row, the Shipyard header, the modal over it. */
function HangarHubDemo({ state, on, lang }: { state: HangarKitState; on: HangarOn; lang: Locale }) {
  const station = stationById(1337, 'home')!;
  const sim = useMemo(() => new Simulation({ seed: 1337 }), []);
  const yard = useMemo(
    () =>
      new ShipyardEditor({
        stationId: station.id,
        ship: () => ({ grid: sim.state.player.grid, hp: sim.state.player.hp }),
        inventory: () => stationStorage(sim.state, station.id).parts,
        context: () => shipyardContext(sim.state, station),
      }),
    [sim],
  );
  const [tab, setTab] = useState<StationTab>('overview');
  const [open, setOpen] = useState(false);
  const ui: StationUiState = {
    tab,
    boardView: 'contracts',
    qty: 10,
    sellFrom: 'ship',
    welcome: false,
    marketKind: 'resources',
    partTier: 1,
    craftTier: 1,
    craftKey: null,
    craftCount: 1,
    repairAutoBuy: true,
  };
  const hub: StationHubHandlers = {
    action: noop,
    setTab,
    setQty: noop,
    setSellFrom: noop,
    setUi: noop,
    undock: noop,
    click: noop,
    shipyard: NOOP_YARD,
    hangar: { ...on, open: () => setOpen(true), close: () => setOpen(false) },
    templates: { open: noop },
  };
  const storage = stationStorage(sim.state, station.id);
  const p = sim.state.player;
  const view = kitHangarView(state);
  return (
    <div
      class="kit-screen kit-screen--dock"
      style={{ backgroundImage: `url(${assetUrl('assets/ui/menu_bg_1080.jpg')})` }}
      data-testid="kit-hangar-hub"
      data-lang={lang}
    >
      <StationHub
        station={station}
        name={formatStationName(station)}
        credits={sim.state.credits}
        cargo={{ ...p.cargo }}
        cargoMax={p.props.cargoCapacity}
        shipGrid={p.grid}
        fuel={p.fuel}
        fuelMax={p.props.fuelCapacity}
        energy={p.energy}
        energyMax={p.props.batteryCapacity}
        storage={{ resources: { ...storage.resources }, parts: { ...storage.parts } }}
        prices={priceList(station)}
        emergency={false}
        ui={ui}
        partsMarket={partsMarketRows(station, storage.parts, sim.state.credits, 1)}
        crafting={craftingRows(sim.state, station, 1)}
        repair={repairView(sim.state, station, true)}
        repairRowOk={{}}
        shipyard={
          tab === 'shipyard'
            ? {
                view: yard.view(),
                tier: yard.tier,
                selected: yard.selected,
                rot: yard.rot,
                layers: false,
                ghostLabel: null,
                focusCode: null,
                committing: false,
                grab: false,
                header: kitShipHeader(),
              }
            : null
        }
        yardPrompt={null}
        yardDirty={false}
        hangar={view}
        hangarOpen={open}
        on={hub}
      />
    </div>
  );
}
