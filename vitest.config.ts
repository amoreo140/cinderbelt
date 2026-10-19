import { defineConfig } from 'vitest/config';

export default defineConfig({
  // both languages registered up front: tests switch languages synchronously (the game loads only one)
  test: { include: ['src/**/*.test.ts', 'tools/lint/**/*.test.ts'], environment: 'node', setupFiles: ['src/i18n/allTexts.ts'] },
});
