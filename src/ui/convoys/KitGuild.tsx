// UI kit (ui-kit.html): M4d "Guild and trade" flight UI (plan T11) – the convoy trade window in every item
// state on a 1280 × 720 screen, the flight HUD with the Guild chips under a convoy flyby chip, the Guild
// glyphs on the radar and the navigation marks (route, notes, convoy, relay) at the edge, every status
// chip state and the relay / escort board slips. A language switch re-renders the section in SK or EN.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ConvoyTradeData, ConvoyTradeHandlers } from '../../game/convoys/types';
import { getLocale, setLocale, type Locale } from '../../i18n/locale';
import { tx } from '../../i18n';
import { assetUrl } from '../../render/assets/url';
import { Slip } from '../board/Slip';
import { flightHudRects, navArrows, type NavMark } from '../edgeArrows';
import { GuildStatus } from '../guild/GuildStatus';
import { Hud, type HudData } from '../Hud';
import { buildGuildContacts, buildSiteContacts } from '../radar';
import { EventChip } from '../sites/EventChip';
import { Button, Panel, Segmented } from '../theme';
import { ConvoyTrade } from './ConvoyTrade';
import { kitConvoyChip, kitGuildStatus, kitSlips, kitTrades } from './guildKitFixtures';

/** One interactive trade window: buying marks the item sold, selling lowers what the convoy takes; unlinking resets it. */
function KitTrade({ d: initial }: { d: ConvoyTradeData }) {
  const [d, setD] = useState(initial);
  const on: ConvoyTradeHandlers = {
    buy: (slot) =>
      setD((s) => {
        const item = s.items.find((i) => i.slot === slot);
        if (!item) return s;
        return { ...s, credits: s.credits - item.price, items: s.items.map((i) => (i.slot === slot ? { ...i, state: 'sold', reason: tx().guild.trade.reasons.sold } : i)) };
      }),
    sell: (resource, qty) =>
      setD((s) => {
        const row = s.sell.find((r) => r.resource === resource);
        if (!row) return s;
        const n = Math.min(qty === 'all' ? row.max : qty, row.max, s.capLeft);
        const capLeft = s.capLeft - n;
        return { ...s, capLeft, sell: s.sell.map((r) => (r.resource === resource ? { ...r, max: r.max - n, refined: Math.max(0, r.refined - n) } : { ...r, max: Math.min(r.max, capLeft) })) };
      }),
    fuel: () => setD((s) => (s.fuel ? { ...s, fuel: { ...s.fuel, max: 0, reason: tx().guild.trade.reasons.tankFull } } : s)),
    unlink: () => setD(initial),
  };
  // as in the game: the dialog with its backdrop, the focus kept in the sheet, F / Esc unlink (= reset here)
  return <ConvoyTrade d={d} on={on} />;
}

/** The game screen the kit's flight HUD stands for (the kit frame may be narrower – `kitHud` gets its size). */
const VIEW = { width: 1280, height: 720 };

/** The flight HUD of the kit: ring 2, a convoy and a Watch cutter on the radar, a Guild relay site. */
function kitHud(helpOpen: boolean, view: { width: number; height: number } = VIEW): HudData {
  const center = { x: 0, y: 0 };
  const marks: { screen: { x: number; y: number; behind?: boolean }; item: NavMark }[] = [
    { screen: { x: 1900, y: 250 }, item: { key: 'route', kind: 'route', title: tx().guild.route.title, distance: 1240, seconds: 52 } },
    { screen: { x: -600, y: 420 }, item: { key: 'n1', kind: 'note', icon: 'ore', title: 'rich in Ti, pirates', distance: 820 } },
    { screen: { x: 760, y: -900 }, item: { key: 'n2', kind: 'note', icon: 'star', title: 'Echo?', distance: 2400 } },
    { screen: { x: 300, y: 1400 }, item: { key: 'relay', kind: 'relay', title: tx().guild.relay.name, distance: 1650 } },
    { screen: { x: 720, y: 430 }, item: { key: 'cv', kind: 'convoy', title: tx().guild.convoy.arrow, distance: 140 } },
  ];
  return {
    speed: 9.6,
    dampers: true,
    fuel: 64,
    fuelMax: 120,
    energy: 48,
    energyMax: 60,
    cargo: { iron: 62, copper: 20, ice: 8, titanium: 0 },
    cargoMax: 130,
    ring: 2,
    pos: { x: 1640, y: 220 },
    angle: 0.4,
    radar: {
      range: 220,
      contacts: [
        { x: 60, y: -40, radius: 6, color: '#ff7a4d' },
        { x: -90, y: 70, radius: 8, color: '#8fe3ff' },
      ],
      stations: [{ x: -180, y: -120, kind: 'station', edge: true }],
    },
    map: { open: false, explored: [], stations: [] },
    message: null,
    credits: 6240,
    prompt: null,
    nearest: { name: 'Vega Anchor', distance: 1840 },
    arrow: null,
    helpOpen,
    discovery: {
      radar: { signals: [], places: [], sites: buildSiteContacts({ derelicts: [], graveyards: [], mines: [], comets: [], guildRelays: [{ pos: { x: -60, y: -150 }, lit: false }] }, center, 220) },
      callouts: [],
    },
    radarGuild: buildGuildContacts(
      {
        convoys: [
          { pos: { x: 70, y: 40 }, angle: 0.5 },
          { pos: { x: 56, y: 32 }, angle: 0.5, tanker: true },
        ],
        watch: [{ pos: { x: 110, y: 90 }, angle: 2.2 }],
      },
      center,
      220,
    ),
    // the HUD panels as the game measures them at 1280 × 720 (the kit page holds several HUDs)
    // (the arrows sit at the edges of the kit frame as it is drawn, so their labels fit in it)
    navArrows: navArrows(marks, view, { avoid: flightHudRects(view, { nav: { width: 470, height: 110 }, topRight: { width: 110, height: 90 }, chipsBottom: 290, radio: null }) }),
  };
}

/** The size of the element `ref` points to (VIEW until measured), kept current on resize. */
function useFrameSize(ref: { current: HTMLElement | null }): { width: number; height: number } {
  const [size, setSize] = useState(VIEW);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      setSize((s) => (Math.abs(s.width - r.width) < 1 && Math.abs(s.height - r.height) < 1 ? s : { width: r.width, height: r.height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function FlightScreen({ helpOpen }: { helpOpen: boolean }) {
  const status = { escort: kitGuildStatus()[2]!.d.escort, relay: kitGuildStatus()[6]!.d.relay };
  const ref = useRef<HTMLDivElement>(null);
  const view = useFrameSize(ref);
  return (
    <div ref={ref} class="kit-screen" style={{ backgroundImage: `url(${assetUrl('assets/skybox/ring2_bg.webp')})` }} data-testid="kit-cech-flight">
      <Hud {...kitHud(helpOpen, view)} />
      <EventChip chips={[kitConvoyChip()]} />
      <GuildStatus d={status} />
    </div>
  );
}

export function KitGuild() {
  const [lang, setLang] = useState<Locale>(getLocale());
  const [trade, setTrade] = useState('open');
  const [help, setHelp] = useState(false);
  const switchLang = (l: Locale) => {
    setLocale(l);
    setLang(l);
  };
  const trades = kitTrades();
  const shown = trades.find((t) => t.id === trade) ?? trades[0]!;
  return (
    <Panel material="band" cut="lg" as="section" class="kit-section" testId="kit-cech">
      <h2 class="kit-h2">Guild and trade - flight (M4d)</h2>
      <p class="kit-note">
        Convoy trade: a plate in a dark frame like a terminal, rarities on the left (each once per flyby, the reason shown when unavailable), cargo sales on the right
        (refined ore first, the convoy takes at most 200 u) and fuel from the tanker. F and Esc both unlink the ship. Clicking “Buy” / “Sell” changes the state here.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '0.8rem' }}>
        <Segmented
          label="Language"
          options={[
            { value: 'sk', label: 'SK' },
            { value: 'en', label: 'EN' },
          ]}
          value={lang}
          onChange={switchLang}
        />
        <Segmented label="Trade" options={trades.map((t) => ({ value: t.id, label: t.id }))} value={trade} onChange={setTrade} />
        <Button size="sm" variant="ghost" onClick={() => setHelp((h) => !h)} testId="kit-cech-help">
          {help ? 'Help K: collapse' : 'Help K: expand'}
        </Button>
      </div>
      <span class="af-label" style={{ color: 'var(--af-text-dim)' }}>
        {shown.label}
      </span>
      <div
        key={`${lang}-${trade}`}
        class="kit-screen"
        style={{ backgroundImage: `url(${assetUrl('assets/skybox/ring2_bg.webp')})`, marginBottom: '1rem' }}
        data-testid="kit-cech-trade"
      >
        <KitTrade d={shown.d} />
      </div>

      <p class="kit-note">
        Flight: the convoy flyby chip, under it the escort and Guild relay status; on the radar the Guild Watch (green), the convoy (a blue trader with a tanker) and the relay
        (orange); at the edge the route, marks and relay, a pin on the convoy when it is in view. No fire on the Guild - no warning or fine anywhere.
      </p>
      <div key={`f-${lang}-${help}`} style={{ marginBottom: '1rem' }}>
        <FlightScreen helpOpen={help} />
      </div>

      <div key={`c-${lang}`} style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fill, minmax(21rem, 1fr))', marginBottom: '1rem' }} data-testid="kit-cech-chips">
        {kitGuildStatus().map((row) => (
          <div key={row.label} style={{ display: 'grid', gap: '0.25rem', alignContent: 'start' }}>
            <span class="af-label" style={{ color: 'var(--af-text-dim)' }}>
              {row.label}
            </span>
            <GuildStatus d={row.d} inline />
          </div>
        ))}
        <div style={{ display: 'grid', gap: '0.25rem', alignContent: 'start' }}>
          <span class="af-label" style={{ color: 'var(--af-text-dim)' }}>
            Convoy flyby - ETA
          </span>
          <EventChip chips={[kitConvoyChip()]} inline />
        </div>
      </div>

      <div key={`s-${lang}`} class="kit-slips af-on-plate" data-testid="kit-cech-slips">
        {kitSlips().map((s) => (
          <div key={s.d.key} style={{ display: 'grid', gap: '0.3rem', alignContent: 'start' }}>
            <span class="af-label" style={{ color: 'var(--af-ink-soft)' }}>
              {s.label}
            </span>
            <Slip d={s.d} from={null} actions={s.d.state === 'offer' ? <Button size="sm">{tx().goals.slip.accept}</Button> : undefined} />
          </div>
        ))}
      </div>
    </Panel>
  );
}
