// CLI of the balance bot: runs seeds in parallel worker processes and writes the markdown report.
//   npm run bot                                   → seeds 1–20, 2 game hours, report to reports/econ/bot-report.md
//   npm run bot -- --seeds=1-20 --hours=3 --jobs=8 --dwell=15 --contracts=1 --out=... --json=...
//   npm run bot -- --seeds=7 --hours=0.5 --verbose   → one seed in-process, prints notes
//   npm run bot -- --mode=saboteur --seeds=1-6      → saboteur / exploiter suite (reports/econ/saboteur-report.md)
//   npm run bot -- --persona=cautious              → the "cautious miner" (never enters Pirate sectors, sectors §6.4)
//   npm run bot -- --persona=explorer              → the "explorer" (charts sectors by survey points, sectors §6.4 item 6)
//   npm run bot -- --persona=refiner               → the "refiner" (M4c: refinery + repair module in place of the M3 weapons)
//   npm run bot -- --sites=0                      → no opportunistic M4b site visits (tools/bot/sites.ts)
//   npm run bot -- --persona=cautious --secured=A,B → M4d: the lanes' Guild relay sectors start secured (Guarded)
import { node } from './node';
import { runSeed, type RunOptions, type RunResult } from './runner';
import { buildReport } from './report';
import { applyOverrides } from './whatif';
import type { LaneId } from '../../src/sim/regions';
import { main as saboteurMain } from './saboteur/cli';

interface CliArgs {
  seeds: number[];
  hours: number;
  jobs: number;
  out: string;
  json: string | null;
  worker: boolean;
  verbose: boolean;
  bot: Partial<RunOptions>;
  /** What-if overrides of balance constants (bot process only). */
  sets: string[];
}

function parseSeeds(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(',')) {
    const m = /^(\d+)-(\d+)$/.exec(part.trim());
    if (m) for (let s = Number(m[1]); s <= Number(m[2]); s++) out.push(s);
    else if (part.trim()) out.push(Number(part.trim()));
  }
  return out;
}

function parseArgs(argv: string[]): CliArgs {
  const { os } = node();
  const get = (k: string): string | undefined => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const seeds = parseSeeds(get('seeds') ?? '1-20');
  const bot: Partial<RunOptions> = {};
  if (get('dwell') !== undefined) bot.dwellSeconds = Number(get('dwell'));
  if (get('contracts') !== undefined) bot.contracts = get('contracts') !== '0';
  if (get('firstday') !== undefined) bot.firstDay = get('firstday') !== '0';
  if (get('training') !== undefined) bot.training = get('training') === 'play' ? 'play' : 'skip';
  if (get('stuck') !== undefined) bot.stuckMinutes = Number(get('stuck'));
  if (get('persona') !== undefined) {
    const persona = get('persona');
    bot.persona = persona === 'cautious' || persona === 'explorer' || persona === 'refiner' ? persona : 'standard';
  }
  if (get('sites') !== undefined) bot.sites = get('sites') !== '0';
  const secured = get('secured');
  if (secured !== undefined) bot.secured = secured.split(',').map((l) => l.trim().toUpperCase()).filter((l): l is LaneId => l === 'A' || l === 'B');
  return {
    seeds,
    hours: Number(get('hours') ?? 2),
    jobs: Math.max(1, Number(get('jobs') ?? Math.min(seeds.length, Math.max(1, os.cpus().length - 1)))),
    out: get('out') ?? 'reports/econ/bot-report.md',
    json: get('json') ?? null,
    worker: argv.includes('--worker'),
    verbose: argv.includes('--verbose'),
    bot,
    sets: argv.filter((a) => a.startsWith('--set=')).map((a) => a.slice(6)),
  };
}

function runWorkerProcess(seeds: number[], argv: string[]): Promise<RunResult[]> {
  return new Promise((resolvePromise, reject) => {
    const passthrough = argv.filter((a) => !a.startsWith('--seeds=') && !a.startsWith('--jobs=') && a !== '--verbose');
    const { childProcess, process } = node();
    const child = childProcess.spawn(process.execPath, ['tools/bot/run.mjs', '--worker', `--seeds=${seeds.join(',')}`, ...passthrough], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`bot worker for seeds ${seeds.join(',')} exited with ${code}`));
      const results: RunResult[] = [];
      for (const line of out.split('\n')) if (line.startsWith('{')) results.push(JSON.parse(line) as RunResult);
      resolvePromise(results);
    });
  });
}

const fmtMin = (s: number | undefined): string => (s === undefined ? '-' : `${(s / 60).toFixed(1)} min`);

export async function main(argv: string[]): Promise<void> {
  // saboteur / exploiter mode (tools/bot/saboteur): npm run bot -- --mode=saboteur --seeds=1-6
  if (argv.includes('--mode=saboteur')) return saboteurMain(argv);
  const { fs, path, process } = node();
  const args = parseArgs(argv);
  const options: Partial<RunOptions> = { ...args.bot, hours: args.hours };
  const overrides = applyOverrides(args.sets);
  if (args.worker) {
    for (const seed of args.seeds) process.stdout.write(`${JSON.stringify(runSeed(seed, options))}\n`);
    return;
  }
  const started = Date.now();
  let results: RunResult[];
  if (args.jobs <= 1 || args.seeds.length === 1) {
    results = [];
    for (const seed of args.seeds) {
      const r = runSeed(seed, options);
      results.push(r);
      console.error(`seed ${seed}: ${(r.wallMs / 1000).toFixed(1)} s wall, credits ${r.final.credits}, goals ${Object.keys(r.milestones).length}`);
      if (args.verbose) {
        for (const [id, t] of Object.entries(r.milestones)) console.error(`  ${id.padEnd(16)} ${fmtMin(t)}`);
        for (const n of r.notes) console.error(`  [${(n.tick / 3600).toFixed(1)} min] ${n.kind}: ${n.detail}`);
        for (const n of r.stuck) console.error(`  STUCK [tick ${n.tick}] ${n.kind}: ${n.detail}`);
        console.error(`  counts ${JSON.stringify(r.counts)}`);
        console.error(`  failures ${JSON.stringify(r.failures)} ${JSON.stringify(r.failureExamples.slice(0, 5))}`);
        console.error(`  credits by reason ${JSON.stringify(r.creditsByReason)}`);
        console.error(`  vein ${JSON.stringify(r.vein)} docked ${JSON.stringify(r.docked)} trips ${r.trips.length}`);
        console.error(`  final ${JSON.stringify(r.final)}`);
        console.error(`  mined ${JSON.stringify(r.mined)}`);
        console.error(`  fuelByMode ${JSON.stringify(r.fuelByMode)} secondsByMode ${JSON.stringify(r.secondsByMode)}`);
        for (const t of r.trips) console.error(`  trip ${(t.start / 60).toFixed(1)}-${(t.end / 60).toFixed(1)} min: ${t.units.toFixed(0)} u ${t.value.toFixed(0)} kr mining ${t.miningSeconds.toFixed(0)} s vein ${t.veinSeconds.toFixed(0)} s transit ${t.transitSeconds.toFixed(0)} s fuel ${t.fuelUsed.toFixed(1)}${t.ring2 ? " P2" : ""}`);
      }
    }
  } else {
    const groups: number[][] = Array.from({ length: Math.min(args.jobs, args.seeds.length) }, () => []);
    args.seeds.forEach((s, i) => groups[i % groups.length]!.push(s));
    const parts = await Promise.all(groups.map((g) => runWorkerProcess(g, argv)));
    results = parts.flat().sort((a, b) => a.seed - b.seed);
  }
  console.error(`${results.length} seeds × ${args.hours} h in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (args.json) {
    fs.mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true });
    fs.writeFileSync(args.json, JSON.stringify(results));
  }
  const report = await buildReport(results, { hours: args.hours, options, overrides });
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, report);
  console.error(`report → ${args.out}`);
}
