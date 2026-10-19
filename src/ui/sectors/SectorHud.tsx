// Sectors in the flight HUD (sectors design §5.2, stage 1a): the badge top left (replaces the ring
// badge: knowledge glyph + name, security word in its colour + threat), the entry notice (a band with
// the security colour, 2.5 s) and the border arcs on the radar. The game layer (sectorsUi.ts) decides
// what to show; these components only draw it.
import type { Knowledge, Security } from '../../sim/regions/constants';
import type { Vec2 } from '../../sim/math/vec2';
import { tx } from '../../i18n';
import { withAlpha } from '../canvasDraw';
import { SECURITY_COLORS } from './sectorStyle';
import { SurveyDots } from './SectorCard';
import './sectors.css';

export interface SectorBadgeData {
  id: string;
  name: string;
  security: Security;
  /** "Pirate" – shown as a stencil label. */
  securityWord: string;
  /** "hrozba: hniezdo". */
  threat: string;
  knowledge: Knowledge;
  /** `[x] [?] [ ]`. */
  glyph: string;
  /** "depth 2 · Outer Belts" (tooltip). */
  depth: string;
  /** Survey points of the sector (stage 2) while it is not Charted: "points ●●○○". */
  survey?: { done: number; total: number };
}

export interface EntryNoticeData {
  /** Restarts the animation for a new notice. */
  seq: number;
  name: string;
  security: Security;
  securityWord: string;
  glyph: string;
  /** "Vstup". */
  entry: string;
}

export interface RadarSectorData {
  /** Where the borders' origin is relative to the ship now (u). */
  offset: Vec2;
  /** Smoothed border lines (x, y, x, y …, relative to the origin, world units). */
  groups: { security: Security; adjacent: boolean; lines: readonly (readonly number[])[] }[];
}

/** The badge in the navigation band. */
export function SectorBadge({ d }: { d: SectorBadgeData }) {
  return (
    <div class="sc-badge" data-security={d.security} data-testid="sector-badge" title={d.depth} aria-label={`${tx().sectors.hud.badge}: ${d.name}, ${d.securityWord}`}>
      <span class="sc-badge-head">
        <span class="sc-glyph" data-knowledge={d.knowledge}>
          {d.glyph}
        </span>
        <span class="sc-badge-name">{d.name}</span>
      </span>
      <span class="sc-badge-sub">
        <span class="sc-sec">{d.securityWord}</span>
        <span class="sc-badge-threat">· {d.threat}</span>
      </span>
      {d.survey && (
        <span class="sc-badge-survey" data-testid="sector-badge-survey">
          {tx().sectors.survey.badge} <SurveyDots done={d.survey.done} total={d.survey.total} />
        </span>
      )}
    </div>
  );
}

/** ENTERING · name · SECURITY [?] – a band with the security colour, fades out by itself (`static`: the UI kit). */
export function EntryNotice({ d, static: still = false }: { d: EntryNoticeData; static?: boolean }) {
  return (
    <div key={d.seq} class={`sc-notice${still ? ' is-static' : ''}`} data-security={d.security} role="status" data-testid={still ? undefined : 'sector-notice'}>
      <span class="sc-notice-kicker">{d.entry}</span>
      <span class="sc-notice-dot" aria-hidden="true">
        ·
      </span>
      <span class="sc-notice-name">{d.name}</span>
      <span class="sc-notice-dot" aria-hidden="true">
        ·
      </span>
      <span class="sc-sec">{d.securityWord}</span>
      <span class="sc-glyph">{d.glyph}</span>
    </div>
  );
}

/**
 * Border arcs on the radar (under every contact): borders of the ship's sector in the colour of the
 * sector across them, borders further away thin and faint. `s` = radar pixels per unit.
 */
export function drawRadarSectors(ctx: CanvasRenderingContext2D, d: RadarSectorData, half: number, r: number, s: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(half, half, r - 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ox = half + d.offset.x * s;
  const oy = half - d.offset.y * s;
  for (const g of d.groups) {
    const color = SECURITY_COLORS[g.security];
    ctx.beginPath();
    for (const line of g.lines) {
      ctx.moveTo(ox + line[0]! * s, oy - line[1]! * s);
      for (let k = 2; k < line.length; k += 2) ctx.lineTo(ox + line[k]! * s, oy - line[k + 1]! * s);
    }
    if (g.adjacent) {
      // a soft halo, then the line: reads as a band at the edge of the sector, not as a contact
      ctx.strokeStyle = withAlpha(color, 0.22);
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = withAlpha(color, 0.85);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    } else {
      ctx.strokeStyle = withAlpha(color, 0.35);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
}
