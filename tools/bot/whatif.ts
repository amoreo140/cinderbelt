// What-if experiments: overrides balance constants IN MEMORY of the bot process only (the source files
// are never touched), so a proposed change can be measured before anyone edits src/data/*.
//   --set=economy.RING_RESOURCE_MULT.1.titanium=1.0
//   --set=economy.RECIPES.*:2.credits*=1.5        (glob segment, multiply)
//   --set=parts.PART_DEFS.miningLaser.2.mining.rate=3   (several --set flags or ';' separated)
import * as economy from '../../src/data/economy';
import * as parts from '../../src/data/parts';

const MODULES: Record<string, unknown> = { economy, parts };

const globToRegex = (seg: string): RegExp => new RegExp(`^${seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

/** Applies `path=value` / `path*=factor` overrides; returns readable descriptions of what changed. */
export function applyOverrides(specs: readonly string[]): string[] {
  const done: string[] = [];
  for (const spec of specs.flatMap((s) => s.split(';')).map((s) => s.trim()).filter(Boolean)) {
    const eq = spec.lastIndexOf('=');
    const left = eq > 0 ? spec.slice(0, eq) : '';
    const value = Number(spec.slice(eq + 1));
    if (!left || !Number.isFinite(value)) throw new Error(`Bad --set "${spec}" (expected module.path=value or module.path*=factor)`);
    const mult = left.endsWith('*');
    const path = mult ? left.slice(0, -1) : left;
    const segs = path.split('.');
    const root = MODULES[segs[0]!];
    if (!root || segs.length < 3) throw new Error(`--set "${spec}": path must be <economy|parts>.<object>.<key>…`);
    let targets: { obj: Record<string, unknown>; key: string; label: string }[] = [];
    let current: { value: unknown; label: string }[] = [{ value: (root as Record<string, unknown>)[segs[1]!], label: `${segs[0]}.${segs[1]}` }];
    for (let i = 2; i < segs.length; i++) {
      const seg = segs[i]!;
      const re = seg.includes('*') ? globToRegex(seg) : null;
      const next: typeof current = [];
      const last = i === segs.length - 1;
      for (const c of current) {
        if (!c.value || typeof c.value !== 'object') continue;
        const obj = c.value as Record<string, unknown>;
        const keys = re ? Object.keys(obj).filter((k) => re.test(k)) : seg in obj ? [seg] : [];
        for (const k of keys) {
          if (last) targets.push({ obj, key: k, label: `${c.label}.${k}` });
          else next.push({ value: obj[k], label: `${c.label}.${k}` });
        }
      }
      current = next;
    }
    targets = targets.filter((t) => typeof t.obj[t.key] === 'number');
    if (!targets.length) throw new Error(`--set "${spec}" matched no number`);
    for (const t of targets) {
      const before = t.obj[t.key] as number;
      t.obj[t.key] = mult ? before * value : value;
    }
    done.push(`${path}${mult ? '*' : ''}=${value} (${targets.length} value${targets.length > 1 ? 's' : ''})`);
  }
  return done;
}
