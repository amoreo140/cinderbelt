// CLI of the saboteur mode: `npm run bot -- --mode=saboteur --seeds=1-6 --hours=1 --chaos=4 --jobs=6`
// Seeds run in parallel worker processes (same scheme as the balance bot); the markdown report goes to
// reports/econ/saboteur-report.md (--out=…), the raw results optionally to --json=…;
// --from=<json> rebuilds the report from a saved run without simulating.
import { node } from '../node';
import { buildSaboteurReport } from './report';
import { DEFAULT_SABOTEUR_OPTIONS, runSaboteurSeed, type SaboteurOptions, type SeedReport } from './suite';
import type { DeathPenalty } from '../../../src/sim/settings';

function parseSeeds(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(',')) {
    const m = /^(\d+)-(\d+)$/.exec(part.trim());
    if (m) for (let s = Number(m[1]); s <= Number(m[2]); s++) out.push(s);
    else if (part.trim()) out.push(Number(part.trim()));
  }
  return out;
}

function runWorker(seeds: number[], argv: string[]): Promise<SeedReport[]> {
  return new Promise((resolve, reject) => {
    const { childProcess, process } = node();
    const passthrough = argv.filter((a) => !a.startsWith('--seeds=') && !a.startsWith('--jobs='));
    const child = childProcess.spawn(process.execPath, ['tools/bot/run.mjs', '--worker', `--seeds=${seeds.join(',')}`, ...passthrough], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`saboteur worker for seeds ${seeds.join(',')} exited with ${code}`));
      resolve(out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as SeedReport));
    });
  });
}

export async function main(argv: string[]): Promise<void> {
  const { fs, path, os, process } = node();
  const get = (k: string): string | undefined => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const seeds = parseSeeds(get('seeds') ?? '1-6');
  const opts: SaboteurOptions = {
    hours: Number(get('hours') ?? DEFAULT_SABOTEUR_OPTIONS.hours),
    chaosRuns: Number(get('chaos') ?? DEFAULT_SABOTEUR_OPTIONS.chaosRuns),
    chaosPenalties: (get('chaosPenalties')?.split(',') as DeathPenalty[] | undefined) ?? DEFAULT_SABOTEUR_OPTIONS.chaosPenalties,
  };
  const verbose = argv.includes('--verbose');
  // rebuild the report from a saved --json run (no simulation)
  const from = get('from');
  if (from) {
    const saved = JSON.parse(fs.readFileSync(from, 'utf8')) as SeedReport[];
    const out = get('out') ?? 'reports/econ/saboteur-report.md';
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, buildSaboteurReport(saved, { ...opts, wallSeconds: Number(get('wall') ?? 0) }));
    console.error(`report → ${out}`);
    return;
  }
  if (argv.includes('--worker')) {
    for (const seed of seeds) process.stdout.write(`${JSON.stringify(runSaboteurSeed(seed, opts, verbose ? (m) => console.error(m) : undefined))}\n`);
    return;
  }
  const jobs = Math.max(1, Number(get('jobs') ?? Math.min(seeds.length, Math.max(1, os.cpus().length - 1))));
  const started = Date.now();
  let reports: SeedReport[];
  if (jobs <= 1 || seeds.length === 1) {
    reports = seeds.map((s) => {
      const r = runSaboteurSeed(s, opts, (m) => console.error(m));
      console.error(`seed ${s}: ${(r.wallMs / 1000).toFixed(1)} s`);
      return r;
    });
  } else {
    const groups: number[][] = Array.from({ length: Math.min(jobs, seeds.length) }, () => []);
    seeds.forEach((s, i) => groups[i % groups.length]!.push(s));
    reports = (await Promise.all(groups.map((g) => runWorker(g, argv)))).flat().sort((a, b) => a.seed - b.seed);
  }
  const wallSeconds = (Date.now() - started) / 1000;
  console.error(`${reports.length} seeds in ${wallSeconds.toFixed(1)} s`);
  const json = get('json');
  if (json) {
    fs.mkdirSync(path.dirname(path.resolve(json)), { recursive: true });
    fs.writeFileSync(json, JSON.stringify(reports));
  }
  const out = get('out') ?? 'reports/econ/saboteur-report.md';
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, buildSaboteurReport(reports, { ...opts, wallSeconds }));
  console.error(`report → ${out}`);
}
