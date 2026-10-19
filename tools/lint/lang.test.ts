import { describe, expect, it } from 'vitest';
import { scanSource } from './lang.mjs';

const sk = 'ťažba'; // a Slovak word – the samples below must flag it only in comments and test titles
const doc = ['docs', 'superpowers'].join('/'); // built at runtime so this file doesn't trip the check

describe('lint:lang', () => {
  it('flags Slovak in // and /* */ and JSDoc comments', () => {
    expect(scanSource('a.ts', `const a = 1; // ${sk}\n/* ${sk} */\n/**\n * ${sk}\n */\n`).length).toBe(3);
  });
  it('ignores Slovak in string literals, templates and JSX text', () => {
    const src = `const s = '${sk}'; const t = \`x \${s} ${sk}\`; const u = 'http://a.b//c';\nconst j = <p>don't ${sk}</p>;\n`;
    expect(scanSource('a.tsx', src)).toEqual([]);
  });
  it('flags Slovak test titles', () => {
    expect(scanSource('a.test.ts', `describe('${sk}', () => { it('ok', () => {}); test.skip('${sk}', () => {}); });`).length).toBe(2);
  });
  it('flags Python comments and docstrings, CSS and HTML comments', () => {
    expect(scanSource('a.py', `x = '${sk}'  # ${sk}\n"""${sk}"""\n`).length).toBe(2);
    expect(scanSource('a.css', `a { color: red; } /* ${sk} */`).length).toBe(1);
    expect(scanSource('a.html', `<p>${sk}</p><!-- ${sk} -->`).length).toBe(1);
  });
  it('flags links to the local-only internal docs anywhere in a code file', () => {
    expect(scanSource('a.ts', `const p = '${doc}/x.md';`).length).toBe(1);
    expect(scanSource('a.ts', `// see STAV-PROJEKTU`).length).toBe(1);
  });
});
