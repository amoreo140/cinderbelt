/** Shifts a value by multiples of `size` into the window [center - size/2, center + size/2). */
export function wrapAround(value: number, center: number, size: number): number {
  const half = size / 2;
  return center - half + ((((value - center + half) % size) + size) % size);
}
