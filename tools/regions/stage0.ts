// Sector prototype tool (stage 0 of the sectors design):
//   metric  – the "not a target" metric (§2.6) for both variants over many seeds + the pick
//   islands – flood-fill connectivity of every depth 1–3 sector over many seeds (§2.2)
//   bench   – the §6.8 benchmark (regionAt, chunk cache, world build, map tiles, polygons)
//   render  – top-down PNGs of the sector field (quick look without the game)
// Usage: node tools/regions/run.mjs metric --seeds=1-20
import sharp from 'sharp';
import {
  REGION_VARIANTS,
  borderOrientation,
  buildLabelTile,
  buildRegionWorld,
  defaultRegionInputs,
  depthBorderSpread,
  freshRegionField,
  pickVariant,
  regionField,
  regionMask,
  regionPolygon,
  startMapReport,
  type RegionVariant,
  type RegionWorld,
} from '../../src/sim/regions';

const arg = (args: string[], name: string, fallback: string): string => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

function seedList(spec: string): number[] {
  const out: number[] = [];
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map(Number);
    if (b === undefined) out.push(a!);
    else for (let s = a!; s <= b; s++) out.push(s);
  }
  return out;
}

const world = (seed: number, variant: RegionVariant): RegionWorld => buildRegionWorld(seed, variant, defaultRegionInputs(seed));

const pct = (v: number): string => `${(v * 100).toFixed(1)} %`;
const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
const sd = (xs: number[]): number => Math.sqrt(mean(xs.map((v) => (v - mean(xs)) ** 2)));

async function metric(args: string[]): Promise<void> {
  const seeds = seedList(arg(args, 'seeds', '1-20'));
  const rows: Record<RegionVariant, Record<string, number[]>> = { A: {}, B: {} };
  const push = (v: RegionVariant, k: string, x: number) => (rows[v][k] ??= []).push(x);
  for (const variant of REGION_VARIANTS) {
    for (const seed of seeds) {
      const w = world(seed, variant);
      const o = borderOrientation(w.field, { step: 50, rMin: 300, rMax: 8000 });
      const near = borderOrientation(w.field, { step: 50, rMin: 300, rMax: 4000 });
      const d2 = depthBorderSpread(w.field, 2);
      const d3 = depthBorderSpread(w.field, 3);
      const sm = startMapReport(w);
      push(variant, 'tangential', o.tangentialShare);
      push(variant, 'tangential<4000', near.tangentialShare);
      o.histogram.forEach((h, i) => push(variant, `hist${i}`, h));
      push(variant, 'd2mean', d2.mean);
      push(variant, 'd2std', d2.std);
      push(variant, 'd2range', d2.max - d2.min);
      push(variant, 'd3mean', d3.mean);
      push(variant, 'd3std', d3.std);
      push(variant, 'known', sm.knownShare);
      push(variant, 'gap', sm.largestGapDeg);
      push(variant, 'startPass', sm.pass ? 1 : 0);
      push(variant, 'knownSectors', sm.knownSectors);
      push(variant, 'sectorsR1600', sm.sectors);
      for (const d of [1, 2, 3] as const) {
        const list = w.regions.filter((r) => r.seed.depth === d);
        push(variant, `count${d}`, list.length);
        push(variant, `area${d}`, mean(list.map((r) => r.area)) / 1e6);
      }
      for (const d of [2, 3] as const) {
        const b = w.balance[d]!;
        push(variant, `bal${d}area`, b.area);
        push(variant, `bal${d}cautious`, b.cautious);
        push(variant, `bal${d}ok`, b.ok ? 1 : 0);
        push(variant, `bal${d}swaps`, b.swaps.length);
        push(variant, `bal${d}pirate`, b.shares.pirate);
        push(variant, `bal${d}guarded`, b.shares.guarded);
      }
      console.error(`${variant} seed ${seed}: tangential ${pct(o.tangentialShare)}, start known ${pct(sm.knownShare)} gap ${sm.largestGapDeg}°`);
    }
  }
  const line = (label: string, key: string, fmt: (v: number) => string) =>
    `| ${label} | ${REGION_VARIANTS.map((v) => `${fmt(mean(rows[v][key]!))} (σ ${fmt(sd(rows[v][key]!))}, ${fmt(Math.min(...rows[v][key]!))}–${fmt(Math.max(...rows[v][key]!))})`).join(' | ')} |`;
  const num = (d: number) => (v: number) => v.toFixed(d);
  console.log(`Seeds: ${seeds[0]}–${seeds[seeds.length - 1]} (${seeds.length})\n`);
  console.log('| Figure | A (mean, σ, min–max) | B (mean, σ, min–max) |');
  console.log('|---|---|---|');
  console.log(line('Tangential share r 300–8000 (target < 25 %)', 'tangential', pct));
  console.log(line('Tangential share r 300–4000', 'tangential<4000', pct));
  for (let i = 0; i < 6; i++) console.log(line(`Border angle to tangent ${i * 15}–${i * 15 + 15}°`, `hist${i}`, pct));
  console.log(line('Depth 1/2 border radius, mean (u)', 'd2mean', num(0)));
  console.log(line('Depth 1/2 border radius, σ over angle (u)', 'd2std', num(0)));
  console.log(line('Depth 1/2 border radius, max − min (u)', 'd2range', num(0)));
  console.log(line('Depth 2/3 border radius, mean (u)', 'd3mean', num(0)));
  console.log(line('Depth 2/3 border radius, σ over angle (u)', 'd3std', num(0)));
  console.log(line('Start: known area r < 1600 (target ≤ 60 %)', 'known', pct));
  console.log(line('Start: largest unknown gap (target ≥ 60°)', 'gap', num(0)));
  console.log(line('Start: criterion 2 passes (share of seeds)', 'startPass', pct));
  console.log(line('Start: known sectors (seed r < 1600)', 'knownSectors', num(1)));
  console.log(line('Sectors with seed r < 1600', 'sectorsR1600', num(1)));
  for (const d of [1, 2, 3]) {
    console.log(line(`Depth ${d}: sectors`, `count${d}`, num(1)));
    console.log(line(`Depth ${d}: mean area (M u²)`, `area${d}`, num(2)));
  }
  for (const d of [2, 3]) {
    console.log(line(`Depth ${d}: area exposure (0.95–1.10)`, `bal${d}area`, num(3)));
    console.log(line(`Depth ${d}: cautious exposure (0.85–1.00)`, `bal${d}cautious`, num(3)));
    console.log(line(`Depth ${d}: balanced into range (share of seeds)`, `bal${d}ok`, pct));
    console.log(line(`Depth ${d}: swaps`, `bal${d}swaps`, num(1)));
    console.log(line(`Depth ${d}: Pirate area share`, `bal${d}pirate`, pct));
    console.log(line(`Depth ${d}: Guarded area share`, `bal${d}guarded`, pct));
  }
  const a = mean(rows.A.tangential!);
  const b = mean(rows.B.tangential!);
  console.log(`\nPick (§2.6: lower tangential share, tie < 1 pp → B): **${pickVariant(a, b)}** (A ${pct(a)}, B ${pct(b)})`);
}

async function islands(args: string[]): Promise<void> {
  const seeds = seedList(arg(args, 'seeds', '1-200'));
  const step = Number(arg(args, 'step', '100'));
  for (const variant of REGION_VARIANTS) {
    let regions = 0;
    let coarse = 0;
    let broken = 0;
    for (const seed of seeds) {
      const w = world(seed, variant);
      for (const r of w.regions) {
        regions++;
        const m = regionMask(w.field, r.seed, step);
        if (m.filled === m.total) continue;
        // a stray sample on the coarse grid is usually a neck thinner than the step: recheck at 25 u
        coarse++;
        const fine = regionMask(w.field, r.seed, 25);
        if (fine.filled === fine.total) continue;
        broken++;
        if (broken <= 10) console.error(`${variant} seed ${seed} ${r.seed.id}: ${fine.total - fine.filled} stray 25 u samples of ${fine.total}`);
      }
    }
    console.log(`${variant}: ${regions} sectors (depth 1–3) over ${seeds.length} seeds – ${coarse} with stray samples at ${step} u, ${broken} still not connected at 25 u`);
  }
}

/** Deterministic points for the benchmark. */
function points(n: number, radius: number): Float64Array {
  const out = new Float64Array(n * 2);
  let s = 12345;
  const rnd = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(rnd()) * radius;
    const a = rnd() * Math.PI * 2;
    out[i * 2] = Math.cos(a) * r;
    out[i * 2 + 1] = Math.sin(a) * r;
  }
  return out;
}

async function bench(args: string[]): Promise<void> {
  const seeds = seedList(arg(args, 'seeds', '1-5'));
  const time = (fn: () => void): number => {
    const t = performance.now();
    fn();
    return performance.now() - t;
  };
  for (const variant of REGION_VARIANTS) {
    const res: Record<string, number[]> = {};
    const push = (k: string, v: number) => (res[k] ??= []).push(v);
    for (const seed of seeds) {
      // regionAt: cold (fresh field, empty caches) and warm, over a 9 000 u disc
      const pts = points(200_000, 9000);
      const cold = freshRegionField(seed, variant);
      let sink = 0;
      push('coldUs', (time(() => {
        for (let i = 0; i < 20_000; i++) sink += cold.regionAt(pts[i * 2]!, pts[i * 2 + 1]!).key;
      }) * 1000) / 20_000);
      push('warmUs', (time(() => {
        for (let i = 0; i < 200_000; i++) sink += cold.regionAt(pts[i * 2]!, pts[i * 2 + 1]!).key;
      }) * 1000) / 200_000);
      // chunk cache: first and repeated lookups of 4 000 chunks
      const chunks = freshRegionField(seed, variant);
      push('chunkFirstUs', (time(() => {
        for (let i = 0; i < 4000; i++) sink += chunks.regionOfChunk((i % 64) - 32, Math.floor(i / 64) - 32).key;
      }) * 1000) / 4000);
      push('chunkHitUs', (time(() => {
        for (let k = 0; k < 10; k++) for (let i = 0; i < 4000; i++) sink += chunks.regionOfChunk((i % 64) - 32, Math.floor(i / 64) - 32).key;
      }) * 1000) / 40_000);
      // world build: lanes, raster 100 u, security, balancing (warm field like in a running game)
      const inputs = defaultRegionInputs(seed);
      regionField(seed, variant);
      push('worldMs', time(() => void buildRegionWorld(seed, variant, inputs)));
      const w = buildRegionWorld(seed, variant, inputs);
      // map: label tiles of the max zoom-out view (MAX_HALF_SIZE 9 000 → ~29 000 × 18 000 u at 16:10)
      for (const step of [200, 100, 50]) {
        const f = freshRegionField(seed, variant);
        const tiles: [number, number][] = [];
        for (let ty = -9; ty < 9; ty++) for (let tx = -15; tx < 15; tx++) tiles.push([tx, ty]);
        const ms = time(() => {
          for (const [tx, ty] of tiles) sink += buildLabelTile(f, tx, ty, step).ids.length;
        });
        push(`view${step}Ms`, ms);
        push(`tile${step}Ms`, ms / tiles.length);
      }
      // the first frame around home: 6 × 6 tiles at 100 u, warm field
      const warmField = regionField(seed, variant);
      push('homeView100Ms', time(() => {
        for (let ty = -3; ty < 3; ty++) for (let tx = -3; tx < 3; tx++) sink += buildLabelTile(warmField, tx, ty, 100).ids.length;
      }));
      // polygons only for the known sectors at the start (Charted + Reported)
      const known = [...w.startKnowledge.keys()].map((id) => w.field.seedById(id)!).filter(Boolean);
      for (const step of [50, 100]) {
        const ms = time(() => {
          for (const s of known) sink += regionPolygon(w.field, s, step).length;
        });
        push(`poly${step}Ms`, ms / Math.max(1, known.length));
        push(`polyAll${step}Ms`, ms);
      }
      push('knownCount', known.length);
      if (sink === 42) console.log('');
    }
    const f = (k: string, d = 2) => `${mean(res[k]!).toFixed(d)} (max ${Math.max(...res[k]!).toFixed(d)})`;
    console.log(`\n### Variant ${variant} (seeds ${seeds.join(', ')})\n`);
    console.log('| Operation | Measured | Target (§6.8) |');
    console.log('|---|---|---|');
    console.log(`| regionAt, cold caches | ${f('coldUs')} µs | 2–5 µs |`);
    console.log(`| regionAt, warm | ${f('warmUs')} µs | 2–5 µs |`);
    console.log(`| regionOfChunk, first | ${f('chunkFirstUs')} µs | – |`);
    console.log(`| regionOfChunk, cached | ${f('chunkHitUs', 3)} µs | O(1) |`);
    console.log(`| World build (lanes, raster 100 u to 10 000 u, security, balancing) | ${f('worldMs', 0)} ms | once per seed, idle/start |`);
    console.log(`| Label tile 1 000 u at 200 u (25 samples) | ${f('tile200Ms', 3)} ms | – |`);
    console.log(`| Label tile at 100 u (100 samples) | ${f('tile100Ms', 3)} ms | – |`);
    console.log(`| Label tile at 50 u (400 samples) | ${f('tile50Ms', 3)} ms | – |`);
    console.log(`| Max zoom-out view, 540 tiles at 200 u, cold | ${f('view200Ms', 0)} ms | first frame ≤ 50 ms |`);
    console.log(`| Same view at 100 u, cold | ${f('view100Ms', 0)} ms | refined progressively |`);
    console.log(`| Same view at 50 u, cold | ${f('view50Ms', 0)} ms | – |`);
    console.log(`| Home view 6 × 6 tiles at 100 u, warm | ${f('homeView100Ms', 1)} ms | first frame ≤ 50 ms |`);
    console.log(`| Polygon of one known sector at 50 u | ${f('poly50Ms', 1)} ms | only known sectors |`);
    console.log(`| Polygon of one known sector at 100 u | ${f('poly100Ms', 1)} ms | – |`);
    console.log(`| All known sectors at start (${f('knownCount', 1)}) at 50 u | ${f('polyAll50Ms', 0)} ms | – |`);
  }
}

const SECURITY_RGB: Record<string, [number, number, number]> = {
  quiet: [96, 120, 150],
  guarded: [60, 170, 100],
  contested: [200, 170, 60],
  pirate: [200, 60, 50],
};

async function render(args: string[]): Promise<void> {
  const seeds = seedList(arg(args, 'seeds', '1-5'));
  const out = arg(args, 'out', '.');
  const half = Number(arg(args, 'half', '9000'));
  const px = Number(arg(args, 'px', '900'));
  for (const variant of REGION_VARIANTS) {
    for (const seed of seeds) {
      const w = world(seed, variant);
      const scale = (2 * half) / px;
      const keys = new Float64Array(px * px);
      const img = new Uint8Array(px * px * 3);
      for (let j = 0; j < px; j++) {
        for (let i = 0; i < px; i++) {
          const x = -half + (i + 0.5) * scale;
          const y = half - (j + 0.5) * scale;
          const s = w.field.regionAt(x, y);
          keys[j * px + i] = s.key;
          const info = w.info(s.id);
          const sec = info?.security ?? 'contested';
          const known = w.startKnowledge.get(s.id);
          const [r, g, b] = SECURITY_RGB[sec]!;
          const k = known === 'charted' ? 0.85 : known === 'reported' ? 0.6 : 0.35;
          const o = (j * px + i) * 3;
          img[o] = r * k;
          img[o + 1] = g * k;
          img[o + 2] = b * k;
        }
      }
      // borders
      for (let j = 0; j < px - 1; j++) {
        for (let i = 0; i < px - 1; i++) {
          const k = keys[j * px + i];
          if (k !== keys[j * px + i + 1] || k !== keys[(j + 1) * px + i]) {
            const o = (j * px + i) * 3;
            img[o] = img[o + 1] = img[o + 2] = 235;
          }
        }
      }
      const dot = (x: number, y: number, rad: number, c: [number, number, number]) => {
        const ci = Math.round((x + half) / scale);
        const cj = Math.round((half - y) / scale);
        for (let dj = -rad; dj <= rad; dj++)
          for (let di = -rad; di <= rad; di++) {
            const i = ci + di;
            const j = cj + dj;
            if (i < 0 || j < 0 || i >= px || j >= px || di * di + dj * dj > rad * rad) continue;
            const o = (j * px + i) * 3;
            [img[o], img[o + 1], img[o + 2]] = c;
          }
      };
      for (const lane of w.lanes) for (const p of lane.points) dot(p.x, p.y, 1, [120, 220, 255]);
      for (const r of w.regions) dot(r.seed.x, r.seed.y, 1, [20, 20, 20]);
      for (const f of defaultRegionInputs(seed).fortresses) dot(f.pos.x, f.pos.y, 4, [255, 40, 200]);
      dot(0, 0, 4, [255, 255, 255]);
      const file = `${out}/regions-${variant}-seed${seed}.png`;
      await sharp(img, { raw: { width: px, height: px, channels: 3 } }).png().toFile(file);
      console.log(file);
    }
  }
}

export async function main(args: string[]): Promise<void> {
  const cmd = args[0];
  if (cmd === 'metric') await metric(args.slice(1));
  else if (cmd === 'islands') await islands(args.slice(1));
  else if (cmd === 'bench') await bench(args.slice(1));
  else if (cmd === 'render') await render(args.slice(1));
  else console.log('usage: node tools/regions/run.mjs <metric|islands|bench|render> [--seeds=1-20] [--out=dir]');
}
