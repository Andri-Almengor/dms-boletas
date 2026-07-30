import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const CURRENT_PATH = path.resolve(ROOT, process.env.BASELINE_OUTPUT || '.artifacts/refactor-baseline.json');
const REFERENCE_PATH = path.resolve(ROOT, 'docs/refactor/stage-0-reference.json');
const OUTPUT_PATH = path.resolve(ROOT, process.env.FINAL_REPORT_OUTPUT || '.artifacts/final-validation.json');
const STYLE_ROOT = path.resolve(ROOT, 'src/styles');
const STYLE_ENTRY = path.resolve(STYLE_ROOT, 'index.css');

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

function lines(text) {
  if (!text) return 0;
  const count = text.split(/\r?\n/).length;
  return text.endsWith('\n') ? count - 1 : count;
}

function delta(current, initial) {
  const value = Number(current || 0) - Number(initial || 0);
  const percent = Number(initial || 0) === 0 ? null : Math.round((value / Number(initial)) * 10_000) / 100;
  return { initial: Number(initial || 0), current: Number(current || 0), delta: value, percent };
}

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, '');
}

function findClosingBrace(source, opening) {
  let depth = 1;
  let quote = '';
  for (let index = opening + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function normalizedDeclarations(body) {
  return body
    .split(';')
    .map((entry) => normalizeSpace(entry).replace(/\s*:\s*/, ':'))
    .filter(Boolean)
    .sort()
    .join(';');
}

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function parseRules(source, file, context = [], baseOffset = 0, fullSource = source) {
  const rules = [];
  let statementStart = 0;
  let quote = '';

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ';') {
      statementStart = index + 1;
      continue;
    }
    if (character !== '{') continue;

    const closing = findClosingBrace(source, index);
    if (closing < 0) break;
    const header = normalizeSpace(source.slice(statementStart, index));
    const body = source.slice(index + 1, closing);
    const absoluteIndex = baseOffset + statementStart;

    if (header.startsWith('@')) {
      if (/^@(media|supports|layer|container|document)\b/i.test(header)) {
        rules.push(...parseRules(body, file, [...context, header], baseOffset + index + 1, fullSource));
      }
    } else if (header && !body.includes('{')) {
      const declarations = normalizedDeclarations(body);
      if (declarations) {
        rules.push({
          file,
          line: lineAt(fullSource, absoluteIndex),
          context: context.map(normalizeSpace),
          selector: normalizeSpace(header),
          declarations,
        });
      }
    } else if (header && body.includes('{')) {
      rules.push(...parseRules(body, file, context, baseOffset + index + 1, fullSource));
    }

    index = closing;
    statementStart = closing + 1;
  }
  return rules;
}

function importsFor(source) {
  return [...source.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]\)?\s*;/g)].map((match) => match[1]);
}

async function analyzeStyles() {
  const files = (await walk(STYLE_ROOT)).filter((file) => file.endsWith('.css')).sort();
  const contents = new Map();
  for (const file of files) contents.set(file, await readFile(file, 'utf8'));

  const graph = new Map();
  const missingImports = [];
  const duplicateImports = [];
  for (const file of files) {
    const imports = importsFor(contents.get(file));
    const seen = new Set();
    const resolved = [];
    for (const imported of imports) {
      if (/^(?:https?:|data:)/i.test(imported)) continue;
      const target = path.resolve(path.dirname(file), imported);
      if (seen.has(target)) duplicateImports.push({ file: relative(file), import: imported });
      seen.add(target);
      if (!(await exists(target))) missingImports.push({ file: relative(file), import: imported });
      else resolved.push(target);
    }
    graph.set(file, resolved);
  }

  const reachable = new Set();
  const cycles = [];
  function visit(file, stack = []) {
    if (stack.includes(file)) {
      cycles.push([...stack.slice(stack.indexOf(file)), file].map(relative));
      return;
    }
    if (reachable.has(file)) return;
    reachable.add(file);
    for (const child of graph.get(file) || []) visit(child, [...stack, file]);
  }
  visit(STYLE_ENTRY);

  const rules = [];
  for (const file of files) {
    const source = stripComments(contents.get(file));
    rules.push(...parseRules(source, relative(file), [], 0, source));
  }

  const exactGroups = new Map();
  for (const rule of rules) {
    const key = `${rule.context.join(' > ')}|${rule.selector}|${rule.declarations}`;
    if (!exactGroups.has(key)) exactGroups.set(key, []);
    exactGroups.get(key).push(rule);
  }
  const exactDuplicateRules = [...exactGroups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      context: group[0].context,
      selector: group[0].selector,
      declarations: group[0].declarations,
      occurrences: group.map(({ file, line }) => ({ file, line })),
    }))
    .sort((left, right) => right.occurrences.length - left.occurrences.length || left.selector.localeCompare(right.selector));

  return {
    files: files.length,
    lines: [...contents.values()].reduce((sum, source) => sum + lines(source), 0),
    bytes: [...contents.values()].reduce((sum, source) => sum + Buffer.byteLength(source), 0),
    imports: {
      entry: relative(STYLE_ENTRY),
      reachable: reachable.size,
      unreferenced: files.filter((file) => !reachable.has(file)).map(relative),
      missing: missingImports,
      duplicates: duplicateImports,
      cycles,
    },
    rules: rules.length,
    exactDuplicateGroups: exactDuplicateRules.length,
    exactDuplicateOccurrences: exactDuplicateRules.reduce((sum, group) => sum + group.occurrences.length, 0),
    exactDuplicateRules: exactDuplicateRules.slice(0, 100),
  };
}

if (!(await exists(CURRENT_PATH))) {
  throw new Error('No existe el baseline actual. Ejecute `npm run build && npm run baseline` antes del reporte final.');
}

const current = JSON.parse(await readFile(CURRENT_PATH, 'utf8'));
const reference = JSON.parse(await readFile(REFERENCE_PATH, 'utf8'));
const styles = await analyzeStyles();
const currentBuild = current.build?.totals || {};

const comparison = {
  source: {
    frontend: {
      files: delta(current.source?.frontend?.files, reference.source?.frontend?.files),
      lines: delta(current.source?.frontend?.lines, reference.source?.frontend?.lines),
      bytes: delta(current.source?.frontend?.bytes, reference.source?.frontend?.bytes),
    },
    backend: {
      files: delta(current.source?.backend?.files, reference.source?.backend?.files),
      lines: delta(current.source?.backend?.lines, reference.source?.backend?.lines),
      bytes: delta(current.source?.backend?.bytes, reference.source?.backend?.bytes),
    },
  },
  build: {
    js: {
      bytes: delta(currentBuild.js?.bytes, reference.build?.js?.bytes),
      gzipBytes: delta(currentBuild.js?.gzipBytes, reference.build?.js?.gzipBytes),
    },
    css: {
      bytes: delta(currentBuild.css?.bytes, reference.build?.css?.bytes),
      gzipBytes: delta(currentBuild.css?.gzipBytes, reference.build?.css?.gzipBytes),
    },
  },
};

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: current.commit || '',
  reference,
  current,
  comparison,
  styles,
  checks: {
    buildAvailable: Boolean(current.build?.available),
    cssEntryExists: await exists(STYLE_ENTRY),
    missingCssImports: styles.imports.missing.length,
    duplicateCssImports: styles.imports.duplicates.length,
    cssImportCycles: styles.imports.cycles.length,
  },
};

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Reporte final guardado en ${relative(OUTPUT_PATH)}`);
console.log(`Frontend: ${current.source.frontend.files} archivos, ${current.source.frontend.lines} líneas, ${current.source.frontend.bytes} bytes`);
console.log(`Backend: ${current.source.backend.files} archivos, ${current.source.backend.lines} líneas, ${current.source.backend.bytes} bytes`);
console.log(`Build JS gzip: ${currentBuild.js?.gzipBytes || 0} bytes; CSS gzip: ${currentBuild.css?.gzipBytes || 0} bytes`);
console.log(`CSS: ${styles.files} archivos, ${styles.rules} reglas, ${styles.exactDuplicateGroups} grupos duplicados exactos`);

if (!report.checks.buildAvailable) throw new Error('El build no está disponible en el baseline actual.');
if (report.checks.missingCssImports || report.checks.duplicateCssImports || report.checks.cssImportCycles) {
  throw new Error('La cadena de imports CSS contiene archivos faltantes, duplicados o ciclos.');
}
