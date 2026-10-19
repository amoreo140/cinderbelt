// Texts of Shipyard 2.0 (free placement, group selection, hangar camera) and of Ship building 2.0 E1 (mirror mode, the
// 180° turn row) and of E2 (shaped armour). `ShipyardTexts` is the shape,
// enShipyard.ts implements the same keys in English.
import type { ShapeId } from '../data/shapes';
import { formatHullPoints } from './numberFormat';
import { skPlural } from './plural';

import { coord, signedInt } from './signs';

// shared with enShipyard.ts through signs.ts (the language bundles load separately)
export { coord, signedInt };

export interface ShipyardTexts {
  /** Screen name. */
  title: string;
  /** Tag over a piece of parts not connected to the cockpit (hangar, short, upper case). */
  looseTag: string;
  /** Group selection chip over the hangar. */
  selection: {
    /** "3 parts selected". */
    count: (n: number) => string;
    /** What can be done with the selection. */
    hint: string;
  };
  /** Footer hints of the editor. */
  hints: {
    /** Mouse label of Shift + drag. */
    boxKeys: string;
    box: string;
    /** Mouse label of a double click. */
    pieceKeys: string;
    piece: string;
  };
  /** Extra line of the leave / undock dialog when the draft has loose parts. */
  looseNote: (n: number) => string;

  // --- hangar camera (orbit, tilt, pan, top view) ---
  camera: {
    /** Button and Home key: straight down, bow up, centred. */
    topView: string;
    /** Tooltip of the view buttons: every camera control. */
    controls: string;
    /** Footer hint next to the Q E keys. */
    orbit: string;
  };

  // --- SL2 E1: mirror mode ---
  mirror: {
    /** Header button (key M). */
    button: string;
    /** Tooltip of the button: what is mirrored and what is not. */
    buttonHint: string;
    /** Small toggle next to the button: the axis on the cockpit row's centre or on the seam above it. */
    axis: string;
    /** Tooltip of the axis toggle. */
    axisHint: string;
    /** The current axis (tooltip value, screen readers). */
    axisCell: string;
    axisSeam: string;
    /** Tag at the end of the axis line on the hangar floor (short, upper case). */
    axisTag: string;
    /** Toast when the mode is switched with M. */
    on: string;
    off: string;
    /** Text at the cursor when the mirror copy cannot be placed; `reason` = a shipyard.placement text. */
    ghostBlocked: (reason: string) => string;
    /** Shift+M (mirror the selection around its own long axis). */
    selectionMirrored: string;
    selectionEmpty: string;
    /** The mirrored selection does not fit; `reason` = a shipyard.placement text. */
    selectionBlocked: (reason: string) => string;
    /** Footer hints: key M ("zrkadlo") and Shift+M. */
    hint: string;
    selectionKeys: string;
    selectionHint: string;
  };

  // --- SL2 E1: the 180° turn row of the properties panel ---
  turn180: {
    /** Row label ("Turn 180°: 2.4 s"); the tooltip is partInfo.glossary.turn180. */
    label: string;
    /** Unit of the value (seconds). */
    unit: string;
    /** Value when the ship cannot turn (no torque). */
    none: string;
    /** Layer V: what the lever-arm lines from the centre of mass mean (tooltip / legend). */
    leverArm: string;
  };

  // --- SL2 E2: shaped armour ---
  shapes: {
    /** Shape names by `ShapeId`; `full` = no shape (the first item of the strip). */
    names: Record<ShapeId | 'full', string>;
    /** Label of the shape strip under the palette (armour selected). */
    strip: string;
    /** Tooltip of the strip; `fee` = the installation fee ("10 kr"). */
    stripHint: (fee: string) => string;
    /** Footer hint: the key and what it does. */
    keys: string;
    hint: string;
    /** Notice on Tab over a non-armour part or with a non-armour part in hand. */
    armourOnly: string;
    /** Notice on Tab over a placed armour when no other shape fits its place. */
    noneFits: string;
    /** Ghost tooltip facts, joined with " · ": hull points ("½ b"), max HP ("20 HP"). */
    tipPoints: (points: number) => string;
    tipHp: (hp: number) => string;
    /** The arc change of a nearby cannon ("+18° of arc for the cannon (3,1)"); `deg` signed, whole degrees. */
    tipArc: (deg: number, x: number, y: number) => string;
    /** Ghost note when Tab reshapes a damaged plate (remove + place; the repair is priced in "Cena zmien"). */
    reshapeRepair: string;
    /**
     * Tab over a damaged plate that will not be repaired (no repair service, or no credits / material): it is
     * scrapped (warning `damagedScrapped`) and the new shape takes a fresh plate.
     */
    reshapeScrap: (noService: boolean) => string;
    /** Tab over a damaged plate that can be neither repaired nor replaced (credits, material or the part missing): the design is blocked. */
    reshapeStuck: string;
    /** Notice when Tab in mirror mode cannot reshape the mirror counterpart; `reason` = the placement error. */
    mirrorBlocked: (reason: string) => string;
    /** KONTROLA warning `shapeLooseContact`; `name` = the shape name. */
    looseContact: (name: string) => string;
    /** KONTROLA error `reshapeDamaged` (a damaged part reshaped in place – crafted ops only). */
    reshapeDamaged: string;
  };

  /** Shipyard key help (K): the lines the flight help does not cover. */
  help: {
    title: string;
    lines: readonly string[];
  };

  /** "Navrhni tvar": a KONTROLA button proposing reshapes. */
  suggest: {
    button: string;
    /** Tooltip; `fee` = the installation fee per part ("10 kr"). */
    hint: (fee: string) => string;
    /** Nothing to propose. */
    empty: string;
    /** Apply every proposal (one undo step). */
    apply: string;
  };

  /**
   * KONTROLA warning `explosiveNearCockpit` (M4c): a part that blows up when destroyed sits next to the
   * cockpit; `part` = the part name, `damage` = its blast damage in HP.
   */
  explosiveNearCockpit: (part: string, damage: number) => string;
}

export const skShipyard: ShipyardTexts = {
  title: 'Lodenica',
  looseTag: 'NEPRIPOJENÉ',
  selection: {
    count: (n) => `${n} ${skPlural(n, 'diel vybraný', 'diely vybrané', 'dielov vybraných')}`,
    hint: 'Ťahaj = presun · R = otočiť · Del = do skladu · Esc = zrušiť výber',
  },
  hints: {
    boxKeys: 'Shift+ťah',
    box: 'Výber',
    pieceKeys: 'Dvojklik',
    piece: 'Celý kus',
  },
  looseNote: (n) =>
    `Návrh má ${n} ${skPlural(n, 'nepripojený diel', 'nepripojené diely', 'nepripojených dielov')} – taká loď sa nedá potvrdiť. Vráť sa a pripoj ich ku kokpitu, alebo návrh zahoď.`,

  // --- hangar camera ---
  camera: {
    topView: 'Pohľad zhora',
    controls:
      'Otočiť: stredné tlačidlo alebo Alt + ľavé ťahaním, Q / E. Naklopiť: ťahanie hore-dole, PgUp / PgDn. Posunúť: Shift + stredné ťahaním, šípky. Priblížiť: koliesko. Home: pohľad zhora, C: vycentrovať loď.',
    orbit: 'otočiť pohľad',
  },

  // --- SL2 E1: mirror mode ---
  mirror: {
    button: 'Zrkadlo',
    buttonHint:
      'Zrkadlový režim (M): položenie, odobratie a farbenie sa zopakuje súmerne podľa pozdĺžnej osi lode. Presun dielov sa nezrkadlí. Shift+M zrkadlí výber.',
    axis: 'os ±½',
    axisHint: 'Kde leží os zrkadla: stredom riadku kokpitu, alebo na šve nad ním – pre lode párnej šírky.',
    axisCell: 'Os stredom riadku kokpitu',
    axisSeam: 'Os na šve nad riadkom kokpitu',
    axisTag: 'OS',
    on: 'Zrkadlo zapnuté',
    off: 'Zrkadlo vypnuté',
    ghostBlocked: (reason) => `Zrkadlová kópia sa nepoloží: ${reason}. Položí sa len originál.`,
    selectionMirrored: 'Výber zrkadlený',
    selectionEmpty: 'Najprv vyber diely (Shift+ťah alebo dvojklik)',
    selectionBlocked: (reason) => `Zrkadlený výber sa nezmestí: ${reason}`,
    hint: 'zrkadlo',
    selectionKeys: 'Shift+M',
    selectionHint: 'zrkadliť výber',
  },

  // --- SL2 E1: 180° turn ---
  turn180: {
    label: 'Otočenie 180°',
    unit: 's',
    none: 'neotočí sa',
    leverArm: 'Rameno: ťažké diely ďaleko od ťažiska spomaľujú otáčanie. Bližšie k stredu alebo gyroskop ho skrátia.',
  },

  // --- SL2 E2: shaped armour ---
  shapes: {
    names: {
      full: 'Plný',
      wedge: 'Klin',
      chamfer: 'Zrezaný roh',
      round: 'Oblý roh',
      arc: 'Oblúk',
      half: 'Polovica',
      nose: 'Hrot',
      wingL: 'Krídlo ľavé',
      wingR: 'Krídlo pravé',
      nose2x1: 'Nos 2×1',
    },
    strip: 'Tvar',
    stripHint: (fee) =>
      `Ako sa pancier položí – ten istý diel zo skladu, len inak uložený. Menšie tvary sú ľahšie, majú menej HP a stoja menej bodov trupu. Tab / Shift+Tab prepína tvar v ruke, Tab nad položeným pancierom ho pretvaruje (montáž ${fee}).`,
    keys: 'Tab',
    hint: 'tvar panciera',
    armourOnly: 'Tvary má len pancier.',
    noneFits: 'Iný tvar sa sem nezmestí.',
    tipPoints: (points) => `${formatHullPoints(points, 'sk')} b`,
    tipHp: (hp) => `${hp} HP`,
    tipArc: (deg, x, y) => `${signedInt(deg)}° výseku pre kanón (${coord(x)},${coord(y)})`,
    reshapeRepair: 'Poškodený diel sa pri pretvarovaní opraví',
    reshapeScrap: (noService) =>
      `${noService ? 'Táto stanica neopravuje' : 'Na opravu nemáš kredity ani materiál'} – poškodený diel sa rozoberie na šrot a nový tvar sa položí z nového plátu.`,
    reshapeStuck: 'Poškodený diel sa nedá opraviť ani nahradiť novým plátom (chýbajú kredity, materiál alebo diel) – takto návrh nepotvrdíš.',
    mirrorBlocked: (reason) => `Zrkadlový diel sa nepretvaruje: ${reason}. Pretvaruje sa len originál.`,
    looseContact: (name) => `${name} drží len hrotom – zváž otočenie.`,
    reshapeDamaged: 'Poškodený diel sa nedá pretvarovať na mieste – odober ho a polož v novom tvare (oprava sa započíta).',
  },

  help: {
    title: 'Klávesy lodenice',
    lines: [
      'Tab / Shift+Tab – tvar panciera (v ruke alebo pod kurzorom)',
      'M – zrkadlový režim',
      'Shift+M – zrkadliť výber',
      'F – odlet',
      'T – stupeň dielu',
    ],
  },

  suggest: {
    button: 'Navrhni tvar',
    hint: (fee) =>
      `Navrhne tvary pre odkryté rohy panciera a čelo pred kanónmi – so zmenou bodov, HP a výseku. Každý návrh je bežné pretvarovanie (montáž ${fee} za diel) a dá sa vrátiť.`,
    empty: 'Žiadny návrh – pancier už má vhodné tvary.',
    apply: 'Použiť návrhy',
  },

  explosiveNearCockpit: (part, damage) =>
    `${part} je hneď pri kokpite. Keď ho zničia, vybuchne a vezme kokpitu ${damage} HP – odsuň ho aspoň o jedno políčko.`,
};
