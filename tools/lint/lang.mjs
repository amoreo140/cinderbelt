// lint:lang – tracked code is English: no Slovak in comments or test titles, and no links to the
// local-only internal docs. String literals are not checked: tests may assert Slovak game texts.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse } from '@babel/parser';

const SLOVAK = /[áäčďéíĺľňóôŕšťúýžÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ]/;
const INTERNAL_DOCS = new RegExp(['docs/superpowers', 'docs/design', 'STAV-PROJEKTU', 'SUHRN-'].join('|'));
const CODE = /\.(ts|tsx|mts|cts|mjs|cjs|js|py|css|html)$/;
const JS = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/;
const SKIP = new Set(['tools/lint/lang.mjs', 'tools/lint/lang.d.mts', 'tools/lint/lang.test.ts']);
const TEST_FNS = new Set(['describe', 'it', 'test']);

const lineOf = (text, pos) => text.slice(0, pos).split('\n').length;

/** Babel plugins: JSX only where it can occur – it breaks `<T>x` casts in plain .ts. */
function plugins(file) {
  return /\.(ts|mts|cts)$/.test(file) ? ['typescript'] : ['typescript', 'jsx'];
}

function titleOf(arg) {
  if (!arg) return undefined;
  if (arg.type === 'StringLiteral') return arg.value;
  if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) return arg.quasis[0]?.value.cooked ?? undefined;
  return undefined;
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) walk(c, visit);
    else if (v && typeof v.type === 'string') walk(v, visit);
  }
}

function jsProblems(file, text, out) {
  const ast = parse(text, { sourceType: 'module', errorRecovery: true, plugins: plugins(file) });
  for (const c of ast.comments ?? []) {
    if (SLOVAK.test(c.value)) out.push({ line: c.loc.start.line, what: 'comment', text: c.value.trim().split('\n')[0] });
  }
  walk(ast.program, (n) => {
    if (n.type !== 'CallExpression') return;
    const callee = n.callee;
    const root = callee.type === 'MemberExpression' ? callee.object : callee;
    if (root.type !== 'Identifier' || !TEST_FNS.has(root.name)) return;
    const title = titleOf(n.arguments[0]);
    if (title !== undefined && SLOVAK.test(title)) out.push({ line: n.loc.start.line, what: 'test title', text: title });
  });
}

function regexComments(text, re, out) {
  for (const m of text.matchAll(re)) if (SLOVAK.test(m[0])) out.push({ line: lineOf(text, m.index), what: 'comment', text: m[0].split('\n')[0] });
}

/** Problems in one file: [{ line, what, text }]. */
export function scanSource(file, text) {
  const out = [];
  if (JS.test(file)) jsProblems(file, text, out);
  else if (file.endsWith('.py')) regexComments(text, /"""[\s\S]*?"""|'''[\s\S]*?'''|#[^\n]*/g, out);
  else if (file.endsWith('.css')) regexComments(text, /\/\*[\s\S]*?\*\//g, out);
  else if (file.endsWith('.html')) regexComments(text, /<!--[\s\S]*?-->/g, out);
  text.split('\n').forEach((l, i) => {
    if (INTERNAL_DOCS.test(l)) out.push({ line: i + 1, what: 'internal doc link', text: l.trim() });
  });
  return out;
}

function main() {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter((f) => CODE.test(f) && !SKIP.has(f));
  let n = 0;
  for (const f of files) {
    for (const p of scanSource(f, readFileSync(f, 'utf8'))) {
      n++;
      console.log(`${f}:${p.line}  ${p.what}: ${p.text.slice(0, 100)}`);
    }
  }
  if (n > 0) {
    console.error(`lint:lang – ${n} problem(s): translate comments / test titles to English, describe features instead of linking local docs.`);
    process.exit(1);
  }
  console.log(`lint:lang – ${files.length} files clean`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
