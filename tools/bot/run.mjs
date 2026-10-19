// Entry point of the balance bot: `npm run bot -- --seeds=1-12 --hours=2 --jobs=6`.
// Node cannot run the TypeScript sources (bundler-style imports) directly, so the CLI is loaded
// through Vite's module runner – the same transform Vitest uses.
import { runnerImport } from 'vite';

const { module } = await runnerImport('./tools/bot/cli.ts', { configFile: false, logLevel: 'error' });
await module.main(process.argv.slice(2));
