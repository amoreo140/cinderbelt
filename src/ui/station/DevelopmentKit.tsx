// UI kit (ui-kit.html): the home station's Development tab (M4c "Development") in the real hub at 1280 × 720
// – module rows in every state, the paint shop with two ships, the trophy hall empty / with three
// trophies / full with pins – from kit fixtures, with a small local controller so the handlers work.
// The language switch re-renders the section in SK or EN.
import { useMemo, useState } from 'preact/hooks';
import { priceList } from '../../data/economy';
import { FORGE_INDEX_MAX, HOME_MODULE_IDS, HOME_MODULES, homeModuleIconPath, isBuildableModule, TROPHY_PEDESTALS, type HomeModuleId } from '../../data/home';
import type { PaintId } from '../../data/paints';
import type { PartKey } from '../../data/parts';
import { captainName, fortressLabel, partLabel } from '../../game/board/names';
import type { DevelopmentData, DevelopmentHandlers, ModuleRow, PaintShopShip, TrophyCard } from '../../game/home/types';
import { craftingRows, partsMarketRows, repairView } from '../../game/stationView';
import { getLocale, setLocale, tx, type Locale } from '../../i18n';
import { assetUrl } from '../../render/assets/url';
import type { TrophyId } from '../../sim/home/types';
import { Simulation } from '../../sim/Simulation';
import { stationStorage } from '../../sim/station/storage';
import { stationById } from '../../sim/world/stations';
import { formatCredits } from '../format';
import { formatStationName } from '../stationName';
import { Panel, Segmented } from '../theme';
import type { ShipyardHandlers } from './Shipyard';
import { StationHub, type StationHubHandlers, type StationUiState } from './StationHub';

type KitState = 'none' | 'paint' | 'hallEmpty' | 'hall3' | 'hallFull' | 'future';
const STATES: readonly KitState[] = ['none', 'paint', 'hallEmpty', 'hall3', 'hallFull', 'future'];
// kit-only labels of the fixture states (the style guide is a developer page, not the game)
const STATE_LABELS: Record<KitState, string> = {
  none: 'nothing built, 2 trophies waiting',
  paint: 'paint shop, 2 ships',
  hallEmpty: 'hall empty',
  hall3: 'hall, 3 trophies',
  hallFull: 'hall full, 2 pinned',
  future: 'future module',
};

const SEED = 1337;

interface KitHome {
  credits: number;
  owned: Set<HomeModuleId>;
  selected: HomeModuleId;
  ships: PaintShopShip[];
  selectedShip: number | null;
  preview: PaintId | null;
  trophies: number;
  pins: TrophyId[];
}

function initial(state: KitState): KitHome {
  const owned = new Set<HomeModuleId>(state === 'none' || state === 'future' ? [] : state === 'paint' ? ['paintShop'] : ['paintShop', 'trophyHall']);
  return {
    credits: state === 'none' ? 9_400 : 61_250,
    owned,
    selected: state === 'none' ? 'trophyHall' : state === 'paint' ? 'paintShop' : state === 'future' ? 'homeRefinery' : 'trophyHall',
    ships: [
      { shipId: 1, name: tx().fleet.names[0]!, where: 'docked', paint: 'factory' },
      { shipId: 2, name: 'Breaker', where: 'hangar', paint: 'racing' },
    ],
    selectedShip: null,
    preview: state === 'paint' ? 'navy' : null,
    trophies: state === 'none' ? 2 : state === 'hallEmpty' ? 0 : state === 'hall3' ? 3 : 8,
    pins: state === 'hallFull' ? ['cap:4', 'fort:0'] : [],
  };
}

const REPLICAS: PartKey[][] = [['engine:2'], ['cannon:2', 'shield:1'], [], ['miningLaser:2'], ['gyro:2'], [], ['reactor:2']];
const CLANS = ['rust', 'cauldron', 'slantedStar'] as const;

/** The kit's trophies: captains in defeat order, then two fortresses. */
function trophyCards(h: KitHome): TrophyCard[] {
  const out: TrophyCard[] = [];
  const captains = Math.max(0, h.trophies - (h.trophies >= 8 ? 2 : 0));
  for (let i = 0; i < captains; i++) {
    const replicas = (REPLICAS[i % REPLICAS.length] ?? []).map(partLabel);
    const id = `cap:${i}` as TrophyId;
    out.push({ id, title: captainName(SEED, i), subtitle: tx().home.trophy.captain(tx().goals.factions[CLANS[i % 3]!], replicas), replicas, pinned: h.pins.includes(id) });
  }
  if (h.trophies >= 8)
    for (const id of ['fort:0', 'fort:3'] as TrophyId[])
      out.push({ id, title: fortressLabel(id), subtitle: tx().home.trophy.fortress(id === 'fort:0' ? 'Kestrel-4' : 'Ardent-12'), replicas: [], pinned: h.pins.includes(id) });
  return out;
}

/** Shelf order like `trophyShelf`: pins, the newest unpinned captains, fortresses, empty pedestals. */
function shelf(cards: TrophyCard[], pins: TrophyId[]): (TrophyCard | null)[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out: (TrophyCard | null)[] = pins.map((id) => byId.get(id) ?? null).filter((c) => c !== null);
  const rest = cards.filter((c) => !c.pinned);
  out.push(...rest.filter((c) => c.id.startsWith('cap:')).reverse(), ...rest.filter((c) => c.id.startsWith('fort:')));
  while (out.length < TROPHY_PEDESTALS) out.push(null);
  return out.slice(0, TROPHY_PEDESTALS);
}

function rows(h: KitHome): ModuleRow[] {
  return HOME_MODULE_IDS.map((id) => {
    const def = HOME_MODULES[id];
    const row: ModuleRow = { id, name: tx().home.modules[id].name, effect: tx().home.modules[id].effect, credits: def.credits, state: 'buyable', icon: homeModuleIconPath(id) };
    if (def.resources) row.resources = { ...def.resources };
    if (!isBuildableModule(id)) {
      row.state = 'future';
      row.since = def.since!;
      row.reason = tx().home.status.comesWith(def.since!);
    } else if (h.owned.has(id)) row.state = 'owned';
    else if (h.credits < def.credits) row.reason = tx().home.status.missingCredits(formatCredits(def.credits - h.credits));
    return row;
  });
}

function kitData(h: KitHome): DevelopmentData {
  const cards = trophyCards(h);
  return {
    forgeIndex: 0,
    forgeMax: FORGE_INDEX_MAX,
    modules: rows(h),
    selected: h.selected,
    paintShop: h.owned.has('paintShop') ? { ships: h.ships, selectedShip: h.selectedShip ?? 1, preview: h.preview } : null,
    trophyHall: h.owned.has('trophyHall') ? { shelf: shelf(cards, h.pins), all: cards } : null,
    trophiesWithoutHall: h.owned.has('trophyHall') ? [] : cards,
  };
}

export function KitDevelopment() {
  const [lang, setLang] = useState<Locale>(getLocale());
  const [state, setState] = useState<KitState>('paint');
  return (
    <>
      <Panel material="band" cut="lg" as="section" class="kit-section" testId="kit-development">
        <h2 class="kit-h2">Home development (M4c)</h2>
        <p class="kit-note">
          The eighth tab, on the home station only: the Forge Index (7 segments), module rows (built / price / a hatched “Later”), the plate of the selected
          module with Build (confirmation), the Paint shop (ship, paints, a hover preview, Paint) and the Trophy hall (6 pedestals, a list with pinning).
          The arrows ↑/↓ in the rows, Enter builds. Data: the kit fixture (DevelopmentKit.tsx).
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
          </div>
        </div>
      </Panel>
      <DevelopmentHubDemo key={`${state}:${lang}`} state={state} lang={lang} />
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

/** The real station hub at home on the Development tab, driven by the kit controller. */
function DevelopmentHubDemo({ state, lang }: { state: KitState; lang: Locale }) {
  const station = stationById(SEED, 'home')!;
  const sim = useMemo(() => new Simulation({ seed: SEED }), []);
  const [home, setHome] = useState<KitHome>(() => initial(state));
  const [last, setLast] = useState('–');
  const patch = (p: Partial<KitHome>) => setHome((h) => ({ ...h, ...p }));
  const dev: DevelopmentHandlers = {
    select: (selected) => patch({ selected }),
    build: (m) => {
      setLast(`build(${m})`);
      setHome((h) => ({ ...h, credits: h.credits - HOME_MODULES[m].credits, owned: new Set([...h.owned, m]) }));
    },
    selectShip: (id) => patch({ selectedShip: id, preview: null }),
    preview: (preview) => patch({ preview }),
    paint: () => {
      setLast('paint()');
      setHome((h) => {
        const id = h.selectedShip ?? 1;
        return { ...h, preview: null, ships: h.ships.map((s) => (s.shipId === id && h.preview ? { ...s, paint: h.preview } : s)) };
      });
    },
    pin: (id, on) => {
      setLast(`pin(${id}, ${on})`);
      setHome((h) => ({ ...h, pins: on ? [...h.pins, id] : h.pins.filter((p) => p !== id) }));
    },
    focus: (m) => setLast(`focus(${m})`),
  };
  const ui: StationUiState = {
    tab: 'development',
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
    setTab: noop,
    setQty: noop,
    setSellFrom: noop,
    setUi: noop,
    undock: noop,
    click: noop,
    shipyard: NOOP_YARD,
    development: dev,
  };
  const storage = stationStorage(sim.state, station.id);
  const p = sim.state.player;
  return (
    <div
      class="kit-screen kit-screen--dock"
      style={{ backgroundImage: `url(${assetUrl('assets/ui/menu_bg_1080.jpg')})` }}
      data-testid={`kit-development-${state}`}
      data-lang={lang}
    >
      <code style={{ position: 'absolute', left: '16px', bottom: '12px', color: 'var(--af-text-dim)' }} data-testid="kit-development-last">
        {last}
      </code>
      <StationHub
        station={station}
        name={formatStationName(station)}
        credits={home.credits}
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
        partsMarket={partsMarketRows(station, storage.parts, home.credits, 1)}
        crafting={craftingRows(sim.state, station, 1)}
        repair={repairView(sim.state, station, true)}
        repairRowOk={{}}
        shipyard={null}
        yardPrompt={null}
        yardDirty={false}
        development={kitData(home)}
        on={hub}
      />
    </div>
  );
}
