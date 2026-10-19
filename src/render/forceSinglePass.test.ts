// Performance guard (audit 2026-10-16, issue #2): three.js draws a transparent DoubleSide material
// in two passes (back faces, then front faces) and resolves its program again for each pass every
// frame unless `forceSinglePass` is set. Additive or flat effects look the same in one pass, so
// every transparent DoubleSide material literal under src/render must set it.
import { describe, expect, it } from 'vitest';
import { nodeFs, type NodeFs } from '../testing/nodeFs';

type Fs = NodeFs & { readdirSync(path: string, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[] };
const fs = nodeFs() as Fs;

/** Files still drawing two-pass on purpose or not migrated yet (keep this list short). */
const EXEMPT = new Set<string>([]);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sources(p));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** The `{ ... }` option literals passed to `new …Material(`. */
function materialOptions(code: string): string[] {
  const out: string[] = [];
  const re = /new \w*Material\(\s*\{/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}' && --depth === 0) break;
    }
    out.push(code.slice(start, i + 1));
  }
  return out;
}

describe('transparent DoubleSide materials', () => {
  it('set forceSinglePass', () => {
    const offenders: string[] = [];
    for (const file of sources('src/render')) {
      if (EXEMPT.has(file)) continue;
      for (const opts of materialOptions(fs.readFileSync(file, 'utf8'))) {
        if (/side:\s*DoubleSide/.test(opts) && /transparent:\s*true/.test(opts) && !/forceSinglePass:\s*true/.test(opts)) {
          offenders.push(`${file}: ${opts.replace(/\s+/g, ' ').slice(0, 100)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
