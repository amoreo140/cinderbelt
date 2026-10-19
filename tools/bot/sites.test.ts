// Opportunistic M4b site visits of the balance bot (tools/bot/sites.ts): the pilot really powers the relays
// of a derelict, berths, takes its terminal and leaves, and analyses a graveyard wreck once.
import { describe, expect, it } from 'vitest';
import { GRAVEYARD, RELAY } from '../../src/data/sites';
import { flyingAt } from '../../src/sim/discovery/testing';
import { derelictState } from '../../src/sim/sites/derelict';
import { findDerelict } from '../../src/sim/sites/derelictTesting';
import { graveyardState } from '../../src/sim/sites/graveyardState';
import { sitesInChunk } from '../../src/sim/sites/placement';
import type { GraveyardSite, Site } from '../../src/sim/sites/types';
import type { Simulation } from '../../src/sim/Simulation';
import { BotLog, DEFAULT_BOT_OPTIONS, Pilot } from './pilot';

/** A flying ship 160 u from the site on its home side, the site known (as after a radar contact). */
function nearSite(seed: number, site: Site): { sim: Simulation; pilot: Pilot; log: BotLog } {
  const r = Math.hypot(site.pos.x, site.pos.y);
  const sim = flyingAt(seed, { x: site.pos.x * (1 - 160 / r), y: site.pos.y * (1 - 160 / r) });
  sim.state.discovery.known.add(site.id);
  const log = new BotLog();
  const pilot = new Pilot(sim, DEFAULT_BOT_OPTIONS, log);
  pilot.ring2 = true;
  pilot.mode = 'seek';
  return { sim, pilot, log };
}

function play(sim: Simulation, pilot: Pilot, seconds: number, done: () => boolean): void {
  for (let i = 0; i < seconds * 60 && !done(); i++) pilot.onEvents(sim.step(pilot.command()));
}

describe('balance bot – M4b site visits', () => {
  it('powers the three relays of a derelict without sentries, berths, takes the terminal and leaves', () => {
    // the nearest derelict without sentries (and with an item the starter's empty hold can take) away from pirates
    const seed = 1;
    const probe = nearSite(seed, findDerelict(seed));
    const site = findDerelict(seed, (d) => d.defence !== 'sentries' && d.service !== 'stash' && !probe.pilot.unsafe(d.pos));
    const { sim, pilot, log } = nearSite(seed, site);
    play(sim, pilot, 6 * 60, () => derelictState(sim.state, site.id).visited && sim.state.sites.berth === null && pilot.mode !== 'site');
    const notes = log.notes.map((n) => `${n.kind}: ${n.detail}`).join('; ');
    expect(log.counts['siteVisit:derelict'], notes).toBe(1);
    expect(site.relays.filter((r) => sim.state.sites.powered.has(r.id))).toHaveLength(RELAY.count);
    expect(derelictState(sim.state, site.id).visited, notes).toBe(true);
    expect(derelictState(sim.state, site.id).taken, notes).toBeGreaterThan(0);
    expect(sim.state.discovery.dataTotal).toBeGreaterThanOrEqual(80);
    expect(sim.state.sites.berth).toBeNull();
    expect(sim.state.player.destroyed).toBe(false);
  });

  it('analyses one wreck of a graveyard from outside the field and gets its Data once', () => {
    const seed = 1;
    let site: GraveyardSite | null = null;
    for (let cx = -15; cx <= 15 && !site; cx++) {
      for (let cy = -15; cy <= 15 && !site; cy++) {
        for (const s of sitesInChunk(seed, cx, cy)) if (s.kind === 'graveyard' && s.sleepers.length === 0) site = s;
      }
    }
    expect(site).not.toBeNull();
    const { sim, pilot, log } = nearSite(seed, site!);
    play(sim, pilot, 4 * 60, () => graveyardState(sim.state, site!.id).data && pilot.mode !== 'site');
    const notes = log.notes.map((n) => `${n.kind}: ${n.detail}`).join('; ');
    expect(log.counts['siteVisit:graveyard'], notes).toBe(1);
    expect(log.counts.graveyardAnalysed, notes).toBe(1);
    expect(sim.state.discovery.dataTotal).toBe(GRAVEYARD.data);
    expect(sim.state.player.destroyed).toBe(false);
  });
});
