import { defineConfig } from '@playwright/test';

// The perf guard (`npm run test:perf`): tests/e2e/perfGuard.spec.ts against the production bundle with
// dev hooks (tools/perf/build.mjs) on a real GPU, one browser at a time (timings must not share the
// machine with another test). Not part of the default e2e run (playwright.config.ts ignores the spec).
//   PERF_PORT (default 5337), PERF_BUILD_DIR (default test-results-perf/dist),
//   PERF_SOFTWARE=1 forces SwiftShader (structural checks only, the timing checks are skipped).
const env = (globalThis as { process?: { env: Record<string, string | undefined>; platform: string } }).process;
const PORT = Number(env?.env.PERF_PORT ?? 5337);
const DIR = env?.env.PERF_BUILD_DIR ?? 'test-results-perf/dist';
const software = env?.env.PERF_SOFTWARE === '1';
const gpuArgs = software
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : [env?.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'perfGuard.spec.ts',
  outputDir: 'test-results-perf/out',
  timeout: 240_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // the CLAUDE.md budgets are for 1080p
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    launchOptions: { args: [...gpuArgs, '--enable-precise-memory-info'] },
  },
  webServer: {
    command: `node tools/perf/serve.mjs ${DIR} ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
