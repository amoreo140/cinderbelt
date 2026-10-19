// Style guide (ui-kit.html), M4d T12: the map's route planner, notes, stale marks and Guild layer – a glyph
// sheet drawn by the game's functions (mapGuild.ts), the route readout (fuel enough / short with risks),
// the note editor and the tool row in their states, and a full-screen map demo with fake data
// (`ui-kit.html?mapdemo` [&lang=en] [&short]) that plans routes and keeps notes like the game would.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { NOTES, type NoteIcon } from '../../data/navigation';
import { routePlan } from '../../game/map/routePlan';
import type { MapGuildData, MapNoteView, MapPlanHandlers, RoutePlanData, StaleMark } from '../../game/map/types';
import type { MapDiscovery, MapLayer } from '../../game/discovery/exploreUi';
import { summarizeShip } from '../../game/partEffect';
import { getLocale, onLocaleChange, setLocale, tx, type Locale } from '../../i18n';
import { assetUrl } from '../../render/assets/url';
import type { Vec2 } from '../../sim/math/vec2';
import { NO_SECURITY_OVERRIDES } from '../../sim/regions/world';
import { sectorIdAt, sectorInfo } from '../../sim/regions/sectors';
import { createStarterShip } from '../../sim/ship/presets';
import { CHUNK_SIZE } from '../../sim/world/generate';
import { homeStation } from '../../sim/world/stations';
import { drawComet, SITE_COLORS } from '../canvasDraw';
import { formatStationName } from '../stationName';
import { Key, Panel, Segmented, TooltipLayer } from '../theme';
import { drawMapIcon, drawMapRoute, drawStalePirates, onMapIconLoad, relayIcon } from './mapGuild';
import type { MapSectorsData } from './mapSectors';
import { tailAngle } from './mapSites';
import { MapView, NoteEditor, RoutePanel, type MapStation, type MapTarget } from './MapView';
import './kitMapPlan.css';

const SEED = 1337;
const SHIP: Vec2 = { x: 1500, y: -700 };
const ship = summarizeShip(createStarterShip());

/** Re-renders a kit part after a language switch (the kit itself renders once). */
function useLocale(): Locale {
  const [locale, set] = useState(getLocale());
  useEffect(() => onLocaleChange(set), []);
  return locale;
}

function LocaleSwitch() {
  const locale = useLocale();
  return (
    <span class="kit-map-lang">
      <span class="af-label">Sample language</span>
      <Segmented
        label="Language"
        options={[
          { value: 'sk' as const, label: 'SK' },
          { value: 'en' as const, label: 'EN' },
        ]}
        value={locale}
        onChange={(l) => setLocale(l)}
      />
    </span>
  );
}

const sectorsData = (explored: ReadonlySet<string>): MapSectorsData => ({
  seed: SEED,
  overrides: NO_SECURITY_OVERRIDES,
  knowledge: (id) => sectorInfo(SEED, id)?.startKnowledge ?? 'uncharted',
  coverage: (id) => (id === sectorIdAt(SEED, SHIP.x, SHIP.y) ? 0.4 : null),
  version: 'kit',
  explored,
  current: sectorIdAt(SEED, SHIP.x, SHIP.y),
});

const routeOf = (to: Vec2, label: string, fuel: number, fuelMult = 1): RoutePlanData =>
  routePlan({
    from: SHIP,
    to,
    label,
    ship,
    fuel,
    options: { fuelMult },
    sectors: { ...sectorsData(new Set()), coverage: () => null },
  });

const guildFake = (): MapGuildData => ({
  convoys: [
    { pass: 'cv:A@12', pos: { x: 3300, y: 1300 }, heading: 0.35, lane: 'A', open: true, eta: 134 },
    { pass: 'cv:B@9', pos: { x: -3900, y: 2500 }, heading: 2.6, lane: 'B', open: false },
  ],
  relays: [
    { pos: { x: 5200, y: -2700 }, lane: 'A', stage: 'broken', known: true },
    { pos: { x: -5600, y: -1500 }, lane: 'B', stage: 'secured', known: true },
    { pos: { x: 9000, y: 6000 }, lane: 'A', stage: 'broken', known: false },
  ],
  watch: [
    { pos: { x: 700, y: 2300 }, kind: 'frigate' },
    { pos: { x: 820, y: 2190 }, kind: 'cutter' },
  ],
});

const notesFake = (): MapNoteView[] => [
  { id: 1, pos: { x: 2600, y: -2300 }, icon: 'ore', text: 'Ti vein 140%' },
  { id: 2, pos: { x: -2200, y: 900 }, icon: 'star', text: 'Quiet spot for ice mining' },
  { id: 3, pos: { x: 4300, y: 2900 }, icon: 'pirate', text: 'The Rust lurks behind the rocks' },
  { id: 4, pos: { x: -1200, y: -2600 }, icon: 'warning', text: 'Minefield - go around' },
  { id: 5, pos: { x: 600, y: 3500 }, icon: 'flag', text: 'Meeting the convoy here, at midnight!!' },
];

const staleFake = (): StaleMark[] => [
  { pos: { x: 3900, y: -900 }, kind: 'pirates', ageSeconds: 190, alpha: 0.77 },
  { pos: { x: -3100, y: -2900 }, kind: 'pirates', ageSeconds: 520, alpha: 0.35 },
  { pos: { x: -4600, y: 600 }, kind: 'comet', ageSeconds: 300, alpha: 0.62 },
];

/** The full-screen demo: the real map with fake M4d data; routes and notes work like in the game. */
export function MapDemoPage({ short = false, locked = false }: { short?: boolean; locked?: boolean }) {
  useLocale();
  const explored = useMemo(() => {
    const keys: string[] = [];
    for (let cx = -5; cx <= 5; cx++) for (let cy = -4; cy <= 4; cy++) if (Math.hypot(cx, cy) <= 5.2) keys.push(`${cx},${cy}`);
    return keys;
  }, []);
  const [layers, setLayers] = useState<Record<MapLayer, boolean>>({ stations: true, signals: true, places: true, contracts: true, fields: true, sectors: true, convoys: true, notes: true });
  const [target, setTarget] = useState<{ to: Vec2; label: string } | null>(() =>
    short ? { to: { x: 18000, y: 9000 }, label: tx().guild.route.point } : { to: { x: 5600, y: 1900 }, label: 'Cobalt 7' },
  );
  const [notes, setNotes] = useState<MapNoteView[]>(notesFake);
  const [next, setNext] = useState(6);
  const fuel = short ? 26 : 92;
  const route = target ? routeOf(target.to, target.label, fuel, short ? 1.3 : 1) : null;
  const plan: MapPlanHandlers = {
    route: (to, label) => setTarget({ to, label }),
    clearRoute: () => setTarget(null),
    noteSet: (n) => {
      if (n.id !== undefined) setNotes(notes.map((x) => (x.id === n.id ? { id: n.id, pos: n.pos, icon: n.icon, text: n.text } : x)));
      else if (notes.length < NOTES.max) {
        setNotes([...notes, { id: next, pos: n.pos, icon: n.icon, text: n.text }]);
        setNext(next + 1);
      }
    },
    noteDelete: (id) => setNotes(notes.filter((x) => x.id !== id)),
  };
  const home = homeStation();
  const stations: MapStation[] = [
    { pos: home.pos, name: formatStationName(home), kind: 'home' },
    { pos: { x: 5600, y: 1900 }, name: 'Cobalt 7', kind: 'station' },
    { pos: { x: -3300, y: -700 }, name: 'Lyra-48', kind: 'outpost' },
  ];
  const targets: MapTarget[] = [{ pos: { x: 5200, y: -2700 }, label: `${tx().guild.relay.name} · A` }];
  const discovery: MapDiscovery = { layers, signals: [], places: [] };
  const sectors = useMemo(() => sectorsData(new Set(explored)), [explored]);
  return (
    <div class="af-root kit-mapdemo" data-ring="1" data-testid="kit-mapdemo" style={{ backgroundImage: `url(${assetUrl('assets/skybox/ring1_bg.webp')})` }}>
      <MapView
        explored={explored}
        stations={stations}
        pos={SHIP}
        angle={0.6}
        targets={targets}
        fields={[
          { pos: { x: 2400, y: -1900 }, radius: 520, resource: 'titanium', depleted: false, grade: 1.4 },
          { pos: { x: -1800, y: 1300 }, radius: 640, resource: 'ice', depleted: false },
          { pos: { x: 300, y: -3200 }, radius: 420, resource: 'iron', depleted: true },
        ]}
        discovery={discovery}
        recenter={0}
        sectors={sectors}
        onToggleLayer={(l) => setLayers({ ...layers, [l]: !layers[l] })}
        guild={guildFake()}
        route={route}
        mapNotes={notes}
        stale={staleFake()}
        notesLocked={locked}
        plan={plan}
      />
      <TooltipLayer />
    </div>
  );
}

const SHEET = { w: 660, h: 120 };

/** The M4d map glyphs, drawn by the same functions as the map. */
function GlyphSheet() {
  const [loaded, setLoaded] = useState(0);
  useEffect(() => onMapIconLoad(() => setLoaded((n) => n + 1)), []);
  const locale = useLocale();
  useEffect(() => {
    const canvas = document.getElementById('kit-map-plan-sheet') as HTMLCanvasElement | null;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = SHEET.w * dpr;
    canvas.height = SHEET.h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#13283c';
    ctx.fillRect(0, 0, SHEET.w, SHEET.h);
    const y = 34;
    drawMapIcon(ctx, 'convoy', 30, y, 20, -0.35);
    drawMapIcon(ctx, 'convoy', 62, y, 20, -0.35, 0.6);
    drawMapIcon(ctx, 'guild_watch', 100, y, 18, -Math.PI / 2);
    drawMapIcon(ctx, 'guild_watch', 122, y, 15, -Math.PI / 2);
    drawMapIcon(ctx, relayIcon('broken'), 160, y, 16, 0, 0.6);
    drawMapIcon(ctx, relayIcon('repaired'), 186, y, 16);
    drawMapIcon(ctx, relayIcon('secured'), 212, y, 16);
    (['star', 'warning', 'ore', 'pirate', 'flag'] as NoteIcon[]).forEach((icon, i) => drawMapIcon(ctx, `note_${icon}`, 256 + i * 26, y, 18));
    [1, 0.6, 0.25].forEach((a, i) => drawStalePirates(ctx, 410 + i * 24, y, 7, a));
    ctx.save();
    ctx.globalAlpha = 0.6;
    drawComet(ctx, 545, y, 6, tailAngle({ x: 1, y: 1 }), SITE_COLORS.comet);
    ctx.restore();
    // a route that reaches and one that does not (the red part beyond the one-way range)
    const proj = (ox: number) => ({ toX: (x: number) => ox + x * 0.02, toY: (yy: number) => 92 - yy * 0.02, scale: 0.02, onScreen: () => false });
    const noop = () => {};
    drawMapRoute(ctx, { to: { x: 2600, y: 0 }, label: '', distance: 2600, seconds: 0, fuel: 0, fuelLeft: 0, short: null, risks: { pirate: 0, contested: 0, unknown: 0 }, rangeOneWay: 900, rangeRound: 450 }, { x: 0, y: 0 }, proj(30), []);
    drawMapRoute(ctx, { to: { x: 4800, y: 0 }, label: '', distance: 4800, seconds: 0, fuel: 0, fuelLeft: 0, short: 12, risks: { pirate: 0, contested: 0, unknown: 0 }, rangeOneWay: 3000, rangeRound: 1500 }, { x: 0, y: 0 }, proj(560 - 96), []);
    ctx.fillStyle = '#93a0b3';
    ctx.font = '600 10px sans-serif';
    ctx.textAlign = 'center';
    const m = tx().guild.map;
    for (const [x, t] of [
      [46, m.legendConvoy],
      [111, m.legendWatch],
      [186, m.legendRelay],
      [308, tx().guild.notes.title],
      [434, m.legendStalePirates],
      [545, m.staleComet],
    ] as const) {
      ctx.fillText(t, x, 62);
    }
  }, [loaded, locale]);
  return <canvas id="kit-map-plan-sheet" style={{ width: `${SHEET.w}px`, height: `${SHEET.h}px`, display: 'block' }} aria-hidden="true" />;
}

export function KitMapPlan() {
  useLocale();
  const okRoute = routeOf({ x: 5600, y: 1900 }, 'Cobalt 7', 92);
  const shortRoute = routeOf({ x: 18000, y: 9000 }, tx().guild.route.point, 26, 1.3);
  const nt = tx().guild.notes;
  const [draftNew, setDraftNew] = useState({ pos: { x: 0, y: 0 }, icon: 'star' as NoteIcon, text: '' });
  const [draftEdit, setDraftEdit] = useState({ id: 3, pos: { x: 0, y: 0 }, icon: 'pirate' as NoteIcon, text: 'The Rust lurks behind the rocks - Hammers and Wasp!!!' });
  const noop = () => {};
  return (
    <Panel material="band" cut="lg" as="section" class="kit-section" testId="kit-map-plan">
      <h2 class="kit-h2">Map - route, notes, stale marks, Guild layer (M4d)</h2>
      <p class="kit-note">
        A right click on the map (or “Route here” on a pinned sector card, on a target, on a note) plans a direct route: time, fuel for the current ship with its
        cargo, sectors with a risk on the way and range circles around the ship (dashed = one way, solid = there and back). The part of the route beyond the range is red. Notes:
        N = the tool, a click places one, a click on a note opens it; the player's text is just text. Stale pirate and comet marks fade over 10 minutes. The Guild layer: convoys
        (turned to their heading), Guild relays (known; lit once powered), Watch ships. The whole map with sample data:{' '}
        <a class="kit-map-link" href="?mapdemo">?mapdemo</a> · <a class="kit-map-link" href="?mapdemo&short">?mapdemo&amp;short</a> ·{' '}
        <a class="kit-map-link" href="?mapdemo&locked">?mapdemo&amp;locked</a>.
      </p>
      <LocaleSwitch />
      <GlyphSheet />
      <div class="kit-map-plan-row">
        <div class="kit-map-plan-cell">
          <RoutePanel route={okRoute} onClear={noop} />
        </div>
        <div class="kit-map-plan-cell">
          <RoutePanel route={shortRoute} onClear={noop} />
        </div>
      </div>
      <div class="kit-map-plan-row">
        <div class="kit-map-plan-cell kit-map-plan-editor">
          <NoteEditor draft={draftNew} onChange={(d) => setDraftNew({ ...draftNew, ...d })} onSave={noop} onCancel={noop} style={{ position: 'relative' }} autoFocus={false} />
        </div>
        <div class="kit-map-plan-cell kit-map-plan-editor">
          <NoteEditor
            draft={draftEdit}
            onChange={(d) => setDraftEdit({ ...draftEdit, ...d })}
            onSave={noop}
            onDelete={noop}
            onRoute={noop}
            onCancel={noop}
            style={{ position: 'relative' }}
            autoFocus={false}
          />
        </div>
        <div class="kit-map-plan-cell kit-map-plan-tools">
          <span class="mp-tool">
            <Key dark>N</Key> {nt.tool}
            <span class="mp-tool-count">{nt.count(5, NOTES.max)}</span>
          </span>
          <span class="mp-tool" aria-pressed="true">
            <Key dark>N</Key> {nt.toolActive}
            <span class="mp-tool-count">{nt.count(5, NOTES.max)}</span>
          </span>
          <span class="mp-tool mp-tool--locked">
            <Key dark>N</Key> {nt.locked}
          </span>
          <span class="mp-tool-hint">{tx().guild.route.hint}</span>
        </div>
      </div>
    </Panel>
  );
}
