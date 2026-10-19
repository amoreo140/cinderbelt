// Combat HUD (M3b): ship state in the console (silhouette with HP, cannons, damage) and overlays during
// combat – hit indicators at the edge, an edge flash on a hull hit, the pirate warning and the prompt to
// load salvage. The data come from combatHudView (src/game/combatView.ts).
import { parsePartKey, type PartInventory, type PartKey } from '../data/parts';
import { tx } from '../i18n';
import { RESOURCE_IDS, type Cargo } from '../data/resources';
import type { CombatHudView, HitIndicator } from '../game/combatView';
import { HIT_INDICATOR_TIME } from '../game/combatView';
import { formatParts } from '../game/shipyardView';
import { partIconPath } from '../render/assets/catalog';
import { assetUrl } from '../render/assets/url';
import { cannonPips, hitMarker, screenBearing, shipStatusLine } from './combatHud';
import { formatAmount } from './format';
import { splitShortKeyLabel } from './keyLabel';
import { Key, Lamp, Panel, PartChip, Readout, ResourceChip, ShipSilhouette } from './theme';
// after the theme – screen rules win over the component base
import './combat.css';

export interface CombatHudData {
  view: CombatHudView;
  /** Fading hit direction indicators (HitTracker). */
  hits: HitIndicator[];
  /** UI game clock (s) – moment of the hit = now − age. */
  now: number;
  /** Last hull hit: sequence number (restarts the edge flash) and age in seconds. */
  hullHit: { seq: number; age: number } | null;
  /** Pirate warning: the full band after `enemyAlert`, then the compact one. */
  threat: 'alert' | 'compact' | null;
}

const t = () => tx().combat;

/** Size of the silhouette in the console (px). */
const SIL_BOX = { width: 120, height: 96 };

// ---------------------------------------------------------------------------
// console: ship state

/** Ship silhouette in a recessed display + cannons and the number of damaged parts (left console column). */
export function ShipStatus({ view }: { view: CombatHudView }) {
  const { silhouette, cannons } = view;
  const pips = cannonPips(cannons);
  const status = shipStatusLine(silhouette, view.hull.fraction);
  const missing = silhouette.missing ?? 0;
  return (
    <div class="cb-status" data-testid="ship-status">
      <Panel material="screen" cut="sm" class="cb-sil-screen">
        <span class="cb-bow" aria-hidden="true" />
        <ShipSilhouette
          silhouette={silhouette}
          width={SIL_BOX.width}
          height={SIL_BOX.height}
          maxCell={16}
          label={missing > 0 ? `${t().ship}: ${status.text}. ${tx().flight.status.missingHint}` : t().ship}
          testId="ship-silhouette"
        />
      </Panel>
      <div class="cb-status-lines">
        <span
          class={`cb-damage${status.lamp !== 'ok' ? ' is-damaged' : ''}${missing > 0 ? ' is-missing' : ''}`}
          data-testid="damaged-parts"
          data-missing={missing}
          title={missing > 0 ? tx().flight.status.missingHint : undefined}
        >
          <Lamp state={status.lamp} />
          {status.text}
        </span>
        {pips.length > 0 && (
          <span class="cb-cannons" data-testid="cannons-ready">
            <span class="af-label">{t().cannons}</span>
            <span class="cb-pips" role="meter" aria-valuemin={0} aria-valuemax={cannons.total} aria-valuenow={cannons.ready} aria-label={t().cannons}>
              {pips.map((on, i) => (
                <i key={i} class={on ? 'is-on' : ''} />
              ))}
            </span>
            <b>
              {cannons.ready}
              <small> / {cannons.total}</small>
            </b>
          </span>
        )}
        <SalvageHold parts={view.salvageHold} />
      </div>
    </div>
  );
}

/** Salvage on board (parts from wrecks) – one row: icons of the first parts and the count; the list in the
 *  tooltip. On landing they go into the station storage. */
export function SalvageHold({ parts }: { parts: PartInventory }) {
  const entries = (Object.entries(parts) as [PartKey, number][]).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const list = `${formatParts(parts)}. ${t().salvageHoldHint}.`;
  return (
    <div class="cb-hold" data-testid="salvage-hold" title={list}>
      <span class="af-label">{t().salvageHold}</span>
      <span class="cb-hold-icons" aria-hidden="true">
        {entries.slice(0, 3).map(([key]) => {
          const { partId, tier } = parsePartKey(key);
          return <img key={key} class={`af-tier-${tier}`} src={assetUrl(partIconPath(partId, tier))} alt="" />;
        })}
      </span>
      <b>×{total}</b>
      <span class="af-sr-only">{list}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// overlays

function LootChips({ cargo, parts }: { cargo: Partial<Cargo>; parts: PartInventory }) {
  const res = RESOURCE_IDS.filter((r) => (cargo[r] ?? 0) > 0.05);
  const items = (Object.entries(parts) as [PartKey, number][]).filter(([, n]) => n > 0);
  if (res.length === 0 && items.length === 0) return null;
  return (
    <span class="cb-loot">
      {res.map((r) => (
        <ResourceChip key={r} id={r} amount={cargo[r]} tag />
      ))}
      {items.map(([key, n]) => {
        const { partId, tier } = parsePartKey(key);
        return <PartChip key={key} partId={partId} tier={tier} count={n} compact />;
      })}
    </span>
  );
}

/** Prompt at a wreck with salvage: in range "F – load salvage", otherwise
 *  "fly closer". */
export function SalvagePromptView({ salvage }: { salvage: NonNullable<CombatHudView['salvage']> }) {
  const container = salvage.kind === 'container';
  const key = splitShortKeyLabel(container ? tx().pirates.prompts.container : t().salvagePrompt);
  // a hulk is too big to load: cut it with the laser or rip a loose part out with the tractor (M3.6)
  if (salvage.kind === 'hulk') {
    return (
      <div class="hud-prompt hud-prompt--warn cb-salvage" data-testid="salvage-prompt" data-kind="hulk" data-in-range={String(salvage.distance <= 0)} role="status">
        <span>{tx().pirates.prompts.hulk(salvage.hulkParts ?? 0)}</span>
        <LootChips cargo={{}} parts={salvage.parts} />
      </div>
    );
  }
  if (!salvage.inRange) {
    return (
      <div class="hud-prompt hud-prompt--info cb-salvage" data-testid="salvage-prompt" data-in-range="false" role="status">
        <span>{container ? tx().pirates.prompts.containerApproach(formatAmount(salvage.distance)) : t().salvageApproach(formatAmount(salvage.distance))}</span>
        <LootChips cargo={salvage.cargo} parts={salvage.parts} />
      </div>
    );
  }
  return (
    <div class="hud-prompt hud-prompt--ok cb-salvage" data-testid="salvage-prompt" data-in-range="true" data-kind={salvage.kind} role="status">
      {key?.keys.map((k) => (
        <Key key={k}>{k}</Key>
      ))}
      <span>{key?.text ?? t().salvagePrompt}</span>
      <LootChips cargo={salvage.cargo} parts={salvage.parts} />
    </div>
  );
}

/** The "Pirates!" band with warning stripes; then a compact readout of the attackers. */
export function ThreatBand({ threat, mode }: { threat: CombatHudView['threat']; mode: 'alert' | 'compact' }) {
  const count = threat.attacking > 0 ? t().attackers(threat.attacking) : t().nearby(Math.max(1, threat.nearby));
  return (
    <div class={`cb-threat cb-threat--${mode}`} role={mode === 'alert' ? 'alert' : 'status'} data-testid="pirate-alert" data-mode={mode}>
      {mode === 'alert' && <span class="cb-threat-title">{t().alert}</span>}
      <span class="cb-threat-info">
        <Lamp state="bad" />
        <span>{count}</span>
        {threat.nearest && (
          <span class="cb-threat-nearest">
            <span class="cb-threat-sep" aria-hidden="true" />
            {t().nearest}
            <Readout value={Math.round(threat.nearest.distance)} unit={tx().hud.distanceUnit} />
            <i class="cb-bearing" style={{ transform: `rotate(${screenBearing(threat.nearest.angle)}rad)` }} aria-hidden="true" />
          </span>
        )}
      </span>
    </div>
  );
}

/** Hit indicators at the screen edge – an arc in the direction of the shooter. Hull: a thick red arc
 *  with an outward arrow; shield: a double thin arc in the shield colour. */
export function HitMarkers({ hits, now, view }: { hits: readonly HitIndicator[]; now: number; view: { width: number; height: number } }) {
  // a salvo can hit in the same step from the same direction – put the index of identical hits into the key
  const seen = new Map<string, number>();
  return (
    <svg class="cb-hits" width={view.width} height={view.height} viewBox={`0 0 ${view.width} ${view.height}`} aria-hidden="true">
      {hits.map((h) => {
        const m = hitMarker(h.angle, view, 64);
        // key = moment of the hit, so the fade animation runs smoothly across re-renders
        const base = `${(now - h.age).toFixed(3)}:${h.angle.toFixed(3)}`;
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const key = `${base}:${n}`;
        const kind = h.shield ? 'shield' : 'hull';
        return (
          <g
            key={key}
            class={`cb-hit cb-hit--${kind}`}
            data-testid="hit-marker"
            data-kind={kind}
            transform={`translate(${m.x.toFixed(1)} ${m.y.toFixed(1)}) rotate(${((m.rotation * 180) / Math.PI).toFixed(1)})`}
            style={{
              opacity: Math.max(0, Math.min(1, h.intensity)),
              animationDuration: `${HIT_INDICATOR_TIME}s`,
              animationDelay: `${-h.age}s`,
            }}
          >
            {h.shield ? (
              <>
                <path class="cb-hit-arc" d="M-4 -30 Q8 0 -4 30" />
                <path class="cb-hit-arc cb-hit-arc--inner" d="M-11 -24 Q-1 0 -11 24" />
              </>
            ) : (
              <>
                <path class="cb-hit-shadow" d="M-4 -34 Q10 0 -4 34" />
                <path class="cb-hit-arc" d="M-4 -34 Q10 0 -4 34" />
                <path class="cb-hit-tip" d="M8 -8 L20 0 L8 8 Z" />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Combat overlays above the flight HUD. */
export function CombatOverlay({ d, view, dockPromptOk }: { d: CombatHudData; view: { width: number; height: number }; dockPromptOk: boolean }) {
  const { salvage, threat } = d.view;
  return (
    <>
      {d.hullHit && d.hullHit.age < 0.45 && <div key={d.hullHit.seq} class="cb-vignette" aria-hidden="true" />}
      <HitMarkers hits={d.hits} now={d.now} view={view} />
      {d.threat && <ThreatBand threat={threat} mode={d.threat} />}
      {salvage && !dockPromptOk && <SalvagePromptView salvage={salvage} />}
    </>
  );
}
