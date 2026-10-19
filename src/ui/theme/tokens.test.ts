import { beforeAll, describe, expect, it } from 'vitest';
import { PALETTE, RING_ACCENTS } from './tokens';

// we read tokens.css directly from the file (Vitest empties CSS imports); node:fs without @types/node
let css = '';
beforeAll(async () => {
  const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { readFileSync(path: URL, enc: 'utf8'): string };
  css = fs.readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
});

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('design tokens', () => {
  it('tokens.css and tokens.ts define the same palette', () => {
    for (const [name, hex] of Object.entries(PALETTE)) {
      expect(css, `--af-${kebab(name)}`).toContain(`--af-${kebab(name)}: ${hex};`);
    }
  });

  it('every ring has its accent pair in tokens.css', () => {
    RING_ACCENTS.forEach(({ a, b }, i) => {
      expect(css).toContain(`[data-ring='${i + 1}'] { --af-ring-a: ${a}; --af-ring-b: ${b}; }`);
    });
  });
});
