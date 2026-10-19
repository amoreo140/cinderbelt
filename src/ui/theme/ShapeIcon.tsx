// A shaped armour miniature (SL2 E2): the shape's render-detail polygon drawn as seen in the hangar
// from above – bow up, port to the left (like the ship silhouettes) – over its footprint cells, outlined
// in the tier colour (T1 trim orange, T2 titanium blue). `shape` null = the full part.
import { SHAPES, type ShapeId } from '../../data/shapes';
import type { Tier } from '../../data/parts';
import { shapePolygon } from '../../sim/ship/shape';
import type { Rotation } from '../../sim/ship/types';

export interface ShapeIconProps {
  /** null = the full (unshaped) part. */
  shape: ShapeId | null;
  /** Rotation in hand (the icon turns like the ghost). */
  rot?: Rotation;
  tier?: Tier;
  /** Pixels per grid cell (the same for every shape, so a 2×1 wing reads twice as long). */
  cell?: number;
  /** Accessible name; without it the icon is decorative (`aria-hidden`). */
  label?: string;
  class?: string;
}

/** Inset of the drawing inside its box (px) so the stroke is never cut. */
const PAD = 2;

/** Grid-frame (+x bow, +y port) → screen (bow up, port left). */
const screen = (x: number, y: number): [number, number] => [-y, -x];

const fmt = (v: number): string => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(4).replace(/\.?0+$/, ''));

/** The outline as an SVG path in screen cell units, part-centred. */
export function shapeIconPath(shape: ShapeId | null, rot: Rotation): string {
  const poly =
    shape === null
      ? [
          { x: -0.5, y: -0.5 },
          { x: 0.5, y: -0.5 },
          { x: 0.5, y: 0.5 },
          { x: -0.5, y: 0.5 },
        ]
      : shapePolygon(shape, rot, 'render');
  return `${poly
    .map((v, i) => {
      const [sx, sy] = screen(v.x, v.y);
      return `${i === 0 ? 'M' : 'L'}${fmt(sx)} ${fmt(sy)}`;
    })
    .join('')}Z`;
}

export function ShapeIcon({ shape, rot = 0, tier = 1, cell = 16, label, class: cls }: ShapeIconProps) {
  const size = shape === null ? { w: 1, h: 1 } : SHAPES[shape].size;
  // footprint extents along the grid x (bow) and y (port) after the rotation
  const [ex, ey] = rot % 2 === 0 ? [size.w, size.h] : [size.h, size.w];
  // screen: width along −y, height along −x
  const width = ey * cell + 2 * PAD;
  const height = ex * cell + 2 * PAD;
  const pad = PAD / cell;
  const cells: [number, number][] = [];
  for (let i = 0; i < ey; i++) for (let j = 0; j < ex; j++) cells.push([-ey / 2 + i, -ex / 2 + j]);
  return (
    <svg
      class={`af-shape-icon af-tier-${tier}${cls ? ` ${cls}` : ''}`}
      width={width}
      height={height}
      viewBox={`${fmt(-ey / 2 - pad)} ${fmt(-ex / 2 - pad)} ${fmt(ey + 2 * pad)} ${fmt(ex + 2 * pad)}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      data-shape={shape ?? 'full'}
    >
      {cells.map(([x, y]) => (
        <rect
          key={`${x},${y}`}
          x={x}
          y={y}
          width={1}
          height={1}
          fill="none"
          vector-effect="non-scaling-stroke"
          style={{ stroke: 'var(--shape-cell, rgba(22, 32, 44, 0.28))', strokeWidth: '1px', strokeDasharray: '2 2' }}
        />
      ))}
      <path
        d={shapeIconPath(shape, rot)}
        vector-effect="non-scaling-stroke"
        stroke-linejoin="round"
        style={{
          fill: 'var(--shape-fill, var(--af-hull-shade))',
          stroke: 'var(--trim, var(--af-trim))',
          strokeWidth: 'var(--shape-stroke, 1.5px)',
        }}
      />
    </svg>
  );
}
