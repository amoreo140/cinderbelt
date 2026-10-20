import { describe, expect, it } from 'vitest';
import { columnClear, fitLeftColumn, LEFT_FIT_GAP, LOG_MIN_HEIGHT, logClaim, type LeftFit } from './leftColumn';

// the 1280 × 720 layout of the T9 screenshot: chips from 233 down, the claim at 403–527
const radio = { x: 16, y: 403, width: 400, height: 124 };
const chips = (bottom: number) => ({ x: 16, y: 233, width: 336, height: bottom - 233 });

describe('columnClear', () => {
  it('needs the gap between the chips and the radio', () => {
    expect(columnClear(chips(403 - LEFT_FIT_GAP), radio)).toBe(true);
    expect(columnClear(chips(400), radio)).toBe(false);
  });

  it('is clear without chips or without a radio, or with the radio beside the column', () => {
    expect(columnClear(null, radio)).toBe(true);
    expect(columnClear(chips(500), null)).toBe(true);
    expect(columnClear(chips(500), { ...radio, x: 352 + LEFT_FIT_GAP })).toBe(true);
  });
});

describe('fitLeftColumn', () => {
  // a column of two event chips, the escort and the relay chip: each fold makes it shorter
  const bottoms: Record<LeftFit, number> = { full: 445, hints: 405, rows: 370, beside: 300 };
  const tried: LeftFit[] = [];
  const clear = (fit: LeftFit) => {
    tried.push(fit);
    return columnClear(chips(bottoms[fit]), radio);
  };

  it('folds step by step until the column ends clear of the radio', () => {
    tried.length = 0;
    expect(fitLeftColumn(clear)).toBe('rows');
    expect(tried).toEqual(['full', 'hints', 'rows']);
  });

  it('keeps everything when it fits, ends at `beside` when nothing does', () => {
    expect(fitLeftColumn(() => true)).toBe('full');
    expect(fitLeftColumn(() => false)).toBe('beside');
  });

  it('the Guild chips move beside the event chips when the folds above do not clear a tall claim', () => {
    const tall = { ...radio, y: 340, height: 187 };
    expect(fitLeftColumn((f) => columnClear(chips(bottoms[f]), tall))).toBe('beside');
  });

  it('goes on from the current fold (never back up within the same content)', () => {
    tried.length = 0;
    expect(fitLeftColumn(clear, 'hints')).toBe('rows');
    expect(tried).toEqual(['hints', 'rows']);
  });
});

describe('logClaim', () => {
  it('claims the log\'s minimum height above its bottom edge', () => {
    const c = logClaim({ x: 16, y: 300, width: 480, height: 238 });
    expect(c.height).toBe(LOG_MIN_HEIGHT);
    expect(c.y + c.height).toBe(538);
  });
});
