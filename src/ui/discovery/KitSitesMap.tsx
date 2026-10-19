// Style guide (ui-kit.html), M4b T10: the world sites on the map and the radar – a glyph sheet drawn by
// the same functions as the game (derelict with relay power, relay masts, graveyard, live mines, comet,
// pass track) and the scanner's site readouts (relay charging, derelict, comet, sleeper).
import { useEffect, useRef } from 'preact/hooks';
import type { ScanReadout } from '../../game/sites/scanReadout';
import { tx } from '../../i18n';
import { COMET_LEGEND_TAIL, drawComet, drawDerelict, drawGraveyard, drawMine, drawRelayMast, SITE_COLORS } from '../canvasDraw';
import { Panel } from '../theme';
import { drawCometArcSwatch } from './mapSites';
import { SiteReadout } from './ScanHud';

const SHEET = { w: 520, h: 96 };

function GlyphSheet() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = SHEET.w * dpr;
    canvas.height = SHEET.h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#13283c';
    ctx.fillRect(0, 0, SHEET.w, SHEET.h);
    const y = 40;
    // derelict: 0, 1 and 3 relays powered (map pips)
    drawDerelict(ctx, 30, y, 7, SITE_COLORS.derelict, { lit: 0, total: 3 });
    drawDerelict(ctx, 80, y, 7, SITE_COLORS.derelict, { lit: 1, total: 3 });
    drawDerelict(ctx, 130, y, 7, SITE_COLORS.derelict, { lit: 3, total: 3 });
    drawRelayMast(ctx, 175, y, 5, false);
    drawRelayMast(ctx, 200, y, 5, true);
    drawGraveyard(ctx, 245, y, 7, SITE_COLORS.graveyard);
    drawMine(ctx, 290, y, 3.5);
    drawMine(ctx, 315, y, 3.5, true);
    drawComet(ctx, 365, y, 7, COMET_LEGEND_TAIL, SITE_COLORS.comet);
    ctx.save();
    ctx.translate(410, y - 10);
    ctx.scale(1.4, 1.4);
    drawCometArcSwatch(ctx, 16);
    ctx.restore();
    ctx.fillStyle = '#93a0b3';
    ctx.font = '600 10px sans-serif';
    ctx.textAlign = 'center';
    const m = tx().world.map;
    for (const [x, t] of [
      [80, `${m.derelict} 0 · 1 · 3`],
      [188, m.relay],
      [245, m.graveyard],
      [302, m.mine],
      [365, m.comet],
      [430, m.passArc],
    ] as const) {
      ctx.fillText(t, x, 82);
    }
  }, []);
  return <canvas ref={ref} style={{ width: `${SHEET.w}px`, height: `${SHEET.h}px`, display: 'block' }} aria-hidden="true" />;
}

const READOUTS: ScanReadout[] = [
  { key: 'dl:1,2:r1', title: 'Relay', lines: [{ text: 'Relay 1/3 · charging 60%', tone: 'info' }], charge: 0.6 },
  {
    key: 'dl:1,2',
    title: 'Abandoned station',
    lines: [
      { text: 'relay 1/3', tone: 'info' },
      { text: 'Defence: Sentry drones · awakened', tone: 'warn' },
      { text: 'Dock clamp unpowered - power 3 relays', tone: 'info' },
    ],
    charge: null,
  },
  { key: 'cm:2', title: 'Comet K-3', lines: [{ text: 'ice 60% · titanium 40% · 220 u left', tone: 'ok' }, { text: 'tail fragments 18/24', tone: 'info' }, { text: 'speed 42 u/s', tone: 'info' }], charge: null },
  { key: 'gs:1,2:0', title: 'Wreck', lines: [{ text: 'active reactor', tone: 'warn' }, { text: 'Not a wreck - the crew is waiting', tone: 'warn' }], charge: null },
];

export function KitSitesMap() {
  return (
    <Panel material="band" cut="lg" as="section" class="kit-section">
      <h2 class="kit-h2">The world comes alive - map, radar, scanner (M4b)</h2>
      <p class="kit-note">
        Objects are hollow (radar grammar R7): abandoned station = a broken wheel (dots = powered relays, lit azure), relay = a mast with a lamp, graveyard =
        crossed hulls, live mine = a red dot in a ring (armed = a double ring), comet = a core with a tail pointing away from home, the flyby track dashed (solid
        during the flyby). The scanner readout stands to the left of the scanner.
      </p>
      <GlyphSheet />
      <div class="kit-scan" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'flex-end' }}>
        {READOUTS.map((r) => (
          <SiteReadout key={r.key} r={r} />
        ))}
      </div>
    </Panel>
  );
}
