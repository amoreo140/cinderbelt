// Worker: the far-band LOD1 of graveyard wreck batches (wreckLod.ts) – meshopt `simplify` off the main
// thread. Receives index + position arrays per mesh, answers with the simplified index arrays
// (transferred, not copied).
import { simplifyLod, type LodJob } from './wreckLodCore';

interface Request {
  id: number;
  jobs: LodJob[];
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, jobs } = e.data;
  simplifyLod(jobs).then(
    (lods) => {
      const transfer: Transferable[] = [];
      for (const l of lods) if (l) transfer.push(l.buffer);
      scope.postMessage({ id, lods }, transfer);
    },
    (err: unknown) => scope.postMessage({ id, error: String(err) }),
  );
};
