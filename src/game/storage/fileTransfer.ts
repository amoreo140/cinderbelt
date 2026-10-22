// Thin DOM layer for file export/import (the logic is in transfer.ts).

export interface DownloadEnv {
  document: Document;
  url: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  /** Delayed URL release (some browsers would otherwise cancel the download). */
  defer?: (fn: () => void) => void;
}

/** Downloads text as a file (a temporary object URL + a click on a link). */
export function downloadTextFile(
  fileName: string,
  text: string,
  env: DownloadEnv = { document: globalThis.document, url: globalThis.URL },
): void {
  const href = env.url.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = env.document.createElement('a');
  a.href = href;
  a.download = fileName;
  env.document.body.append(a);
  a.click();
  a.remove();
  (env.defer ?? ((fn) => setTimeout(fn, 1000)))(() => env.url.revokeObjectURL(href));
}

/**
 * The largest save file the import reads: 16 MB. A real `.cinder` file is tens of kilobytes (the biggest
 * test fixture is 36 KB), so this is hundreds of times more than any save; a bigger file would only be
 * read into memory and parsed to freeze the tab.
 */
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

/** The content of a file from `<input type="file">` as text; rejects a file above `MAX_IMPORT_BYTES` unread. */
export function readFileText(file: Blob): Promise<string> {
  if (file.size > MAX_IMPORT_BYTES) return Promise.reject(new Error(`file too large (${file.size} bytes)`));
  return file.text();
}
