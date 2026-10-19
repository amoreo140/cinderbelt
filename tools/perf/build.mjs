// Production bundle for the perf guard (`npm run test:perf`, tests/e2e/perfGuard.spec.ts): the real
// production build (minified, no dev server) with `import.meta.env.DEV` defined true, so the dev hooks
// (`window.__cinder`, `?fixture=`) are in it. Output: PERF_BUILD_DIR (default test-results-perf/dist).
import { build } from 'vite';

const outDir = process.env.PERF_BUILD_DIR ?? 'test-results-perf/dist';
await build({
  mode: 'production',
  logLevel: 'warn',
  define: { 'import.meta.env.DEV': 'true' },
  build: { outDir, emptyOutDir: true, reportCompressedSize: false },
});
console.log(`perf build: ${outDir}`);
