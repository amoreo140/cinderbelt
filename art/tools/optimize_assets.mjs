#!/usr/bin/env node
// Cinderbelt – asset optimizer (post-step of the Blender pipeline, art/README.md §2.9).
//
//   npm run assets:optimize                 everything (idempotent – optimized files are skipped)
//   npm run assets:optimize -- --only models,skybox,planets,vfx
//   npm run assets:optimize -- --force      re-process already optimized GLBs
//   npm run assets:optimize -- --check      report what is not optimized (exit code 1), change nothing
//
// models  – every public/assets/models/**/*.glb: the shared AF_Palette atlas images are no longer
//           embedded but referenced by URI (../../textures/palette_default_<kind>.png, the game binds
//           one shared copy), vertex order optimized, NORMAL quantized to 8 bit and TEXCOORD_n to 16 bit
//           (KHR_mesh_quantization; POSITION and COLOR_0 stay as exported), then EXT_meshopt_compression.
//           Stamped with GENERATOR_STAMP in asset.generator.
// skybox  – ring<N>_bg.jpg -> ring<N>_bg.webp (lossy q92), ring<N>_env.hdr re-encoded with lossless RGBE RLE.
// planets – albedo -> WebP q92, emissive/normal -> lossless WebP, clouds -> WebP (lossless alpha);
//           planets.json file names are rewritten; the JPG/PNG originals are removed.
// vfx     – VFX_WEBP flipbooks -> WebP q95 with lossless alpha (src/render/fx/textures.ts knows the list).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = path.join(ROOT, 'public', 'assets');
const MODELS = path.join(ASSETS, 'models');
const TEXTURES = path.join(ASSETS, 'textures');

/** Marker in asset.generator of an optimized GLB (bump to re-process everything). */
export const GENERATOR_STAMP = 'af-optimize/1';
/** Embedded atlas image name -> shared file kind (textures/palette_default_<kind>.png). */
export const PALETTE_IMAGES = { AF_Palette_BaseColor: 'basecolor', AF_Palette_ORM: 'orm', AF_Palette_Emissive: 'emissive' };
/** VFX textures shipped as WebP (keep in sync with WEBP in src/render/fx/textures.ts). */
export const VFX_WEBP = ['explosion_small', 'explosion_large'];

const QUANTIZE = {
  // POSITION stays float: node transforms (pivots) and the asteroid bounds stay bit-exact
  pattern: /^(NORMAL|TEXCOORD_\d+|COLOR_\d+)$/,
  quantizeNormal: 8,
  quantizeTexcoord: 16,
  // COLOR_0 is exported as uint16 (linear); 8 bit would band dark sRGB values – keep it
  quantizeColor: 16,
};
const WEBP = {
  photo: { quality: 92, effort: 6, smartSubsample: true },
  lossless: { lossless: true, effort: 6, exact: true },
  alpha: { quality: 90, alphaQuality: 100, effort: 6, smartSubsample: true, exact: true },
  flipbook: { quality: 95, alphaQuality: 100, effort: 6, smartSubsample: true, exact: true },
};

const log = (...a) => console.log(...a);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

function walk(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, ext) : e.name.endsWith(ext) ? [p] : [];
  });
}

/**
 * Atomic write (a viewer or the dev server never sees a half-written file). Windows refuses the
 * rename while another process (dev server, viewer, antivirus) holds the target – retry, then
 * fall back to a plain write.
 */
function writeFile(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  fs.rmSync(tmp, { force: true });
  fs.writeFileSync(file, data);
}

// ---------------------------------------------------------------------------------------------
// GLB container helpers
// ---------------------------------------------------------------------------------------------

export function readGlbJson(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
}

/** Replaces the JSON chunk of a GLB (BIN chunk unchanged). */
function writeGlbJson(bytes, json) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const oldLength = view.getUint32(12, true);
  const rest = bytes.subarray(20 + oldLength);
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (text.length % 4)) % 4;
  if (pad) text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
  const out = Buffer.alloc(12 + 8 + text.length + rest.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(text.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  text.copy(out, 20);
  Buffer.from(rest).copy(out, 20 + text.length);
  return out;
}

/** What is not optimized about one GLB (empty = fine). */
export function glbProblems(json) {
  const problems = [];
  if (!(json.asset?.generator ?? '').includes(GENERATOR_STAMP)) problems.push('not optimized');
  for (const image of json.images ?? []) {
    if (image.name in PALETTE_IMAGES && image.bufferView !== undefined) problems.push(`embeds ${image.name}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// models
// ---------------------------------------------------------------------------------------------

let io = null;
async function gltfIO() {
  if (!io) {
    await MeshoptEncoder.ready;
    await MeshoptDecoder.ready;
    io = new NodeIO()
      .setLogger({ debug() {}, info() {}, warn: (m) => log('  warn:', m), error: (m) => console.error('  error:', m) })
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  }
  return io;
}

const sharedPixels = new Map();
async function rawPixels(input) {
  // RGBA always: WebP drops an all-opaque alpha channel
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}
async function samePixels(a, b) {
  return a.info.width === b.info.width && a.info.height === b.info.height && a.info.channels === b.info.channels && a.data.equals(b.data);
}

async function optimizeGlb(file, { force }) {
  const before = fs.readFileSync(file);
  if (!force && glbProblems(readGlbJson(before)).length === 0) return null;
  const io = await gltfIO();
  const doc = await io.read(file);

  // shared palette atlas: drop the embedded copy when it is identical to the shipped one
  const external = new Map();
  for (const texture of doc.getRoot().listTextures()) {
    const kind = PALETTE_IMAGES[texture.getName()];
    if (!kind) continue;
    const sharedFile = path.join(TEXTURES, `palette_default_${kind}.png`);
    if (!fs.existsSync(sharedFile)) {
      log(`  ${rel(file)}: ${rel(sharedFile)} missing – atlas stays embedded`);
      continue;
    }
    if (!sharedPixels.has(sharedFile)) sharedPixels.set(sharedFile, await rawPixels(sharedFile));
    const image = texture.getImage();
    if (image && !(await samePixels(await rawPixels(Buffer.from(image)), sharedPixels.get(sharedFile)))) {
      log(`  WARNING ${rel(file)}: ${texture.getName()} differs from ${rel(sharedFile)} – atlas stays embedded ` +
        '(rebuild the liveries stage: build_all.py -- --only liveries, then re-run the optimizer)');
      continue;
    }
    // the writer needs data-less textures after the embedded ones, so recreate it at the end
    const replacement = doc.createTexture(texture.getName()).setMimeType('image/png');
    for (const parent of texture.listParents()) if (parent !== doc.getRoot()) parent.swap(texture, replacement);
    texture.dispose();
    external.set(replacement.getName(), path.relative(path.dirname(file), sharedFile).split(path.sep).join('/'));
  }

  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }), quantize(QUANTIZE));
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const asset = doc.getRoot().getAsset();
  asset.generator = `${(asset.generator ?? '').replace(/ \| af-optimize\/\d+$/, '')} | ${GENERATOR_STAMP}`;

  let out = Buffer.from(await io.writeBinary(doc));
  const json = readGlbJson(out);
  for (const image of json.images ?? []) {
    const uri = external.get(image.name);
    if (uri && image.bufferView === undefined) image.uri = uri;
    if (image.bufferView === undefined && image.uri === undefined) throw new Error(`${rel(file)}: image ${image.name} has no data`);
  }
  out = writeGlbJson(out, json);
  writeFile(file, out);
  return [before.length, out.length];
}

async function optimizeModels(opts) {
  let before = 0, after = 0, done = 0, skipped = 0;
  for (const file of walk(MODELS, '.glb')) {
    const r = await optimizeGlb(file, opts);
    if (!r) {
      skipped++;
      continue;
    }
    done++;
    before += r[0];
    after += r[1];
  }
  log(`models: ${done} optimized (${kb(before)} -> ${kb(after)}), ${skipped} already optimized`);
}

// ---------------------------------------------------------------------------------------------
// images
// ---------------------------------------------------------------------------------------------

/** src -> dst WebP; verifies lossless output pixel by pixel; removes src. Returns [before, after]. */
async function toWebp(src, dst, options) {
  const input = fs.readFileSync(src);
  const out = await sharp(input).webp(options).toBuffer();
  if (options.lossless) {
    const [a, b] = await Promise.all([rawPixels(input), rawPixels(out)]);
    if (!(await samePixels(a, b))) throw new Error(`${rel(src)}: lossless WebP differs from the source`);
  }
  writeFile(dst, out);
  fs.rmSync(src);
  log(`  ${rel(src)} -> ${path.basename(dst)}  ${kb(input.length)} -> ${kb(out.length)}`);
  return [input.length, out.length];
}

const webpName = (file) => file.replace(/\.(jpe?g|png)$/i, '.webp');

/** Radiance .hdr: header + flat or RLE RGBE scanlines. */
export function parseHdr(bytes) {
  let pos = 0;
  const line = () => {
    const end = bytes.indexOf(0x0a, pos);
    if (end < 0) throw new Error('bad HDR header');
    const text = Buffer.from(bytes.subarray(pos, end)).toString('latin1');
    pos = end + 1;
    return text;
  };
  if (!line().startsWith('#?')) throw new Error('not a Radiance HDR file');
  while (line() !== '');
  const res = /^-Y (\d+) \+X (\d+)$/.exec(line());
  if (!res) throw new Error('unsupported HDR orientation');
  const height = Number(res[1]);
  const width = Number(res[2]);
  return { header: bytes.subarray(0, pos), data: bytes.subarray(pos), width, height };
}

/** Flat RGBE pixels of an HDR (decodes the new-style RLE when present). */
export function hdrPixels(bytes) {
  const { data, width, height } = parseHdr(bytes);
  if (data.length === width * height * 4) return Buffer.from(data);
  const out = Buffer.alloc(width * height * 4);
  let p = 0;
  for (let y = 0; y < height; y++) {
    if (data[p] !== 2 || data[p + 1] !== 2 || ((data[p + 2] << 8) | data[p + 3]) !== width) throw new Error('unsupported HDR encoding');
    p += 4;
    for (let c = 0; c < 4; c++) {
      for (let x = 0; x < width; ) {
        let count = data[p++];
        if (count > 128) {
          count -= 128;
          const v = data[p++];
          for (let k = 0; k < count; k++) out[(y * width + x++) * 4 + c] = v;
        } else {
          for (let k = 0; k < count; k++) out[(y * width + x++) * 4 + c] = data[p++];
        }
      }
    }
  }
  return out;
}

/** New-style RLE (Radiance fwritecolrs): per scanline and channel runs of >= 4 equal bytes. */
export function encodeHdrRle(header, pixels, width, height) {
  const MIN_RUN = 4;
  const chunks = [Buffer.from(header)];
  const channel = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    const out = [2, 2, width >> 8, width & 0xff];
    for (let c = 0; c < 4; c++) {
      for (let x = 0; x < width; x++) channel[x] = pixels[(y * width + x) * 4 + c];
      let i = 0;
      while (i < width) {
        let beg = i;
        let run = 0;
        while (beg < width) {
          run = 1;
          while (beg + run < width && run < 127 && channel[beg + run] === channel[beg]) run++;
          if (run >= MIN_RUN) break;
          beg += run;
        }
        if (beg > width) beg = width;
        while (i < beg) {
          const n = Math.min(128, beg - i);
          out.push(n);
          for (let k = 0; k < n; k++) out.push(channel[i + k]);
          i += n;
        }
        if (beg < width && run >= MIN_RUN) {
          out.push(128 + run, channel[beg]);
          i = beg + run;
        }
      }
    }
    chunks.push(Buffer.from(out));
  }
  return Buffer.concat(chunks);
}

async function optimizeSkybox() {
  const dir = path.join(ASSETS, 'skybox');
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (/^ring\d+_bg\.jpe?g$/i.test(name)) await toWebp(file, webpName(file), WEBP.photo);
    if (/\.hdr$/i.test(name)) {
      const bytes = fs.readFileSync(file);
      const hdr = parseHdr(bytes);
      if (hdr.data.length !== hdr.width * hdr.height * 4) continue; // already RLE
      const pixels = Buffer.from(hdr.data);
      const out = encodeHdrRle(hdr.header, pixels, hdr.width, hdr.height);
      if (!hdrPixels(out).equals(pixels)) throw new Error(`${rel(file)}: RLE round trip failed`);
      writeFile(file, out);
      log(`  ${rel(file)} RLE  ${kb(bytes.length)} -> ${kb(out.length)}`);
    }
  }
}

async function optimizePlanets() {
  const dir = path.join(ASSETS, 'planets');
  const metaFile = path.join(dir, 'planets.json');
  if (!fs.existsSync(metaFile)) return;
  let text = fs.readFileSync(metaFile, 'utf8');
  const meta = JSON.parse(text);
  const jobs = new Map(); // file name -> webp options
  for (const [key, p] of Object.entries(meta)) {
    if (key.startsWith('_')) continue;
    if (p.albedo) jobs.set(p.albedo, WEBP.photo);
    if (p.emissive) jobs.set(p.emissive, WEBP.lossless);
    if (p.normal) jobs.set(p.normal, WEBP.lossless);
    if (p.clouds?.texture) jobs.set(p.clouds.texture, WEBP.alpha);
  }
  for (const [name, options] of jobs) {
    if (!/\.(jpe?g|png)$/i.test(name)) continue;
    const src = path.join(dir, name);
    const dst = webpName(src);
    if (fs.existsSync(src)) await toWebp(src, dst, options);
    else if (!fs.existsSync(dst)) throw new Error(`planets.json references a missing file: ${name}`);
    // keep the file's formatting: replace only the quoted file names
    text = text.split(`"${name}"`).join(`"${path.basename(dst)}"`);
  }
  writeFile(metaFile, text);
}

async function optimizeVfx() {
  for (const name of VFX_WEBP) {
    const src = path.join(ASSETS, 'vfx', `${name}.png`);
    if (fs.existsSync(src)) await toWebp(src, webpName(src), WEBP.flipbook);
  }
}

// ---------------------------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------------------------

function check() {
  const problems = [];
  for (const file of walk(MODELS, '.glb')) {
    for (const p of glbProblems(readGlbJson(fs.readFileSync(file)))) problems.push(`${rel(file)}: ${p}`);
  }
  for (const name of fs.existsSync(path.join(ASSETS, 'skybox')) ? fs.readdirSync(path.join(ASSETS, 'skybox')) : []) {
    if (/^ring\d+_bg\.jpe?g$/i.test(name)) problems.push(`skybox/${name}: not WebP`);
    if (/\.hdr$/i.test(name)) {
      const hdr = parseHdr(fs.readFileSync(path.join(ASSETS, 'skybox', name)));
      if (hdr.data.length === hdr.width * hdr.height * 4) problems.push(`skybox/${name}: not RLE`);
    }
  }
  const metaFile = path.join(ASSETS, 'planets', 'planets.json');
  if (fs.existsSync(metaFile)) {
    for (const m of fs.readFileSync(metaFile, 'utf8').matchAll(/"([\w-]+\.(?:jpe?g|png))"/g)) {
      if (m[1] !== 'gas_giant_ring.png') problems.push(`planets.json: ${m[1]} not WebP`);
    }
  }
  for (const name of VFX_WEBP) if (fs.existsSync(path.join(ASSETS, 'vfx', `${name}.png`))) problems.push(`vfx/${name}.png: not WebP`);
  return problems;
}

// ---------------------------------------------------------------------------------------------

async function main(argv) {
  const arg = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  if (argv.includes('--check')) {
    const problems = check();
    for (const p of problems) log(p);
    log(problems.length ? `${problems.length} asset(s) not optimized – run npm run assets:optimize` : 'all assets optimized');
    process.exitCode = problems.length ? 1 : 0;
    return;
  }
  const only = new Set((arg('--only') ?? 'models,skybox,planets,vfx').split(','));
  const force = argv.includes('--force');
  const t0 = Date.now();
  if (only.has('models')) await optimizeModels({ force });
  if (only.has('skybox')) await optimizeSkybox();
  if (only.has('planets')) await optimizePlanets();
  if (only.has('vfx')) await optimizeVfx();
  log(`optimize done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
