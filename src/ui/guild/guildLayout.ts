// Pure layout of the Guild status chips (M4d plan T11): the relay chain's three step pips, the lamps by
// state and the convoy hull bars of the escort chip. The view model (`GuildStatusData`) comes from the
// game layer (T9); this file only lays it out.
import type { GuildEscortStatus, GuildRelayStatus } from '../../game/guild/types';

export type StepState = 'done' | 'current' | 'todo';
export type ChipLamp = 'ok' | 'warn' | 'info';

/** The relay chain's steps (repair → power → hold) for a stage. */
export function relaySteps(stage: GuildRelayStatus['stage']): [StepState, StepState, StepState] {
  switch (stage) {
    case 'broken':
      return ['current', 'todo', 'todo'];
    case 'repaired':
      return ['done', 'current', 'todo'];
    case 'powered':
      return ['done', 'done', 'current'];
    case 'secured':
      return ['done', 'done', 'done'];
  }
}

/** The relay chip's lamp: the hold is the dangerous part, a secured sector is done. */
export const relayLamp = (stage: GuildRelayStatus['stage']): ChipLamp => (stage === 'powered' ? 'warn' : stage === 'secured' ? 'ok' : 'info');

/** The escort chip's lamp: a stopped convoy means pirates near it. */
export const escortLamp = (state: GuildEscortStatus['state']): ChipLamp => (state === 'stopped' ? 'warn' : state === 'waiting' ? 'info' : 'ok');

/** Segments of a hull bar. */
export const HULL_SEGMENTS = 8;

/** A convoy ship's hull bar: lit segments (rounded up – a scratched ship is not a segment short) and the level. */
export function hullBar(share: number, segments = HULL_SEGMENTS): { lit: number; level: 'ok' | 'warn' | 'crit'; percent: number } {
  const s = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  return {
    lit: s <= 0 ? 0 : Math.max(1, Math.ceil(s * segments - 1e-9)),
    level: s < 0.3 ? 'crit' : s < 0.6 ? 'warn' : 'ok',
    percent: Math.round(s * 100),
  };
}
