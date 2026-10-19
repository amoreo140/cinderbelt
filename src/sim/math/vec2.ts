export interface Vec2 {
  x: number;
  y: number;
}

/**
 * `Math.hypot(x, y)`, bit for bit: V8's algorithm (math.tq `MathHypot` – scale by the larger magnitude,
 * sum the squares, square root, scale back; ±Infinity wins over NaN). The builtin allocates on every
 * call (~48 B: its argument array and the result), this does not – the simulation asks for distances
 * thousands of times a step (perf audit 2026-10-17, P4). `vec2.test.ts` checks it against Math.hypot.
 */
export function hypot(x: number, y: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax === Infinity || ay === Infinity) return Infinity;
  if (ax !== ax || ay !== ay) return NaN;
  const max = ax > ay ? ax : ay;
  if (max === 0) return 0;
  const a = ax / max;
  const b = ay / max;
  return Math.sqrt(a * a + b * b) * max;
}

export const vec2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const length = (a: Vec2): number => hypot(a.x, a.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Rotation counter-clockwise by an angle in radians. */
export function rotate(a: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** Unit vector (the zero vector stays zero). */
export function normalize(a: Vec2): Vec2 {
  const len = hypot(a.x, a.y);
  return len > 1e-9 ? { x: a.x / len, y: a.y / len } : { x: 0, y: 0 };
}
