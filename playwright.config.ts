import { defineConfig } from '@playwright/test';

// E2E_PORT runs the suite against a dev server on another port (several agents share the machine):
//   E2E_PORT=5327 npx playwright test tests/e2e/smoke.spec.ts --workers=2 --output=test-results-mine
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const PORT = Number(env.E2E_PORT ?? 5317);

export default defineConfig({
  testDir: 'tests/e2e',
  // the perf guard needs the production bundle on a real GPU: `npm run test:perf` (playwright.perf.config.ts)
  testIgnore: '**/perfGuard.spec.ts',
  timeout: 30_000,
  // WebGL runs in software (SwiftShader) and the dev server transforms modules on demand – more
  // browsers at once slow the first page load past the test time limit
  workers: 4,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: PORT === 5317 ? 'npm run dev' : `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
    // no HMR in the e2e server: other agents' edits must not reload a page mid-test (vite.config.ts)
    env: { CINDER_E2E: '1' },
  },
});
