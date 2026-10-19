// Radio lines on entering a sector (sectors design §3.1, stage 1b):
// on the first visit of a sector (the full entry notice – entryNotice.ts decides it) the communicator
// says something about where the ship is now:
//  - Guarded: the Guild Watch welcomes the pilot ("Vitaj v sektore X…");
//  - Contested / Pirate: a warning – home traffic control, or the Guild instructor during the training;
//  - Pirate: in some nests (by a hash of the seed and the sector id) a pirate taunts after the warning.
// Quiet sectors stay silent (only the notice and its tone). Each kind is throttled by game time, so a
// flight along a border of many new sectors does not flood the radio. Variants are picked by a hash of
// the tick and the sector (no Math.random); presentation memory only, nothing is saved.
import type { Security } from '../../sim/regions/constants';
import type { SectorsTexts } from '../../i18n/skSectors';
import type { CommsChannel, CommsMessage, CommsText, Speaker } from '../comms/types';
import { hashText, pickLine } from '../comms/variants';

const TICKS = 60;

/** Minimum spacing of two radio lines of one kind (s of game time). */
export const SECTOR_RADIO_GAP = { welcome: 90, warn: 45, taunt: 180 } as const;
export type SectorRadioKind = keyof typeof SECTOR_RADIO_GAP;

/** Share of the pirate sectors where a pirate taunts on the first entry. */
export const TAUNT_SHARE = 0.5;

/** Does a pirate taunt in this sector (stable for the seed)? */
export const tauntsIn = (seed: number, id: string): boolean => hashText(`taunt|${seed}|${id}`) / 0x1_0000_0000 < TAUNT_SHARE;

/** A first entry into a sector. */
export interface SectorRadioEntry {
  seed: number;
  id: string;
  /** Player-facing name of the sector. */
  name: string;
  security: Security;
  /** The fortress commander's voice (a Rust nest) rather than a jackal. */
  hammer: boolean;
  /** The Guild training runs: the instructor warns, nobody taunts. */
  training: boolean;
  tick: number;
}

/** Who can speak (resolved by the caller in the current language). */
export interface SectorRadioVoices {
  watch: Speaker;
  traffic: Speaker;
  instructor: Speaker;
  jackal: Speaker;
  hammer: Speaker;
}

/** The voices, the radio texts and the sector's name in one language. */
export interface SectorRadioLanguage {
  voices: SectorRadioVoices;
  t: SectorsTexts['radio'];
  name: string;
}

/** Display time of a line after it is typed out (s) – longer lines stay a little longer. */
const ttlOf = (text: string): number => 3.5 + Math.min(3, text.length / 40);

export class SectorRadio {
  private readonly last: Record<SectorRadioKind, number> = { welcome: -Infinity, warn: -Infinity, taunt: -Infinity };

  /** Forget the throttle (a new game or a loaded save). */
  reset(): void {
    this.last.welcome = this.last.warn = this.last.taunt = -Infinity;
  }

  /**
   * The lines for a first entry, in the order they should play ([] = nothing to say now). `current`
   * gives the voices, texts and sector name in the language of the moment: a live language switch
   * re-renders the lines through it (`retext`).
   */
  enter(e: SectorRadioEntry, voices: SectorRadioVoices, t: SectorsTexts['radio'], current?: () => SectorRadioLanguage): CommsMessage[] {
    const now = e.tick / TICKS;
    const out: CommsMessage[] = [];
    type Variants = readonly ((name: string) => string)[];
    const say = (kind: SectorRadioKind, voice: (v: SectorRadioVoices) => Speaker, variants: (r: SectorsTexts['radio']) => Variants, channel: CommsChannel): void => {
      if (now - this.last[kind] < SECTOR_RADIO_GAP[kind]) return;
      this.last[kind] = now;
      const key = `sector:${kind}:${e.id}`;
      const build = (l: SectorRadioLanguage): CommsText => ({ speaker: voice(l.voices), lines: [pickLine(variants(l.t), e.tick, key)(l.name)] });
      const first = build({ voices, t, name: e.name });
      const msg: CommsMessage = { id: `${key}@${e.tick}`, key, ...first, channel, ttl: ttlOf(first.lines[0]!), tick: e.tick };
      if (current) msg.retext = () => build(current());
      out.push(msg);
    };
    switch (e.security) {
      case 'guarded':
        say('welcome', (v) => v.watch, (r) => r.welcome, 'station');
        break;
      case 'contested':
        if (e.training) say('warn', (v) => v.instructor, (r) => r.warnContestedInstructor, 'training');
        else say('warn', (v) => v.traffic, (r) => r.warnContested, 'station');
        break;
      case 'pirate':
        if (e.training) say('warn', (v) => v.instructor, (r) => r.warnPirateInstructor, 'danger');
        else {
          say('warn', (v) => v.traffic, (r) => r.warnPirate, 'danger');
          if (tauntsIn(e.seed, e.id)) say('taunt', (v) => (e.hammer ? v.hammer : v.jackal), (r) => r.taunt, 'danger');
        }
        break;
      case 'quiet':
        break;
    }
    return out;
  }
}
