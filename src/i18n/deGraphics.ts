// German texts of the graphics quality setting – the same keys as skGraphics.ts (GraphicsTexts); the terms follow GLOSSARY-DE.md.
import type { GraphicsTexts } from './skGraphics';

export const deGraphics: GraphicsTexts = {
  label: 'Grafikqualität',
  options: { auto: 'Auto', low: 'Niedrig', medium: 'Mittel', high: 'Hoch' },
  levels: { low: 'Niedrig', medium: 'Mittel', high: 'Hoch' },
  autoPicked: (level) => level,
  hint: 'Schatten, Umgebungsverdeckung, Stationsverkehr, Partikel, Planetendetails und Auflösung. Auto wählt nach der Grafikkarte und senkt die Qualität, wenn das Spiel nicht mithält.',
  background: {
    label: 'Hintergrundhelligkeit',
    hint: 'Helligkeit und Sättigung von Sternen, Nebeln, Planeten und Sonne. Ein dunklerer Hintergrund lässt Schiffe, Asteroiden und Stationen besser hervortreten, auch herausgezoomt.',
  },
  uiScale: { label: 'Oberflächengröße', hint: 'Macht alle Texte und Fenster größer oder kleiner.' },
  hullShell: {
    label: 'Rumpfhülle',
    hint: 'Schiffe wirken wie ein Rumpf: ein durchgehendes Seitenband, eine Zierkante in der Farbe des Cockpits, Fugen zwischen den Teilen und Positionslichter. Aus = nackte Teile mit Verbindern, wie bisher.',
  },
  dynamicResolution: {
    label: 'Dynamische Auflösung',
    hint: 'Wenn die Grafikkarte nicht mithält, wird der Weltraum eine Weile in geringerer Auflösung gezeichnet (85 % oder 70 %), bevor Auto die Qualität senkt. Die Oberfläche bleibt scharf.',
  },
};
