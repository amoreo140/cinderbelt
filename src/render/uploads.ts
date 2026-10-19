// Partial GPU uploads for dynamic buffers (audit 2026-10-16, issue #5): a buffer sized for the worst
// case (3000 asteroid instances, a full trail) but drawn with far fewer items should upload only the
// items in use, not the whole array every frame.
//
// The range objects are reused (three's addUpdateRange allocates one per call, and three clears the
// list after each upload, so a fresh object per buffer per frame was garbage – audit issue #10).
import type { BatchedMesh, BufferAttribute, DataTexture } from 'three';

interface Range {
  start: number;
  count: number;
}

/** One reusable range per attribute. */
const attrRanges = new WeakMap<BufferAttribute, Range>();

/** Marks the first `count` items of `attr` for upload this frame; nothing when none are drawn. */
export function uploadPrefix(attr: BufferAttribute, count: number): void {
  if (count <= 0) return;
  let range = attrRanges.get(attr);
  if (!range) {
    range = { start: 0, count: 0 };
    attrRanges.set(attr, range);
  }
  range.start = 0;
  range.count = Math.min(count, attr.count) * attr.itemSize;
  attr.updateRanges.length = 0;
  attr.updateRanges.push(range);
  attr.needsUpdate = true;
}

/**
 * The same for an RGBA data texture (a BatchedMesh's matrices or colours): the first `count` items
 * of `floatsPerItem` floats, sent as ONE texSubImage2D of the texel rows they cover.
 *
 * three.js uploads every update range as its own one-texel-high texSubImage2D, so a prefix as ranges
 * cost one GL call per row – about 45 extra calls a frame in flight (rubble chips 15, scatter 5,
 * depth silhouettes 30), each with its pixel-store calls (texture-upload probe 2026-10-17: 60 → 15
 * texSubImage2D a frame, ~0.2 ms less of a 4× throttled frame). Without ranges three sends the whole
 * image in one call, so for the upload it is shown an image only `rows` high over the same data, and
 * `onUpdate` (called by three right after the upload) puts the full image back. The GPU storage is
 * allocated at the image size on the first upload, so until three has uploaded the texture once (or
 * again after a dispose) it sees the full image (one renderer, no context restore – a restored context
 * would allocate at the size shown). The rest of the last row goes up too (unused texels; same bytes
 * ± one row).
 */
export function uploadTexturePrefix(texture: DataTexture, count: number, floatsPerItem: number): void {
  if (count <= 0) return;
  const rows = rowUpload(texture);
  const { width, height } = rows.full;
  const used = Math.min(height, Math.ceil((count * floatsPerItem) / (width * 4)));
  texture.updateRanges.length = 0;
  if (rows.uploaded && used < height) {
    rows.short.data = rows.full.data;
    rows.short.width = width;
    rows.short.height = used;
    texture.image = rows.short;
  } else texture.image = rows.full;
  texture.needsUpdate = true;
}

interface TextureImage {
  data: DataTexture['image']['data'];
  width: number;
  height: number;
}

/** A data texture's full image, the reused short view of it, and whether three has allocated its storage. */
interface RowUpload {
  full: TextureImage;
  short: TextureImage;
  uploaded: boolean;
}

const rowUploads = new WeakMap<DataTexture, RowUpload>();

function rowUpload(texture: DataTexture): RowUpload {
  const known = rowUploads.get(texture);
  if (known) return known;
  const full = texture.image as TextureImage;
  const rows: RowUpload = { full, short: { data: full.data, width: full.width, height: full.height }, uploaded: false };
  const before = texture.onUpdate;
  texture.onUpdate = (t) => {
    rows.uploaded = true;
    texture.image = rows.full;
    before?.(t);
  };
  // a disposed texture is allocated anew (at the image size) on its next use
  texture.addEventListener('dispose', () => {
    rows.uploaded = false;
    texture.image = rows.full;
  });
  rowUploads.set(texture, rows);
  return rows;
}

/** A BatchedMesh's instance textures (three keeps them in underscore fields). */
export function batchTextures(mesh: BatchedMesh): { matrices: DataTexture; colors: DataTexture | null } {
  const m = mesh as unknown as { _matricesTexture: DataTexture; _colorsTexture: DataTexture | null };
  return { matrices: m._matricesTexture, colors: m._colorsTexture };
}

/**
 * The instance ids a BatchedMesh has ever handed out (its high-water mark): every id in use is below it.
 * three reuses freed ids lowest first and never shrinks the list outside setInstanceCount, so the
 * prefix up to here covers every matrix and colour written so far.
 */
export function batchUsed(mesh: BatchedMesh): number {
  return (mesh as unknown as { _instanceInfo: unknown[] })._instanceInfo.length;
}

/**
 * Call right after a frame's setMatrixAt loop: uploads the matrices of the ids in use instead of the
 * whole capacity-sized texture (audit 2026-10-17 P9). Nothing is uploaded when no matrix was
 * written since the last call, so it can sit at the end of an update that only sometimes writes.
 */
export function uploadBatchMatrices(mesh: BatchedMesh): void {
  uploadWritten(batchTextures(mesh).matrices, batchUsed(mesh), 16);
}

/** The same for the instance colours (after setColorAt; no-op for a batch without colours). */
export function uploadBatchColors(mesh: BatchedMesh): void {
  const colors = batchTextures(mesh).colors;
  if (colors) uploadWritten(colors, batchUsed(mesh), 4);
}

/** Texture version after the last prefix call: unchanged = nothing was written since (no upload). */
const writtenVersion = new WeakMap<DataTexture, number>();

function uploadWritten(texture: DataTexture, count: number, floatsPerItem: number): void {
  if (writtenVersion.get(texture) === texture.version) return;
  uploadTexturePrefix(texture, count, floatsPerItem);
  writtenVersion.set(texture, texture.version);
}
