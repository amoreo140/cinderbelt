// Radar legend (readability pass R7): the radar grammar with samples drawn by the radar's own glyph
// functions – in the controls help (K) and as a card when the pointer is over the radar.
import { useEffect, useRef } from 'preact/hooks';
import { tx } from '../i18n';
import { prepareCanvas } from './canvasDraw';
import { pure } from './pure';
import { Panel } from './theme';
import { RADAR_LEGEND, type RadarGlyph } from './radar';
import { drawRadarGlyph } from './radarDraw';
import './radarLegend.css';

const GLYPH_SIZE = 22;

function GlyphSample({ glyph }: { glyph: RadarGlyph }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas && prepareCanvas(canvas, GLYPH_SIZE);
    if (!ctx) return;
    ctx.clearRect(0, 0, GLYPH_SIZE, GLYPH_SIZE);
    drawRadarGlyph(ctx, glyph, GLYPH_SIZE / 2, GLYPH_SIZE / 2);
  }, [glyph]);
  return <canvas ref={ref} class="af-radar-legend-glyph" style={{ width: `${GLYPH_SIZE}px`, height: `${GLYPH_SIZE}px` }} aria-hidden="true" />;
}

/**
 * The legend as its own panel above the radar: `help` pinned while the controls help (K) is open,
 * `hover` while the pointer is on the radar – it must be the radar panel's next sibling (shown by
 * `.hud-radar:hover + …`; a child would be clipped by the panel's cut corners).
 */
export const RadarLegend = pure(RadarLegendView);

/** The name of a glyph: the M4b world sites have theirs in the `world` texts, the M4d Guild ones in `guild`. */
function glyphName(g: RadarGlyph): string {
  const t = tx().discovery.radarLegend;
  const sites = tx().world.map.radar;
  const guild = tx().guild;
  switch (g) {
    case 'derelict':
    case 'graveyard':
    case 'comet':
      return sites[g];
    case 'guildWatch':
      return guild.watch.radar;
    case 'convoy':
      return guild.convoy.radar;
    case 'guildRelay':
      return guild.relay.radar;
    default:
      return t[g];
  }
}

function RadarLegendView({ variant }: { variant: 'help' | 'hover' }) {
  const t = tx().discovery.radarLegend;
  return (
    <Panel material="band" translucent cut="md" trim={variant === 'hover' ? 'top' : 'none'} class={`af-radar-legend af-radar-legend--${variant}`} testId={`radar-legend-${variant}`} aria-label={t.hover}>
      <div class="af-radar-legend-head">
        <span class="af-radar-legend-title">{variant === 'help' ? t.title : t.hover}</span>
        <span class="af-radar-legend-rule">{t.rule}</span>
      </div>
      <ul class="af-radar-legend-list">
        {RADAR_LEGEND.map((g) => (
          <li key={g} data-glyph={g}>
            <GlyphSample glyph={g} />
            <span>{glyphName(g)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
