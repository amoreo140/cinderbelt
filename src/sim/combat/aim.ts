// Pirate gunnery by difficulty: AI ships and fortress turrets lead their shots like the player, but
// with a seeded aim error (an angular spread around the lead direction and a misjudged lead) and a
// short reaction time before they open fire on a new target or after the target changes course. The
// difficulty is the game's death penalty (the New Game presets: Calm, Standard, Hard, Hardcore).
// All randomness comes from the saved combat RNG, so a loaded game shoots exactly the same.
import { length, sub, type Vec2 } from '../math/vec2';
import type { DeathPenalty } from '../settings';
import { rngRange } from './rng';
import { leadInto } from './weapons';

/** Scratch of `aimWithError`. */
const AIM_LEAD: Vec2 = { x: 0, y: 0 };

const TICKS = 60;
const DEG = Math.PI / 180;

export interface AimSkill {
  /** Half-width of the uniform angular spread around the lead direction (rad). */
  spread: number;
  /** The lead (the target's velocity the gunner allows for) is off by up to ± this share. */
  leadError: number;
  /** Steps before opening fire on a new target or after the target changes course. */
  reaction: number;
  /** A change of the target's velocity bigger than this (u/s) counts as a new course. */
  courseChange: number;
}

/** Gunnery per difficulty: Calm misses a lot and reacts late, Hardcore is close to perfect. */
export const AIM_SKILL: Record<DeathPenalty, AimSkill> = {
  none: { spread: 11 * DEG, leadError: 0.45, reaction: Math.round(0.65 * TICKS), courseChange: 4 },
  mild: { spread: 6.5 * DEG, leadError: 0.25, reaction: Math.round(0.4 * TICKS), courseChange: 5 },
  hard: { spread: 3.5 * DEG, leadError: 0.12, reaction: Math.round(0.22 * TICKS), courseChange: 6 },
  hardcore: { spread: 1.2 * DEG, leadError: 0.04, reaction: Math.round(0.08 * TICKS), courseChange: 8 },
};

export const aimSkill = (difficulty: DeathPenalty): AimSkill => AIM_SKILL[difficulty];

/**
 * Where the gunner at `from` (moving with `fromVel`) aims at a target at `target` it believes moves
 * with `targetVel`: the lead point with a misjudged lead, turned by a random angle within the spread.
 * Draws exactly two numbers from the combat RNG.
 */
export function aimWithError(
  from: Vec2,
  fromVel: Vec2,
  target: Vec2,
  targetVel: Vec2,
  projectileSpeed: number,
  skill: AimSkill,
  holder: { rng: number },
): Vec2 {
  const leadScale = 1 + rngRange(holder, -skill.leadError, skill.leadError);
  const angle = rngRange(holder, -skill.spread, skill.spread);
  // the lead allows for the target's motion relative to the gunner – that is what gets misjudged
  // (scalars: the arithmetic of sub/add/scale/rotate and leadPoint, operation for operation)
  const believedX = fromVel.x + (targetVel.x - fromVel.x) * leadScale;
  const believedY = fromVel.y + (targetVel.y - fromVel.y) * leadScale;
  const lead = leadInto(from.x, from.y, target.x, target.y, believedX - fromVel.x, believedY - fromVel.y, projectileSpeed, AIM_LEAD);
  const dx = lead.x - from.x;
  const dy = lead.y - from.y;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: from.x + (dx * c - dy * s), y: from.y + (dx * s + dy * c) };
}

/** Reaction state of an AI gunner (saved with the pirate). */
export interface ReactionState {
  /** Steps until the gunner may fire (0 = ready). */
  react: number;
  /** The target velocity the gunner last reacted to. */
  seen: Vec2;
}

/** A new target: hold fire for the reaction time. */
export function acquire(s: ReactionState, targetVel: Vec2, skill: AimSkill): void {
  s.react = skill.reaction;
  s.seen = { ...targetVel };
}

/**
 * One step of the reaction timer: a target that changed course (its velocity moved by more than the
 * skill's threshold since the gunner last reacted) restarts the timer – a change during the wait
 * does not extend it. Returns true when the gunner may fire this step.
 */
export function react(s: ReactionState, targetVel: Vec2, skill: AimSkill): boolean {
  if (length(sub(targetVel, s.seen)) > skill.courseChange) {
    // a course change: the gunner notices, but needs its reaction time to re-aim
    if (s.react <= 0) s.react = skill.reaction;
    s.seen = { ...targetVel };
  }
  if (s.react > 0) {
    s.react--;
    return false;
  }
  return true;
}
