// World sites on the map and the radar (M4b T10 view models; T7 wires the rest of the sites UI):
// known derelict stations (with their relays' power) and ship graveyards for the map, and every site
// near the ship for the radar – a site is a radar contact when in range, known or not (like the POIs).
import { DERELICT_LAYOUTS, GRAVEYARD, RELAY } from '../../data/sites';
import { tx } from '../../i18n';
import type { Vec2 } from '../../sim/math/vec2';
import { cometsNear, siteById, sitesNear } from '../../sim/sites';
import { liveMines } from '../../sim/sites/mines';
import type { SimState } from '../../sim/Simulation';
import type { SiteRadarInput } from '../../ui/radar';
import type { SiteMapData } from './types';
import { relayRadarInput } from '../guild/guildView';

/** A known site on the map: the T0 view model plus its label and (derelicts) the relays and their power. */
export interface MapSite extends SiteMapData {
  /** "Derelict station · relay 1/3", "Ship graveyard". */
  label: string;
  /** Derelicts: each relay mast and whether it is powered. */
  relays?: { pos: Vec2; lit: boolean }[];
}

/** Known derelicts and graveyards (ids in `discovery.known`), in the order they became known. */
export function siteMapData(state: SimState): MapSite[] {
  const out: MapSite[] = [];
  const m = tx().world.map;
  for (const id of state.discovery.known) {
    if (!id.startsWith('dl:') && !id.startsWith('gy:')) continue;
    const site = siteById(state.seed, id);
    if (!site) continue;
    if (site.kind === 'graveyard') {
      out.push({ id, kind: 'graveyard', pos: site.pos, label: m.graveyard });
      continue;
    }
    const relays = site.relays.map((r) => ({ pos: r.pos, lit: state.sites.powered.has(r.id) }));
    const lit = relays.filter((r) => r.lit).length;
    out.push({ id, kind: 'derelict', pos: site.pos, relaysLit: lit, relays, label: `${m.derelict} · ${m.relays(lit, RELAY.count)}` });
  }
  return out;
}

/**
 * Sites near the ship for the radar (`buildSiteContacts` cuts them to the range): derelicts with their
 * relays' power, graveyards with their live mines (gone ones left out), comet nuclei in their pass, the
 * M4d Guild relay masts.
 */
export function siteRadarInput(state: SimState, range: number): SiteRadarInput {
  const pos = state.player.body.pos;
  const input: { derelicts: SiteRadarInput['derelicts'][number][]; graveyards: { pos: Vec2; radius: number }[]; mines: { pos: Vec2; armed?: boolean }[]; comets: { pos: Vec2 }[] } = {
    derelicts: [],
    graveyards: [],
    mines: [],
    comets: [],
  };
  for (const site of sitesNear(state.seed, pos, range + GRAVEYARD.radius)) {
    if (site.kind === 'derelict') {
      input.derelicts.push({
        pos: site.pos,
        radius: DERELICT_LAYOUTS[site.model].radius,
        relays: site.relays.map((r) => ({ pos: r.pos, lit: state.sites.powered.has(r.id) })),
      });
      continue;
    }
    input.graveyards.push({ pos: site.pos, radius: GRAVEYARD.radius });
  }
  // live mines (gone ones left out); an armed one (its fuse burning) blinks
  for (const m of liveMines(state, pos, range + GRAVEYARD.radius)) input.mines.push({ pos: m.pos, armed: m.fuse !== null });
  for (const c of cometsNear(state.seed, pos, range + 20, state.tick)) input.comets.push({ pos: c.pos });
  // M4d: the Guild relay masts (lit = powered or secured)
  const guildRelays = relayRadarInput(state, pos, range);
  return guildRelays.length > 0 ? { ...input, guildRelays } : input;
}
