// Edge arrows as HUD marks: a coloured chevron (or an elongated needle) at the screen edge, an optional
// label towards the centre, a count when several things merged into one arrow, and an arc across the
// directions of a merged pack. Placement comes from `placeEdgeArrows` / `groupEdgeArrows`
// (edgeArrows.ts); used by the scanner's finds (R6), the hostile pirates (R2) and the navigation marks
// (M4d: the planned route, map notes, convoys, Guild relays – `navArrows`), which add an icon to the
// label and, for a mark in view, a pin at the point instead of an arrow.
import { assetUrl } from '../render/assets/url';
import { sameEdgeArrow } from './hudMemo';
import { pure } from './pure';
import type { EdgeArrow } from './stationHud';
import './edgeArrows.css';

export interface EdgeArrowMark extends EdgeArrow {
  key: string;
  /** CSS colour of the chevron and the label's stripe. */
  color: string;
  label?: string | null;
  /** Merged things (a badge from 2 up). */
  count?: number;
  /** Opacity 0..1 (fading marks). */
  alpha?: number;
  /** A smaller chevron (secondary marks). */
  small?: boolean;
  /** Head shape: the chevron (default) or an elongated needle (threats). */
  shape?: 'chevron' | 'needle';
  /** Size multiplier of the head (e.g. by proximity). */
  scale?: number;
  /** 0..1 – a bright flash over the head (e.g. the pirate just fired at me). */
  flash?: number;
  /** A merged pack: the angular width (rad) of the arc drawn across its directions. */
  arc?: number;
  /** An icon in the label (an asset path under public/, e.g. a map note's SVG). */
  icon?: string;
  /** In view: a pin at the point (a small diamond and the label above it) instead of the edge arrow. */
  pin?: boolean;
  testId?: string;
}

/** Radius of a pack's arc (px) – it bulges outwards like the screen edge. */
const ARC_RADIUS = 110;

function arcPath(span: number): string {
  // the arc's length follows the pack's angular width, within readable limits
  const half = Math.min(120, Math.max(34, span * 120));
  const t = half / ARC_RADIUS;
  const x = (-ARC_RADIUS + ARC_RADIUS * Math.cos(t)).toFixed(1);
  const y = (ARC_RADIUS * Math.sin(t)).toFixed(1);
  return `M${x} -${y} A${ARC_RADIUS} ${ARC_RADIUS} 0 0 1 ${x} ${y}`;
}

/** Label offset from the tip towards the screen centre (horizontally by about half its width). */
const labelOffset = (angle: number): { left: string; top: string } => ({
  left: `${-Math.cos(angle) * (26 + 58 * Math.abs(Math.cos(angle)))}px`,
  top: `${-Math.sin(angle) * 26}px`,
});

/** A mark in view: a diamond on the point, the label (icon + text) above it. */
function Pin({ a }: { a: EdgeArrowMark }) {
  return (
    <div
      class="af-edge-pin"
      style={{ left: `${Math.round(a.x)}px`, top: `${Math.round(a.y)}px`, opacity: a.alpha ?? 1, '--edge-arrow': a.color }}
      data-testid={a.testId}
      aria-hidden="true"
    >
      <i class="af-edge-pin-dot" />
      {(a.label || a.icon) && (
        <div class="af-edge-arrow-label af-edge-pin-label">
          {a.icon && <img class="af-edge-arrow-icon" src={assetUrl(a.icon)} alt="" />}
          {a.label && <span class="af-edge-arrow-text">{a.label}</span>}
        </div>
      )}
    </div>
  );
}

/** An edge arrow: the chevron or needle at the edge, its label, count and a pack's arc. */
function Arrow({ a }: { a: EdgeArrowMark }) {
  return (
    <div
      class={`af-edge-arrow${a.small ? ' is-small' : ''}${a.shape === 'needle' ? ' is-needle' : ''}`}
      style={{ left: `${Math.round(a.x)}px`, top: `${Math.round(a.y)}px`, opacity: a.alpha ?? 1, '--edge-arrow': a.color }}
      data-testid={a.testId}
      data-count={a.count ?? 1}
      data-flash={(a.flash ?? 0) > 0 ? '1' : '0'}
      aria-hidden="true"
    >
      {a.arc !== undefined && (
        <svg class="af-edge-arrow-arc" viewBox="-130 -130 260 260" style={{ transform: `rotate(${a.angle}rad)` }}>
          <path class="af-edge-arrow-arc-shadow" d={arcPath(a.arc)} />
          <path class="af-edge-arrow-arc-line" d={arcPath(a.arc)} />
        </svg>
      )}
      <div class="af-edge-arrow-head" style={{ transform: `rotate(${a.angle}rad)${a.scale !== undefined ? ` scale(${a.scale.toFixed(2)})` : ''}` }}>
        {(a.flash ?? 0) > 0 && <div class="af-edge-arrow-flash" style={{ opacity: (a.flash ?? 0).toFixed(2) }} />}
      </div>
      {(a.label || (a.count ?? 1) > 1) && (
        <div class="af-edge-arrow-label" style={labelOffset(a.angle)}>
          {(a.count ?? 1) > 1 && <span class="af-edge-arrow-count">{a.count}×</span>}
          {a.icon && <img class="af-edge-arrow-icon" src={assetUrl(a.icon)} alt="" />}
          {a.icon ? <span class="af-edge-arrow-text">{a.label}</span> : a.label}
        </div>
      )}
    </div>
  );
}

// Each mark redraws only when it looks different (hudMemo.ts: whole pixels, ~0.5°): one arrow moving
// along the edge does not redraw the others.
const samePart = (a: { a: EdgeArrowMark }, b: { a: EdgeArrowMark }): boolean => sameEdgeArrow(a.a, b.a);
const ArrowPart = pure(Arrow, samePart);
const PinPart = pure(Pin, samePart);

export function EdgeArrowLayer({ arrows }: { arrows: readonly EdgeArrowMark[] }) {
  if (arrows.length === 0) return null;
  return <>{arrows.map((a) => (a.pin ? <PinPart key={a.key} a={a} /> : <ArrowPart key={a.key} a={a} />))}</>;
}
