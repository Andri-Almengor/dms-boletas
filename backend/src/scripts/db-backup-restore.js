import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { scriptPool, quoted } from './db-script.js';

function args(argv) {
  const out = { file: '', apply: false, replace: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--file') out.file = argv[++i] || '';
    else if (argv[i] === '--apply') out.apply = true;
    else if (argv[i] === '--replace') out.replace = true;
  }
  if (!out.file) throw new Error('Use --file <backup.ndjson.gz>.');
  if (!out.apply) throw new Error('La restauración requiere --apply explícito.');
  return out;
}

const options = args(process.argv.slice(2));
const pool = scriptPool();
const client = await pool.connect();

let manifest = null;
let current = null;
let batch = [];
let restored = 0;
const restoredTables = [];
const restoredCounts = new Map();
const seenTables = new Set();

async function flush() {
  if (!current || !batch.length) return;
  const columns = current.columns;
  if (!columns.length) throw new Error(`Backup inválido: ${current.name} no declara columnas.`);

  const params = [];
  const values = [];
  for (const row of batch) {
    const start = params.length + 1;
    for (const col of columns) params.push(row[col] ?? null);
    values.push(`(${columns.map((_, i) => `$${start + i}`).join(',')})`);
  }

  const overriding = current.identity ? ' OVERRIDING SYSTEM VALUE' : '';
  await client.query(
    `INSERT INTO ${quoted(current.name)} (${columns.map(quoted).join(',')})${overriding} VALUES ${values.join(',')}`,
    params,
  );
  restored += batch.length;
  current.rows += batch.length;
  batch = [];
}

async function validateManifest(record, existingTables) {
  if (manifest) throw new Error('Backup inválido: manifest duplicado.');
  if (record.format !== 'dms-postgres-ndjson-v1') throw new Error('Formato de backup no soportado.');
  const tables = Array.isArray(record.tables) ? record.tables.map(String) : [];
  if (!tables.length) throw new Error('Backup inválido: manifest sin tablas.');
  if (new Set(tables).size !== tables.length) throw new Error('Backup inválido: manifest contiene tablas duplicadas.');
  const missing = tables.filter((table) => !existingTables.has(table));
  if (missing.length) throw new Error(`Faltan tablas del esquema; ejecute db:migrate primero: ${missing.join(', ')}`);
  manifest = { ...record, tables };

  if (options.replace) {
    await client.query(`TRUNCATE TABLE ${tables.map(quoted).join(', ')} RESTART IDENTITY`);
  } else {
    for (const table of tables) {
      const result = await client.query(`SELECT EXISTS(SELECT 1 FROM ${quoted(table)} LIMIT 1) AS present`);
      if (result.rows[0]?.present) {
        throw new Error(`La tabla ${table} no está vacía. Use --replace solo en una restauración controlada.`);
      }
    }
  }
}

async function beginTable(record) {
  if (!manifest) throw new Error('Backup inválido: debe iniciar con manifest.');
  if (current) throw new Error(`Backup inválido: falta table_end para ${current.name}.`);
  const name = String(record.name || '');
  if (!name || !manifest.tables.includes(name)) throw new Error(`Backup inválido: tabla inesperada ${name || '(vacía)'}.`);
  if (seenTables.has(name)) throw new Error(`Backup inválido: tabla duplicada ${name}.`);

  const columns = Array.isArray(record.columns) ? record.columns.map(String) : [];
  if (!columns.length || new Set(columns).size !== columns.length) {
    throw new Error(`Backup inválido: columnas inválidas en ${name}.`);
  }
  const schema = await client.query(
    "SELECT column_name,is_identity FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
    [name],
  );
  const actualColumns = new Set(schema.rows.map((row) => row.column_name));
  const missingColumns = columns.filter((column) => !actualColumns.has(column));
  if (missingColumns.length) throw new Error(`El esquema actual no contiene columnas de ${name}: ${missingColumns.join(', ')}`);

  const identity = String(record.identity || '');
  if (identity && !columns.includes(identity)) throw new Error(`Backup inválido: identity ${identity} no pertenece a ${name}.`);
  current = { name, columns, identity, rows: 0 };
  seenTables.add(name);
}

async function endTable(record) {
  if (!current) throw new Error('Backup inválido: table_end sin tabla activa.');
  if (String(record.name || '') !== current.name) {
    throw new Error(`Backup inválido: table_end de ${record.name || '(vacía)'} no corresponde a ${current.name}.`);
  }
  await flush();
  const declared = Number(record.rows);
  if (!Number.isInteger(declared) || declared < 0 || declared !== current.rows) {
    throw new Error(`Backup inválido: conteo de ${current.name}; declarado=${record.rows} restaurado=${current.rows}.`);
  }

  if (current.identity) {
    const seq = await client.query('SELECT pg_get_serial_sequence($1,$2) AS seq', [current.name, current.identity]);
    if (seq.rows[0]?.seq) {
      const maximum = await client.query(`SELECT MAX(${quoted(current.identity)}) AS value FROM ${quoted(current.name)}`);
      const value = maximum.rows[0]?.value;
      if (value === null || value === undefined) {
        await client.query('SELECT setval($1::regclass, 1, FALSE)', [seq.rows[0].seq]);
      } else {
        await client.query('SELECT setval($1::regclass, $2, TRUE)', [seq.rows[0].seq, value]);
      }
    }
  }

  restoredCounts.set(current.name, current.rows);
  restoredTables.push(current.name);
  current = null;
}

try {
  await client.query('BEGIN');
  const exists = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations'");
  const existingTables = new Set(exists.rows.map((row) => row.tablename));

  const input = createReadStream(options.file).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;

  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`Backup inválido: JSON corrupto en línea ${lineNumber}.`);
    }

    if (record.kind === 'manifest') {
      await validateManifest(record, existingTables);
      continue;
    }
    if (record.kind === 'table') {
      await beginTable(record);
      continue;
    }
    if (record.kind === 'row') {
      if (!current || record.table !== current.name || !record.row || typeof record.row !== 'object' || Array.isArray(record.row)) {
        throw new Error(`Backup inválido cerca de línea ${lineNumber}.`);
      }
      batch.push(record.row);
      if (batch.length >= 100) await flush();
      continue;
    }
    if (record.kind === 'table_end') {
      await endTable(record);
      continue;
    }
    throw new Error(`Backup inválido: registro desconocido en línea ${lineNumber}.`);
  }

  await flush();
  if (!manifest) throw new Error('Backup sin manifest.');
  if (current) throw new Error(`Backup inválido: falta table_end para ${current.name}.`);
  const missingTables = manifest.tables.filter((table) => !restoredCounts.has(table));
  const unexpectedTables = restoredTables.filter((table) => !manifest.tables.includes(table));
  if (missingTables.length || unexpectedTables.length || restoredTables.length !== manifest.tables.length) {
    throw new Error(`Backup incompleto: faltantes=[${missingTables.join(', ')}] inesperadas=[${unexpectedTables.join(', ')}].`);
  }

  await client.query('COMMIT');
  console.log(JSON.stringify({
    ok: true,
    format: manifest.format,
    tables: restoredTables.length,
    rows: restored,
    verifiedCounts: Object.fromEntries(restoredCounts),
  }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
