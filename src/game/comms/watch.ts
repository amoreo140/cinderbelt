// Messages from where the ship is, not from a single event: a station's traffic control greets a ship
// entering its zone, a Rust fortress raises the alarm when the ship comes in turret range, the Guild
// Watch reports when its reinforcement reaches a relay hold (M4d – the sim has no event for it). The watcher
// remembers which zones the ship is in (presentation memory, not saved); the first look only records
// them, so a loaded game or an undock does not greet the ship it already holds.
import { length, sub } from '../../sim/math/vec2';
import { fortressAlive, fortressStatus } from '../../sim/pirates/fortress';
import { fortressSites } from '../../sim/pirates/sites';
import type { SimState } from '../../sim/Simulation';
import { tx } from '../../i18n';
import type { CommsTexts } from '../../i18n/skComms';
import { watchSpeaker } from './mapper';
import { fortressSpeaker, stationSpeaker } from './speakers';
import type { CommsMessage, CommsText } from './types';
import { pickLine } from './variants';

/** A station greets a ship this close (u) … */
export const ZONE_ENTER = 260;
/** … and forgets it beyond this (hysteresis). */
export const ZONE_LEAVE = 340;
/** The fortress alarm range (u) and its reset. */
export const FORTRESS_ALARM = 400;
export const FORTRESS_RESET = 480;

export class CommsWatch {
  private inside = new Set<string>();
  private primed = false;

  /** Messages for zones entered since the last call. */
  update(state: SimState, t: CommsTexts): CommsMessage[] {
    const player = state.player;
    if (player.dock.mode !== 'flying' || player.destroyed) {
      // docked (or towed) inside a station's zone: leaving the dock must not greet the ship again
      if (player.dock.mode !== 'flying') this.primed = false;
      return [];
    }
    const pos = player.body.pos;
    const now = new Set<string>();
    const entered: CommsMessage[] = [];
    const tick = state.tick;
    for (const s of state.world.stations()) {
      const d = length(sub(s.pos, pos));
      const key = `zone:${s.id}`;
      const was = this.inside.has(key);
      if (d <= ZONE_ENTER || (was && d <= ZONE_LEAVE)) {
        now.add(key);
        if (!was && this.primed) {
          const text = (tt: CommsTexts): CommsText => ({ speaker: stationSpeaker(s, tt), lines: [pickLine(tt.lines.station.zone, tick, key)] });
          entered.push({ id: `${key}@${tick}`, key, ...text(t), channel: 'station', ttl: 3.5, cooldown: 180, tick, retext: () => text(tx().comms) });
        }
      }
    }
    for (const site of fortressSites(state.seed)) {
      const d = length(sub(site.pos, pos));
      const key = `fortress:${site.id}`;
      const was = this.inside.has(key);
      if (d <= FORTRESS_ALARM || (was && d <= FORTRESS_RESET)) {
        now.add(key);
        if (!was && this.primed && fortressAlive(fortressStatus(state, site.id))) {
          const text = (tt: CommsTexts): CommsText => ({ speaker: fortressSpeaker(tx().pirates.fortressName(site.index), site.id, tt), lines: [pickLine(tt.lines.fortress.alarm, tick, key)] });
          entered.push({ id: `${key}@${tick}`, key, ...text(t), channel: 'danger', ttl: 3.5, cooldown: 240, tick, retext: () => text(tx().comms) });
        }
      }
    }
    // the relay hold's Guild reinforcement has arrived (once per fight; a re-armed hold brings a new one)
    const hold = state.guild.hold;
    if (hold && hold.phase === 'fight' && hold.reinforced) {
      const key = `watch:relay:${hold.lane}`;
      now.add(key);
      if (!this.inside.has(key) && this.primed) {
        const text = (tt: CommsTexts): CommsText => ({ speaker: watchSpeaker(), lines: [pickLine(tt.lines.watch.reinforcement, tick, key)] });
        entered.push({ id: `${key}@${tick}`, key, ...text(t), channel: 'danger', ttl: 3.5, cooldown: 60, tick, retext: () => text(tx().comms) });
      }
    }
    this.inside = now;
    this.primed = true;
    return entered;
  }
}
