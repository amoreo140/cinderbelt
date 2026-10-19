// Pirates and salvage in the game layer (M3.6): the attention indicator, toll demand, tractor beam
// status, fortress band, cannon reticle, callouts at hulks / fortresses / beacons, map markers and
// toasts. Game.ts only calls these methods.
import { tx } from '../../i18n';
import { FORTRESS, TOLL, attentionLevel } from '../../data/pirates';
import { captainName, stationLabel } from '../board/names';
import { cannonsCovering } from '../../sim/combat/weapons';
import type { Wreck } from '../../sim/combat/types';
import { length, sub, type Vec2 } from '../../sim/math/vec2';
import { coreShielded, fortressAlive, fortressStatus } from '../../sim/pirates/fortress';
import { fortressSites, fortressToWorld, FORTRESS_LAYOUT } from '../../sim/pirates/sites';
import { challengeCooldownUntil, pirateInteraction } from '../../sim/pirates/pirates';
import { isHulk, jointParts } from '../../sim/salvage/dismantle';
import { towable, tractorPower } from '../../sim/salvage/tractor';
import { wreckKey } from '../../sim/discovery/wrecks';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { formatCredits } from '../../ui/format';
import type { ToastKind } from '../../ui/GameUi';
import type { DockPrompt } from '../../ui/stationHud';
import { lootList } from '../combatHudState';
import type { CalloutData } from '../discovery/exploreUi';

const TICKS = 60;
/** The fortress band shows this close to a fortress (turret reach + the rock). */
const FORTRESS_BAND_RANGE = 190;

export interface AttentionHud {
  value: number;
  level: 0 | 1 | 2 | 3;
  label: string;
  hint: string;
  /** Raid / challenge line, or null. */
  raid: string | null;
}

export interface TollHud {
  amount: string;
  seconds: number;
  /** Remaining time 0..1. */
  fraction: number;
  canPay: boolean;
  escape: number;
}

export interface TractorHud {
  active: boolean;
  text: string;
  /** Rip progress 0..1 (tearing a part out of a wreck). */
  progress: number | null;
}

export interface FortressHud {
  name: string;
  /** Core HP 0..1. */
  core: number;
  shielded: boolean;
  gens: boolean[];
  turrets: boolean[];
}

export interface PirateHudData {
  attention: AttentionHud | null;
  toll: TollHud | null;
  tractor: TractorHud | null;
  fortress: FortressHud | null;
}

export interface ReticleData {
  covering: number;
  total: number;
}

export interface RadarPirate {
  x: number;
  y: number;
  kind: 'fortress' | 'beacon' | 'container';
}

export interface MapPirate {
  pos: Vec2;
  kind: 'fortress' | 'beacon' | 'raid';
  label: string;
  /** Destroyed fortress (faded). */
  down?: boolean;
}

export interface PirateToast {
  text: string;
  kind: ToastKind;
  seconds: number;
}

const clockText = (ticks: number): string => {
  const s = Math.max(0, Math.ceil(ticks / TICKS));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Short name of what the tractor holds. */
function towName(state: SimState, w: Wreck | undefined, nugget = false): string {
  if (nugget) return tx().mining.nugget.towed;
  if (!w) return tx().pirates.container;
  if (w.from) return tx().pirates.piece;
  return w.cls ? tx().discovery.wreckClasses[w.cls] : tx().discovery.scanKinds.wreck;
}

export class PiratesUi {
  /** Pirate HUD for the flight screen. */
  hud(state: SimState): PirateHudData {
    return { attention: this.attention(state), toll: this.toll(state), tractor: this.tractor(state), fortress: this.fortress(state) };
  }

  private attention(state: SimState): AttentionHud | null {
    const p = state.pirates;
    const ring = length(state.player.body.pos) >= 1500 ? 2 : 1;
    if (p.attention < 0.5 && !p.raid && ring === 1) return null;
    const level = attentionLevel(p.attention);
    let raid: string | null = null;
    if (p.raid) {
      const r = p.raid;
      const where = r.station ? stationLabel(state.seed, r.station) : tx().pirates.attention.nearYou;
      if (state.tick < r.arrive) raid = r.kind === 'challenge' ? tx().pirates.attention.challenge(clockText(r.arrive - state.tick)) : tx().pirates.attention.raid(where, clockText(r.arrive - state.tick));
      else raid = tx().pirates.attention.raidHere(r.kind === 'challenge' ? tx().pirates.beaconName : where);
    }
    const value = Math.round(p.attention);
    return { value, level, label: tx().pirates.attention.levels[level], hint: tx().pirates.attention.hint(value), raid };
  }

  private toll(state: SimState): TollHud | null {
    const t = state.pirates.toll;
    if (!t) return null;
    const left = t.until - state.tick;
    return {
      amount: formatCredits(t.amount),
      seconds: Math.max(0, Math.ceil(left / TICKS)),
      fraction: Math.max(0, Math.min(1, left / (TOLL.seconds * TICKS))),
      canPay: state.credits >= t.amount,
      escape: TOLL.escape,
    };
  }

  private tractor(state: SimState): TractorHud | null {
    const player = state.player;
    if (!tractorPower(player.props.tractors)) return null;
    const tr = player.tractor;
    if (!tr) return { active: false, text: tx().pirates.tractor.idle, progress: null };
    if (tr.rip) return { active: true, text: tx().pirates.tractor.ripping(Math.round(tr.rip.progress * 100)), progress: tr.rip.progress };
    const t = towable(state, tr.target);
    return { active: true, text: tx().pirates.tractor.holding(towName(state, t?.wreck, !!t?.nugget)), progress: null };
  }

  private fortress(state: SimState): FortressHud | null {
    const pos = state.player.body.pos;
    if (state.player.dock.mode !== 'flying') return null;
    for (const site of fortressSites(state.seed)) {
      if (length(sub(site.pos, pos)) > FORTRESS_BAND_RANGE) continue;
      const f = fortressStatus(state, site.id);
      if (!fortressAlive(f)) return null;
      return {
        name: tx().pirates.fortressName(site.index),
        core: f.core / FORTRESS.coreHp,
        shielded: coreShielded(f),
        gens: f.gens.map((hp) => hp > 0),
        turrets: f.turrets.map((hp) => hp > 0),
      };
    }
    return null;
  }

  /** How many cannons can hit the aim point now (null = no cannons or not flying). */
  reticle(state: SimState, aim: Vec2): ReticleData | null {
    const player = state.player;
    if (player.dock.mode !== 'flying' || player.destroyed || player.props.weapons.length === 0) return null;
    return cannonsCovering(player, aim);
  }

  /** Callouts at hulks (joints, cutting), the fortress and its beacon – they take precedence. */
  callouts(state: SimState): (CalloutData & { dist: number })[] {
    const player = state.player;
    if (player.dock.mode !== 'flying' || player.destroyed) return [];
    const pos = player.body.pos;
    const d = state.discovery;
    const out: (CalloutData & { dist: number })[] = [];
    for (const w of state.combat.wrecks) {
      if (!w.dismantle || !isHulk(w)) continue;
      const dist = length(sub(w.body.pos, pos));
      if (dist > 120) continue;
      const scanned = d.scanned.has(wreckKey(w));
      const joints = jointParts(w.grid).size;
      let detail = scanned ? tx().pirates.callout.joints(joints, w.dismantle.intact.length) : tx().pirates.callout.jointsUnknown;
      let progress: number | undefined;
      if (w.cutting) {
        progress = w.cutting.progress;
        detail = tx().pirates.callout.cutting(Math.round(w.cutting.progress * 100));
      }
      const c: CalloutData & { dist: number } = {
        id: wreckKey(w),
        world: w.body.pos,
        title: tx().pirates.callout.hulk,
        detail,
        keys: scanned ? 'T' : 'Tab',
        action: scanned ? tx().pirates.callout.rip : tx().discovery.callout.analyze,
        tone: w.cutting ? 'warn' : 'info',
        dist,
      };
      if (progress !== undefined) c.progress = progress;
      out.push(c);
    }
    // cut pieces: what they carry and how to get them aboard
    for (const w of state.combat.wrecks) {
      if (!w.from) continue;
      const dist = length(sub(w.body.pos, pos));
      if (dist > 60) continue;
      const parts = Object.values(w.loot.parts).reduce((s, n) => s + (n ?? 0), 0);
      const towing = state.player.tractor?.target.kind === 'wreck' && state.player.tractor.target.id === w.id;
      out.push({
        id: `piece#${w.id}`,
        world: w.body.pos,
        title: tx().pirates.piece,
        detail: parts > 0 ? tx().pirates.callout.pieceParts(parts) : tx().pirates.callout.pieceScrap,
        keys: towing ? 'F' : 'T',
        action: towing ? tx().pirates.callout.load : tx().pirates.callout.tow,
        tone: parts > 0 ? 'ok' : 'info',
        dist,
      });
    }
    for (const site of fortressSites(state.seed)) {
      const dist = length(sub(site.pos, pos));
      if (dist < 400) {
        const f = fortressStatus(state, site.id);
        const gens = f.gens.filter((hp) => hp > 0).length;
        const alive = fortressAlive(f);
        const left = alive ? 0 : Math.ceil((FORTRESS.rebuildTicks - (state.tick - (f.destroyed ?? 0))) / (60 * TICKS));
        out.push({
          id: site.id,
          world: fortressToWorld(site, FORTRESS_LAYOUT.core),
          title: tx().pirates.fortressName(site.index),
          detail: !alive ? tx().pirates.callout.fortressDown(left) : gens > 0 ? tx().pirates.callout.fortressShield(gens) : tx().pirates.callout.fortressCore(Math.round((f.core / FORTRESS.coreHp) * 100)),
          keys: null,
          action: null,
          tone: alive ? 'warn' : 'ok',
          dist: dist + 30,
        });
      }
      const bd = length(sub(site.beacon.pos, pos));
      if (bd < 160) {
        const ready = !state.pirates.raid && challengeCooldownUntil(state) <= state.tick;
        const near = ready && pirateInteraction(state)?.id === site.beacon.id;
        out.push({ id: site.beacon.id, world: site.beacon.pos, title: tx().pirates.beaconName, detail: tx().pirates.callout.beacon, keys: near ? 'F' : null, action: near ? tx().pirates.callout.challenge : null, tone: 'warn', dist: bd });
      }
    }
    return out;
  }

  /** F prompt at a clan beacon. */
  prompt(state: SimState): DockPrompt | null {
    const it = pirateInteraction(state);
    if (!it) return null;
    const p = state.pirates;
    if (p.raid) return { kind: 'warn', text: tx().pirates.prompts.beaconBusy };
    const until = challengeCooldownUntil(state);
    if (until > state.tick) return { kind: 'warn', text: tx().pirates.prompts.beaconCooldown(Math.ceil((until - state.tick) / (60 * TICKS))) };
    return { kind: 'ok', text: tx().pirates.prompts.beacon };
  }

  /** Fortresses, beacons and the raid target on the radar (relative to the ship). */
  radar(state: SimState, range: number): RadarPirate[] {
    const pos = state.player.body.pos;
    const out: RadarPirate[] = [];
    for (const site of fortressSites(state.seed)) {
      if (length(sub(site.pos, pos)) <= range + 30) out.push({ x: site.pos.x - pos.x, y: site.pos.y - pos.y, kind: 'fortress' });
      if (length(sub(site.beacon.pos, pos)) <= range) out.push({ x: site.beacon.pos.x - pos.x, y: site.beacon.pos.y - pos.y, kind: 'beacon' });
    }
    for (const c of state.combat.containers) {
      if (length(sub(c.body.pos, pos)) <= range) out.push({ x: c.body.pos.x - pos.x, y: c.body.pos.y - pos.y, kind: 'container' });
    }
    return out;
  }

  /** Fortresses (always known – landmarks of the belt), their beacons and the raid on the map. */
  map(state: SimState): MapPirate[] {
    const out: MapPirate[] = [];
    for (const site of fortressSites(state.seed)) {
      const down = !fortressAlive(fortressStatus(state, site.id));
      out.push({ pos: site.pos, kind: 'fortress', label: tx().pirates.fortressName(site.index), down });
      out.push({ pos: site.beacon.pos, kind: 'beacon', label: tx().pirates.map.beacon });
    }
    const r = state.pirates.raid;
    if (r) out.push({ pos: r.pos, kind: 'raid', label: tx().pirates.map.raid });
    return out;
  }

  /** The most important toast of the step (null = none). */
  toast(state: SimState, events: readonly SimEvent[]): PirateToast | null {
    let best: (PirateToast & { prio: number }) | null = null;
    const offer = (t: PirateToast, prio: number) => {
      if (!best || prio > best.prio) best = { ...t, prio };
    };
    const o = tx().pirates.toasts;
    for (const e of events) {
      switch (e.type) {
        case 'tractorLocked':
          offer({ text: e.rip ? o.tractorRip : o.tractorLocked, kind: 'info', seconds: 2 }, 1);
          break;
        case 'tractorReleased':
          if (e.reason !== 'loaded') offer({ text: o.tractorReleased[e.reason], kind: e.reason === 'manual' ? 'info' : 'error', seconds: e.reason === 'stolen' ? 4 : 2 }, e.reason === 'stolen' ? 7 : 1);
          break;
        case 'tractorFailed':
          offer({ text: o.tractorFailed[e.reason], kind: 'error', seconds: 3 }, 2);
          break;
        case 'wreckCut':
          offer({ text: e.blast > 0 ? o.wreckCutBlast : o.wreckCut(e.pieces.length), kind: e.blast > 0 ? 'error' : 'ok', seconds: 3 }, e.blast > 0 ? 6 : 3);
          break;
        case 'partRipped':
          offer({ text: o.partRipped, kind: 'ok', seconds: 3 }, 3);
          break;
        case 'salvageBlocked':
          offer({ text: o.salvageBlocked, kind: 'error', seconds: 3 }, 2);
          break;
        case 'containerLoaded': {
          // what was loaded, and whether the hold was too small for all of it (M20)
          const list = lootList(e.cargo, e.parts);
          if (!list) offer({ text: o.containerNothing, kind: 'error', seconds: 3 }, 2);
          else if (e.cargoFull) offer({ text: o.containerFull(list), kind: 'info', seconds: 5 }, 2);
          else offer({ text: o.containerLoaded(list), kind: 'ok', seconds: 3 }, 2);
          break;
        }
        case 'scavengerStole':
          if (!e.fromPlayer) offer({ text: o.scavengerStole, kind: 'info', seconds: 3 }, 3);
          break;
        case 'attentionLevel':
          offer({ text: o.attention[e.level], kind: e.level >= 2 ? 'error' : 'info', seconds: 4 }, 4);
          break;
        case 'huntingParty':
          offer({ text: o.huntingParty(e.captain !== null ? captainName(state.seed, e.captain) : null), kind: 'error', seconds: 5 }, 7);
          break;
        case 'raidAnnounced': {
          const min = Math.ceil((e.arrive - state.tick) / (60 * TICKS));
          const where = e.station ? stationLabel(state.seed, e.station) : tx().pirates.attention.nearYou;
          offer({ text: e.kind === 'challenge' ? o.challengeIssued(min) : o.raidAnnounced(where, min), kind: 'error', seconds: 6 }, 8);
          break;
        }
        case 'challengeRefused':
          offer({ text: o.challengeRefused[e.reason], kind: 'info', seconds: 3 }, 3);
          break;
        case 'raidArrived':
          offer({ text: o.raidArrived, kind: 'error', seconds: 4 }, 8);
          break;
        case 'raidDefeated':
          offer({ text: o.raidDefeated(formatCredits(e.credits)), kind: 'ok', seconds: 6 }, 9);
          break;
        case 'raidEnded':
          offer({ text: o.raidEnded, kind: 'info', seconds: 4 }, 5);
          break;
        case 'tollDemanded':
          offer({ text: o.tollDemanded(formatCredits(e.amount)), kind: 'error', seconds: 3 }, 8);
          break;
        case 'tollPaid':
          offer({ text: o.tollPaid(formatCredits(e.amount)), kind: 'ok', seconds: 4 }, 8);
          break;
        case 'tollRefused':
          offer({ text: e.timeout ? o.tollTimeout : o.tollRefused, kind: 'error', seconds: 3 }, 8);
          break;
        case 'tollEscaped':
          offer({ text: o.tollEscaped, kind: 'ok', seconds: 3 }, 6);
          break;
        case 'tollFailed':
          if (e.reason === 'credits') offer({ text: o.tollNoMoney, kind: 'error', seconds: 3 }, 6);
          break;
        case 'fortressPartDestroyed':
          offer({ text: o.fortressPart[e.part], kind: 'ok', seconds: 3 }, 4);
          break;
        case 'fortressShieldDown':
          offer({ text: o.fortressShieldDown, kind: 'ok', seconds: 4 }, 6);
          break;
        case 'fortressReinforcements':
          offer({ text: o.fortressReinforcements(e.count), kind: 'error', seconds: 3 }, 3);
          break;
        case 'fortressDestroyed':
          offer({ text: o.fortressDestroyed(formatCredits(e.credits)), kind: 'ok', seconds: 7 }, 10);
          break;
        case 'fortressRebuilt':
          offer({ text: o.fortressRebuilt, kind: 'info', seconds: 4 }, 2);
          break;
        case 'keyItemFound':
          if (e.item === 'resonator') offer({ text: o.resonator, kind: 'ok', seconds: 6 }, 11);
          break;
        default:
          break;
      }
    }
    if (!best) return null;
    const { prio: _p, ...t } = best as PirateToast & { prio: number };
    return t;
  }
}

