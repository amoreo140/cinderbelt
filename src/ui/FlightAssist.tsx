// Flight assist HUD (M3.8): the collision warning band over the ship. The 3D parts (flight-path
// marker, obstacle ring) are drawn by the renderer; data come from src/game/flightAssist.ts.
import { tx } from '../i18n';
import { formatAmount } from './format';
import { KeyHint, Lamp } from './theme';
// after the theme – screen rules win over the component base
import './flight.css';

export interface CollisionHud {
  /** Seconds to contact. */
  time: number;
  /** 0 … 1 (contact now). */
  urgency: number;
  /** The dampers are off – Z is the quickest way to brake. */
  dampersOff: boolean;
}

/** Segments of the time-to-impact bar (lit = time left). */
const SEGMENTS = 10;

/** Time left as lit segments: the whole horizon = all, contact = none (never 0 while the band shows). */
export function collisionSegments(urgency: number, segments = SEGMENTS): number {
  return Math.max(1, Math.min(segments, Math.ceil((1 - urgency) * segments)));
}

/** "Collision in 1.4 s" – amber while there is time, red and blinking when it is close. */
export function CollisionBand({ c }: { c: CollisionHud }) {
  const critical = c.urgency >= 0.6;
  const lit = collisionSegments(c.urgency);
  return (
    <div class={`fa-collision${critical ? ' is-critical' : ''}`} role="alert" data-testid="collision-warning" data-urgency={c.urgency.toFixed(2)}>
      <Lamp state={critical ? 'bad' : 'warn'} />
      <span class="fa-collision-title af-label">{tx().flight.collision.title}</span>
      <b class="fa-collision-eta">{tx().flight.collision.eta(formatAmount(c.time))}</b>
      <span class="fa-collision-bar" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <i key={i} class={i < lit ? 'is-on' : ''} />
        ))}
      </span>
      <span class="fa-collision-hint">
        <KeyHint keys={c.dampersOff ? 'Z' : 'S'} dark>
          {tx().flight.collision.brake}
        </KeyHint>
      </span>
    </div>
  );
}
