import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import pkg from './package.json';

// CINDER_E2E=1 (set by playwright.config for the dev server it starts): no HMR. Several agents edit the
// same tree, and a hot update or a full page reload in the middle of an e2e test would restart the game
// under it; each test's page load still gets the current code.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export default defineConfig({
  plugins: [preact()],
  // the game version in the menu (bottom right) and in saves
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5317, strictPort: true, ...(env.CINDER_E2E ? { hmr: false } : {}) },
  build: {
    rolldownOptions: {
      // multi-page build: the game + audio and music lab pages + the UI style guide
      input: { main: 'index.html', audioDemo: 'audio-demo.html', musicDemo: 'music-demo.html', uiKit: 'ui-kit.html' },
      output: {
        codeSplitting: {
          // three.js changes only with an upgrade: its own long-cached chunk, not re-downloaded with every
          // game build (audit 2026-10-17, P10)
          groups: [{ name: 'three', test: /[\/]node_modules[\/]three[\/]/ }],
        },
      },
    },
  },
});
