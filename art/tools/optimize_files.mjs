#!/usr/bin/env node
// Cinderbelt – run the asset optimizer (optimize_assets.mjs, art/README.md §2.9) on SOME GLBs only.
//
//   node art/tools/optimize_files.mjs <file.glb | dir> [...]      (dirs: every *.glb inside, recursive)
//
// Used by art batches that run in parallel (art audit 2026-10-16 §5): each batch optimizes only its
// own output folders, so it never touches another agent's half-written exports. The GLB transform is
// exactly the one of optimize_assets.mjs (same code, imported from a temporary copy that exports the
// internal optimizeGlb); already optimized files are skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, 'optimize_assets.mjs');

function walk(p) {
  if (!fs.existsSync(p)) return [];
  if (fs.statSync(p).isFile()) return p.endsWith('.glb') ? [p] : [];
  return fs.readdirSync(p).flatMap((n) => walk(path.join(p, n)));
}

async function main(args) {
  const files = args.flatMap((a) => walk(path.resolve(a)));
  if (!files.length) {
    console.log('optimize_files: nothing to do');
    return;
  }
  // temporary module next to the original (same node_modules resolution, same ROOT)
  const tmp = path.join(HERE, `.optimize_files_tmp_${process.pid}.mjs`);
  fs.writeFileSync(tmp, `${fs.readFileSync(SOURCE, 'utf8')}\nexport { optimizeGlb as __optimizeGlb };\n`);
  try {
    const mod = await import(pathToFileURL(tmp).href);
    let done = 0, skipped = 0, before = 0, after = 0;
    for (const f of files) {
      const r = await mod.__optimizeGlb(f, { force: false });
      if (!r) {
        skipped++;
        continue;
      }
      done++;
      before += r[0];
      after += r[1];
      console.log(`  ${path.relative(process.cwd(), f)}: ${(r[0] / 1024).toFixed(0)} -> ${(r[1] / 1024).toFixed(0)} KB`);
    }
    console.log(`optimize_files: ${done} optimized (${(before / 1024).toFixed(0)} -> ${(after / 1024).toFixed(0)} KB), ${skipped} already optimized`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e);
  process.exit(1);
});
