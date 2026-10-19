import type { ComponentChildren } from 'preact';

export type PanelMaterial = 'plate' | 'band' | 'screen';

export interface PanelProps {
  /** plate = a light hull plate, band = a dark structural band, screen = a recessed display. */
  material?: PanelMaterial;
  /** Size of the corner bevel. */
  cut?: 'sm' | 'md' | 'lg' | 'none';
  /** Orange (T2: blue) trim along the edge. */
  trim?: 'top' | 'left' | 'none';
  tier?: 1 | 2;
  bolts?: boolean;
  /** Semi-transparent band for the flight HUD. */
  translucent?: boolean;
  class?: string;
  style?: Record<string, string | number>;
  testId?: string;
  as?: 'div' | 'section' | 'aside' | 'header' | 'footer';
  'aria-label'?: string;
  children?: ComponentChildren;
}

const CUTS = { sm: 'var(--af-cut-sm)', md: 'var(--af-cut)', lg: 'var(--af-cut-lg)', none: '0px' } as const;

/** Panel with cut corners like a hull plate. */
export function Panel(p: PanelProps) {
  const Tag = p.as ?? 'div';
  const trim = p.trim ?? 'none';
  const cls = [
    'af-panel',
    'af-cut4',
    `af-${p.material ?? 'band'}`,
    trim !== 'none' ? `af-trim-${trim}` : '',
    p.tier === 2 ? 'af-tier-2' : '',
    p.bolts ? 'af-bolts' : '',
    p.translucent ? 'af-translucent' : '',
    p.class ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag
      class={cls}
      style={{ '--cut': CUTS[p.cut ?? 'md'], ...p.style }}
      data-testid={p.testId}
      aria-label={p['aria-label']}
    >
      {trim !== 'none' && <span class="af-trim" aria-hidden="true" />}
      {p.bolts && (
        <>
          <span class="af-bolt af-bolt--tl" aria-hidden="true" />
          <span class="af-bolt af-bolt--tr" aria-hidden="true" />
          <span class="af-bolt af-bolt--bl" aria-hidden="true" />
          <span class="af-bolt af-bolt--br" aria-hidden="true" />
        </>
      )}
      {p.children}
    </Tag>
  );
}

/** Section heading with a short trim. */
export function Heading({ children, aside, level = 3 }: { children: ComponentChildren; aside?: ComponentChildren; level?: 2 | 3 | 4 }) {
  const Tag = `h${level}` as 'h3';
  return (
    <Tag class="af-heading">
      {children}
      {aside !== undefined && <span class="af-heading-aside">{aside}</span>}
    </Tag>
  );
}

/** A pressed seam between the plates. */
export function Seam() {
  return <hr class="af-seam" />;
}
