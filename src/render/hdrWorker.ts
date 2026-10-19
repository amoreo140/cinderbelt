// Worker: RGBE (.hdr) parsing off the main thread (audit 2026-10-16, issue #9; hdr.ts). Receives the
// file's bytes, answers with the half-float RGBA pixels (transferred, not copied).
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

interface Request {
  id: number;
  buffer: ArrayBuffer;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, buffer } = e.data;
  try {
    const r = new HDRLoader().parse(buffer);
    const data = r.data as Uint16Array | Float32Array;
    scope.postMessage({ id, width: r.width, height: r.height, data, type: r.type }, [data.buffer]);
  } catch (err) {
    scope.postMessage({ id, error: String(err) });
  }
};
