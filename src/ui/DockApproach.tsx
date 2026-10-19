// The docking approach readout (docking manoeuvre): near a dock clamp a compact band
// over the docking prompt shows the distance to the clamp, the speed and the bow alignment, each with
// a lamp and the limit – green in tolerance, red out of it. The data come from ui/stationHud.ts; the
// derelict clamps (M4b) reuse it as is, a trader's trade port (M4d) with its own title ("Convoy link").
import { tx } from '../i18n';
import type { DockApproach } from './stationHud';
import { Lamp } from './theme';
// after the theme – screen rules win over the component base
import './dock.css';

export function DockApproachView({ a }: { a: DockApproach }) {
  const ready = a.items.every((i) => i.ok);
  const r = tx().docking.readout;
  const title = a.title ?? r.title;
  return (
    <div class={`dk-approach${ready ? ' is-ready' : ''}`} data-testid="dock-approach" data-ready={ready ? '1' : '0'} role="group" aria-label={title}>
      <span class="dk-head">
        <span class="dk-title af-label">{title}</span>
        {a.computer && <span class="dk-tag af-label">{r.computer}</span>}
      </span>
      {a.items.map((i) => (
        <span key={i.id} class={`dk-item ${i.ok ? 'is-ok' : 'is-bad'}`} data-testid={`dock-item-${i.id}`} data-ok={i.ok ? '1' : '0'}>
          <Lamp state={i.ok ? 'ok' : 'bad'} />
          <span class="dk-label af-label">{i.label}</span>
          <b class="dk-value">
            {i.value}
            {i.limit && <span class="dk-limit">{i.limit}</span>}
          </b>
        </span>
      ))}
    </div>
  );
}
