// English texts of the graphics quality setting – the same keys as skGraphics.ts (GraphicsTexts).
import type { GraphicsTexts } from './skGraphics';

export const enGraphics: GraphicsTexts = {
  label: 'Graphics quality',
  options: { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' },
  levels: { low: 'Low', medium: 'Medium', high: 'High' },
  autoPicked: (level) => level,
  hint: 'Shadows, ambient occlusion, station traffic, particles, planet detail and resolution. Auto picks by the graphics card and lowers the quality when the game cannot keep up.',
  background: {
    label: 'Background brightness',
    hint: 'Brightness and saturation of the stars, nebulae, planets and the sun. A darker background lets ships, asteroids and stations stand out, even zoomed out.',
  },
  uiScale: { label: 'Interface size', hint: 'Makes all text and panels larger or smaller.' },
  hullShell: {
    label: 'Hull shell',
    hint: "Ships read as one hull: a continuous side band, a trim lip in the cockpit's colour, seams between parts and nav lights. Off = bare parts with connectors, as before.",
  },
  dynamicResolution: {
    label: 'Dynamic resolution',
    hint: 'When the graphics card cannot keep up, space is drawn at a lower resolution for a while (85% or 70%) before Auto lowers the quality. The interface stays sharp.',
  },
};
