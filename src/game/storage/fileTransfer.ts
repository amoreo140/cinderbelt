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

/** The content of a file from `<input type="file">` as text. */
export function readFileText(file: Blob): Promise<string> {
  return file.text();
}
