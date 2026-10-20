import { useId } from 'preact/hooks';
import { UI_SCALE_MAX, UI_SCALE_MIN, ZOOM_SENSITIVITY_MAX, ZOOM_SENSITIVITY_MIN, type UserSettings } from '../../game/settings/userSettings';
import { LOCALE_NAMES, LOCALES, tx } from '../../i18n';
import { formatNumber, formatPercent } from '../format';
import { litSegments } from '../theme/gaugeMath';
import { Button, Heading, Key, Lamp, Panel, Segmented } from '../theme';
import { Sheet } from './Sheet';
import { GRAPHICS_SETTINGS } from '../../render/quality';
import { RADIO_SETTINGS } from '../../game/comms/types';
import type { OverlayData, OverlayHandlers } from './types';

const t = () => tx().app.settings;
const SEGMENTS = 20;

/** Slider: a native range input (keyboard, screen readers) over a segmented meter. */
function Slider(p: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  muted?: boolean;
  /** Tooltip of the row. */
  hint?: string;
  testId: string;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const ratio = (p.value - p.min) / (p.max - p.min);
  const lit = litSegments(ratio, SEGMENTS);
  return (
    <div class="st-row" title={p.hint}>
      <label for={id}>{p.label}</label>
      <div class={`af-slider${p.muted ? ' is-muted' : ''}`}>
        <div class="af-slider-track" aria-hidden="true">
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span key={i} class={i < lit ? 'is-on' : ''} />
          ))}
        </div>
        <input
          id={id}
          type="range"
          min={p.min}
          max={p.max}
          step={p.step}
          value={p.value}
          aria-valuetext={p.format(p.value)}
          data-testid={p.testId}
          onInput={(e) => p.onChange(Number((e.currentTarget as HTMLInputElement).value))}
        />
      </div>
      <span class="st-value">{p.format(p.value)}</span>
    </div>
  );
}

/** On / off switch row (M3.8 flight assist). */
function Toggle(p: { label: string; value: boolean; testId: string; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <div class="st-row" title={p.hint}>
      <span class="st-name">{p.label}</span>
      <span data-testid={p.testId}>
        <Segmented
          label={p.label}
          options={[
            { value: 'on', label: tx().flight.settings.on },
            { value: 'off', label: tx().flight.settings.off },
          ]}
          value={p.value ? 'on' : 'off'}
          onChange={(v) => p.onChange(v === 'on')}
        />
      </span>
      <span />
    </div>
  );
}

const percent = (v: number) => formatPercent(Math.round(v * 100));
/** A multiplier with one or two decimals: "×1,0", "×1,25". */
const factor = (v: number) => `×${formatNumber(v, Math.round(v * 100) % 10 === 0 ? 1 : 2)}`;

export function SettingsScreen({ data, on }: { data: OverlayData; on: OverlayHandlers }) {
  const s = data.settings;
  const set = (patch: Partial<UserSettings>) => on.setSettings(patch);
  const storage = data.storage;
  return (
    <Sheet
      title={t().title}
      onBack={on.back}
      narrow
      testId="settings"
      footer={
        <>
          <Button variant="ghost" onClick={on.resetSettings} testId="settings-reset">
            {t().reset}
          </Button>
        </>
      }
    >
      <section class="st-section">
        <Heading>{t().audio}</Heading>
        <div class="st-rows">
          <Slider label={t().master} value={s.masterVolume} min={0} max={1} step={0.05} muted={s.muted} testId="set-master" format={percent} onChange={(masterVolume) => set({ masterVolume })} />
          <Slider label={t().sfx} value={s.sfxVolume} min={0} max={1} step={0.05} muted={s.muted} testId="set-sfx" format={percent} onChange={(sfxVolume) => set({ sfxVolume })} />
          <Slider label={t().music} value={s.musicVolume} min={0} max={1} step={0.05} muted={s.muted} testId="set-music" format={percent} onChange={(musicVolume) => set({ musicVolume })} />
          <Slider label={t().ambient} value={s.ambientVolume} min={0} max={1} step={0.05} muted={s.muted} testId="set-ambient" format={percent} onChange={(ambientVolume) => set({ ambientVolume })} />
          <div class="st-row">
            <span class="st-name">{t().mute}</span>
            <span data-testid="set-mute">
              <Segmented label={t().mute} options={[{ value: 'off', label: t().off }, { value: 'on', label: t().on }]} value={s.muted ? 'on' : 'off'} onChange={(v) => set({ muted: v === 'on' })} />
            </span>
            <span class="st-value">
              <Key>N</Key>
            </span>
          </div>
        </div>
      </section>

      <section class="st-section">
        <Heading>{t().controls}</Heading>
        <div class="st-rows">
          <Slider
            label={t().zoom}
            value={s.zoomSensitivity}
            min={ZOOM_SENSITIVITY_MIN}
            max={ZOOM_SENSITIVITY_MAX}
            step={0.25}
            testId="set-zoom"
            format={factor}
            onChange={(zoomSensitivity) => set({ zoomSensitivity })}
          />
          <div class="st-row">
            <span class="st-name">{t().help}</span>
            <span data-testid="set-help">
              <Segmented
                label={t().help}
                options={[
                  { value: 'on', label: t().helpStates.on },
                  { value: 'off', label: t().helpStates.off },
                ]}
                value={s.showControlsHelp ? 'on' : 'off'}
                onChange={(v) => set({ showControlsHelp: v === 'on' })}
              />
            </span>
            <span class="st-value">
              <Key>K</Key>
            </span>
          </div>
          <div class="st-row" title={tx().comms.settings.hint}>
            <span class="st-name">{tx().comms.settings.label}</span>
            <span data-testid="set-radio">
              <Segmented
                label={tx().comms.settings.label}
                options={RADIO_SETTINGS.map((v) => ({ value: v, label: tx().comms.settings.options[v] }))}
                value={s.radio}
                onChange={(radio) => set({ radio })}
              />
            </span>
            <span class="st-value">
              <Key>L</Key>
            </span>
          </div>
        </div>
      </section>

      <section class="st-section">
        <Heading>{t().display}</Heading>
        <div class="st-rows">
          <div class="st-row">
            <span class="st-name">{t().reducedMotion}</span>
            <span data-testid="set-motion">
              <Segmented
                label={t().reducedMotion}
                options={(['system', 'on', 'off'] as const).map((v) => ({ value: v, label: t().motion[v] }))}
                value={s.reducedMotion}
                onChange={(reducedMotion) => set({ reducedMotion })}
              />
            </span>
            <span />
          </div>
          <Toggle label={tx().flight.settings.flightMarker} value={s.flightMarker} testId="set-flight-marker" onChange={(flightMarker) => set({ flightMarker })} />
          <Toggle label={tx().flight.settings.cameraShake} value={s.cameraShake} testId="set-camera-shake" onChange={(cameraShake) => set({ cameraShake })} />
          <Toggle label={tx().flight.settings.combatZoom} value={s.combatZoom} testId="set-combat-zoom" onChange={(combatZoom) => set({ combatZoom })} />
          <Toggle label={tx().guild.notes.inFlight} value={s.notesInFlight} testId="set-notes-in-flight" onChange={(notesInFlight) => set({ notesInFlight })} />
          <div class="st-row" title={tx().graphics.hint}>
            <span class="st-name">{tx().graphics.label}</span>
            <span data-testid="set-graphics">
              <Segmented
                label={tx().graphics.label}
                options={GRAPHICS_SETTINGS.map((v) => ({ value: v, label: tx().graphics.options[v] }))}
                value={s.graphicsQuality}
                onChange={(graphicsQuality) => set({ graphicsQuality })}
              />
            </span>
            <span class="st-value" data-testid="set-graphics-level">
              {s.graphicsQuality === 'auto' && data.graphicsLevel ? tx().graphics.autoPicked(tx().graphics.levels[data.graphicsLevel]) : ''}
            </span>
          </div>
          <Toggle
            label={tx().graphics.dynamicResolution.label}
            hint={tx().graphics.dynamicResolution.hint}
            value={s.dynamicResolution}
            testId="set-dynamic-resolution"
            onChange={(dynamicResolution) => set({ dynamicResolution })}
          />
          <Toggle
            label={tx().graphics.hullShell.label}
            hint={tx().graphics.hullShell.hint}
            value={s.hullShell}
            testId="set-hull-shell"
            onChange={(hullShell) => set({ hullShell })}
          />
          <Slider
            label={tx().graphics.background.label}
            hint={tx().graphics.background.hint}
            value={s.backgroundBrightness}
            min={0}
            max={1}
            step={0.05}
            testId="set-background"
            format={percent}
            onChange={(backgroundBrightness) => set({ backgroundBrightness })}
          />
          <Slider
            label={tx().graphics.uiScale.label}
            hint={tx().graphics.uiScale.hint}
            value={s.uiScale}
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={0.05}
            testId="set-ui-scale"
            format={percent}
            onChange={(uiScale) => set({ uiScale })}
          />
          <div class="st-row">
            <span class="st-name">{t().language}</span>
            <span data-testid="set-language">
              <Segmented
                label={t().language}
                options={LOCALES.map((l) => ({ value: l, label: <span lang={l}>{LOCALE_NAMES[l]}</span> }))}
                value={s.language}
                onChange={(language) => set({ language })}
              />
            </span>
            <span />
          </div>
        </div>
      </section>

      <section class="st-section">
        <Heading>{t().storage}</Heading>
        <Panel material="screen" cut="sm" class="st-status" testId="set-storage">
          <Lamp state={!storage.available ? 'bad' : storage.persistent === false ? 'warn' : storage.persistent ? 'ok' : 'off'} />
          <span>
            {!storage.available ? t().unavailable : storage.persistent === null ? t().notYet : storage.persistent ? t().persistent : t().bestEffort}
          </span>
        </Panel>
        {storage.available && storage.persistent === false && <p class="pl-hint">{tx().app.storage.bestEffort}</p>}
      </section>
    </Sheet>
  );
}
