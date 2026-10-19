// Entry point of the sector prototype tool (stage 0): `node tools/regions/run.mjs <metric|bench|render> [...]`.
// Loaded through Vite's module runner like the balance bot (tools/bot/run.mjs).
import { runnerImport } from 'vite';

const { module } = await runnerImport('./tools/regions/stage0.ts', { configFile: false, logLevel: 'error' });
await module.main(process.argv.slice(2));
