// Texts of the graphics quality setting (visual polish milestone) and the background brightness
// (readability pass): the Settings → Display rows.
// A separate module next to sk.ts and skFlight.ts; `GraphicsTexts` is the shape, enGraphics.ts implements
// the same keys in English.
import type { GraphicsQuality, GraphicsSetting } from '../render/quality';

export interface GraphicsTexts {
  /** Row label in Settings → Display. */
  label: string;
  /** Choices of the segmented control. */
  options: Record<GraphicsSetting, string>;
  /** Level names (the value column shows what auto picked). */
  levels: Record<GraphicsQuality, string>;
  /** Value column while auto is on: the level it picked ("High"). */
  autoPicked: (level: string) => string;
  /** Tooltip / screen-reader hint of the row. */
  hint: string;
  /** The background brightness slider (readability: the playfield stays brighter than the sky). */
  background: { label: string; hint: string };
  /** The hull shell toggle (SL2 E1): on = one continuous hull, off = the previous look. */
  hullShell: { label: string; hint: string };
  /** The dynamic resolution toggle (optimisation R3): a lower 3D resolution while the GPU cannot keep up. */
  dynamicResolution: { label: string; hint: string };
}

export const skGraphics: GraphicsTexts = {
  label: 'Kvalita grafiky',
  options: { auto: 'Auto', low: 'Nízka', medium: 'Stredná', high: 'Vysoká' },
  levels: { low: 'Nízka', medium: 'Stredná', high: 'Vysoká' },
  autoPicked: (level) => level,
  hint: 'Tiene, okluzia, premávka pri staniciach, častice, detail planét a rozlíšenie. Auto vyberie podľa grafickej karty a zníži kvalitu, keď hra nestíha.',
  background: {
    label: 'Jas pozadia',
    hint: 'Jas a sýtosť hviezd, hmlovín, planét a slnka. Tmavšie pozadie nechá lode, asteroidy a stanice vyniknúť aj pri oddialení.',
  },
  hullShell: {
    label: 'Plášť lodí',
    hint: 'Lode pôsobia ako jeden trup: súvislý bočný pás, lem vo farbe kokpitu, švy medzi dielmi a navigačné svetlá. Vypnutý = holé diely so spojkami ako predtým.',
  },
  dynamicResolution: {
    label: 'Dynamické rozlíšenie',
    hint: 'Keď grafická karta nestíha, vesmír sa na chvíľu vykreslí v nižšom rozlíšení (85 % alebo 70 %) skôr, než Auto zníži kvalitu. Rozhranie ostáva ostré.',
  },
};
