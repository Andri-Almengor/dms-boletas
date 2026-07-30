import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const OUTPUT_PATH = path.resolve(ROOT, process.env.BASELINE_OUTPUT || '.artifacts/refactor-baseline.json');
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.css', '.html']);
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.artifacts', 'coverage']);
const SOURCE_AREAS = [
  { name: 'frontend', directory: 'src' },
  { name: 'backend', directory: 'backend/src' },
];
const HOTSPOTS = {
  useEffect: /\buseEffect\s*\(/g,
  useState: /\buseState\s*\(/g,
  requestAvailable: /\brequestAvailable\s*\(/g,
  apiRequest: /\bapiRequest\s*\(/g,
  localStorage: /\blocalStorage\b/g,
  fileReader: /\bFileReader\b/g,
  windowConfirm: /\bwindow\.confirm\s*\(/g,
  inlineFieldComponent: /\bfunction\s+(?:Field|TextField)\s*\(/g,
  inlineSelectComponent: /\bfunction\s+Select\s*\(/g,
};

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }

  return files;
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

function lineCount(contents) {
  if (!contents.length) return 0;
  const lines = contents.split(/\r?\n/).length;
  return contents.endsWith('\n') ? lines - 1 : lines;
}

function matchCount(contents, expression) {
  return [...contents.matchAll(new RegExp(expression.source, expression.flags))].length;
}

async function analyzeArea(area) {
  const directory = path.resolve(ROOT, area.directory);
  const files = (await walk(directory)).filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)));
  const analyzed = [];
  const hotspots = Object.fromEntries(Object.keys(HOTSPOTS).map((key) => [key, 0]));

  for (const file of files) {
    const contents = await readFile(file, 'utf8');
    const bytes = Buffer.byteLength(contents);
    const lines = lineCount(contents);
    analyzed.push({ path: relative(file), bytes, lines });
    Object.entries(HOTSPOTS).forEach(([key, expression]) => {
      hotspots[key] += matchCount(contents, expression);
    });
  }

  analyzed.sort((left, right) => right.lines - left.lines || right.bytes - left.bytes);
  return {
    directory: area.directory,
    files: analyzed.length,
    lines: analyzed.reduce((sum, file) => sum + file.lines, 0),
    bytes: analyzed.reduce((sum, file) => sum + file.bytes, 0),
    hotspots,
    largestFiles: analyzed.slice(0, 20),
    filesOver500Lines: analyzed.filter((file) => file.lines > 500).map((file) => file.path),
  };
}

async function analyzeBuild() {
  const assetsDirectory = path.resolve(ROOT, 'dist/assets');
  if (!(await exists(assetsDirectory))) return { available: false, assets: [], totals: {} };
  const files = (await walk(assetsDirectory)).filter((file) => ['.js', '.css'].includes(path.extname(file)));
  const assets = [];

  for (const file of files) {
    const contents = await readFile(file);
    assets.push({
      path: relative(file),
      type: path.extname(file).slice(1),
      bytes: contents.byteLength,
      gzipBytes: gzipSync(contents).byteLength,
    });
  }

  assets.sort((left, right) => right.bytes - left.bytes);
  const totals = assets.reduce((result, asset) => {
    result[asset.type] ||= { files: 0, bytes: 0, gzipBytes: 0 };
    result[asset.type].files += 1;
    result[asset.type].bytes += asset.bytes;
    result[asset.type].gzipBytes += asset.gzipBytes;
    return result;
  }, {});

  return { available: true, assets, totals };
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

const source = {};
for (const area of SOURCE_AREAS) source[area.name] = await analyzeArea(area);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: gitCommit(),
  node: process.version,
  source,
  build: await analyzeBuild(),
};

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Baseline guardado en ${relative(OUTPUT_PATH)}`);
Object.entries(source).forEach(([name, metrics]) => {
  console.log(`${name}: ${metrics.files} archivos, ${metrics.lines} líneas, ${metrics.bytes} bytes`);
});
if (report.build.available) {
  Object.entries(report.build.totals).forEach(([type, metrics]) => {
    console.log(`dist ${type}: ${metrics.files} archivos, ${metrics.bytes} bytes, ${metrics.gzipBytes} gzip`);
  });
} else {
  console.log('dist: no disponible; ejecute npm run build antes del baseline para medir los paquetes.');
}
