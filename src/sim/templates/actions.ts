// Ship template actions (M4a, long-term design 3.4.3): save, rename, delete – anywhere (also in flight),
// capped by the Archive (`templateCap`). Applying a template is editor-side (shipyard/template.ts
// `templateOps` + the normal `shipyardCommit`), so it has no action.
import type { GameAction, GameActionType } from '../commands';
import { sanitizeName } from '../fleet/names';
import type { SimEvent, SimState } from '../Simulation';
import type { ActionError } from '../station/actions';
import { isTemplatePart, normalizeParts, TEMPLATE_MAX_PARTS, templateProblem } from './normalize';
import { templateCap } from './state';
import type { TemplatePart } from './types';

export type TemplateActionType = 'templateSave' | 'templateRename' | 'templateDelete';
export type TemplateAction = Extract<GameAction, { type: TemplateActionType }>;

const TEMPLATE_ACTIONS = new Set<GameActionType>(['templateSave', 'templateRename', 'templateDelete']);
export const isTemplateAction = (a: GameAction): a is TemplateAction => TEMPLATE_ACTIONS.has(a.type);

const fail = (reqId: number, reason: ActionError): SimEvent[] => [{ type: 'actionResult', reqId, ok: false, reason }];
const ok = (reqId: number): SimEvent => ({ type: 'actionResult', reqId, ok: true });

/**
 * Normalised parts of a template from an action, or null when they are not a valid design: well-formed
 * parts, known keys, shapes only on armour, one cockpit, no overlap (shape footprints), within the
 * hangar, connected (`validateGrid`).
 */
export function validTemplateParts(raw: unknown): TemplatePart[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > TEMPLATE_MAX_PARTS) return null;
  if (!raw.every(isTemplatePart)) return null;
  // copy the tuples – the action object belongs to the caller; a shape (index 4) only when present
  const parts = raw.map((p): TemplatePart => (p.length === 5 ? [p[0], p[1], p[2], p[3], p[4]] : [p[0], p[1], p[2], p[3]]));
  return templateProblem(parts) === null ? normalizeParts(parts) : null;
}

const validIndex = (state: SimState, index: unknown): index is number =>
  Number.isInteger(index) && (index as number) >= 0 && (index as number) < state.templates.length;

export function templateAction(state: SimState, action: TemplateAction): SimEvent[] {
  switch (action.type) {
    case 'templateSave': {
      if (state.templates.length >= templateCap(state)) return fail(action.reqId, 'templateCap');
      const name = sanitizeName(action.name);
      if (name === null) return fail(action.reqId, 'invalidName');
      const parts = validTemplateParts(action.parts);
      if (!parts) return fail(action.reqId, 'invalidTemplate');
      state.templates.push({ name, parts });
      return [ok(action.reqId), { type: 'templateSaved', index: state.templates.length - 1, name }];
    }
    case 'templateRename': {
      if (!validIndex(state, action.index)) return fail(action.reqId, 'invalidTemplate');
      const name = sanitizeName(action.name);
      if (name === null) return fail(action.reqId, 'invalidName');
      state.templates[action.index] = { ...state.templates[action.index]!, name };
      return [ok(action.reqId), { type: 'templateRenamed', index: action.index, name }];
    }
    case 'templateDelete': {
      if (!validIndex(state, action.index)) return fail(action.reqId, 'invalidTemplate');
      state.templates.splice(action.index, 1);
      return [ok(action.reqId), { type: 'templateDeleted', index: action.index }];
    }
  }
}
