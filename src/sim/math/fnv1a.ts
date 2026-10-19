/**
 * FNV-1a (32 bit) over the UTF-16 units of a string – checksums and fingerprints,
 * not cryptography.
 */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** FNV-1a as 8 hexadecimal digits. */
export const fnv1aHex = (text: string): string => fnv1a32(text).toString(16).padStart(8, '0');
