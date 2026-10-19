// Entry point of the fixture generator: `npm run fixtures` (see tools/fixtures/makeSaves.ts).
// Loaded through Vite's module runner like the balance bot (tools/bot/run.mjs) – the TypeScript
// sources use bundler-style imports Node cannot run directly.
import { runnerImport } from 'vite';

const { module } = await runnerImport('./tools/fixtures/makeSaves.ts', { configFile: false, logLevel: 'error' });
module.main();
