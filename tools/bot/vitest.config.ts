import { defineConfig } from 'vitest/config';

// Balance bot tests (`npm run test:bot`); the slow multi-seed run is opt-in: BOT_SLOW=1 npm run test:bot
export default defineConfig({
  test: { include: ['tools/bot/**/*.test.ts'], environment: 'node', testTimeout: 600_000 },
});
