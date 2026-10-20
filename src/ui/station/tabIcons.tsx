// Stroke icons of the hub tabs (24 × 24 grid, drawn in currentColor by the tab rail – theme/components.css).
import type { ComponentChildren } from 'preact';
import type { StationTab } from './StationHub';

const svg = (children: ComponentChildren) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
);

export const TAB_ICONS: Record<StationTab, ComponentChildren> = {
  // station ring with a hub and four spokes
  overview: svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 3.5v6M12 14.5v6M3.5 12h6M14.5 12h6" />
    </>,
  ),
  // a crate
  market: svg(
    <>
      <path d="M3.5 7.8 12 3.5l8.5 4.3v8.4L12 20.5l-8.5-4.3z" />
      <path d="M3.5 7.8 12 12l8.5-4.2M12 12v8.5" />
    </>,
  ),
  // a hull grid
  shipyard: svg(
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" />
    </>,
  ),
  // a clipboard with lines
  board: svg(
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <path d="M9 4.5v-1.2h6v1.2M8.5 10h7M8.5 13.5h7M8.5 17h4" />
    </>,
  ),
  // a book
  archive: svg(
    <>
      <path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v13.5H7.5A2.5 2.5 0 0 1 5 18z" />
      <path d="M5 18a2.5 2.5 0 0 1 2.5-2.5H18M9 8.5h5" />
    </>,
  ),
  // a house (the home station's development)
  development: svg(
    <>
      <path d="M3.5 11.5 12 4l8.5 7.5" />
      <path d="M6 10v10h12V10M10 20v-5h4v5" />
    </>,
  ),
};
