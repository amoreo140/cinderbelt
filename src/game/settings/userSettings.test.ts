import { describe, expect, it } from 'vitest';
import { hullShellEnabled, hullShellVersion, setHullShellEnabled } from '../../render/hull/setting';
import { dynamicResolutionEnabled } from '../../render/dynamicResolution';
import {
  applyRenderSettings,
  DEFAULT_USER_SETTINGS,
  LEGACY_MUTE_KEY,
  loadUserSettings,
  prefersReducedMotion,
  sanitizeUserSettings,
  saveUserSettings,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  USER_SETTINGS_KEY,
  zoomFactor,
} from './userSettings';

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('user settings', () => {
  it('defaults when nothing is stored', () => {
    expect(loadUserSettings(memoryStore())).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('round-trips through storage', () => {
    const store = memoryStore();
    const s = { ...DEFAULT_USER_SETTINGS, masterVolume: 0.3, muted: true, zoomSensitivity: 1.5, reducedMotion: 'on' as const };
    saveUserSettings(store, s);
    expect(JSON.parse(store.data.get(USER_SETTINGS_KEY)!)).toMatchObject({ v: 1, masterVolume: 0.3 });
    expect(loadUserSettings(store)).toEqual(s);
  });

  it('repairs invalid and out-of-range values field by field', () => {
    const s = sanitizeUserSettings({
      masterVolume: 4,
      sfxVolume: -1,
      ambientVolume: 'loud',
      muted: 'yes',
      zoomSensitivity: 0.01,
      showControlsHelp: false,
      reducedMotion: 'sometimes',
      language: 'de',
    });
    expect(s).toEqual({
      ...DEFAULT_USER_SETTINGS,
      masterVolume: 1,
      sfxVolume: 0,
      zoomSensitivity: 0.25,
      showControlsHelp: false,
    });
  });

  it('keeps the graphics quality – auto by default, unknown values fall back to it', () => {
    expect(DEFAULT_USER_SETTINGS.graphicsQuality).toBe('auto');
    expect(sanitizeUserSettings({ graphicsQuality: 'low' }).graphicsQuality).toBe('low');
    expect(sanitizeUserSettings({ graphicsQuality: 'high' }).graphicsQuality).toBe('high');
    expect(sanitizeUserSettings({ graphicsQuality: 'ultra' }).graphicsQuality).toBe('auto');
    expect(sanitizeUserSettings({ masterVolume: 0.5 }).graphicsQuality).toBe('auto');
  });

  it('keeps the background brightness – a dimmed default, clamped to 0..1, junk falls back', () => {
    expect(DEFAULT_USER_SETTINGS.backgroundBrightness).toBeGreaterThan(0.4);
    expect(DEFAULT_USER_SETTINGS.backgroundBrightness).toBeLessThan(0.8);
    expect(sanitizeUserSettings({ backgroundBrightness: 0.25 }).backgroundBrightness).toBe(0.25);
    expect(sanitizeUserSettings({ backgroundBrightness: 7 }).backgroundBrightness).toBe(1);
    expect(sanitizeUserSettings({ backgroundBrightness: -1 }).backgroundBrightness).toBe(0);
    expect(sanitizeUserSettings({ backgroundBrightness: 'bright' }).backgroundBrightness).toBe(DEFAULT_USER_SETTINGS.backgroundBrightness);
    // settings stored before the option existed get the default
    expect(sanitizeUserSettings({ masterVolume: 0.5 }).backgroundBrightness).toBe(DEFAULT_USER_SETTINGS.backgroundBrightness);
  });

  it('keeps the hull shell setting – on by default, junk and older settings fall back to on', () => {
    expect(DEFAULT_USER_SETTINGS.hullShell).toBe(true);
    expect(sanitizeUserSettings({ hullShell: false }).hullShell).toBe(false);
    expect(sanitizeUserSettings({ hullShell: 'off' }).hullShell).toBe(true);
    expect(sanitizeUserSettings({ hullShell: 0 }).hullShell).toBe(true);
    // settings stored before the option existed get the default
    expect(sanitizeUserSettings({ masterVolume: 0.5 }).hullShell).toBe(true);
    const store = memoryStore();
    saveUserSettings(store, { ...DEFAULT_USER_SETTINGS, hullShell: false });
    expect(loadUserSettings(store).hullShell).toBe(false);
  });

  it('keeps the "notes in flight" setting (M4d) – on by default, junk and older settings fall back to on', () => {
    expect(DEFAULT_USER_SETTINGS.notesInFlight).toBe(true);
    expect(sanitizeUserSettings({ notesInFlight: false }).notesInFlight).toBe(false);
    expect(sanitizeUserSettings({ notesInFlight: 'no' }).notesInFlight).toBe(true);
    expect(sanitizeUserSettings({ masterVolume: 0.5 }).notesInFlight).toBe(true);
    const store = memoryStore();
    saveUserSettings(store, { ...DEFAULT_USER_SETTINGS, notesInFlight: false });
    expect(loadUserSettings(store).notesInFlight).toBe(false);
  });

  it('keeps the dynamic resolution setting – on by default, junk and older settings fall back to on, applied to the render side', () => {
    expect(DEFAULT_USER_SETTINGS.dynamicResolution).toBe(true);
    expect(sanitizeUserSettings({ dynamicResolution: false }).dynamicResolution).toBe(false);
    expect(sanitizeUserSettings({ dynamicResolution: 'off' }).dynamicResolution).toBe(true);
    expect(sanitizeUserSettings({ masterVolume: 0.5 }).dynamicResolution).toBe(true);
    const store = memoryStore();
    saveUserSettings(store, { ...DEFAULT_USER_SETTINGS, dynamicResolution: false });
    expect(loadUserSettings(store).dynamicResolution).toBe(false);
    applyRenderSettings({ ...DEFAULT_USER_SETTINGS, dynamicResolution: false });
    expect(dynamicResolutionEnabled()).toBe(false);
    applyRenderSettings(DEFAULT_USER_SETTINGS);
    expect(dynamicResolutionEnabled()).toBe(true);
  });

  it('applies the hull shell setting to the render side – the version moves only on a real change', () => {
    setHullShellEnabled(true);
    const v0 = hullShellVersion();
    applyRenderSettings(DEFAULT_USER_SETTINGS);
    expect(hullShellVersion()).toBe(v0);
    applyRenderSettings({ ...DEFAULT_USER_SETTINGS, hullShell: false });
    expect(hullShellEnabled()).toBe(false);
    expect(hullShellVersion()).toBe(v0 + 1);
    applyRenderSettings({ ...DEFAULT_USER_SETTINGS, hullShell: false });
    expect(hullShellVersion()).toBe(v0 + 1);
    applyRenderSettings(DEFAULT_USER_SETTINGS);
    expect(hullShellEnabled()).toBe(true);
    expect(hullShellVersion()).toBe(v0 + 2);
  });

  it('keeps the radio setting (communicator) – all by default, unknown values fall back to it', () => {
    expect(DEFAULT_USER_SETTINGS.radio).toBe('all');
    expect(sanitizeUserSettings({ radio: 'important' }).radio).toBe('important');
    expect(sanitizeUserSettings({ radio: 'off' }).radio).toBe('off');
    expect(sanitizeUserSettings({ radio: 'loud' }).radio).toBe('all');
    expect(sanitizeUserSettings({ masterVolume: 0.5 }).radio).toBe('all');
  });

  it('keeps the flight assist switches (M3.8) – on by default, an old file gets the defaults', () => {
    expect(DEFAULT_USER_SETTINGS).toMatchObject({ flightMarker: true, cameraShake: true });
    expect(sanitizeUserSettings({ flightMarker: false, cameraShake: false })).toMatchObject({ flightMarker: false, cameraShake: false });
    expect(sanitizeUserSettings({ masterVolume: 0.5 })).toMatchObject({ flightMarker: true, cameraShake: true });
    expect(sanitizeUserSettings({ flightMarker: 'no', cameraShake: 0 })).toMatchObject({ flightMarker: true, cameraShake: true });
    // combat zoom-out (readability R1): on by default, a stored switch survives, garbage falls back
    expect(DEFAULT_USER_SETTINGS.combatZoom).toBe(true);
    expect(sanitizeUserSettings({ combatZoom: false }).combatZoom).toBe(false);
    expect(sanitizeUserSettings({ combatZoom: 'x' }).combatZoom).toBe(true);
  });

  it('keeps a music volume of its own – an old file without it gets the default', () => {
    expect(DEFAULT_USER_SETTINGS.musicVolume).toBe(0);
    expect(sanitizeUserSettings({ masterVolume: 0.5 }).musicVolume).toBe(DEFAULT_USER_SETTINGS.musicVolume);
    expect(sanitizeUserSettings({ musicVolume: 0.25 }).musicVolume).toBe(0.25);
    expect(sanitizeUserSettings({ musicVolume: 3 }).musicVolume).toBe(1);
    expect(sanitizeUserSettings({ musicVolume: 'loud' }).musicVolume).toBe(DEFAULT_USER_SETTINGS.musicVolume);
  });

  it('survives garbage and storage errors', () => {
    expect(loadUserSettings(memoryStore({ [USER_SETTINGS_KEY]: '{oops' }))).toEqual(DEFAULT_USER_SETTINGS);
    expect(sanitizeUserSettings(null)).toEqual(DEFAULT_USER_SETTINGS);
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(loadUserSettings(broken)).toEqual(DEFAULT_USER_SETTINGS);
    expect(() => saveUserSettings(broken, DEFAULT_USER_SETTINGS)).not.toThrow();
    expect(loadUserSettings(null)).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('takes over the older mute preference (N key before M2c)', () => {
    expect(loadUserSettings(memoryStore({ [LEGACY_MUTE_KEY]: '1' })).muted).toBe(true);
    // the newer record takes precedence
    const store = memoryStore({ [LEGACY_MUTE_KEY]: '1', [USER_SETTINGS_KEY]: JSON.stringify({ muted: false }) });
    expect(loadUserSettings(store).muted).toBe(false);
  });

  it('moves the pre-rename astra-forge.* settings and mute keys to cinderbelt.*', () => {
    const settings = memoryStore({ 'astra-forge.settings': JSON.stringify({ v: 1, masterVolume: 0.3 }) });
    expect(loadUserSettings(settings).masterVolume).toBe(0.3);
    expect(JSON.parse(settings.data.get(USER_SETTINGS_KEY)!)).toMatchObject({ masterVolume: 0.3 });
    expect(settings.data.has('astra-forge.settings')).toBe(true);
    expect(loadUserSettings(memoryStore({ 'astra-forge.muted': '1' })).muted).toBe(true);
    // the new key wins over the old one
    const both = memoryStore({ 'astra-forge.settings': JSON.stringify({ masterVolume: 0.3 }), [USER_SETTINGS_KEY]: JSON.stringify({ masterVolume: 0.8 }) });
    expect(loadUserSettings(both).masterVolume).toBe(0.8);
  });

  it('resolves reduced motion against the system preference', () => {
    expect(prefersReducedMotion({ ...DEFAULT_USER_SETTINGS, reducedMotion: 'system' }, true)).toBe(true);
    expect(prefersReducedMotion({ ...DEFAULT_USER_SETTINGS, reducedMotion: 'system' }, false)).toBe(false);
    expect(prefersReducedMotion({ ...DEFAULT_USER_SETTINGS, reducedMotion: 'on' }, false)).toBe(true);
    expect(prefersReducedMotion({ ...DEFAULT_USER_SETTINGS, reducedMotion: 'off' }, true)).toBe(false);
  });

  it('zoom factor scales wheel steps', () => {
    expect(zoomFactor(DEFAULT_USER_SETTINGS)).toBe(1);
    expect(zoomFactor({ ...DEFAULT_USER_SETTINGS, zoomSensitivity: 2 })).toBe(2);
  });

  it('language: English by default, Slovak accepted, anything else repaired', () => {
    expect(DEFAULT_USER_SETTINGS.language).toBe('en');
    expect(sanitizeUserSettings({ language: 'sk' }).language).toBe('sk');
    expect(sanitizeUserSettings({ language: 'de' }).language).toBe('en');
  });

  it('a first launch is English whatever the browser says; stored settings keep their language', () => {
    expect(loadUserSettings(memoryStore()).language).toBe('en');
    expect(loadUserSettings(null).language).toBe('en');
    const store = memoryStore();
    saveUserSettings(store, { ...DEFAULT_USER_SETTINGS, language: 'sk' });
    expect(loadUserSettings(store).language).toBe('sk');
  });

  it('a test-only first-launch language applies to a first launch and to stored settings without one', () => {
    const g = globalThis as { __CINDER_FIRST_LANGUAGE__?: string };
    g.__CINDER_FIRST_LANGUAGE__ = 'sk';
    try {
      expect(loadUserSettings(memoryStore()).language).toBe('sk');
      const store = memoryStore();
      store.setItem(USER_SETTINGS_KEY, JSON.stringify({ v: 1, cameraShake: false }));
      expect(loadUserSettings(store).language).toBe('sk');
      saveUserSettings(store, { ...DEFAULT_USER_SETTINGS, language: 'en' });
      expect(loadUserSettings(store).language).toBe('en');
      g.__CINDER_FIRST_LANGUAGE__ = 'de';
      expect(loadUserSettings(memoryStore()).language).toBe('en');
    } finally {
      delete g.__CINDER_FIRST_LANGUAGE__;
    }
  });
});

describe('first-15-minutes defaults', () => {
  it('starts with music off and the controls help closed', () => {
    expect(DEFAULT_USER_SETTINGS.musicVolume).toBe(0);
    expect(DEFAULT_USER_SETTINGS.showControlsHelp).toBe(false);
    expect(DEFAULT_USER_SETTINGS.uiScale).toBe(1);
  });
  it('keeps a stored music volume and help choice', () => {
    const s = sanitizeUserSettings({ musicVolume: 0.6, showControlsHelp: true });
    expect(s.musicVolume).toBe(0.6);
    expect(s.showControlsHelp).toBe(true);
  });
  it('clamps uiScale to 0.9–1.5 and falls back to 1', () => {
    expect(sanitizeUserSettings({ uiScale: 3 }).uiScale).toBe(UI_SCALE_MAX);
    expect(sanitizeUserSettings({ uiScale: 0.2 }).uiScale).toBe(UI_SCALE_MIN);
    expect(sanitizeUserSettings({ uiScale: 'x' }).uiScale).toBe(1);
    expect(sanitizeUserSettings({}).uiScale).toBe(1);
  });
});
