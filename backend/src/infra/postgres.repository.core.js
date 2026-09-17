import { DATABASE_TABLES, tableDefinition } from '../config/database-tables.js';
import { query, withTransaction, postgresSnapshot } from './postgres.js';
import { notFound } from '../core/errors.js';

export function _qi(value) { return `"${String(value).replace(/"/g, '""')}"`; }
export function _definition(table) {
  const meta = tableDefinition(table);
  if (!meta) throw new Error(`Tabla no registrada: ${table}`);
  return meta;
}
export function _column(table, name) {
  const meta = _definition(table);
  if (!meta.columns.includes(name)) throw new Error(`Columna no registrada en ${table}: ${name}`);
  return name;
}
export function _writableValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
function payloadFromRow(row) {
  if (!row) return null;
  const payload = row.__payload && typeof row.__payload === 'object' && !Array.isArray(row.__payload) ? { ...row.__payload } : {};
  return { ...payload, __rowNumber: Number(row.__source_row_number || row.__db_id || 0) || undefined };
}
export function _publicRow(row) {
  const payload = payloadFromRow(row);
  if (!payload) return payload;
  if (!payload.__rowNumber) delete payload.__rowNumber;
  return payload;
}
export function _selectList(table, prefix = '') {
  const meta = _definition(table);
  const p = prefix ? `${prefix}.` : '';
  return [`${p}"__payload"`, `${p}"__db_id"`, `${p}"__source_row_number"`].join(', ');
}

export async function getHeaders(table) { return [..._definition(table).columns]; }
export function invalidateHeaderCache() {}
export function invalidateTableCache() {}

export async function readTable(table) {
  _definition(table);
  const result = await query(`SELECT ${_selectList(table)} FROM ${_qi(table)} WHERE "__valid" = TRUE ORDER BY "__db_id" ASC`, [], { label: `readTable.${table}` });
  return result.rows.map(_publicRow);
}
export async function readTables(tables) {
  const names = [...new Set(tables || [])];
  const pairs = await Promise.all(names.map(async (name) => [name, await readTable(name)]));
  return Object.fromEntries(pairs);
}

export async function findById(table, idValue, idColumn = _definition(table).id) {
  _column(table, idColumn);
  const result = await query(
    `SELECT ${_selectList(table)} FROM ${_qi(table)} WHERE "__valid" = TRUE AND ${_qi(idColumn)} = $1 ORDER BY "__db_id" ASC LIMIT 1`,
    [_writableValue(idValue)], { label: `findById.${table}` },
  );
  if (!result.rows[0]) throw notFound(`No se encontró el registro en ${table}.`);
  return _publicRow(result.rows[0]);
}

export async function findOneBy(table, criteria = {}, { order = 'ASC', required = false } = {}) {
  const entries = Object.entries(criteria).filter(([, value]) => value !== undefined);
  const params = [];
  const clauses = ['"__valid" = TRUE'];
  for (const [key, value] of entries) {
    _column(table, key); params.push(_writableValue(value)); clauses.push(`${_qi(key)} = $${params.length}`);
  }
  const direction = String(order).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const result = await query(`SELECT ${_selectList(table)} FROM ${_qi(table)} WHERE ${clauses.join(' AND ')} ORDER BY "__db_id" ${direction} LIMIT 1`, params, { label: `findOneBy.${table}` });
  if (!result.rows[0] && required) throw notFound(`No se encontró el registro en ${table}.`);
  return result.rows[0] ? _publicRow(result.rows[0]) : null;
}

export async function findRows(table, criteria = {}, { limit = 5000, orderBy = '__db_id', order = 'ASC' } = {}) {
  const params = [];
  const clauses = ['"__valid" = TRUE'];
  for (const [key, value] of Object.entries(criteria)) {
    if (value === undefined) continue;
    _column(table, key);
    if (Array.isArray(value)) {
      if (!value.length) return [];
      params.push(value.map(_writableValue)); clauses.push(`${_qi(key)} = ANY($${params.length}::text[])`);
    } else {
      params.push(_writableValue(value)); clauses.push(`${_qi(key)} = $${params.length}`);
    }
  }
  let orderSql = '"__db_id"';
  if (orderBy !== '__db_id') { _column(table, orderBy); orderSql = _qi(orderBy); }
  const direction = String(order).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  params.push(Math.max(1, Math.min(50_000, Number(limit || 5000))));
  const result = await query(`SELECT ${_selectList(table)} FROM ${_qi(table)} WHERE ${clauses.join(' AND ')} ORDER BY ${orderSql} ${direction}, "__db_id" ${direction} LIMIT $${params.length}`, params, { label: `findRows.${table}` });
  return result.rows.map(_publicRow);
}

export async function ensureColumns(table, requested = []) {
  const meta = _definition(table);
  const missing = requested.filter((name) => !meta.columns.includes(String(name)));
  if (missing.length) throw new Error(`La migración PostgreSQL no contiene columnas requeridas en ${table}: ${missing.join(', ')}`);
  return [...meta.columns];
}

async function prepareRuntimeInsert(table, record) {
  if (table !== 'Boletas') return record;
  const requestedNumber = String(record?.BoletaID || '').trim();
  // Some existing flows intentionally use non-sequential visible identifiers
  // (for example PRUEBA-* customer-case tickets). Preserve them verbatim.
  if (requestedNumber && !/^\d+$/.test(requestedNumber) && !/^M\d+$/i.test(requestedNumber)) return record;
  const maintenance = /^M\d+$/i.test(requestedNumber)
    || /^mnt-/i.test(String(record?.BoletaUID || '').trim())
    || String(record?.EsBoletaMantenimiento || '').toLowerCase() === 'true';
  const allocated = await query(
    'SELECT dms_next_ticket_number($1) AS value',
    [maintenance ? 'MAINTENANCE' : 'STANDARD'],
    { label: maintenance ? 'sequence.ticket.maintenance' : 'sequence.ticket.standard', write: true },
  );
  const value = String(allocated.rows[0]?.value || '').trim();
  if (!value) throw new Error('No se pudo reservar el consecutivo de la boleta.');
  record.BoletaID = value;
  return record;
}

async function insertRows(table, records) {
  const meta = _definition(table);
  const columns = meta.columns.filter((key) => key !== 'Cursor');
  const perRow = columns.length + 1;
  const maxBatch = Math.max(1, Math.min(250, Math.floor(50_000 / perRow)));
  const inserted = [];

  for (let offset = 0; offset < records.length; offset += maxBatch) {
    const batch = records.slice(offset, offset + maxBatch);
    // Ticket numbering must be allocated on the same transaction/connection as
    // the INSERT. Other tables can still use multi-row INSERTs.
    if (table === 'Boletas') {
      for (const record of batch) {
        await prepareRuntimeInsert(table, record);
        const payload = Object.fromEntries(columns.map((key) => [key, record[key] ?? '']));
        const params = columns.map((key) => _writableValue(record[key]));
        params.push(JSON.stringify(payload));
        const placeholders = columns.map((_, index) => `$${index + 1}`);
        const result = await query(
          `INSERT INTO ${_qi(table)} (${[...columns.map(_qi), '"__payload"'].join(', ')}) VALUES (${[...placeholders, `$${params.length}::jsonb`].join(', ')}) RETURNING "__payload", "__db_id"`,
          params,
          { label: `append.${table}`, write: true },
        );
        const stored = _publicRow(result.rows[0]) || record;
        Object.assign(record, stored);
        inserted.push(record);
      }
      continue;
    }

    const params = [];
    const tuples = [];
    for (const record of batch) {
      const payload = Object.fromEntries(columns.map((key) => [key, record[key] ?? '']));
      const start = params.length + 1;
      for (const key of columns) params.push(_writableValue(record[key]));
      params.push(JSON.stringify(payload));
      tuples.push(`(${columns.map((_, index) => `$${start + index}`).join(', ')}, $${start + columns.length}::jsonb)`);
    }
    const cols = [...columns.map(_qi), '"__payload"'];
    const result = await query(
      `INSERT INTO ${_qi(table)} (${cols.join(', ')}) VALUES ${tuples.join(', ')} RETURNING "__payload", "__db_id"`,
      params,
      { label: `append.${table}`, write: true },
    );
    result.rows.forEach((dbRow, index) => {
      const source = batch[index];
      const stored = _publicRow(dbRow) || source;
      Object.assign(source, stored);
      inserted.push(source);
    });
  }
  return inserted;
}
export async function appendRows(table, records = []) {
  if (!records.length) return [];
  return withTransaction(() => insertRows(table, records));
}
export async function appendRow(table, record) { await appendRows(table, [record]); return record; }

export async function updateRows(table, updates = [], idColumn = _definition(table).id) {
  if (!updates.length) return [];
  const meta = _definition(table); _column(table, idColumn);
  return withTransaction(async () => {
    const results = [];
    for (const update of updates) {
      // Sheets updateRows used a Map built in source order, therefore the LAST duplicate wins.
      const currentResult = await query(`SELECT ${_selectList(table)}, "__db_id" FROM ${_qi(table)} WHERE "__valid"=TRUE AND ${_qi(idColumn)}=$1 ORDER BY "__db_id" DESC LIMIT 1 FOR UPDATE`, [_writableValue(update.idValue)], { label: `update.lookup.${table}` });
      const currentDb = currentResult.rows[0];
      if (!currentDb) throw notFound(`No se encontró el registro en ${table}.`);
      const current = _publicRow(currentDb);
      const patch = Object.fromEntries(Object.entries(update.patch || {}).filter(([key]) => meta.columns.includes(key) && key !== 'Cursor'));
      const merged = { ...current, ...patch };
      delete merged.__rowNumber;
      const fields = Object.keys(patch);
      const params = [];
      const sets = [];
      for (const key of fields) { params.push(_writableValue(patch[key])); sets.push(`${_qi(key)}=$${params.length}`); }
      params.push(JSON.stringify(Object.fromEntries(meta.columns.filter((key) => key !== 'Cursor' && merged[key] !== undefined).map((key) => [key, merged[key]]))));
      sets.push(`"__payload"=$${params.length}::jsonb`);
      params.push(currentDb.__db_id);
      await query(`UPDATE ${_qi(table)} SET ${sets.join(', ')} WHERE "__db_id"=$${params.length}`, params, { label: `update.${table}`, write: true });
      results.push(merged);
    }
    return results;
  });
}
export async function updateRow(table, idValue, patch, idColumn = _definition(table).id) { return (await updateRows(table, [{ idValue, patch }], idColumn))[0]; }
export async function softDelete(table, idValue, actor = '') { return updateRow(table, idValue, { Activo: false, Estado: 'INACTIVO', ActualizadoPor: actor, FechaActualizacion: new Date().toISOString() }); }


export function postgresRepositorySnapshot(){ return postgresSnapshot(); }
export function sheetsRepositorySnapshot(){ return postgresSnapshot(); }
export { withTransaction };
export const OPERATIONAL_TABLES = Object.freeze(Object.keys(DATABASE_TABLES));
