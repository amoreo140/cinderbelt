// UI kit (ui-kit.html), section "Shapes" (SL2 E2 U2): shaped armour in the shipyard – the shape
// miniatures, the shape strip under the palette, the shaped ghost card with its tooltip, the hull budget in
// ½ points, the CHECK rows (loose contact, damaged reshape) and the key help (K). The strip keeps its
// shape in hand here; in the game the editor owns it (U1). The language switch re-renders the section.
import { useMemo, useState } from 'preact/hooks';
import type { Tier } from '../../data/parts';
import { SHAPE_IDS, type ShapeId } from '../../data/shapes';
import { buildShipyardView, shapeStrip, shapeTip, type HullView } from '../../game/shipyardView';
import { getLocale, setLocale, tx, type Locale } from '../../i18n';
import { assetUrl } from '../../render/assets/url';
import { Simulation } from '../../sim/Simulation';
import { createGrid } from '../../sim/ship/grid';
import { kosaE2 } from '../../sim/ship/specShips.testing';
import type { Rotation } from '../../sim/ship/types';
import { shipyardContext } from '../../sim/shipyard/design';
import { applyStroke, createDraft } from '../../sim/shipyard/draft';
import { stationById } from '../../sim/world/stations';
import { Panel, Segmented } from '../theme';
import { ShapeIcon } from '../theme/ShapeIcon';
import { GhostCard, HullBudget, ShapeStrip, Shipyard, YardHelp, type ShipyardHandlers, type ShipyardUiData } from './Shipyard';

const noop = () => {};
const NOOP_YARD: ShipyardHandlers = {
  select: noop,
  setTier: noop,
  toggleLayers: noop,
  rotate: noop,
  undo: noop,
  redo: noop,
  restore: noop,
  restoreDesign: noop,
  cancel: noop,
  commit: noop,
  resetView: noop,
  topView: noop,
  toggleMirror: noop,
  toggleMirrorAxis: noop,
  focus: noop,
  setAcquire: noop,
  pointer: noop,
  wheel: noop,
  click: noop,
  promptConfirm: noop,
  promptCancel: noop,
};

const CYCLE: readonly (ShapeId | null)[] = [null, ...SHAPE_IDS];

/** A hull budget sample through the game's own texts ("23½ / 48 pts · cockpit T2"). */
const hull = (used: number, budget: number, tier: Tier): HullView => ({
  label: tx().shipyard.ui.hull,
  points: tx().shipyard.ui.hullPoints(used, budget),
  cockpit: tx().shipyard.ui.hullCockpit(tier),
  used,
  budget,
  over: used > budget,
});

/** Cockpit + a cannon facing the bow (the ghost tooltip's arc line). */
const CANNON_SHIP = createGrid([
  ['cockpit', 0, 0],
  ['cannon', 1, 0],
]);

/** The kit's shipyard: "Kosa" after E2 with a loose wedge before the nose and a damaged nose tip reshaped. */
function useKitYard(shape: ShapeId | null, rot: Rotation, lang: Locale) {
  const base = useMemo(() => {
    const station = stationById(1337, 'home')!;
    const sim = new Simulation({ seed: 1337 });
    sim.state.credits = 1240;
    const ctx = shipyardContext(sim.state, station);
    // the nose tip (id 14) at half its HP
    const draft = createDraft('home', kosaE2(), new Map([[14, 10]]), { 'armor:1': 4, 'armor:2': 2 });
    const r = applyStroke(draft, [
      // a wedge in front of the nose tip touches it only with its point – the check warns
      { op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0, shape: 'wedge' },
      // a crafted reshape of the damaged nose tip to a shape with another max HP – the editor never
      // sends it (reshapeDamaged)
      { op: 'reshape', id: 14, shape: 'chamfer' },
    ]);
    return { draft: r.draft, ctx };
  }, []);
  // the language is read when the view is built; kit only: the shape rows first (Kosa also lacks side
  // engines – those warnings would push them below the fold of the fixed-height check list)
  const view = useMemo(() => {
    const v = buildShipyardView(base.draft, base.ctx, 1);
    const shapeRow = (code: string) => code === 'shapeLooseContact' || code === 'reshapeDamaged';
    return { ...v, messages: [...v.messages.filter((m) => shapeRow(m.code)), ...v.messages.filter((m) => !shapeRow(m.code))] };
  }, [base, lang]);
  // the ghost tooltip next to a cannon: a plate diagonal in front of it trims its arc, a wedge less
  const tip = shapeTip(CANNON_SHIP, { key: 'armor:1', x: 2, y: 1, rot, shape });
  const fullTip = shapeTip(CANNON_SHIP, { key: 'armor:1', x: 2, y: 1, rot, shape: null });
  return { view, tip: tip?.text ?? null, fullTip: fullTip?.text ?? null };
}

export function KitShapes() {
  const [lang, setLang] = useState<Locale>(getLocale());
  const [shape, setShape] = useState<ShapeId | null>('wedge');
  const [rot, setRot] = useState<Rotation>(0);
  const [tier, setTier] = useState<Tier>(1);
  const [last, setLast] = useState('–');
  const strip = shapeStrip(`armor:${tier}`, shape)!;
  const yard = useKitYard(shape, rot, lang);
  const on: ShipyardHandlers = {
    ...NOOP_YARD,
    selectShape: (s) => {
      setShape(s);
      setLast(`selectShape(${s === null ? 'null' : s})`);
    },
  };
  const armour = yard.view.palette.find((e) => e.key === `armor:${tier}`) ?? yard.view.palette.find((e) => e.partId === 'armor')!;
  const cannon = yard.view.palette.find((e) => e.partId === 'cannon')!;
  const d: ShipyardUiData = {
    view: yard.view,
    tier,
    selected: `armor:${tier}`,
    rot,
    layers: false,
    ghostLabel: null,
    focusCode: null,
    committing: false,
    grab: false,
    mirror: { on: true, half: false },
    // the restore band and the ghost card share the top right with the tools – they must not overlap
    restore: { missing: {}, missingCount: 0, damaged: 1, available: true, applied: false },
    shape,
    shapeTip: yard.tip,
    help: true,
  };
  return (
    <>
      <Panel material="band" cut="lg" as="section" class="kit-section" testId="kit-shapes" key={lang}>
        <h2 class="kit-h2">Shapes (SL2 E2)</h2>
        <p class="kit-note">
          Armour in hand → the shape strip under the palette: full + 9 miniatures in the hand's rotation, the active one = the shape in hand (click, ← / →, Tab in the hangar). The ghost shows points, HP and the
          change to the cannon arc within 2 cells. The hull counts in ½ points. Check: a shape held only by its tip, a damaged part reshaped in place. K = shipyard keys.
        </p>
        <div class="kit-row">
          <span class="kit-row-label af-label">Language · hand</span>
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
            <Segmented label="Tier" options={([1, 2] as const).map((t) => ({ value: t, label: `T${t}` }))} value={tier} onChange={setTier} />
            <Segmented label="Rotation" options={([0, 1, 2, 3] as const).map((r) => ({ value: r, label: `${r * 90}°` }))} value={rot} onChange={setRot} />
            <code data-testid="kit-shapes-last">{last}</code>
          </div>
        </div>
        <div class="kit-row kit-row--plate af-on-plate">
          <span class="kit-row-label af-label">Miniatures T1 · T2</span>
          <div class="kit-row-body" data-testid="kit-shape-icons">
            {CYCLE.map((s) => (
              <ShapeIcon key={`1${s}`} shape={s} rot={rot} tier={1} cell={22} label={s ?? 'full'} />
            ))}
            {CYCLE.map((s) => (
              <ShapeIcon key={`2${s}`} shape={s} rot={rot} tier={2} cell={22} label={s ?? 'full'} />
            ))}
          </div>
        </div>
        <div class="kit-row">
          <span class="kit-row-label af-label">Shape strip</span>
          <div class="kit-row-body" style={{ alignItems: 'flex-start' }}>
            <Panel material="plate" cut="md" trim="top" tier={tier} class="yd-palette" style={{ width: '17rem', flex: 'none' }} testId="kit-shape-strip">
              <ShapeStrip strip={strip} rot={rot} on={on} />
            </Panel>
            <Panel material="plate" cut="md" trim="top" tier={2} class="yd-palette" style={{ width: '17rem', flex: 'none' }}>
              <ShapeStrip strip={shapeStrip('armor:2', 'nose2x1')!} rot={1} on={{ click: noop }} />
            </Panel>
          </div>
        </div>
        <div class="kit-row">
          <span class="kit-row-label af-label">Ghost</span>
          <div class="kit-row-body" style={{ flexDirection: 'column', alignItems: 'flex-start' }} data-testid="kit-shape-ghosts">
            {[
              <GhostCard key="a" entry={armour} rot={rot} shape={shape} tip={yard.tip} />,
              <GhostCard key="b" entry={armour} rot={rot} shape={null} tip={yard.fullTip} />,
              <GhostCard key="c" entry={cannon} rot={rot} shape={null} />,
            ].map((card, i) => (
              <div key={i} class="yd-view" style={{ position: 'relative', width: '34rem', height: '3.4rem', cursor: 'default' }}>
                {card}
              </div>
            ))}
          </div>
        </div>
        <div class="kit-row">
          <span class="kit-row-label af-label">Hull in ½ points</span>
          <div class="kit-row-body" data-testid="kit-shape-hull">
            {[hull(23.5, 48, 2), hull(18.5, 28, 1), hull(28.5, 28, 1)].map((h, i) => (
              <Panel key={i} material="screen" cut="md" class="yd-stats" style={{ width: '16rem' }}>
                <HullBudget hull={h} />
              </Panel>
            ))}
          </div>
        </div>
        <div class="kit-row">
          <span class="kit-row-label af-label">Keys (K)</span>
          <div class="kit-row-body">
            <YardHelp />
          </div>
        </div>
      </Panel>
      <div class="kit-screen kit-screen--dock" style={{ backgroundImage: `url(${assetUrl('assets/ui/menu_bg_1080.jpg')})` }} data-testid="kit-shapes-yard">
        <div style={{ position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column' }}>
          <Shipyard d={d} on={on} />
        </div>
      </div>
    </>
  );
}
