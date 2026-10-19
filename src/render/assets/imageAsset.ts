// Images for <img>-decoded textures (the palette atlases, liveries, the border fences) through the
// prefetch store (perf O14): an <img> request is low priority and on HTTP/1.1 it queued behind all the
// models of the start, yet the models' parse or a layer's readiness waits for it. The bytes come from
// the boot list (or a fetch at the given priority) and decode through an <img> from a blob URL – the
// same pixels as loading the file's URL.
import { ImageLoader } from 'three';
import { assetBytes } from './prefetch';
import { assetUrl } from './url';

/** An image of public/ (`path` relative to BASE_URL); null = missing file. */
export async function loadImageAsset(path: string, priority?: RequestPriority): Promise<HTMLImageElement | null> {
  const url = assetUrl(path);
  if (typeof fetch !== 'function' || typeof URL.createObjectURL !== 'function') return new ImageLoader().loadAsync(url).catch(() => null);
  const data = await assetBytes(url, priority);
  if (!data) return null;
  const blobUrl = URL.createObjectURL(new Blob([data]));
  try {
    return await new ImageLoader().loadAsync(blobUrl);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
