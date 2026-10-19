// Manifests of the art batch B scenery (art/README §2.7.23): `models/props/props.json` (space clutter
// and pirate dressing) and `models/wreckage/wreckage.json` (wreck-field fragments), parsed into the
// small catalogue the scatter planner and the scatter layer use. The manifests describe motion and
// lamps in words ("slow tumble 2-4 deg/s", "red blink 1 Hz"); the parsers below turn those words
// into numbers and are unit tested against the real files. Pure – no three.js.

/** How a piece moves (deg/s ranges; the planner rolls one value per piece). */
export type MotionKind = 'still' | 'tumble' | 'yaw' | 'bob' | 'attached';
export interface MotionDef {
  kind: MotionKind;
  /** Rate range in deg/s (tumble: about a random axis, yaw: about +Y). */
  rate: [number, number];
}

/** A child node that turns by itself (satellite dish, solar wings, mine core). */
export interface SpinDef {
  node: string;
  axis: 'x' | 'y' | 'z';
  /** deg/s */
  rate: number;
}

export type LampMode = 'steady' | 'blink' | 'pulse' | 'strobe' | 'distress' | 'irregular';
export interface LampDef {
  node: string;
  /** Linear RGB (0..1). */
  color: [number, number, number];
  mode: LampMode;
  /** Blinks per second. */
  hz: number;
  /** Brightness multiplier (dying lamps are dim). */
  gain: number;
}

export type ScatterSet = 'B4' | 'B5' | 'wreck';

export interface ScatterModelDef {
  name: string;
  file: string;
  set: ScatterSet;
  /** Bounding radius on the plane (u). */
  radius: number;
  /** Bounding box [x, y(up), z] (glTF axes). */
  size: [number, number, number];
  contexts: readonly string[];
  rings: readonly number[];
  /** [min, max] per context site. */
  count: [number, number];
  scale: [number, number];
  motion: MotionDef;
  spins: readonly SpinDef[];
  lamps: readonly LampDef[];
  /** Node tinted with the resource colour (ore canister window). */
  tintNode: string | null;
  /** Wreck pieces: has collision circles (big enough to fly into – yaw only, never tumbles). */
  solid: boolean;
}

export type ScatterCatalog = ReadonlyMap<string, ScatterModelDef>;

/** First "a-b deg/s" or "~a deg/s" range in a text. */
export function parseRate(text: string): [number, number] | null {
  const range = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*deg\/s/.exec(text);
  if (range) return [Number(range[1]), Number(range[2])];
  const one = /~?\s*(\d+(?:\.\d+)?)\s*deg\/s/.exec(text);
  return one ? [Number(one[1]), Number(one[1])] : null;
}

/** Motion of a prop from its manifest `drift` text. */
export function parseDrift(text: string): MotionDef {
  const t = text.toLowerCase();
  const rate = parseRate(t);
  if (t.startsWith('none') || t.includes('stuck')) return { kind: 'attached', rate: [0, 0] };
  if (t.includes('tumble') && !t.includes('no tumble')) return { kind: 'tumble', rate: rate ?? [2, 6] };
  if (t.includes('yaw')) return { kind: 'yaw', rate: rate ?? [1, 3] };
  if (t.includes('bob')) return { kind: 'bob', rate: rate ?? [0, 0] };
  return { kind: 'still', rate: [0, 0] };
}

/** A spinning child node from its manifest note ("spin around local +Y, ~6 deg/s"); null = no spin. */
export function parseSpin(node: string, text: string): SpinDef | null {
  const t = text.toLowerCase();
  if (!/spin|turn/.test(t)) return null;
  const axis = /local \+([xyz])/.exec(t);
  const rate = parseRate(t);
  if (!axis || !rate) return null;
  return { node, axis: axis[1] as SpinDef['axis'], rate: (rate[0] + rate[1]) / 2 };
}

const LAMP_COLORS: ReadonlyArray<[RegExp, [number, number, number]]> = [
  [/\bred\b/, [1, 0.16, 0.1]],
  [/\bamber\b/, [1, 0.55, 0.12]],
  [/\bgreen\b/, [0.25, 1, 0.35]],
  [/\bcyan\b/, [0.25, 0.9, 1]],
  [/\bwhite\b/, [1, 0.95, 0.88]],
];

/** A lamp from its manifest note ("red blink 1 Hz", "white strobe: 80 ms flash every 1.5 s"). */
export function parseLamp(node: string, text: string): LampDef {
  const t = text.toLowerCase();
  const color = LAMP_COLORS.find(([re]) => re.test(t))?.[1] ?? [1, 0.55, 0.12];
  const hzMatch = /(\d+(?:\.\d+)?)\s*hz/.exec(t);
  const every = /every\s*(\d+(?:\.\d+)?)\s*s/.exec(t);
  let mode: LampMode = 'blink';
  if (t.includes('strobe')) mode = 'strobe';
  else if (t.includes('distress')) mode = 'distress';
  else if (t.includes('irregular')) mode = 'irregular';
  else if (t.includes('pulse')) mode = 'pulse';
  else if (t.includes('steady')) mode = 'steady';
  const hz = hzMatch ? Number(hzMatch[1]) : every ? 1 / Number(every[1]) : mode === 'pulse' ? 0.4 : 0.8;
  const gain = /\bdim\b|dying/.test(t) ? 0.45 : 1;
  return { node, color: [...color] as [number, number, number], mode, hz, gain };
}

interface RawProp {
  file: string;
  set: string;
  size: [number, number, number];
  radius: number;
  nodes?: Record<string, string>;
  rings: number[];
  contexts: string[];
  count: [number, number];
  scale: [number, number];
  drift: string;
}

interface RawWreck {
  file: string;
  radius: number;
  size: [number, number, number];
  circles: unknown[];
  nodes: string[];
  lights?: Record<string, string>;
  suggestedCount: [number, number];
  contexts: string[];
  rings: number[];
  tumbleDegPerSec: number;
  scale: [number, number];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** props.json → catalogue entries (skips `_schema` and malformed rows). */
export function parsePropManifest(raw: unknown): ScatterModelDef[] {
  if (!isObject(raw)) return [];
  const out: ScatterModelDef[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (name.startsWith('_') || !isObject(value)) continue;
    const p = value as unknown as RawProp;
    if (typeof p.file !== 'string' || !Array.isArray(p.contexts)) continue;
    const spins: SpinDef[] = [];
    const lamps: LampDef[] = [];
    let tintNode: string | null = null;
    for (const [node, note] of Object.entries(p.nodes ?? {})) {
      if (/^beacon_\d+$/.test(node)) lamps.push(parseLamp(node, note));
      else if (/tint|resource|color/i.test(note) && !/spin|turn/i.test(note)) tintNode = node;
      else {
        const spin = parseSpin(node, note);
        if (spin) spins.push(spin);
      }
    }
    out.push({
      name,
      file: p.file,
      set: p.set === 'B5' ? 'B5' : 'B4',
      radius: p.radius,
      size: p.size,
      contexts: p.contexts,
      rings: p.rings,
      count: p.count,
      scale: p.scale,
      motion: parseDrift(p.drift ?? ''),
      spins,
      lamps,
      tintNode,
      solid: false,
    });
  }
  return out;
}

/** wreckage.json → catalogue entries (pieces with circles only yaw; the rest tumble at the given rate). */
export function parseWreckManifest(raw: unknown): ScatterModelDef[] {
  if (!isObject(raw)) return [];
  const out: ScatterModelDef[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (name.startsWith('_') || !isObject(value)) continue;
    const w = value as unknown as RawWreck;
    if (typeof w.file !== 'string' || !Array.isArray(w.contexts)) continue;
    const solid = Array.isArray(w.circles) && w.circles.length > 0;
    const rate = w.tumbleDegPerSec ?? 0;
    const motion: MotionDef = rate <= 0 ? { kind: 'still', rate: [0, 0] } : { kind: solid ? 'yaw' : 'tumble', rate: [rate * 0.7, rate * 1.3] };
    out.push({
      name,
      file: w.file,
      set: 'wreck',
      radius: w.radius,
      size: w.size,
      contexts: w.contexts,
      rings: w.rings,
      count: w.suggestedCount,
      scale: w.scale,
      motion,
      spins: [],
      lamps: Object.entries(w.lights ?? {}).map(([node, note]) => parseLamp(node, note)),
      tintNode: null,
      solid,
    });
  }
  return out;
}

/** Both manifests as one catalogue by model name. */
export function buildCatalog(props: unknown, wreckage: unknown): ScatterCatalog {
  const map = new Map<string, ScatterModelDef>();
  for (const d of [...parsePropManifest(props), ...parseWreckManifest(wreckage)]) map.set(d.name, d);
  return map;
}
