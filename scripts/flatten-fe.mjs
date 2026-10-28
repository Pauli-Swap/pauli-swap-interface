// Writes every frontend source file into one text file, for review or for
// pasting into a tool. Dependencies, build output, lockfiles and binaries are
// left out. Usage: npm run flatten:fe [-- <output path>]
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] ?? 'txts/pauli-swap-fe.txt');

const ROOT_FILES = ['package.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'README.md'];
const DIRS = ['src', 'public', 'assets', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'fe-report', 'txts', '.git']);
const SKIP_FILES = new Set(['package-lock.json', 'seed-result.json']);
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.css', '.json', '.html', '.md', '.svg', '.webmanifest', '.hyp', '.txt']);

function walk(dir, files = []) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(path, files);
    } else if (!SKIP_FILES.has(name) && TEXT_EXT.has(extname(name).toLowerCase()) && resolve(path) !== out) {
      files.push(path);
    }
  }
  return files;
}

const files = [
  ...ROOT_FILES.map((f) => join(root, f)).filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  }),
  ...DIRS.flatMap((d) => {
    try {
      return walk(join(root, d));
    } catch {
      return [];
    }
  }),
];

const rel = (f) => relative(root, f).split(sep).join('/');
const rule = '='.repeat(80);
const parts = [
  `PauliSwap interface: flattened frontend source`,
  `Generated ${new Date().toISOString()} · ${files.length} files`,
  '',
  'Files:',
  ...files.map((f) => `  ${rel(f)}`),
  '',
];
for (const f of files) {
  parts.push(rule, `FILE: ${rel(f)}`, rule, readFileSync(f, 'utf8').replace(/\s+$/, ''), '');
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, parts.join('\n'));
console.log(`Wrote ${files.length} files to ${rel(out)} (${(statSync(out).size / 1024).toFixed(0)} KB)`);
