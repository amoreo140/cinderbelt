// Test helpers for derelicts, berths and terminals (not used by the game).
import { flyingAt, run } from '../discovery/testing';
import type { Simulation } from '../Simulation';
import { dockPose } from '../station/dock';
import { derelictDockTarget } from './berth';
import { sitesInChunk } from './placement';
import type { DerelictSite } from './types';

/** The derelict nearest to home of this seed that passes `filter` (chunks spiralling out to `r`). */
export function findDerelict(seed: number, filter: (d: DerelictSite) => boolean = () => true, r = 30): DerelictSite {
  const all: DerelictSite[] = [];
  for (let cx = -r; cx <= r; cx++) {
    for (let cy = -r; cy <= r; cy++) {
      for (const s of sitesInChunk(seed, cx, cy)) if (s.kind === 'derelict' && filter(s)) all.push(s);
    }
  }
  all.sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y));
  const found = all[0];
  if (!found) throw new Error(`no derelict for seed ${seed}`);
  return found;
}

/** Powers `n` relays of the derelict (all by default). */
export function powerRelays(sim: Simulation, site: DerelictSite, n = site.relays.length): void {
  for (const r of site.relays.slice(0, n)) sim.state.sites.powered.add(r.id);
}

/** A ship sitting still exactly at the derelict's dock pose (bow at the clamp), flying. */
export function atClamp(seed: number, site: DerelictSite): Simulation {
  const sim = flyingAt(seed, site.pos);
  const pose = dockPose(derelictDockTarget(site), sim.state.player.props.boundingRadius);
  sim.state.player.body = pose;
  sim.state.player.prevBody = pose;
  sim.state.world.update(pose.pos);
  return sim;
}

/** A ship berthed (latched) at the derelict: all relays powered, F at the dock pose, one second of latch. */
export function berthedAt(seed: number, site: DerelictSite): Simulation {
  const sim = atClamp(seed, site);
  powerRelays(sim, site);
  run(sim, 1, { dock: true });
  if (sim.state.sites.berth !== site.id) throw new Error('berth failed');
  run(sim, 60);
  return sim;
}
