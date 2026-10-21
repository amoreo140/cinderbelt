// Live UI style guide (ui-kit.html): every component and state over a game background.
// both languages up front: the kit's language toggles switch synchronously
import '../i18n/allTexts';
import { AttentionRow, CannonReticle, FortressBand, TollBand, TractorLine } from './pirates/PirateHud';
import { render, type ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { priceList } from '../data/economy';
import { RESOURCE_IDS, type Cargo } from '../data/resources';
import { setLocale, tx } from '../i18n';
import { assetUrl } from '../render/assets/url';
import { stationById } from '../sim/world/stations';
import { Hud, type HudData } from './Hud';
import { MiningHeat } from './MiningHeat';
import { HitMarkers, SalvagePromptView, ShipStatus, ThreatBand } from './Combat';
import { gridOutline, type CombatHudView, type Silhouette, type SilhouetteCell } from '../game/combatView';
import { createGrid } from '../sim/ship/grid';
import type { PartId } from '../data/parts';
import { gridSilhouette } from '../game/fleet/hangarView';
import { SPEC_SHIPS_E2 } from '../sim/templates/testShips';
import type { ShipGrid } from '../sim/ship/types';
import { maxHp } from '../sim/ship/hp';
import { DesignGapCard, StationHub, type StationHubHandlers, type StationUiState } from './station/StationHub';
import { RestoreBand, type ShipyardHandlers } from './station/Shipyard';
import { CollisionBand } from './FlightAssist';
import { DockApproachView } from './DockApproach';
import { DOCK_RULES, DOCKING_COMPUTER_RULES, type DockCheck } from '../sim/station/dock';
import { homeStation } from '../sim/world/stations';
import { dockPrompt } from './stationHud';
import { ShipyardEditor } from '../game/shipyardEditor';
import { craftingRows, partsMarketRows, repairView } from '../game/stationView';
import { Simulation } from '../sim/Simulation';
import { shipyardContext } from '../sim/shipyard/design';
import { stationStorage } from '../sim/station/storage';
import { createStarterShip } from '../sim/ship/presets';
import { partInfo } from '../game/partInfo';
import { partStats } from '../game/shipyardView';
import { PartAbout, ShipEffect } from './station/PartInfo';
import { PartStatsLine } from './station/partStats';
import type { QtyMode } from './station/trade';
import { formatStationName } from './stationName';
import {
  Button,
  Credits,
  Gauge,
  Heading,
  Key,
  KeyHint,
  Lamp,
  Modal,
  Panel,
  PartChip,
  Readout,
  ResourceChip,
  RingBadge,
  Seam,
  Segmented,
  ShipSilhouette,
  TabRail,
  ToastView,
  TooltipLayer,
} from './theme';
import { PALETTE, RING_ACCENTS } from './theme/tokens';
import { KitCareer } from './board/KitCareer';
import { KitTraining } from './training/KitTraining';
import { KitDiscovery } from './discovery/KitDiscovery';
import { KitComms } from './comms/KitComms';
import { OdometerKit } from './theme/OdometerKit';
import { KitSectors } from './sectors/KitSectors';
import { KitHangar } from './station/HangarKit';
import { KitTemplates } from './station/TemplatesKit';
import { KitDevelopment } from './station/DevelopmentKit';
import { KitSitesMap } from './discovery/KitSitesMap';
import { KitMapPlan, MapDemoPage } from './discovery/KitMapPlan';
import { KitSites } from './sites/KitSites';
import { KitGuild } from './convoys/KitGuild';
import { KitShapes } from './station/ShapesKit';
import { KitWorkshop } from './workshop/WorkshopKit';
import './kit.css';

const SWATCHES: { name: keyof typeof PALETTE; role: string }[] = [
  { name: 'hull', role: 'hull plate' },
  { name: 'ink', role: 'text on a plate' },
  { name: 'band', role: 'structural band' },
  { name: 'screen', role: 'recessed display' },
  { name: 'trim', role: 'T1 trim, primary action' },
  { name: 'titan', role: 'T2 trim' },
  { name: 'glow', role: 'light, energy, focus' },
  { name: 'fuel', role: 'fuel' },
  { name: 'ok', role: 'OK signal' },
  { name: 'warn', role: 'warning' },
  { name: 'bad', role: 'error, critical' },
  { name: 'text', role: 'text on dark' },
];

const DIACRITICS = 'Ťažobný cech · Ľad · Výheň · ďalší · ôsmy · päť · Ŕ ĺ ľ ň ť ď ô ä 0O 1lI';

function Section({ title, note, children }: { title: string; note?: string; children: ComponentChildren }) {
  return (
    <Panel material="band" cut="lg" as="section" class="kit-section">
      <h2 class="kit-h2">{title}</h2>
      {note && <p class="kit-note">{note}</p>}
      {children}
    </Panel>
  );
}

function Row({ label, children, plate = false }: { label: string; children: ComponentChildren; plate?: boolean }) {
  return (
    <div class={`kit-row${plate ? ' kit-row--plate af-on-plate' : ''}`}>
      <span class="kit-row-label af-label">{label}</span>
      <div class="kit-row-body">{children}</div>
    </div>
  );
}

function Buttons({ plate }: { plate?: boolean }) {
  const noop = () => {};
  return (
    <>
      <Row label="Variants" plate={plate}>
        <Button variant="primary" onClick={noop}>
          Undock
        </Button>
        <Button onClick={noop}>Unload cargo</Button>
        <Button variant="ghost" onClick={noop}>
          → Storage
        </Button>
        <Button variant="danger" onClick={noop}>
          Delete game
        </Button>
      </Row>
      <Row label="Key and readout" plate={plate}>
        <Button variant="primary" size="lg" keyHint="F" onClick={noop}>
          Undock
        </Button>
        <Button keyHint="Enter" aside="10 cr" onClick={noop}>
          Confirm changes
        </Button>
        <Button variant="primary" aside="+412 cr" onClick={noop}>
          Sell all cargo
        </Button>
      </Row>
      <Row label="Unavailable" plate={plate}>
        <Button disabled reason="Nothing to sell" aside="+0 cr" onClick={noop}>
          Sell all cargo
        </Button>
        <Button variant="primary" disabled reason="Not enough credits: 1,960 cr needed" onClick={noop}>
          Buy
        </Button>
        <Button size="sm" variant="ghost" disabled reason="Cargo hold is full" onClick={noop}>
          → Ship
        </Button>
      </Row>
      <Row label="Small" plate={plate}>
        <Button size="sm" onClick={noop}>
          Sell
        </Button>
        <Button size="sm" onClick={noop}>
          Buy
        </Button>
        <Button size="sm" variant="ghost" onClick={noop}>
          → Storage
        </Button>
        <Button size="sm" variant="primary" onClick={noop}>
          Craft
        </Button>
      </Row>
    </>
  );
}

/**
 * Silhouette from a sketch (bow up): `k` cockpit, `o` intact T1, `O` intact T2, `w` < 60 %, `c` < 30 %,
 * `x` destroyed, `.` empty. Every character is a separate part.
 */
function mockSilhouette(rows: string[]): Silhouette {
  const cells: SilhouetteCell[] = [];
  const cols = Math.max(...rows.map((r) => r.length));
  const parts: Record<string, { partId: PartId; fraction: number; tier: 1 | 2 }> = {
    k: { partId: 'cockpit', fraction: 1, tier: 1 },
    o: { partId: 'armor', fraction: 1, tier: 1 },
    O: { partId: 'armor', fraction: 1, tier: 2 },
    w: { partId: 'engine', fraction: 0.45, tier: 1 },
    c: { partId: 'cargo', fraction: 0.18, tier: 1 },
    x: { partId: 'armor', fraction: 0, tier: 1 },
  };
  // `m`: lost against the blueprint (M3.8) – an empty socket; `K`: a T2 cockpit
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      const p =
        ch === 'm' ? { partId: 'armor' as PartId, fraction: 0, tier: 1 as const, missing: true } : ch === 'K' ? { partId: 'cockpit' as PartId, fraction: 1, tier: 2 as const } : parts[ch];
      if (p) cells.push({ x: rows.length - 1 - r, y: cols - 1 - c, part: cells.length + 1, ...p });
    }),
  );
  // hull outline (SL2 E1 T10) of the parts still on the ship – every sketch part is one cell
  const grid = createGrid(cells.filter((c) => !c.missing).map((c) => [c.partId, c.x, c.y, 0, c.tier]));
  return {
    outline: gridOutline(grid),
    cells,
    minX: 0,
    maxX: rows.length - 1,
    minY: 0,
    maxY: cols - 1,
    damaged: cells.filter((c) => c.fraction < 1 && !c.missing).length,
    missing: cells.filter((c) => c.missing).length,
  };
}

const SIL_FIGHTER = ['.oko.', 'OoOoO', 'wooow', '.c.o.'];
const SIL_HURT = ['.xkx.', 'OcOxO', 'wxowx', '.c.o.'];

function mockCombat(sil: Silhouette, patch: Partial<CombatHudView> = {}): CombatHudView {
  return {
    shield: { current: 38, max: 60, fraction: 38 / 60 },
    hull: { current: 412, max: 520, fraction: 412 / 520 },
    silhouette: sil,
    cannons: { total: 2, ready: 1 },
    threat: { nearby: 2, attacking: 2, nearest: { distance: 84, angle: 0.6 } },
    salvage: null,
    salvageHold: { 'cannon:1': 1 },
    destroyed: false,
    ...patch,
  };
}

const SIL_LOST = ['.mkm.', 'OoOoO', 'woooc', '.o.m.'];

/**
 * A shaped example ship (SL2 E2 U3) through the real view model; `hurt` damages a few shaped plates:
 * a wedge at 45 %, the nose 2×1 at 20 %, the port wing destroyed and the starboard wing lost against
 * the blueprint (an empty socket in its polygon).
 */
function shapedSilhouette(make: () => ShipGrid, hurt = false): Silhouette {
  const grid = make();
  if (!hurt) return gridSilhouette(grid, new Map());
  const find = (shape: string) => grid.parts.find((p) => p.shape === shape)!;
  const at = (shape: string, f: number): [number, number] => [find(shape).id, Math.round(maxHp(find(shape)) * f)];
  const hp = new Map<number, number>([at('wedge', 0.45), at('nose2x1', 0.2), at('wingL', 0)]);
  const lost = find('wingR').id;
  const flying = { ...grid, parts: grid.parts.filter((p) => p.id !== lost) };
  const s = gridSilhouette(grid, hp);
  const cells = s.cells.map((c) => (c.part === lost ? { ...c, fraction: 0, missing: true } : c));
  return { ...s, cells, damaged: 3, missing: 1, outline: gridOutline(flying) };
}

/** M3.8: lost parts against the blueprint, the collision warning and the restore to design. */
function FlightKit() {
  const noop = () => {};
  const lost = mockSilhouette(SIL_LOST);
  return (
    <Section
      title="Flight and damage"
      note="A part lost against the shipyard design is an empty socket with a dashed red outline (it flashes twice on loss). The ship status counts lost and damaged parts alike. The collision warning is a band above the ship: amber while there is time, red just before impact. Restore to design: a band above the hangar and a card in the Overview."
    >
      <div class="kit-combat">
        <Row label="Lost parts">
          <Panel material="screen" cut="sm" class="kit-sil">
            <ShipSilhouette silhouette={lost} width={120} height={96} maxCell={16} label="Ship with lost parts" />
          </Panel>
          <Panel material="band" cut="md" class="kit-status">
            <ShipStatus view={mockCombat(lost)} />
          </Panel>
        </Row>
        <Row label="Collision">
          <div class="kit-static">
            <CollisionBand c={{ time: 2.4, urgency: 0.2, dampersOff: true }} />
            <CollisionBand c={{ time: 0.8, urgency: 0.73, dampersOff: false }} />
          </div>
        </Row>
        <Row label="Docking">
          <div class="kit-static kit-dock">
            {KIT_DOCK.map((c, i) => {
              const p = dockPrompt(c, 'Vega Anchor')!;
              return (
                <div key={i} class="kit-dock-case">
                  <DockApproachView a={p.approach!} />
                  <span class={`hud-prompt hud-prompt--${p.kind}`}>{p.text}</span>
                </div>
              );
            })}
          </div>
        </Row>
        <Row label="Restore">
          <div class="kit-static kit-restore">
            <RestoreBand info={{ missing: { 'miningLaser:1': 1, 'armor:1': 2 }, missingCount: 3, damaged: 2, available: true, applied: false }} on={{ restoreDesign: noop } as unknown as ShipyardHandlers} />
            <RestoreBand info={{ missing: {}, missingCount: 3, damaged: 0, available: true, applied: true }} on={{} as ShipyardHandlers} />
          </div>
        </Row>
        <Row label="Overview" plate>
          <DesignGapCard
            gap={{ silhouette: lost, missing: { 'miningLaser:1': 1, 'armor:1': 2 }, missingCount: 3, damaged: 1, shipyard: true }}
            on={{ click: noop, restoreDesign: noop } as unknown as StationHubHandlers}
          />
        </Row>
      </div>
    </Section>
  );
}

/** M3.6: pirate attention, toll, tractor beam, fortress band and the cannon reticle. */
function PirateKit() {
  const raid = tx().pirates.attention.raid('Tyche II', '7:42');
  return (
    <Section
      title="Pirates and salvage"
      note="The Rust's attention is a quiet row in the navigation band (4 slanted segments, a raid with a blinking light). The toll is an amber warning band top centre, the fortress a band under the pirate warning. The tractor beam has a purple indicator in the console; at the cursor, the number of cannons that will hit the target."
    >
      <Row label="Attention">
        <Panel material="band" cut="md" class="kit-attention">
          <AttentionRow a={{ value: 12, level: 0, label: tx().pirates.attention.levels[0], hint: tx().pirates.attention.hint(12), raid: null }} />
          <AttentionRow a={{ value: 44, level: 1, label: tx().pirates.attention.levels[1], hint: tx().pirates.attention.hint(44), raid: null }} />
          <AttentionRow a={{ value: 71, level: 2, label: tx().pirates.attention.levels[2], hint: tx().pirates.attention.hint(71), raid: null }} />
          <AttentionRow a={{ value: 93, level: 3, label: tx().pirates.attention.levels[3], hint: tx().pirates.attention.hint(93), raid }} />
        </Panel>
      </Row>
      <Row label="Toll">
        <div class="kit-static">
          <TollBand t={{ amount: '1,250 cr', seconds: 14, fraction: 0.7, canPay: true, escape: 250 }} />
          <TollBand t={{ amount: '4,800 cr', seconds: 5, fraction: 0.25, canPay: false, escape: 250 }} />
        </div>
      </Row>
      <Row label="Tractor beam">
        <Panel material="band" cut="md" class="kit-tractor">
          <TractorLine t={{ active: false, text: tx().pirates.tractor.idle, progress: null }} />
          <TractorLine t={{ active: true, text: tx().pirates.tractor.holding(tx().pirates.container), progress: null }} />
          <TractorLine t={{ active: true, text: tx().pirates.tractor.ripping(62), progress: 0.62 }} />
        </Panel>
      </Row>
      <Row label="Fortress">
        <div class="kit-static">
          <FortressBand f={{ name: tx().pirates.fortressName(0), core: 1, shielded: true, gens: [true, false], turrets: [true, true, false, true] }} />
          <FortressBand f={{ name: tx().pirates.fortressName(1), core: 0.34, shielded: false, gens: [false, false], turrets: [false, true, false, false] }} />
        </div>
      </Row>
      <Row label="Cannons at the cursor">
        <div class="kit-static">
          <CannonReticle r={{ covering: 2, total: 3 }} />
          <CannonReticle r={{ covering: 0, total: 2 }} />
        </div>
      </Row>
    </Section>
  );
}

function CombatKit() {
  const salvage = { kind: 'wreck' as const, wreckId: 1, distance: 2.4, inRange: true, cargo: { iron: 12, copper: 4.5 }, parts: { 'shield:1': 1 } as const };
  return (
    <Section
      title="Combat"
      note="Ship silhouette with HP on the cells (fill height = part HP; amber < 60 %, red with a crack < 30 %, hatching = destroyed). Tier brackets from T2. Hits as arcs on the screen edge: shield a thin double arc, hull a thick red one with an arrowhead."
    >
      <div class="kit-combat">
        <Row label="Silhouette">
          <Panel material="screen" cut="sm" class="kit-sil">
            <ShipSilhouette silhouette={mockSilhouette(SIL_FIGHTER)} width={120} height={96} maxCell={16} label="Intact ship" />
          </Panel>
          <Panel material="screen" cut="sm" class="kit-sil">
            <ShipSilhouette silhouette={mockSilhouette(SIL_HURT)} width={120} height={96} maxCell={16} label="Damaged ship" />
          </Panel>
          <Panel material="screen" cut="sm" class="kit-sil">
            <ShipSilhouette silhouette={mockSilhouette(['..k..', '.ooo.', 'ooooo', 'o.o.o', 'o...o', '.www.'])} width={72} height={60} maxCell={9} gap={1} label="Compact" />
          </Panel>
        </Row>
        <Row label="Hull outline">
          <Panel material="screen" cut="sm" class="kit-sil" testId="kit-sil-hull-t2">
            <ShipSilhouette silhouette={mockSilhouette(['..K..', '.OOO.', 'OO.OO', 'OOOOO', '.w.w.'])} width={120} height={96} maxCell={16} label="T2 ship with a hole in the hull" />
          </Panel>
          <Panel material="screen" cut="sm" class="kit-sil">
            <ShipSilhouette silhouette={mockSilhouette(['.k.', 'ooo', 'ooo', 'ccc', 'ccc', 'ooo', 'w.w'])} width={72} height={60} maxCell={9} gap={1} label="Freighter (card)" />
          </Panel>
          <Panel material="screen" cut="sm" class="kit-sil">
            <ShipSilhouette silhouette={mockSilhouette(['..k..', '.ooo.', 'ooooo', 'o.o.o', 'o...o', '.www.'])} width={184} height={150} maxCell={24} gap={2} label="Black box" />
          </Panel>
        </Row>
        <Row label="Shapes (SL2 E2)">
          <Panel material="screen" cut="sm" class="kit-sil" testId="kit-sil-shapes-hud">
            <ShipSilhouette silhouette={shapedSilhouette(SPEC_SHIPS_E2.C)} width={120} height={96} maxCell={16} label="Halberd after E2 - HUD" />
          </Panel>
          <Panel material="screen" cut="sm" class="kit-sil" testId="kit-sil-shapes-hurt">
            <ShipSilhouette silhouette={shapedSilhouette(SPEC_SHIPS_E2.C, true)} width={120} height={96} maxCell={16} label="Halberd after E2 - damaged" />
          </Panel>
          <Panel material="screen" cut="sm" class="kit-sil" testId="kit-sil-shapes-hangar">
            <ShipSilhouette silhouette={shapedSilhouette(SPEC_SHIPS_E2.C)} width={84} height={84} maxCell={12} gap={1} label="Halberd after E2 - hangar card" />
          </Panel>
          <Panel material="screen" cut="sm" class="kit-sil" testId="kit-sil-shapes-template">
            <ShipSilhouette silhouette={shapedSilhouette(SPEC_SHIPS_E2.C)} width={64} height={56} maxCell={9} gap={1} label="Halberd after E2 - template card" />
          </Panel>
          <Panel material="screen" cut="sm" class="kit-sil" testId="kit-sil-shapes-kosa">
            <ShipSilhouette silhouette={shapedSilhouette(SPEC_SHIPS_E2.A)} width={120} height={96} maxCell={16} label="Scythe after E2" />
          </Panel>
          <Panel material="screen" cut="sm" class="kit-sil" testId="kit-sil-shapes-black-box">
            <ShipSilhouette silhouette={shapedSilhouette(SPEC_SHIPS_E2.C, true)} width={184} height={150} maxCell={24} gap={2} label="Halberd after E2 - black box" />
          </Panel>
        </Row>
        <Row label="Ship status">
          <Panel material="band" cut="md" class="kit-status">
            <ShipStatus view={mockCombat(mockSilhouette(SIL_HURT))} />
          </Panel>
          <Panel material="screen" class="kit-combat-gauges">
            <Gauge kind="shield" label={tx().combat.shield} value={38} max={60} warnAt={0.3} critAt={0.001} compact segments={24} />
            <Gauge kind="shield" label={`${tx().combat.shield} - depleted`} value={0} max={60} warnAt={0.3} critAt={0.001} compact segments={24} />
            <Gauge kind="hull" label={tx().combat.hull} value={412} max={520} warnAt={0.6} critAt={0.3} compact segments={24} />
            <Gauge kind="hull" label={`${tx().combat.hull} - critical`} value={120} max={520} warnAt={0.6} critAt={0.3} compact segments={24} />
          </Panel>
        </Row>
        <Row label="Warning">
          <div class="kit-static">
            <ThreatBand threat={mockCombat(mockSilhouette(SIL_FIGHTER)).threat} mode="alert" />
            <ThreatBand threat={mockCombat(mockSilhouette(SIL_FIGHTER)).threat} mode="compact" />
          </div>
        </Row>
        <Row label="Loot">
          <div class="kit-static">
            <SalvagePromptView salvage={salvage} />
            <SalvagePromptView salvage={{ ...salvage, inRange: false, distance: 14.2 }} />
            <SalvagePromptView salvage={{ ...salvage, kind: 'container', parts: {} }} />
            <SalvagePromptView salvage={{ ...salvage, kind: 'hulk', inRange: false, hulkParts: 9 }} />
          </div>
        </Row>
        <Row label="Hits">
          <div class="kit-hits">
            <HitMarkers
              now={1}
              view={{ width: 320, height: 150 }}
              hits={[
                { angle: 0.3, age: 0.1, intensity: 0.9, shield: true },
                { angle: Math.PI - 0.2, age: 0.2, intensity: 0.8, shield: false },
                { angle: -Math.PI / 2, age: 0.6, intensity: 0.5, shield: false },
              ]}
            />
          </div>
        </Row>
      </div>
    </Section>
  );
}

function mockHud(ring: number): HudData {
  const cargo: Cargo = { iron: 18.4, copper: 6, ice: 9.2, titanium: 0 };
  return {
    speed: 7.4,
    dampers: true,
    fuel: 22,
    fuelMax: 120,
    energy: 41,
    energyMax: 60,
    cargo,
    cargoMax: 130,
    ring,
    pos: { x: 412, y: -96 },
    angle: 0.6,
    radar: {
      range: 180,
      contacts: [
        { x: 40, y: 30, radius: 6, color: '#ff7a4d' },
        { x: -70, y: 52, radius: 9, color: '#8fe3ff' },
        { x: 95, y: -60, radius: 5, color: '#ffb84d' },
        { x: -20, y: -110, radius: 7, color: '#d9e2ff' },
      ],
      stations: [{ x: -150, y: 40, kind: 'home' }],
    },
    map: { open: false, explored: [], stations: [] },
    message: null,
    credits: 1240,
    prompt: { kind: 'ok', text: tx().docking.prompt('Vega Anchor') },
    nearest: { name: 'Vega Anchor', distance: 138 },
    arrow: null,
    helpOpen: false,
    combat: {
      view: mockCombat(mockSilhouette(SIL_FIGHTER), { salvage: null }),
      hits: [],
      now: 0,
      hullHit: null,
      threat: null,
    },
  };
}

/** Approach readout states for the kit: far, too fast, ready, the docking computer. */
const kitDock = (status: DockCheck['status'], distance: number, speed: number, deg: number, rules = DOCK_RULES): DockCheck => ({
  status,
  station: homeStation(),
  point: { x: 18, y: 0 },
  distance,
  speed,
  angle: (deg * Math.PI) / 180,
  rules,
});
const KIT_DOCK: DockCheck[] = [
  kitDock('tooFar', 14.2, 6.1, 72),
  kitDock('tooFast', 3.1, 4.4, 18),
  kitDock('ok', 1.6, 0.8, 9),
  kitDock('ok', 9.5, 4.2, 140, DOCKING_COMPUTER_RULES),
];

function HudDemo({ ring }: { ring: number }) {
  return (
    <div class="kit-screen" style={{ backgroundImage: `url(${assetUrl(`assets/skybox/ring${ring}_bg.webp`)})` }}>
      <Hud {...mockHud(ring)} />
    </div>
  );
}

/** Simulation for the hub demos: a docked start, some resources, a damaged engine. */
function demoSim(): Simulation {
  const sim = new Simulation({ seed: 1337 });
  const s = sim.state;
  s.credits = 1240;
  s.player.fuel = 74;
  Object.assign(s.player.cargo, { iron: 52.3, copper: 31, ice: 12.9, titanium: 0 });
  const engine = s.player.grid.parts.find((p) => p.partId === 'engine');
  if (engine) s.player.hp.set(engine.id, 10);
  return sim;
}

const noopYard: ShipyardHandlers = {
  select: () => {},
  setTier: () => {},
  toggleLayers: () => {},
  rotate: () => {},
  undo: () => {},
  redo: () => {},
  restore: () => {},
  cancel: () => {},
  commit: () => {},
  resetView: () => {},
  focus: () => {},
  setAcquire: () => {},
  pointer: () => {},
  wheel: () => {},
  click: () => {},
  promptConfirm: () => {},
  promptCancel: () => {},
};

function HubDemo() {
  const station = stationById(1337, 'home')!;
  const sim = useMemo(demoSim, []);
  const yard = useMemo(() => {
    const editor = new ShipyardEditor({
      stationId: station.id,
      ship: () => ({ grid: sim.state.player.grid, hp: sim.state.player.hp }),
      inventory: () => stationStorage(sim.state, station.id).parts,
      context: () => shipyardContext(sim.state, station),
    });
    editor.select('cargo:1');
    editor.pointerDown({ x: -2, y: 1 }, 'left');
    editor.pointerUp();
    return editor;
  }, [sim]);
  const [ui, setUi] = useState<StationUiState>({
    tab: 'overview',
    boardView: 'contracts',
    qty: 10,
    sellFrom: 'ship',
    welcome: false,
    marketKind: 'resources',
    partTier: 1,
    craftTier: 1,
    craftKey: 'cargo:1',
    craftCount: 1,
    repairAutoBuy: true,
  });
  const patch = (p: Partial<StationUiState>) => setUi((u) => ({ ...u, ...p }));
  const on: StationHubHandlers = {
    action: () => {},
    setTab: (tab) => patch({ tab }),
    setQty: (qty) => patch({ qty }),
    setSellFrom: (sellFrom) => patch({ sellFrom }),
    setUi: patch,
    undock: () => {},
    click: () => {},
    shipyard: noopYard,
  };
  const storage = stationStorage(sim.state, station.id);
  const p = sim.state.player;
  return (
    <div class="kit-screen kit-screen--dock" style={{ backgroundImage: `url(${assetUrl('assets/ui/menu_bg_1080.jpg')})` }}>
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
        partsMarket={partsMarketRows(station, storage.parts, sim.state.credits, ui.partTier)}
        crafting={craftingRows(sim.state, station, ui.craftTier)}
        repair={repairView(sim.state, station, ui.repairAutoBuy)}
        repairRowOk={{}}
        shipyard={
          ui.tab === 'shipyard'
            ? {
                view: yard.view(),
                tier: yard.tier,
                selected: yard.selected,
                rot: yard.rot,
                layers: true,
                ghostLabel: null,
                focusCode: null,
                committing: false,
                grab: false,
              }
            : null
        }
        yardPrompt={null}
        yardDirty={yard.dirty}
        on={on}
      />
    </div>
  );
}

/** Part explanations: glossary terms on stat labels, description, "On your ship" (full and compact). */
function PartInfoKit() {
  const ship = createStarterShip();
  const gyro = partInfo(ship, 'gyro:2');
  const laser = partInfo(ship, 'miningLaser:1', { draft: true });
  return (
    <Section
      title="Part explanation"
      note="A dotted underline = a term explained in the tooltip (mouse and focus). “On your ship”: before → after on the player's ship, Δ green better / red worse, the cost (mass, hull) quieter under the seam, at most one line."
    >
      <Panel material="plate" cut="md" class="kit-stack af-on-plate" style={{ maxWidth: '25rem', padding: '0.9rem 1rem' }}>
        <PartStatsLine stats={partStats('gyro:2')} />
        <PartAbout info={gyro} />
        <ShipEffect info={gyro} />
      </Panel>
      <Panel material="plate" cut="md" class="kit-stack af-on-plate" style={{ maxWidth: '15.5rem', padding: '0.6rem', marginTop: '0.75rem' }}>
        <PartAbout info={laser} compact />
        <ShipEffect info={laser} compact />
      </Panel>
    </Section>
  );
}

function Kit() {
  const [ring, setRing] = useState(1);
  const [tab, setTab] = useState<'a' | 'b' | 'c' | 'd'>('a');
  const [qty, setQty] = useState<QtyMode>(1);
  const [modal, setModal] = useState(false);
  return (
    <div class="kit af-root" data-ring={ring} data-testid="ui-kit">
      <div class="kit-bg" style={{ backgroundImage: `url(${assetUrl(`assets/skybox/ring${ring}_bg.webp`)})` }} />
      <header class="kit-head">
        <img class="kit-logo" src={assetUrl('assets/ui/logo_small.png')} alt="Cinderbelt" />
        <div class="kit-head-text">
          <h1 class="kit-h1">Jazyk trupu</h1>
          <p>
            UI style guide: light hull plates with an orange trim, dark structural bands and recessed displays. The rules are in the
            “Jazyk trupu” UI design spec.
          </p>
        </div>
        <div class="kit-ring-switch">
          <span class="af-label">Ring background and accent</span>
          <Segmented
            label="Ring"
            options={RING_ACCENTS.map((_, i) => ({ value: i + 1, label: `${i + 1} ${tx().rings[i]}` }))}
            value={ring}
            onChange={setRing}
          />
        </div>
      </header>

      <div class="kit-grid">
        <Section title="Materials" note="Containers have all four corners cut, controls only two opposite ones.">
          <div class="kit-materials">
            <Panel material="plate" trim="top" bolts class="kit-swatch-panel">
              <strong>Plate</strong>
              <span>dock screens, dialogs, map</span>
            </Panel>
            <Panel material="plate" trim="top" tier={2} bolts class="kit-swatch-panel">
              <strong>Plate T2</strong>
              <span>titanium-tier trim</span>
            </Panel>
            <Panel material="band" trim="left" class="kit-swatch-panel">
              <strong>Band</strong>
              <span>frame, headers, flight HUD</span>
            </Panel>
            <Panel material="screen" class="kit-swatch-panel">
              <strong>Display</strong>
              <span>gauges, numbers, map</span>
            </Panel>
          </div>
        </Section>

        <Section title="Colours" note="The palette comes from the models: hull, trims, bands, lights. Signal colours only on dark; on a plate, their dark variants.">
          <div class="kit-swatches">
            {SWATCHES.map((s) => (
              <div key={s.name} class="kit-color">
                <span class="kit-color-chip" style={{ background: PALETTE[s.name] }} />
                <span class="kit-color-name">{s.role}</span>
                <code>{PALETTE[s.name]}</code>
              </div>
            ))}
          </div>
          <Seam />
          <div class="kit-rings">
            {RING_ACCENTS.map((acc, i) => (
              <div key={i} class="kit-ring">
                <RingBadge ring={i + 1} />
                <code>
                  {acc.a} / {acc.b}
                </code>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Typography" note="Archivo (width axis 62-125 %) for headings, controls and template labels; Atkinson Hyperlegible Next for text and numbers (tabular figures).">
          <div class="kit-type">
            <div class="kit-type-display">Origin Base</div>
            <div class="kit-type-control">Quick actions · Sell all cargo</div>
            <div class="af-label kit-type-label">Fuel · Cargo · You sell for</div>
            <p class="kit-type-text">
              Fly out to mine resources in the home belt, sell them at the market and refuel. Bought resources go to the station storage.
            </p>
            <div class="kit-type-numbers">
              <Readout size="lg" value="12.4" unit="u/s" label="Speed" />
              <Readout value="1,240" unit="cr" label="Credits" />
              <Readout value="96.2" unit="/ 130" label="Cargo" />
            </div>
            <p class="kit-type-diacritics">{DIACRITICS}</p>
            <p class="kit-type-diacritics kit-type-diacritics--display">{DIACRITICS}</p>
          </div>
        </Section>

        <Section title="Buttons on a band" note="An unavailable button is hatched, stays focusable and the tooltip gives the reason (hover it).">
          <Buttons />
        </Section>

        <Panel material="plate" cut="lg" trim="top" bolts as="section" class="kit-section kit-section--plate">
          <h2 class="kit-h2">Buttons on a plate</h2>
          <Buttons plate />
          <Seam />
          <Row label="Switch" plate>
            <Segmented
              label="Quantity"
              options={([1, 10, 100, 'max'] as const).map((q) => ({ value: q, label: q === 'max' ? 'Max' : String(q) }))}
              value={qty}
              onChange={setQty}
            />
          </Row>
          <Row label="Chips" plate>
            <ResourceChip id="iron" amount={52.3} name tag />
            <ResourceChip id="titanium" amount={4} name tag />
            <PartChip partId="armor" tier={1} count={2} />
            <PartChip partId="engine" tier={2} count={1} />
          </Row>
        </Panel>

        <Section title="Keys">
          <Row label="Keycap">
            <Key>F</Key>
            <Key>Esc</Key>
            <Key>Enter</Key>
            <Key dark>1–5</Key>
            <KeyHint keys={['W', 'S']} dark>
              thrust forward / back
            </KeyHint>
            <KeyHint keys="M" dark>
              map
            </KeyHint>
          </Row>
        </Section>

        <Section title="Gauges" note="Segments like the markings on the edge of the hangar pad, ticks at quarters. Below 25 % a warning, below 10 % critical; cargo the other way round.">
          <Panel material="screen" class="kit-gauges">
            <Gauge kind="fuel" label="Fuel" value={92} max={120} />
            <Gauge kind="fuel" label="Fuel - low" value={26} max={120} />
            <Gauge kind="fuel" label="Fuel - critical" value={8} max={120} />
            <Gauge kind="energy" label="Energy" value={60} max={60} />
            <Gauge kind="cargo" label="Cargo" value={96.2} max={130} decimals={1} invert />
            <Gauge kind="cargo" label="Cargo - full" value={128} max={130} decimals={1} invert />
            <Gauge kind="hull" label="Hull" value={363} max={390} segments={30} />
            <Gauge kind="energy" label="Compact" value={40} max={60} compact segments={24} />
          </Panel>
          <Row label="Laser heat (veins)">
            <Panel material="band" class="kit-gauges">
              <MiningHeat m={{ heat: 1.6, heatMax: 4, overheated: false, bonus: 1.5, active: true }} />
              <MiningHeat m={{ heat: 3.2, heatMax: 4, overheated: false, bonus: 1.8, active: true }} />
              <MiningHeat m={{ heat: 2.4, heatMax: 4, overheated: true, bonus: null, active: true }} />
            </Panel>
          </Row>
          <Row label="Lamps">
            <span class="kit-lamps">
              <Lamp state="ok" /> OK <Lamp state="warn" /> warning <Lamp state="bad" /> error <Lamp state="info" /> info{' '}
              <Lamp state="off" /> off
            </span>
          </Row>
        </Section>

        <Section title="Credits, rings, resources">
          <Row label="Credits">
            <Credits value={250} />
            <Credits value={1240} />
            <Credits value={128450} />
          </Row>
          <Row label="Rings">
            {RING_ACCENTS.map((_, i) => (
              <RingBadge key={i} ring={i + 1} />
            ))}
          </Row>
          <Row label="Resources">
            {RESOURCE_IDS.map((id) => (
              <ResourceChip key={id} id={id} amount={12.5} tag />
            ))}
          </Row>
          <Row label="Parts T1 / T2">
            <PartChip partId="cockpit" tier={1} />
            <PartChip partId="cargo" tier={2} count={3} />
            <PartChip partId="miningLaser" tier={2} />
          </Row>
        </Section>

        <CombatKit />
        <FlightKit />
        <PirateKit />

        <Section title="Tabs" note="The active tab merges with the plate below it; a locked one is hatched with a padlock and a tooltip. The arrows ←/→ move the focus.">
          <div class="kit-tabs">
            <TabRail
              label="Tab sample"
              active={tab}
              onSelect={setTab}
              tabs={[
                { id: 'a', label: 'Overview', keyHint: '1' },
                { id: 'b', label: 'Market', keyHint: '2' },
                { id: 'c', label: 'Crafting', keyHint: '3', disabled: true, reason: 'Coming in a later version' },
                { id: 'd', label: 'Service', keyHint: '4' },
              ]}
            />
            <div class="kit-tabs-body af-on-plate">Content of tab “{tab}”</div>
          </div>
        </Section>

        <Section title="Toasts and tooltip">
          <div class="kit-stack">
            <ToastView kind="info" text="Station discovered: Lyra-12 Outpost (ring 2)" />
            <ToastView kind="ok" text="Sold (+412 cr)" />
            <ToastView kind="error" text="Not enough credits" />
            <div class="af-tip-layer kit-static-tip">Nothing to sell</div>
            <div class="af-tip-layer is-info kit-static-tip">Bought resources go to the station storage.</div>
          </div>
        </Section>

        <PartInfoKit />

        <Section title="Dialog" note="For a dangerous action the focus is on “Back”, the warning band is under the heading. Esc cancels.">
          <div class="kit-modals">
            <Modal inline title="Confirm ship changes?" confirmLabel="Confirm" cancelLabel="Back" confirmKey="Enter" cancelKey="Esc" onConfirm={() => {}} onCancel={() => {}}>
              Fitting 3 parts costs 30 cr. Removed parts go to the station storage.
            </Modal>
            <Modal inline tone="danger" title="Delete the game in slot 1?" confirmLabel="Delete" cancelLabel="Back" onConfirm={() => {}} onCancel={() => {}}>
              This cannot be undone.
            </Modal>
          </div>
          <Row label="Real window">
            <Button onClick={() => setModal(true)}>Open dialog</Button>
          </Row>
        </Section>
      </div>

      <KitCareer />
      <KitTraining />
      <KitDiscovery />
      <KitSectors />
      <KitComms />
      <KitHangar />
      <KitTemplates />
      <KitDevelopment />
      <KitSitesMap />
      <KitMapPlan />
      <KitSites />
      <KitGuild />
      <OdometerKit />
      <KitShapes />
      <KitWorkshop />

      <h2 class="kit-h2 kit-h2--screen">Flight HUD</h2>
      <HudDemo ring={ring} />
      <h2 class="kit-h2 kit-h2--screen">Station hub</h2>
      <HubDemo />

      {modal && (
        <Modal tone="danger" title="Delete the game in slot 1?" confirmLabel="Delete" cancelLabel="Back" onConfirm={() => setModal(false)} onCancel={() => setModal(false)}>
          This cannot be undone.
        </Modal>
      )}
      <TooltipLayer />
    </div>
  );
}

const root = document.getElementById('kit');
// `?mapdemo` (M4d T12): the full-screen map with fake route / notes / Guild data (`&short`, `&locked`, `&lang=en`)
const query = new URLSearchParams(location.search);
if (query.get('lang') === 'en') setLocale('en');
if (root) render(query.has('mapdemo') ? <MapDemoPage short={query.has('short')} locked={query.has('locked')} /> : <Kit />, root);
