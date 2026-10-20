// Player settings (M2c, task 10): sound, zoom, help, motion, language.
// They are not part of a saved game – they live in the browser's localStorage and apply to every game.
import { isLocale, type Locale } from '../../i18n/locale';
import { isGraphicsSetting, type GraphicsSetting } from '../../render/quality';
import { BACKGROUND_BRIGHTNESS_DEFAULT } from '../../render/env/backdrop';
import { setHullShellEnabled } from '../../render/hull/setting';
import { setDynamicResolutionEnabled } from '../../render/dynamicResolution';
import { LEGACY_MUTED_KEY, LEGACY_SETTINGS_KEY, readMigrated } from '../storage/legacyKeys';
import { RADIO_SETTINGS, type RadioSetting } from '../comms/types';

export type ReducedMotion = 'system' | 'on' | 'off';
/** UI language (Settings → Language); a first launch starts in English. */
export type Language = Locale;

export interface UserSettings {
  /** 0..1 */
  masterVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  /** 0..1 – music (the space ambience has its own slider). */
  musicVolume: number;
  muted: boolean;
  /** Multiplier of the wheel step when zooming (0.25–2). */
  zoomSensitivity: number;
  /** The controls help in the HUD starts expanded. */
  showControlsHelp: boolean;
  /** Reduced motion: by the system, always, never. */
  reducedMotion: ReducedMotion;
  language: Language;
  /** Flight-path marker and the dampers' stopping point in flight (M3.8). */
  flightMarker: boolean;
  /** Camera shake on impacts and hull hits (M3.8; never with reduced motion). */
  cameraShake: boolean;
  /** Combat zoom-out: the camera pulls back so the ship and the nearest attacker fit (readability R1). */
  combatZoom: boolean;
  /** Graphics quality (visual polish): auto = by the GPU and the frame rate. */
  graphicsQuality: GraphicsSetting;
  /** Background brightness 0..1 (1 = the original backdrop; readability: the playfield stays brighter). */
  backgroundBrightness: number;
  /** Communicator: every radio message, important ones only, or none (toasts as before). */
  radio: RadioSetting;
  /**
   * Hull shell (SL2 E1, Settings → Display "Hull shell"): band, lip, seams and nav lights on every ship;
   * off = bare parts with dot connectors. Applied to the render side via render/hull/setting.ts.
   */
  hullShell: boolean;
  /** Map notes within reach show as edge arrows in flight (M4d, Settings → Display "Markers in flight"). */
  notesInFlight: boolean;
  /**
   * Dynamic resolution (Settings → Display "Dynamic resolution"): the 3D view renders at a lower
   * resolution while the GPU cannot keep up (render/dynamicResolution.ts).
   */
  dynamicResolution: boolean;
  /** UI size multiplier (Settings → Display "Interface size"), 0.9–1.5; drives --af-ui-scale. */
  uiScale: number;
}

export const USER_SETTINGS_KEY = 'cinderbelt.settings';
/** Older mute key (the N key before M2c). */
export const LEGACY_MUTE_KEY = 'cinderbelt.muted';

export const ZOOM_SENSITIVITY_MIN = 0.25;
export const ZOOM_SENSITIVITY_MAX = 2;
export const UI_SCALE_MIN = 0.9;
export const UI_SCALE_MAX = 1.5;

export const DEFAULT_USER_SETTINGS: UserSettings = {
  masterVolume: 0.9,
  sfxVolume: 0.9,
  ambientVolume: 0.5,
  musicVolume: 0,
  muted: false,
  zoomSensitivity: 1,
  showControlsHelp: false,
  reducedMotion: 'system',
  language: 'en',
  flightMarker: true,
  cameraShake: true,
  combatZoom: true,
  graphicsQuality: 'auto',
  backgroundBrightness: BACKGROUND_BRIGHTNESS_DEFAULT,
  radio: 'all',
  hullShell: true,
  notesInFlight: true,
  dynamicResolution: true,
  uiScale: 1,
};

const REDUCED_MOTION: readonly ReducedMotion[] = ['system', 'on', 'off'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Repairs stored settings field by field – invalid values fall back to the defaults. */
export function sanitizeUserSettings(raw: unknown, base: UserSettings = DEFAULT_USER_SETTINGS): UserSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    masterVolume: num(r.masterVolume, base.masterVolume, 0, 1),
    sfxVolume: num(r.sfxVolume, base.sfxVolume, 0, 1),
    ambientVolume: num(r.ambientVolume, base.ambientVolume, 0, 1),
    musicVolume: num(r.musicVolume, base.musicVolume, 0, 1),
    muted: bool(r.muted, base.muted),
    zoomSensitivity: num(r.zoomSensitivity, base.zoomSensitivity, ZOOM_SENSITIVITY_MIN, ZOOM_SENSITIVITY_MAX),
    showControlsHelp: bool(r.showControlsHelp, base.showControlsHelp),
    reducedMotion: REDUCED_MOTION.includes(r.reducedMotion as ReducedMotion) ? (r.reducedMotion as ReducedMotion) : base.reducedMotion,
    language: isLocale(r.language) ? r.language : base.language,
    flightMarker: bool(r.flightMarker, base.flightMarker),
    cameraShake: bool(r.cameraShake, base.cameraShake),
    combatZoom: bool(r.combatZoom, base.combatZoom),
    graphicsQuality: isGraphicsSetting(r.graphicsQuality) ? r.graphicsQuality : base.graphicsQuality,
    backgroundBrightness: num(r.backgroundBrightness, base.backgroundBrightness, 0, 1),
    radio: RADIO_SETTINGS.includes(r.radio as RadioSetting) ? (r.radio as RadioSetting) : base.radio,
    hullShell: bool(r.hullShell, base.hullShell),
    notesInFlight: bool(r.notesInFlight, base.notesInFlight),
    dynamicResolution: bool(r.dynamicResolution, base.dynamicResolution),
    uiScale: num(r.uiScale, base.uiScale, UI_SCALE_MIN, UI_SCALE_MAX),
  };
}

export type SettingsStore = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The language of a first launch: English. Tests (e2e) may preset it with
 * `globalThis.__CINDER_FIRST_LANGUAGE__`; nothing sets it in the game.
 */
function firstLaunchLanguage(): Locale {
  const preset = (globalThis as { __CINDER_FIRST_LANGUAGE__?: unknown }).__CINDER_FIRST_LANGUAGE__;
  return typeof preset === 'string' && isLocale(preset) ? preset : 'en';
}

/**
 * Loads the settings (null = localStorage unavailable → defaults). A first launch starts in
 * firstLaunchLanguage(); stored settings keep their language.
 */
export function loadUserSettings(store: SettingsStore | null): UserSettings {
  const first: UserSettings = { ...DEFAULT_USER_SETTINGS, language: firstLaunchLanguage() };
  if (!store) return first;
  const base = { ...first, muted: readMigrated(store, LEGACY_MUTE_KEY, LEGACY_MUTED_KEY) === '1' };
  const text = readMigrated(store, USER_SETTINGS_KEY, LEGACY_SETTINGS_KEY);
  if (!text) return base;
  try {
    return sanitizeUserSettings(JSON.parse(text), base);
  } catch {
    return base;
  }
}

export function saveUserSettings(store: SettingsStore | null, settings: UserSettings): void {
  try {
    store?.setItem(USER_SETTINGS_KEY, JSON.stringify({ v: 1, ...settings }));
  } catch {
    // storage unavailable – the settings last until the tab closes
  }
}

/**
 * Applies the settings the render side reads as page-wide module state (on load and after every change):
 * the hull shell (flipping it bumps the render version and every ShipView rebuilds itself) and the
 * dynamic resolution (the renderer reads it every frame).
 */
export function applyRenderSettings(settings: Pick<UserSettings, 'hullShell' | 'dynamicResolution'>): void {
  setHullShellEnabled(settings.hullShell);
  setDynamicResolutionEnabled(settings.dynamicResolution);
}

/** Should motion be reduced? (`system` = by prefers-reduced-motion). */
export function prefersReducedMotion(settings: UserSettings, systemPrefers: boolean): boolean {
  return settings.reducedMotion === 'system' ? systemPrefers : settings.reducedMotion === 'on';
}

export const zoomFactor = (settings: UserSettings): number => settings.zoomSensitivity;
