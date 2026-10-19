#!/usr/bin/env node
// Compares two sets of GLBs (e.g. git HEAD vs optimized) triangle by triangle: scene graph (node
// names + TRS), materials, and per-vertex errors of every attribute (meshopt decoded, dequantized).
//   node art/tools/compare_glb.mjs <dirA> <dirB>
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

await MeshoptDecoder.ready;
const io = new NodeIO().setLogger({ debug() {}, info() {}, warn() {}, error: console.error })
  .registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const [dirA, dirB] = process.argv.slice(2);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.glb') ? [path.join(d, e.name)] : []);

function nodes(doc) {
  return doc.getRoot().listNodes().filter((n) => n.getName()).map((n) => `${n.getName()} t${n.getTranslation().map((v) => v.toFixed(6))} r${n.getRotation().map((v) => v.toFixed(6))} s${n.getScale().map((v) => v.toFixed(6))} mesh:${!!n.getMesh()} kids:${n.listChildren().map((c) => c.getName()).join(',')}`).sort();
}
function materials(doc) {
  return doc.getRoot().listMaterials().map((m) => JSON.stringify([m.getName(), m.getBaseColorFactor(), m.getEmissiveFactor(), m.getMetallicFactor(), m.getRoughnessFactor(), m.getAlphaMode(), m.getDoubleSided(),
    m.getBaseColorTexture()?.getName(), m.getMetallicRoughnessTexture()?.getName(), m.getEmissiveTexture()?.getName(), m.getBaseColorTextureInfo()?.getTexCoord(), m.getBaseColorTextureInfo()?.getMinFilter(), m.getBaseColorTextureInfo()?.getMagFilter(),
    m.getExtension('KHR_materials_emissive_strength')?.getEmissiveStrength()])).sort();
}
/** triangle key (positions, canonical rotation keeping winding) -> per-corner attribute values */
function triangles(prim) {
  const pos = prim.getAttribute('POSITION');
  const idx = prim.getIndices();
  const sem = prim.listSemantics();
  const count = idx ? idx.getCount() : pos.getCount();
  const out = new Map();
  const el = [];
  for (let t = 0; t < count; t += 3) {
    const v = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
    const keys = v.map((i) => pos.getElement(i, el).join(','));
    let r = 0;
    for (let k = 1; k < 3; k++) if (keys[k] < keys[r]) r = k;
    const order = [r, (r + 1) % 3, (r + 2) % 3];
    const key = order.map((k) => keys[k]).join('|');
    const attrs = order.map((k) => Object.fromEntries(sem.map((s) => [s, prim.getAttribute(s).getElement(v[k], [])])));
    const list = out.get(key) ?? [];
    list.push(attrs);
    out.set(key, list);
  }
  return out;
}
const maxErr = {};
let files = 0, problems = 0;
for (const fa of walk(dirA)) {
  const fb = path.join(dirB, path.relative(dirA, fa));
  if (!fs.existsSync(fb)) { console.log('missing', fb); problems++; continue; }
  const [a, b] = [await io.read(fa), await io.read(fb)];
  files++;
  const na = nodes(a), nb = nodes(b);
  if (JSON.stringify(na) !== JSON.stringify(nb)) { console.log('NODES differ', fa); problems++; }
  if (JSON.stringify(materials(a)) !== JSON.stringify(materials(b))) { console.log('MATERIALS differ', fa, materials(a), materials(b)); problems++; }
  const meshesA = a.getRoot().listNodes().filter((n) => n.getMesh());
  for (const n of meshesA) {
    const m = b.getRoot().listNodes().find((x) => x.getName() === n.getName() && x.getMesh());
    if (!m) { console.log('mesh node missing', fa, n.getName()); problems++; continue; }
    const pa = n.getMesh().listPrimitives(), pb = m.getMesh().listPrimitives();
    if (pa.length !== pb.length) { console.log('primitive count', fa, n.getName()); problems++; continue; }
    pa.forEach((p, i) => {
      const ta = triangles(p), tb = triangles(pb[i]);
      if (ta.size !== tb.size) { console.log('triangle sets differ', fa, n.getName(), ta.size, tb.size); problems++; return; }
      for (const [key, la] of ta) {
        const lb = tb.get(key);
        if (!lb || lb.length !== la.length) { console.log('triangle missing', fa, n.getName()); problems++; return; }
        // equal-position triangles (rare duplicates): compare against the closest candidate
        for (const tri of la) {
          let best = null;
          for (const cand of lb) {
            let e = 0;
            for (let k = 0; k < 3; k++) for (const s in tri[k]) tri[k][s].forEach((x, j) => (e = Math.max(e, Math.abs(x - cand[k][s][j]))));
            if (!best || e < best.e) best = { e, cand };
          }
          for (let k = 0; k < 3; k++) for (const s in tri[k]) {
            const d = Math.max(...tri[k][s].map((x, j) => Math.abs(x - best.cand[k][s][j])));
            maxErr[s] = Math.max(maxErr[s] ?? 0, d);
          }
        }
      }
    });
  }
}
console.log({ files, problems, maxErr });
