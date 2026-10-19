import { useId, useMemo, useRef } from 'preact/hooks';
import type { Silhouette } from '../../game/combatView';
import type { Vec2 } from '../../sim/math/vec2';
import { deepEqual, pure } from '../pure';
import { silhouetteLayout, silhouetteOutlinePath, silhouetteTier, type LayoutCell, type LayoutPart } from '../combatHud';

export interface ShipSilhouetteProps {
  silhouette: Silhouette;
  /** Largest box in px the ship fits into (cells shrink). */
  width: number;
  height: number;
  /** Largest cell in px. */
  maxCell?: number;
  gap?: number;
  /**
   * Loss replay (death card): the parts collapse into hatching one by one in the order they fell,
   * over `duration` ms. With reduced motion they are destroyed at once.
   */
  replay?: { order: readonly number[]; duration: number; delay?: number };
  /** Flash of a cell whose part just lost HP (ms). */
  pulseMs?: number;
  /** Red flash of a cell whose part was just lost (M3.8, ms). */
  lossMs?: number;
  label?: string;
  testId?: string;
}

/** Tier corner brackets around a part (T2: long blue corners). */
function bracketPath(b: LayoutPart, cell: number): string {
  const arm = Math.max(2, Math.round(cell * (b.tier === 2 ? 0.5 : 0.3)));
  const x0 = b.x + 0.5;
  const y0 = b.y + 0.5;
  const x1 = b.x + b.w - 0.5;
  const y1 = b.y + b.h - 0.5;
  return [
    `M${x0} ${y0 + arm}V${y0}H${x0 + arm}`,
    `M${x1 - arm} ${y0}H${x1}V${y0 + arm}`,
    `M${x0} ${y1 - arm}V${y1}H${x0 + arm}`,
    `M${x1 - arm} ${y1}H${x1}V${y1 - arm}`,
  ].join('');
}

/**
 * Width of the hull lip stroke in px for a cell size: a thin trim line on small cards, a firmer
 * lip on the HUD and the death card.
 */
export const lipWidth = (cell: number): number => Math.round(Math.min(2.5, Math.max(1, cell * 0.14)) * 4) / 4;

/** Cell polygon (`SilhouetteCell.poly`, cell units around the cell centre) in layout px: bow up, port left. */
function polyPx(poly: readonly Vec2[], c: Pick<LayoutCell, 'x' | 'y'>, cell: number): Vec2[] {
  const cx = c.x + cell / 2;
  const cy = c.y + cell / 2;
  return poly.map((v) => ({ x: cx - v.y * cell, y: cy - v.x * cell }));
}

/** The part of a convex px polygon below the line y = top (the HP fill rises from the stern edge). */
function below(poly: readonly Vec2[], top: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ina = a.y >= top;
    if (ina) out.push(a);
    if (ina !== b.y >= top) {
      const t = (top - a.y) / (b.y - a.y);
      out.push({ x: a.x + (b.x - a.x) * t, y: top });
    }
  }
  return out;
}

/** SVG `points` with at most two decimals. */
const points = (poly: readonly Vec2[]): string => poly.map((v) => `${Math.round(v.x * 100) / 100},${Math.round(v.y * 100) / 100}`).join(' ');

/**
 * The cell's area: the full square (`inset` px on each side, for strokes; negative grows it) or, for a
 * shaped cell, its polygon (SL2 E2 U3; the inset is left to the outline clip).
 */
function CellArea({ c, poly, cell, inset = 0, ...rest }: { c: LayoutCell; poly: readonly Vec2[] | undefined; cell: number; inset?: number; class?: string; fill?: string; style?: Record<string, string> }) {
  if (poly) return <polygon points={points(polyPx(poly, c, cell))} {...rest} />;
  return <rect x={c.x + inset} y={c.y + inset} width={cell - 2 * inset} height={cell - 2 * inset} {...rest} />;
}

/** The HP fill of a cell (px, at least 1): what the cell shows of its part's HP. */
const fillPx = (c: LayoutCell, cell: number): number => Math.max(1, Math.round(cell * Math.max(0, c.fraction)));

/** An intact cell: the well, the HP fill to its height, a crack when critical. */
function CellIntact({ c, poly, cell }: { c: LayoutCell; poly: readonly Vec2[] | undefined; cell: number }) {
  const lost = c.level === 'lost';
  const fill = fillPx(c, cell);
  const hpTop = c.y + cell - (lost ? cell : fill);
  return (
    <g class={`af-sil-cell is-${lost ? 'ok' : c.level}`} data-shaped={poly ? '' : undefined}>
      <CellArea class="af-sil-well" c={c} poly={poly} cell={cell} />
      {poly ? (
        <polygon class="af-sil-hp" points={points(below(polyPx(poly, c, cell), hpTop))} />
      ) : (
        <rect class="af-sil-hp" x={c.x} y={hpTop} width={cell} height={lost ? cell : fill} />
      )}
      {c.level === 'crit' && cell >= 6 && (
        <path class="af-sil-crack" d={`M${c.x + cell * 0.2} ${c.y + cell * 0.15}L${c.x + cell * 0.55} ${c.y + cell * 0.5}L${c.x + cell * 0.4} ${c.y + cell * 0.62}L${c.x + cell * 0.8} ${c.y + cell * 0.88}`} />
      )}
    </g>
  );
}

/** A destroyed part's cell: the hatching and a broken edge. */
function CellDestroyed({ c, poly, cell, hatch }: { c: LayoutCell; poly: readonly Vec2[] | undefined; cell: number; hatch: string }) {
  return (
    <g class="af-sil-cell is-lost">
      <CellArea c={c} poly={poly} cell={cell} fill={`url(#${hatch})`} />
      <CellArea class="af-sil-lost-edge" c={c} poly={poly} cell={cell} inset={0.5} />
    </g>
  );
}

interface SilCellProps {
  c: LayoutCell;
  poly: readonly Vec2[] | undefined;
  cell: number;
  /** The part was just hit (its cells pulse). */
  pulse: boolean;
  hatch: string;
}

/**
 * One cell, memoised on what it shows (O13): a hit redraws the silhouette, but only the cells of the
 * part that changed (its fill height in whole pixels, its level, its pulse) draw again.
 */
const SilCell = pure(
  function SilCellView({ c, poly, cell, pulse, hatch }: SilCellProps) {
    return <g class={pulse ? 'af-sil-pulse' : undefined}>{c.level === 'lost' ? <CellDestroyed c={c} poly={poly} cell={cell} hatch={hatch} /> : <CellIntact c={c} poly={poly} cell={cell} />}</g>;
  },
  (a: SilCellProps, b: SilCellProps) =>
    a.cell === b.cell &&
    a.pulse === b.pulse &&
    a.hatch === b.hatch &&
    a.c.x === b.c.x &&
    a.c.y === b.c.y &&
    a.c.level === b.c.level &&
    fillPx(a.c, a.cell) === fillPx(b.c, b.cell) &&
    (a.poly === b.poly || deepEqual(a.poly, b.poly)),
);

/**
 * Ship silhouette with HP on the cells (bow up, as in the hangar). Fill height of a cell = the part's
 * HP; < 60 % warning (amber), < 30 % critical (red + crack), a destroyed part = hatching.
 * Tier corner brackets carry the tier like the part icons – only from T2 (iron T1 is the base; orange
 * T1 corners would merge with the amber warning on small cells).
 * Shaped armour (SL2 E2 U3): a shaped cell is drawn as its polygon (`SilhouetteCell.poly`) and its HP
 * fill is the polygon cut at the fill line.
 * Under the cells lies the hull outline (SL2 E1 T10): the shell's dark plate joining the cells, with
 * the lip in the tier accent; the cells are clipped to it (bevelled armour corners). Parts shot off
 * are not in the outline – their sockets sit outside the lip.
 */
export function ShipSilhouette({ silhouette, width, height, maxCell = 12, gap = 2, replay, pulseMs = 450, lossMs = 1100, label, testId }: ShipSilhouetteProps) {
  const id = useId();
  // the hull lip runs gap / 2 + half its width outside the cells: keep it inside the box
  const pad = silhouette.outline ? Math.ceil(gap / 2 + lipWidth(maxCell) / 2) : 0;
  const layout = silhouetteLayout(silhouette, { width: width - 2 * pad, height: height - 2 * pad }, { maxCell, gap });
  const { cell } = layout;
  const hull = useMemo(
    () => silhouetteOutlinePath(silhouette.outline, silhouette, layout),
    // the layout is rebuilt every render; the path depends only on these
    [silhouette.outline, silhouette.maxX, silhouette.maxY, cell, layout.gap],
  );
  const tier = silhouetteTier(silhouette);
  // silhouetteLayout keeps the order of silhouette.cells: pair each laid-out cell with its polygon
  const cells = layout.cells.map((c, i): [LayoutCell, readonly Vec2[] | undefined] => [c, silhouette.cells[i]?.poly]);

  // hits: a part whose HP dropped since the last redraw flashes briefly
  const prev = useRef(new Map<number, number>());
  const hitAt = useRef(new Map<number, number>());
  // a part that was on the ship at the last redraw and is now missing flashes red (M3.8)
  const lostAt = useRef(new Map<number, number>());
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  for (const p of layout.parts) {
    const before = prev.current.get(p.part);
    if (p.missing) {
      if (before !== undefined && before > 0) lostAt.current.set(p.part, now);
      prev.current.set(p.part, 0);
      continue;
    }
    if (before !== undefined && p.fraction < before - 1e-6) hitAt.current.set(p.part, now);
    prev.current.set(p.part, p.fraction);
  }
  const hit = (part: number) => now - (hitAt.current.get(part) ?? -Infinity) < pulseMs;
  const justLost = (part: number) => now - (lostAt.current.get(part) ?? -Infinity) < lossMs;

  const step = replay && replay.order.length > 0 ? replay.duration / replay.order.length : 0;
  const replayDelay = (part: number): number | null => {
    if (!replay) return null;
    const i = replay.order.indexOf(part);
    return i < 0 ? null : (replay.delay ?? 0) + i * step;
  };

  const hatch = `af-sil-hatch-${id}`;
  const clip = `af-sil-clip-${id}`;
  const showBrackets = cell >= 6;
  return (
    <svg
      class="af-sil"
      width={layout.width + 2 * pad}
      height={layout.height + 2 * pad}
      viewBox={`${-pad} ${-pad} ${layout.width + 2 * pad} ${layout.height + 2 * pad}`}
      role="img"
      aria-label={label}
      data-testid={testId}
      data-damaged={silhouette.damaged}
      data-missing={silhouette.missing ?? 0}
    >
      <defs>
        <pattern id={hatch} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" class="af-sil-hatch-bg" />
          <rect width="1.6" height="4" class="af-sil-hatch-line" />
        </pattern>
        {hull && (
          <clipPath id={clip}>
            <path d={hull} clip-rule="evenodd" />
          </clipPath>
        )}
      </defs>
      {hull && <path class={`af-sil-hull af-sil-hull--${tier}`} d={hull} fill-rule="evenodd" stroke-width={lipWidth(cell)} data-testid={testId ? `${testId}-hull` : undefined} />}
      {cells.filter(([c]) => c.missing).map(([c, poly]) => (
        // lost against the blueprint: an empty socket with a broken outline (red flash when it goes)
        <g key={`m${c.part}:${c.x}:${c.y}`} class="af-sil-cell is-missing" data-missing-part={c.part}>
          <CellArea class="af-sil-gap" c={c} poly={poly} cell={cell} inset={0.5} />
          {justLost(c.part) && <CellArea class="af-sil-lossflash" c={c} poly={poly} cell={cell} inset={-1} />}
        </g>
      ))}
      <g clip-path={hull ? `url(#${clip})` : undefined}>
        {cells.filter(([c]) => !c.missing).map(([c, poly]) => {
          const delay = replayDelay(c.part);
          if (c.level === 'lost' && delay !== null) {
            // replay: first the whole cell, then in the order of loss a flash and the hatching
            const style = { animationDelay: `${Math.round(delay)}ms` };
            return (
              <g key={`${c.part}:${c.x}:${c.y}`} class="af-sil-replay">
                <g class="af-sil-replay-before" style={style}>
                  <CellIntact c={c} poly={poly} cell={cell} />
                </g>
                <g class="af-sil-replay-after" style={style}>
                  <CellDestroyed c={c} poly={poly} cell={cell} hatch={hatch} />
                </g>
                <CellArea class="af-sil-replay-flash" style={style} c={c} poly={poly} cell={cell} inset={-1} />
              </g>
            );
          }
          return <SilCell key={`${c.part}:${c.x}:${c.y}`} c={c} poly={poly} cell={cell} pulse={hit(c.part)} hatch={hatch} />;
        })}
        {layout.parts
          .filter((p) => p.cockpit && p.level !== 'lost' && !p.missing && cell >= 6)
          .map((p) => {
            // cockpit: a small cyan window in the middle (orientation, like the windows on the models)
            const w = Math.max(2, Math.round(cell * 0.34));
            return <rect key={`c${p.part}`} class="af-sil-cockpit" x={p.x + (p.w - w) / 2} y={p.y + (p.h - w) / 2 - 1} width={w} height={w} />;
          })}
        {showBrackets &&
          layout.parts
            .filter((p) => p.tier >= 2 && !p.missing)
            .map((p) => (
            <path key={`b${p.part}`} class={`af-sil-tier af-sil-tier--${p.tier}${p.level === 'lost' ? ' is-lost' : ''}`} d={bracketPath(p, cell)} />
          ))}
      </g>
    </svg>
  );
}
