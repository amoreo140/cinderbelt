// Far landmarks on the map (readability plan §2): a small dim silhouette per kind – scenery, not a
// destination, so they stay quieter than stations, places and targets. MapView adds their names
// through the label layout (priority between ring names and ore grades).
import type { LandmarkKind } from '../../sim/world/landmarks';
import { withAlpha } from '../canvasDraw';

/** Map tint per landmark kind (matched to the models: sand giant, amber mast, rust ring, violet crystal, ember forge). */
export const LANDMARK_MAP_COLORS: Readonly<Record<LandmarkKind, string>> = {
  gas_giant: '#d9b98a',
  guild_relay: '#f2b65c',
  rust_ring_shard: '#d9734a',
  crystal_spire: '#a58bff',
  dead_forge: '#ff7a3d',
};

/** The silhouette of a landmark centred at (x, y), about `r` px in radius. */
export function drawLandmarkGlyph(ctx: CanvasRenderingContext2D, kind: LandmarkKind, x: number, y: number, r: number): void {
  const color = LANDMARK_MAP_COLORS[kind];
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = withAlpha(color, 0.75);
  ctx.fillStyle = withAlpha(color, 0.22);
  ctx.beginPath();
  switch (kind) {
    case 'gas_giant':
      ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.15, r * 0.34, -0.35, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'guild_relay':
      // mast with an X of solar wings
      ctx.moveTo(0, -r);
      ctx.lineTo(0, r);
      ctx.moveTo(-r * 0.75, -r * 0.45);
      ctx.lineTo(r * 0.75, r * 0.45);
      ctx.moveTo(-r * 0.75, r * 0.45);
      ctx.lineTo(r * 0.75, -r * 0.45);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'rust_ring_shard':
      // a broken arc of a big ring
      ctx.lineWidth = 3;
      ctx.arc(0, r * 0.9, r * 1.4, Math.PI * 1.2, Math.PI * 1.8);
      ctx.stroke();
      break;
    case 'crystal_spire':
      // three prisms
      for (const [dx, h] of [
        [-r * 0.5, r * 0.7],
        [0, r * 1.05],
        [r * 0.5, r * 0.8],
      ] as const) {
        ctx.moveTo(dx - r * 0.2, r * 0.7);
        ctx.lineTo(dx, r * 0.7 - h * 1.3);
        ctx.lineTo(dx + r * 0.2, r * 0.7);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
      break;
    case 'dead_forge':
      // a cinder in a broken ring
      ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.95, -0.3, Math.PI * 0.8);
      ctx.moveTo(Math.cos(Math.PI * 1.0) * r * 0.95, Math.sin(Math.PI * 1.0) * r * 0.95);
      ctx.arc(0, 0, r * 0.95, Math.PI * 1.0, Math.PI * 1.55);
      ctx.stroke();
      break;
  }
  ctx.restore();
}
