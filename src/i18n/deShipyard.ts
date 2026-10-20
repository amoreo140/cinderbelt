// German texts of Shipyard 2.0 – the same keys as skShipyard.ts (ShipyardTexts); the terms follow GLOSSARY-DE.md.
import { formatHullPoints } from './numberFormat';
import { dePlural } from './plural';
import { coord, signedInt } from './signs';
import type { ShipyardTexts } from './skShipyard';

export const deShipyard: ShipyardTexts = {
  title: 'Werft',
  looseTag: 'NICHT VERBUNDEN',
  selection: {
    count: (n) => `${n} ${dePlural(n, 'Teil', 'Teile')} ausgewählt`,
    hint: 'Ziehen = verschieben · R = drehen · Entf = ins Lager · Esc = Auswahl aufheben',
  },
  hints: {
    boxKeys: 'Shift+Ziehen',
    box: 'Auswählen',
    pieceKeys: 'Doppelklick',
    piece: 'Ganzes Stück',
  },
  looseNote: (n) =>
    `Der Entwurf hat ${n} ${dePlural(n, 'loses Teil', 'lose Teile')} – so ein Schiff lässt sich nicht bestätigen. Geh zurück und verbinde ${n === 1 ? 'es' : 'sie'} mit dem Cockpit, oder verwirf den Entwurf.`,

  // --- hangar camera ---
  camera: {
    topView: 'Draufsicht',
    controls:
      'Kreisen: mit der mittleren Taste oder Alt + links ziehen, Q / E. Neigen: auf und ab ziehen, Bild↑ / Bild↓. Schwenken: Shift + mittlere Taste ziehen, Pfeiltasten. Zoom: Mausrad. Pos1: Draufsicht, C: Schiff zentrieren.',
    orbit: 'Kreisansicht',
  },

  // --- SL2 E1: mirror mode ---
  mirror: {
    button: 'Spiegeln',
    buttonHint:
      'Spiegelmodus (M): Platzieren, Entfernen und Lackieren werden symmetrisch zur Längsachse des Schiffs wiederholt. Verschieben wird nicht gespiegelt. Shift+M spiegelt die Auswahl.',
    axis: 'Achse ±½',
    axisHint: 'Wo die Spiegelachse liegt: durch die Mitte der Cockpitreihe oder auf der Naht darüber – für Schiffe mit gerader Breite.',
    axisCell: 'Achse durch die Cockpitreihe',
    axisSeam: 'Achse auf der Naht über der Cockpitreihe',
    axisTag: 'ACHSE',
    on: 'Spiegeln an',
    off: 'Spiegeln aus',
    ghostBlocked: (reason) => `Die Spiegelkopie lässt sich nicht platzieren: ${reason}. Nur das Original wird platziert.`,
    selectionMirrored: 'Auswahl gespiegelt',
    selectionEmpty: 'Wähl zuerst Teile aus (Shift+Ziehen oder Doppelklick)',
    selectionBlocked: (reason) => `Die gespiegelte Auswahl passt nicht: ${reason}`,
    hint: 'spiegeln',
    selectionKeys: 'Shift+M',
    selectionHint: 'Auswahl spiegeln',
  },

  // --- SL2 E1: 180° turn ---
  turn180: {
    label: '180°-Drehung',
    unit: 's',
    none: 'kann nicht drehen',
    leverArm: 'Hebelarm: Schwere Teile weit weg vom Schwerpunkt bremsen die Drehung. Näher heranrücken oder ein Gyroskop dazu verkürzt sie.',
  },

  // --- SL2 E2: shaped armour ---
  shapes: {
    names: {
      full: 'Voll',
      wedge: 'Keil',
      chamfer: 'Fase',
      round: 'Runde Ecke',
      arc: 'Bogen',
      half: 'Halbplatte',
      nose: 'Bugspitze',
      wingL: 'Flügel (backbord)',
      wingR: 'Flügel (steuerbord)',
      nose2x1: 'Bug 2×1',
    },
    strip: 'Form',
    stripHint: (fee) =>
      `Wie die Panzerung liegt – dasselbe Teil aus dem Lager, nur geformt. Kleinere Formen sind leichter, haben weniger HP und kosten weniger Rumpfpunkte. Tab / Shift+Tab wechselt die Form in der Hand, Tab über verbauter Panzerung formt sie um (Einbau ${fee}).`,
    keys: 'Tab',
    hint: 'Panzerform',
    armourOnly: 'Nur Panzerung hat Formen.',
    noneFits: 'Hier passt keine andere Form.',
    tipPoints: (points) => `${formatHullPoints(points, 'de')} Pkt.`,
    tipHp: (hp) => `${hp} HP`,
    tipArc: (deg, x, y) => `${signedInt(deg)}° Winkel für die Kanone (${coord(x)},${coord(y)})`,
    reshapeRepair: 'Ein beschädigtes Teil wird beim Umformen repariert',
    reshapeScrap: (noService) =>
      `${noService ? 'Diese Station repariert nicht' : 'Dir fehlen Credits und Material für die Reparatur'} – das beschädigte Teil wird verschrottet, und die neue Form bekommt eine frische Platte.`,
    reshapeStuck: 'Das beschädigte Teil lässt sich weder reparieren noch durch eine frische Platte ersetzen (es fehlen Credits, Material oder das Teil) – so lässt sich der Entwurf nicht bestätigen.',
    mirrorBlocked: (reason) => `Das Spiegelgegenstück wird nicht umgeformt: ${reason}. Nur das Original wird umgeformt.`,
    looseContact: (name) => `${name} hängt nur an einer Spitze – dreh es lieber.`,
    reshapeDamaged: 'Ein beschädigtes Teil lässt sich nicht an Ort und Stelle umformen – nimm es ab und setz es in der neuen Form (die Reparatur ist inbegriffen).',
  },

  help: {
    title: 'Werft-Tasten',
    lines: [
      'Tab / Shift+Tab – Panzerform (in der Hand oder unter dem Cursor)',
      'M – Spiegelmodus',
      'Shift+M – Auswahl spiegeln',
      'F – abdocken',
      'T – Teileklasse',
    ],
  },

  suggest: {
    button: 'Formen vorschlagen',
    hint: (fee) =>
      `Schlägt Formen für freiliegende Panzerecken und den Bug vor den Kanonen vor – mit der Änderung bei Punkten, HP und Winkel. Jeder Vorschlag ist eine normale Umformung (Einbau ${fee} pro Teil) und lässt sich rückgängig machen.`,
    empty: 'Keine Vorschläge – die Panzerung hat schon passende Formen.',
    apply: 'Vorschläge anwenden',
  },

  explosiveNearCockpit: (part, damage) =>
    `${part} sitzt direkt neben dem Cockpit. Wird es zerstört, explodiert es und zieht dem Cockpit ${damage} HP ab – rück es mindestens ein Feld weg.`,
};
