import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { tx } from '../../i18n';
import { Button } from '../theme';

/** Sub-screen: a light plate set in a dark frame (like the station hub), title in the wide typeface. */
export function Sheet(p: {
  title: string;
  onBack: () => void;
  narrow?: boolean;
  class?: string;
  testId?: string;
  footer?: ComponentChildren;
  bodyClass?: string;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLElement>(null);
  // focus into the plate so the keyboard continues where the screen opened
  useEffect(() => {
    const el = ref.current;
    if (!el || el.contains(document.activeElement)) return;
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>('.sheet-body button, .sheet-body input');
    (first ?? el).focus({ preventScroll: true });
  }, []);
  return (
    <div class="sheet-wrap">
      <section
        ref={ref}
        class={`sheet${p.narrow ? ' sheet--narrow' : ''} ${p.class ?? ''}`}
        data-testid={p.testId}
        aria-label={p.title}
        tabIndex={-1}
      >
        <header class="sheet-head">
          <h2 class="sheet-title">{p.title}</h2>
          <Button variant="ghost" size="sm" keyHint="Esc" onClick={p.onBack} testId="sheet-back">
            {tx().app.menu.back}
          </Button>
        </header>
        <div class={`sheet-body ${p.bodyClass ?? ''}`}>{p.children}</div>
        {p.footer && <footer class="sheet-foot">{p.footer}</footer>}
      </section>
    </div>
  );
}
