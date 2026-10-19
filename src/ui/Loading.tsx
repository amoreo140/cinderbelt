import { render } from 'preact';
import { tx } from '../i18n';
import { assetUrl } from '../render/assets/url';
import { litSegments } from './theme/gaugeMath';
import './theme';
import './loading.css';

const SEGMENTS = 32;

/** Overlay while the models load: the logo and a segmented progress bar. */
function Loading({ loaded, total }: { loaded: number; total: number }) {
  const ratio = total > 0 ? loaded / total : 0;
  const lit = litSegments(ratio, SEGMENTS);
  return (
    <div class="loading" role="status" aria-live="polite">
      <img class="loading-logo" src={assetUrl('assets/ui/logo_small.png')} alt="Cinderbelt" />
      <div class="loading-bar" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} class={i < lit ? 'is-on' : ''} />
        ))}
      </div>
      <div class="loading-text">
        <span class="loading-title">{tx().loading.title}</span>
        <span class="loading-detail">{total > 0 ? tx().loading.models(loaded, total) : ' '}</span>
      </div>
    </div>
  );
}

/** Shows the overlay in `parent`; update() advances the bar, remove() removes it. */
export function showLoading(parent: HTMLElement): { update: (loaded: number, total: number) => void; remove: () => void } {
  const host = document.createElement('div');
  host.className = 'af-root loading-host';
  parent.appendChild(host);
  const draw = (loaded: number, total: number) => render(<Loading loaded={loaded} total={total} />, host);
  draw(0, 0);
  return {
    update: draw,
    remove: () => {
      render(null, host);
      host.remove();
    },
  };
}
