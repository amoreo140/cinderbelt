// English texts of Shipyard 2.0 – the same keys as skShipyard.ts (ShipyardTexts).
import { formatHullPoints } from './numberFormat';
import { enPlural } from './plural';
import { coord, signedInt } from './signs';
import type { ShipyardTexts } from './skShipyard';

export const enShipyard: ShipyardTexts = {
  title: 'Shipyard',
  looseTag: 'NOT CONNECTED',
  selection: {
    count: (n) => `${n} ${enPlural(n, 'part', 'parts')} selected`,
    hint: 'Drag = move · R = rotate · Del = to storage · Esc = clear selection',
  },
  hints: {
    boxKeys: 'Shift+drag',
    box: 'Select',
    pieceKeys: 'Double-click',
    piece: 'Whole piece',
  },
  looseNote: (n) =>
    `The draft has ${n} ${enPlural(n, 'loose part', 'loose parts')} – a ship like that cannot be confirmed. Go back and connect ${n === 1 ? 'it' : 'them'} to the cockpit, or discard the draft.`,

  // --- hangar camera ---
  camera: {
    topView: 'Top view',
    angledView: '3/4 view',
    controls:
      'Orbit: drag with the middle button or Alt + left, Q / E. Tilt: drag up and down, PgUp / PgDn. Pan: Shift + middle drag, arrow keys. Zoom: mouse wheel. Home: top view and back, C: centre the ship.',
    orbit: 'orbit view',
    dragKeys: 'Alt+drag',
  },

  // --- SL2 E1: mirror mode ---
  mirror: {
    button: 'Mirror',
    buttonHint:
      "Mirror mode (M): placing, removing and painting are repeated symmetrically across the ship's long axis. Moving parts is not mirrored. Shift+M mirrors the selection.",
    axis: 'axis ±½',
    axisHint: 'Where the mirror axis lies: through the centre of the cockpit row, or on the seam above it – for ships of even width.',
    axisCell: 'Axis through the cockpit row',
    axisSeam: 'Axis on the seam above the cockpit row',
    axisTag: 'AXIS',
    on: 'Mirror on',
    off: 'Mirror off',
    ghostBlocked: (reason) => `The mirror copy cannot be placed: ${reason}. Only the original is placed.`,
    selectionMirrored: 'Selection mirrored',
    selectionEmpty: 'Select parts first (Shift+drag or double-click)',
    selectionBlocked: (reason) => `The mirrored selection does not fit: ${reason}`,
    hint: 'mirror',
    selectionKeys: 'Shift+M',
    selectionHint: 'mirror selection',
  },

  // --- SL2 E1: 180° turn ---
  turn180: {
    label: 'Turn 180°',
    unit: 's',
    none: 'cannot turn',
    leverArm: 'Lever arm: heavy parts far from the centre of mass slow the turn. Moving them closer or adding a gyroscope shortens it.',
  },

  // --- SL2 E2: shaped armour ---
  shapes: {
    names: {
      full: 'Full',
      wedge: 'Wedge',
      chamfer: 'Chamfer',
      round: 'Round corner',
      arc: 'Arc',
      half: 'Half plate',
      nose: 'Nose tip',
      wingL: 'Wing (port)',
      wingR: 'Wing (starboard)',
      nose2x1: 'Nose 2×1',
    },
    strip: 'Shape',
    stripHint: (fee) =>
      `How the armour is laid – the same part from storage, only shaped. Smaller shapes are lighter, have less HP and cost fewer hull points. Tab / Shift+Tab cycles the shape in hand, Tab over placed armour reshapes it (installation ${fee}).`,
    keys: 'Tab',
    hint: 'armour shape',
    armourOnly: 'Only armour has shapes.',
    noneFits: 'No other shape fits here.',
    tipPoints: (points) => `${formatHullPoints(points, 'en')} ${points > 1 ? 'pts' : 'pt'}`,
    tipHp: (hp) => `${hp} HP`,
    tipArc: (deg, x, y) => `${signedInt(deg)}° arc for the cannon (${coord(x)},${coord(y)})`,
    reshapeRepair: 'A damaged part is repaired when reshaped',
    reshapeScrap: (noService) =>
      `${noService ? 'This station does no repairs' : 'You have neither the credits nor the material for the repair'} – the damaged part is scrapped and the new shape takes a fresh plate.`,
    reshapeStuck: 'The damaged part can be neither repaired nor replaced by a fresh plate (credits, material or the part are missing) – the design cannot be confirmed like this.',
    mirrorBlocked: (reason) => `The mirror counterpart is not reshaped: ${reason}. Only the original is reshaped.`,
    looseContact: (name) => `${name} holds on only by a tip – consider rotating it.`,
    reshapeDamaged: 'A damaged part cannot be reshaped in place – remove it and place it in the new shape (the repair is included).',
  },

  help: {
    title: 'Shipyard keys',
    lines: [
      'Tab / Shift+Tab – armour shape (in hand or under the cursor)',
      'M – mirror mode',
      'Shift+M – mirror the selection',
      'F – undock',
      'T – part tier',
    ],
  },

  suggest: {
    button: 'Suggest shapes',
    hint: (fee) =>
      `Suggests shapes for exposed armour corners and the bow in front of the cannons – with the change in points, HP and arc. Each one is an ordinary reshape (installation ${fee} per part) and can be undone.`,
    empty: 'No suggestions – the armour already has fitting shapes.',
    apply: 'Apply suggestions',
  },

  explosiveNearCockpit: (part, damage) =>
    `${part} sits right next to the cockpit. When destroyed it explodes and takes ${damage} HP off the cockpit – move it at least one cell away.`,
};
