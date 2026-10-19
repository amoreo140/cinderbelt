import { describe, expect, it } from 'vitest';
import { REGION_GEN } from '../../sim/regions';
import { regionDebugVariant } from './regionDebug';

describe('sector debug layer switch', () => {
  it('is off without ?regions and picks the variant from the URL', () => {
    expect(regionDebugVariant('')).toBeNull();
    expect(regionDebugVariant('?play=7')).toBeNull();
    expect(regionDebugVariant('?play=7&regions')).toBe(REGION_GEN.variant);
    expect(regionDebugVariant('?regions=a')).toBe('A');
    expect(regionDebugVariant('?regions=B')).toBe('B');
    expect(regionDebugVariant('?regions=x')).toBe(REGION_GEN.variant);
  });
});
