// UI kit (ui-kit.html): the sector HUD of stage 1a – the badge in each security with its knowledge
// glyph, and the entry notice (static, without the fade); stage 1b: the map's sector card in each security.
import { tx } from '../../i18n';
import { SECURITIES, type Knowledge, type Security } from '../../sim/regions/constants';
import type { Threat } from '../../sim/regions/sectors';
import { Panel } from '../theme';
import { EntryNotice, SectorBadge, type SectorBadgeData } from './SectorHud';
import { SectorCard } from './SectorCard';
import type { SectorCardData } from './sectorCardData';

const SAMPLES: Record<Security, { adjective: number; noun: number; knowledge: Knowledge; threat: Threat; depth: number }> = {
  quiet: { adjective: 0, noun: 4, knowledge: 'charted', threat: 'none', depth: 1 },
  guarded: { adjective: 6, noun: 10, knowledge: 'reported', threat: 'rare', depth: 2 },
  contested: { adjective: 3, noun: 8, knowledge: 'uncharted', threat: 'often', depth: 2 },
  pirate: { adjective: 1, noun: 0, knowledge: 'reported', threat: 'nest', depth: 3 },
};

function badge(security: Security): SectorBadgeData {
  const t = tx().sectors;
  const s = SAMPLES[security];
  return {
    id: `kit:${security}`,
    name: t.generated(s.adjective, s.noun),
    security,
    securityWord: t.security[security],
    threat: t.threatLine(t.threat[s.threat]),
    knowledge: s.knowledge,
    glyph: t.glyph[s.knowledge],
    depth: t.depth(s.depth, tx().rings[s.depth - 1] ?? ''),
  };
}

/** A sample card (the map builds it from the sector, sectorCardData.ts). */
function card(security: Security, i: number): SectorCardData {
  const t = tx().sectors;
  const c = t.card;
  const b = badge(security);
  const s = SAMPLES[security];
  const u = tx().hud.distanceUnit;
  const biomes = ['asteroidField', 'rustField', 'wreckField', 'crystalNebula'] as const;
  const routes: SectorCardData['route'][] = [
    { home: c.routeHome },
    { line: c.route(1, `1,850 ${u}`), risks: [], clear: c.routeClear },
    { line: c.route(3, `4,300 ${u}`), risks: [{ risk: 'contested', text: c.count(1, t.security.contested) }, { risk: 'unknown', text: c.count(1, c.unknownWord) }], clear: null },
    { line: c.route(4, `6,900 ${u}`), risks: [{ risk: 'pirate', text: c.count(2, t.security.pirate) }, { risk: 'contested', text: c.count(1, t.security.contested) }], clear: null },
  ];
  return {
    id: b.id,
    known: true,
    name: b.name,
    security,
    securityWord: b.securityWord,
    threat: b.threat,
    depth: b.depth,
    environment: `${c.environment}: ${t.biome[biomes[i]!]}`,
    knowledge: s.knowledge,
    mapping: c.mapping(t.glyph[s.knowledge], t.knowledge[s.knowledge], [100, 35, 0, 12][i]!),
    survey: i === 0 ? null : { line: t.charts.cardPoints(i - 1, 4), done: i - 1, total: 4 },
    chart: [null, t.charts.cardGuild('450 cr'), t.charts.cardToChart('250 cr'), t.charts.cardSold][i] ?? null,
    here: i === 0,
    stations: i === 1 ? ['Cobalt 7'] : [],
    landmarks: i === 3 ? [t.landmarks.crystal_spire[0]!] : [],
    route: routes[i]!,
  };
}

export function KitSectors() {
  const t = tx().sectors;
  return (
    <Panel material="band" cut="lg" as="section" class="kit-section">
      <h2 class="kit-h2">Sectors (stage 1a)</h2>
      <p class="kit-note">
        The sector badge at top left (replaces the ring badge) and the entry notice. Security = colour + pattern: Quiet grey-blue with no fill, Guarded green, Contested amber dots,
        Pirate red hatching.
      </p>
      <div class="kit-sector-badges" style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
        {SECURITIES.map((s) => (
          <SectorBadge key={s} d={badge(s)} />
        ))}
      </div>
      <div style={{ display: 'grid', gap: '0.6rem', marginTop: '1rem', justifyItems: 'start' }}>
        {(['guarded', 'pirate'] as const).map((s, i) => (
          <EntryNotice
            key={s}
            static
            d={{ seq: i, name: badge(s).name, security: s, securityWord: t.security[s], glyph: t.glyph[SAMPLES[s].knowledge], entry: t.entry }}
          />
        ))}
      </div>
      <p class="kit-note">The sector card on the map (stage 1b): the mouse shows it, a click pins it. The route home samples the sectors along the straight line.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start' }} data-testid="kit-sector-cards">
        {SECURITIES.map((s, i) => (
          <SectorCard key={s} static pinned={false} d={card(s, i)} />
        ))}
        <SectorCard
          static
          pinned={false}
          d={{
            ...card('contested', 2),
            known: false,
            name: t.card.unknown,
            security: null,
            securityWord: '',
            threat: '',
            environment: null,
            knowledge: 'uncharted',
            mapping: t.card.mapping(t.glyph.uncharted, t.knowledge.uncharted, 0),
          }}
        />
      </div>
    </Panel>
  );
}
